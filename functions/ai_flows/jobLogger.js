import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Logs a new AI job to the aiJobs collection.
 * @param {object} jobData - The data for the job.
 * @returns {Promise<string>} The ID of the newly created job document.
 */
export async function logJob(jobData) {
  const cleanData = Object.fromEntries(
    Object.entries(jobData).filter(([_, v]) => v !== undefined)
  );
  const jobWithTimestamp = {
    ...cleanData,
    timestamp: FieldValue.serverTimestamp(),
  };
  const jobRef = await db.collection('aiJobs').add(jobWithTimestamp);
  return jobRef.id;
}
