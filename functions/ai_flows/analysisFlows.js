import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { ai, vertexAI } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P, AI_MODEL, AI_TRANSCRIBE_MODEL } from './config.js';
import { sendMessageToStudent, recordIrregularity, recordVideoIrregularity, recordStudentProgress, sendMessageToTeacher, recordScreenshotAnalysis, recordActualWorkingTime, recordLessonFeedback, recordLessonSummary, recordAudioIrregularity, recordAudioAudit } from './aiTools.js';
import { checkQuota } from './quotaManagement.js';
import { estimateCost, calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();

function getToolsForImageAnalysis() {
  return [sendMessageToStudent, recordIrregularity, recordStudentProgress, sendMessageToTeacher, recordScreenshotAnalysis];
}

function getToolsForVideoAnalysis() {
  return [recordVideoIrregularity, recordStudentProgress, recordActualWorkingTime, recordLessonFeedback, recordLessonSummary];
}

function getToolsForAudioAnalysis() {
  return [recordAudioIrregularity, recordAudioAudit, sendMessageToStudent, sendMessageToTeacher];
}

export const analyzeImageFlow = ai.defineFlow(
  {
    name: 'analyzeImageFlow',
    inputSchema: z.object({
      screenshots: z.record(z.object({ url: z.string(), email: z.string() })),
      prompt: z.string(),
      classId: z.string(),
      model: z.string().optional(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt, classId, model }) => {
    const activeModel = model || AI_MODEL;
    const analysisResults = {};
    for (const [studentUid, { url, email }] of Object.entries(screenshots)) {
      const fullPrompt = [
        { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. The student UID is ${studentUid}. Analyze the screen to identify the current task (e.g., 'Question 5', 'Writing introduction'). Call the 'recordScreenshotAnalysis' tool with the identified task. Also, perform the original analysis based on the user's prompt: ${prompt}` },
        { media: { url } },
      ];
      const media = [{ media: { url } }];

      const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media, activeModel);
      const hasQuota = await checkQuota(classId, estimatedCost);

      if (!hasQuota) {
        await logJob({
          classId,
          studentUid,
          studentEmail: email,
          jobType: 'analyzeImage',
          status: 'blocked-by-quota',
          promptText: fullPrompt.find(p => p.text)?.text,
          mediaPaths: media.map(m => m.media.url),
          cost: 0,
          modelUsed: activeModel,
        });
        analysisResults[studentUid] = 'Error: Insufficient quota.';
        continue;
      }

      try {
        const response = await ai.generate({
          model: vertexAI.model(activeModel),
          temperature: AI_TEMPERATURE,
          topP: AI_TOP_P,
          prompt: fullPrompt,
          tools: getToolsForImageAnalysis(),
          maxToolRoundtrips: 10,
        });
        console.log(`AI response usage (${activeModel}):`, response.usage);
        const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
        const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens }, activeModel);

        await logJob({
          classId,
          studentUid,
          studentEmail: email,
          jobType: 'analyzeImage',
          status: 'completed',
          promptText: fullPrompt.find(p => p.text)?.text,
          mediaPaths: media.map(m => m.media.url),
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
          },
          cost,
          modelUsed: activeModel,
          result: response.text,
        });
        analysisResults[studentUid] = response.text;
      } catch (error) {
        await logJob({
          classId,
          studentUid,
          studentEmail: email,
          jobType: 'analyzeImage',
          status: 'failed',
          promptText: fullPrompt.find(p => p.text)?.text,
          mediaPaths: media.map(m => m.media.url),
          cost: 0,
          modelUsed: activeModel,
          errorDetails: error.message,
        });
        analysisResults[studentUid] = `Error: ${error.message}`;
      }
    }
    return analysisResults;
  }
);

