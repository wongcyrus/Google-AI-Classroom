import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { fromZonedTime } from 'date-fns-tz';

import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';

const db = getFirestore();
const storage = getStorage();

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

  console.log(`Querying for screenshots in class ${classId} between ${start.toISOString()} and ${end.toISOString()}`);

  const screenshotsQuery = db
    .collection('screenshots')
    .where('classId', '==', classId)
    .where('timestamp', '>=', start)
    .where('timestamp', '<=', end)
    .where('deleted', '==', false);

  try {
    const stream = screenshotsQuery.stream();
    const promises = [];
    let batch = db.batch();
    let count = 0;
    let totalCount = 0;

    return new Promise((resolve, reject) => {
        stream.on('data', (doc) => {
            totalCount++;
            const screenshotData = doc.data();
            if (screenshotData.imagePath) {
                const imageRef = storage.bucket().file(screenshotData.imagePath);
                promises.push(imageRef.delete().catch(err => console.error(`Failed to delete ${screenshotData.imagePath}:`, err)));
            }
            batch.update(doc.ref, { imagePath: null, deleted: true });
            count++;

            if (count === 499) {
                promises.push(batch.commit());
                batch = db.batch();
                count = 0;
            }
        });

        stream.on('end', async () => {
            if (count > 0) {
                promises.push(batch.commit());
            }

            try {
                await Promise.all(promises);
                if (totalCount === 0) {
                    resolve({ status: 'success', message: 'No screenshots found in the specified range.' });
                } else {
                    resolve({ status: 'success', message: `Successfully deleted ${totalCount} screenshots.` });
                }
            } catch (error) {
                console.error('Error in stream end:', error);
                reject(new HttpsError('internal', 'An error occurred during the final batch commit.'));
            }
        });

        stream.on('error', (err) => {
            console.error('Error reading screenshots stream:', err);
            reject(new HttpsError('internal', 'An error occurred while reading screenshots.'));
        });
    });

  } catch (error) {
    console.error('Error deleting screenshots:', error);
    throw new HttpsError(
      'internal',
      'An error occurred while deleting screenshots.'
    );
  }
});
