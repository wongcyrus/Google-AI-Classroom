import './firebase.js';

import { onCallGenkit } from "firebase-functions/v2/https";
import { analyzeImageFlow, analyzeAllImagesFlow, analyzeFaceFallbackFlow, analyzeAudioFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
export { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';  
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';

const callOptions = {
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  enforceAppCheck: false,
  memory: '1GiB',
  timeoutSeconds: 180,
};

export const analyzeImage = onCallGenkit({
    ...callOptions,    
    authPolicy: (auth) => {
        return auth?.token?.role === 'teacher';
    },
}, analyzeImageFlow);

export const analyzeAllImages = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return auth?.token?.role === 'teacher';
    },
}, analyzeAllImagesFlow);

export const analyzeFaceFallback = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return !!auth?.uid;
    },
}, analyzeFaceFallbackFlow);

export const analyzeAudio = onCallGenkit({
    ...callOptions,
    authPolicy: (auth) => {
        return !!auth?.uid;
    },
}, analyzeAudioFlow);

export { onAiJobCreated };
export * from './processVideoAnalysisJob.js';
import { retryVideoAnalysisJob } from './retryVideoAnalysisJob.js';
export { retryVideoAnalysisJob };
export * from './quotaTriggers.js';
export * from './triggerAutomaticAnalysis.js';
export * from './performanceMetrics.js';