import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();

export const triggerAutomaticAnalysis = onDocumentUpdated({ document: 'videoJobs/{jobId}', region: FUNCTION_REGION }, async (event) => {
  const beforeData = event.data.before.data();
  const afterData = event.data.after.data();

  const isTerminal = (status) => status === 'completed' || status === 'failed';

  // Check if the job status changed to a terminal state
  if (isTerminal(beforeData.status) || !isTerminal(afterData.status)) {
    logger.info(`Job ${event.params.jobId} status did not transition to a terminal state. Before: ${beforeData.status}, After: ${afterData.status}. No action needed.`);
    return;
  }

  const { classId, startTime, endTime } = afterData;

  if (!classId || !startTime || !endTime) {
    logger.info(`Job ${event.params.jobId} is missing classId, startTime, or endTime. Cannot trigger analysis.`);
    return;
  }

  logger.info(`Terminal video job ${event.params.jobId} detected for class ${classId}. Checking if analysis should be triggered.`);

  const classRef = db.collection('classes').doc(classId);
  const classDoc = await classRef.get();

  if (!classDoc.exists) {
    logger.warn(`Class document ${classId} not found.`);
    return;
  }

  const classData = classDoc.data();
  const { students, afterClassVideoPrompt } = classData;

  // Check if the class is configured for automatic analysis
  if (!classData.automaticCombine || !afterClassVideoPrompt || !afterClassVideoPrompt.promptText) {
    logger.info(`Class ${classId} is not configured for automatic analysis.`);
    return;
  }

  const studentUids = students ? Object.keys(students) : [];
  if (studentUids.length === 0) {
    logger.warn(`Class ${classId} has no students configured.`);
    return;
  }

  const totalStudents = studentUids.length;

  // Check if all videos for this session are finished (completed or failed)
  const videoJobsRef = db.collection('videoJobs');
  const q = videoJobsRef
    .where('classId', '==', classId)
    .where('startTime', '==', startTime)
    .where('endTime', '==', endTime)
    .where('status', 'in', ['completed', 'failed']);

  const finishedJobsSnapshot = await q.get();
  const finishedCount = finishedJobsSnapshot.size;

  logger.info(`Found ${finishedCount}/${totalStudents} finished video jobs for class ${classId} session at ${startTime.toDate().toISOString()}`);

  if (finishedCount >= totalStudents) {
    logger.info(`All ${totalStudents} video jobs are finished for class ${classId}. Triggering analysis.`);

    // Create a deterministic ID to prevent duplicate jobs
    const analysisJobId = `auto-analysis-${classId}-${startTime.toDate().toISOString()}`;
    const analysisJobRef = db.collection('videoAnalysisJobs').doc(analysisJobId);

    const jobDoc = await analysisJobRef.get();
    if (!jobDoc.exists) {
      logger.info(`Creating video analysis job '${analysisJobId}' for class ${classId}`);
      await analysisJobRef.set({
        jobId: analysisJobId,
        classId: classId,
        requester: 'system-automatic-analysis',
        startTime: startTime,
        endTime: endTime,
        filterField: 'startTime',
        prompt: afterClassVideoPrompt.promptText,
        status: 'pending',
        deleted: false,
        createdAt: FieldValue.serverTimestamp(),
      });
    } else {
      logger.info(`Video analysis job '${analysisJobId}' already exists. Skipping creation.`);
    }
  }
});
