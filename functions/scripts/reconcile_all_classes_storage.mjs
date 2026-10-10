import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { recalculateStorageUsageInternal } from '../storage_triggers/storageQuota.js';

const projectId = process.argv[2] || process.env.GCLOUD_PROJECT || 'it114115-2627';
const storageBucket = `${projectId}.firebasestorage.app`;

if (getApps().length === 0) {
  initializeApp({
    projectId,
    storageBucket,
  });
}

const db = getFirestore();

async function main() {
  console.log(`\n======================================================`);
  console.log(`🚀 RECONCILING STORAGE FOR ALL CLASSES IN [${projectId}]`);
  console.log(`   Bucket: ${storageBucket}`);
  console.log(`======================================================\n`);

  const snapshot = await db.collection('classes').get();
  console.log(`Found ${snapshot.size} classes to audit.\n`);

  let processedCount = 0;
  let totalBucketBytes = 0;

  for (const doc of snapshot.docs) {
    const classId = doc.id;
    const oldClassData = doc.data() || {};
    const oldStorageSnap = await doc.ref.collection('metadata').doc('storage').get();
    const oldStorageData = oldStorageSnap.exists ? oldStorageSnap.data() : {};

    process.stdout.write(`Scanning [${classId}]... `);
    try {
      const results = await recalculateStorageUsageInternal(classId);
      totalBucketBytes += results.storageUsage;
      processedCount++;

      const beforeMB = (Number(oldStorageData?.storageUsage || 0) / 1024 / 1024).toFixed(2);
      const afterMB = (results.storageUsage / 1024 / 1024).toFixed(2);
      const diffMB = ((results.storageUsage - Number(oldStorageData?.storageUsage || 0)) / 1024 / 1024).toFixed(2);

      console.log(`✅ Done!`);
      console.log(`   Before: ${beforeMB} MB (Screens: ${(Number(oldStorageData.storageUsageScreenShots || 0) / 1024 / 1024).toFixed(2)} MB, Vids: ${(Number(oldStorageData.storageUsageVideos || 0) / 1024 / 1024).toFixed(2)} MB)`);
      console.log(`   After:  ${afterMB} MB (Screens: ${(results.storageUsageScreenShots / 1024 / 1024).toFixed(2)} MB, Vids: ${(results.storageUsageVideos / 1024 / 1024).toFixed(2)} MB, Recs: ${(results.storageUsageRecordings / 1024 / 1024).toFixed(2)} MB, Audio: ${(results.storageUsageAudio / 1024 / 1024).toFixed(2)} MB, Tasks: ${(results.storageUsageTasks / 1024 / 1024).toFixed(2)} MB, Reports: ${(results.storageUsageReports / 1024 / 1024).toFixed(2)} MB)`);
      if (Number(oldStorageData.storageUsage || 0) < 0) {
        console.log(`   🛠️ FIXED NEGATIVE CORRUPTION: Was ${beforeMB} MB -> Now accurately ${afterMB} MB (+${diffMB} MB corrected)`);
      }
      console.log('');
    } catch (err) {
      console.error(`❌ Failed: ${err.message}`);
    }
  }

  console.log(`======================================================`);
  console.log(`🎉 COMPLETED! Audited ${processedCount}/${snapshot.size} classes.`);
  console.log(`   Total Class Storage Reconciled: ${(totalBucketBytes / 1024 / 1024).toFixed(2)} MB (${(totalBucketBytes / 1024 / 1024 / 1024).toFixed(2)} GB)`);
  console.log(`======================================================\n`);
}

main().catch(console.error);
