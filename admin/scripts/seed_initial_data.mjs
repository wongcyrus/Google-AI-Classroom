import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || 'it114115-dev-2026';

initializeApp({ projectId });
const auth = getAuth();
const db = getFirestore();

async function getOrCreateUser(email, role, displayName, defaultPassword = 'Password123!') {
  try {
    const existing = await auth.getUserByEmail(email);
    console.log(`ℹ️ User ${email} exists (UID: ${existing.uid}). Updating claims...`);
    await auth.setCustomUserClaims(existing.uid, { role });
    await auth.updateUser(existing.uid, { emailVerified: true, displayName, password: defaultPassword });
    return existing;
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`✨ Creating user ${email} (${role})...`);
      const created = await auth.createUser({
        email,
        password: defaultPassword,
        emailVerified: true,
        displayName
      });
      await auth.setCustomUserClaims(created.uid, { role });
      return created;
    }
    throw err;
  }
}

async function seedPrompts() {
  const promptsDir = path.join(__dirname, '..', 'prompts');
  if (!fs.existsSync(promptsDir)) return;

  const existingPrompts = await db.collection('prompts').limit(1).get();
  if (!existingPrompts.empty) {
    console.log('ℹ️ System prompts already seeded.');
    return;
  }

  console.log('📝 Seeding AI system prompts...');
  function getMdFiles(dir) {
    let files = [];
    for (const item of fs.readdirSync(dir)) {
      const fullPath = path.join(dir, item);
      if (fs.statSync(fullPath).isDirectory()) {
        files = files.concat(getMdFiles(fullPath));
      } else if (path.extname(item) === '.md') {
        files.push(fullPath);
      }
    }
    return files;
  }

  const files = getMdFiles(promptsDir);
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const name = path.basename(filePath, '.md');
    const category = path.basename(path.dirname(filePath));
    const applyTo = category === 'images' ? ['Per Image', 'All Images'] : ['Per Video'];

    await db.collection('prompts').add({
      name,
      promptText: content,
      category,
      applyTo,
      accessLevel: 'public',
      createdAt: FieldValue.serverTimestamp(),
      lastUpdated: FieldValue.serverTimestamp()
    });
  }
  console.log(`✅ Seeded ${files.length} AI prompts.`);
}

async function main() {
  console.log(`\n==========================================================`);
  console.log(`🌱 Seeding Initial Demo Data for Project: ${projectId}`);
  console.log(`==========================================================`);

  const allTeacherEmails = [
    'cywong@vtc.edu.hk',
    'cy.gdoc@gmail.com',
    'kcheung@vtc.edu.hk',
    'rontam@vtc.edu.hk',
    'hli852@vtc.edu.hk',
    'kakaleung@vtc.edu.hk',
    'james.chan@vtc.edu.hk',
    'ngmanyiu@vtc.edu.hk',
    'alanpo@vtc.edu.hk'
  ];

  const teacherMap = {};
  for (const tEmail of allTeacherEmails) {
    const tUser = await getOrCreateUser(tEmail, 'teacher', tEmail.split('@')[0]);
    teacherMap[tUser.uid] = tEmail;
  }

  const student = await getOrCreateUser('t-cywong@stu.vtc.edu.hk', 'student', 'Test Student');

  const classId = 'IT114115-Demo';
  const classData = {
    name: 'IT114115 Demo Class',
    teacherEmails: allTeacherEmails,
    studentEmails: ['t-cywong@stu.vtc.edu.hk'],
    teachers: teacherMap,
    students: { [student.uid]: 't-cywong@stu.vtc.edu.hk' },
    storageQuota: 5 * 1024 * 1024 * 1024,
    aiQuota: 1000,
    schedule: {
      startDate: '2026-01-01',
      endDate: '2027-12-31',
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
  for (const tUid of Object.keys(teacherMap)) {
    await db.collection('teacherProfiles').doc(tUid).set({ classes: FieldValue.arrayUnion(classId) }, { merge: true });
  }
  await db.collection('studentProfiles').doc(student.uid).set({ classes: FieldValue.arrayUnion(classId) }, { merge: true });
  console.log(`✅ Demo class '${classId}' configured with 24/7 active schedule for all teachers.`);

  await seedPrompts();

  console.log(`==========================================================`);
  console.log(`🎉 Demo Data Seeding Complete!`);
  console.log(`👨‍🏫 Teacher: cywong@vtc.edu.hk     (Password: Password123!)`);
  console.log(`🧑‍🎓 Student: t-cywong@stu.vtc.edu.hk (Password: Password123!)`);
  console.log(`==========================================================\n`);
}

main().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
