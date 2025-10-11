import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { formatInTimeZone } from 'date-fns-tz';
import { ai } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P } from './config.js';
import { sendMessageToStudent, recordIrregularity, recordStudentProgress, sendMessageToTeacher } from './aiTools.js';
import { checkQuota } from './quotaManagement.js';
import { estimateCost, calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();

function getTools() {
  return [sendMessageToStudent, recordIrregularity, recordStudentProgress, sendMessageToTeacher];
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
  async ({ screenshots, prompt, classId }, _context) => {
    const analysisResults = {};
    for (const [studentUid, { url, email }] of Object.entries(screenshots)) {
      const fullPrompt = [
        { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. The student UID is ${studentUid}. ${prompt}` },
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
          tools: getTools(),
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
      startTime: z.any(),
      endTime: z.any(),
    }),
    outputSchema: z.object({
      result: z.string(),
      jobId: z.string(),
    }),
  },
  async ({ videoUrl, prompt, classId, studentUid, studentEmail, masterJobId, startTime, endTime }) => {
    const classRef = db.collection('classes').doc(classId);
    const classDoc = await classRef.get();
    const timezone = classDoc.exists ? classDoc.data().schedule?.timeZone || 'UTC' : 'UTC';

    const startDate = startTime ? formatInTimeZone(startTime.toDate(), timezone, 'yyyy-MM-dd HH:mm:ss zzz') : 'N/A';
    const endDate = endTime ? formatInTimeZone(endTime.toDate(), timezone, 'yyyy-MM-dd HH:mm:ss zzz') : 'N/A';

    const promptText = `The following video is from a student.
Email: ${studentEmail}
Student UID: ${studentUid}
Class ID: ${classId}
The video was recorded between ${startDate} and ${endDate}.
Please analyze the video based on the user's prompt: "${prompt}"
If you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

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
        mediaPaths: media.map(m => m.media.url),
        cost: 0,
        masterJobId,
      });
      return { result: 'Error: Insufficient quota.', jobId };
    }

    try {
      const response = await ai.generate({
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: fullPrompt,
        tools: getTools(),
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
  async ({ screenshots, prompt, classId }, _context) => {
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
        tools: getTools(),
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