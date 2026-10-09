import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { fromZonedTime } from 'date-fns-tz';

import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';
import { recalculateStorageUsageInternal } from './storageQuota.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Helper to query documents within a date range with automatic in-memory fallback
 * in case a composite index is missing or currently building in Firestore.
 */
async function getDocsInRange(collectionName, classId, start, end, timestampField = 'timestamp') {
  try {
    const snap = await db.collection(collectionName)
      .where('classId', '==', classId)
      .where(timestampField, '>=', start)
      .where(timestampField, '<=', end)
      .get();
    return snap.docs;
  } catch (err) {
    console.warn(`[purgeClassTelemetryData] Composite index query on '${collectionName}' failed (${err.message}). Falling back to class-scoped in-memory filter.`);
    const snap = await db.collection(collectionName)
      .where('classId', '==', classId)
      .get();
    return snap.docs.filter((docSnap) => {
      const data = docSnap.data();
      const rawTs = data[timestampField] || data.createdAt || data.startTime;
      if (!rawTs) return false;
      const ts = rawTs.toDate ? rawTs.toDate() : new Date(rawTs);
      return !isNaN(ts.getTime()) && ts >= start && ts <= end;
    });
  }
}

/**
 * Helper to purge a list of documents and their corresponding physical Storage files in safe batches.
 */
