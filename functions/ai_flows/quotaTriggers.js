import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { updateUsage } from './quotaManagement.js';
import { FUNCTION_REGION } from './config.js';

export const onAiJobCreated = onDocumentCreated({ document: 'aiJobs/{jobId}', region: FUNCTION_REGION }, (event) => {
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