export const analyzeSingleVideoFlow = ai.defineFlow(
  {
    name: 'analyzeSingleVideoFlow',
    inputSchema: z.object({
      videoUrl: z.string(),
      prompt: z.string(),
      classId: z.string(),
      studentUid: z.string(),
      studentEmail: z.string(),
      masterJobId: z.string().optional(),
      startTime: z.string({ description: "The start time of the class in ISO 8601 format." }),
      endTime: z.string({ description: "The end time of the class in ISO 8601 format." }),
      model: z.string().optional(),
    }),
    outputSchema: z.object({
      result: z.string(),
      jobId: z.string(),
    }),
  },
  async ({ videoUrl, prompt, classId, studentUid, studentEmail, masterJobId, startTime, endTime, model }) => {
    const activeModel = model || AI_MODEL;
    const startDate = new Date(startTime);
    const endDate = new Date(endTime);

    const promptText = `You are analyzing a video for a student.\nStudent Email: ${studentEmail}\nStudent UID: ${studentUid}\nClass ID: ${classId}\nLesson Start Time: ${startDate.toISOString()}\nLesson End Time: ${endDate.toISOString()}\n\nPlease analyze the video based on the user's prompt: "${prompt}"\n\nWhen you need to record information about the lesson, use the provided 'Lesson Start Time' and 'Lesson End Time' for the 'startTime' and 'endTime' parameters of the tools.\nIf you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

    const crypto = await import('crypto');
    const promptHash = crypto.createHash('sha256').update(promptText).digest('hex');

    const fullPrompt = [
      { media: { url: videoUrl, contentType: 'video/mp4' } },
      { text: promptText },
    ];
    const media = [{ media: { url: videoUrl, contentType: 'video/mp4' } }];

    const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media, activeModel);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
      const jobId = await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeSingleVideo',
        status: 'blocked-by-quota',
        promptText: fullPrompt.find(p => p.text)?.text,
        promptHash,
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
        modelUsed: activeModel,
        masterJobId,
      });
      return { result: 'Error: Insufficient quota.', jobId };
    }

    try {
      const tools = getToolsForVideoAnalysis();

      const response = await ai.generate({
        model: vertexAI.model(activeModel),
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: tools,
        maxToolRoundtrips: 10,
      });
      console.log(`AI video response usage (${activeModel}):`, response.usage);
      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens }, activeModel);

      const jobId = await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeSingleVideo',
        status: 'completed',
        promptText: fullPrompt.find(p => p.text)?.text,
        promptHash,
        mediaPaths: media.map(m => m.media.url),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        cost,
        modelUsed: activeModel,
        result: response.text,
        masterJobId,
      });
      return { result: response.text, jobId };
    } catch (error) {
      const jobId = await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeSingleVideo',
        status: 'failed',
        promptText: fullPrompt.find(p => p.text)?.text,
        promptHash,
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
        modelUsed: activeModel,
        errorDetails: error.message,
        masterJobId,
      });
      return { result: `Error: ${error.message}`, jobId };
    }
  }
);

export const analyzeAllImagesFlow = ai.defineFlow(
  {
    name: 'analyzeAllImagesFlow',
    inputSchema: z.object({
      screenshots: z.record(z.object({ url: z.string(), email: z.string() })),
      prompt: z.string(),
      classId: z.string(),
      model: z.string().optional(),
    }),
    outputSchema: z.string(),
  },
  async ({ screenshots, prompt, classId, model }) => {
    const activeModel = model || AI_MODEL;
    const imageParts = Object.entries(screenshots).flatMap(([studentUid, { url, email }]) => (
      [
        { text: `The following image is the screen shot from ${email} (student UID: ${studentUid}, image URL: ${url}):` },
        { media: { url } },
      ]
    ));

    const fullPrompt = [
      ...imageParts,
      { text: `The class ID is ${classId}. ${prompt}` },
    ];

    const media = Object.values(screenshots).map(s => ({ media: { url: s.url } }));

    const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media, activeModel);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
      await logJob({
        classId,
        jobType: 'analyzeAllImages',
        status: 'blocked-by-quota',
        promptText: fullPrompt.find(p => p.text)?.text,
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
        modelUsed: activeModel,
      });
      return 'Error: Insufficient quota.';
    }

    try {
      const numScreenshots = Object.keys(screenshots).length;
      const maxToolRoundtrips = Math.max(5, numScreenshots * 3);

      const response = await ai.generate({
        model: vertexAI.model(activeModel),
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: getToolsForImageAnalysis(),
        maxToolRoundtrips,
      });
      console.log(`AI all-images response usage (${activeModel}):`, response.usage);
      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens }, activeModel);

      await logJob({
        classId,
        jobType: 'analyzeAllImages',
        status: 'completed',
        promptText: fullPrompt.find(p => p.text)?.text,
        mediaPaths: media.map(m => m.media.url),
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        cost,
        modelUsed: activeModel,
        result: response.text,
      });

      return response.text;
    } catch (error) {
      await logJob({
        classId,
        jobType: 'analyzeAllImages',
        status: 'failed',
        promptText: fullPrompt.find(p => p.text)?.text,
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
        modelUsed: activeModel,
        errorDetails: error.message,
      });
      return `Error: ${error.message}`;
    }
  }
);

export const analyzeFaceFallbackFlow = ai.defineFlow(
  {
    name: 'analyzeFaceFallbackFlow',
    inputSchema: z.object({
      classId: z.string(),
      studentUid: z.string(),
      studentEmail: z.string(),
      webcamUrl: z.string(),
      screenUrl: z.string().optional(),
      model: z.string().optional(),
    }),
    outputSchema: z.object({
      faceStatus: z.string(),
      confidence: z.number().optional(),
      reason: z.string().optional(),
      cost: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  async ({ classId, studentUid, studentEmail, webcamUrl, screenUrl, model }) => {
    const classDoc = await db.collection('classes').doc(classId).get();
    if (!classDoc.exists) {
      return { faceStatus: 'error', error: `Class ${classId} does not exist.` };
    }
    const classData = classDoc.data();
    if (!classData.enableCloudFallback) {
      return {
        faceStatus: 'disabled',
        reason: 'Cloud Fallback is disabled by the teacher for this class.',
      };
    }

    const activeModel = model || classData.aiModel || AI_MODEL;
    const media = [{ media: { url: webcamUrl } }];
    const promptText = `Analyze this classroom invigilation webcam photo of student ${studentEmail} (UID: ${studentUid}, class: ${classId}).
Determine the student's face presence and gaze orientation.
Rules:
1. Is there a human face present? If no face is visible, status is 'no_face'.
2. Are multiple faces present? If more than 1 person is in frame, status is 'multiple_faces'.
3. Is the student looking forward/centered at their computer screen? If their head or gaze is turned significantly away (left, right, looking at another device, looking away from exam), status is 'looking_away'.
4. If the student is sitting normally facing their screen/work, status is 'normal'.

Respond ONLY with valid JSON in this exact structure:
{
  "faceStatus": "normal" | "looking_away" | "no_face" | "multiple_faces",
  "confidence": 0.95,
  "reason": "Brief explanation"
}`;

    const fullPrompt = [
      { text: promptText },
      { media: { url: webcamUrl } }
    ];

    const estimatedCost = estimateCost(promptText, media, activeModel);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'cloudFallbackFaceAnalysis',
        status: 'blocked-by-quota',
        promptText,
        mediaPaths: [webcamUrl],
        cost: 0,
        modelUsed: activeModel,
      });
      return { faceStatus: 'quota_exceeded', error: 'Insufficient AI Quota.' };
    }

    try {
      const response = await ai.generate({
        model: vertexAI.model(activeModel),
        temperature: 0.1,
        topP: 0.9,
        prompt: fullPrompt,
      });

      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens }, activeModel);

      let parsed = { faceStatus: 'normal', confidence: 1.0, reason: 'OK' };
      try {
        const text = response.text.trim().replace(/^```json\s*/i, '').replace(/\s*```$/i, '');
        parsed = JSON.parse(text);
      } catch (parseErr) {
        console.warn("Could not parse JSON response from Gemini, text:", response.text);
        if (response.text.toLowerCase().includes('looking_away') || response.text.toLowerCase().includes('looking away')) {
          parsed = { faceStatus: 'looking_away', confidence: 0.8, reason: response.text };
        } else if (response.text.toLowerCase().includes('no_face') || response.text.toLowerCase().includes('no face')) {
          parsed = { faceStatus: 'no_face', confidence: 0.8, reason: response.text };
        } else if (response.text.toLowerCase().includes('multiple')) {
          parsed = { faceStatus: 'multiple_faces', confidence: 0.8, reason: response.text };
        }
      }

      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'cloudFallbackFaceAnalysis',
        status: 'completed',
        promptText,
        mediaPaths: [webcamUrl],
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        cost,
        modelUsed: activeModel,
        result: JSON.stringify(parsed),
      });

      return {
        faceStatus: parsed.faceStatus || 'normal',
        confidence: parsed.confidence || 1.0,
        reason: parsed.reason || '',
        cost,
      };
    } catch (error) {
      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'cloudFallbackFaceAnalysis',
        status: 'failed',
        promptText,
        mediaPaths: [webcamUrl],
        cost: 0,
        modelUsed: activeModel,
        errorDetails: error.message,
      });
      return { faceStatus: 'error', error: error.message };
    }
  }
);

export const analyzeAudioFlow = ai.defineFlow(
  {
    name: 'analyzeAudioFlow',
    inputSchema: z.object({
      audioUrl: z.string().describe('URL or storage path of the audio recording'),
      classId: z.string(),
      studentUid: z.string(),
      studentEmail: z.string().optional(),
      prompt: z.string().optional(),
      model: z.string().optional(),
      diarization: z.boolean().optional().default(true),
    }),
    outputSchema: z.object({
      transcript: z.string().optional(),
      cost: z.number().optional(),
      error: z.string().optional(),
    }),
  },
  async ({ audioUrl, classId, studentUid, studentEmail = '', prompt = '', model, diarization = true }) => {
    const activeModel = model || AI_TRANSCRIBE_MODEL;
    const defaultPromptText = `You are an AI Classroom invigilator analyzing student audio recording.
Audio Source: ${audioUrl}. Class ID: ${classId}. Student UID: ${studentUid}. Student Email: ${studentEmail}.
Instructions:
1. Transcribe the audio recording with speaker diarization (e.g., Speaker 1, Speaker 2).
2. Detect if there are multiple distinct speakers or unauthorized whispering/collaboration.
3. If suspicious multi-speaker discussion, unauthorized talking, or exam answer recitation is detected, call the 'recordAudioIrregularity' tool with title, message, risk level ('low', 'medium', 'high'), and timestamp offsets.
4. Call the 'recordAudioAudit' tool with the complete transcript, speakerCount, summary, and verdict ('clean_exam', 'suspicious_collaboration', 'whisper_detected', 'background_noise', 'inconclusive').
${prompt ? `Additional custom instructions: ${prompt}` : ''}`;

    const fullPrompt = [
      { text: defaultPromptText },
      { media: { url: audioUrl } },
    ];
    const media = [{ media: { url: audioUrl } }];

    const estimatedCost = estimateCost(defaultPromptText, media, activeModel);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeAudio',
        status: 'blocked-by-quota',
        promptText: defaultPromptText,
        mediaPaths: [audioUrl],
        cost: 0,
        modelUsed: activeModel,
      });
      return { error: 'Insufficient quota.' };
    }

    try {
      const response = await ai.generate({
        model: vertexAI.model(activeModel),
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: getToolsForAudioAnalysis(),
        maxToolRoundtrips: 10,
      });

      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens }, activeModel);

      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeAudio',
        status: 'completed',
        promptText: defaultPromptText,
        mediaPaths: [audioUrl],
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
        },
        cost,
        modelUsed: activeModel,
        result: response.text,
      });

      return {
        transcript: response.text,
        cost,
      };
    } catch (error) {
      console.error('Error in analyzeAudioFlow:', error);
      await logJob({
        classId,
        studentUid,
        studentEmail,
        jobType: 'analyzeAudio',
        status: 'failed',
        promptText: defaultPromptText,
        mediaPaths: [audioUrl],
        cost: 0,
        modelUsed: activeModel,
        errorDetails: error.message,
      });
      return { error: error.message };
    }
  }
);