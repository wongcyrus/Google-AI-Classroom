import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';

initializeApp({ projectId });
const db = getFirestore();
const auth = getAuth();

async function seed() {
  console.log(`Seeding demo class on ${projectId}...`);

  const teacherEmails = ['teacher1@vtc.edu.hk', 'teacher2@vtc.edu.hk', 'cywong@vtc.edu.hk'];
  const demoStudents = [
    {
      email: 'student1@stu.vtc.edu.hk',
      studentName: 'Chan Tai Man (陳大文)',
      nickname: 'David',
      programme: 'HD in Information & Communications Technology',
      studentClass: 'IT114115/1A'
    },
    {
      email: 'student2@stu.vtc.edu.hk',
      studentName: 'Wong Siu Ming (黃小明)',
      nickname: 'Sammy',
      programme: 'HD in Information & Communications Technology',
      studentClass: 'IT114115/1A'
    },
    {
      email: 'student3@stu.vtc.edu.hk',
      studentName: 'Lee Ka Yan (李嘉欣)',
      nickname: 'Karen',
      programme: 'HD in Information & Communications Technology',
      studentClass: 'IT114115/1B'
    },
    {
      email: 'student4@stu.vtc.edu.hk',
      studentName: 'Cheung Wai Kin (張偉健)',
      nickname: 'Ken',
      programme: 'HD in Software Engineering',
      studentClass: 'IT114115/1B'
    },
    {
      email: 'student5@stu.vtc.edu.hk',
      studentName: 'Au Yeung Tsz Lok (歐陽梓樂)',
      nickname: 'Lok',
      programme: 'HD in Software Engineering',
      studentClass: 'IT114115/1B'
    }
  ];
  const studentEmails = demoStudents.map(s => s.email);

  const teacherUsers = await Promise.all(teacherEmails.map(email => auth.getUserByEmail(email)));
  const studentUsers = await Promise.all(studentEmails.map(email => auth.getUserByEmail(email)));

  const teacherMap = {};
  teacherUsers.forEach(u => { teacherMap[u.uid] = u.email; });

  const studentMap = {};
  studentUsers.forEach(u => { studentMap[u.uid] = u.email; });

  const studentProfilesMap = {};
  demoStudents.forEach(s => {
    studentProfilesMap[s.email.toLowerCase()] = {
      studentName: s.studentName,
      nickname: s.nickname,
      programme: s.programme,
      studentClass: s.studentClass
    };
  });

  const classId = 'IT114115-Demo';
  const startDate = '2026-01-01';
  const endDate = '2027-12-31';

  const classData = {
    name: 'IT114115 Demo Class',
    teacherEmails,
    studentEmails,
    teachers: teacherMap,
    students: studentMap,
    studentProfiles: studentProfilesMap,
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
  console.log(`✅ Class ${classId} created with student profiles & nicknames.`);

  // Update teacher and student profiles
  for (const tUser of teacherUsers) {
    await db.collection('teacherProfiles').doc(tUser.uid).set({
      classes: FieldValue.arrayUnion(classId)
    }, { merge: true });
  }

  for (let i = 0; i < studentUsers.length; i++) {
    const sUser = studentUsers[i];
    const sMeta = demoStudents[i];
    await db.collection('studentProfiles').doc(sUser.uid).set({
      classes: FieldValue.arrayUnion(classId),
      email: sUser.email,
      studentName: sMeta.studentName,
      nickname: sMeta.nickname,
      programme: sMeta.programme,
      studentClass: sMeta.studentClass,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('studentDirectory').doc(sMeta.email.toLowerCase()).set({
      studentEmail: sMeta.email.toLowerCase(),
      email: sMeta.email.toLowerCase(),
      studentName: sMeta.studentName,
      nickname: sMeta.nickname,
      programme: sMeta.programme,
      studentClass: sMeta.studentClass,
      lastUpdatedByClass: classId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }

  await db.collection('system_config').doc('loginPolicy').set({
    passwordWhitelist: studentEmails,
    updatedAt: FieldValue.serverTimestamp(),
    description: 'Allows listed emails to log in directly with password on desktop without mandatory mobile passkey gate'
  }, { merge: true });

  console.log(`✅ Enrolled co-teachers and students into ${classId} with full profiles (nicknames) and initialized password whitelist.`);
}

seed().catch(console.error);
