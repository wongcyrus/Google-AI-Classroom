import { onObjectFinalized, onObjectDeleted } from 'firebase-functions/v2/storage';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import './firebase.js'; // Ensure firebase is initialized
import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';

const db = getFirestore();
const adminStorage = getStorage();

// Function to update storage usage when a file is uploaded
export const updateStorageUsageOnUpload = onObjectFinalized({
  region: FUNCTION_REGION,
  cpu: 'gcf_gen1'
}, async (event) => {
  const filePath = event.data.name;
  const size = event.data.size;

  let usageField = null;
  if (filePath.startsWith('screenshots/')) {
    usageField = 'storageUsageScreenShots';
  } else if (filePath.startsWith('videos/')) {
    usageField = 'storageUsageVideos';
  } else if (filePath.startsWith('zips/')) {
    usageField = 'storageUsageZips';
  } else if (filePath.startsWith('audio/')) {
    usageField = 'storageUsageAudio';
  } else if (filePath.startsWith('recordings/')) {
    usageField = 'storageUsageRecordings';
  } else if (filePath.startsWith('irregularities/')) {
    usageField = 'storageUsageIrregularities';
  }

  if (!usageField) {
    console.log(`Ignoring file: ${filePath} as it is not in a tracked folder.`);
    return;
  }

  const parts = filePath.split('/');
  if (parts.length < 3) {
    console.log(`Invalid path structure for quota tracking: ${filePath}`);
    return;
  }
  const classId = parts[1];
  const fileSize = parseInt(size, 10);

  if (isNaN(fileSize) || fileSize === 0) {
    console.log(`Ignoring file with invalid size: ${fileSize}`);
    return;
  }

  console.log(`Updating storage for class ${classId} by ${fileSize} bytes for ${usageField}.`);

  const classRef = db.collection('classes').doc(classId);
  const storageRef = classRef.collection('metadata').doc('storage');
    
  try {
    const updatePayload = {
      storageUsage: FieldValue.increment(fileSize),
      [usageField]: FieldValue.increment(fileSize)
    };
    await storageRef.update(updatePayload);
    console.log(`Successfully updated storage usage for class ${classId}.`);

    const classDoc = await classRef.get();
    const storageDoc = await storageRef.get();

    if (classDoc.exists) {
      const classData = classDoc.data();
      const storageData = storageDoc.data();
      const usage = storageData.storageUsage || 0;
      const quota = classData.storageQuota || 0;

      if (quota > 0 && usage > quota) {
        console.log(`Quota exceeded for class ${classId}. Usage: ${usage}, Quota: ${quota}. Deleting file: ${filePath}`);
                
        const bucket = adminStorage.bucket(event.bucket);
        const file = bucket.file(filePath);
        await file.delete();
        console.log(`Successfully deleted ${filePath}.`);
                
        const revertPayload = {
          storageUsage: FieldValue.increment(-fileSize),
          [usageField]: FieldValue.increment(-fileSize)
        };
        await storageRef.update(revertPayload);
        console.log(`Reverted storage usage increment for ${classId}.`);
      }
    }

  } catch (error) {
    if (error.code === 5) { // NOT_FOUND on the update, meaning the storage doc doesn't exist
      console.log(`Handling NOT_FOUND error for storage doc on class ${classId}.`);
      const classDoc = await classRef.get();
      if (classDoc.exists) {
        const classData = classDoc.data();
        const quota = classData.storageQuota || 0;

        if (quota > 0 && fileSize > quota) {
          console.log(`Quota exceeded for class ${classId} on first upload. Deleting file: ${filePath}`);
          const bucket = adminStorage.bucket(event.bucket);
          await bucket.file(filePath).delete();
          console.log(`Successfully deleted ${filePath}.`);
        } else {
          const initialPayload = { 
            storageUsage: fileSize,
            [usageField]: fileSize
          };
          await storageRef.set(initialPayload);
          console.log(`Initialized storageUsage for class ${classId}.`);
        }
      } else {
        console.error(`Class document ${classId} not found. Deleting orphaned file: ${filePath}`);
        const bucket = adminStorage.bucket(event.bucket);
        await bucket.file(filePath).delete();
        console.log('Successfully deleted orphaned file.');
      }
    } else {
      console.error(`Failed to update storage usage for class ${classId}:`, error);
    }
  }
});

