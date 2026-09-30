import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Helper to delete all documents in a collection matching classId in 500-item chunks.
 */
async function deleteCollectionByClassId(collectionName, classId) {
  const BATCH_SIZE = 500;
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    const snap = await db.collection(collectionName)
      .where('classId', '==', classId)
      .limit(BATCH_SIZE)
      .get();

    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();

    totalDeleted += snap.size;
    if (snap.size < BATCH_SIZE) hasMore = false;
  }
  return totalDeleted;
}

/**
 * Helper to unassign deleted class from user profiles (teacherProfiles & studentProfiles).
 */
async function removeClassFromProfiles(collectionName, classId) {
  const snap = await db.collection(collectionName)
    .where('classes', 'array-contains', classId)
    .get();

  if (snap.empty) return;

  const batch = db.batch();
  snap.docs.forEach(doc => {
    batch.update(doc.ref, { classes: FieldValue.arrayRemove(classId) });
  });
  await batch.commit();
}

/**
 * Triggered whenever an entire class document is deleted in Firestore.
 * Automatically deletes the physical image blob from Cloud Storage,
 * ensuring no orphaned files remain regardless of whether the delete
 * came from the UI, a CLI script, or Firestore TTL.
 */
export const onScreenshotDocDeleted = onDocumentDeleted({
  document: 'screenshots/{screenshotId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const docData = event.data?.data();
  if (!docData) return;

  const imagePath = docData.imagePath || docData.storagePath;
  if (!imagePath) {
    logger.info(`Screenshot doc ${event.params.screenshotId} deleted but had no imagePath.`);
    return;
  }

  try {
    logger.info(`Deleting physical Storage object: ${imagePath}`);
    const bucket = storage.bucket();
    await bucket.file(imagePath).delete({ ignoreNotFound: true });
    logger.info(`Successfully deleted Storage object: ${imagePath}`);
  } catch (error) {
    logger.error(`Error deleting storage file ${imagePath}:`, error);
  }
});

/**
 * Triggered whenever an audio document is deleted in Firestore.
 * Automatically deletes the physical audio blob (.webm) from Cloud Storage.
 */
export const onAudioDocDeleted = onDocumentDeleted({
  document: 'audio/{audioId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const docData = event.data?.data();
  if (!docData) return;

  const audioPath = docData.audioPath || docData.storagePath;
  if (!audioPath) {
    logger.info(`Audio doc ${event.params.audioId} deleted but had no audioPath.`);
    return;
  }

  try {
    logger.info(`Deleting physical Storage audio object: ${audioPath}`);
    const bucket = storage.bucket();
    await bucket.file(audioPath).delete({ ignoreNotFound: true });
    logger.info(`Successfully deleted Storage audio object: ${audioPath}`);
  } catch (error) {
    logger.error(`Error deleting storage audio file ${audioPath}:`, error);
  }
});

/**
 * Triggered whenever a teacher lecture recording document is deleted in Firestore.
 * Automatically deletes all physical video, audio, and subtitle files (.vtt, .srt)
 * under recordings/{classId}/{sessionId}/ in Cloud Storage.
 */
export const onLectureRecordingDeleted = onDocumentDeleted({
  document: 'classes/{classId}/lectureRecordings/{sessionId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const { classId, sessionId } = event.params;
  if (!classId || !sessionId) return;

  const docData = event.data?.data();
  if (docData?.copiedFromClassId) {
    logger.info(`Skipping physical Storage assets purge for lecture recording ${sessionId} as it was copied from class ${docData.copiedFromClassId}`);
    return;
  }

  const prefix = `recordings/${classId}/${sessionId}/`;
  try {
    logger.info(`Deleting physical Storage assets for lecture recording under: ${prefix}`);
    const bucket = storage.bucket();
    await bucket.deleteFiles({ prefix, force: true });
    logger.info(`Successfully purged Storage assets for lecture recording prefix: ${prefix}`);
  } catch (error) {
    logger.error(`Error deleting storage files for lecture recording prefix ${prefix}:`, error);
  }
});

