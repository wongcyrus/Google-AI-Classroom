import { genkit } from 'genkit';
import { vertexAI } from '@genkit-ai/vertexai';
import { enableFirebaseTelemetry } from '@genkit-ai/firebase';

enableFirebaseTelemetry();

export const ai = genkit({
  plugins: [
    vertexAI({
      projectId: process.env.GCLOUD_PROJECT,
      location: process.env.GCLOUD_LOCATION,
    }),
  ],
  model: vertexAI.model('gemini-2.5-flash'),
});
// Global region is known bug.
// https://github.com/firebase/genkit/issues/3651