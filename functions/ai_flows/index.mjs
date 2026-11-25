import './firebase.js';

import { onCallGenkit, onCall, HttpsError } from "firebase-functions/v2/https";
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { analyzeImageFlow, analyzeAllImagesFlow, analyzeFaceFallbackFlow, analyzeAudioFlow } from "./analysisFlows.js";
import { onAiJobCreated } from './quotaTriggers.js';
export { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';  
import { CORS_ORIGINS, FUNCTION_REGION, isPasskeySharingWhitelisted } from './config.js';
import { translateTeacherSpeech as translateTeacherSpeechInternal } from './subtitleFlows.js';
import { getFirestore } from 'firebase-admin/firestore';
import { assertTeacherInClass, isAdminCaller, isTeacherInClassData, isTeacherRoleCaller } from './authHelpers.js';
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
  handleInitiateDesktopLoginSession,
  handleGetDesktopLoginPasskeyOptions,
  handleVerifyDesktopLoginPasskey,
  handleRequestTeacherPasskeyBypass,
  handleApproveTeacherPasskeyBypass,
  handleVerifyTeacherPasskeyBypassPin,
  handleCreateLectureBingoSession,
  handleGetLecturePasskeyAuthOptions,
  handleVerifyLecturePasskeyAuth,
  handleToggleStudentPasskeyExemption,
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
  handleInitiateDesktopLoginSession,
  handleGetDesktopLoginPasskeyOptions,
  handleVerifyDesktopLoginPasskey,
  handleRequestTeacherPasskeyBypass,
  handleApproveTeacherPasskeyBypass,
  handleVerifyTeacherPasskeyBypassPin,
  handleCreateLectureBingoSession,
  handleGetLecturePasskeyAuthOptions,
  handleVerifyLecturePasskeyAuth,
  handleToggleStudentPasskeyExemption,
} from './passkeyFlows.js';
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
    memory: '2GiB',
    timeoutSeconds: 540,
    authPolicy: (auth) => {
        return auth?.token?.role === 'teacher' || auth?.token?.role === 'admin';
    },
}, analyzeImageFlow);

export const analyzeAllImages = onCallGenkit({
    ...callOptions,
    memory: '2GiB',
    timeoutSeconds: 540,
    authPolicy: (auth) => {
        return auth?.token?.role === 'teacher' || auth?.token?.role === 'admin';
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
   const classId = request.data?.classId;
   await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers assigned to this class can trigger Bingo checks.');
   return await generateBingoChallenge(request.data);
 });

 export const cancelActiveBingo = onCall(callOptions, async (request) => {
   const { classId } = request.data || {};
   await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers assigned to this class can cancel active Bingo checks.');
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
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const { topic, count, classId, model } = request.data || {};
  if (classId) {
    await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers assigned to this class can generate question banks.');
  } else if (!isTeacherRoleCaller(request.auth)) {
    throw new HttpsError('permission-denied', 'Only teachers can generate question banks.');
  }
  return await generateBingoQuestionBank({ topic, count, classId, model });
});

export const translateTeacherSpeech = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const classId = request.data?.classId;
  if (classId) {
    await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers can request live subtitle translation.');
  } else if (!isTeacherRoleCaller(request.auth)) {
    throw new HttpsError('permission-denied', 'Only teachers can request live subtitle translation.');
  }
  const { text, sourceLang, targetLangs, context, customPrompt, historyText, model } = request.data || {};
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
    model,
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
  return await handleGetPasskeyRegistrationOptions({ pairingToken, clientRpId, auth: request.auth });
});

export const verifyPasskeyRegistration = onCall(callOptions, async (request) => {
  const { pairingToken, attestationResponse, clientRpId, deviceModel, deviceFingerprint } = request.data || {};
  return await handleVerifyPasskeyRegistration({
    pairingToken,
    attestationResponse,
    clientRpId,
    deviceModel,
    deviceFingerprint,
    auth: request.auth,
  });
});

export const getPasskeyAuthOptions = onCall(callOptions, async (request) => {
  const { classId, bingoId, clientRpId } = request.data || {};
  return await handleGetPasskeyAuthOptions({ classId, bingoId, clientRpId });
});

export const verifyPasskeyAuth = onCall(callOptions, async (request) => {
  const { classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis, deviceFingerprint } = request.data || {};
  return await handleVerifyPasskeyAuth({ classId, bingoId, assertionResponse, clientRpId, timeToCompleteMillis, deviceFingerprint });
});

