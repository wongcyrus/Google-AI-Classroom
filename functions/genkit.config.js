import { configureGenkit } from '@genkit-ai/core';
import { firebase } from '@genkit-ai/firebase';
import { vertexAI } from '@genkit-ai/vertexai';

export default configureGenkit({
  plugins: [
    firebase(),
    vertexAI(),
  ],
  logLevel: 'debug',
  enableTracingAndMetrics: true,
});
