import './firebase.js';
import { ai } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P } from './config.js';
import { sendMessageTool, recordIrregularity, recordStudentProgress, sendMessageToTeacher } from './tools.js';
import { checkQuota } from './quota.js';
import { estimateCost, calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

function getTools() {
  return [sendMessageTool, recordIrregularity, recordStudentProgress, sendMessageToTeacher];
}

export const analyzeImageFlow = ai.defineFlow(
  {
    name: 'analyzeImageFlow',
    inputSchema: z.object({
      screenshots: z.record(z.string()),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt, classId }, context) => {
    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
        const fullPrompt = [
            { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. ${prompt}` },
            { media: { url } },
        ];
        const media = [{ media: { url } }];

        const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media);
        const hasQuota = await checkQuota(classId, estimatedCost);

        if (!hasQuota) {
            await logJob({
                classId,
                jobType: 'analyzeImage',
                status: 'blocked-by-quota',
                promptText: fullPrompt.find(p => p.text)?.text,
                mediaPaths: media.map(m => m.media.url),
                cost: 0,
            });
            analysisResults[email] = 'Error: Insufficient quota.';
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
            analysisResults[email] = response.text;
        } catch (error) {
            await logJob({
                classId,
                jobType: 'analyzeImage',
                status: 'failed',
                promptText: fullPrompt.find(p => p.text)?.text,
                mediaPaths: media.map(m => m.media.url),
                cost: 0,
                errorDetails: error.message,
            });
            analysisResults[email] = `Error: ${error.message}`;
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
      studentEmail: z.string(),
      masterJobId: z.string().optional(),
    }),
    outputSchema: z.object({
        result: z.string(),
        jobId: z.string(),
    }),
  },
  async ({ videoUrl, prompt, classId, studentEmail, masterJobId }) => {
    const fullPrompt = [
        { text: `This video belongs to ${studentEmail} (video URL: ${videoUrl}). The class ID is ${classId}. ${prompt}` },
        { media: { url: videoUrl } },
    ];
    const media = [{ media: { url: videoUrl } }];

    const estimatedCost = estimateCost(fullPrompt.find(p => p.text)?.text, media);
    const hasQuota = await checkQuota(classId, estimatedCost);

    if (!hasQuota) {
        const jobId = await logJob({
            classId,
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
      screenshots: z.record(z.string()),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.string(),
  },
  async ({ screenshots, prompt, classId }, context) => {
    const imageParts = Object.entries(screenshots).flatMap(([email, url]) => (
      [
        { text: `The following image is the screen shot from ${email} (image URL: ${url}):` },
        { media: { url } },
      ]
    ));

    const fullPrompt = [
      ...imageParts,
      { text: `The class ID is ${classId}. ${prompt}` },
    ];

    const media = Object.values(screenshots).map(url => ({ media: { url } }));

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