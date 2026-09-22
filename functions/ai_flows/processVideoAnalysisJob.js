import './firebase.js';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFunctions } from 'firebase-admin/functions';
import { FUNCTION_REGION } from './config.js';
import { formatInTimeZone } from 'date-fns-tz';

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
  // For strings or other types, try to create a Date object
  const d = new Date(date);
  if (!isNaN(d)) {
    return d.toISOString();
  }
  return null;
}



export function resolveVideoDetails(video, bucketName) {
  let raw = video?.videoPath || video?.path || video?.url || '';
  if (!raw || raw.endsWith('/undefined') || raw === 'undefined') return { relativePath: '', gsUri: '' };

  const gsPrefix = `gs://${bucketName}/`;
  const httpsPrefix = `https://storage.googleapis.com/${bucketName}/`;

  let relativePath = raw;
  if (relativePath.startsWith(gsPrefix)) {
    relativePath = relativePath.substring(gsPrefix.length);
  } else if (relativePath.startsWith('gs://')) {
    const parts = relativePath.replace('gs://', '').split('/');
    parts.shift();
    relativePath = parts.join('/');
  } else if (relativePath.startsWith(httpsPrefix)) {
    relativePath = decodeURIComponent(relativePath.substring(httpsPrefix.length));
  } else if (relativePath.startsWith('https://storage.googleapis.com/')) {
    const withoutHost = decodeURIComponent(relativePath.replace('https://storage.googleapis.com/', ''));
    const parts = withoutHost.split('/');
    parts.shift();
    relativePath = parts.join('/');
  }

  if (relativePath.startsWith('/')) {
    relativePath = relativePath.substring(1);
  }

  const gsUri = `gs://${bucketName}/${relativePath}`;

  return {
    relativePath,
    gsUri
  };
}

export const processVideoAnalysisJob = onDocumentCreated({ document: 'videoAnalysisJobs/{jobId}', region: FUNCTION_REGION, cpu: 1, memory: '2GiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 5 }, async (event) => {
  const jobDoc = event.data;
  const masterJobId = event.params.jobId;
  const jobData = jobDoc.data();

  await db.collection('videoAnalysisJobs').doc(masterJobId).update({ status: 'processing', failedVideos: [] });

  try {
    const bucketName = storage.bucket().name;
    let videosToAnalyze = [];

    if (jobData.videos) { // Job for selected videos
      videosToAnalyze = jobData.videos.map(v => {
        const { relativePath } = resolveVideoDetails(v, bucketName);
        return {
          ...v,
          videoPath: relativePath,
          path: relativePath,
        };
      }).filter(v => v.videoPath);
    } else { // Job for all videos in a time range
      const videoJobsRef = db.collection('videoJobs');
      const q = videoJobsRef
        .where('status', '==', 'completed')
        .where('classId', '==', jobData.classId)
        .where(jobData.filterField, '>=', jobData.startTime)
        .where(jobData.filterField, '<=', jobData.endTime)
        .orderBy(jobData.filterField, 'desc');
      
      const querySnapshot = await q.get();
      
      // De-duplicate videos by path to prevent redundant analysis
      const videoMap = new Map();
      querySnapshot.forEach(doc => {
        const video = doc.data();
        const { relativePath } = resolveVideoDetails(video, bucketName);
        if (relativePath && !videoMap.has(relativePath)) {
          videoMap.set(relativePath, { 
            studentUid: video.studentUid, 
            studentEmail: video.studentEmail, 
            videoPath: relativePath,
            path: relativePath,
          });
        }
      });
      videosToAnalyze = Array.from(videoMap.values());
    }

    const MAX_VIDEOS_PER_JOB = 100;
    let jobNotes = jobData.notes || null;

    if (videosToAnalyze.length > MAX_VIDEOS_PER_JOB) {
        videosToAnalyze = videosToAnalyze.slice(0, MAX_VIDEOS_PER_JOB);
        jobNotes = `Job truncated to the first ${MAX_VIDEOS_PER_JOB} unique videos found. Create a new job with a more specific time range to process remaining videos.`;
    }

    if (videosToAnalyze.length === 0) {
      await db.collection('videoAnalysisJobs').doc(masterJobId).update({
        status: 'completed',
        totalVideos: 0,
        processedCount: 0,
        successCount: 0,
        failureCount: 0,
        finishedAt: FieldValue.serverTimestamp(),
      });
      return;
    }

    const classRef = db.collection('classes').doc(jobData.classId);
    const classDoc = await classRef.get();
    const classData = classDoc.exists ? classDoc.data() : {};
    const modelToUse = jobData.model || classData.aiModel || 'gemini-3.5-flash-lite';
    const timezone = classData.schedule?.timeZone || 'UTC';
    const startDate = jobData.startTime ? formatInTimeZone(jobData.startTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
    const endDate = jobData.endTime ? formatInTimeZone(jobData.endTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
    const startTimeIso = getISOString(jobData.startTime);
    const endTimeIso = getISOString(jobData.endTime);

    // Initial state: Set totalVideos and mark job as processing
    await db.collection('videoAnalysisJobs').doc(masterJobId).update({
      status: 'processing',
      modelUsed: modelToUse,
      totalVideos: videosToAnalyze.length,
      processedCount: 0,
      successCount: 0,
      failureCount: 0,
      failedVideos: [],
      dispatchedAt: FieldValue.serverTimestamp(),
      ...(jobNotes ? { notes: jobNotes } : {})
    });

    // Enqueue all videos to Cloud Tasks queue for distributed, rate-limited processing
    const queue = getFunctions().taskQueue(`locations/${FUNCTION_REGION}/functions/analyzeSingleVideoTask`);

    const CHUNK_SIZE = 20;
    for (let i = 0; i < videosToAnalyze.length; i += CHUNK_SIZE) {
      const chunk = videosToAnalyze.slice(i, i + CHUNK_SIZE);
      await Promise.all(chunk.map((video, idx) => {
        const sanitizedTaskId = `video-${masterJobId}-${i + idx}-${Date.now().toString(36)}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 100);

        return queue.enqueue(
          {
            masterJobId,
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

    console.log(`[processVideoAnalysisJob] Successfully enqueued ${videosToAnalyze.length} video tasks for job ${masterJobId}.`);

  } catch (error) {
    console.error('Failed to process video analysis job:', error);
    await db.collection('videoAnalysisJobs').doc(masterJobId).update({
      status: 'failed',
      error: error.message,
    });
  }
});

