import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { fromZonedTime } from 'date-fns-tz';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';

initializeApp();
const db = getFirestore();

/**
 * Safely parse date from string (ISO or local), number, or Date
 */
export function parseDateTime(time, timeZone = 'UTC') {
  if (!time) return null;
  if (time instanceof Date) return time;
  if (typeof time === 'number') return new Date(time);
  if (typeof time === 'string') {
    if (time.includes('Z') || time.includes('+') || (time.includes('-') && time.lastIndexOf('-') > 10)) {
      const parsed = new Date(time);
      if (!isNaN(parsed.getTime())) return parsed;
    }
    return fromZonedTime(time, timeZone);
  }
  const fallback = new Date(time);
  return isNaN(fallback.getTime()) ? null : fallback;
}

export const getAttendanceData = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request) => {
  const { classId, startTime, endTime } = request.data || {};

  if (!classId || !startTime || !endTime) {
    throw new HttpsError('invalid-argument', 'The function must be called with "classId", "startTime", and "endTime" arguments.');
  }

  const classRef = db.collection('classes').doc(classId);
  const classSnap = await classRef.get();

  if (!classSnap.exists) {
    throw new HttpsError('not-found', `Class with ID ${classId} not found.`);
  }

  const classData = classSnap.data();
  const classCaptureInterval = classData.frameRate ? Number(classData.frameRate) : 15;
  const studentsMap = classData.students || {};
  const studentList = Object.entries(studentsMap).map(([uid, email]) => ({
    uid: uid,
    email: (email || '').replace(/\s/g, '').toLowerCase(),
  }));
  studentList.sort((a, b) => a.email.localeCompare(b.email));

  const timeZone = classData.schedule?.timeZone || 'UTC';
  const lessonStartTime = parseDateTime(startTime, timeZone);
  const lessonEndTime = parseDateTime(endTime, timeZone);

  if (!lessonStartTime || !lessonEndTime) {
    throw new HttpsError('invalid-argument', 'Invalid "startTime" or "endTime" provided.');
  }

  const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

  if (lessonDurationInMinutes <= 0) {
    return { attendanceData: [] };
  }

  const crypto = await import('crypto');
  const lessonStartTimeISO = lessonStartTime.toISOString();
  const lessonEndTimeISO = lessonEndTime.toISOString();
  const lessonId = crypto.createHash('sha256').update(`${lessonStartTimeISO}-${lessonEndTimeISO}`).digest('hex');
  const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

  // Attendance maps indexed by student email and uid for robust matching
  const emailToStudentMap = new Map();
  const uidToStudentMap = new Map();
  studentList.forEach(s => {
    const bitmask = Array(lessonDurationInMinutes).fill(0);
    const entry = { student: s, attendance: bitmask, unflaggedCount: 0 };
    if (s.email) emailToStudentMap.set(s.email, entry);
    if (s.uid) uidToStudentMap.set(s.uid, entry);
  });

  // Query screenshots in parallel chunks for fast processing
  const CHUNK_SIZE_MINUTES = 30;
  const chunkPromises = [];
  for (let i = 0; i < lessonDurationInMinutes; i += CHUNK_SIZE_MINUTES) {
    const chunkStartTime = new Date(lessonStartTime.getTime() + i * 60000);
    let chunkEndTime = new Date(lessonStartTime.getTime() + (i + CHUNK_SIZE_MINUTES) * 60000);
    if (chunkEndTime > lessonEndTime) {
      chunkEndTime = lessonEndTime;
    }

    chunkPromises.push(
      db.collection('screenshots')
        .where('classId', '==', classId)
        .where('timestamp', '>=', chunkStartTime)
        .where('timestamp', '<=', chunkEndTime)
        .get()
    );
  }

  const chunkSnapshots = await Promise.all(chunkPromises);

  chunkSnapshots.forEach(snap => {
    if (!snap || typeof snap.forEach !== 'function') return;
    snap.forEach(doc => {
      const screenshot = doc.data ? doc.data() : null;
      if (!screenshot) return;

      const rawEmail = screenshot.email || screenshot.studentEmail || '';
      const studentEmail = rawEmail.replace(/\s/g, '').toLowerCase();
      const studentUid = screenshot.studentUid || screenshot.userId || screenshot.uid;

      const entry = (studentEmail && emailToStudentMap.get(studentEmail)) || (studentUid && uidToStudentMap.get(studentUid));
      if (!entry) return;

      const rawTimestamp = screenshot.timestamp;
      const screenshotTime = rawTimestamp?.toDate ? rawTimestamp.toDate() : (rawTimestamp ? new Date(rawTimestamp) : null);
      if (!screenshotTime || isNaN(screenshotTime.getTime())) return;

      const minuteIndex = Math.floor((screenshotTime.getTime() - lessonStartTime.getTime()) / 60000);
      if (minuteIndex >= 0 && minuteIndex < lessonDurationInMinutes) {
        entry.attendance[minuteIndex] = 1;
        const isFlagged = Boolean(
          screenshot.isFlagged ||
          screenshot.isViolation ||
          screenshot.incidentId ||
          screenshot.reviewRequired ||
          screenshot.suspicious
        );
        if (!isFlagged) {
          entry.unflaggedCount = (entry.unflaggedCount || 0) + 1;
        }
      }
    });
  });

  // Multi-source attendance reconciliation:
  // If routine unflagged screenshots returned 0 for any student (e.g. routine screenshots were purged after class,
  // even if 1-2 flagged irregularity screenshots were preserved), trace presence from previously persisted
  // attendance, AI working time, or completed video compilation and union with any remaining screenshots.
  let existingLessonData = null;
  const studentsWithZeroMinutes = studentList.filter(s => {
    const entry = uidToStudentMap.get(s.uid) || emailToStudentMap.get(s.email);
    if (!entry) return true;
    return (entry.unflaggedCount || 0) === 0;
  });

  if (studentsWithZeroMinutes.length > 0) {
    // 1. Fetch existing lesson doc if available
    try {
      const existingSnap = await lessonRef.get();
      if (existingSnap && existingSnap.exists) {
        existingLessonData = existingSnap.data() || null;
      }
    } catch (err) {
      console.warn('[getAttendanceData] Could not read existing lesson doc:', err);
    }

    // 2. Fetch completed student video jobs for this lesson timeframe
    const videoJobsMap = new Map();
    try {
      const videoJobsSnap = await db.collection('videoJobs')
        .where('classId', '==', classId)
        .where('status', '==', 'completed')
        .get();

      if (videoJobsSnap && typeof videoJobsSnap.forEach === 'function') {
        videoJobsSnap.forEach(doc => {
          const vData = doc.data ? doc.data() : null;
          if (!vData) return;
          const vStart = vData.startTime?.toDate ? vData.startTime.toDate() : (vData.startTime ? new Date(vData.startTime) : null);
          if (!vStart || isNaN(vStart.getTime())) return;
          if (Math.abs(vStart.getTime() - lessonStartTime.getTime()) <= 30 * 60 * 1000) {
            if (vData.studentUid) videoJobsMap.set(vData.studentUid, vData);
            if (vData.studentEmail) videoJobsMap.set(vData.studentEmail.replace(/\s/g, '').toLowerCase(), vData);
          }
        });
      }
    } catch (vErr) {
      console.warn('[getAttendanceData] Error checking videoJobs for attendance tracing:', vErr);
    }

    studentsWithZeroMinutes.forEach(s => {
      const entry = uidToStudentMap.get(s.uid) || emailToStudentMap.get(s.email);
      if (!entry) return;

      const existingStudent = existingLessonData?.students?.[s.uid];
      const matchedVideo = videoJobsMap.get(s.uid) || (s.email ? videoJobsMap.get(s.email.replace(/\s/g, '').toLowerCase()) : null);

      // Screencasts are compiled at 1 frame per second from periodic screenshots.
      // 1 frame of video = captureInterval seconds of real-world activity.
      // Therefore duration (in seconds) * captureInterval / 60 = estimated real-world attended minutes.
      let videoCapMinutes = null;
      if (matchedVideo && typeof matchedVideo.duration === 'number' && matchedVideo.duration > 0) {
        const captureInterval = typeof matchedVideo.captureInterval === 'number'
          ? matchedVideo.captureInterval
          : classCaptureInterval;
        videoCapMinutes = Math.min(lessonDurationInMinutes, Math.max(1, Math.round((matchedVideo.duration * captureInterval) / 60)));
      }

      if (existingStudent?.sharedScreenMinutes > 0 && Array.isArray(existingStudent.attendance) && existingStudent.attendance.length > 0) {
        // Direct authentic bitmask from Firestore lesson doc (preserved permanently even if raw images and videos are deleted)
        const priorLen = existingStudent.attendance.length;
        const priorMins = existingStudent.sharedScreenMinutes;
        const effectiveMins = videoCapMinutes !== null ? Math.min(priorMins, videoCapMinutes) : priorMins;

        if (videoCapMinutes !== null && effectiveMins < priorMins) {
          let count = 0;
          for (let i = 0; i < lessonDurationInMinutes; i++) {
            if (i < priorLen && existingStudent.attendance[i] > 0 && count < effectiveMins) {
              entry.attendance[i] = existingStudent.attendance[i];
              count++;
            } else {
              entry.attendance[i] = 0;
            }
          }
        } else {
          for (let i = 0; i < lessonDurationInMinutes; i++) {
            if (i < priorLen && existingStudent.attendance[i] > 0) {
              entry.attendance[i] = existingStudent.attendance[i];
            }
          }
        }
      } else if (matchedVideo || (existingStudent?.workingMinutes > 0) || (existingStudent?.sharedScreenMinutes > 0)) {
        let minsToFill = videoCapMinutes !== null
          ? videoCapMinutes
          : Math.min(
              existingStudent?.sharedScreenMinutes || existingStudent?.workingMinutes || lessonDurationInMinutes,
              lessonDurationInMinutes
            );

        if (videoCapMinutes !== null && typeof existingStudent?.workingMinutes === 'number' && existingStudent.workingMinutes > 0) {
          minsToFill = Math.min(existingStudent.workingMinutes, videoCapMinutes);
        }

        for (let i = 0; i < minsToFill; i++) {
          entry.attendance[i] = 1;
        }
      }
    });
  }

  // Query Bingo challenge records to overlay distinct presence & accuracy statuses:
  // 3 = Bingo Correct (Emerald Green), 4 = Bingo Incorrect (Amber Yellow), 2 = Bingo Timeout (Bright Orange)
  try {
    const bingoRecordsSnap = await db.collection(`classes/${classId}/bingoRecords`).get();
    if (bingoRecordsSnap && typeof bingoRecordsSnap.forEach === 'function') {
      bingoRecordsSnap.forEach(doc => {
        const bData = doc.data ? doc.data() : null;
        if (!bData) return;

        const bEmail = (bData.studentEmail || '').replace(/\s/g, '').toLowerCase();
        const bUid = bData.studentUid;
        const entry = (bUid && uidToStudentMap.get(bUid)) || (bEmail && emailToStudentMap.get(bEmail));
        if (!entry) return;

        let issuedMillis = bData.issuedAtMillis;
        if (!issuedMillis && bData.issuedAt) {
          issuedMillis = bData.issuedAt?.toDate ? bData.issuedAt.toDate().getTime() : new Date(bData.issuedAt).getTime();
        }
        if (!issuedMillis && bData.createdAt) {
          issuedMillis = bData.createdAt?.toDate ? bData.createdAt.toDate().getTime() : new Date(bData.createdAt).getTime();
        }
        if (!issuedMillis || isNaN(issuedMillis)) return;

        if (issuedMillis >= lessonStartTime.getTime() && issuedMillis <= lessonEndTime.getTime()) {
          const minuteIndex = Math.floor((issuedMillis - lessonStartTime.getTime()) / 60000);
          if (minuteIndex >= 0 && minuteIndex < lessonDurationInMinutes) {
            if (bData.result === 'passed') {
              entry.attendance[minuteIndex] = 3; // Bingo Correct (Passed)
            } else if (bData.result === 'failed_incorrect') {
              entry.attendance[minuteIndex] = 4; // Bingo Incorrect (Wrong Answer)
            } else if (bData.result === 'missed_timeout' || bData.status === 'timeout' || bData.status === 'expired') {
              entry.attendance[minuteIndex] = 2; // Bingo Timeout (Missed / Unanswered)
            }
          }
        }
      });
    }
  } catch (bingoErr) {
    console.warn('[getAttendanceData] Error querying bingoRecords for attendance overlay:', bingoErr);
  }

  // Apply Bingo attendance adjustments (deduct unverified AFK minutes)
  try {
    const adjustmentsSnap = await db.collection(`classes/${classId}/attendanceAdjustments`)
      .where('startTime', '<=', lessonEndTime)
      .get();

    adjustmentsSnap.forEach(doc => {
      const adj = doc.data();
      if (!adj) return;
      const studentUid = adj.studentUid;
      const entry = uidToStudentMap.get(studentUid);
      if (!entry) return;

      const rawStart = adj.startTime;
      const rawEnd = adj.endTime;
      const adjStart = rawStart?.toDate ? rawStart.toDate() : (rawStart ? new Date(rawStart) : null);
      const adjEnd = rawEnd?.toDate ? rawEnd.toDate() : (rawEnd ? new Date(rawEnd) : null);
      if (!adjStart || !adjEnd) return;

      // Check overlap with lesson window
      if (adjEnd >= lessonStartTime && adjStart <= lessonEndTime) {
        const startMinute = Math.max(0, Math.floor((adjStart.getTime() - lessonStartTime.getTime()) / 60000));
        const endMinute = Math.min(lessonDurationInMinutes - 1, Math.floor((adjEnd.getTime() - lessonStartTime.getTime()) / 60000));

        for (let m = startMinute; m <= endMinute; m++) {
          // Only deduct minutes where the student was actually sharing their screen (1).
          // Do not overwrite confirmed active answers (3 = Correct, 4 = Incorrect) or turn absent (0) minutes into deducted (2).
          if (entry.attendance[m] === 1) {
            // 2 = Voided/Deducted by failed consecutive Bingo checks
            entry.attendance[m] = 2;
          }
        }
      }
    });
  } catch (adjErr) {
    console.warn('Error querying attendanceAdjustments:', adjErr);
  }

  const attendanceData = studentList.map(student => {
    const entry = uidToStudentMap.get(student.uid) || emailToStudentMap.get(student.email);
    const attendance = entry ? entry.attendance : Array(lessonDurationInMinutes).fill(0);
    // Active presence includes screen share (1), correct bingo (3), and incorrect bingo (4)
    const netMinutes = attendance.reduce((sum, val) => sum + (val === 1 || val === 3 || val === 4 ? 1 : 0), 0);
    const deductedMinutes = attendance.reduce((sum, val) => sum + (val === 2 ? 1 : 0), 0);
    const rawMinutes = netMinutes + deductedMinutes;
    const bingoCorrectMinutes = attendance.reduce((sum, val) => sum + (val === 3 ? 1 : 0), 0);
    const bingoIncorrectMinutes = attendance.reduce((sum, val) => sum + (val === 4 ? 1 : 0), 0);
    const bingoTimeoutMinutes = attendance.reduce((sum, val) => sum + (val === 2 ? 1 : 0), 0);
    const percentage = lessonDurationInMinutes > 0 ? ((netMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : '0.00%';

    return {
      email: student.email,
      totalMinutes: netMinutes,
      rawMinutes,
      deductedMinutes,
      bingoCorrectMinutes,
      bingoIncorrectMinutes,
      bingoTimeoutMinutes,
      percentage,
      attendance,
    };
  });

  try {
    const studentsPayload = {};
    attendanceData.forEach(data => {
      const student = studentList.find(s => s.email === data.email);
      if (student) {
        const existingStudent = existingLessonData?.students?.[student.uid] || {};
        // Safeguard: Never overwrite existing positive attendance with 0 if no video exists
        if (data.totalMinutes === 0 && (existingStudent.sharedScreenMinutes > 0 || existingStudent.workingMinutes > 0)) {
          return;
        }

        const clampedWorkingMinutes = typeof existingStudent.workingMinutes === 'number'
          ? Math.min(existingStudent.workingMinutes, data.totalMinutes)
          : existingStudent.workingMinutes;

        studentsPayload[student.uid] = {
          ...existingStudent,
          sharedScreenMinutes: data.totalMinutes,
          rawScreenMinutes: data.rawMinutes,
          deductedMinutes: data.deductedMinutes,
          bingoCorrectMinutes: data.bingoCorrectMinutes,
          bingoIncorrectMinutes: data.bingoIncorrectMinutes,
          bingoTimeoutMinutes: data.bingoTimeoutMinutes,
          attendance: data.attendance,
          ...(clampedWorkingMinutes !== undefined ? { workingMinutes: clampedWorkingMinutes } : {}),
        };
      }
    });

    if (Object.keys(studentsPayload).length > 0) {
      await lessonRef.set({
        startTime: lessonStartTime,
        endTime: lessonEndTime,
        students: studentsPayload
      }, { merge: true });
    }
  } catch (error) {
    console.error('Error persisting attendance data:', error);
  }

  return { attendanceData };
});
