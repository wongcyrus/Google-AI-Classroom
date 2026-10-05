#!/usr/bin/env node
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'it114115-2627';
const app = initializeApp({ projectId });
const auth = getAuth(app);
const db = getFirestore(app);

async function main() {
  const email = '260229367@stu.vtc.edu.hk';
  console.log(`\n======================================================`);
  console.log(`Trace Student: ${email} in project: ${projectId}`);
  console.log(`======================================================\n`);

  // 1. Auth check
  const uids = ['B0vsf1DUwIbpnY2FQFIX56G1iV03', 'T517RuBlZOfH4JOTiaSK9KeyAfy1'];
  for (const uid of uids) {
    try {
      const u = await auth.getUser(uid);
      console.log(`[AUTH] UID: ${uid}`);
      console.log(`  email: ${u.email}, emailVerified: ${u.emailVerified}, disabled: ${u.disabled}`);
      console.log(`  displayName: ${u.displayName}`);
      console.log(`  tokensValidAfterTime: ${u.tokensValidAfterTime}`);
      console.log(`  customClaims:`, u.customClaims);
      console.log(`  metadata:`, u.metadata);
    } catch (e) {
      console.log(`[AUTH] UID ${uid} not found in Auth: ${e.message}`);
    }
  }

  // 2. Check studentPasskeys for both UIDs and by email
  console.log(`\n--- Checking studentPasskeys collection ---`);
  for (const uid of uids) {
    const doc = await db.doc(`studentPasskeys/${uid}`).get();
    if (doc.exists) {
      console.log(`studentPasskeys/${uid} EXISTS:`);
      console.log(JSON.stringify(doc.data(), null, 2));
    } else {
      console.log(`studentPasskeys/${uid} DOES NOT EXIST`);
    }
  }

  const byEmail = await db.collection('studentPasskeys').where('studentEmail', '==', email).get();
  console.log(`Query studentPasskeys by studentEmail == '${email}': found ${byEmail.size} doc(s)`);
  byEmail.forEach(d => {
    console.log(`  docId: ${d.id}`);
    console.log(JSON.stringify(d.data(), null, 2));
  });

  // 3. Check passkeyPairingTokens for this email
  console.log(`\n--- Checking passkeyPairingTokens collection ---`);
  const pairingTokens = await db.collection('passkeyPairingTokens')
    .where('studentEmail', '==', email)
    .get();
  console.log(`Found ${pairingTokens.size} passkeyPairingTokens doc(s):`);
  const sortedTokens = pairingTokens.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.toMillis?.() || b.expiresAtMillis || 0) - (a.createdAt?.toMillis?.() || a.expiresAtMillis || 0));
  
  sortedTokens.forEach(t => {
    console.log(`  Token ID: ${t.id}`);
    console.log(`    studentUid: ${t.studentUid}`);
    console.log(`    used: ${t.used}`);
    console.log(`    createdAt: ${t.createdAt?.toDate ? t.createdAt.toDate().toISOString() : t.createdAt}`);
    console.log(`    expiresAtMillis: ${new Date(t.expiresAtMillis || 0).toISOString()}`);
    console.log(`    completedAt: ${t.completedAt?.toDate ? t.completedAt.toDate().toISOString() : t.completedAt}`);
    console.log(`    rpIdUsed: ${t.rpIdUsed}`);
  });

  // 4. Check user profiles in users collection
  console.log(`\n--- Checking users collection ---`);
  for (const uid of uids) {
    const userDoc = await db.doc(`users/${uid}`).get();
    if (userDoc.exists) {
      console.log(`users/${uid} EXISTS:`);
      console.log(JSON.stringify(userDoc.data(), null, 2));
    } else {
      console.log(`users/${uid} DOES NOT EXIST`);
    }
  }

  // 5. Check attendance / bingoRecords across classes for this student
  console.log(`\n--- Checking recent bingoRecords for this student ---`);
  const classes = ['it3101-ab', 'it3901-l', 'ite3101-l', 'itp4903-l', 'it114115-ite3102-1a1b', 'itp4903-a'];
  for (const cid of classes) {
    for (const uid of uids) {
      const bSnap = await db.collection(`classes/${cid}/bingoRecords`)
        .where('studentUid', '==', uid)
        .limit(3)
        .get();
      if (!bSnap.empty) {
        console.log(`  Class ${cid} bingoRecords for ${uid}:`);
        bSnap.forEach(b => console.log(`    [${b.id}] result: ${b.data().result}, status: ${b.data().status}, issued: ${b.data().issuedAtMillis}`));
      }
    }
  }

  // 6. Check lecturePasskeyChallenges if any
  console.log(`\n--- Checking recent lecturePasskeyChallenges ---`);
  const chSnap = await db.collection('lecturePasskeyChallenges')
    .orderBy('createdAt', 'desc')
    .limit(3)
    .get();
  chSnap.forEach(c => {
    const cd = c.data();
    console.log(`Challenge ${c.id}: class=${cd.classId}, active=${cd.active}, expires=${new Date(cd.expiresAtMillis || 0).toISOString()}`);
  });
}

main().then(() => process.exit(0)).catch(e => {
  console.error(e);
  process.exit(1);
});