// Function to update storage usage when a file is deleted
export const updateStorageUsageOnDelete = onObjectDeleted({
  region: FUNCTION_REGION,
  cpu: 'gcf_gen1'
}, async (event) => {
  const filePath = event.data.name;
  const size = event.data.size;

  let usageField = null;
  if (filePath.startsWith('screenshots/')) {
    usageField = 'storageUsageScreenShots';
  } else if (filePath.startsWith('videos/')) {
    usageField = 'storageUsageVideos';
  } else if (filePath.startsWith('zips/')) {
    usageField = 'storageUsageZips';
  } else if (filePath.startsWith('audio/')) {
    usageField = 'storageUsageAudio';
  } else if (filePath.startsWith('recordings/')) {
    usageField = 'storageUsageRecordings';
  } else if (filePath.startsWith('irregularities/')) {
    usageField = 'storageUsageIrregularities';
  }

  if (!usageField) {
    console.log(`Ignoring file: ${filePath} as it is not in a tracked folder.`);
    return;
  }

  const parts = filePath.split('/');
  if (parts.length < 3) {
    console.log(`Invalid path structure for quota tracking: ${filePath}`);
    return;
  }
  const classId = parts[1];
  const fileSize = parseInt(size, 10);

  if (isNaN(fileSize) || fileSize === 0) {
    console.log(`Ignoring file with invalid size: ${fileSize}`);
    return;
  }

  console.log(`Decreasing storage for class ${classId} by ${fileSize} bytes for ${usageField}.`);

  const storageRef = db.collection('classes').doc(classId).collection('metadata').doc('storage');

  try {
    const updatePayload = {
      storageUsage: FieldValue.increment(-fileSize),
      [usageField]: FieldValue.increment(-fileSize)
    };
    await storageRef.update(updatePayload);
    console.log(`Successfully decreased storage usage for class ${classId}.`);
  } catch (error) {
    console.error(`Failed to decrease storage usage for class ${classId}:`, error);
  }
});

/**
 * Callable function to audit and synchronize Cloud Storage usage for a class.
 * Scans physical blobs across all class directories and updates metadata/storage.
 */
export const recalculateStorageUsage = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const { classId } = request.data || {};
  if (!classId) {
    throw new HttpsError('invalid-argument', 'Missing classId.');
  }

  // Teacher authorization check
  let isAuthorizedTeacher = request.auth.token?.role === 'teacher';
  if (!isAuthorizedTeacher && request.auth.uid) {
    try {
      const classDoc = await db.collection('classes').doc(classId).get();
      if (classDoc.exists) {
        const cData = classDoc.data() || {};
        if (
          (cData.teacherEmails && cData.teacherEmails.includes(request.auth.token?.email)) ||
          (cData.teachers && (cData.teachers[request.auth.uid] || Object.keys(cData.teachers).includes(request.auth.uid)))
        ) {
          isAuthorizedTeacher = true;
        }
      }
    } catch (e) {
      console.warn('Error checking teacher authorization:', e);
    }
  }

  if (!isAuthorizedTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers assigned to this class can recalculate storage.');
  }

  const results = await recalculateStorageUsageInternal(classId);

  return {
    status: 'success',
    message: `Storage recalculated successfully. Total usage: ${(results.storageUsage / (1024 * 1024)).toFixed(2)} MB.`,
    ...results,
  };
});

/**
 * Internal helper to audit and reconcile class storage usage directly against GCS bucket prefixes.
 * Can be called by storageQuota onCall or internally by purge routines.
 * @param {string} classId
 * @returns {Promise<Object>}
 */
export async function recalculateStorageUsageInternal(classId) {
  const bucket = adminStorage.bucket();
  const categories = [
    { prefix: `screenshots/${classId}/`, field: 'storageUsageScreenShots' },
    { prefix: `videos/${classId}/`, field: 'storageUsageVideos' },
    { prefix: `zips/${classId}/`, field: 'storageUsageZips' },
    { prefix: `audio/${classId}/`, field: 'storageUsageAudio' },
    { prefix: `recordings/${classId}/`, field: 'storageUsageRecordings' },
    { prefix: `irregularities/${classId}/`, field: 'storageUsageIrregularities' },
  ];

  const results = {
    storageUsageScreenShots: 0,
    storageUsageVideos: 0,
    storageUsageZips: 0,
    storageUsageAudio: 0,
    storageUsageRecordings: 0,
    storageUsageIrregularities: 0,
    storageUsage: 0,
  };

  for (const cat of categories) {
    try {
      const [files] = await bucket.getFiles({ prefix: cat.prefix });
      let catTotal = 0;
      for (const file of files) {
        const metadata = file.metadata || {};
        const sz = parseInt(metadata.size, 10);
        if (!isNaN(sz) && sz > 0) {
          catTotal += sz;
        }
      }
      results[cat.field] = catTotal;
      results.storageUsage += catTotal;
    } catch (err) {
      console.warn(`Error scanning prefix ${cat.prefix}:`, err);
    }
  }

  const storageRef = db.collection('classes').doc(classId).collection('metadata').doc('storage');
  await storageRef.set({
    ...results,
    lastAuditedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`Audited and synchronized storage usage for class ${classId}:`, results);
  return results;
}

