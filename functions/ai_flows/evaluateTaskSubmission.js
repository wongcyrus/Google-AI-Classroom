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

/**
 * Deterministically reconciles AI evaluation output against the task's rubricSteps.
 * Guarantees every rubric step has a corresponding stepResult with clamped scoreAwarded,
 * maxPoints, status, evidenceObserved, and detailed feedback explanation, and computes
 * finalScore from the sum of step scores.
 */
export const normalizeRubricEvaluation = (rawEvaluation = {}, effectiveSteps = [], maxScore = 100) => {
  const normalizedMaxScore = Number(maxScore) || 100;
  const rawSteps = Array.isArray(rawEvaluation.stepResults)
    ? rawEvaluation.stepResults
    : Array.isArray(rawEvaluation.rubricScores)
    ? rawEvaluation.rubricScores
    : [];

  let reconciledSteps = [];

  if (Array.isArray(effectiveSteps) && effectiveSteps.length > 0) {
    const defaultStepPoints = Math.round(normalizedMaxScore / effectiveSteps.length);
    reconciledSteps = effectiveSteps.map((rubricStep, idx) => {
      const stepNum = Number(rubricStep.stepNumber ?? idx + 1);
      const maxPoints = Number(rubricStep.points ?? rubricStep.weight ?? defaultStepPoints) || 0;
      const stepTitle = rubricStep.title || rubricStep.criterion || `Step ${stepNum}`;

      const matched =
        rawSteps.find((s) => Number(s?.stepNumber) === stepNum) ||
        rawSteps.find(
          (s) =>
            s?.title &&
            stepTitle &&
            String(s.title).trim().toLowerCase() === String(stepTitle).trim().toLowerCase()
        ) ||
        rawSteps.find(
          (s) =>
            s?.criterion &&
            stepTitle &&
            String(s.criterion).trim().toLowerCase() === String(stepTitle).trim().toLowerCase()
        ) ||
        rawSteps[idx] ||
        null;

      if (matched) {
        const rawScore = Number(
          matched.scoreAwarded ??
            matched.score ??
            (matched.status === 'completed' ? maxPoints : 0)
        );
        const scoreAwarded = Math.max(
          0,
          Math.min(maxPoints, Number.isFinite(rawScore) ? Math.round(rawScore * 100) / 100 : 0)
        );
        const status =
          matched.status ||
          (scoreAwarded >= maxPoints && maxPoints > 0
            ? 'completed'
            : scoreAwarded > 0
            ? 'partial'
            : 'missing');

        return {
          stepNumber: stepNum,
          title: stepTitle,
          maxPoints,
          scoreAwarded,
          status,
          timestampInVideo: matched.timestampInVideo || matched.timestamp || null,
          evidenceObserved: matched.evidenceObserved || matched.evidence || '',
          feedback:
            matched.feedback ||
            matched.rationale ||
            matched.explanation ||
            (status === 'completed'
              ? `Completed all requirements for ${stepTitle}.`
              : `Incomplete or missing requirements for ${stepTitle}.`),
          expectedEvidence: rubricStep.expectedEvidence || '',
          gradingCriteria: rubricStep.gradingCriteria || '',
        };
      }

      return {
        stepNumber: stepNum,
        title: stepTitle,
        maxPoints,
        scoreAwarded: 0,
        status: 'missing',
        timestampInVideo: null,
        evidenceObserved: 'Not observed in submission recording.',
        feedback: `No evidence of "${stepTitle}" was observed in the submitted screen recording.`,
        expectedEvidence: rubricStep.expectedEvidence || '',
        gradingCriteria: rubricStep.gradingCriteria || '',
      };
    });
  } else if (rawSteps.length > 0) {
    reconciledSteps = rawSteps.map((s, idx) => {
      const stepNum = Number(s.stepNumber ?? idx + 1);
      const maxPoints = Number(s.maxPoints ?? s.points ?? s.weight ?? 0);
      const rawScore = Number(s.scoreAwarded ?? s.score ?? 0);
      const scoreAwarded =
        maxPoints > 0
          ? Math.max(0, Math.min(maxPoints, Number.isFinite(rawScore) ? rawScore : 0))
          : Math.max(0, Number.isFinite(rawScore) ? rawScore : 0);
      return {
        stepNumber: stepNum,
        title: s.title || s.criterion || `Step ${stepNum}`,
        maxPoints,
        scoreAwarded,
        status:
          s.status ||
          (maxPoints > 0 && scoreAwarded >= maxPoints
            ? 'completed'
            : scoreAwarded > 0
            ? 'partial'
            : 'missing'),
        timestampInVideo: s.timestampInVideo || s.timestamp || null,
        evidenceObserved: s.evidenceObserved || s.evidence || '',
        feedback: s.feedback || s.rationale || s.explanation || '',
      };
    });
  }

  let computedFinalScore;
  if (reconciledSteps.length > 0 && (rawSteps.length > 0 || typeof rawEvaluation.finalScore !== 'number')) {
    const sum = reconciledSteps.reduce((acc, s) => acc + (Number(s.scoreAwarded) || 0), 0);
    computedFinalScore = Math.max(0, Math.min(normalizedMaxScore, Math.round(sum * 100) / 100));
  } else if (typeof rawEvaluation.finalScore === 'number') {
    computedFinalScore = Math.max(0, Math.min(normalizedMaxScore, rawEvaluation.finalScore));
  } else {
    computedFinalScore = 0;
  }

  const completionPercentage =
    typeof rawEvaluation.completionPercentage === 'number' && reconciledSteps.length === 0
      ? rawEvaluation.completionPercentage
      : Math.round((computedFinalScore / normalizedMaxScore) * 100);

  return {
    ...rawEvaluation,
    finalScore: computedFinalScore,
    maxScore: normalizedMaxScore,
    completionPercentage,
    overallSummary:
      rawEvaluation.overallSummary ||
      rawEvaluation.overallFeedback ||
      'Evaluation completed against task rubric milestones.',
    stepResults: reconciledSteps,
    strengths: Array.isArray(rawEvaluation.strengths) ? rawEvaluation.strengths : [],
    deviationsOrErrors: Array.isArray(rawEvaluation.deviationsOrErrors)
      ? rawEvaluation.deviationsOrErrors
      : [],
  };
};

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

  // 2. Resolve Video Path (check attempt/submission doc if compiledVideoPath not explicitly provided)
  const submissionRef = taskRef.collection('submissions').doc(studentUid);
  const attemptRef = submissionRef.collection('attempts').doc(String(attemptNumber));

  let resolvedVideoPath = compiledVideoPath;
  if (!resolvedVideoPath) {
    try {
      if (typeof attemptRef.get === 'function') {
        const attSnap = await attemptRef.get();
        if (attSnap?.exists) {
          resolvedVideoPath = attSnap.data()?.compiledVideoPath || attSnap.data()?.videoPath || null;
        }
      }
      if (!resolvedVideoPath && typeof submissionRef.get === 'function') {
        const subSnap = await submissionRef.get();
        if (subSnap?.exists) {
          const subData = subSnap.data() || {};
          resolvedVideoPath =
            subData.compiledVideoPath ||
            subData.latestAttempt?.compiledVideoPath ||
            subData.videoPath ||
            null;
        }
      }
    } catch {
      // Fall back to default convention path
    }
  }

  const storage = getStorage();
  const bucketName = storage.bucket().name;
  const effectiveVideoPath =
    resolvedVideoPath ||
    `classes/${classId}/tasks/${taskId}/submissions/${studentUid}/attempt_${attemptNumber}.mp4`;
  const gcsUri = effectiveVideoPath.startsWith('gs://')
    ? effectiveVideoPath
    : `gs://${bucketName}/${effectiveVideoPath.replace(/^\/+/, '')}`;

  const rawCustomPrompt = (taskData.selectedPromptText || '').trim();
  const resolvedCustomPrompt = rawCustomPrompt
    .replace(/\{\{taskDescription\}\}/g, `${taskData.title || ''}: ${taskData.description || ''}`)
    .replace(/\{\{demoSteps\}\}/g, JSON.stringify(effectiveSteps, null, 2));
  const customGuidelines = (taskData.promptGuidelines || '').trim();

  const customPromptSection =
    resolvedCustomPrompt || customGuidelines
      ? `\n=== TEACHER CUSTOM EVALUATION PROMPT & GRADING GUIDELINES ===
${resolvedCustomPrompt ? `Custom Evaluation Template:\n${resolvedCustomPrompt}\n` : ''}${
          customGuidelines ? `Additional Teacher Marking Notes:\n${customGuidelines}\n` : ''
        }`
      : '';

  const promptText = `You are an expert technical invigilator and automated practical exam evaluator.
Evaluate the student's continuous screen recording time-lapse video strictly against the following practical assignment rubric.

=== ASSIGNMENT DETAILS ===
Title: "${taskData.title || 'Practical Lab Task'}"
Overview: "${taskData.description || 'Complete the designated lab instructions'}"
Total Possible Score: ${maxScore} points
${customPromptSection}
=== REQUIRED RUBRIC MILESTONES (STRICT MARK BREAKDOWN) ===
${JSON.stringify(effectiveSteps, null, 2)}

=== INSTRUCTIONS FOR RUBRIC-DRIVEN EVALUATION ===
1. Watch the student's screen actions chronologically from start to finish.
2. You MUST evaluate EVERY SINGLE milestone listed in REQUIRED RUBRIC MILESTONES above in exact order:
   - Determine whether the step was "completed", "partial", "error", or "missing".
   - Record the approximate "mm:ss" timestamp ("timestampInVideo") where the step was attempted or completed (or null if missing).
   - Describe the concrete visual proof observed on the student's screen ("evidenceObserved", e.g., terminal command output, code written, browser state, or what was missing).
   - Award marks ("scoreAwarded") strictly between 0 and the step's allocated "points" ("maxPoints") based on the step's "expectedEvidence" and "gradingCriteria".
   - Provide a clear, detailed per-step explanation ("feedback") for the student and teacher explaining WHY those exact marks were awarded or deducted according to the rubric.
3. Highlight 2-3 specific technical strengths demonstrated by this student in the video.
4. Highlight any errors, warnings, configuration oversights, or suspicious anomalies (e.g. abrupt paste of whole codebase, unhandled exceptions).
5. Calculate "finalScore" as the exact sum of "scoreAwarded" across all rubric steps (out of ${maxScore}).

Respond strictly with valid JSON conforming to this schema:
{
  "finalScore": 85,
  "maxScore": ${maxScore},
  "completionPercentage": 85,
  "overallSummary": "Concise 2-3 sentence assessment of the student's overall performance and mark breakdown rationale",
  "stepResults": [
    {
      "stepNumber": 1,
      "title": "Step Title",
      "maxPoints": 20,
      "scoreAwarded": 20,
      "status": "completed",
      "timestampInVideo": "02:15",
      "evidenceObserved": "Terminal showed 'Server listening on port 5000' after running npm start",
      "feedback": "Full marks (20/20): Student configured the server and verified the listening port as required by the rubric."
    }
  ],
  "strengths": ["Strengths observation 1", "Strengths observation 2"],
  "deviationsOrErrors": ["Error or warning observation"]
}

Return ONLY raw JSON. Do not wrap in markdown code fence blocks (\`\`\`json).`;

  const preferredModel = model || 'gemini-3.8-flash';
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
  let isEvaluationFailed = false;
  try {
    const parsedEvaluation = JSON.parse(rawText.trim());
    evaluation = normalizeRubricEvaluation(parsedEvaluation, effectiveSteps, maxScore);
  } catch (err) {
    console.error('[evaluateTaskSubmission] JSON parse failed on AI response:', err, 'Raw text:', rawText);
    isEvaluationFailed = true;
    evaluation = {
      finalScore: null,
      maxScore,
      status: 'evaluation_failed',
      error: `Failed to parse AI evaluation response: ${err.message}`,
      rawOutput: rawText.slice(0, 500),
      overallSummary: 'Automated evaluation could not parse a structured response. Manual review required.',
      stepResults: [],
      strengths: [],
      deviationsOrErrors: ['Model returned non-JSON output.'],
    };
  }

  evaluation.evaluatedAt = new Date();
  evaluation.model = modelUsed || preferredModel;

  // 3. Update Firestore Attempt Record
  await attemptRef.set(
    {
      evaluation,
      status: isEvaluationFailed ? 'evaluation_failed' : 'evaluated',
      finishedAt: new Date(),
    },
    { merge: true }
  );

  // 4. Update Root Submission Document
  const attemptsSnap = await submissionRef.collection('attempts').get();

  const attemptScoreMap = new Map();
  if (!isEvaluationFailed && typeof evaluation.finalScore === 'number') {
    attemptScoreMap.set(Number(attemptNumber) || 1, evaluation.finalScore);
  }

  attemptsSnap.forEach((doc) => {
    const data = doc.data();
    const attNum = Number(data.attemptNumber || parseInt(doc.id, 10)) || 1;
    const score = data.evaluation?.finalScore;
    if (typeof score === 'number' && (!data.status || data.status === 'evaluated')) {
      attemptScoreMap.set(attNum, score);
    }
  });

  const sortedAttempts = Array.from(attemptScoreMap.entries()).sort((a, b) => a[0] - b[0]);
  const hasEvaluatedAttempt = sortedAttempts.length > 0;

  let bestScore = null;
  let latestScore = null;
  let averageScore = null;
  let highestAttempt = attemptNumber;

  if (hasEvaluatedAttempt) {
    let sum = 0;
    for (const [attNum, score] of sortedAttempts) {
      sum += score;
      if (bestScore === null || score > bestScore) {
        bestScore = score;
        highestAttempt = attNum;
      }
      latestScore = score;
    }
    averageScore = Math.round(sum / sortedAttempts.length);
  }

  const scoringStrategy = taskData.constraints?.attempts?.scoringStrategy || 'highest';
  const effectiveScore =
    scoringStrategy === 'latest'
      ? latestScore
      : scoringStrategy === 'average'
      ? averageScore
      : bestScore;

  await submissionRef.set(
    {
      status: hasEvaluatedAttempt ? 'evaluated' : 'evaluation_failed',
      effectiveScore: effectiveScore ?? 0,
      bestScore: bestScore ?? 0,
      latestScore: latestScore ?? 0,
      averageScore: averageScore ?? 0,
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
      status: isEvaluationFailed ? 'failed' : 'completed',
      promptText,
      mediaPaths: [effectiveVideoPath],
      usage: {
        inputTokens: usage.inputTokens ?? usage.promptTokenCount ?? 0,
        outputTokens: usage.outputTokens ?? usage.candidatesTokenCount ?? 0,
      },
      cost,
      modelUsed: modelUsed || preferredModel,
      result: isEvaluationFailed
        ? 'Evaluation failed to parse AI model output'
        : `Score: ${evaluation.finalScore}/${maxScore}. Steps completed: ${
            evaluation.stepResults?.filter((s) => s.status === 'completed').length || 0
          }/${effectiveSteps.length}`,
    });
  } catch (logErr) {
    console.warn('[evaluateTaskSubmission] Failed to log AI job:', logErr);
  }

  return {
    success: !isEvaluationFailed,
    status: isEvaluationFailed ? 'evaluation_failed' : 'evaluated',
    evaluation,
    effectiveScore: effectiveScore ?? 0,
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

