import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onTaskDispatched } from 'firebase-functions/v2/tasks';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { logJob } from './jobLogger.js';
import { calculateCost } from './cost.js';

const db = getFirestore();

export const handleEvaluateTaskSubmission = async ({
  classId,
  taskId,
  studentUid,
  attemptNumber = 1,
  compiledVideoPath,
  rubricSteps,
  model,
}) => {
  if (!classId || !taskId || !studentUid) {
    throw new HttpsError('invalid-argument', 'Missing required parameters: classId, taskId, studentUid.');
  }

  // 1. Fetch Task Definition
  const taskRef = db.collection('classes').doc(classId).collection('tasks').doc(taskId);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) {
    throw new HttpsError('not-found', `Task ${taskId} not found in class ${classId}.`);
  }
  const taskData = taskDoc.data();
  const effectiveSteps = rubricSteps || taskData.rubricSteps || [];
  const maxScore = taskData.maxScore || 100;

  // 2. Resolve Video Path
  const storage = getStorage();
  const bucketName = storage.bucket().name;
  const effectiveVideoPath =
    compiledVideoPath ||
    `classes/${classId}/tasks/${taskId}/submissions/${studentUid}/attempt_${attemptNumber}.mp4`;
  const gcsUri = effectiveVideoPath.startsWith('gs://')
    ? effectiveVideoPath
    : `gs://${bucketName}/${effectiveVideoPath.replace(/^\/+/, '')}`;

  const promptText = `You are an expert technical invigilator and automated practical exam evaluator.
Evaluate the student's continuous screen recording time-lapse video against the following practical assignment rubric.

=== ASSIGNMENT DETAILS ===
Title: "${taskData.title || 'Practical Lab Task'}"
Overview: "${taskData.description || 'Complete the designated lab instructions'}"
Total Possible Score: ${maxScore} points

=== REQUIRED RUBRIC MILESTONES ===
${JSON.stringify(effectiveSteps, null, 2)}

=== INSTRUCTIONS FOR EVALUATION ===
1. Watch the student's screen actions chronologically.
2. For each milestone listed in the rubric above:
   - Determine whether it was completed, partially completed, encountered an error, or was completely missing.
   - Note the approximate mm:ss timestamp where the milestone was attempted/completed.
   - Award points according to the rubric step's allocated point weight.
   - Provide concise, constructive feedback explaining why points were awarded or deducted.
3. Highlight 2-3 specific technical strengths demonstrated in the video.
4. Highlight any errors, warnings, configuration oversights, or suspicious anomalies (e.g. abrupt paste of whole codebase, unhandled exceptions).
5. Calculate the final score as the sum of points awarded across all steps.

Respond strictly with valid JSON conforming to this schema:
{
  "finalScore": 85,
  "maxScore": ${maxScore},
  "completionPercentage": 85,
  "overallSummary": "Concise 2-3 sentence assessment of the student's performance",
  "stepResults": [
    {
      "stepNumber": 1,
      "title": "Step Title",
      "status": "completed",
      "timestampInVideo": "02:15",
      "scoreAwarded": 20,
      "feedback": "Concise feedback for this step"
    }
  ],
  "strengths": ["Strengths observation 1", "Strengths observation 2"],
  "deviationsOrErrors": ["Error or warning observation"]
}

Return ONLY raw JSON. Do not wrap in markdown code fence blocks (\`\`\`json).`;

  const preferredModel = model || 'gemini-3.7-flash';
  const generateConfig = {
    prompt: [
      { text: promptText },
      { media: { url: gcsUri, contentType: 'video/mp4' } },
    ],
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  const { response, modelUsed } = await generateWithResilience(generateConfig, preferredModel);

  let rawText = response.text || '';
  if (rawText.startsWith('```json')) {
    rawText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  } else if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```\s*/, '').replace(/```\s*$/i, '');
  }

  let evaluation;
  try {
    evaluation = JSON.parse(rawText.trim());
  } catch (err) {
    console.warn('[evaluateTaskSubmission] JSON parse failed, applying fallback schema:', err);
    evaluation = {
      finalScore: 0,
      maxScore,
      completionPercentage: 0,
      overallSummary: 'Automated evaluation could not parse a structured response. Manual review required.',
      stepResults: effectiveSteps.map((s, idx) => ({
        stepNumber: s.stepNumber || idx + 1,
        title: s.title || `Milestone ${idx + 1}`,
        status: 'error',
        timestampInVideo: '00:00',
        scoreAwarded: 0,
        feedback: 'Evaluation error during video inspection.',
      })),
      strengths: [],
      deviationsOrErrors: ['Model returned non-JSON output.'],
    };
  }

  evaluation.evaluatedAt = new Date();
  evaluation.model = modelUsed || preferredModel;

  // 3. Update Firestore Attempt Record
  const attemptRef = taskRef
    .collection('submissions')
    .doc(studentUid)
    .collection('attempts')
    .doc(String(attemptNumber));

  await attemptRef.set(
    {
      evaluation,
      status: 'evaluated',
      finishedAt: new Date(),
    },
    { merge: true }
  );

  // 4. Update Root Submission Document
  const submissionRef = taskRef.collection('submissions').doc(studentUid);
  const attemptsSnap = await taskRef.collection('submissions').doc(studentUid).collection('attempts').get();
  
  let bestScore = evaluation.finalScore || 0;
  let latestScore = evaluation.finalScore || 0;
  let highestAttempt = attemptNumber;

  attemptsSnap.forEach((doc) => {
    const data = doc.data();
    const attNum = data.attemptNumber || parseInt(doc.id, 10);
    const score = data.evaluation?.finalScore;
    if (typeof score === 'number') {
      if (score > bestScore) {
        bestScore = score;
        highestAttempt = attNum;
      }
      latestScore = score;
    }
  });

  const scoringStrategy = taskData.constraints?.attempts?.scoringStrategy || 'highest';
  const effectiveScore = scoringStrategy === 'latest' ? latestScore : bestScore;

  await submissionRef.set(
    {
      status: 'evaluated',
      effectiveScore,
      bestScore,
      latestScore,
      highestAttempt,
      lastEvaluatedAt: new Date(),
      evaluation, // Latest evaluation preview
    },
    { merge: true }
  );

  const usage = response?.usage || response?.usageMetadata || {};
  const cost = calculateCost(usage, modelUsed || preferredModel);

  try {
    await logJob({
      classId,
      studentUid,
      jobType: 'evaluateTaskSubmission',
      status: 'completed',
      promptText,
      mediaPaths: [effectiveVideoPath],
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokenCount ?? 0,
        outputTokens: usage.outputTokens ?? usage.candidatesTokenCount ?? 0,
      },
      cost,
      modelUsed: modelUsed || preferredModel,
      result: `Score: ${evaluation.finalScore}/${maxScore}. Steps completed: ${
        evaluation.stepResults?.filter((s) => s.status === 'completed').length || 0
      }/${effectiveSteps.length}`,
    });
  } catch (logErr) {
    console.warn('[evaluateTaskSubmission] Failed to log AI job:', logErr);
  }

  return {
    success: true,
    evaluation,
    effectiveScore,
    modelUsed,
    cost,
  };
};

