import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const targetProjects = ['it114115-2627', 'it114115-dev-2026'];

async function clearWhitelistAndReset() {
  for (const projectId of targetProjects) {
    console.log(`\n========================================================`);
    console.log(`🧹 Processing project: ${projectId}`);
    console.log(`========================================================`);

    delete process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.CLOUDSDK_CORE_PROJECT;
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

    const app = initializeApp({ projectId }, `cleaner-${projectId}-${Date.now()}`);
    const db = getFirestore(app);

    // 1. Clear Password Whitelist in system_config/loginPolicy
    await db.collection('system_config').doc('loginPolicy').set({
      passwordWhitelist: [],
      updatedAt: FieldValue.serverTimestamp(),
      description: 'Strict enforcement active. All students must use mobile passkey QR scan on desktop.'
    }, { merge: true });
    console.log(`✅ Cleared passwordWhitelist on ${projectId}. All students now strictly gated by mobile passkey.`);

    // 2. Clear all studentPasskeys (Reset all student passkeys & device bindings for clean testing)
    const passkeysSnap = await db.collection('studentPasskeys').get();
    if (!passkeysSnap.empty) {
      console.log(`ℹ️ Found ${passkeysSnap.size} registered passkeys. Deleting...`);
      const batch = db.batch();
      passkeysSnap.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log(`✅ Deleted all registered passkeys on ${projectId}.`);
    } else {
      console.log(`ℹ️ No passkeys were currently registered on ${projectId}.`);
    }

    // 3. Clear any active bypass requests or bypass flags on studentProperties
    const classesSnap = await db.collection('classes').get();
    for (const classDoc of classesSnap.docs) {
      const studentPropsSnap = await db.collection('classes').doc(classDoc.id).collection('studentProperties').get();
      if (!studentPropsSnap.empty) {
        const batch = db.batch();
        studentPropsSnap.docs.forEach(doc => {
          batch.update(doc.ref, {
            'passkeyBypass.active': false,
            'passkeyBypass.expired': true,
          });
        });
        await batch.commit();
      }
    }
    console.log(`✅ Cleared all temporary teacher bypasses across classes on ${projectId}.`);
  }

  console.log(`\n🎉 Reset complete across production and dev!`);
}

clearWhitelistAndReset().catch(console.error);
