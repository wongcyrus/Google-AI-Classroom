import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, auth } from './firebase.js';
import Papa from 'papaparse';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

export const processPropertyUpload = onDocumentCreated({
    document: "propertyUploadJobs/{jobId}",
    region: FUNCTION_REGION,
    memory: '256MiB',
    timeoutSeconds: 300,
}, async (event) => {
    const snap = event.data;
    if (!snap) {
        logger.warn("processPropertyUpload triggered with no data.");
        return;
    }

    const jobId = event.params.jobId;
    const jobRef = snap.ref;
    const jobData = snap.data();
    const { classId, csvData, requesterUid } = jobData;

    logger.info(`Starting property upload job ${jobId} for class ${classId}, requested by ${requesterUid}`);

    try {
        await jobRef.update({ status: 'processing', startedAt: new Date() });

        // 1. Parse CSV
        logger.info(`[${jobId}] Parsing CSV data.`);
        const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
        const rows = parsed.data;

        if (!rows || rows.length === 0) {
            throw new Error('CSV is empty or could not be parsed.');
        }

        if (!parsed.meta.fields.includes('StudentEmail')) {
            throw new Error('CSV must include a "StudentEmail" header.');
        }

        // 2. Get UIDs from emails
        const emails = rows.map(r => r.StudentEmail?.trim().toLowerCase()).filter(Boolean);
        if (emails.length === 0) {
            throw new Error('No valid student emails found in CSV.');
        }
        logger.info(`[${jobId}] Found ${emails.length} emails to process.`);
        
        const emailToUid = {};
        const CHUNK_SIZE = 100; // Max for auth.getUsers

        for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
            const emailChunk = emails.slice(i, i + CHUNK_SIZE);
            logger.info(`[${jobId}] Processing email chunk ${Math.floor(i / CHUNK_SIZE) + 1}...`);
            
            const userRecords = await auth.getUsers(emailChunk.map(email => ({ email })));
            
            userRecords.users.forEach(user => {
                if (user.email) {
                    emailToUid[user.email.toLowerCase()] = user.uid;
                }
            });

            userRecords.notFound.forEach(user => {
                // Assuming the input was an email identifier
                const notFoundEmail = user.email;
                if (notFoundEmail) {
                    const index = emailChunk.findIndex(e => e.toLowerCase() === notFoundEmail.toLowerCase());
                    if (index !== -1) {
                        notFoundEmails.push(emailChunk[index]);
                    }
                }
            });
        }

        logger.info(`[${jobId}] Matched ${Object.keys(emailToUid).length} emails to user UIDs.`);

        // 3. Batch write to studentProperties subcollection
        let processedCount = 0;
        let notFoundEmails = [];
        const BATCH_SIZE = 499; // Firestore batch limit is 500

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = db.batch();
            const rowChunk = rows.slice(i, i + BATCH_SIZE);
            let batchProcessCount = 0;
            logger.info(`[${jobId}] Processing row chunk ${Math.floor(i / BATCH_SIZE) + 1}...`);

            rowChunk.forEach(row => {
                const email = row.StudentEmail?.trim().toLowerCase();
                const uid = emailToUid[email];

                if (uid) {
                    const properties = { ...row };
                    delete properties.StudentEmail;
                    const docRef = db.collection('classes').doc(classId).collection('studentProperties').doc(uid);
                    batch.set(docRef, properties, { merge: true }); // Use merge to not overwrite existing properties unintentionally
                    processedCount++;
                    batchProcessCount++;
                } else if (email) {
                    notFoundEmails.push(email);
                }
            });

            if (batchProcessCount > 0) {
                logger.info(`[${jobId}] Committing a batch of ${batchProcessCount} property updates...`);
                await batch.commit();
            }
        }

        // 4. Update job status
        const finalStatus = notFoundEmails.length > 0 ? 'completed_with_errors' : 'completed';
        const finalError = notFoundEmails.length > 0 ? `Could not find registered users for ${notFoundEmails.length} emails: ${notFoundEmails.slice(0, 5).join(', ')}` : null;

        logger.info(`[${jobId}] Job finished with status: ${finalStatus}`);
        await jobRef.update({ 
            status: finalStatus,
            error: finalError,
            finishedAt: new Date(),
            processedCount,
            notFoundCount: notFoundEmails.length,
            totalRows: rows.length,
        });

    } catch (error) {
        logger.error(`[${jobId}] Error processing property upload:`, error);
        await jobRef.update({ status: 'failed', error: error.message, finishedAt: new Date() });
    }
});