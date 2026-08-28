import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

async function seed() {
  console.log(`Seeding demo class on ${projectId}...`);

  const teacherEmail = 'cywong@vtc.edu.hk';
  const studentEmail = 't-cywong@stu.vtc.edu.hk';

  const teacherUser = await auth.getUserByEmail(teacherEmail);
  const studentUser = await auth.getUserByEmail(studentEmail);

  const classId = 'IT114115-Demo';
  const startDate = '2026-01-01';
  const endDate = '2027-12-31';

  const classData = {
    name: 'IT114115 Demo Class',
    teacherEmails: [teacherEmail],
    studentEmails: [studentEmail],
    teachers: {
      [teacherUser.uid]: teacherEmail
    },
    students: {
      [studentUser.uid]: studentEmail
    },
    storageQuota: 5 * 1024 * 1024 * 1024, // 5 GB
    aiQuota: 1000,
    schedule: {
      startDate,
      endDate,
      timeZone: 'Asia/Hong_Kong',
      timeSlots: [
        { startTime: '00:00', endTime: '23:59', days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] }
      ]
    },
    ipRestrictions: [],
    automaticCapture: true,
    automaticCombine: true,
    frameRate: 5,
    imageQuality: 50,
    maxImageSize: 1024 * 1024,
    isCapturing: true,
    captureStartedAt: FieldValue.serverTimestamp()
  };

  await db.collection('classes').doc(classId).set(classData, { merge: true });
  console.log(`✅ Class ${classId} created.`);

  // Update teacher and student profiles
  await db.collection('teacherProfiles').doc(teacherUser.uid).set({
    classes: FieldValue.arrayUnion(classId)
  }, { merge: true });

  await db.collection('studentProfiles').doc(studentUser.uid).set({
    classes: FieldValue.arrayUnion(classId)
  }, { merge: true });

  console.log(`✅ Enrolled teacher ${teacherEmail} and student ${studentEmail} into ${classId}.`);
}

seed().catch(console.error);
