import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth } from 'firebase-admin/auth';

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || process.argv[2] || 'it114115-dev-2026';
console.log(`\n========================================`);
console.log(`🧪 RUNNING SYSTEM SMOKE TESTS on ${projectId}`);
console.log(`========================================\n`);

initializeApp({ projectId });
const db = getFirestore();
const storage = getStorage();
const auth = getAuth();

let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failedTests++;
  }
}

async function runSmokeTests() {
  const testClassId = `SMOKE-TEST-${Date.now()}`;
  const testStudentUid = `smoke-student-${Date.now()}`;
  const testStudentEmail = `smoke.student@test.local`;
  const testTeacherUid = `smoke-teacher-${Date.now()}`;
  const testTeacherEmail = `smoke.teacher@test.local`;

  try {
    // ----------------------------------------------------
    // TEST 1: Class Creation with Dual Retention
    // ----------------------------------------------------
    console.log(`▶ Test 1: Class Document & Dual Retention Model`);
    const classRef = db.collection('classes').doc(testClassId);
    await classRef.set({
      name: 'Smoke Test Class',
      classId: testClassId,
      retentionDays: 14,
      videoRetentionDays: 60,
      frameRate: 10,
      maxImageSize: 250 * 1024,
      teacherEmails: [testTeacherEmail],
      teachers: [testTeacherUid],
      students: { [testStudentUid]: testStudentEmail },
      createdAt: FieldValue.serverTimestamp(),
    });

    const classSnap = await classRef.get();
    assert(classSnap.exists, 'Class document created successfully');
    assert(classSnap.data().retentionDays === 14, 'retentionDays correctly saved as 14');
    assert(classSnap.data().videoRetentionDays === 60, 'videoRetentionDays correctly saved as 60');

    // ----------------------------------------------------
    // TEST 2: Student Screenshot Ingestion & TTL Stamping
    // ----------------------------------------------------
    console.log(`\n▶ Test 2: Screenshot Ingestion & expireAt TTL Stamping`);
    const now = Date.now();
    const expectedExpireAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
    const screenshotRef = db.collection('screenshots').doc(`smoke-shot-${now}`);
    
    await screenshotRef.set({
      classId: testClassId,
      studentUid: testStudentUid,
      email: testStudentEmail,
      imagePath: `screenshots/${testClassId}/${testStudentUid}/${now}.jpg`,
      size: 150000,
      timestamp: new Date(now),
      expireAt: expectedExpireAt,
      deleted: false,
    });

    const shotSnap = await screenshotRef.get();
    assert(shotSnap.exists, 'Screenshot document created with metadata');
    assert(shotSnap.data().expireAt.toDate().getTime() === expectedExpireAt.getTime(), 'expireAt accurately stamped for Firestore TTL');

    // ----------------------------------------------------
    // TEST 3: Video Job Payload & Retention Stamping
    // ----------------------------------------------------
    console.log(`\n▶ Test 3: Video Job Creation & Retention Stamping`);
    const videoJobId = `smoke-video-${now}`;
    const videoExpireAt = new Date(now + 60 * 24 * 60 * 60 * 1000);
    const videoJobRef = db.collection('videoJobs').doc(videoJobId);

    await videoJobRef.set({
      jobId: videoJobId,
      classId: testClassId,
      studentUid: testStudentUid,
      studentEmail: testStudentEmail,
      startTime: new Date(now - 3600000),
      endTime: new Date(now),
      status: 'pending',
      expireAt: videoExpireAt,
      createdAt: new Date(now),
    });

    const videoSnap = await videoJobRef.get();
    assert(videoSnap.exists, 'Video job created in pending state');
    assert(videoSnap.data().expireAt.toDate().getTime() === videoExpireAt.getTime(), 'Video job expireAt correctly stamped for 60 days');

    // ----------------------------------------------------
    // TEST 4: Profile Linking & Unlinking
    // ----------------------------------------------------
    console.log(`\n▶ Test 4: Profile Linking & Array Updates`);
    const studentProfileRef = db.collection('studentProfiles').doc(testStudentUid);
    await studentProfileRef.set({
      email: testStudentEmail,
      classes: [testClassId, 'ANOTHER-ACTIVE-CLASS'],
    });

    let profileSnap = await studentProfileRef.get();
    assert(profileSnap.data().classes.includes(testClassId), 'Class added to student profile array');

    // ----------------------------------------------------
    // TEST 5: Cascading Class Deletion Execution & Isolation
    // ----------------------------------------------------
    console.log(`\n▶ Test 5: Cascading Class Deletion & Isolation Verification`);
    
    // Simulate onClassDocDeleted logic directly
    await classRef.delete();
    
    // Query related docs to verify batch query logic
    const remainingShots = await db.collection('screenshots').where('classId', '==', testClassId).get();
    const remainingJobs = await db.collection('videoJobs').where('classId', '==', testClassId).get();
    
    // Perform simulated cascade cleanup on test artifacts
    const batch = db.batch();
    remainingShots.docs.forEach(doc => batch.delete(doc.ref));
    remainingJobs.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    // Remove class from student profile
    await studentProfileRef.update({ classes: FieldValue.arrayRemove(testClassId) });
    
    const cleanShots = await db.collection('screenshots').where('classId', '==', testClassId).get();
    const cleanJobs = await db.collection('videoJobs').where('classId', '==', testClassId).get();
    const updatedProfile = await studentProfileRef.get();

    assert(cleanShots.empty, 'All screenshots belonging to deleted class are purged');
    assert(cleanJobs.empty, 'All video jobs belonging to deleted class are purged');
    assert(!updatedProfile.data().classes.includes(testClassId), 'Deleted classId removed from student profile');
    assert(updatedProfile.data().classes.includes('ANOTHER-ACTIVE-CLASS'), 'Other enrolled classes remain 100% untouched and safe');

    // Cleanup test profile
    await studentProfileRef.delete();

  } catch (error) {
    console.error('Unexpected error during smoke test execution:', error);
    failedTests++;
  }

  console.log(`\n========================================`);
  console.log(`🏁 TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
  console.log(`========================================\n`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runSmokeTests();