/**
 * Triggered whenever an entire class document is deleted in Firestore.
 * Performs a comprehensive cascade delete:
 * 1. Purges all physical Cloud Storage files under screenshots/, videos/, zips/, audio/, and recordings/.
 * 2. Purges all Firestore documents matching classId (screenshots, audio, videoJobs, zipJobs, irregularities, progress, etc.).
 * 3. Deletes subcollections (metadata/storage, lectureRecordings, screenBroadcast, liveSubtitles).
 * 4. Unlinks the class from teacherProfiles and studentProfiles.
 */
export const onClassDocDeleted = onDocumentDeleted({
  document: 'classes/{classId}',
  region: FUNCTION_REGION,
  timeoutSeconds: 540,
  memory: '512MiB',
}, async (event) => {
  const classId = event.params.classId;
  logger.info(`Class ${classId} was deleted. Commencing complete cascading purge...`);

  // 1. Purge all Cloud Storage assets
  const bucket = storage.bucket();
  const prefixes = [
    `screenshots/${classId}/`,
    `videos/${classId}/`,
    `zips/${classId}/`,
    `audio/${classId}/`,
    `recordings/${classId}/`,
    `taskDemos/${classId}/`
  ];

  for (const prefix of prefixes) {
    try {
      await bucket.deleteFiles({ prefix, force: true });
      logger.info(`Purged storage prefix: ${prefix}`);
    } catch (error) {
      logger.warn(`Could not purge prefix ${prefix}:`, error);
    }
  }

  // 2. Purge related Firestore collections in batches
  const collectionsToClean = [
    'screenshots',
    'audio',
    'videoJobs',
    'zipJobs',
    'videoAnalysisJobs',
    'irregularities',
    'progress',
    'propertyUploadJobs'
  ];

  for (const col of collectionsToClean) {
    try {
      const count = await deleteCollectionByClassId(col, classId);
      logger.info(`Purged ${count} documents from collection '${col}' for class ${classId}.`);
    } catch (error) {
      logger.warn(`Error purging collection '${col}' for class ${classId}:`, error);
    }
  }

  // 3. Purge subcollections
  try {
    await db.doc(`classes/${classId}/metadata/storage`).delete();
  } catch (err) {
    logger.warn(`Could not delete storage metadata for class ${classId}:`, err);
  }

  try {
    const lectureSnap = await db.collection(`classes/${classId}/lectureRecordings`).get();
    if (!lectureSnap.empty) {
      const batch = db.batch();
      lectureSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      logger.info(`Purged ${lectureSnap.size} lecture recording docs for class ${classId}.`);
    }
  } catch (err) {
    logger.warn(`Could not delete lectureRecordings subcollection for class ${classId}:`, err);
  }

  // Purge tasks and their submissions
  try {
    const tasksSnap = await db.collection(`classes/${classId}/tasks`).get();
    for (const taskDoc of tasksSnap.docs) {
      const subSnap = await taskDoc.ref.collection('submissions').get();
      if (!subSnap.empty) {
        const subBatch = db.batch();
        subSnap.docs.forEach(sDoc => subBatch.delete(sDoc.ref));
        await subBatch.commit();
      }
      await taskDoc.ref.delete();
    }
    if (!tasksSnap.empty) {
      logger.info(`Purged ${tasksSnap.size} tasks for class ${classId}.`);
    }
  } catch (err) {
    logger.warn(`Could not delete tasks subcollection for class ${classId}:`, err);
  }

  // Purge bingoSessions
  try {
    const bingoSnap = await db.collection(`classes/${classId}/bingoSessions`).get();
    if (!bingoSnap.empty) {
      const bBatch = db.batch();
      bingoSnap.docs.forEach(bDoc => bBatch.delete(bDoc.ref));
      await bBatch.commit();
      logger.info(`Purged ${bingoSnap.size} bingo sessions for class ${classId}.`);
    }
  } catch (err) {
    logger.warn(`Could not delete bingoSessions subcollection for class ${classId}:`, err);
  }

  // Purge status
  try {
    const statusSnap = await db.collection(`classes/${classId}/status`).get();
    if (!statusSnap.empty) {
      const sBatch = db.batch();
      statusSnap.docs.forEach(sDoc => sBatch.delete(sDoc.ref));
      await sBatch.commit();
    }
  } catch (err) {
    logger.warn(`Could not delete status subcollection for class ${classId}:`, err);
  }

  try {
    const ephemeralPaths = [
      `classes/${classId}/screenBroadcast/session`,
      `classes/${classId}/screenBroadcast/liveFrame`,
      `classes/${classId}/liveSubtitles/current`,
    ];
    const ephemBatch = db.batch();
    ephemeralPaths.forEach((p) => ephemBatch.delete(db.doc(p)));
    await ephemBatch.commit();
  } catch (err) {
    logger.warn(`Could not delete ephemeral docs for class ${classId}:`, err);
  }

  // 4. Unlink class from teacher & student profiles
  try {
    await removeClassFromProfiles('teacherProfiles', classId);
    await removeClassFromProfiles('studentProfiles', classId);
    logger.info(`Unlinked class ${classId} from teacher and student profiles.`);
  } catch (err) {
    logger.warn(`Error unlinking profiles for class ${classId}:`, err);
  }

  logger.info(`Cascade cleanup for class ${classId} completed successfully.`);
});

