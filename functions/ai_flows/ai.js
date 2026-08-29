import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/google-genai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';
import { AI_MODEL, VERTEX_AI_LOCATION } from './config.js';

enableFirebaseTelemetry();

export const ai = genkit({
  plugins: [
    vertexAI({
      projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.VERTEX_AI_LOCATION || VERTEX_AI_LOCATION || 'global',
    }),
  ],
  model: vertexAI.model(AI_MODEL),
});

export { vertexAI };