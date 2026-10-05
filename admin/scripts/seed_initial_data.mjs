import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const explicitProjectArg = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const projectId = (explicitProjectArg || 'it114115-dev-2026').trim();

// Sanitize ambient environment variables so Google SDKs never touch system default project
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

const app = initializeApp({ projectId }, `seed-app-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

const defaultPasswordEnv = process.env.DEMO_PASSWORD || 'IT114115';

async function getOrCreateUser(email, role, displayName, defaultPassword = defaultPasswordEnv) {
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

  console.log('📝 Checking & seeding AI system prompts...');
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
  const createdPrompts = {};
  let addedCount = 0;
  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8');
    const name = path.basename(filePath, '.md');
    const category = path.basename(path.dirname(filePath));

    const existingSnap = await db.collection('prompts')
      .where('name', '==', name)
      .where('category', '==', category)
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0];
      createdPrompts[`${category}_${name}`] = { id: existingDoc.id, originalId: existingDoc.id, ...existingDoc.data() };
      continue;
    }
    
    let applyTo;
    if (category === 'images') {
      if (name.includes('Bingo')) {
        applyTo = ['Classroom Bingo Questions'];
      } else if (name.includes('Teacher Screen')) {
        applyTo = ['All Images'];
      } else if (name.includes('Student Screen') || name.includes('Face & Gaze')) {
        applyTo = ['Per Image'];
      } else {
        applyTo = ['Per Image', 'All Images'];
      }
    } else if (category === 'videos') {
      applyTo = ['Per Video'];
    } else if (category === 'audios') {
      if (name.includes('Real-Time') || name.includes('Live Rolling Audio') || name.includes('Rolling Audio') || name.includes('Acoustic Invigilation') || name.includes('Intent Proctor')) {
        applyTo = ['Live Audio Invigilation', 'Live Subtitles & Translation'];
      } else if (name.includes('Lecture Audio') || name.includes('Chapters')) {
        applyTo = ['Lecture STT & Chapters'];
      } else if (name.includes('Gemma')) {
        applyTo = ['On-Device Gemma Voice Intent'];
      } else if (name.includes('Discussion') || name.includes('Long Audio')) {
        applyTo = ['Session Audio Summary'];
      } else {
        applyTo = ['Live Audio Invigilation', 'Session Audio Summary'];
      }
    } else if (category === 'translations') {
      if (name.includes('Lecture Subtitle') || name.includes('Whole-Lecture') || name.includes('Recording') || name.includes('Chapter')) {
        applyTo = ['Lecture Subtitle Translation', 'Lecture Subtitles & Chapters'];
      } else {
        applyTo = ['Live Subtitles & Translation'];
        if (name.includes('Code-Switching')) {
          applyTo.push('Code-Switching Lectures');
        }
        if (name.includes('Terminology') || name.includes('Clinical') || name.includes('Accounting') || name.includes('Engineering') || name.includes('Gemma')) {
          applyTo.push('Technical Discipline Glossary');
        }
      }
    } else if (category === 'rubrics') {
      applyTo = ['Lab Rubric Milestones', 'Task Milestones Extraction'];
    } else {
      applyTo = [];
    }

    const docRef = await db.collection('prompts').add({
      name,
      promptText: content,
      category,
      applyTo,
      accessLevel: 'public',
      isSystem: true,
      owner: 'system',
      createdAt: FieldValue.serverTimestamp(),
      lastUpdated: FieldValue.serverTimestamp()
    });
    createdPrompts[name] = { id: docRef.id, originalId: docRef.id, name, promptText: content, category, applyTo, accessLevel: 'public', isSystem: true, owner: 'system' };
    addedCount++;
    console.log(`✨ Seeded new prompt: "${name}" (${category})`);
  }
  console.log(`✅ System prompts up to date (${addedCount} newly added).`);
  return createdPrompts;
}

async function main() {
  console.log(`\n==========================================================`);
  console.log(`🌱 Seeding Initial Demo Data for Project: ${projectId}`);
  console.log(`==========================================================`);

  const isDev = projectId.includes('dev');
  const demoTeachers = [
    { email: 'teacher1@vtc.edu.hk', displayName: 'Teacher 1 (Lead Instructor)' },
    { email: 'teacher2@vtc.edu.hk', displayName: 'Teacher 2 (Co-Instructor)' },
    { email: 'cywong@vtc.edu.hk', displayName: 'CY Wong' },
    { email: 'kcheung@vtc.edu.hk', displayName: 'K Cheung' },
    { email: 'rontam@vtc.edu.hk', displayName: 'Ron Tam' },
    { email: 'hli852@vtc.edu.hk', displayName: 'H Li' },
    { email: 'kakaleung@vtc.edu.hk', displayName: 'Kaka Leung' },
    { email: 'james.chan@vtc.edu.hk', displayName: 'James Chan' },
    { email: 'ngmanyiu@vtc.edu.hk', displayName: 'Man Yiu Ng' },
    { email: 'alanpo@vtc.edu.hk', displayName: 'Alan Po' }
  ];

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

  const demoTeacherEmails = demoTeachers.map(t => t.email);
  const demoStudentEmails = demoStudents.map(s => s.email);

  const teacherMap = {};
  for (const t of demoTeachers) {
    const tUser = await getOrCreateUser(t.email, 'teacher', t.displayName || t.email.split('@')[0]);
    teacherMap[tUser.uid] = t.email;
  }

  const studentMap = {};
  const studentProfilesMap = {};
  const studentUsers = [];
  for (const s of demoStudents) {
    const displayName = s.studentName || s.nickname || s.email.split('@')[0];
    const sUser = await getOrCreateUser(s.email, 'student', displayName);
    studentMap[sUser.uid] = s.email;
    studentProfilesMap[s.email.toLowerCase()] = {
      studentName: s.studentName,
      nickname: s.nickname,
      programme: s.programme,
      studentClass: s.studentClass
    };
    studentUsers.push({ ...sUser, ...s });
  }

  const seededPrompts = await seedPrompts();

  const classId = 'IT114115-Demo';
  const classData = {
    name: 'IT114115 Demo Class',
    teacherEmails: demoTeacherEmails,
    studentEmails: demoStudentEmails,
    teachers: teacherMap,
    students: studentMap,
    studentProfiles: studentProfilesMap,
    retentionDays: 30,
    videoRetentionDays: 90,
    storageQuota: 5 * 1024 * 1024 * 1024,
    aiQuota: 50,
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
    frameRate: 15,
    imageQuality: 50,
    maxImageSize: 0.1 * 1024 * 1024,
    captureMode: 'dual',
    aiModel: 'gemini-3.5-flash-lite',
    requireFullScreenOnly: true,
    faceDebounceSeconds: 3,
    enableCloudFallback: false,
    cloudFallbackRate: 3,
    enableAudioInvigilation: true,
    audioAnalysisIntervalSeconds: 10,
    audioSilenceThreshold: 0.01,
    voiceAiMode: 'client_stt_gemma',
    liveAudioPrompt: seededPrompts?.['AI Voice Invigilator (Live Rolling Audio)'] || null,
    sessionAudioPrompt: seededPrompts?.['Summarize Classroom Discussion (Long Audio)'] || null,
    gemmaIntentPrompt: seededPrompts?.['AI Speech Intent Proctor (Gemma On-Device)'] || null,
    sessionAudioIntervalMinutes: 0,
    isCapturing: true,
    captureStartedAt: FieldValue.serverTimestamp()
  };

  await db.collection('classes').doc(classId).set(classData, { merge: true });
  for (const tUid of Object.keys(teacherMap)) {
    await db.collection('teacherProfiles').doc(tUid).set({ classes: FieldValue.arrayUnion(classId), email: teacherMap[tUid] }, { merge: true });
  }
  for (const s of studentUsers) {
    await db.collection('studentProfiles').doc(s.uid).set({
      classes: FieldValue.arrayUnion(classId),
      email: s.email,
      studentName: s.studentName,
      nickname: s.nickname,
      programme: s.programme,
      studentClass: s.studentClass,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // Also populate institutional studentDirectory
    await db.collection('studentDirectory').doc(s.email.toLowerCase()).set({
      studentEmail: s.email.toLowerCase(),
      email: s.email.toLowerCase(),
      studentName: s.studentName,
      nickname: s.nickname,
      programme: s.programme,
      studentClass: s.studentClass,
      lastUpdatedByClass: classId,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
  }
  console.log(`✅ Demo class '${classId}' configured with co-teaching (teacher1 & teacher2) and 5 students (student1..5 with nicknames & profiles).`);

  // Global Login Policy (Strict Mode by Default - Empty Whitelist)
  await db.collection('system_config').doc('loginPolicy').set({
    passwordWhitelist: [],
    updatedAt: FieldValue.serverTimestamp(),
    description: 'Allows listed emails to log in directly with password on desktop without mandatory mobile passkey gate'
  }, { merge: true });
  console.log(`✅ Global Login Policy initialized in strict mode (passwordWhitelist: []).`);

  console.log(`==========================================================`);
  console.log(`🎉 Demo Data Seeding Complete!`);
  console.log(`👨‍🏫 Teachers: teacher1@vtc.edu.hk, teacher2@vtc.edu.hk (Co-teaching)`);
  console.log(`🧑‍🎓 Students:`);
  for (const s of demoStudents) {
    console.log(`   • ${s.email} | Nickname: "${s.nickname}" | Name: "${s.studentName}" | Cohort: ${s.studentClass}`);
  }
  console.log(`🔑 Default Password: ${defaultPasswordEnv}`);
  console.log(`==========================================================\n`);
}

main().catch(err => {
  console.error('❌ Seeding failed:', err);
  process.exit(1);
});
