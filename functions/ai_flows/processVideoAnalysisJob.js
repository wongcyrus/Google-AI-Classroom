import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './analysisFlows.js';
import { FUNCTION_REGION } from './config.js';
import { estimateCost } from './cost.js';
import { checkQuota } from './quotaManagement.js';
import { logJob } from './jobLogger.js';
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
      await db.collection('videoAnalysisJobs').doc(masterJobId).update({ status: 'completed' });
      return;
    }

    const BATCH_SIZE = 4; // Process 4 videos concurrently to avoid Gemini API 429 rate limit spikes
    
    let totalSuccesses = 0;
    let totalFailures = 0;

    const classRef = db.collection('classes').doc(jobData.classId);
    const classDoc = await classRef.get();
    const classData = classDoc.exists ? classDoc.data() : {};
    const modelToUse = jobData.model || classData.aiModel || 'gemini-3.5-flash-lite';
    const timezone = classData.schedule?.timeZone || 'UTC';
    const startDate = jobData.startTime ? formatInTimeZone(jobData.startTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
    const endDate = jobData.endTime ? formatInTimeZone(jobData.endTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';

    const promptTemplate = (video) => `The following video is from a student.\nEmail: ${video.studentEmail}\nStudent UID: ${video.studentUid}\nClass ID: ${jobData.classId}\nThe video was recorded between ${startDate} and ${endDate}.\nPlease analyze the video based on the user's prompt: "${jobData.prompt}"\nIf you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

    for (let i = 0; i < videosToAnalyze.length; i += BATCH_SIZE) {
      const batch = videosToAnalyze.slice(i, i + BATCH_SIZE);
      
      let batchEstimatedCost = 0;
      for (const video of batch) {
          const promptText = promptTemplate(video);
          const media = [{ media: { url: `gs://${bucketName}/${video.videoPath}`, contentType: 'video/mp4' } }];
          batchEstimatedCost += estimateCost(promptText, media, modelToUse);
      }

      const hasQuota = await checkQuota(jobData.classId, batchEstimatedCost);

      if (!hasQuota) {
          console.warn(`Insufficient quota for batch starting at index ${i}. Estimated cost: ${batchEstimatedCost}`);
          const blockedJobPromises = batch.map(video => {
              const promptText = promptTemplate(video);
              return logJob({
                  classId: jobData.classId,
                  studentUid: video.studentUid,
                  studentEmail: video.studentEmail,
                  jobType: 'analyzeSingleVideo',
                  status: 'blocked-by-quota',
                  promptText: promptText,
                  mediaPaths: [`gs://${bucketName}/${video.videoPath}`],
                  cost: 0,
                  masterJobId,
              });
          });
          const blockedJobIds = await Promise.all(blockedJobPromises);

          await db.collection('videoAnalysisJobs').doc(masterJobId).update({
              aiJobIds: FieldValue.arrayUnion(...blockedJobIds),
              failedVideos: FieldValue.arrayUnion(...batch)
          });
          totalFailures += batch.length;
          continue;
      }

      const analysisPromises = batch.map(video => {
        return (async () => {
          try {
            const gsUri = `gs://${bucketName}/${video.videoPath}`;
            const promptText = promptTemplate(video);

            const crypto = await import('crypto');
            const promptHash = crypto.createHash('sha256').update(promptText).digest('hex');

            // Idempotency Check: Look for an existing job to prevent duplicates.
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
                    console.log(`Reusing completed job '${existingJobDoc.id}' for video '${video.videoPath}'.`);
                    return { status: 'success', jobId: existingJobDoc.id };
                }

                if (existingJobData.status === 'processing') {
                    console.log(`Skipping job creation for video '${video.videoPath}' as job '${existingJobDoc.id}' is already processing.`);
                    return { status: 'success', jobId: existingJobDoc.id }; // Return existing job to monitor
                }

                // If the previous job failed or was blocked, proceed with a fresh analysis attempt
                console.log(`Previous job '${existingJobDoc.id}' has status '${existingJobData.status}'. Proceeding with fresh analysis for video '${video.videoPath}'.`);
            }

            // If no valid existing job, proceed with analysis.
            const result = await analyzeSingleVideoFlow({
              videoUrl: gsUri,
              prompt: jobData.prompt,
              classId: jobData.classId,
              studentUid: video.studentUid,
              studentEmail: video.studentEmail,
              masterJobId,
              startTime: getISOString(jobData.startTime),
              endTime: getISOString(jobData.endTime),
              model: modelToUse,
            });

            if (result && result.jobId) {
              if (result.result?.startsWith('Error:')) {
                return { status: 'failure', video: video, error: result.result };
              }
              return { status: 'success', jobId: result.jobId };
            } else {
              console.warn(`analyzeSingleVideoFlow did not return a jobId for ${video.studentEmail}. Result:`, result);
              return { status: 'failure', video: video, error: 'Analysis flow did not return a job ID.' };
            }
          } catch (e) {
            console.error(`Failed to analyze video for ${video.studentEmail}`, e);
            return { status: 'failure', video: video, error: e.message };
          }
        })();
      });

      const batchResults = await Promise.all(analysisPromises);
      
      const successfulJobs = batchResults.filter(r => r.status === 'success');
      const failedJobs = batchResults.filter(r => r.status === 'failure');

      totalSuccesses += successfulJobs.length;
      totalFailures += failedJobs.length;

      const isLastBatch = (i + batch.length) >= videosToAnalyze.length;
      const updatePayload = {
        modelUsed: modelToUse,
      };

      if (successfulJobs.length > 0) {
        updatePayload.aiJobIds = FieldValue.arrayUnion(...successfulJobs.map(j => j.jobId));
      }
      if (failedJobs.length > 0) {
        updatePayload.failedVideos = FieldValue.arrayUnion(...failedJobs.map(j => j.video));
      }

      if (isLastBatch) {
        let finalStatus = 'failed';
        if (totalFailures === 0 && totalSuccesses > 0) {
            finalStatus = 'completed';
        } else if (totalFailures > 0 && totalSuccesses > 0) {
            finalStatus = 'partial_failure';
        }
        updatePayload.status = finalStatus;
        if (jobNotes) {
            updatePayload.notes = jobNotes;
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        await db.collection('videoAnalysisJobs').doc(masterJobId).update(updatePayload);
      }
    }

  } catch (error) {
    console.error('Failed to process video analysis job:', error);
    await db.collection('videoAnalysisJobs').doc(masterJobId).update({
      status: 'failed',
      error: error.message,
    });
  }
});

