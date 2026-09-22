import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { formatInTimeZone } from 'date-fns-tz';
import { resolveVideoDetails } from './processVideoAnalysisJob.js';

const db = getFirestore();
const storage = getStorage();

function getISOString(date) {
  if (!date) return null;
  if (typeof date.toDate === 'function') { // Firestore Timestamp
    return date.toDate().toISOString();
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  const d = new Date(date);
  if (!isNaN(d)) {
    return d.toISOString();
  }
  return null;
}

export const retryVideoAnalysisJob = onCall({ region: FUNCTION_REGION, cors: CORS_ORIGINS, cpu: 2, memory: '8GiB', timeoutSeconds: 3600 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const { jobId } = request.data;
    if (!jobId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "jobId".');
    }

    const masterJobRef = db.collection('videoAnalysisJobs').doc(jobId);
    const jobDoc = await masterJobRef.get();

    if (!jobDoc.exists) {
        throw new HttpsError('not-found', `Job with ID ${jobId} not found.`);
    }

    const jobData = jobDoc.data();
    const bucketName = storage.bucket().name;
    const rawFailed = jobData.failedVideos || [];
    let videosToAnalyze = rawFailed.map(v => {
        const { relativePath } = resolveVideoDetails(v, bucketName);
        return {
            ...v,
            videoPath: relativePath,
            path: relativePath,
        };
    }).filter(v => v.videoPath);

    // Fallback for legacy jobs or when failedVideos had invalid entries
    if (videosToAnalyze.length === 0) {
        const aiJobsSnapshot = await db.collection('aiJobs').where('masterJobId', '==', jobId).where('status', '==', 'failed').get();
        if (!aiJobsSnapshot.empty) {
            videosToAnalyze = aiJobsSnapshot.docs.map(doc => {
                const job = doc.data();
                const url = (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || job.path;
                if (!url) return null;

                const { relativePath } = resolveVideoDetails({ videoPath: url }, bucketName);
                if (!relativePath) return null;

                return {
                    studentUid: job.studentUid,
                    studentEmail: job.studentEmail,
                    videoPath: relativePath,
                    path: relativePath,
                };
            }).filter(v => v && v.videoPath && v.studentUid);
        }
    }

    if (videosToAnalyze.length === 0) {
        throw new HttpsError('failed-precondition', 'Could not find any failed videos to retry for this job.');
    }

    const existingSuccessCount = (jobData.aiJobIds && jobData.aiJobIds.length) || 0;
    const retryCount = videosToAnalyze.length;
    const totalVideos = existingSuccessCount + retryCount;

    await masterJobRef.update({
        status: 'processing',
        failedVideos: [], // Clear the list for the new retry attempt
        totalVideos: totalVideos,
        processedCount: existingSuccessCount,
        successCount: existingSuccessCount,
        failureCount: 0,
        retryHistory: FieldValue.arrayUnion({
            retriedAt: new Date().toISOString(),
            videoCount: retryCount,
            originalFailures: videosToAnalyze 
        })
    });

    try {
        const classRef = db.collection('classes').doc(jobData.classId);
        const classDoc = await classRef.get();
        const classData = classDoc.exists ? classDoc.data() : {};
        const modelToUse = jobData.model || classData.aiModel || 'gemini-3.5-flash-lite';
        const timezone = classData.schedule?.timeZone || 'UTC';
        const startDate = jobData.startTime ? formatInTimeZone(jobData.startTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
        const endDate = jobData.endTime ? formatInTimeZone(jobData.endTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
        const startTimeIso = getISOString(jobData.startTime);
        const endTimeIso = getISOString(jobData.endTime);

        const queue = getFunctions().taskQueue(`locations/${FUNCTION_REGION}/functions/analyzeSingleVideoTask`);

        const CHUNK_SIZE = 20;
        for (let i = 0; i < videosToAnalyze.length; i += CHUNK_SIZE) {
            const chunk = videosToAnalyze.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map((video, idx) => {
                const sanitizedTaskId = `retry-${jobId}-${i + idx}-${Date.now().toString(36)}`
                    .replace(/[^a-zA-Z0-9_-]/g, '_')
                    .slice(0, 100);

                return queue.enqueue(
                    {
                        masterJobId: jobId,
                        video,
                        classId: jobData.classId,
                        modelToUse,
                        prompt: jobData.prompt || '',
                        startDate,
                        endDate,
                        startTimeIso,
                        endTimeIso,
                    },
                    {
                        id: sanitizedTaskId,
                    }
                );
            }));
        }

        console.log(`[retryVideoAnalysisJob] Successfully enqueued ${videosToAnalyze.length} retry video tasks for job ${jobId}.`);
        return { result: `Successfully enqueued ${videosToAnalyze.length} failed videos for retry in job ${jobId}.` };

    } catch (error) {
        await masterJobRef.update({
            status: 'failed',
            error: `Retry failed: ${error.message}`,
        });
        throw new HttpsError('internal', `Failed to process retry for job ${jobId}`, error);
    }
});

