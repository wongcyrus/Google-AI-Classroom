import './firebase.js';
import { ai } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P } from './config.js';
import { sendMessageToStudent, recordImageIrregularity, recordVideoIrregularity, recordStudentProgress, sendMessageToTeacher, recordScreenshotAnalysis, recordActualWorkingTime, recordLessonFeedback, recordLessonSummary } from './aiTools.js';
import { checkQuota } from './quotaManagement.js';
import { estimateCost, calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';



function getToolsForImageAnalysis() {
  return [sendMessageToStudent, recordImageIrregularity, recordStudentProgress, sendMessageToTeacher, recordScreenshotAnalysis];
}

function getToolsForVideoAnalysis() {
  return [recordVideoIrregularity, recordStudentProgress, recordActualWorkingTime, recordLessonFeedback, recordLessonSummary];
}

export const analyzeImageFlow = ai.defineFlow(
  {
    name: 'analyzeImageFlow',
    inputSchema: z.object({
      screenshots: z.record(z.object({ url: z.string(), email: z.string() })),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt, classId }) => {
    const analysisResults = {};
    for (const [studentUid, { url, email }] of Object.entries(screenshots)) {
      const fullPrompt = [
        { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. The student UID is ${studentUid}. Analyze the screen to identify the current task (e.g., 'Question 5', 'Writing introduction'). Call the 'recordScreenshotAnalysis' tool with the identified task. Also, perform the original analysis based on the user's prompt: ${prompt}` },
        { media: { url } },
      ];
      const media = [{ media: { url } }];

      const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media);
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
        });
        analysisResults[studentUid] = 'Error: Insufficient quota.';
        continue;
      }

      try {
        const response = await ai.generate({
          temperature: AI_TEMPERATURE,
          topP: AI_TOP_P,
          prompt: fullPrompt,
          tools: getToolsForImageAnalysis(),
          maxToolRoundtrips: 10,
        });
        console.log('AI response usage:', response.usage);
        const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
        const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens });

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
    }),
    outputSchema: z.object({
      result: z.string(),
      jobId: z.string(),
    }),
  },
  async ({ videoUrl, prompt, classId, studentUid, studentEmail, masterJobId, startTime, endTime }) => {
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

    const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media);
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
        masterJobId,
      });
      return { result: 'Error: Insufficient quota.', jobId };
    }

    try {
      const tools = getToolsForVideoAnalysis();

      const response = await ai.generate({
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: tools,
        maxToolRoundtrips: 10,
      });
      console.log('AI response usage:', response.usage);
      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens });

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
    }),
    outputSchema: z.string(),
  },
  async ({ screenshots, prompt, classId }) => {
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

    const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
      await logJob({
        classId,
        jobType: 'analyzeAllImages',
        status: 'blocked-by-quota',
        promptText: fullPrompt.find(p => p.text)?.text,
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
      });
      return 'Error: Insufficient quota.';
    }

    try {
      const numScreenshots = Object.keys(screenshots).length;
      const maxToolRoundtrips = Math.max(5, numScreenshots * 3);

      const response = await ai.generate({
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: getToolsForImageAnalysis(),
        maxToolRoundtrips,
      });
      console.log('AI response usage:', response.usage);
      const usage = response.usage || { inputTokens: 0, outputTokens: 0 };
      const cost = calculateCost({ promptTokenCount: usage.inputTokens, candidatesTokenCount: usage.outputTokens });

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
        errorDetails: error.message,
      });
      return `Error: ${error.message}`;
    }
  }
);