async function purgeDocList(docs, bucket, pathExtractors) {
  const BATCH_SIZE = 400;
  const storagePromises = [];
  let deletedCount = 0;

  if (!docs || docs.length === 0) return 0;

  let batch = db.batch();
  let count = 0;

  for (const docSnap of docs) {
    deletedCount++;
    const data = docSnap.data();
    for (const extractor of pathExtractors) {
      const filePath = extractor(data);
      if (filePath) {
        storagePromises.push(
          bucket.file(filePath).delete({ ignoreNotFound: true }).catch((err) => {
            console.warn(`Could not delete storage file ${filePath}:`, err);
          })
        );
      }
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

  return deletedCount;
}

/**
 * Helper to sweep and purge orphaned files directly from Google Cloud Storage
 * whose creation timestamps fall within the selected date range.
 */
async function purgeOrphanedStorageFiles(bucket, prefix, start, end) {
  let count = 0;
  try {
    const [files] = await bucket.getFiles({ prefix });
    for (const file of files) {
      let created = null;
      if (file.metadata?.timeCreated) {
        created = new Date(file.metadata.timeCreated);
      }
      if (!created || isNaN(created.getTime())) {
        const match = file.name.match(/_(\d{13})/);
        if (match) {
          created = new Date(parseInt(match[1], 10));
        }
      }

      if (created && !isNaN(created.getTime())) {
        if (created >= start && created <= end) {
          await file.delete({ ignoreNotFound: true }).catch((err) => {
            console.warn(`Could not delete orphaned file ${file.name}:`, err);
          });
          count++;
        }
      }
    }
  } catch (err) {
    console.warn(`[purgeClassTelemetryData] Error scanning prefix ${prefix} for orphans:`, err);
  }
  return count;
}

/**
 * Enhanced granular telemetry and media purge handler.
 * Supports selective deletion of screenshots, audio recordings, compiled student videos,
 * teacher lecture recordings, irregularities evidence, and activity logs within a specified date range.
 */
export const purgeClassTelemetryData = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  console.log('purgeClassTelemetryData received payload:', request.data);

  const {
    classId,
    startDate,
    endDate,
    timezone,
    targets = { screenshots: true, audio: true },
  } = request.data || {};

  if (!classId || !startDate || !endDate) {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with classId, startDate, and endDate.'
    );
  }

  // Authorization Check: Must be teacher assigned to class or admin
  let isAuthorizedTeacher = request.auth.token?.role === 'teacher';
  if (!isAuthorizedTeacher && request.auth.uid) {
    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if (
          (cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
          (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))
        ) {
          isAuthorizedTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error checking teacher authorization for class:', e);
    }
  }

  if (!isAuthorizedTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers assigned to this class can purge session telemetry data.');
  }

  const tz = timezone || 'UTC';
  const start = fromZonedTime(startDate, tz);
  const end = fromZonedTime(endDate, tz);

  console.log(`[purgeClassTelemetryData] Commencing selective purge for class ${classId} between ${start.toISOString()} and ${end.toISOString()}. Targets:`, targets);

  const bucket = storage.bucket();
  let totalScreenshots = 0;
  let totalAudio = 0;
  let totalVideos = 0;
  let totalRecordings = 0;
  let totalIrregularities = 0;
  let totalActivityRecords = 0;

  try {
    // 1. Process Screenshots
    if (targets.screenshots !== false) {
      const screenshotDocs = await getDocsInRange('screenshots', classId, start, end, 'timestamp');
      totalScreenshots = await purgeDocList(screenshotDocs, bucket, [
        (d) => d.imagePath || d.storagePath,
      ]);
      const orphanShots = await purgeOrphanedStorageFiles(bucket, `screenshots/${classId}/`, start, end);
      totalScreenshots += orphanShots;
    }

    // 2. Process Audio Recordings
    if (targets.audio !== false) {
      const audioDocs = await getDocsInRange('audio', classId, start, end, 'timestamp');
      totalAudio = await purgeDocList(audioDocs, bucket, [
        (d) => d.audioPath || d.storagePath,
      ]);
      const orphanAudio = await purgeOrphanedStorageFiles(bucket, `audio/${classId}/`, start, end);
      totalAudio += orphanAudio;
    }

    // 3. Process Compiled Student Videos
    if (targets.videos === true) {
      const videoDocs = await getDocsInRange('videoJobs', classId, start, end, 'createdAt');
      totalVideos = await purgeDocList(videoDocs, bucket, [
        (d) => d.videoPath || d.resultVideoPath,
      ]);
      const orphanVideos = await purgeOrphanedStorageFiles(bucket, `videos/${classId}/`, start, end);
      totalVideos += orphanVideos;
    }

    // 4. Process Teacher Lecture Recordings
    if (targets.lectureRecordings === true) {
      try {
        const lectureCol = db.collection(`classes/${classId}/lectureRecordings`);
        let lectureDocs = [];
        try {
          const lSnap = await lectureCol
            .where('startedAt', '>=', start)
            .where('startedAt', '<=', end)
            .get();
          lectureDocs = lSnap.docs;
        } catch {
          const allSnap = await lectureCol.get();
          lectureDocs = allSnap.docs.filter((d) => {
            const data = d.data();
            const raw = data.startedAt || data.createdAt;
            if (!raw) return false;
            const ts = raw.toDate ? raw.toDate() : new Date(raw);
            return !isNaN(ts.getTime()) && ts >= start && ts <= end;
          });
        }

        for (const lDoc of lectureDocs) {
          totalRecordings++;
          const prefix = `recordings/${classId}/${lDoc.id}/`;
          await bucket.deleteFiles({ prefix, force: true }).catch((err) => {
            console.warn(`Could not delete lecture recording folder ${prefix}:`, err);
          });
          await lDoc.ref.delete();
        }
      } catch (lErr) {
        console.warn('Error purging lecture recordings in range:', lErr);
      }
      const orphanRecordings = await purgeOrphanedStorageFiles(bucket, `recordings/${classId}/`, start, end);
      totalRecordings += orphanRecordings;
    }

    // 5. Process Irregularities & Incident Evidences (Optional)
    if (targets.irregularities === true) {
      try {
        const classIrregCol = db.collection(`classes/${classId}/irregularities`);
        let cDocs = [];
        try {
          const cSnap = await classIrregCol.where('timestamp', '>=', start).where('timestamp', '<=', end).get();
          cDocs = cSnap.docs;
        } catch {
          const allSnap = await classIrregCol.get();
          cDocs = allSnap.docs.filter((d) => {
            const raw = d.data()?.timestamp || d.data()?.createdAt;
            if (!raw) return true;
            const ts = raw.toDate ? raw.toDate() : new Date(raw);
            return !isNaN(ts.getTime()) && ts >= start && ts <= end;
          });
        }
        totalIrregularities += await purgeDocList(cDocs, bucket, [
          (d) => d.imagePath || d.screenShotUrl || d.webcamShotUrl,
        ]);
      } catch (iErr) {
        console.warn('Error purging class irregularities:', iErr);
      }

      try {
        const rootIrregDocs = await getDocsInRange('irregularities', classId, start, end, 'timestamp');
        totalIrregularities += await purgeDocList(rootIrregDocs, bucket, [
          (d) => d.imagePath || d.screenShotUrl || d.webcamShotUrl,
        ]);
      } catch (rErr) {
        console.warn('Error purging root irregularities:', rErr);
      }

      const orphanIrregs = await purgeOrphanedStorageFiles(bucket, `irregularities/${classId}/`, start, end);
      totalIrregularities += orphanIrregs;
    }

    // 6. Process Bingo & Activity Audit Records (Optional)
    if (targets.bingoRecords === true) {
      const subCols = ['bingoRecords', 'attendanceAdjustments', 'audio_audits'];
      for (const scName of subCols) {
        try {
          const colRef = db.collection(`classes/${classId}/${scName}`);
          let docsToDelete = [];
          try {
            const snap = await colRef.where('timestamp', '>=', start).where('timestamp', '<=', end).get();
            docsToDelete = snap.docs;
          } catch {
            const snap = await colRef.get();
            docsToDelete = snap.docs.filter(d => {
              const data = d.data();
              const raw = data.timestamp || data.createdAt || data.adjustedAt || data.startedAt;
              if (!raw) return true;
              const ts = raw.toDate ? raw.toDate() : new Date(raw);
              return !isNaN(ts.getTime()) && ts >= start && ts <= end;
            });
          }

          let batch = db.batch();
          let bCount = 0;
          for (const d of docsToDelete) {
            batch.delete(d.ref);
            bCount++;
            totalActivityRecords++;
            if (bCount >= 400) {
              await batch.commit();
              batch = db.batch();
              bCount = 0;
            }
          }
          if (bCount > 0) {
            await batch.commit();
          }
        } catch (scErr) {
          console.warn(`Error purging subcollection ${scName}:`, scErr);
        }
      }
    }

    // Automatically recalculate storage quota to reconcile actual usage
    try {
      await recalculateStorageUsageInternal(classId);
    } catch (recalcErr) {
      console.warn('Error auto-recalculating storage after purge:', recalcErr);
    }

    const totalPurged = totalScreenshots + totalAudio + totalVideos + totalRecordings + totalIrregularities + totalActivityRecords;
    if (totalPurged === 0) {
      return {
        status: 'success',
        message: 'No session data found matching the selected targets and date range.',
        screenshotsCount: 0,
        audioCount: 0,
        videosCount: 0,
        recordingsCount: 0,
        irregularitiesCount: 0,
        activityRecordsCount: 0,
        totalPurged: 0,
      };
    }

    const parts = [];
    if (totalScreenshots > 0) parts.push(`${totalScreenshots} screenshots`);
    if (totalAudio > 0) parts.push(`${totalAudio} audio recordings`);
    if (totalVideos > 0) parts.push(`${totalVideos} student videos`);
    if (totalRecordings > 0) parts.push(`${totalRecordings} lecture recordings`);
    if (totalIrregularities > 0) parts.push(`${totalIrregularities} irregularity records/files`);
    if (totalActivityRecords > 0) parts.push(`${totalActivityRecords} activity/bingo records`);

    return {
      status: 'success',
      message: `Successfully deleted ${parts.join(', ')}.`,
      screenshotsCount: totalScreenshots,
      audioCount: totalAudio,
      videosCount: totalVideos,
      recordingsCount: totalRecordings,
      irregularitiesCount: totalIrregularities,
      activityRecordsCount: totalActivityRecords,
      totalPurged,
    };
  } catch (error) {
    console.error('Error during selective telemetry purge:', error);
    throw new HttpsError(
      'internal',
      `An error occurred while deleting telemetry: ${error.message}`
    );
  }
});

