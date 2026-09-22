import './firebase.js';
import { onTaskDispatched } from "firebase-functions/v2/tasks";
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './analysisFlows.js';
import { FUNCTION_REGION } from './config.js';
import { resolveVideoDetails } from './processVideoAnalysisJob.js';
import { estimateCost } from './cost.js';
import { checkQuota } from './quotaManagement.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Atomically updates master job with task outcome and transitions master status
 * when all dispatched tasks reach terminal state.
 */
export async function recordTaskResult({ masterJobRef, isSuccess, jobId, video, error }) {
  await db.runTransaction(async (transaction) => {
    const masterDoc = await transaction.get(masterJobRef);
    if (!masterDoc.exists) return;

    const data = masterDoc.data() || {};
    const totalVideos = data.totalVideos || 0;
    const newProcessedCount = (data.processedCount || 0) + 1;
    const newSuccessCount = (data.successCount || 0) + (isSuccess ? 1 : 0);
    const newFailureCount = (data.failureCount || 0) + (isSuccess ? 0 : 1);

    const updatePayload = {
      processedCount: newProcessedCount,
      successCount: newSuccessCount,
      failureCount: newFailureCount,
    };

    if (isSuccess && jobId) {
      updatePayload.aiJobIds = FieldValue.arrayUnion(jobId);
    } else {
      updatePayload.failedVideos = FieldValue.arrayUnion({
        studentUid: video?.studentUid || null,
        studentEmail: video?.studentEmail || null,
        videoPath: video?.videoPath || video?.path || null,
        path: video?.videoPath || video?.path || null,
        error: error || 'Analysis failed',
      });
    }

    if (totalVideos > 0 && newProcessedCount >= totalVideos) {
      let finalStatus = 'failed';
      if (newFailureCount === 0 && newSuccessCount > 0) {
        finalStatus = 'completed';
      } else if (newFailureCount > 0 && newSuccessCount > 0) {
        finalStatus = 'partial_failure';
      }
      updatePayload.status = finalStatus;
      updatePayload.finishedAt = FieldValue.serverTimestamp();
      console.log(`[recordTaskResult] Master job ${masterJobRef.id} finished with status '${finalStatus}' (${newSuccessCount}/${totalVideos} succeeded, ${newFailureCount} failed).`);
    }

    transaction.update(masterJobRef, updatePayload);
  });
}

/**
 * Cloud Task worker to process a single student video analysis.
 * Configured with concurrency limits to prevent Gemini 429 quota exhaustion.
 */
export const analyzeSingleVideoTask = onTaskDispatched(
  {
    region: FUNCTION_REGION,
    retryConfig: {
      maxAttempts: 2,
    },
    rateLimits: {
      maxConcurrentDispatches: 4,
      maxDispatchesPerSecond: 2,
    },
    memory: '2GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    const {
      masterJobId,
      video,
      classId,
      modelToUse,
      prompt,
      startDate,
      endDate,
      startTimeIso,
      endTimeIso,
    } = request.data || {};

    if (!masterJobId || !video) {
      console.warn('[analyzeSingleVideoTask] Missing masterJobId or video in task payload.');
      return;
    }

    const masterJobRef = db.collection('videoAnalysisJobs').doc(masterJobId);
    const bucketName = storage.bucket().name;
    const { gsUri } = resolveVideoDetails(video, bucketName);

    if (!gsUri) {
      console.error(`[analyzeSingleVideoTask] Could not resolve gsUri for video:`, video);
      await recordTaskResult({
        masterJobRef,
        isSuccess: false,
        video,
        error: 'Could not resolve Cloud Storage URI for video.',
      });
      return;
    }

    const promptTemplate = `The following video is from a student.\nEmail: ${video.studentEmail}\nStudent UID: ${video.studentUid}\nClass ID: ${classId}\nThe video was recorded between ${startDate} and ${endDate}.\nPlease analyze the video based on the user's prompt: "${prompt}"\nIf you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

    try {
      const crypto = await import('crypto');
      const promptHash = crypto.createHash('sha256').update(promptTemplate).digest('hex');

      // 1. Check idempotency: avoid re-analyzing if an existing job is already completed or processing
      const existingJobsQuery = db.collection('aiJobs')
        .where('mediaPaths', 'array-contains', gsUri)
        .where('promptHash', '==', promptHash)
        .orderBy('timestamp', 'desc')
        .limit(1);

      const existingJobsSnapshot = await existingJobsQuery.get();
      if (!existingJobsSnapshot.empty) {
        const existingJobDoc = existingJobsSnapshot.docs[0];
        const existingJobData = existingJobDoc.data();

        if (existingJobData.status === 'completed' && existingJobData.result) {
          console.log(`[analyzeSingleVideoTask] Reusing completed job '${existingJobDoc.id}' for video '${video.videoPath}'.`);
          await recordTaskResult({
            masterJobRef,
            isSuccess: true,
            jobId: existingJobDoc.id,
            video,
          });
          return;
        }

        if (existingJobData.status === 'processing') {
          console.log(`[analyzeSingleVideoTask] Reusing processing job '${existingJobDoc.id}' for video '${video.videoPath}'.`);
          await recordTaskResult({
            masterJobRef,
            isSuccess: true,
            jobId: existingJobDoc.id,
            video,
          });
          return;
        }
      }

      // 2. Check quota
      const media = [{ media: { url: gsUri, contentType: 'video/mp4' } }];
      const estimatedCost = estimateCost(promptTemplate, media, modelToUse);
      const hasQuota = await checkQuota(classId, estimatedCost);

      if (!hasQuota) {
        console.warn(`[analyzeSingleVideoTask] Insufficient quota for video '${video.videoPath}'.`);
        const blockedJobId = await logJob({
          classId,
          studentUid: video.studentUid,
          studentEmail: video.studentEmail,
          jobType: 'analyzeSingleVideo',
          status: 'blocked-by-quota',
          promptText: promptTemplate,
          promptHash,
          mediaPaths: [gsUri],
          cost: 0,
          modelUsed: modelToUse,
          masterJobId,
        });

        await recordTaskResult({
          masterJobRef,
          isSuccess: false,
          jobId: blockedJobId,
          video,
          error: 'Insufficient class AI quota',
        });
        return;
      }

      // 3. Execute analysis flow
      const result = await analyzeSingleVideoFlow({
        videoUrl: gsUri,
        prompt,
        classId,
        studentUid: video.studentUid,
        studentEmail: video.studentEmail,
        masterJobId,
        startTime: startTimeIso,
        endTime: endTimeIso,
        model: modelToUse,
      });

      const isSuccess = Boolean(result && result.jobId && (!result.result || !result.result.startsWith('Error:')));
      const errorMsg = (!isSuccess && result?.result) ? result.result : (!result?.jobId ? 'Analysis flow did not return a job ID.' : null);

      await recordTaskResult({
        masterJobRef,
        isSuccess,
        jobId: result?.jobId,
        video,
        error: errorMsg,
      });

    } catch (err) {
      console.error(`[analyzeSingleVideoTask] Error processing video for ${video.studentEmail}:`, err);
      await recordTaskResult({
        masterJobRef,
        isSuccess: false,
        video,
        error: err.message || 'Unknown processing error',
      });
    }
  }
);
