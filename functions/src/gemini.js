import { ai } from './ai.js';
import { geminiPro } from '@genkit-ai/google-genai';
import { z } from 'zod';

export const analyzeImagesFlow = ai.defineFlow(
  {
    name: 'analyzeImagesFlow',
    inputSchema: z.object({
      screenshots: z.record(z.string()),
      prompt: z.string(),
    }),
    outputSchema: z.record(z.string()),
  },
  async ({ screenshots, prompt }) => {
    const analysisResults = {};
    for (const [email, url] of Object.entries(screenshots)) {
      const response = await ai.generate({
        model: 'googleai/gemini-1.5-flash-001',
        project: process.env.GCLOUD_PROJECT,
        location: process.env.FUNCTION_REGION,
        prompt: [
          { media: { url } },
          { text: prompt },
        ],
      });
      analysisResults[email] = await response.text();
    }
    return analysisResults;
  }
);
