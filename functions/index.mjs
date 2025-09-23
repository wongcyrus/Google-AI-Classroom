import './firebase.js';

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { runFlow } from "@genkit-ai/flow";

import { analyzeImagesFlow, analyzeAllImagesFlow } from "./gemini.js";
import { processVideoJob } from "./processVideoJob.js";
import { zipVideos } from "./zipVideos.js";

export { processVideoJob, zipVideos };

const callOptions = {
  cors: [
    /^https:\/\/.*\.cloudworkstations\.dev$/,
    "https://us-central1-ai-invigilator-hkiit.cloudfunctions.net",
    "https://ai-invigilator-hkiit.web.app",
    /https:\/\/.*--ai-invigilator-hkiit\.web\.app/,
  ],
  enforceAppCheck: true,
};

export const analyzeImages = onCall(callOptions, (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  return runFlow(analyzeImagesFlow, request.data);
});

export const analyzeAllImages = onCall(callOptions, (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "The function must be called while authenticated.");
  }
  return runFlow(analyzeAllImagesFlow, request.data);
});
