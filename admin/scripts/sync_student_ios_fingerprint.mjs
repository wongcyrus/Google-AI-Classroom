#!/usr/bin/env node
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'it114115-2627';
const app = initializeApp({ projectId });
const db = getFirestore(app);

async function main() {
  const uid = 'B0vsf1DUwIbpnY2FQFIX56G1iV03';
  const email = '260229367@stu.vtc.edu.hk';
  const safariFingerprint = 'mdev_84329ccd-594b-4933-a209-af011f5c35a1';

  console.log(`Updating studentPasskeys/${uid} for ${email} with Safari fingerprint: ${safariFingerprint}`);
  
  const passkeyRef = db.doc(`studentPasskeys/${uid}`);
  const doc = await passkeyRef.get();
  if (!doc.exists) {
    console.error(`Passkey doc not found for ${uid}`);
    process.exit(1);
  }

  const prevFp = doc.data().deviceFingerprint;
  console.log(`Previous deviceFingerprint: ${prevFp}`);
  
  await passkeyRef.update({
    deviceFingerprint: safariFingerprint,
    previousFingerprint: prevFp,
    fingerprintSyncedAt: new Date(),
    note: 'Synced from Chrome-registered fingerprint to native Safari camera scanner fingerprint',
  });

  console.log(`Successfully updated! Student can now scan the PC QR code in Safari without Device Mismatch.`);
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
