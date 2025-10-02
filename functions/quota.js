import { getFirestore } from 'firebase-admin/firestore';

const db = getFirestore();

/**
 * Checks if a class has enough quota for an estimated cost.
 * @param {string} classId - The ID of the class.
 * @param {number} estimatedCost - The estimated cost of the job.
 * @returns {Promise<boolean>} True if the class has enough quota, false otherwise.
 */
export async function checkQuota(classId, estimatedCost) {
  if (!classId) {
    console.warn('checkQuota called without a classId.');
    return false;
  }
  const classDocRef = db.collection('classes').doc(classId);
  const classDoc = await classDocRef.get();

  let quota = 10; // Default quota
  let usedQuota = 0;

  if (classDoc.exists) {
    const data = classDoc.data();
    quota = data.aiQuota !== undefined ? data.aiQuota : 10;
    usedQuota = data.aiUsedQuota || 0;
  } else {
    console.warn(`Class document not found for classId: ${classId}. Using default quota of $10.`);
  }

  return (usedQuota + estimatedCost) <= quota;
}

/**
 * Updates the used AI quota for a class.
 * @param {string} classId - The ID of the class.
 * @param {number} cost - The cost of the job to add to the used quota.
 * @returns {Promise<void>}
 */
export async function updateUsage(classId, cost) {
    if (!classId || cost === undefined) {
        console.error('updateUsage called with invalid arguments.');
        return;
    }
    const classDocRef = db.collection('classes').doc(classId);
    const { FieldValue } = await import('firebase-admin/firestore');

    return classDocRef.update({
        aiUsedQuota: FieldValue.increment(cost)
    });
}
