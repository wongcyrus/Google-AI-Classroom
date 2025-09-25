import './firebase.js';
import { ai } from './ai.js';
import { z } from 'genkit';
import { AI_TEMPERATURE, AI_TOP_P } from './config.js';


import { sendMessageTool, recordIrregularity, recordStudentProgress, sendMessageToTeacher } from './tools.js';


function getTools() {
  return [sendMessageTool, recordIrregularity, recordStudentProgress, sendMessageToTeacher];
}

export const analyzeImagesFlow = ai.defineFlow(
  {
    name: 'analyzeImagesFlow',
    inputSchema: z.object({
      screenshots: z.record(z.string()),
      prompt: z.string(),
      classId: z.string(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt, classId }) => {
    const tools = getTools();
    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
      const response = await ai.generate({
        temperature: AI_TEMPERATURE,
        topP: AI_TOP_P,
        prompt: [
          { text: `This screen belongs to ${email} (image URL: ${url}). The class ID is ${classId}. ${prompt}` },
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
  async ({ screenshots, prompt, classId }) => {
    const tools = getTools();
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