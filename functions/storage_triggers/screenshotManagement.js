import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { fromZonedTime } from 'date-fns-tz';

import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';

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
 * Enhanced granular telemetry and media purge handler.
 * Supports selective deletion of screenshots, audio recordings, compiled student videos,
 * and teacher lecture recordings within a specified date range.
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

  try {
    // 1. Process Screenshots
    if (targets.screenshots !== false) {
      const screenshotDocs = await getDocsInRange('screenshots', classId, start, end, 'timestamp');
      totalScreenshots = await purgeDocList(screenshotDocs, bucket, [
        (d) => d.imagePath || d.storagePath,
      ]);
    }

    // 2. Process Audio Recordings
    if (targets.audio !== false) {
      const audioDocs = await getDocsInRange('audio', classId, start, end, 'timestamp');
      totalAudio = await purgeDocList(audioDocs, bucket, [
        (d) => d.audioPath || d.storagePath,
      ]);
    }

    // 3. Process Compiled Student Videos
    if (targets.videos === true) {
      const videoDocs = await getDocsInRange('videoJobs', classId, start, end, 'createdAt');
      totalVideos = await purgeDocList(videoDocs, bucket, [
        (d) => d.videoPath || d.resultVideoPath,
      ]);
    }

    // 4. Process Teacher Lecture Recordings (Optional)
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
    }

    const totalPurged = totalScreenshots + totalAudio + totalVideos + totalRecordings;
    if (totalPurged === 0) {
      return {
        status: 'success',
        message: 'No session data found matching the selected targets and date range.',
        screenshotsCount: 0,
        audioCount: 0,
        videosCount: 0,
        recordingsCount: 0,
        totalPurged: 0,
      };
    }

    const parts = [];
    if (totalScreenshots > 0) parts.push(`${totalScreenshots} screenshots`);
    if (totalAudio > 0) parts.push(`${totalAudio} audio recordings`);
    if (totalVideos > 0) parts.push(`${totalVideos} student videos`);
    if (totalRecordings > 0) parts.push(`${totalRecordings} lecture recordings`);

    return {
      status: 'success',
      message: `Successfully deleted ${parts.join(', ')}.`,
      screenshotsCount: totalScreenshots,
      audioCount: totalAudio,
      videosCount: totalVideos,
      recordingsCount: totalRecordings,
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
 * Backwards compatibility alias for existing clients and scripts.
 */
export const deleteScreenshotsByDateRange = purgeClassTelemetryData;
