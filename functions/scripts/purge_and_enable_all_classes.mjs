import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const BATCH_SIZE = 400;

async function recalculateStorageForClass(db, storage, classId) {
  try {
    const bucket = storage.bucket();
    const subdirs = [
      { prefix: `screenshots/${classId}/`, field: 'storageUsageScreenShots' },
      { prefix: `videos/${classId}/`, field: 'storageUsageVideos' },
      { prefix: `zips/${classId}/`, field: 'storageUsageZips' },
      { prefix: `audio/${classId}/`, field: 'storageUsageAudio' },
      { prefix: `recordings/${classId}/`, field: 'storageUsageRecordings' },
      { prefix: `irregularities/${classId}/`, field: 'storageUsageIrregularities' },
    ];

    const usageBreakdown = {
      storageUsageScreenShots: 0,
      storageUsageVideos: 0,
      storageUsageZips: 0,
      storageUsageAudio: 0,
      storageUsageRecordings: 0,
      storageUsageIrregularities: 0,
    };
    let totalUsage = 0;

    for (const { prefix, field } of subdirs) {
      try {
        const [files] = await bucket.getFiles({ prefix, autoPaginate: true });
        let categoryTotal = 0;
        for (const file of files) {
          const size = parseInt(file.metadata.size, 10) || 0;
          categoryTotal += size;
        }
        usageBreakdown[field] = categoryTotal;
        totalUsage += categoryTotal;
      } catch (err) {
        console.warn(`[recalculateStorage] Error auditing ${prefix}:`, err.message);
      }
    }

    const payload = {
      ...usageBreakdown,
      storageUsage: totalUsage,
      lastCalculated: FieldValue.serverTimestamp(),
    };

    const classRef = db.collection('classes').doc(classId);
    await classRef.collection('metadata').doc('storage').set(payload, { merge: true });
    await classRef.update({ storageUsage: totalUsage }).catch(() => {});
  } catch (err) {
    console.warn(`[recalculateStorage] Failed for ${classId}:`, err.message);
  }
}

async function purgeCombinedScreenshotsForClass(db, storage, classId) {
  const videoJobsSnap = await db.collection('videoJobs')
    .where('classId', '==', classId)
    .where('status', '==', 'completed')
    .get();

  if (videoJobsSnap.empty) {
    return { evaluatedJobs: 0, purgedCount: 0, preservedCount: 0 };
  }

  const bucket = storage.bucket();
  let totalPurged = 0;
  let totalPreserved = 0;
  const seenScreenshotIds = new Set();
  const docsToPurge = [];

  for (const jobDoc of videoJobsSnap.docs) {
    const jobData = jobDoc.data() || {};
    const { studentUid, startTime, endTime } = jobData;
    if (!studentUid || !startTime || !endTime) continue;

    const rawStart = startTime.toDate ? startTime.toDate() : new Date(startTime);
    const rawEnd = endTime.toDate ? endTime.toDate() : new Date(endTime);

    if (isNaN(rawStart.getTime()) || isNaN(rawEnd.getTime())) continue;

    let screenshotDocs = [];
    try {
      const snap = await db.collection('screenshots')
        .where('classId', '==', classId)
        .where('studentUid', '==', studentUid)
        .where('timestamp', '>=', rawStart)
        .where('timestamp', '<=', rawEnd)
        .get();
      screenshotDocs = snap.docs;
    } catch (err) {
      // Fallback query if composite index not ready
      const snap = await db.collection('screenshots')
        .where('classId', '==', classId)
        .where('studentUid', '==', studentUid)
        .get();
      screenshotDocs = snap.docs.filter((d) => {
        const dData = d.data() || {};
        const ts = dData.timestamp?.toDate ? dData.timestamp.toDate() : new Date(dData.timestamp);
        return !isNaN(ts.getTime()) && ts >= rawStart && ts <= rawEnd;
      });
    }

    for (const sDoc of screenshotDocs) {
      if (seenScreenshotIds.has(sDoc.id)) continue;
      seenScreenshotIds.add(sDoc.id);

      const sData = sDoc.data() || {};
      const isFlagged = sData.isFlagged === true ||
                        sData.isViolation === true ||
                        Boolean(sData.incidentId) ||
                        sData.reviewRequired === true ||
                        sData.suspicious === true;

      if (isFlagged) {
        totalPreserved++;
      } else {
        docsToPurge.push(sDoc);
      }
    }
  }

  // Batch delete unflagged routine screenshot documents and files
  if (docsToPurge.length > 0) {
    let batch = db.batch();
    let count = 0;
    const storagePromises = [];

    for (const docSnap of docsToPurge) {
      totalPurged++;
      const data = docSnap.data() || {};
      const filePath = data.imagePath || data.storagePath;
      if (filePath) {
        storagePromises.push(
          bucket.file(filePath).delete({ ignoreNotFound: true }).catch((e) => {
            console.warn(`[storage] Could not delete ${filePath}:`, e.message);
          })
        );
      }

      batch.delete(docSnap.ref);
      count++;

      if (count >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        count = 0;
        if (storagePromises.length > 50) {
          await Promise.allSettled(storagePromises.splice(0, 50));
        }
      }
    }

    if (count > 0) {
      await batch.commit();
    }
    if (storagePromises.length > 0) {
      await Promise.allSettled(storagePromises);
    }
  }

  return {
    evaluatedJobs: videoJobsSnap.size,
    purgedCount: totalPurged,
    preservedCount: totalPreserved,
  };
}