/**
 * Triggered whenever a class's retention policy (retentionDays) is updated.
 * Retroactively adjusts expireAt on existing screenshots for this class.
 * Any screenshots that are now expired will be deleted immediately.
 */
export const onClassRetentionUpdated = onDocumentUpdated({
  document: 'classes/{classId}',
  region: FUNCTION_REGION,
  timeoutSeconds: 300,
  memory: '512MiB',
}, async (event) => {
  const beforeData = event.data?.before?.data();
  const afterData = event.data?.after?.data();
  if (!beforeData || !afterData) return;

  const oldScreenshotDays = beforeData.retentionDays || 30;
  const newScreenshotDays = afterData.retentionDays || 30;
  const oldVideoDays = beforeData.videoRetentionDays || 90;
  const newVideoDays = afterData.videoRetentionDays || 90;

  const classId = event.params.classId;
  const now = Date.now();
  const BATCH_SIZE = 500;

  // 1. Handle Screenshot Retention Updates
  if (oldScreenshotDays !== newScreenshotDays) {
    logger.info(`Class ${classId} screenshot retention changed from ${oldScreenshotDays} to ${newScreenshotDays} days.`);
    const retentionMs = newScreenshotDays * 24 * 60 * 60 * 1000;
    let updatedCount = 0;
    let deletedCount = 0;
    let lastDoc = null;
    let hasMore = true;

    while (hasMore) {
      let query = db.collection('screenshots')
        .where('classId', '==', classId)
        .limit(BATCH_SIZE);

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const docDate = data.timestamp ? data.timestamp.toDate() : new Date();
        const newExpireAt = new Date(docDate.getTime() + retentionMs);

        if (newExpireAt.getTime() <= now) {
          batch.delete(doc.ref);
          deletedCount++;
        } else {
          batch.update(doc.ref, { expireAt: newExpireAt });
          updatedCount++;
        }
      });

      await batch.commit();

      if (snapshot.size < BATCH_SIZE) {
        hasMore = false;
      } else {
        lastDoc = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    logger.info(`Class ${classId} screenshot retention sync complete. Updated: ${updatedCount}, Pruned: ${deletedCount}`);

    // Also sync audio documents for this class
    let updatedAudioCount = 0;
    let deletedAudioCount = 0;
    let lastAudioDoc = null;
    let hasMoreAudio = true;

    while (hasMoreAudio) {
      let query = db.collection('audio')
        .where('classId', '==', classId)
        .limit(BATCH_SIZE);

      if (lastAudioDoc) {
        query = query.startAfter(lastAudioDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const docDate = data.timestamp ? (data.timestamp.toDate ? data.timestamp.toDate() : new Date(data.timestamp)) : new Date();
        const newExpireAt = new Date(docDate.getTime() + retentionMs);

        if (newExpireAt.getTime() <= now) {
          batch.delete(doc.ref);
          deletedAudioCount++;
        } else {
          batch.update(doc.ref, { expireAt: newExpireAt });
          updatedAudioCount++;
        }
      });

      await batch.commit();

      if (snapshot.size < BATCH_SIZE) {
        hasMoreAudio = false;
      } else {
        lastAudioDoc = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    logger.info(`Class ${classId} audio retention sync complete. Updated: ${updatedAudioCount}, Pruned: ${deletedAudioCount}`);
  }

  // 2. Handle Video Retention Updates
  if (oldVideoDays !== newVideoDays) {
    logger.info(`Class ${classId} video retention changed from ${oldVideoDays} to ${newVideoDays} days.`);
    const videoRetentionMs = newVideoDays * 24 * 60 * 60 * 1000;
    let updatedVideos = 0;
    let deletedVideos = 0;
    let lastVideoDoc = null;
    let hasMoreVideos = true;

    while (hasMoreVideos) {
      let query = db.collection('videoJobs')
        .where('classId', '==', classId)
        .limit(BATCH_SIZE);

      if (lastVideoDoc) {
        query = query.startAfter(lastVideoDoc);
      }

      const snapshot = await query.get();
      if (snapshot.empty) break;

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        const docDate = data.createdAt ? data.createdAt.toDate() : (data.startTime ? data.startTime.toDate() : new Date());
        const newExpireAt = new Date(docDate.getTime() + videoRetentionMs);

        if (newExpireAt.getTime() <= now) {
          batch.delete(doc.ref);
          deletedVideos++;
        } else {
          batch.update(doc.ref, { expireAt: newExpireAt });
          updatedVideos++;
        }
      });

      await batch.commit();

      if (snapshot.size < BATCH_SIZE) {
        hasMoreVideos = false;
      } else {
        lastVideoDoc = snapshot.docs[snapshot.docs.length - 1];
      }
    }
    logger.info(`Class ${classId} video retention sync complete. Updated: ${updatedVideos}, Pruned: ${deletedVideos}`);
  }
});

