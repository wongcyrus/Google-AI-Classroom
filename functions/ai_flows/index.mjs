import './firebase.js';

import { onCallGenkit, onCall, HttpsError } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { analyzeImageFlow, analyzeAllImagesFlow, analyzeFaceFallbackFlow, analyzeAudioFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
export { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';  
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { generateBingoChallenge, submitBingoResponse, generateBingoQuestionBank, handleDispatchBingoRetry, enqueueBingoRetryTask } from './bingoFlows.js';
export { generateBingoChallenge, submitBingoResponse, generateBingoQuestionBank, handleDispatchBingoRetry, enqueueBingoRetryTask };

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
export { generateLabTaskPrompt } from './generateLabTaskPrompt.js';
 
 export const triggerBingoCheck = onCall(callOptions, async (request) => {
   if (request.auth?.token?.role !== 'teacher') {
     throw new HttpsError('permission-denied', 'Only teachers can trigger Bingo checks.');
   }
   return await generateBingoChallenge(request.data);
 });
 
 export const submitBingoAnswer = onCall(callOptions, async (request) => {
   if (!request.auth?.uid) {
     throw new HttpsError('unauthenticated', 'User must be authenticated.');
   }
   const { classId, bingoId, selectedIndex, responseTimeSec, windowFocused } = request.data || {};
   return await submitBingoResponse({
     classId,
     studentUid: request.auth.uid,
     bingoId,
     selectedIndex,
     responseTimeSec,
     windowFocused,
   });
 });
 
 export const generateQuestionBankAi = onCall(callOptions, async (request) => {
   if (request.auth?.token?.role !== 'teacher') {
     throw new HttpsError('permission-denied', 'Only teachers can generate question banks.');
   }
   const { topic, count } = request.data || {};
   return await generateBingoQuestionBank({ topic, count });
 });

 export const dispatchBingoRetryTask = onTaskDispatched(
   {
     region: FUNCTION_REGION,
     retryConfig: {
       maxAttempts: 2,
     },
     rateLimits: {
       maxConcurrentDispatches: 20,
       maxDispatchesPerSecond: 10,
     },
     memory: '512MiB',
     timeoutSeconds: 60,
   },
   async (request) => {
     const { classId, studentUid, priorBingoId } = request.data || {};
     return await handleDispatchBingoRetry({ classId, studentUid, priorBingoId });
   }
 );