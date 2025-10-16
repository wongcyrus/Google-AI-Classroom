import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './analysisFlows.js';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const storage = getStorage();

export const processVideoAnalysisJob = onDocumentCreated({ document: 'videoAnalysisJobs/{jobId}', region: FUNCTION_REGION, cpu: 2, memory: '8GiB', timeoutSeconds: 3600, concurrency: 1, maxInstances: 50 }, async (event) => {
  const jobDoc = event.data;
  const masterJobId = event.params.jobId;
  const jobData = jobDoc.data();

  await db.collection('videoAnalysisJobs').doc(masterJobId).update({ status: 'processing' });

  try {
    let videosToAnalyze = [];

    if (jobData.videos) { // Job for selected videos
      videosToAnalyze = jobData.videos; // Expects array of { studentUid, studentEmail, videoPath }
    } else { // Job for all videos in a time range
      const videoJobsRef = db.collection('videoJobs');
      const q = videoJobsRef
        .where('status', '==', 'completed')
        .where('classId', '==', jobData.classId)
        .where(jobData.filterField, '>=', jobData.startTime)
        .where(jobData.filterField, '<=', jobData.endTime)
        .orderBy(jobData.filterField, 'desc');
      
      const querySnapshot = await q.get();
      querySnapshot.forEach(doc => {
        const video = doc.data();
        videosToAnalyze.push({ studentUid: video.studentUid, studentEmail: video.studentEmail, videoPath: video.videoPath });
      });
    }

    const bucketName = storage.bucket().name;
    const BATCH_SIZE = 10; // Process 10 videos concurrently

    for (let i = 0; i < videosToAnalyze.length; i += BATCH_SIZE) {
      const batch = videosToAnalyze.slice(i, i + BATCH_SIZE);
      
      const analysisPromises = batch.map(video => {
        return (async () => {
          try {
            const gsUri = `gs://${bucketName}/${video.videoPath}`;
            
            const result = await analyzeSingleVideoFlow({
              videoUrl: gsUri,
              prompt: jobData.prompt,
              classId: jobData.classId,
              studentUid: video.studentUid,
              studentEmail: video.studentEmail,
              masterJobId,
              startTime: jobData.startTime,
              endTime: jobData.endTime,
            });

            if (result && result.jobId) {
              return result.jobId;
            } else {
              console.warn(`analyzeSingleVideoFlow did not return a jobId for ${video.studentEmail}. Result:`, result);
              return null;
            }
          } catch (e) {
            console.error(`Failed to analyze video for ${video.studentEmail}`, e);
            // The error is already logged inside analyzeSingleVideoFlow
            return null;
          }
        })();
      });

      const batchResults = await Promise.all(analysisPromises);
      const validJobIds = batchResults.filter(id => id);
      if (validJobIds.length > 0) {
        await db.collection('videoAnalysisJobs').doc(masterJobId).update({
          aiJobIds: FieldValue.arrayUnion(...validJobIds),
        });
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
