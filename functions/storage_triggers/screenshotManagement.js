import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { fromZonedTime } from 'date-fns-tz';

import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Deletes screenshots and audio recordings for a class within a specified date range.
 * Purges both physical Cloud Storage blobs and Firestore documents.
 */
export const deleteScreenshotsByDateRange = onCall({ region: FUNCTION_REGION, cors: CORS_ORIGINS, memory: '512MiB' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError(
      'unauthenticated',
      'The function must be called while authenticated.'
    );
  }

  console.log('deleteScreenshotsByDateRange received data:', request.data);

  const { classId, startDate, endDate, timezone } = request.data;

  if (!classId || !startDate || !endDate) {
    throw new HttpsError(
      'invalid-argument',
      'The function must be called with classId, startDate, and endDate.'
    );
  }

  const tz = timezone || 'UTC';
  const start = fromZonedTime(startDate, tz);
  const end = fromZonedTime(endDate, tz);

  console.log(`Querying for telemetry assets (screenshots & audio) in class ${classId} between ${start.toISOString()} and ${end.toISOString()}`);

  const bucket = storage.bucket();
  const BATCH_SIZE = 450;
  let totalScreenshots = 0;
  let totalAudio = 0;

  try {
    // 1. Process Screenshots
    const screenshotsSnap = await db
      .collection('screenshots')
      .where('classId', '==', classId)
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .get();

    if (!screenshotsSnap.empty) {
      let batch = db.batch();
      let count = 0;
      for (const docSnap of screenshotsSnap.docs) {
        totalScreenshots++;
        const data = docSnap.data();
        const imagePath = data.imagePath || data.storagePath;
        if (imagePath) {
          bucket.file(imagePath).delete({ ignoreNotFound: true }).catch((err) => {
            console.warn(`Could not delete storage file ${imagePath}:`, err);
          });
        }
        batch.delete(docSnap.ref);
        count++;

        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    }

    // 2. Process Audio Recordings
    const audioSnap = await db
      .collection('audio')
      .where('classId', '==', classId)
      .where('timestamp', '>=', start)
      .where('timestamp', '<=', end)
      .get();

    if (!audioSnap.empty) {
      let batch = db.batch();
      let count = 0;
      for (const docSnap of audioSnap.docs) {
        totalAudio++;
        const data = docSnap.data();
        const audioPath = data.audioPath || data.storagePath;
        if (audioPath) {
          bucket.file(audioPath).delete({ ignoreNotFound: true }).catch((err) => {
            console.warn(`Could not delete storage file ${audioPath}:`, err);
          });
        }
        batch.delete(docSnap.ref);
        count++;

        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = db.batch();
          count = 0;
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    }

    const totalPurged = totalScreenshots + totalAudio;
    if (totalPurged === 0) {
      return { status: 'success', message: 'No screenshots or audio recordings found in the specified date range.' };
    }

    return {
      status: 'success',
      message: `Successfully deleted ${totalScreenshots} screenshots and ${totalAudio} audio recordings.`,
      screenshotsCount: totalScreenshots,
      audioCount: totalAudio,
    };
  } catch (error) {
    console.error('Error deleting telemetry by date range:', error);
    throw new HttpsError(
      'internal',
      `An error occurred while deleting telemetry: ${error.message}`
    );
  }
});
