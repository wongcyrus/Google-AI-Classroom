import './firebase.js';
import { onCall } from "firebase-functions/v2/https";
import { analyzeImagesFlow, analyzeAllImagesFlow } from "./gemini.js";
import { processVideoJob } from "./processVideoJob.js";
import { zipVideos } from "./zipVideos.js";

export { processVideoJob, zipVideos };

const corsOptions = {
  cors: [
    /^https:\/\/.*\.cloudworkstations\.dev$/,
    "https://us-central1-ai-invigilator-hkiit.cloudfunctions.net",
    "https://ai-invigilator-hkiit.web.app",
    /https:\/\/.*--ai-invigilator-hkiit\.web\.app/,
  ],
};

const wrapper = (flow) => (request) => {
    return flow(request.data);
  };

export const analyzeImages = onCall(corsOptions, wrapper(analyzeImagesFlow));
export const analyzeAllImages = onCall(corsOptions, wrapper(analyzeAllImagesFlow));