export const claimInPersonAttendance = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const { classId, bingoId } = request.data || {};
  return await handleClaimInPersonAttendance({ classId, bingoId, studentUid: request.auth.uid });
});

export const verifyInPersonAttendanceOverride = onCall(callOptions, async (request) => {
  const { classId, bingoId, studentUid } = request.data || {};
  await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers can verify attendance in person.');
  return await handleVerifyInPersonAttendanceOverride({
    classId,
    bingoId,
    studentUid,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || 'teacher',
  });
});

export const getStudentPasskeyStatus = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const requestedUid = request.data?.studentUid;
  const studentUid = requestedUid || request.auth.uid;
  const classId = request.data?.classId;
  if (studentUid !== request.auth.uid && !isAdminCaller(request.auth)) {
    if (classId) {
      await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only assigned teachers can view another student passkey status.');
    } else if (!isTeacherRoleCaller(request.auth)) {
      throw new HttpsError('permission-denied', 'Cannot view another student passkey status.');
    }
  }
  return await handleGetStudentPasskeyStatus({ studentUid });
});

export const resetStudentPasskey = onCall(callOptions, async (request) => {
  const { studentUid, studentEmail, classId, reason } = request.data || {};
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  if (!studentUid && !studentEmail) {
    throw new HttpsError('invalid-argument', 'Missing studentUid or studentEmail.');
  }

  let isTeacher = isAdminCaller(request.auth);
  if (!isTeacher) {
    if (classId) {
      try {
        const classDoc = await getFirestore().doc(`classes/${classId}`).get();
        if (classDoc.exists) {
          isTeacher = isTeacherInClassData(classDoc.data() || {}, request.auth);
        }
      } catch (e) {
        console.warn('Error checking teacher for passkey reset:', e);
      }
    } else {
      isTeacher = isTeacherRoleCaller(request.auth);
    }
  }

  const callerEmail = request.auth.token?.email || '';
  const isCallerWhitelisted = isPasskeySharingWhitelisted(callerEmail);
  const isSelf = Boolean(
    request.auth?.uid && (
      request.auth.uid === studentUid ||
      (callerEmail && studentEmail && callerEmail.toLowerCase() === studentEmail.toLowerCase())
    )
  );

  if (!isTeacher && !(isSelf && isCallerWhitelisted)) {
    if (classId && isTeacherRoleCaller(request.auth)) {
      throw new HttpsError('permission-denied', 'Only teachers assigned to this class can reset student passkeys.');
    }
    throw new HttpsError('permission-denied', 'Students cannot self-unlink passkey authenticators. Please contact your instructor to request a passkey reset.');
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

export const initiateDesktopLoginSession = onCall(callOptions, async (request) => {
  const { clientRpId } = request.data || {};
  return await handleInitiateDesktopLoginSession({ clientRpId });
});

export const getDesktopLoginPasskeyOptions = onCall(callOptions, async (request) => {
  const { sessionId, token, clientRpId } = request.data || {};
  return await handleGetDesktopLoginPasskeyOptions({ sessionId, token, clientRpId });
});

export const verifyDesktopLoginPasskey = onCall(callOptions, async (request) => {
  const { sessionId, token, authenticationResponse, clientRpId, deviceFingerprint } = request.data || {};
  return await handleVerifyDesktopLoginPasskey({ sessionId, token, authenticationResponse, clientRpId, deviceFingerprint });
});

export const requestTeacherPasskeyBypass = onCall(callOptions, async (request) => {
  const { studentUid, studentEmail, classId, deskNumber, reason } = request.data || {};
  if (request.auth?.uid && studentUid && studentUid !== request.auth.uid && !isAdminCaller(request.auth)) {
    if (classId) {
      await assertTeacherInClass(request.auth, classId, getFirestore(), 'Cannot request passkey bypass for another student.');
    } else if (!isTeacherRoleCaller(request.auth)) {
      throw new HttpsError('permission-denied', 'Cannot request passkey bypass for another student.');
    }
  }
  const effectiveUid = studentUid || request.auth?.uid;
  const effectiveEmail = studentEmail || request.auth?.token?.email || '';
  return await handleRequestTeacherPasskeyBypass({
    studentUid: effectiveUid,
    studentEmail: effectiveEmail,
    classId,
    deskNumber,
    reason,
  });
});

export const approveTeacherPasskeyBypass = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }
  const { requestId, classId, studentUid, studentEmail, bypassDurationMinutes, approved, action } = request.data || {};
  if (classId) {
    await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers can approve passkey bypass requests.');
  } else if (!isTeacherRoleCaller(request.auth)) {
    throw new HttpsError('permission-denied', 'Only teachers can approve passkey bypass requests.');
  }

  return await handleApproveTeacherPasskeyBypass({
    requestId,
    classId,
    studentUid,
    studentEmail,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || 'teacher',
    bypassDurationMinutes,
    approved: approved !== false,
    action,
  });
});

