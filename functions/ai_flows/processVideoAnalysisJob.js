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



export const processVideoAnalysisJob = onDocumentCreated({ document: 'videoAnalysisJobs/{jobId}', region: FUNCTION_REGION, cpu: 1, memory: '2GiB', timeoutSeconds: 3600, concurrency: 1, maxInstances: 5 }, async (event) => {
  const jobDoc = event.data;
  const masterJobId = event.params.jobId;
  const jobData = jobDoc.data();

  await db.collection('videoAnalysisJobs').doc(masterJobId).update({ status: 'processing', failedVideos: [] });

  try {
    let videosToAnalyze = [];

    if (jobData.videos) { // Job for selected videos
      videosToAnalyze = jobData.videos;
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
        if (video.videoPath && !videoMap.has(video.videoPath)) {
          videoMap.set(video.videoPath, { studentUid: video.studentUid, studentEmail: video.studentEmail, videoPath: video.videoPath });
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

    const bucketName = storage.bucket().name;
    const BATCH_SIZE = 10; // Process 10 videos concurrently
    
    let totalSuccesses = 0;
    let totalFailures = 0;

    const classRef = db.collection('classes').doc(jobData.classId);
    const classDoc = await classRef.get();
    const timezone = classDoc.exists ? classDoc.data().schedule?.timeZone || 'UTC' : 'UTC';
    const startDate = jobData.startTime ? formatInTimeZone(jobData.startTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';
    const endDate = jobData.endTime ? formatInTimeZone(jobData.endTime.toDate(), timezone, "yyyy-MM-dd'T'HH:mm:ssXXX") : 'N/A';

    const promptTemplate = (video) => `The following video is from a student.\nEmail: ${video.studentEmail}\nStudent UID: ${video.studentUid}\nClass ID: ${jobData.classId}\nThe video was recorded between ${startDate} and ${endDate}.\nPlease analyze the video based on the user's prompt: "${jobData.prompt}"\nIf you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

    for (let i = 0; i < videosToAnalyze.length; i += BATCH_SIZE) {
      const batch = videosToAnalyze.slice(i, i + BATCH_SIZE);
      
      let batchEstimatedCost = 0;
      for (const video of batch) {
          const promptText = promptTemplate(video);
          const media = [{ media: { url: `gs://${bucketName}/${video.videoPath}`, contentType: 'video/mp4' } }];
          batchEstimatedCost += estimateCost(promptText, media);
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

                // For any other status (failed, blocked, etc.), do not create a new job.
                console.log(`Skipping job creation for video '${video.videoPath}' as existing job '${existingJobDoc.id}' has a non-actionable status: '${existingJobData.status}'.`);
                return { status: 'failure', video: video, error: `Existing job ${existingJobDoc.id} has status '${existingJobData.status}'. Use retry.` };
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
      const updatePayload = {};

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

