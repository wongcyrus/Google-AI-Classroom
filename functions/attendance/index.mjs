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

  // Attendance maps indexed by student email and uid for robust matching
  const emailToStudentMap = new Map();
  const uidToStudentMap = new Map();
  studentList.forEach(s => {
    const bitmask = Array(lessonDurationInMinutes).fill(0);
    const entry = { student: s, attendance: bitmask };
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
    snap.forEach(doc => {
      const screenshot = doc.data();
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
      }
    });
  });

  const attendanceData = studentList.map(student => {
    const entry = uidToStudentMap.get(student.uid) || emailToStudentMap.get(student.email);
    const attendance = entry ? entry.attendance : Array(lessonDurationInMinutes).fill(0);
    const totalMinutes = attendance.reduce((sum, present) => sum + present, 0);
    const percentage = lessonDurationInMinutes > 0 ? ((totalMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : '0.00%';

    return {
      email: student.email,
      totalMinutes,
      percentage,
      attendance,
    };
  });

  const crypto = await import('crypto');
  const lessonStartTimeISO = lessonStartTime.toISOString();
  const lessonEndTimeISO = lessonEndTime.toISOString();
  const lessonId = crypto.createHash('sha256').update(`${lessonStartTimeISO}-${lessonEndTimeISO}`).digest('hex');
  const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

  try {
    const studentsPayload = {};
    attendanceData.forEach(data => {
      const student = studentList.find(s => s.email === data.email);
      if (student) {
        studentsPayload[student.uid] = {
          sharedScreenMinutes: data.totalMinutes,
          attendance: data.attendance
        };
      }
    });

    await lessonRef.set({
      startTime: lessonStartTime,
      endTime: lessonEndTime,
      students: studentsPayload
    }, { merge: true });
  } catch (error) {
    console.error('Error persisting attendance data:', error);
  }

  return { attendanceData };
});
