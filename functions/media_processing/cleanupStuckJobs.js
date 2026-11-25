import './firebase.js';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { getFirestore } from 'firebase-admin/firestore';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();

const STUCK_JOB_TIMEOUT_MINUTES = 120;
const BATCH_LIMIT = 400;
const MAX_BATCHES = 25;

export const cleanupStuckJobs = onSchedule({ schedule: 'every 1 hours', region: FUNCTION_REGION }, async () => {
  console.log('Running job to clean up stuck video processing jobs.');

  const cutoffTime = new Date(Date.now() - STUCK_JOB_TIMEOUT_MINUTES * 60 * 1000);

  try {
    let totalCleaned = 0;

    for (let batchIdx = 0; batchIdx < MAX_BATCHES; batchIdx++) {
      const stuckJobsQuery = db.collection('videoJobs')
        .where('status', '==', 'processing')
        .where('startedAt', '<', cutoffTime)
        .limit(BATCH_LIMIT);

      const querySnapshot = await stuckJobsQuery.get();
      if (querySnapshot.empty) {
        break;
      }

      console.log(`Found ${querySnapshot.size} stuck jobs (batch ${batchIdx + 1}). Marking them as failed.`);

      const batch = db.batch();
      const finishedAt = new Date();
      querySnapshot.forEach(doc => {
        const jobRef = doc.ref;
        batch.update(jobRef, {
          status: 'failed',
          finishedAt,
          error: `Processing timed out after ${STUCK_JOB_TIMEOUT_MINUTES} minutes.`,
          ffmpegError: `The job was marked as failed by the cleanup service because it was stuck in the 'processing' state for more than ${STUCK_JOB_TIMEOUT_MINUTES} minutes. This usually indicates the function timed out or crashed due to memory limits.`
        });
      });

      await batch.commit();
      totalCleaned += querySnapshot.size;

      if (querySnapshot.size < BATCH_LIMIT) {
        break;
      }
    }

    if (totalCleaned === 0) {
      console.log('No stuck jobs found.');
    } else {
      console.log(`Successfully marked ${totalCleaned} jobs as failed.`);
    }
  } catch (error) {
    console.error('Failed to clean up stuck jobs:', error);
  }
});
