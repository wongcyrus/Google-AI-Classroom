import './firebase.js';

import { onCallGenkit } from "firebase-functions/v2/https";
import { analyzeImageFlow, analyzeAllImagesFlow } from "./gemini.js";

export * from './processVideoJob.js';
export * from './processZipJob.js';
export * from './storageQuota.js';
export * from './ipRestriction.js';
export * from './deleteJobs.js';
export * from './cleanupStuckJobs.js';
import { CORS_ORIGINS } from './config.js';

const callOptions = {
  cors: CORS_ORIGINS,
  enforceAppCheck: true,
};

export const analyzeImage = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return auth?.token?.email_verified && auth?.token?.role === 'teacher';
    },
}, analyzeImageFlow);

export const analyzeAllImages = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return auth?.token?.email_verified && auth?.token?.role === 'teacher';
    },
}, analyzeAllImagesFlow);