/**
 * On-demand callable function to sweep all completed videoJobs for an existing class,
 * identifying routine unflagged screenshots and batch purging them to reclaim storage.
 * Strictly preserves all anti-cheating flags, proctoring violations, and irregularity records.
 */
export const purgeCombinedScreenshotsForClass = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  const { classId } = request.data || {};
  if (!classId) {
    throw new HttpsError('invalid-argument', 'The function must be called with a valid classId.');
  }

  // Authorization Check: Must be teacher assigned to class or admin
  let isAuthorizedTeacher = request.auth.token?.role === 'teacher';
  if (!isAuthorizedTeacher && request.auth.uid) {
    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if (
          (cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
          (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))
        ) {
          isAuthorizedTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error checking teacher authorization for class:', e);
    }
  }

  if (!isAuthorizedTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers assigned to this class can sweep combined screenshots.');
  }

  console.log(`[purgeCombinedScreenshotsForClass] Starting retroactive screenshot purge for class ${classId}`);

  try {
    // 1. Query all completed videoJobs for this class
    const videoJobsSnap = await db.collection('videoJobs')
      .where('classId', '==', classId)
      .where('status', '==', 'completed')
      .get();

    if (videoJobsSnap.empty) {
      return {
        status: 'success',
        message: 'No completed video sessions found for this class.',
        jobsEvaluated: 0,
        purgedCount: 0,
        preservedCount: 0,
      };
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
        // Fallback in-memory filter if index is not ready
        console.warn(`[purgeCombinedScreenshotsForClass] Index query failed (${err.message}), falling back to in-memory filter.`);
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

    if (docsToPurge.length > 0) {
      totalPurged = await purgeDocList(docsToPurge, bucket, [
        (d) => d.imagePath || d.storagePath,
      ]);
    }

    // Recalculate class storage usage in background
    try {
      await recalculateStorageUsageInternal(classId);
    } catch (recalcErr) {
      console.warn(`[purgeCombinedScreenshotsForClass] Storage recalculation error:`, recalcErr);
    }

    return {
      status: 'success',
      message: `Successfully swept ${videoJobsSnap.size} video session(s). Purged ${totalPurged} routine screenshots. Preserved ${totalPreserved} flagged proctoring evidence record(s).`,
      jobsEvaluated: videoJobsSnap.size,
      purgedCount: totalPurged,
      preservedCount: totalPreserved,
    };
  } catch (error) {
    console.error('Error during purgeCombinedScreenshotsForClass:', error);
    throw new HttpsError('internal', `An error occurred while sweeping combined screenshots: ${error.message}`);
  }
});

/**
 * Backwards compatibility alias for existing clients and scripts.
 */
export const deleteScreenshotsByDateRange = purgeClassTelemetryData;
