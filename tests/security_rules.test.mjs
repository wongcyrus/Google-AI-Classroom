import { initializeApp as initAdmin } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore, FieldValue } from 'firebase-admin/firestore';
import { initializeApp as initClient } from 'firebase/app';
import { getAuth as getClientAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import { getFirestore as getClientFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || 'it114115-dev-2026';

console.log(`\n========================================================`);
console.log(`🛡️  RUNNING REAL-TOKEN SECURITY RULES VERIFICATION (${projectId})`);
console.log(`========================================================\n`);

// Initialize Admin SDK for setup and token minting
const adminApp = initAdmin({ projectId }, 'adminApp_' + Date.now());
const adminAuth = getAdminAuth(adminApp);
const adminDb = getAdminFirestore(adminApp);

// Initialize Client SDK (Enforces all Firestore Security Rules!)
const clientApp = initClient({
  projectId: projectId,
  apiKey: "AIzaSyFakeKeyForRulesValidationOnly",
  authDomain: `${projectId}.firebaseapp.com`,
}, 'clientApp_' + Date.now());
const clientAuth = getClientAuth(clientApp);
const clientDb = getClientFirestore(clientApp);

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
  const teacherEmail = `sec.teacher.${timestamp}@test.local`;
  const student1Email = `sec.student1.${timestamp}@test.local`;
  const student2Email = `sec.student2.${timestamp}@test.local`;

  try {
    console.log(`🔧 Setting up test fixture documents in Firestore...`);
    
    // Setup Class A with Student 1 enrolled
    await adminDb.collection('classes').doc(classA).set({
      classId: classA,
      name: 'Security Test Class A',
      teacherEmails: [teacherEmail],
      teachers: [teacherUid],
      students: { [student1Uid]: student1Email },
      createdAt: FieldValue.serverTimestamp()
    });

    // Setup Class B with Student 2 enrolled
    await adminDb.collection('classes').doc(classB).set({
      classId: classB,
      name: 'Security Test Class B',
      teacherEmails: [teacherEmail],
      teachers: [teacherUid],
      students: { [student2Uid]: student2Email },
      createdAt: FieldValue.serverTimestamp()
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

    // Mint Custom Tokens
    console.log(`🔑 Minting custom role tokens...`);
    const student1Token = await adminAuth.createCustomToken(student1Uid, { role: 'student', email: student1Email });
    const teacherToken = await adminAuth.createCustomToken(teacherUid, { role: 'teacher', email: teacherEmail });

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

    // -------------------------------------------------------------
    // SUITE 2: Student Access & Isolation Rules
    // -------------------------------------------------------------
    console.log(`\n🎓 SUITE 2: Student Permissions & Isolation (Student 1)`);
    await signInWithCustomToken(clientAuth, student1Token);

    // Profile isolation
    await expectAllowed(
      getDoc(doc(clientDb, 'studentProfiles', student1Uid)),
      'Student 1 can read own student profile'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'studentProfiles', student2Uid)),
      'Student 1 CANNOT read Student 2 profile'
    );

    // Class enrollment isolation
    await expectAllowed(
      getDoc(doc(clientDb, 'classes', classA)),
      'Student 1 can read enrolled Class A'
    );
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'classes', classB)),
      'Student 1 CANNOT read non-enrolled Class B'
    );

    // Tampering prevention
    await expectPermissionDenied(
      updateDoc(doc(clientDb, 'classes', classA), { frameRate: 1 }),
      'Student 1 CANNOT tamper with class settings (frameRate)'
    );

    // Screenshot privacy protection
    await expectPermissionDenied(
      getDoc(doc(clientDb, 'screenshots', shotDocId)),
      'Student 1 CANNOT query screenshots collection directly'
    );

    // -------------------------------------------------------------
    // SUITE 3: Teacher Role Privileges
    // -------------------------------------------------------------
    console.log(`\n👨‍🏫 SUITE 3: Teacher Role Privileges`);
    await signInWithCustomToken(clientAuth, teacherToken);

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
      updateDoc(doc(clientDb, 'classes', classA), { frameRate: 15 }),
      'Teacher can update class monitoring settings'
    );

    // -------------------------------------------------------------
    // Cleanup Fixture Documents
    // -------------------------------------------------------------
    console.log(`\n🧹 Cleaning up test fixtures...`);
    await adminDb.collection('classes').doc(classA).delete();
    await adminDb.collection('classes').doc(classB).delete();
    await adminDb.collection('studentProfiles').doc(student1Uid).delete();
    await adminDb.collection('studentProfiles').doc(student2Uid).delete();
    await adminDb.collection('screenshots').doc(shotDocId).delete();

  } catch (error) {
    console.error('Fatal error during security rules test suite:', error);
    failed++;
  }

  console.log(`\n========================================================`);
  console.log(`🛡️  SECURITY RULES SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log(`========================================================\n`);

  if (failed > 0) process.exit(1);
}

runSecurityRulesSuite();
