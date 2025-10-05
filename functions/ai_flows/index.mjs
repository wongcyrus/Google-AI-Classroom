import './firebase.js';

import { onCallGenkit } from "firebase-functions/v2/https";
import { analyzeImageFlow, analyzeAllImagesFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
import { CORS_ORIGINS } from './config.js';

const callOptions = {
  cors: CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '1GiB',
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

export { onAiJobCreated };
export * from './processVideoAnalysisJob.js';
