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

  const oldDays = beforeData.retentionDays || 30;
  const newDays = afterData.retentionDays || 30;

  if (oldDays === newDays) return;

  const classId = event.params.classId;
  logger.info(`Class ${classId} retention changed from ${oldDays} to ${newDays} days. Recalculating expireAt...`);

  const now = Date.now();
  const retentionMs = newDays * 24 * 60 * 60 * 1000;
  const BATCH_SIZE = 500;
  let updatedCount = 0;
  let deletedCount = 0;

  // Process existing screenshots for this class in 500-item chunks
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
        // Document is already expired under the new retention policy -> Delete it
        batch.delete(doc.ref);
        deletedCount++;
      } else {
        // Update to new future expiration date
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

  logger.info(`Class ${classId} retention update complete. Updated: ${updatedCount}, Pruned: ${deletedCount}`);
});
