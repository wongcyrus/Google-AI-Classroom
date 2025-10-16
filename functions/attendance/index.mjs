import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { fromZonedTime } from 'date-fns-tz';
import { CORS_ORIGINS } from './config.js';

initializeApp();
const db = getFirestore();

export const getAttendanceData = onCall({ cors: CORS_ORIGINS, memory: '512MiB' }, async (request) => {
  const { classId, startTime, endTime } = request.data;

  if (!classId || !startTime || !endTime) {
    throw new functions.https.HttpsError('invalid-argument', 'The function must be called with "classId", "startTime", and "endTime" arguments.');
  }

  const classRef = db.collection('classes').doc(classId);
  const classSnap = await classRef.get();

  if (!classSnap.exists) {
    throw new functions.https.HttpsError('not-found', `Class with ID ${classId} not found.`);
  }

  const classData = classSnap.data();
  const studentsMap = classData.students || {};
  const studentList = Object.entries(studentsMap).map(([uid, email]) => ({
    uid: uid,
    email: email.replace(/\s/g, '').toLowerCase(),
  }));
  studentList.sort((a, b) => a.email.localeCompare(b.email));

  const timeZone = classData.schedule?.timeZone || 'UTC';
  const lessonStartTime = fromZonedTime(startTime, timeZone);
  const lessonEndTime = fromZonedTime(endTime, timeZone);

  const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

  if (lessonDurationInMinutes <= 0) {
    return { attendanceData: [] };
  }

  const attendanceMap = new Map(studentList.map(s => [s.email, Array(lessonDurationInMinutes).fill(0)]));

  const CHUNK_SIZE_MINUTES = 15;
  for (let i = 0; i < lessonDurationInMinutes; i += CHUNK_SIZE_MINUTES) {
    const chunkStartTime = new Date(lessonStartTime.getTime() + i * 60000);
    let chunkEndTime = new Date(lessonStartTime.getTime() + (i + CHUNK_SIZE_MINUTES) * 60000);
    if (chunkEndTime > lessonEndTime) {
      chunkEndTime = lessonEndTime;
    }

    const q = db.collection('screenshots')
      .where('classId', '==', classId)
      .where('timestamp', '>=', chunkStartTime)
      .where('timestamp', '<=', chunkEndTime);
    
    const querySnapshot = await q.get();

    querySnapshot.forEach(doc => {
      const screenshot = doc.data();
      const studentEmail = screenshot.email.replace(/\s/g, '').toLowerCase();
      const studentAttendance = attendanceMap.get(studentEmail);
      if (studentAttendance) {
        const screenshotTime = screenshot.timestamp.toDate();
        const minuteIndex = Math.floor((screenshotTime - lessonStartTime) / 60000);
        if (minuteIndex >= 0 && minuteIndex < lessonDurationInMinutes) {
          studentAttendance[minuteIndex] = 1;
        }
      }
    });
  }

  const attendanceData = studentList.map(student => {
    const email = student.email;
    const attendance = attendanceMap.get(email) || [];
    const totalMinutes = attendance.reduce((sum, present) => sum + present, 0);
    const percentage = lessonDurationInMinutes > 0 ? ((totalMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : '0.00%';

    return {
      email,
      totalMinutes,
      percentage,
      attendance,
    };
  });

  return { attendanceData };
});
