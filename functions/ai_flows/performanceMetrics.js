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
  const analysisData = snapshot.data() || {};
  const { studentUid, classId, currentTask, timestamp } = analysisData;

  if (!studentUid || !classId || !currentTask || !timestamp) {
    console.warn('[aggregatePerformanceMetrics] Missing required analysis fields; skipping.', { studentUid, classId, currentTask });
    return;
  }

  const toDateSafe = (ts) => (ts?.toDate ? ts.toDate() : new Date(ts));
  const eventDate = toDateSafe(timestamp);
  if (isNaN(eventDate.getTime())) {
    console.warn('[aggregatePerformanceMetrics] Invalid analysis timestamp; skipping.');
    return;
  }

  const metricsCol = db.collection('performanceMetrics');
  const metricsQuery = metricsCol
    .where('studentUid', '==', studentUid)
    .where('classId', '==', classId)
    .where('status', '==', 'in-progress')
    .orderBy('startTime', 'desc')
    .limit(1);

  if (typeof db.runTransaction === 'function') {
    await db.runTransaction(async (tx) => {
      const querySnapshot = await tx.get(metricsQuery);
      if (querySnapshot.empty) {
        const newRef = metricsCol.doc();
        tx.set(newRef, {
          studentUid,
          classId,
          taskName: currentTask,
          startTime: timestamp,
          status: 'in-progress',
        });
        return;
      }

      const activeMetricDoc = querySnapshot.docs[0];
      const activeMetricData = activeMetricDoc.data() || {};
      if (activeMetricData.taskName !== currentTask) {
        const startTime = toDateSafe(activeMetricData.startTime);
        const duration = isNaN(startTime.getTime()) ? 0 : Math.max(0, (eventDate - startTime) / 1000);

        tx.update(activeMetricDoc.ref, {
          status: 'completed',
          endTime: timestamp,
          duration,
        });

        const newRef = metricsCol.doc();
        tx.set(newRef, {
          studentUid,
          classId,
          taskName: currentTask,
          startTime: timestamp,
          status: 'in-progress',
        });
      }
    });
    return;
  }

  const querySnapshot = await metricsQuery.get();

  if (querySnapshot.empty) {
    // No active task, so start a new one
    await metricsCol.add({
      studentUid,
      classId,
      taskName: currentTask,
      startTime: timestamp,
      status: 'in-progress',
    });
  } else {
    const activeMetricDoc = querySnapshot.docs[0];
    const activeMetricData = activeMetricDoc.data() || {};

    if (activeMetricData.taskName !== currentTask) {
      // Task has changed, so complete the old one and start a new one
      const startTime = toDateSafe(activeMetricData.startTime);
      const duration = isNaN(startTime.getTime()) ? 0 : Math.max(0, (eventDate - startTime) / 1000);

      await activeMetricDoc.ref.update({
        status: 'completed',
        endTime: timestamp,
        duration: duration,
      });

      await metricsCol.add({
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
