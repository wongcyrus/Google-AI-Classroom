import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { logJob } from './jobLogger.js';
import { calculateCost } from './cost.js';

export const handleExtractTaskDemoSteps = async ({
  classId,
  demoVideoPath,
  promptGuidelines,
  promptText,
  maxScore = 100,
  model,
  auth,
}) => {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'The function must be called with a "classId".');
  }

  if (!demoVideoPath && !promptGuidelines && !promptText) {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with a "demoVideoPath" or rubric prompt guidelines.'
    );
  }

  const storage = getStorage();
  const bucketName = storage.bucket().name;

  const isYouTube = demoVideoPath
    ? /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([a-zA-Z0-9_-]{11})/i.test(demoVideoPath)
    : false;
  let resolvedVideoUri = null;
  if (demoVideoPath) {
    if (isYouTube || demoVideoPath.startsWith('http://') || demoVideoPath.startsWith('https://')) {
      resolvedVideoUri = demoVideoPath;
    } else if (demoVideoPath.startsWith('gs://')) {
      resolvedVideoUri = demoVideoPath;
    } else {
      resolvedVideoUri = `gs://${bucketName}/${demoVideoPath.replace(/^\/+/, '')}`;
    }
  }

  const targetMaxScore = Number(maxScore) || 100;
  const metaPrompt = `${promptText ? `${promptText}\n\n` : `You are an expert technical educator and curriculum designer creating a structured grading rubric for a hands-on practical assignment or lab test.

${demoVideoPath ? 'Analyze the visual actions, commands, code editor steps, browser verifications, and results shown in the demonstration video.' : 'Analyze the instructor guidelines and task requirements below.'}\n`}
${isYouTube ? `Reference YouTube Video: ${demoVideoPath}\n` : ''}
${promptGuidelines ? `Teacher's specific guidance & marking criteria:\n"${promptGuidelines}"\n` : ''}

Extract a structured, chronological step-by-step assessment rubric (between 3 and 8 distinct milestones).
For each milestone:
1. Provide a concise, clear title.
2. Describe the specific action or requirement (e.g. terminal command, file created, setting configured).
3. Specify the expected visual proof/evidence that an AI evaluator should search for in a student's screen recording (e.g. terminal output text, open ports, browser UI, green test checks).
4. Provide explicit marking / partial-credit criteria (how full marks vs. partial marks vs. 0 marks should be awarded).
5. Assign a point weight (total across all steps must equal ${targetMaxScore} points).

You MUST respond strictly with valid JSON conforming to this schema:
{
  "title": "A concise, descriptive title for this practical task",
  "description": "A clear 2-3 sentence overview of what the student is required to reproduce",
  "suggestedMaxScore": ${targetMaxScore},
  "steps": [
    {
      "stepNumber": 1,
      "title": "Short Step Title",
      "description": "Specific action performed by the student",
      "expectedEvidence": "Specific visual evidence, keywords, or UI elements on screen",
      "gradingCriteria": "Full marks if completed and verified; partial marks if configured with minor syntax errors",
      "points": 20
    }
  ]
}

Return ONLY the raw JSON object. Do not wrap in markdown code blocks (\`\`\`json).`;

  const preferredModel = model || 'gemini-3.8-flash';
  const promptParts = [{ text: metaPrompt }];
  if (resolvedVideoUri) {
    promptParts.push({ media: { url: resolvedVideoUri, contentType: 'video/mp4' } });
  }
  const generateConfig = {
    prompt: promptParts,
    config: {
      temperature: 0.2,
      responseMimeType: 'application/json',
    },
  };

  let response;
  let modelUsed;
  try {
    const res = await generateWithResilience(generateConfig, preferredModel);
    response = res.response;
    modelUsed = res.modelUsed;
  } catch (primaryErr) {
    if (isYouTube) {
      console.warn('[extractTaskDemoSteps] Multimodal direct URL failed for YouTube, retrying with contextual prompt:', primaryErr);
      const fallbackConfig = {
        prompt: [
          {
            text: `${metaPrompt}\n\n[Reference Video Location: ${demoVideoPath}]. Extract the expected demonstration milestones and rubric for this topic.`,
          },
        ],
        config: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      };
      const res = await generateWithResilience(fallbackConfig, preferredModel);
      response = res.response;
      modelUsed = res.modelUsed;
    } else {
      throw primaryErr;
    }
  }

  let rawText = response.text || '';
  if (rawText.startsWith('```json')) {
    rawText = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  } else if (rawText.startsWith('```')) {
    rawText = rawText.replace(/^```\s*/, '').replace(/```\s*$/i, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText.trim());
  } catch (err) {
    console.error('[extractTaskDemoSteps] JSON parse failed on AI model response:', err, 'Raw text:', rawText);
    throw new Error(`Failed to parse AI rubric response as JSON: ${err.message}. Raw output: ${rawText.slice(0, 200)}`);
  }

  if (Array.isArray(parsed)) {
    parsed = { steps: parsed };
  }
  if (Array.isArray(parsed?.steps)) {
    parsed.steps = parsed.steps.map((s, idx) => ({
      stepNumber: Number(s.stepNumber) || idx + 1,
      title: s.title || `Milestone ${idx + 1}`,
      description:
        s.description || (Array.isArray(s.criteria) ? s.criteria.join('; ') : s.criteria || ''),
      expectedEvidence: s.expectedEvidence || '',
      gradingCriteria: s.gradingCriteria || '',
      points: Number(s.points ?? s.weight ?? 20),
    }));
  }

  const usage = response?.usage || response?.usageMetadata || {};
  const cost = calculateCost(usage, modelUsed || preferredModel);

  if (classId && classId !== 'unknown_class') {
    try {
      await logJob({
        classId,
        jobType: 'extractTaskDemoSteps',
        status: 'completed',
        promptText: metaPrompt,
        mediaPaths: demoVideoPath ? [demoVideoPath] : [],
        usage: {
          inputTokens: usage.inputTokens ?? usage.promptTokenCount ?? 0,
          outputTokens: usage.outputTokens ?? usage.candidatesTokenCount ?? 0,
        },
        cost,
        modelUsed: modelUsed || preferredModel,
        result: JSON.stringify(parsed).substring(0, 300),
      });
    } catch (logErr) {
      console.warn('[extractTaskDemoSteps] Failed to log AI job:', logErr);
    }
  }

  return {
    ...parsed,
    modelUsed,
    cost,
  };
};

export const extractTaskDemoSteps = onCall(
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
    const { classId, demoVideoPath, promptGuidelines, promptText, maxScore, model } = request.data || {};
    return await handleExtractTaskDemoSteps({
      classId,
      demoVideoPath,
      promptGuidelines,
      promptText,
      maxScore,
      model,
      auth: request.auth,
    });
  }
);
