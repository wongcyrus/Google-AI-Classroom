import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export async function grantTeacherRoleToEmail(email, { auth, db, defaultPassword = 'IT114115' } = {}) {
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log(`ℹ️ Existing user found: ${email} (UID: ${userRecord.uid})`);
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      console.log(`✨ User does not exist. Creating account for: ${email}...`);
      userRecord = await auth.createUser({
        email,
        password: defaultPassword,
        emailVerified: true,
        displayName: email.split('@')[0]
      });
      console.log(`✅ Created account for ${email} (UID: ${userRecord.uid})`);
    } else {
      throw err;
    }
  }

  // 1. Set custom claims in Firebase Auth
  await auth.setCustomUserClaims(userRecord.uid, { role: 'teacher' });
  await auth.updateUser(userRecord.uid, { emailVerified: true });
  console.log(`🎉 Successfully granted { role: 'teacher' } to: ${email}`);

  // 2. Migrate or ensure teacher profile document in Firestore
  const uid = userRecord.uid;
  const studentProfileRef = db.collection('studentProfiles').doc(uid);
  const teacherProfileRef = db.collection('teacherProfiles').doc(uid);

  const studentDoc = await studentProfileRef.get();
  if (studentDoc.exists) {
    const studentData = studentDoc.data() || {};
    console.log(`🔄 Migrating profile from studentProfiles to teacherProfiles for ${email}...`);
    await teacherProfileRef.set({
      ...studentData,
      migratedFromStudent: true,
      promotedAt: new Date().toISOString()
    }, { merge: true });
    await studentProfileRef.delete();
    console.log(`✅ Profile migrated to teacherProfiles/${uid}`);
  } else {
    await teacherProfileRef.set({
      email,
      createdAt: new Date().toISOString()
    }, { merge: true });
  }

  return { uid, email, role: 'teacher' };
}

export async function main() {
  const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'it114115-dev-2026';
  if (getApps().length === 0) {
    initializeApp({ projectId });
  }
  const auth = getAuth();
  const db = getFirestore();

  const defaultEmails = [
    'cywong@vtc.edu.hk',
    'kcheung@vtc.edu.hk',
    'rontam@vtc.edu.hk',
    'hli852@vtc.edu.hk',
    'kakaleung@vtc.edu.hk',
    'james.chan@vtc.edu.hk',
    'ngmanyiu@vtc.edu.hk',
    'alanpo@vtc.edu.hk'
  ];

  const emails = process.argv.slice(2).length > 0 ? process.argv.slice(2) : defaultEmails;
  console.log(`Granting teacher roles on project: ${projectId}`);

  for (const email of emails) {
    try {
      await grantTeacherRoleToEmail(email, { auth, db, defaultPassword: process.env.DEMO_PASSWORD });
    } catch (error) {
      console.error(`❌ Error provisioning ${email}:`, error.message);
    }
  }
  console.log('✅ All teacher roles processed!');
}

const isDirectExecution = process.argv[1] && process.argv[1].endsWith('grantTeacherRole.js');
if (isDirectExecution) {
  main();
}
