import { onCall } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp } from 'firebase-admin/app';
import { CORS_ORIGINS } from './config.js';

initializeApp();
const db = getFirestore();

export const getAttendanceData = onCall({ cors: CORS_ORIGINS }, async (request) => {
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
    email: email.replace(/\s/g, ''),
  }));
  studentList.sort((a, b) => a.email.localeCompare(b.email));

  const lessonStartTime = new Date(startTime);
  const lessonEndTime = new Date(endTime);
  const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

  if (lessonDurationInMinutes <= 0) {
    return { heatmapData: [] };
  }

  const studentEmails = studentList.map(s => s.email);
  const heatmapData = studentEmails.map(email => ({
    id: email,
    data: Array.from({ length: lessonDurationInMinutes }, (_, i) => ({ x: `${i}`, y: 0 }))
  }));

  const screenshotsRef = db.collection('screenshots');
  const q = screenshotsRef
    .where('classId', '==', classId)
    .where('timestamp', '>=', lessonStartTime)
    .where('timestamp', '<=', lessonEndTime);

  const querySnapshot = await q.get();

  querySnapshot.forEach(doc => {
    const screenshot = doc.data();
    const studentEmail = screenshot.email.replace(/\s/g, '');
    const studentIndex = studentEmails.indexOf(studentEmail);

    if (studentIndex !== -1) {
      const screenshotTime = screenshot.timestamp.toDate();
      const minuteIndex = Math.floor((screenshotTime - lessonStartTime) / 60000);
      if (minuteIndex >= 0 && minuteIndex < lessonDurationInMinutes) {
        if (heatmapData[studentIndex] && heatmapData[studentIndex].data[minuteIndex]) {
          heatmapData[studentIndex].data[minuteIndex].y = 1;
        }
      }
    }
  });

  return { heatmapData };
});