/**
 * Triggered whenever a videoJob document is deleted in Firestore.
 * Automatically deletes the physical .mp4 video from Cloud Storage.
 */
export const onVideoJobDocDeleted = onDocumentDeleted({
  document: 'videoJobs/{jobId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const docData = event.data?.data();
  if (!docData) return;

  const videoPath = docData.videoPath || docData.resultVideoPath;
  if (!videoPath) {
    logger.info(`VideoJob doc ${event.params.jobId} deleted but had no videoPath.`);
    return;
  }

  try {
    logger.info(`Deleting physical video Storage object: ${videoPath}`);
    const bucket = storage.bucket();
    await bucket.file(videoPath).delete({ ignoreNotFound: true });
    logger.info(`Successfully deleted video Storage object: ${videoPath}`);
  } catch (error) {
    logger.error(`Error deleting video storage file ${videoPath}:`, error);
  }
});

/**
 * Triggered whenever a zipJob document is deleted in Firestore.
 * Automatically deletes the physical .zip archive from Cloud Storage.
 */
export const onZipJobDocDeleted = onDocumentDeleted({
  document: 'zipJobs/{jobId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const docData = event.data?.data();
  if (!docData) return;

  const zipPath = docData.zipPath || docData.destinationPath;
  if (!zipPath) {
    logger.info(`ZipJob doc ${event.params.jobId} deleted but had no zipPath.`);
    return;
  }

  try {
    logger.info(`Deleting physical zip Storage object: ${zipPath}`);
    const bucket = storage.bucket();
    await bucket.file(zipPath).delete({ ignoreNotFound: true });
    logger.info(`Successfully deleted zip Storage object: ${zipPath}`);
  } catch (error) {
    logger.error(`Error deleting zip storage file ${zipPath}:`, error);
  }
});

