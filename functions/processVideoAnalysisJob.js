import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './gemini.js';

const db = getFirestore();
const storage = getStorage();

export const processVideoAnalysisJob = onDocumentCreated({ document: 'videoAnalysisJobs/{jobId}', cpu: 2, memory: '8GiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 50 }, async (event) => {
  const jobDoc = event.data;
  const jobId = event.params.jobId;
  const jobData = jobDoc.data();

  await db.collection('videoAnalysisJobs').doc(jobId).update({ status: 'processing' });

  try {
    let videosToAnalyze = [];

    if (jobData.videos) { // Job for selected videos
      videosToAnalyze = jobData.videos; // Expects array of { student, videoPath }
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
        videosToAnalyze.push({ student: video.student, videoPath: video.videoPath });
      });
    }

    const analysisResults = {};
    for (const video of videosToAnalyze) {
      let file;
      try {
        file = storage.bucket().file(video.videoPath);
        await file.makePublic();
        const url = file.publicUrl();
        
        const result = await analyzeSingleVideoFlow({
          videoUrl: url,
          prompt: jobData.prompt,
          classId: jobData.classId,
          studentEmail: video.student,
        });

        analysisResults[video.student] = result;
      } catch (e) {
        console.error(`Failed to analyze video for ${video.student}`, e);
        analysisResults[video.student] = 'Error: Failed to analyze video.';
      } finally {
        if (file) {
          await file.makePrivate();
        }
      }
    }

    await db.collection('videoAnalysisJobs').doc(jobId).update({
      status: 'completed',
      results: analysisResults,
      completedAt: FieldValue.serverTimestamp(),
    });

  } catch (error) {
    console.error('Failed to process video analysis job:', error);
    await db.collection('videoAnalysisJobs').doc(jobId).update({
      status: 'failed',
      error: error.message,
    });
  }
});
