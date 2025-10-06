import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './analysisFlows.js';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const storage = getStorage();

export const processVideoAnalysisJob = onDocumentCreated({ document: 'videoAnalysisJobs/{jobId}', region: FUNCTION_REGION, cpu: 2, memory: '8GiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 50 }, async (event) => {
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
        .where(jobData.filterField, '<=', jobData.endTime);
      
      const querySnapshot = await q.get();
      querySnapshot.forEach(doc => {
        const video = doc.data();
        videosToAnalyze.push({ studentUid: video.studentUid, studentEmail: video.studentEmail, videoPath: video.videoPath });
      });
    }

    const aiJobIds = [];
    for (const video of videosToAnalyze) {
      let file;
      try {
        file = storage.bucket().file(video.videoPath);
        await file.makePublic();
        const url = file.publicUrl();
        
        const { jobId } = await analyzeSingleVideoFlow({
          videoUrl: url,
          prompt: jobData.prompt,
          classId: jobData.classId,
          studentUid: video.studentUid,
          studentEmail: video.studentEmail,
          masterJobId,
        });

        aiJobIds.push(jobId);
      } catch (e) {
        console.error(`Failed to analyze video for ${video.studentEmail}`, e);
        // The error is already logged inside analyzeSingleVideoFlow
      } finally {
        if (file) {
          await file.makePrivate();
        }
      }
    }

    await db.collection('videoAnalysisJobs').doc(masterJobId).update({
      status: 'completed',
      aiJobIds: aiJobIds,
      completedAt: FieldValue.serverTimestamp(),
    });

  } catch (error) {
    console.error('Failed to process video analysis job:', error);
    await db.collection('videoAnalysisJobs').doc(masterJobId).update({
      status: 'failed',
      error: error.message,
    });
  }
});
