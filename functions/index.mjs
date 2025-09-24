import './firebase.js';

import { onCallGenkit } from "firebase-functions/v2/https";
import { analyzeImagesFlow, analyzeAllImagesFlow } from "./gemini.js";

export * from './processVideoJob.js';
export * from './processZipJob.js';

const callOptions = {
  cors: [
    /^https:\/\/.*\.cloudworkstations\.dev$/,
    "https://us-central1-ai-invigilator-hkiit.cloudfunctions.net",
    "https://ai-invigilator-hkiit.web.app",
    /https:\/\/.*--ai-invigilator-hkiit\.web\.app/,
  ],
  enforceAppCheck: true,
};

export const analyzeImages = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return auth?.token?.email_verified && auth?.token?.role === 'teacher';
    },
}, analyzeImagesFlow);

export const analyzeAllImages = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return auth?.token?.email_verified && auth?.token?.role === 'teacher';
    },
}, analyzeAllImagesFlow);