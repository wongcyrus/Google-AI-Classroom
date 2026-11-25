import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const db = getFirestore();

function resolveClassAndMetaRefs(classId) {
  let classDocRef = null;
  let aiMetaRef = null;

  if (typeof db?.collection === 'function') {
    const classesCol = db.collection('classes');
    if (classesCol && typeof classesCol.doc === 'function') {
      classDocRef = classesCol.doc(classId);
      if (classDocRef && typeof classDocRef.collection === 'function') {
        const metaCol = classDocRef.collection('metadata');
        if (metaCol && typeof metaCol.doc === 'function') {
          aiMetaRef = metaCol.doc('ai');
        }
      }
    }
  }

  if (!classDocRef && typeof db?.doc === 'function') {
    classDocRef = db.doc(`classes/${classId}`);
  }
  if (!aiMetaRef && typeof db?.doc === 'function') {
    aiMetaRef = db.doc(`classes/${classId}/metadata/ai`);
  }

  return { classDocRef, aiMetaRef };
}

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
  const { classDocRef, aiMetaRef } = resolveClassAndMetaRefs(classId);

  const [classDoc, aiMetaDoc] = await Promise.all([
    typeof classDocRef?.get === 'function' ? classDocRef.get() : Promise.resolve(null),
    typeof aiMetaRef?.get === 'function' ? aiMetaRef.get() : Promise.resolve(null),
  ]);

  let quota = 10; // Default quota
  let usedQuota = 0;

  if (classDoc?.exists) {
    const data = typeof classDoc.data === 'function' ? classDoc.data() : classDoc.data;
    quota = data?.aiQuota !== undefined ? data.aiQuota : 10;
  } else {
    console.warn(`Class document not found for classId: ${classId}. Using default quota of $10.`);
  }

  if (aiMetaDoc?.exists) {
    const metaData = typeof aiMetaDoc.data === 'function' ? aiMetaDoc.data() : aiMetaDoc.data;
    usedQuota = metaData?.aiUsedQuota || 0;
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
  if (!classId || cost === undefined || cost <= 0) {
    return;
  }
  const { aiMetaRef } = resolveClassAndMetaRefs(classId);
  if (!aiMetaRef || typeof aiMetaRef.set !== 'function') {
    return;
  }

  try {
    await aiMetaRef.set({ aiUsedQuota: FieldValue.increment(cost) }, { merge: true });
  } catch (error) {
    console.error(`Failed to update AI usage for class ${classId}:`, error);
  }
}