/**
 * Enqueues a practical task submission evaluation to the Cloud Tasks queue.
 * Immediately transitions attempt and submission documents to 'evaluating'.
 */
export const enqueueTaskEvaluation = async ({
  classId,
  taskId,
  studentUid,
  attemptNumber = 1,
  compiledVideoPath,
  rubricSteps,
  model,
}) => {
  if (!classId || !taskId || !studentUid) {
    throw new Error('Missing required parameters for task evaluation enqueue: classId, taskId, studentUid.');
  }

  // 1. Mark status in Firestore as 'evaluating' so UI immediately reflects state
  try {
    const taskRef = db.collection('classes').doc(classId).collection('tasks').doc(taskId);
    const attemptRef = taskRef
      .collection('submissions')
      .doc(studentUid)
      .collection('attempts')
      .doc(String(attemptNumber));

    await attemptRef.set(
      {
        status: 'evaluating',
        evaluatingStartedAt: new Date(),
      },
      { merge: true }
    );

    const submissionRef = taskRef.collection('submissions').doc(studentUid);
    await submissionRef.set(
      {
        status: 'evaluating',
        lastEvaluatingAt: new Date(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[enqueueTaskEvaluation] Failed to set evaluating status in Firestore:', err);
  }

  // 2. Enqueue to Cloud Tasks
  const payload = {
    classId,
    taskId,
    studentUid,
    attemptNumber,
    compiledVideoPath,
    rubricSteps,
    model,
  };

  try {
    const queue = getFunctions().taskQueue(`locations/${FUNCTION_REGION}/functions/evaluateTaskSubmissionTask`);
    const sanitizedTaskId = `eval-${taskId}-${studentUid}-att${attemptNumber}-${Date.now().toString(36)}`
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .slice(0, 100);

    await queue.enqueue(payload, { id: sanitizedTaskId });
    console.log(`[enqueueTaskEvaluation] Enqueued task evaluation: ${sanitizedTaskId}`);
    return { enqueued: true, taskId: sanitizedTaskId };
  } catch (queueErr) {
    console.warn('[enqueueTaskEvaluation] Cloud Tasks enqueue failed, executing directly in background:', queueErr.message);
    // Direct async execution fallback (for test runners, local emulators, or queue setup lag)
    handleEvaluateTaskSubmission(payload).catch((execErr) => {
      console.error('[enqueueTaskEvaluation] Fallback execution failed:', execErr);
    });
    return { enqueued: false, fallbackExecuted: true };
  }
};

/**
 * Cloud Tasks worker function with concurrency limits to prevent exhausting Gemini TPM/RPM quotas.
 */
export const evaluateTaskSubmissionTask = onTaskDispatched(
  {
    region: FUNCTION_REGION,
    retryConfig: {
      maxAttempts: 2,
    },
    rateLimits: {
      maxConcurrentDispatches: 3,
      maxDispatchesPerSecond: 1,
    },
    memory: '2GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const { classId, taskId, studentUid, attemptNumber, compiledVideoPath, rubricSteps, model } =
      request.data || {};
    return await handleEvaluateTaskSubmission({
      classId,
      taskId,
      studentUid,
      attemptNumber,
      compiledVideoPath,
      rubricSteps,
      model,
    });
  }
);

export const evaluateTaskSubmission = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    timeoutSeconds: 300,
    memory: '1GiB',
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const {
      classId,
      taskId,
      studentUid,
      attemptNumber = 1,
      compiledVideoPath,
      rubricSteps,
      model,
      sync = false,
    } = request.data || {};

    if (sync) {
      return await handleEvaluateTaskSubmission({
        classId,
        taskId,
        studentUid,
        attemptNumber,
        compiledVideoPath,
        rubricSteps,
        model,
      });
    }

    const enqueueResult = await enqueueTaskEvaluation({
      classId,
      taskId,
      studentUid,
      attemptNumber,
      compiledVideoPath,
      rubricSteps,
      model,
    });

    return {
      success: true,
      queued: true,
      ...enqueueResult,
    };
  }
);

