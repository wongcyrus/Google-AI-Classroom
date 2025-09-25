import { onObjectFinalized, onObjectDeleted } from 'firebase-functions/v2/storage';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import './firebase.js'; // Ensure firebase is initialized
import { FUNCTION_REGION } from './config.js';

const db = getFirestore();
const adminStorage = getStorage();

// Function to update storage usage when a file is uploaded
export const updateStorageUsageOnUpload = onObjectFinalized({
    region: FUNCTION_REGION,
    cpu: 'gcf_gen1'
}, async (event) => {
    const filePath = event.data.name;
    const size = event.data.size;

    // We only care about screenshots for now
    if (!filePath.startsWith('screenshots/')) {
        console.log(`Ignoring file: ${filePath} as it is not a screenshot.`);
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

    console.log(`Updating storage for class ${classId} by ${fileSize} bytes.`);

    const classRef = db.collection('classes').doc(classId);
    
    try {
        // Atomically increment the storageUsage field
        await classRef.update({
            storageUsage: FieldValue.increment(fileSize)
        });
        console.log(`Successfully updated storage usage for class ${classId}.`);

        // After updating, check if the quota is exceeded.
        const classDoc = await classRef.get();
        if (classDoc.exists) {
            const classData = classDoc.data();
            const usage = classData.storageUsage || 0;
            const quota = classData.storageQuota || 0;

            if (quota > 0 && usage > quota) {
                console.log(`Quota exceeded for class ${classId}. Usage: ${usage}, Quota: ${quota}. Deleting file: ${filePath}`);
                
                const bucket = adminStorage.bucket(event.bucket);
                const file = bucket.file(filePath);
                await file.delete();
                console.log(`Successfully deleted ${filePath}.`);
                
                await classRef.update({
                    storageUsage: FieldValue.increment(-fileSize)
                });
                console.log(`Reverted storage usage increment for ${classId}.`);
            }
        }

    } catch (error) {
        // If the document or field doesn't exist, set it.
        if (error.code === 5) { // NOT_FOUND error
            console.log(`Handling NOT_FOUND error for class ${classId}.`);
            const classDoc = await classRef.get();
            if (classDoc.exists) {
                // The document exists, but the storageUsage field likely doesn't. This is the first upload.
                const classData = classDoc.data();
                const quota = classData.storageQuota || 0;

                if (quota > 0 && fileSize > quota) {
                    console.log(`Quota exceeded for class ${classId} on first upload. Deleting file: ${filePath}`);
                    const bucket = adminStorage.bucket(event.bucket);
                    await bucket.file(filePath).delete();
                    console.log(`Successfully deleted ${filePath}.`);
                } else {
                    // The field doesn't exist, so we create it with the current file size.
                    await classRef.set({ storageUsage: fileSize }, { merge: true });
                    console.log(`Initialized storageUsage for class ${classId}.`);
                }
            } else {
                // The class document itself does not exist. This is an orphaned file.
                console.error(`Class document ${classId} not found. Deleting orphaned file: ${filePath}`);
                const bucket = adminStorage.bucket(event.bucket);
                await bucket.file(filePath).delete();
                console.log(`Successfully deleted orphaned file.`);
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

    if (!filePath.startsWith('screenshots/')) {
        console.log(`Ignoring file: ${filePath} as it is not a screenshot.`);
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

    console.log(`Decreasing storage for class ${classId} by ${fileSize} bytes.`);

    const classRef = db.collection('classes').doc(classId);

    try {
        await classRef.update({
            storageUsage: FieldValue.increment(-fileSize)
        });
        console.log(`Successfully decreased storage usage for class ${classId}.`);
    } catch (error) {
        console.error(`Failed to decrease storage usage for class ${classId}:`, error);
    }
});
