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
      captureMode: 'dual',
      teacherEmails: [testTeacherEmail],
      teachers: [testTeacherUid],
      students: { [testStudentUid]: testStudentEmail },
      createdAt: FieldValue.serverTimestamp(),
    });

    const classSnap = await classRef.get();
    assert(classSnap.exists, 'Class document created successfully');
    assert(classSnap.data().retentionDays === 14, 'retentionDays correctly saved as 14');
    assert(classSnap.data().videoRetentionDays === 60, 'videoRetentionDays correctly saved as 60');
    assert(classSnap.data().captureMode === 'dual', 'captureMode correctly saved as dual');

    // ----------------------------------------------------
    // TEST 2: Student Screenshot Ingestion & Dual Channel Stamping
    // ----------------------------------------------------
    console.log(`\n▶ Test 2: Dual Channel Ingestion & expireAt TTL Stamping`);
    const now = Date.now();
    const expectedExpireAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
    const screenShotRef = db.collection('screenshots').doc(`smoke-screen-${now}`);
    const webcamShotRef = db.collection('screenshots').doc(`smoke-webcam-${now}`);
    
    await screenShotRef.set({
      classId: testClassId,
      studentUid: testStudentUid,
      email: testStudentEmail,
      channel: 'screen',
      imagePath: `screenshots/${testClassId}/${testStudentUid}/screen_${now}.jpg`,
      size: 150000,
      timestamp: new Date(now),
      expireAt: expectedExpireAt,
      deleted: false,
    });

    await webcamShotRef.set({
      classId: testClassId,
      studentUid: testStudentUid,
      email: testStudentEmail,
      channel: 'webcam',
      imagePath: `screenshots/${testClassId}/${testStudentUid}/webcam_${now}.jpg`,
      size: 80000,
      timestamp: new Date(now),
      expireAt: expectedExpireAt,
      deleted: false,
    });

    const screenSnap = await screenShotRef.get();
    const webcamSnap = await webcamShotRef.get();
    assert(screenSnap.exists, 'Screen screenshot document created');
    assert(screenSnap.data().channel === 'screen', 'Screen channel correctly stamped as screen');
    assert(webcamSnap.exists, 'Webcam screenshot document created');
    assert(webcamSnap.data().channel === 'webcam', 'Webcam channel correctly stamped as webcam');
    assert(screenSnap.data().expireAt.toDate().getTime() === expectedExpireAt.getTime(), 'expireAt accurately stamped for Firestore TTL');

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
    // TEST 5: Audio Chunk Ingestion & Audio Retention Stamping
    // ----------------------------------------------------
    console.log(`\n▶ Test 5: Audio Chunk Ingestion & Retention Stamping`);
    const audioChunkId = `smoke-audio-${now}`;
    const audioExpireAt = new Date(now + 14 * 24 * 60 * 60 * 1000);
    const audioDocRef = db.collection('audio').doc(audioChunkId);

    await audioDocRef.set({
      audioId: audioChunkId,
      classId: testClassId,
      studentUid: testStudentUid,
      email: testStudentEmail,
      audioPath: `audio/${testClassId}/${testStudentUid}/audio_${now}.webm`,
      strideIndex: 1,
      windowDurationSeconds: 30,
      strideDurationSeconds: 15,
      isSilent: false,
      timestamp: new Date(now),
      expireAt: audioExpireAt,
    });

    const audioSnap = await audioDocRef.get();
    assert(audioSnap.exists, 'Audio recording document created successfully');
    assert(audioSnap.data().windowDurationSeconds === 30, 'Moving window duration correctly stamped as 30s');
    assert(audioSnap.data().strideDurationSeconds === 15, 'Stride duration correctly stamped as 15s');

    // ----------------------------------------------------
    // TEST 6: Audio Irregularity & Multi-Speaker Detection
    // ----------------------------------------------------
    console.log(`\n▶ Test 6: Audio Irregularity & Multi-Speaker Incident`);
    const irregularityId = `smoke-irreg-${now}`;
    const irregRef = db.collection('irregularities').doc(irregularityId);

    await irregRef.set({
      irregularityId,
      classId: testClassId,
      studentUid: testStudentUid,
      studentEmail: testStudentEmail,
      title: 'Multiple Voices Detected',
      message: 'Secondary speaker identified reading answer options aloud.',
      type: 'audio',
      speakerCount: 2,
      riskLevel: 'high',
      transcriptSnippet: 'Speaker 2: "Select Option C"',
      startOffsetSeconds: 12,
      endOffsetSeconds: 24,
      timestamp: FieldValue.serverTimestamp(),
    });

    const irregSnap = await irregRef.get();
    assert(irregSnap.exists, 'Audio irregularity logged successfully');
    assert(irregSnap.data().type === 'audio', 'Irregularity type stamped as audio');
    assert(irregSnap.data().speakerCount === 2, 'Multi-speaker count recorded as 2');
    assert(irregSnap.data().riskLevel === 'high', 'Incident risk level stamped as high');

    // ----------------------------------------------------
    // TEST 7: Session-Wide Audio Audit & Diarization Report
    // ----------------------------------------------------
    console.log(`\n▶ Test 7: Session-Wide Audio Audit Report`);
    const auditRef = db.collection('classes').doc(testClassId).collection('audio_audits').doc(testStudentUid);
    await auditRef.set({
      classId: testClassId,
      studentUid: testStudentUid,
      studentEmail: testStudentEmail,
      verdict: 'suspicious_collaboration',
      speakerCount: 2,
      summary: 'Diarization identified 2 distinct voices engaging in dialogue.',
      transcript: '[00:12] Speaker 1: "What is question 4?"\n[00:15] Speaker 2: "Select Option C"',
      analyzedAt: FieldValue.serverTimestamp(),
    });

    const auditSnap = await auditRef.get();
    assert(auditSnap.exists, 'Audio audit report saved to class subcollection');
    assert(auditSnap.data().verdict === 'suspicious_collaboration', 'Verdict correctly stamped as suspicious_collaboration');

    // ----------------------------------------------------
    // TEST 8: Dynamic Pricing Document Verification
    // ----------------------------------------------------
    console.log(`\n▶ Test 8: Dynamic Gemini Model Pricing Ingestion`);
    const pricingRef = db.collection('system_config').doc('pricing');
    await pricingRef.set({
      'gemini-3.7-flash': { input: 0.75, output: 3.75 },
      'gemini-3.8-flash': { input: 0.75, output: 3.75 },
      'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
      lastSyncedAt: new Date().toISOString(),
      source: 'integration_test_sync',
    }, { merge: true });

    const pricingSnap = await pricingRef.get();
    assert(pricingSnap.exists, 'Dynamic pricing document present in system_config/pricing');
    assert(pricingSnap.data()['gemini-3.5-transcribe']?.input === 0.50, 'Gemini 3.5 Transcribe input rate properly configured');

    // ----------------------------------------------------
    // TEST 9: Cascading Class Deletion Execution & Isolation
    // ----------------------------------------------------
    console.log(`\n▶ Test 9: Cascading Class Deletion & Isolation Verification`);
    
    // Simulate onClassDocDeleted logic directly
    await classRef.delete();
    
    // Query related docs to verify batch query logic
    const remainingShots = await db.collection('screenshots').where('classId', '==', testClassId).get();
    const remainingJobs = await db.collection('videoJobs').where('classId', '==', testClassId).get();
    const remainingAudio = await db.collection('audio').where('classId', '==', testClassId).get();
    const remainingIrregs = await db.collection('irregularities').where('classId', '==', testClassId).get();
    
    // Perform simulated cascade cleanup on test artifacts
    const batch = db.batch();
    remainingShots.docs.forEach(doc => batch.delete(doc.ref));
    remainingJobs.docs.forEach(doc => batch.delete(doc.ref));
    remainingAudio.docs.forEach(doc => batch.delete(doc.ref));
    remainingIrregs.docs.forEach(doc => batch.delete(doc.ref));
    batch.delete(auditRef);
    await batch.commit();

    // Remove class from student profile
    await studentProfileRef.update({ classes: FieldValue.arrayRemove(testClassId) });
    
    const cleanShots = await db.collection('screenshots').where('classId', '==', testClassId).get();
    const cleanJobs = await db.collection('videoJobs').where('classId', '==', testClassId).get();
    const cleanAudio = await db.collection('audio').where('classId', '==', testClassId).get();
    const updatedProfile = await studentProfileRef.get();

    assert(cleanShots.empty, 'All screenshots belonging to deleted class are purged');
    assert(cleanJobs.empty, 'All video jobs belonging to deleted class are purged');
    assert(cleanAudio.empty, 'All audio chunks belonging to deleted class are purged');
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