export const verifyTeacherPasskeyBypassPin = onCall(callOptions, async (request) => {
  const { classId, studentUid, pin, reason, deskNumber } = request.data || {};
  if (request.auth?.uid && studentUid && studentUid !== request.auth.uid && !isAdminCaller(request.auth)) {
    if (classId) {
      await assertTeacherInClass(request.auth, classId, getFirestore(), 'Cannot verify bypass PIN for another student.');
    } else if (!isTeacherRoleCaller(request.auth)) {
      throw new HttpsError('permission-denied', 'Cannot verify bypass PIN for another student.');
    }
  }
  const effectiveUid = studentUid || request.auth?.uid;
  return await handleVerifyTeacherPasskeyBypassPin({
    classId,
    studentUid: effectiveUid,
    pin,
    reason,
    deskNumber,
  });
});

export const toggleStudentPasskeyExemption = onCall(callOptions, async (request) => {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { studentEmail, studentUid, classId, exempt, reason } = request.data || {};
  if (classId) {
    await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers can grant or revoke permanent passkey exemptions.');
  } else if (!isTeacherRoleCaller(request.auth)) {
    throw new HttpsError('permission-denied', 'Only teachers can grant or revoke permanent passkey exemptions.');
  }

  return await handleToggleStudentPasskeyExemption({
    studentEmail,
    studentUid,
    classId,
    exempt: exempt !== false,
    teacherUid: request.auth.uid,
    teacherEmail: request.auth.token?.email || 'teacher',
    reason,
  });
});

export const createLectureBingoSession = onCall(callOptions, async (request) => {
  const { classId, timeLimitSeconds } = request.data || {};
  await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only instructors can create a lecture QR attendance session.');
  return await handleCreateLectureBingoSession({
    classId,
    timeLimitSeconds,
    teacherUid: request.auth?.uid,
  });
});

export const getLecturePasskeyAuthOptions = onCall(callOptions, async (request) => {
  const { classId, bingoId, token, clientRpId } = request.data || {};
  return await handleGetLecturePasskeyAuthOptions({
    classId,
    bingoId,
    token,
    clientRpId,
  });
});

export const verifyLecturePasskeyAuth = onCall(callOptions, async (request) => {
  const {
    classId,
    bingoId,
    challengeId,
    token,
    assertionResponse,
    clientRpId,
    timeToCompleteMillis,
    deviceFingerprint,
  } = request.data || {};
  return await handleVerifyLecturePasskeyAuth({
    classId,
    bingoId,
    challengeId,
    token,
    assertionResponse,
    clientRpId,
    timeToCompleteMillis,
    deviceFingerprint,
  });
});

export const reconcileLectureRecordings = onCall(callOptions, async (request) => {
  const { classId } = request.data || {};
  await assertTeacherInClass(request.auth, classId, getFirestore(), 'Only teachers can reconcile lecture recordings.');
  return await handleReconcileLectureRecordings({ classId });
});

import { processLectureSubtitles, processLectureSubtitleJob, handleReconcileLectureRecordings } from './processLectureSubtitles.js';
export { processLectureSubtitles, processLectureSubtitleJob, handleReconcileLectureRecordings };
export { extractTaskDemoSteps } from './extractTaskDemoSteps.js';
export { evaluateTaskSubmission, evaluateTaskSubmissionTask, enqueueTaskEvaluation } from './evaluateTaskSubmission.js';
export {
  analyzeProjectMeeting,
  handleAnalyzeProjectMeeting,
  emailProjectMeetingReport,
  handleEmailProjectMeetingReport,
  batchEmailProjectMeetingReports,
  handleBatchEmailProjectMeetingReports,
  generateMeetingEmailHtml,
} from './projectMeetingFlows.js';