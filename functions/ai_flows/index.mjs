import './firebase.js';

import { onCallGenkit, onCall, HttpsError } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { analyzeImageFlow, analyzeAllImagesFlow, analyzeFaceFallbackFlow, analyzeAudioFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
export { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';  
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import {
  handleRequestPasskeyPairingToken,
  handleGetPasskeyRegistrationOptions,
  handleVerifyPasskeyRegistration,
  handleGetPasskeyAuthOptions,
  handleVerifyPasskeyAuth,
  handleClaimInPersonAttendance,
  handleVerifyInPersonAttendanceOverride,
  handleGetStudentPasskeyStatus,
  handleResetStudentPasskey,
} from './passkeyFlows.js';
export {
  handleRequestPasskeyPairingToken,
  handleGetPasskeyRegistrationOptions,
  handleVerifyPasskeyRegistration,
  handleGetPasskeyAuthOptions,
  handleVerifyPasskeyAuth,
  handleClaimInPersonAttendance,
  handleVerifyInPersonAttendanceOverride,
  handleGetStudentPasskeyStatus,
  handleResetStudentPasskey,
};
import {
  generateBingoChallenge,
  submitBingoResponse,
  generateBingoQuestionBank,
  handleDispatchBingoRetry,
  enqueueBingoRetryTask,
  handleProcessBingoJob,
  handleDispatchScheduledBingo,
  cancelActiveBingo as cancelActiveBingoFlow,
} from './bingoFlows.js';
export {
  generateBingoChallenge,
  submitBingoResponse,
  generateBingoQuestionBank,
  handleDispatchBingoRetry,
  enqueueBingoRetryTask,
  handleProcessBingoJob,
  handleDispatchScheduledBingo,
  cancelActiveBingoFlow,
};

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
export { analyzeSingleVideoTask } from './analyzeSingleVideoTask.js';
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

 export const cancelActiveBingo = onCall(callOptions, async (request) => {
   if (request.auth?.token?.role !== 'teacher') {
     throw new HttpsError('permission-denied', 'Only teachers can cancel active Bingo checks.');
   }
   const { classId } = request.data || {};
   return await cancelActiveBingoFlow({ classId });
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
  const { topic, count, classId } = request.data || {};
  return await generateBingoQuestionBank({ topic, count, classId });
});

export const translateTeacherSpeech = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  let isTeacher = request.auth?.token?.role === 'teacher';
  const classId = request.data?.classId;
  if (!isTeacher && classId && request.auth?.uid) {
    try {
      const classDoc = await getFirestore().doc(`classes/${classId}`).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if ((cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
            (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))) {
          isTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error verifying teacher status for subtitle translation:', e);
    }
  }
  if (!isTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers can request live subtitle translation.');
  }
  const { text, sourceLang, targetLangs, context, customPrompt, historyText } = request.data || {};
  return await translateTeacherSpeechInternal({
    classId,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || '',
    text,
    sourceLang,
    targetLangs,
    context,
    customPrompt,
    historyText,
  });
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

export const processBingoJob = onDocumentCreated(
  {
    document: 'bingoJobs/{jobId}',
    region: FUNCTION_REGION,
    memory: '512MiB',
    timeoutSeconds: 120,
  },
  async (event) => {
    const data = event.data?.data() || {};
    const jobId = event.params.jobId;
    return await handleProcessBingoJob({
      jobId,
      classId: data.classId,
      mode: data.mode,
      jitterMinutes: data.jitterMinutes,
    });
  }
);

export const dispatchScheduledBingoTask = onTaskDispatched(
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
    const { classId, studentUid, questionSource } = request.data || {};
    return await handleDispatchScheduledBingo({ classId, studentUid, questionSource });
  }
);

export const requestPasskeyPairingToken = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const { classId } = request.data || {};
  return await handleRequestPasskeyPairingToken({
    studentUid: request.auth.uid,
    studentEmail: request.auth.token?.email || '',
    classId,
  });
});

export const getPasskeyRegistrationOptions = onCall(callOptions, async (request) => {
  const { pairingToken, clientRpId } = request.data || {};
  return await handleGetPasskeyRegistrationOptions({ pairingToken, clientRpId });
});

export const verifyPasskeyRegistration = onCall(callOptions, async (request) => {
  const { pairingToken, attestationResponse, clientRpId, deviceModel } = request.data || {};
  return await handleVerifyPasskeyRegistration({ pairingToken, attestationResponse, clientRpId, deviceModel });
});

export const getPasskeyAuthOptions = onCall(callOptions, async (request) => {
  const { classId, bingoId, clientRpId } = request.data || {};
  return await handleGetPasskeyAuthOptions({ classId, bingoId, clientRpId });
});

export const verifyPasskeyAuth = onCall(callOptions, async (request) => {
  const { classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis } = request.data || {};
  return await handleVerifyPasskeyAuth({ classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis });
});

export const claimInPersonAttendance = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const { classId, bingoId } = request.data || {};
  return await handleClaimInPersonAttendance({ classId, bingoId, studentUid: request.auth.uid });
});

export const verifyInPersonAttendanceOverride = onCall(callOptions, async (request) => {
  let isTeacher = request.auth?.token?.role === 'teacher';
  const { classId, bingoId, studentUid } = request.data || {};
  if (!isTeacher && classId && request.auth?.uid) {
    try {
      const classDoc = await getFirestore().doc(`classes/${classId}`).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if ((cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
            (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))) {
          isTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error checking teacher for in-person override:', e);
    }
  }
  if (!isTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers can verify attendance in person.');
  }
  return await handleVerifyInPersonAttendanceOverride({
    classId,
    bingoId,
    studentUid,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || 'teacher',
  });
});

export const getStudentPasskeyStatus = onCall(callOptions, async (request) => {
  const studentUid = request.data?.studentUid || request.auth?.uid;
  if (!studentUid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  return await handleGetStudentPasskeyStatus({ studentUid });
});

export const resetStudentPasskey = onCall(callOptions, async (request) => {
  let isTeacher = request.auth?.token?.role === 'teacher';
  const { studentUid, studentEmail, classId, reason } = request.data || {};
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  if (!studentUid && !studentEmail) {
    throw new HttpsError('invalid-argument', 'Missing studentUid or studentEmail.');
  }

  if (!isTeacher && classId) {
    try {
      const classDoc = await getFirestore().doc(`classes/${classId}`).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if ((cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
            (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))) {
          isTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error checking teacher for passkey reset:', e);
    }
  }

  if (!isTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers can reset student passkeys.');
  }

  return await handleResetStudentPasskey({
    studentUid,
    studentEmail,
    classId,
    reason,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || 'teacher',
  });
});

export { processLectureSubtitles } from './processLectureSubtitles.js';
export { extractTaskDemoSteps } from './extractTaskDemoSteps.js';
export { evaluateTaskSubmission, evaluateTaskSubmissionTask, enqueueTaskEvaluation } from './evaluateTaskSubmission.js';