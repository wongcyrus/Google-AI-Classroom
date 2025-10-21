import './firebase.js';

import { onCallGenkit } from "firebase-functions/v2/https";
import { analyzeImageFlow, analyzeAllImagesFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
export { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';  
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';

// Force deployment
const callOptions = {
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  enforceAppCheck: true,
  memory: '1GiB',
  timeoutSeconds: 180,
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
import { retryVideoAnalysisJob } from './retryVideoAnalysisJob.js';
export { retryVideoAnalysisJob };
export * from './quotaTriggers.js';
export * from './triggerAutomaticAnalysis.js';
export * from './performanceMetrics.js';