import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage, getDownloadURL } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';

/**
 * Checks whether a given timestamp falls within any defined exam periods.
 */
export function isTimestampInExamPeriods(timestamp, examPeriods = []) {
  if (!timestamp || !Array.isArray(examPeriods) || examPeriods.length === 0) return false;
  let timeMs = NaN;
  if (typeof timestamp.toMillis === 'function') {
    timeMs = timestamp.toMillis();
  } else if (timestamp instanceof Date) {
    timeMs = timestamp.getTime();
  } else if (typeof timestamp === 'number') {
    timeMs = timestamp;
  } else if (typeof timestamp === 'string') {
    timeMs = new Date(timestamp).getTime();
  } else if (timestamp && typeof timestamp._seconds === 'number') {
    timeMs = timestamp._seconds * 1000;
  }

  if (isNaN(timeMs)) return false;

  return examPeriods.some(period => {
    if (!period || !period.startDate || !period.endDate) return false;
    const startMs = new Date(period.startDate).getTime();
    const endMs = new Date(period.endDate).getTime();
    return timeMs >= startMs && timeMs <= endMs;
  });
}

/**
 * Evaluates whether a student is permitted to access a screen recording
 * based on the class's exam periods and policies.
 */
export function evaluateStudentRecordingsAccess({
  examPeriods = [],
  policy = 'always_enabled',
  releaseDate = null,
  jobData = {},
}) {
  // Recordings for exam/test periods or stamped as exam are strictly confidential and not shared
  const isExam = Boolean(
    jobData.isExam ||
    jobData.lessonType === 'exam' ||
    isTimestampInExamPeriods(jobData.startTime, examPeriods) ||
    isTimestampInExamPeriods(jobData.createdAt, examPeriods)
  );

  if (isExam) {
    return {
      allowed: false,
      reason: 'Screen recordings for exam or test periods are confidential and not shared with students to protect assessment questions.',
    };
  }

  if (policy === 'disabled') {
    return {
      allowed: false,
      reason: 'Screen recording playback has been disabled by the instructor for this class.',
    };
  }

  if (policy === 'delayed_release' && releaseDate) {
    const releaseTime = new Date(releaseDate).getTime();
    if (!isNaN(releaseTime) && Date.now() < releaseTime) {
      return {
        allowed: false,
        reason: `Screen recordings for this class are locked until ${releaseDate}.`,
      };
    }
  }

  return { allowed: true };
}

export async function executeGetStudentVideoPlaybackUrl(request, { db = getFirestore(), storage = getStorage() } = {}) {
  if (!request?.auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  const { jobId } = request.data || {};
  if (!jobId) {
    throw new HttpsError('invalid-argument', 'jobId is required.');
  }

  const jobDoc = await db.collection('videoJobs').doc(jobId).get();
  if (!jobDoc.exists) {
    throw new HttpsError('not-found', 'Video job not found.');
  }

  const jobData = jobDoc.data();
  const isOwner = jobData.studentUid === request.auth.uid;
  let isTeacher = request.auth.token?.role === 'teacher';

  let classData = null;
  if (jobData.classId) {
    try {
      const classDoc = await db.collection('classes').doc(jobData.classId).get();
      if (classDoc.exists) {
        classData = classDoc.data();
        if (!isTeacher) {
          if ((classData.teacherEmails && classData.teacherEmails.includes(request.auth.token?.email)) ||
              (classData.teachers && (classData.teachers[request.auth.uid] || Object.keys(classData.teachers).includes(request.auth.uid)))) {
            isTeacher = true;
          }
        }
      }
    } catch (e) {
      console.warn('Error checking class teacher authorization:', e);
    }
  }

  if (!isOwner && !isTeacher) {
    throw new HttpsError('permission-denied', 'You do not have permission to view this video.');
  }

  // If calling as a student, enforce class-level screen recording access policy & exam periods
  if (!isTeacher && classData) {
    const accessCheck = evaluateStudentRecordingsAccess({
      examPeriods: classData.examPeriods || [],
      policy: classData.studentRecordingsPolicy || 'always_enabled',
      releaseDate: classData.studentRecordingsReleaseDate || null,
      jobData,
    });

    if (!accessCheck.allowed) {
      throw new HttpsError('permission-denied', accessCheck.reason);
    }
  }

  if (!jobData.videoPath) {
    throw new HttpsError('failed-precondition', 'Video path not available for this job.');
  }

  const file = storage.bucket().file(jobData.videoPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('not-found', 'Video file not found in storage.');
  }

  // Generate signed URL valid for 2 hours, fallback to getDownloadURL if signBlob is unavailable
  let url = null;
  try {
    const [signedUrl] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: Date.now() + 2 * 60 * 60 * 1000,
    });
    url = signedUrl;
  } catch (signErr) {
    console.warn('file.getSignedUrl failed, falling back to getDownloadURL:', signErr.message);
    url = await getDownloadURL(file);
  }

  return { url, videoPath: jobData.videoPath, duration: jobData.duration, size: jobData.size };
}

export const getStudentVideoPlaybackUrl = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '256MiB',
  timeoutSeconds: 60,
}, async (request) => executeGetStudentVideoPlaybackUrl(request));
