import './firebase.js';
import { ai } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P } from './config.js';


import { sendMessageTool, recordIrregularity, recordStudentProgress, sendMessageToTeacher } from './tools.js';


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
    console.log('Authentication context received in analyzeImageFlow:', context);
    const teacherUid = context.auth?.uid;
    const tools = getTools();
    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
      const response = await ai.generate({
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: [
          { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. The request is made by teacher ${teacherUid}. ${prompt}` },
          { media: { url } },
        ],
        tools: tools,
        maxToolRoundtrips: 10,
      });
      analysisResults[email] = response.text;
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
    }),
    outputSchema: z.string(),
  },
  async ({ videoUrl, prompt, classId, studentEmail }) => {
    const tools = getTools();
    const response = await ai.generate({
      temperature: AI_TEMPERATURE,
      topP: AI_TOP_P,
      prompt: [
        { text: `This video belongs to ${studentEmail} (video URL: ${videoUrl}). The class ID is ${classId}. ${prompt}` },
        { media: { url: videoUrl } },
      ],
      tools: tools,
      maxToolRoundtrips: 10,
    });
    return response.text;
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
    console.log('Authentication context received in analyzeAllImagesFlow:', context);
    const teacherUid = context.auth?.uid;
    const tools = getTools();
    const imageParts = Object.entries(screenshots).flatMap(([email, url]) => (
      [
        { text: `The following image is the screen shot from ${email} (image URL: ${url}):` },
        { media: { url } },
      ]
    ));

    const fullPrompt = [
      ...imageParts,
      { text: `The class ID is ${classId}. The request is made by teacher ${teacherUid}. ${prompt}` },
    ];

    const numScreenshots = Object.keys(screenshots).length;
    const maxToolRoundtrips = Math.max(5, numScreenshots * 3);

    const response = await ai.generate({
      temperature: AI_TEMPERATURE,
      topP: AI_TOP_P,
      prompt: fullPrompt,
      tools: tools,
      maxToolRoundtrips,
    });

    return response.text;
  }
);