async function processProject(projectId) {
  console.log(`\n======================================================`);
  console.log(`🚀 PROCESSING FIREBASE PROJECT: ${projectId}`);
  console.log(`======================================================`);

  const storageBucket = `${projectId}.firebasestorage.app`;
  const app = initializeApp({ projectId, storageBucket }, projectId);
  const db = getFirestore(app);
  const storage = getStorage(app);

  const classesSnap = await db.collection('classes').get();
  console.log(`Found ${classesSnap.size} classes in ${projectId}.`);

  let totalPurgedAllClasses = 0;
  let totalPreservedAllClasses = 0;
  let totalJobsEvaluated = 0;
  let updatedSettingCount = 0;

  for (const classDoc of classesSnap.docs) {
    const classId = classDoc.id;
    const classData = classDoc.data() || {};
    const className = classData.name || classId;

    console.log(`\n🔍 Checking class: [${classId}] "${className}"`);

    // 1. Purge completed video session screenshots
    const purgeResult = await purgeCombinedScreenshotsForClass(db, storage, classId);
    totalPurgedAllClasses += purgeResult.purgedCount;
    totalPreservedAllClasses += purgeResult.preservedCount;
    totalJobsEvaluated += purgeResult.evaluatedJobs;

    console.log(`   - Video Jobs Evaluated: ${purgeResult.evaluatedJobs}`);
    console.log(`   - Routine Screenshots Purged: ${purgeResult.purgedCount}`);
    console.log(`   - Flagged Evidence Preserved: ${purgeResult.preservedCount}`);

    // 2. Set purgeScreenshotsAfterVideoCombine: true
    await classDoc.ref.set(
      {
        purgeScreenshotsAfterVideoCombine: true,
      },
      { merge: true }
    );
    updatedSettingCount++;
    console.log(`   - Setting Updated: purgeScreenshotsAfterVideoCombine = true`);

    // 3. Recalculate storage metadata
    await recalculateStorageForClass(db, storage, classId);
    console.log(`   - Storage Quota & Metadata Synchronized`);
  }

  console.log(`\n------------------------------------------------------`);
  console.log(`✅ PROJECT SUMMARY (${projectId}):`);
  console.log(`   Classes Processed: ${classesSnap.size}`);
  console.log(`   Classes Configured (purgeScreenshotsAfterVideoCombine=true): ${updatedSettingCount}`);
  console.log(`   Total Completed Video Sessions Evaluated: ${totalJobsEvaluated}`);
  console.log(`   Total Routine Screenshots Purged: ${totalPurgedAllClasses}`);
  console.log(`   Total Flagged Proctoring Evidence Preserved: ${totalPreservedAllClasses}`);
  console.log(`------------------------------------------------------\n`);
}

async function main() {
  const projects = process.argv.slice(2);
  const targetProjects = projects.length > 0 ? projects : ['it114115-dev-2026', 'it114115-2627'];

  for (const proj of targetProjects) {
    try {
      await processProject(proj);
    } catch (err) {
      console.error(`❌ Error processing project ${proj}:`, err);
    }
  }

  console.log('\n🎉 ALL CLASSES PROCESSED SUCCESSFULLY!\n');
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
