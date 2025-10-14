import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getFirestore } from 'firebase-admin/firestore';
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();

export const aggregatePerformanceMetrics = onDocumentCreated({ document: 'screenshotAnalyses/{analysisId}', region: FUNCTION_REGION }, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the event");
    return;
  }
  const analysisData = snapshot.data();
  const { studentUid, classId, currentTask, timestamp } = analysisData;

  const metricsQuery = db.collection('performanceMetrics')
    .where('studentUid', '==', studentUid)
    .where('classId', '==', classId)
    .where('status', '==', 'in-progress')
    .orderBy('startTime', 'desc')
    .limit(1);

  const querySnapshot = await metricsQuery.get();

  if (querySnapshot.empty) {
    // No active task, so start a new one
    await db.collection('performanceMetrics').add({
      studentUid,
      classId,
      taskName: currentTask,
      startTime: timestamp,
      status: 'in-progress',
    });
  } else {
    const activeMetricDoc = querySnapshot.docs[0];
    const activeMetricData = activeMetricDoc.data();

    if (activeMetricData.taskName !== currentTask) {
      // Task has changed, so complete the old one and start a new one
      const startTime = activeMetricData.startTime.toDate();
      const endTime = timestamp.toDate();
      const duration = (endTime - startTime) / 1000; // duration in seconds

      await activeMetricDoc.ref.update({
        status: 'completed',
        endTime: timestamp,
        duration: duration,
      });

      await db.collection('performanceMetrics').add({
        studentUid,
        classId,
        taskName: currentTask,
        startTime: timestamp,
        status: 'in-progress',
      });
    }
    // If task is the same, do nothing and wait for the next change
  }
});
