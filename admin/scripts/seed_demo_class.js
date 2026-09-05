import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

async function seed() {
  console.log(`Seeding demo class on ${projectId}...`);

  const teacherEmails = ['teacher1@vtc.edu.hk', 'teacher2@vtc.edu.hk'];
  const studentEmails = [
    'student1@stu.vtc.edu.hk',
    'student2@stu.vtc.edu.hk',
    'student3@stu.vtc.edu.hk',
    'student4@stu.vtc.edu.hk',
    'student5@stu.vtc.edu.hk'
  ];

  const teacherUsers = await Promise.all(teacherEmails.map(email => auth.getUserByEmail(email)));
  const studentUsers = await Promise.all(studentEmails.map(email => auth.getUserByEmail(email)));

  const teacherMap = {};
  teacherUsers.forEach(u => { teacherMap[u.uid] = u.email; });

  const studentMap = {};
  studentUsers.forEach(u => { studentMap[u.uid] = u.email; });

  const classId = 'IT114115-Demo';
  const startDate = '2026-01-01';
  const endDate = '2027-12-31';

  const classData = {
    name: 'IT114115 Demo Class',
    teacherEmails,
    studentEmails,
    teachers: teacherMap,
    students: studentMap,
    retentionDays: 30,
    videoRetentionDays: 90,
    storageQuota: 5 * 1024 * 1024 * 1024, // 5 GB
    aiQuota: 50,
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
    frameRate: 15,
    imageQuality: 50,
    maxImageSize: 0.1 * 1024 * 1024,
    captureMode: 'dual',
    isCapturing: true,
    captureStartedAt: FieldValue.serverTimestamp()
  };

  await db.collection('classes').doc(classId).set(classData, { merge: true });
  console.log(`✅ Class ${classId} created.`);

  // Update teacher and student profiles
  for (const tUser of teacherUsers) {
    await db.collection('teacherProfiles').doc(tUser.uid).set({
      classes: FieldValue.arrayUnion(classId)
    }, { merge: true });
  }

  for (const sUser of studentUsers) {
    await db.collection('studentProfiles').doc(sUser.uid).set({
      classes: FieldValue.arrayUnion(classId)
    }, { merge: true });
  }

  console.log(`✅ Enrolled co-teachers and students into ${classId}.`);
}

seed().catch(console.error);
