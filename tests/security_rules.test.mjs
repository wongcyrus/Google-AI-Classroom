import { initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp as initClient } from 'firebase/app';
import { getAuth as getClientAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore as getClientFirestore, collection, doc, getDoc, getDocs, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL, getBytes, deleteObject } from 'firebase/storage';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const explicitProjectArg = process.argv.slice(2).find(arg => !arg.startsWith('-'));
const projectId = (explicitProjectArg || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026').trim();
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

function resolveApiKey(targetProject) {
  if (process.env.VITE_API_KEY) return process.env.VITE_API_KEY;
  if (process.env.VITE_FIREBASE_API_KEY) return process.env.VITE_FIREBASE_API_KEY;
  if (process.env.FIREBASE_API_KEY) return process.env.FIREBASE_API_KEY;

  const candidateEnvPaths = targetProject === 'it114115-dev-2026' ? [
    path.resolve(__dirname, '../web-app/.env.dev'),
    path.resolve(__dirname, '../web-app/.env.local'),
    path.resolve(__dirname, '../web-app/.env'),
    path.resolve(__dirname, '../web-app/.env.prod'),
  ] : [
    path.resolve(__dirname, '../web-app/.env.prod'),
    path.resolve(__dirname, '../web-app/.env.production'),
    path.resolve(__dirname, '../web-app/.env.dev'),
    path.resolve(__dirname, '../web-app/.env'),
    path.resolve(__dirname, '../web-app/.env.local'),
  ];

  for (const envPath of candidateEnvPaths) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        const match = content.match(/^VITE_(?:FIREBASE_)?API_KEY=(.+)$/m);
        if (match && match[1]) {
          return match[1].trim().replace(/^["']|["']$/g, '');
        }
      } catch {}
    }
  }
  return 'test-api-key-placeholder';
}

const apiKey = resolveApiKey(projectId);

console.log(`\n========================================================`);
console.log(`🛡️  RUNNING REAL-TOKEN SECURITY RULES VERIFICATION (${projectId})`);
console.log(`========================================================\n`);

// Initialize Admin SDK for setup
const adminApp = initAdmin({ projectId }, 'adminApp_' + Date.now());
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);

// Initialize Client SDK (Enforces all Firestore Security Rules!)
const clientApp = initClient({
  projectId: projectId,
  apiKey: apiKey,
  authDomain: `${projectId}.firebaseapp.com`,
  storageBucket: `${projectId}.firebasestorage.app`,
}, 'clientApp_' + Date.now());
const clientAuth = getClientAuth(clientApp);
const clientDb = getClientFirestore(clientApp);
const clientStorage = getStorage(clientApp);

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

async function expectPermissionDenied(promise, message) {
  try {
    await promise;
    assert(false, `${message} (Expected PERMISSION_DENIED but operation SUCCEEDED)`);
  } catch (err) {
    const isDenied = err.code === 'permission-denied' || 
                     err.code === 'storage/unauthorized' ||
                     err.message?.includes('insufficient permissions') || 
                     err.message?.includes('PERMISSION_DENIED') ||
                     err.code === 'auth/user-not-found' ||
                     err.code?.includes('permission');
    assert(isDenied, `${message} (Correctly denied with: ${err.code || 'permission-denied'})`);
  }
}

async function expectAllowed(promise, message) {
  try {
    await promise;
    assert(true, message);
  } catch (err) {
    assert(false, `${message} (Failed with: ${err.message})`);
  }
}

