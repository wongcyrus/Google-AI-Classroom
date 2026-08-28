import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Triggered whenever a screenshot document is deleted in Firestore.
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
 * Triggered whenever an entire class document is deleted in Firestore.
 * Purges all associated Storage folders (screenshots, videos, zips) for that class.
 */
export const onClassDocDeleted = onDocumentDeleted({
  document: 'classes/{classId}',
  region: FUNCTION_REGION,
}, async (event) => {
  const classId = event.params.classId;
  logger.info(`Class ${classId} was deleted. Purging associated Storage assets...`);

  const bucket = storage.bucket();
  const prefixes = [
    `screenshots/${classId}/`,
    `videos/${classId}/`,
    `zips/${classId}/`
  ];

  for (const prefix of prefixes) {
    try {
      await bucket.deleteFiles({ prefix, force: true });
      logger.info(`Purged storage prefix: ${prefix}`);
    } catch (error) {
      logger.warn(`Could not purge prefix ${prefix}:`, error);
    }
  }
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

