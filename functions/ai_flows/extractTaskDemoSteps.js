import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { logJob } from './jobLogger.js';
import { calculateCost } from './cost.js';

export const handleExtractTaskDemoSteps = async ({ classId, demoVideoPath, promptGuidelines, promptText, model, auth }) => {
  if (!classId) {
    throw new HttpsError('invalid-argument', 'The function must be called with a "classId".');
  }

  if (!demoVideoPath) {
    throw new HttpsError('invalid-argument', 'The function must be called with a "demoVideoPath".');
  }

  const storage = getStorage();
  const bucketName = storage.bucket().name;

  const isYouTube = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([a-zA-Z0-9_-]{11})/i.test(demoVideoPath);
  let resolvedVideoUri;
  if (isYouTube || demoVideoPath.startsWith('http://') || demoVideoPath.startsWith('https://')) {
    resolvedVideoUri = demoVideoPath;
  } else if (demoVideoPath.startsWith('gs://')) {
    resolvedVideoUri = demoVideoPath;
  } else {
    resolvedVideoUri = `gs://${bucketName}/${demoVideoPath.replace(/^\/+/, '')}`;
  }

  const metaPrompt = `${promptText ? `${promptText}\n\n` : `You are an expert technical educator and curriculum designer analyzing a teacher's reference demonstration video for a hands-on practical assignment or lab test.

Analyze the visual actions, commands, code editor steps, browser verifications, and results shown in the demonstration video.\n`}
${isYouTube ? `Reference YouTube Video: ${demoVideoPath}\n` : ''}
${promptGuidelines ? `Teacher's specific guidance:\n"${promptGuidelines}"\n` : ''}

Extract a structured, chronological step-by-step assessment rubric (between 3 and 8 distinct milestones).
For each milestone:
1. Provide a concise, clear title.
2. Describe the specific action performed (e.g. terminal command, file created, setting configured).
3. Specify the expected visual proof/evidence that an AI evaluator should search for in a student's screen recording (e.g. terminal output text, open ports, browser UI, green test checks).
4. Assign a suggested point weight (total across all steps must equal 100 points).

You MUST respond strictly with valid JSON conforming to this schema:
{
  "title": "A concise, descriptive title for this practical task",
  "description": "A clear 2-3 sentence overview of what the student is required to reproduce",
  "suggestedMaxScore": 100,
  "steps": [
    {
      "stepNumber": 1,
      "title": "Short Step Title",
      "description": "Specific action performed by the instructor",
      "expectedEvidence": "Specific visual evidence, keywords, or UI elements on screen",
      "points": 20
    }
  ]
}

Return ONLY the raw JSON object. Do not wrap in markdown code blocks (\`\`\`json).`;

  const preferredModel = model || 'gemini-3.8-flash';
  const generateConfig = {
    prompt: [
      { text: metaPrompt },
      { media: { url: resolvedVideoUri, contentType: 'video/mp4' } },
    ],
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
    console.warn('[extractTaskDemoSteps] JSON parse failed, falling back to basic extraction:', err);
    parsed = {
      title: 'Practical Lab Task',
      description: 'Reproduce the demonstration shown in the reference video.',
      suggestedMaxScore: 100,
      steps: [
        {
          stepNumber: 1,
          title: 'Initial Setup and Execution',
          description: 'Follow the steps demonstrated in the reference video.',
          expectedEvidence: 'Screen activity matching teacher demonstration.',
          points: 100,
        },
      ],
    };
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
        mediaPaths: [demoVideoPath],
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
    const { classId, demoVideoPath, promptGuidelines, promptText, model } = request.data || {};
    return await handleExtractTaskDemoSteps({
      classId,
      demoVideoPath,
      promptGuidelines,
      promptText,
      model,
      auth: request.auth,
    });
  }
);
