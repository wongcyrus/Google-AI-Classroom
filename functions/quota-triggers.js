import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { updateUsage } from './quota-management.js';

export const onAiJobCreated = onDocumentCreated('aiJobs/{jobId}', (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    return;
  }

  const { classId, cost } = snapshot.data();

  if (classId && cost > 0) {
    return updateUsage(classId, cost);
  }

  return;
});