async function runSecurityRulesSuite() {
  const timestamp = Date.now();
  const classA = `SEC-CLASS-A-${timestamp}`;
  const classB = `SEC-CLASS-B-${timestamp}`;
  const student1Uid = `sec-student-1-${timestamp}`;
  const student2Uid = `sec-student-2-${timestamp}`;
  const teacherUid = `sec-teacher-${timestamp}`;
  const teacherEmail = `sec.teacher.${timestamp}@vtc.edu.hk`;
  const student1Email = `sec.student1.${timestamp}@stu.vtc.edu.hk`;
  const student2Email = `sec.student2.${timestamp}@stu.vtc.edu.hk`;
  const defaultPassword = 'SecurityTestPass123!';

  try {
    console.log(`🔧 Setting up test fixture documents in Firestore & Auth...`);
    
    // Create test auth users
    await adminAuth.createUser({
      uid: student1Uid,
      email: student1Email,
      password: defaultPassword,
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(student1Uid, { role: 'student' });

    await adminAuth.createUser({
      uid: student2Uid,
      email: student2Email,
      password: defaultPassword,
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(student2Uid, { role: 'student' });

    await adminAuth.createUser({
      uid: teacherUid,
      email: teacherEmail,
      password: defaultPassword,
      emailVerified: true,
    });
    await adminAuth.setCustomUserClaims(teacherUid, { role: 'teacher' });

    // Setup Class A with Student 1 enrolled + non-PII studentConfig/public mirror
    await adminDb.collection('classes').doc(classA).set({
      classId: classA,
      name: 'Security Test Class A',
      teacherEmails: [teacherEmail],
      teachers: [teacherUid],
      students: { [student1Uid]: student1Email },
      studentEmails: [student1Email],
      createdAt: FieldValue.serverTimestamp()
    });
    await adminDb.collection('classes').doc(classA).collection('studentConfig').doc('public').set({
      name: 'Security Test Class A',
      frameRate: 15,
      isCapturing: false,
      examPeriods: [],
    });

    // Setup Class B with Student 2 enrolled + non-PII studentConfig/public mirror
    await adminDb.collection('classes').doc(classB).set({
      classId: classB,
      name: 'Security Test Class B',
      teacherEmails: [teacherEmail],
      teachers: [teacherUid],
      students: { [student2Uid]: student2Email },
      studentEmails: [student2Email],
      createdAt: FieldValue.serverTimestamp()
    });
    await adminDb.collection('classes').doc(classB).collection('studentConfig').doc('public').set({
      name: 'Security Test Class B',
      frameRate: 15,
      isCapturing: false,
      examPeriods: [],
    });

    // Setup Student Profiles
    await adminDb.collection('studentProfiles').doc(student1Uid).set({
      email: student1Email,
      classes: [classA]
    });
    await adminDb.collection('studentProfiles').doc(student2Uid).set({
      email: student2Email,
      classes: [classB]
    });

    // Create a screenshot document in Class A
    const shotDocId = `shot-${timestamp}`;
    await adminDb.collection('screenshots').doc(shotDocId).set({
      classId: classA,
      studentUid: student1Uid,
      email: student1Email,
      timestamp: new Date()
    });

    // Setup Student Directory entry
    await adminDb.collection('studentDirectory').doc(student1Email).set({
      email: student1Email,
      studentName: 'Student One',
      updatedAt: FieldValue.serverTimestamp()
    });

    // -------------------------------------------------------------
    // SUITE 1: Unauthenticated / Anonymous Access Protection
    // -------------------------------------------------------------
    console.log(`\n🔒 SUITE 1: Anonymous / Unauthenticated Protection`);
    await signOut(clientAuth);
    
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA)),
      'Unauthenticated user cannot read classes'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'screenshots', shotDocId)),
      'Unauthenticated user cannot read screenshots'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentProfiles', student1Uid)),
      'Unauthenticated user cannot read student profiles'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentDirectory', student1Email)),
      'Unauthenticated user cannot read studentDirectory'
    );

    // -------------------------------------------------------------
    // SUITE 2: Student Access & Isolation Rules
    // -------------------------------------------------------------
    console.log(`\n🎓 SUITE 2: Student Permissions & Isolation (Student 1)`);
    await signInWithEmailAndPassword(clientAuth, student1Email, defaultPassword);

    // Profile isolation
    await expectAllowed(
      getDoc(doc(clientDb, 'studentProfiles', student1Uid)),
      'Student 1 can read own student profile'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentProfiles', student2Uid)),
      'Student 1 CANNOT read Student 2 profile'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentDirectory', student1Email)),
      'Student 1 CANNOT read studentDirectory'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'studentDirectory', student1Email), { studentName: 'Hacker Name' }),
      'Student 1 CANNOT write studentDirectory'
    );

    // Class PII & enrollment isolation
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA)),
      'Student 1 CANNOT read raw classes/Class A document directly (roster PII protection)'
    );
    await expectPermissionDenied(
      getDocs(collection(clientDb, 'classes')),
      'Student 1 CANNOT list classes collection directly'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'studentConfig', 'public')),
      'Student 1 CAN read enrolled Class A non-PII studentConfig/public'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classB, 'studentConfig', 'public')),
      'Student 1 CANNOT read non-enrolled Class B studentConfig/public'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'classes', classA, 'studentConfig', 'public'), { name: 'Tampered' }),
      'Student 1 CANNOT write classes/Class A/studentConfig/public'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classB)),
      'Student 1 CANNOT read non-enrolled Class B'
    );

    // Tampering & self-escalation prevention
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'classes', classA), { frameRate: 1 }),
      'Student 1 CANNOT tamper with class settings (frameRate)'
    );
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'studentProfiles', student1Uid), { passkeyPermanentExempt: true }),
      'Student 1 CANNOT modify own studentProfiles document (passkey exemption self-grant blocked)'
    );

    // Audio metadata isolation
    const audio1DocId = `audio-1-${timestamp}`;
    const audio2DocId = `audio-2-${timestamp}`;
    await adminDb.collection('audio').doc(audio1DocId).set({
      classId: classA,
      studentUid: student1Uid,
      studentEmail: student1Email,
      audioPath: `audio/${classA}/${student1Uid}/segment.webm`,
      timestamp: new Date()
    });
    await adminDb.collection('audio').doc(audio2DocId).set({
      classId: classB,
      studentUid: student2Uid,
      studentEmail: student2Email,
      audioPath: `audio/${classB}/${student2Uid}/segment.webm`,
      timestamp: new Date()
    });

    // Student 1 Audio Access
    await expectAllowed(
      getDoc(doc(clientDb, 'audio', audio1DocId)),
      'Student 1 CAN read own audio metadata'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'audio', audio2DocId)),
      'Student 1 CANNOT read Student 2 audio metadata'
    );

    // Video Jobs isolation
    const videoJob1Id = `vjob-1-${timestamp}`;
    const videoJob2Id = `vjob-2-${timestamp}`;
    await adminDb.collection('videoJobs').doc(videoJob1Id).set({
      classId: classA,
      studentUid: student1Uid,
      videoPath: `videos/${classA}/${videoJob1Id}.mp4`,
      status: 'completed',
    });
    await adminDb.collection('videoJobs').doc(videoJob2Id).set({
      classId: classB,
      studentUid: student2Uid,
      videoPath: `videos/${classB}/${videoJob2Id}.mp4`,
      status: 'completed',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'videoJobs', videoJob1Id)),
      'Student 1 CAN read own videoJobs document'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'videoJobs', videoJob2Id)),
      'Student 1 CANNOT read Student 2 videoJobs document'
    );

    // AI Jobs isolation
    const aiJob1Id = `aijob-1-${timestamp}`;
    const aiJob2Id = `aijob-2-${timestamp}`;
    await adminDb.collection('aiJobs').doc(aiJob1Id).set({
      classId: classA,
      studentUid: student1Uid,
      status: 'completed',
    });
    await adminDb.collection('aiJobs').doc(aiJob2Id).set({
      classId: classB,
      studentUid: student2Uid,
      status: 'completed',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'aiJobs', aiJob1Id)),
      'Student 1 CAN read own aiJobs document'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'aiJobs', aiJob2Id)),
      'Student 1 CANNOT read Student 2 aiJobs document'
    );

    // Performance Metrics isolation
    const metric1Id = `metric-1-${timestamp}`;
    const metric2Id = `metric-2-${timestamp}`;
    await adminDb.collection('performanceMetrics').doc(metric1Id).set({
      classId: classA,
      studentUid: student1Uid,
      taskName: 'AWS Lab',
    });
    await adminDb.collection('performanceMetrics').doc(metric2Id).set({
      classId: classB,
      studentUid: student2Uid,
      taskName: 'AWS Lab',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'performanceMetrics', metric1Id)),
      'Student 1 CAN read own performanceMetrics document'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'performanceMetrics', metric2Id)),
      'Student 1 CANNOT read Student 2 performanceMetrics document'
    );

    // Lessons in enrolled vs non-enrolled class
    const lesson1Id = `lesson-1-${timestamp}`;
    const lesson2Id = `lesson-2-${timestamp}`;
    await adminDb.collection('classes').doc(classA).collection('lessons').doc(lesson1Id).set({
      startTime: new Date(),
      students: { [student1Uid]: { sharedScreenMinutes: 45 } },
    });
    await adminDb.collection('classes').doc(classB).collection('lessons').doc(lesson2Id).set({
      startTime: new Date(),
      students: { [student2Uid]: { sharedScreenMinutes: 45 } },
    });
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'lessons', lesson1Id)),
      'Student 1 CANNOT read raw lessons subcollection in Class A (classmate attendance PII protection)'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classB, 'lessons', lesson2Id)),
      'Student 1 CANNOT read lessons in non-enrolled Class B'
    );

    // Capstone project collections isolation (must use scoped getStudentProjectRecords callable)
    const projGroupId = `grp-${timestamp}`;
    const projMeetingId = `mtg-${timestamp}`;
    const projProfileId = `pprof-${timestamp}`;
    await adminDb.collection('classes').doc(classA).collection('projectGroups').doc(projGroupId).set({
      name: 'Group Secret Roster',
      members: [{ email: student1Email, name: 'Student 1' }, { email: student2Email, name: 'Student 2' }],
    });
    await adminDb.collection('classes').doc(classA).collection('projectMeetings').doc(projMeetingId).set({
      groupId: projGroupId,
      title: 'Meeting with Transcript & Classmate Feedback',
    });
    await adminDb.collection('classes').doc(classA).collection('projectStudentProfiles').doc(projProfileId).set({
      email: student2Email,
      weeklyLogEntries: [],
    });

    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'projectGroups', projGroupId)),
      'Student 1 CANNOT read projectGroups directly (teammate PII protection)'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'projectMeetings', projMeetingId)),
      'Student 1 CANNOT read projectMeetings directly'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'projectStudentProfiles', projProfileId)),
      'Student 1 CANNOT read projectStudentProfiles directly'
    );

    // Bingo records isolation (including blocking legacy studentUid == 'all')
    const bingo1Id = `bingo-1-${timestamp}`;
    const bingo2Id = `bingo-2-${timestamp}`;
    const bingoAllId = `bingo-all-${timestamp}`;
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingo1Id).set({
      classId: classA,
      studentUid: student1Uid,
      status: 'pending',
      question: 'What is cloud computing?',
    });
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingo2Id).set({
      classId: classA,
      studentUid: student2Uid,
      status: 'pending',
      question: 'What is virtualization?',
    });
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingoAllId).set({
      classId: classA,
      studentUid: 'all',
      status: 'active',
      question: 'QR Bingo Challenge',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingo1Id)),
      'Student 1 CAN read own bingoRecords in enrolled Class A'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingo2Id)),
      'Student 1 CANNOT read Student 2 bingoRecords in Class A'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingoAllId)),
      'Student 1 CANNOT read shared bingoRecords with studentUid == "all"'
    );
    // Bingo records write protection (Student cannot write/update/delete)
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingo1Id), { result: 'passed' }),
      'Student 1 CANNOT update bingoRecords (tampering protection)'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'classes', classA, 'bingoRecords', `fake-${timestamp}`), {
        classId: classA,
        studentUid: student1Uid,
        result: 'passed',
      }),
      'Student 1 CANNOT create fake bingoRecords'
    );
    await expectPermissionDenied(
      deleteDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingo1Id)),
      'Student 1 CANNOT delete bingoRecords'
    );

    // Attendance Adjustments isolation
    const adj1Id = `adj-1-${timestamp}`;
    const adj2Id = `adj-2-${timestamp}`;
    await adminDb.collection('classes').doc(classA).collection('attendanceAdjustments').doc(adj1Id).set({
      classId: classA,
      studentUid: student1Uid,
      deductedMinutes: 6,
      reason: 'Missed 2 consecutive Bingo checks (AFK/Decoy)',
    });
    await adminDb.collection('classes').doc(classA).collection('attendanceAdjustments').doc(adj2Id).set({
      classId: classA,
      studentUid: student2Uid,
      deductedMinutes: 6,
      reason: 'Missed 2 consecutive Bingo checks (AFK/Decoy)',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'attendanceAdjustments', adj1Id)),
      'Student 1 CAN read own attendanceAdjustments in enrolled Class A'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'attendanceAdjustments', adj2Id)),
      'Student 1 CANNOT read Student 2 attendanceAdjustments in Class A'
    );
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'classes', classA, 'attendanceAdjustments', adj1Id), { deductedMinutes: 0 }),
      'Student 1 CANNOT update attendanceAdjustments'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'classes', classA, 'attendanceAdjustments', `fake-adj-${timestamp}`), {
        classId: classA,
        studentUid: student1Uid,
        deductedMinutes: 0,
      }),
      'Student 1 CANNOT create fake attendanceAdjustments'
    );

    // Audio Audits subcollection isolation
    const audit1Id = student1Uid;
    const audit2Id = student2Uid;
    await adminDb.collection('classes').doc(classA).collection('audio_audits').doc(audit1Id).set({
      classId: classA,
      studentUid: student1Uid,
      verdict: 'clean_exam',
      speakerCount: 1,
    });
    await adminDb.collection('classes').doc(classA).collection('audio_audits').doc(audit2Id).set({
      classId: classA,
      studentUid: student2Uid,
      verdict: 'suspicious_collaboration',
      speakerCount: 2,
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'audio_audits', audit1Id)),
      'Student 1 CAN read own audio_audits in enrolled Class A'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'audio_audits', audit2Id)),
      'Student 1 CANNOT read Student 2 audio_audits in Class A'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'classes', classA, 'audio_audits', `fake-audit-${timestamp}`), {
        classId: classA,
        studentUid: student1Uid,
      }),
      'Student 1 CANNOT create audio_audits'
    );

    // Users directory permissions
    await adminDb.collection('users').doc(student1Uid).set({
      email: student1Email,
      role: 'student',
    });
    await adminDb.collection('users').doc(student2Uid).set({
      email: student2Email,
      role: 'student',
    });
    await adminDb.collection('users').doc(teacherUid).set({
      email: teacherEmail,
      role: 'teacher',
    });
    await expectAllowed(
      getDoc(doc(clientDb, 'users', student1Uid)),
      'Student 1 CAN read own user document'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'users', student2Uid)),
      'Student 1 CANNOT read Student 2 user document'
    );
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'users', student1Uid), { role: 'teacher' }),
      'Student 1 CANNOT escalate role in users document'
    );

    // -------------------------------------------------------------
    // SUITE 3: Teacher Role Privileges
    // -------------------------------------------------------------
    console.log(`\n👨‍🏫 SUITE 3: Teacher Role Privileges`);
    await signInWithEmailAndPassword(clientAuth, teacherEmail, defaultPassword);

    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA)),
      'Teacher can read Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classB)),
      'Teacher can read Class B'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'screenshots', shotDocId)),
      'Teacher can read student screenshot documents'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'audio', audio1DocId)),
      'Teacher can read student audio metadata documents'
    );
    await expectAllowed(
      updateDoc(doc(clientDb, 'classes', classA), { frameRate: 15 }),
      'Teacher can update class monitoring settings'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'lessons', lesson1Id)),
      'Teacher can read lessons in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'projectGroups', projGroupId)),
      'Teacher can read projectGroups in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'projectMeetings', projMeetingId)),
      'Teacher can read projectMeetings in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'projectStudentProfiles', projProfileId)),
      'Teacher can read projectStudentProfiles in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'bingoRecords', bingo1Id)),
      'Teacher can read bingoRecords in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'attendanceAdjustments', adj1Id)),
      'Teacher can read attendanceAdjustments in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'audio_audits', audit1Id)),
      'Teacher can read audio_audits in Class A'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'users', student1Uid)),
      'Teacher can read student user document'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'studentDirectory', student1Email)),
      'Teacher can read studentDirectory'
    );
    await expectAllowed(
      setDoc(doc(clientDb, 'studentDirectory', student1Email), { email: student1Email, studentName: 'Teacher Updated Name' }),
      'Teacher can write studentDirectory'
    );

    // Passkey Security & Whitelist Verification
    console.log(`\n🔑 Testing Passkey Security Rules & Whitelist Permissions...`);
    const passkeyStudent1Id = student1Uid;
    const loginSessionId = `test-session-${timestamp}`;
    const pairingTokenId = `test-token-${timestamp}`;
    const auditLogId = `test-audit-${timestamp}`;

    // Admin seeds fixture docs (preserve existing system_config docs for cleanup)
    const prevLoginPolicySnap = await adminDb.collection('system_config').doc('loginPolicy').get();
    await adminDb.collection('studentPasskeys').doc(passkeyStudent1Id).set({ credentialID: 'cred-1', studentUid: student1Uid });
    await adminDb.collection('loginSessions').doc(loginSessionId).set({ status: 'pending', expiresAtMillis: Date.now() + 90000 });
    await adminDb.collection('passkeyPairingTokens').doc(pairingTokenId).set({ token: 'xyz', studentUid: student1Uid });
    await adminDb.collection('passkeyAuditLogs').doc(auditLogId).set({ action: 'login', studentUid: student1Uid });
    await adminDb.collection('system_config').doc('loginPolicy').set({ passwordWhitelist: [student1Email] });
    const prevClientControlSnap = await adminDb.collection('system_config').doc('clientControl').get();
    if (!prevClientControlSnap.exists) {
      await adminDb.collection('system_config').doc('clientControl').set({ forceReloadBefore: 0 });
    }

    // 1. Teacher permissions
    await expectAllowed(
      getDoc(doc(clientDb, 'studentPasskeys', passkeyStudent1Id)),
      'Teacher can read studentPasskeys'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'studentPasskeys', passkeyStudent1Id), { hacked: true }),
      'Teacher client CANNOT write to studentPasskeys directly (backend only)'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'passkeyAuditLogs', auditLogId)),
      'Teacher can read passkeyAuditLogs'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'system_config', 'loginPolicy')),
      'Teacher can read system_config/loginPolicy'
    );

    // 2. Student 1 permissions
    await signInWithEmailAndPassword(clientAuth, student1Email, defaultPassword);
    await expectAllowed(
      getDoc(doc(clientDb, 'studentPasskeys', passkeyStudent1Id)),
      'Student can read their OWN studentPasskey doc'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'studentPasskeys', passkeyStudent1Id), { hacked: true }),
      'Student CANNOT write to studentPasskeys directly'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'passkeyAuditLogs', auditLogId)),
      'Student CANNOT read passkeyAuditLogs'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'passkeyPairingTokens', pairingTokenId)),
      'Student CANNOT read passkeyPairingTokens directly'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'system_config', 'loginPolicy')),
      'Student CANNOT read system_config/loginPolicy (whitelist PII protection)'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'system_config', 'clientControl')),
      'Student CAN read system_config/clientControl'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'system_config', 'loginPolicy'), { passwordWhitelist: [] }),
      'Student CANNOT write to system_config/loginPolicy'
    );

    // 3. Student 2 permissions on Student 1 passkey
    await signInWithEmailAndPassword(clientAuth, student2Email, defaultPassword);
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentPasskeys', passkeyStudent1Id)),
      'Student 2 CANNOT read Student 1 passkey document'
    );

    // 4. Unauthenticated permissions (Lab PC QR Screen)
    await signOut(clientAuth);
    await expectAllowed(
      getDoc(doc(clientDb, 'loginSessions', loginSessionId)),
      'Unauthenticated desktop PC can get single loginSessions doc for QR login'
    );
    await expectPermissionDenied(
      getDocs(collection(clientDb, 'loginSessions')),
      'Unauthenticated user CANNOT list loginSessions collection (customToken enumeration protection)'
    );
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'loginSessions', loginSessionId), { customToken: 'fake' }),
      'Unauthenticated desktop PC CANNOT write to loginSessions directly'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'system_config', 'loginPolicy')),
      'Unauthenticated user CANNOT read system_config/loginPolicy'
    );
    await expectPermissionDenied(
      getDocs(collection(clientDb, 'system_config')),
      'Unauthenticated user CANNOT list system_config collection'
    );
    await expectAllowed(
      getDoc(doc(clientDb, 'system_config', 'clientControl')),
      'Unauthenticated user CAN read system_config/clientControl'
    );

    // -------------------------------------------------------------
    // SUITE 5: Lecture Recordings & Prompt Library Security
    // -------------------------------------------------------------
    console.log(`\n🎬 SUITE 5: Lecture Recordings & Prompt Library Security Permissions...`);

    const systemPromptId = `sys-lecture-prompt-${timestamp}`;
    const teacherCustomPromptId = `teacher-prompt-${timestamp}`;
    const recPrivateId = `rec-private-${timestamp}`;
    const recSharedId = `rec-shared-${timestamp}`;

    // Admin seeds system prompt & fixture recordings
    await adminDb.collection('prompts').doc(systemPromptId).set({
      name: 'System Lecture Subtitle Synthesizer',
      promptText: 'System instructions for lecture transcription',
      category: 'translations',
      applyTo: ['Lecture Subtitles & Chapters'],
      accessLevel: 'public',
      isSystem: true,
      owner: 'system',
      createdAt: FieldValue.serverTimestamp()
    });

    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recPrivateId).set({
      title: 'Private Lecture Recording',
      status: 'ready',
      subtitlesStatus: 'ready',
      subtitlesDisabled: true,
      isSharedWithStudents: false,
      createdAt: FieldValue.serverTimestamp()
    });

    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recSharedId).set({
      title: 'Shared Lecture Recording',
      status: 'ready',
      subtitlesStatus: 'ready',
      isSharedWithStudents: true,
      createdAt: FieldValue.serverTimestamp()
    });

    const recExamId = `rec-exam-${timestamp}`;
    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recExamId).set({
      title: 'Exam Period Lecture Recording',
      status: 'ready',
      subtitlesStatus: 'ready',
      isSharedWithStudents: true,
      isExamPeriod: true,
      createdAt: FieldValue.serverTimestamp()
    });

    // Sign in as Teacher
    await signInWithEmailAndPassword(clientAuth, teacherEmail, defaultPassword);

    // 1. Teacher can read system prompt
    await expectAllowed(
      getDoc(doc(clientDb, 'prompts', systemPromptId)),
      'Teacher can read system prompt template'
    );

    // 2. Teacher CANNOT tamper with or overwrite system prompts
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'prompts', systemPromptId), { promptText: 'Hacked prompt' }),
      'Teacher CANNOT update system prompt (system template immutability)'
    );
    await expectPermissionDenied(
      deleteDoc(doc(clientDb, 'prompts', systemPromptId)),
      'Teacher CANNOT delete system prompt'
    );

    // 3. Teacher can create custom prompt
    await expectAllowed(
      setDoc(doc(clientDb, 'prompts', teacherCustomPromptId), {
        name: 'Teacher Custom Translation Rules',
        promptText: 'Custom instructions',
        category: 'translations',
        applyTo: ['Lecture Subtitles & Chapters'],
        accessLevel: 'private',
        isSystem: false,
        owner: teacherUid,
      }),
      'Teacher can create custom private prompt'
    );

    // 4. Teacher CANNOT set isSystem: true when creating prompt
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'prompts', `fake-sys-${timestamp}`), {
        name: 'Fake System Prompt',
        promptText: 'Fake',
        category: 'translations',
        isSystem: true,
        owner: teacherUid,
        accessLevel: 'public',
      }),
      'Teacher CANNOT forge isSystem: true on prompt creation'
    );

    // 5. Teacher can update their own custom prompt
    await expectAllowed(
      updateDoc(doc(clientDb, 'prompts', teacherCustomPromptId), {
        promptText: 'Updated custom instructions',
      }),
      'Teacher can update their own prompt'
    );

    // 6. Teacher can read & update lectureRecordings in their class
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recPrivateId)),
      'Teacher can read private lecture recording in Class A'
    );
    await expectAllowed(
      updateDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recPrivateId), {
        subtitlesDisabled: false,
        subtitlesStatus: 'generating_subtitles'
      }),
      'Teacher can update lecture recording subtitles status in Class A'
    );

    // 7. Teacher can update class-level lecture subtitle settings
    await expectAllowed(
      updateDoc(doc(clientDb, 'classes', classA), {
        isLectureSubtitlesEnabled: false,
        lectureAiModel: 'gemini-3.8-flash',
        lectureTargetLanguages: ['en', 'zh-Hant', 'zh-Hans'],
        lectureRecordingPrompt: { name: 'Custom', promptText: 'Rules' }
      }),
      'Teacher can save class-level lecture subtitle and translation settings'
    );

    // 8. Sign in as Student 1 (Enrolled in Class A)
    await signInWithEmailAndPassword(clientAuth, student1Email, defaultPassword);

    // Student CANNOT tamper with lectureRecordings
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recPrivateId), { status: 'deleted' }),
      'Student CANNOT update lecture recordings in Class A'
    );
    await expectPermissionDenied(
      deleteDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recPrivateId)),
      'Student CANNOT delete lecture recordings in Class A'
    );

    // Student CANNOT read private unshared lecture recording
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recPrivateId)),
      'Student CANNOT read unshared private lecture recording'
    );

    // Student CAN read shared lecture recording
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recSharedId)),
      'Student CAN read shared lecture recording in enrolled class'
    );

    // Student CANNOT read exam period lecture recording even if marked isSharedWithStudents: true
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classA, 'lectureRecordings', recExamId)),
      'Student CANNOT read exam period lecture recording'
    );

    // Student CANNOT create prompts
    await expectPermissionDenied(
      setDoc(doc(clientDb, 'prompts', `student-prompt-${timestamp}`), {
        name: 'Student Prompt',
        promptText: 'test',
        owner: student1Uid,
        accessLevel: 'private'
      }),
      'Student CANNOT create prompts in prompt library'
    );

    // Cleanup prompt & recording fixtures
    await adminDb.collection('prompts').doc(systemPromptId).delete().catch(() => {});
    await adminDb.collection('prompts').doc(teacherCustomPromptId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recPrivateId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recSharedId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('lectureRecordings').doc(recExamId).delete().catch(() => {});

    // -------------------------------------------------------------
    // SUITE 6: Cloud Storage Cross-Service & Screen Broadcast Security
    // -------------------------------------------------------------
    console.log(`\n📦 SUITE 6: Cloud Storage & Screen Broadcast Security Rules...`);
    const sampleJpg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const sampleAudio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

    // Ensure classA includes studentEmails too so both email and UID lookup paths are exercised
    await adminDb.collection('classes').doc(classA).update({
      studentEmails: [student1Email],
    });
    await new Promise(r => setTimeout(r, 800));

    // Teacher uploads slide image to broadcasts/classA and obtains tokenized download URL
    await signInWithEmailAndPassword(clientAuth, teacherEmail, defaultPassword);
    const broadcastRef = ref(clientStorage, `broadcasts/${classA}/slide_${timestamp}_r99.jpg`);
    let broadcastTokenUrl = null;
    try {
      await uploadBytes(broadcastRef, sampleJpg, { contentType: 'image/jpeg' });
      broadcastTokenUrl = await getDownloadURL(broadcastRef);
      assert(broadcastTokenUrl.includes('token='), 'Teacher can upload slide to broadcasts/classA and obtain token URL');
    } catch (err) {
      assert(false, `Teacher can upload slide to broadcasts/classA and obtain token URL (Failed with: ${err.message})`);
    }

    if (broadcastTokenUrl) {
      const noTokenUrl = broadcastTokenUrl.split('&token=')[0];
      const withTokRes = await fetch(broadcastTokenUrl);
      const noTokRes = await fetch(noTokenUrl);
      assert(withTokRes.status === 200, `Tokenized broadcast slide HTTPS GET returns 200 (got ${withTokRes.status})`);
      assert(noTokRes.status === 403, `Un-tokenized broadcast slide HTTPS GET returns 403 (got ${noTokRes.status})`);
    }

    // Teacher can upload own preview screenshot in classA
    const teacherShotRef = ref(clientStorage, `screenshots/${classA}/${teacherUid}/preview_${timestamp}.jpg`);
    await expectAllowed(
      uploadBytes(teacherShotRef, sampleJpg, { contentType: 'image/jpeg' }),
      'Teacher can upload preview screenshot in enrolled classA'
    );

    // Enrolled Student 1 Storage permissions
    await signInWithEmailAndPassword(clientAuth, student1Email, defaultPassword);
    await expectPermissionDenied(
      getBytes(broadcastRef),
      'Enrolled Student 1 CANNOT read broadcasts/classA via Storage SDK'
    );
    await expectPermissionDenied(
      uploadBytes(broadcastRef, sampleJpg, { contentType: 'image/jpeg' }),
      'Enrolled Student 1 CANNOT write broadcasts/classA'
    );
    await expectPermissionDenied(
      deleteObject(broadcastRef),
      'Enrolled Student 1 CANNOT delete broadcasts/classA'
    );

    const stu1ShotRef = ref(clientStorage, `screenshots/${classA}/${student1Uid}/s_${timestamp}.jpg`);
    await expectAllowed(
      uploadBytes(stu1ShotRef, sampleJpg, { contentType: 'image/jpeg' }),
      'Enrolled Student 1 CAN upload own screenshot to screenshots/classA'
    );
    await expectAllowed(
      getDownloadURL(stu1ShotRef),
      'Enrolled Student 1 CAN read own screenshot URL in screenshots/classA'
    );

    const stu1AudioRef = ref(clientStorage, `audio/${classA}/${student1Uid}/a_${timestamp}.webm`);
    await expectAllowed(
      uploadBytes(stu1AudioRef, sampleAudio, { contentType: 'audio/webm' }),
      'Enrolled Student 1 CAN upload audio segment to audio/classA'
    );

    const stu1IrrRef = ref(clientStorage, `irregularities/${classA}/${student1Uid}/irr_${timestamp}.jpg`);
    await expectAllowed(
      uploadBytes(stu1IrrRef, sampleJpg, { contentType: 'image/jpeg' }),
      'Enrolled Student 1 CAN upload evidence to irregularities/classA'
    );

    await expectPermissionDenied(
      uploadBytes(ref(clientStorage, `screenshots/${classA}/${student2Uid}/spoof_${timestamp}.jpg`), sampleJpg, { contentType: 'image/jpeg' }),
      'Student 1 CANNOT upload screenshot into Student 2 UID path'
    );

    // Non-enrolled Student 2 blocked from classA Storage
    await signInWithEmailAndPassword(clientAuth, student2Email, defaultPassword);
    await expectPermissionDenied(
      uploadBytes(ref(clientStorage, `screenshots/${classA}/${student2Uid}/outsider_${timestamp}.jpg`), sampleJpg, { contentType: 'image/jpeg' }),
      'Non-enrolled Student 2 CANNOT upload screenshot into classA'
    );
    await expectPermissionDenied(
      uploadBytes(ref(clientStorage, `audio/${classA}/${student2Uid}/outsider_${timestamp}.webm`), sampleAudio, { contentType: 'audio/webm' }),
      'Non-enrolled Student 2 CANNOT upload audio into classA'
    );

    // Unauthenticated user blocked from Storage SDK reads/writes
    await signOut(clientAuth);
    await expectPermissionDenied(
      getDownloadURL(broadcastRef),
      'Unauthenticated user CANNOT call Storage SDK getDownloadURL on broadcasts/'
    );
    await expectPermissionDenied(
      uploadBytes(broadcastRef, sampleJpg, { contentType: 'image/jpeg' }),
      'Unauthenticated user CANNOT write broadcasts/'
    );

    // Cleanup Storage fixture objects as Teacher
    await signInWithEmailAndPassword(clientAuth, teacherEmail, defaultPassword);
    await expectAllowed(
      Promise.all([
        deleteObject(broadcastRef),
        deleteObject(teacherShotRef),
        deleteObject(stu1ShotRef),
        deleteObject(stu1AudioRef),
        deleteObject(stu1IrrRef),
      ]),
      'Teacher can delete Storage test objects in classA'
    );

    // -------------------------------------------------------------
    // Cleanup Fixture Documents & Users
    // -------------------------------------------------------------
    console.log(`\n🧹 Cleaning up test fixtures...`);
    if (prevLoginPolicySnap.exists) {
      await adminDb.collection('system_config').doc('loginPolicy').set(prevLoginPolicySnap.data());
    } else {
      await adminDb.collection('system_config').doc('loginPolicy').delete().catch(() => {});
    }
    if (!prevClientControlSnap.exists) {
      await adminDb.collection('system_config').doc('clientControl').delete().catch(() => {});
    }
    await adminDb.collection('studentPasskeys').doc(passkeyStudent1Id).delete().catch(() => {});
    await adminDb.collection('loginSessions').doc(loginSessionId).delete().catch(() => {});
    await adminDb.collection('passkeyPairingTokens').doc(pairingTokenId).delete().catch(() => {});
    await adminDb.collection('passkeyAuditLogs').doc(auditLogId).delete().catch(() => {});
    await adminDb.collection('studentDirectory').doc(student1Email).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('studentConfig').doc('public').delete().catch(() => {});
    await adminDb.collection('classes').doc(classB).collection('studentConfig').doc('public').delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('projectGroups').doc(projGroupId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('projectMeetings').doc(projMeetingId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('projectStudentProfiles').doc(projProfileId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingoAllId).delete().catch(() => {});
    await adminDb.collection('classes').doc(classA).delete();
    await adminDb.collection('classes').doc(classB).delete();
    await adminDb.collection('studentProfiles').doc(student1Uid).delete();
    await adminDb.collection('studentProfiles').doc(student2Uid).delete();
    await adminDb.collection('screenshots').doc(shotDocId).delete();
    await adminDb.collection('audio').doc(audio1DocId).delete();
    await adminDb.collection('audio').doc(audio2DocId).delete();
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingo1Id).delete();
    await adminDb.collection('classes').doc(classA).collection('bingoRecords').doc(bingo2Id).delete();
    await adminDb.collection('classes').doc(classA).collection('attendanceAdjustments').doc(adj1Id).delete();
    await adminDb.collection('classes').doc(classA).collection('attendanceAdjustments').doc(adj2Id).delete();
    await adminDb.collection('classes').doc(classA).collection('audio_audits').doc(audit1Id).delete();
    await adminDb.collection('classes').doc(classA).collection('audio_audits').doc(audit2Id).delete();
    await adminDb.collection('users').doc(student1Uid).delete();
    await adminDb.collection('users').doc(student2Uid).delete();
    await adminDb.collection('users').doc(teacherUid).delete();
    await adminDb.collection('videoJobs').doc(videoJob1Id).delete();
    await adminDb.collection('videoJobs').doc(videoJob2Id).delete();
    await adminDb.collection('aiJobs').doc(aiJob1Id).delete();
    await adminDb.collection('aiJobs').doc(aiJob2Id).delete();
    await adminDb.collection('performanceMetrics').doc(metric1Id).delete();
    await adminDb.collection('performanceMetrics').doc(metric2Id).delete();
    await adminDb.collection('classes').doc(classA).collection('lessons').doc(lesson1Id).delete();
    await adminDb.collection('classes').doc(classB).collection('lessons').doc(lesson2Id).delete();
    await adminAuth.deleteUser(student1Uid).catch(() => {});
    await adminAuth.deleteUser(student2Uid).catch(() => {});
    await adminAuth.deleteUser(teacherUid).catch(() => {});

  } catch (error) {
    console.error('Fatal error during security rules test suite:', error);
    failed++;
  }

  console.log(`\n========================================================`);
  console.log(`🛡️  SECURITY RULES SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================================\n`);

  if (failed > 0) process.exit(1);
  process.exit(0);
}

runSecurityRulesSuite();
