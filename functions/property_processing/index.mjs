import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db, auth } from './firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import Papa from 'papaparse';
import { logger } from 'firebase-functions';
import { FUNCTION_REGION } from './config.js';

/**
 * Identifies internal system/operational keys and profile metadata
 * that should never be overwritten or deleted by custom property uploads.
 */
export const isInternalPropertyKey = (key) => {
    if (!key || typeof key !== 'string') return true;
    const lower = key.toLowerCase().trim();
    const internalPrefixes = [
        'activebingo',
        'pendingretry',
        'priormissed',
        'retrybingo',
        'retrydelay',
        'lastretry',
        'lastbingo',
        'retrycancelled',
        'passkey',
        'lastinattentive',
        'inattentive',
        'attention',
        'lastattention',
        'lastactivity',
        'lastseen',
        'presence',
    ];
    if (internalPrefixes.some((prefix) => lower === prefix || lower.startsWith(prefix))) {
        return true;
    }
    const exactInternalKeys = new Set([
        'strikenumber',
        'bingostats',
        'examreadiness',
        'retrycancelledreason',
        'passkeybypass',
        'lastinattentiveat',
        'status',
        'updatedat',
        'createdat',
        'studentname',
        'nickname',
        'programme',
        'program',
        'studentclass',
        'cohort',
        'email',
        'studentemail',
    ]);
    return exactInternalKeys.has(lower);
};

function isTeacherAuthorizedInClass(classData, requesterUid, requesterRecord = null) {
    if (!requesterUid || !classData || typeof classData !== 'object') {
        return requesterRecord?.customClaims?.role === 'admin';
    }
    if (requesterRecord?.customClaims?.role === 'admin') {
        return true;
    }
    if (
        classData.ownerUid === requesterUid ||
        classData.teacherUid === requesterUid ||
        classData.createdBy === requesterUid ||
        Boolean(classData.teachers && typeof classData.teachers === 'object' && classData.teachers[requesterUid])
    ) {
        return true;
    }
    const requesterEmail = (requesterRecord?.email || '').trim().toLowerCase();
    if (requesterEmail) {
        if (classData.teacherEmail && String(classData.teacherEmail).trim().toLowerCase() === requesterEmail) {
            return true;
        }
        if (Array.isArray(classData.teacherEmails)) {
            return classData.teacherEmails.some(
                (e) => typeof e === 'string' && e.trim().toLowerCase() === requesterEmail
            );
        }
    }
    return false;
}

export const handleProcessPropertyUpload = async (event, customDeps = {}) => {
    const currentDb = customDeps.db || db;
    const currentAuth = customDeps.auth || auth;
    const currentLogger = customDeps.logger || logger;

    const snap = event.data;
    if (!snap) {
        currentLogger.warn("processPropertyUpload triggered with no data.");
        return;
    }

    const jobId = event.params.jobId;
    const jobRef = snap.ref;
    const jobData = snap.data() || {};
    const { classId, csvData, requesterUid, mode } = jobData;

    currentLogger.info(`Starting property upload job ${jobId} for class ${classId}, mode: ${mode || 'sync'}, requested by ${requesterUid}`);

    try {
        await jobRef.update({ status: 'processing', startedAt: new Date() });

        if (!classId || typeof classId !== 'string' || !requesterUid || typeof requesterUid !== 'string') {
            throw new Error('Unauthorized property upload job: valid classId and requesterUid are required.');
        }

        const classDoc = await currentDb.collection('classes').doc(classId).get();
        if (!classDoc?.exists) {
            throw new Error(`Class ${classId} not found.`);
        }
        const classData = (typeof classDoc.data === 'function' ? classDoc.data() : classDoc.data) || {};

        // Fast path checks UID directly against classData; fallback fetches Auth user for admin/email check
        let isAuthorized = isTeacherAuthorizedInClass(classData, requesterUid, null);
        if (!isAuthorized) {
            let requesterRecord = null;
            try {
                requesterRecord = await currentAuth.getUser(requesterUid);
            } catch (authLookupErr) {
                currentLogger.warn(`[${jobId}] Failed to inspect requester user ${requesterUid}:`, authLookupErr);
            }
            isAuthorized = isTeacherAuthorizedInClass(classData, requesterUid, requesterRecord);
        }

        if (!isAuthorized) {
            throw new Error(`Unauthorized: user ${requesterUid} is not a teacher assigned to class ${classId}.`);
        }

        // 1. Parse CSV
        currentLogger.info(`[${jobId}] Parsing CSV data.`);
        const parsed = Papa.parse(csvData, { header: true, skipEmptyLines: true });
        const rows = parsed.data;

        if (!rows || rows.length === 0) {
            throw new Error('CSV is empty or could not be parsed.');
        }

        const rawFields = parsed.meta.fields || [];
        // Sanitize header fields: strip UTF-8 BOM, trim whitespace
        const fields = rawFields.map(f => (typeof f === 'string' ? f.replace(/^\uFEFF/, '').trim() : '')).filter(Boolean);

        // Find StudentEmail header case-insensitively
        const emailField = rawFields.find(f => {
            const clean = typeof f === 'string' ? f.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_]/g, '') : '';
            return clean === 'studentemail' || clean === 'email';
        });

        if (!emailField) {
            throw new Error('CSV must include a "StudentEmail" header.');
        }

        // Custom property keys present in this upload file
        const uploadedPropertyKeys = fields.filter(
            f => f.toLowerCase().replace(/[\s_]/g, '') !== 'studentemail' &&
                 f.toLowerCase().replace(/[\s_]/g, '') !== 'email' &&
                 !isInternalPropertyKey(f)
        );

        currentLogger.info(`[${jobId}] Uploaded property headers detected: ${JSON.stringify(uploadedPropertyKeys)}`);

        // 2. Resolve student emails to UIDs
        const emails = rows.map(r => {
            const val = r[emailField] ?? r.StudentEmail;
            return typeof val === 'string' ? val.trim().toLowerCase() : '';
        }).filter(Boolean);

        if (emails.length === 0) {
            throw new Error('No valid student emails found in CSV.');
        }
        currentLogger.info(`[${jobId}] Found ${emails.length} emails to process.`);

        const emailToUid = {};

        // 2a. Pre-populate from already-fetched class document students map
        const studentsMap = classData.students || {};
        for (const [uid, studentEmail] of Object.entries(studentsMap)) {
            if (studentEmail && typeof studentEmail === 'string') {
                emailToUid[studentEmail.trim().toLowerCase()] = uid;
            }
        }

        // 2b. For any emails not yet resolved from classDoc, query Firebase Auth
        const missingEmails = Array.from(new Set(emails.filter(e => !emailToUid[e])));
        const CHUNK_SIZE = 100; // Max for auth.getUsers
        for (let i = 0; i < missingEmails.length; i += CHUNK_SIZE) {
            const emailChunk = missingEmails.slice(i, i + CHUNK_SIZE);
            try {
                const userRecords = await currentAuth.getUsers(emailChunk.map(email => ({ email })));
                userRecords.users.forEach(user => {
                    if (user.email) {
                        emailToUid[user.email.toLowerCase()] = user.uid;
                    }
                });
            } catch (authErr) {
                currentLogger.warn(`[${jobId}] Error fetching users from auth chunk:`, authErr);
            }
        }

        currentLogger.info(`[${jobId}] Matched ${Object.keys(emailToUid).length} emails to user UIDs.`);

        // 3. Pre-fetch existing studentProperties in this class to know existing custom keys per student
        const existingPropsSnap = await currentDb.collection('classes').doc(classId).collection('studentProperties').get();
        const studentCurrentKeys = {}; // uid -> Set of existing custom keys
        existingPropsSnap.forEach(docSnap => {
            const data = docSnap.data() || {};
            const customKeys = new Set(
                Object.keys(data).filter(k => !isInternalPropertyKey(k))
            );
            studentCurrentKeys[docSnap.id] = customKeys;
        });

        // 4. Batch write to studentProperties subcollection
        let processedCount = 0;
        let notFoundEmails = [];
        const isSyncMode = mode !== 'merge'; // Default is sync/replace mode
        const BATCH_SIZE = 450; // Under Firestore limit of 500

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
            const batch = currentDb.batch();
            const rowChunk = rows.slice(i, i + BATCH_SIZE);
            let batchProcessCount = 0;

            rowChunk.forEach(row => {
                const rawEmail = row[emailField] ?? row.StudentEmail;
                const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
                const uid = emailToUid[email];

                if (uid) {
                    const currentKeys = studentCurrentKeys[uid] || new Set();
                    const updatePayload = {};

                    // In sync mode: if an existing custom property is NOT in the uploaded columns,
                    // delete it so that removing columns from the spreadsheet deletes them in Firestore.
                    if (isSyncMode) {
                        for (const existingKey of currentKeys) {
                            if (!uploadedPropertyKeys.includes(existingKey)) {
                                updatePayload[existingKey] = FieldValue.delete();
                            }
                        }
                    }

                    // Process each uploaded property column
                    for (const propKey of uploadedPropertyKeys) {
                        // Find matching field in row (preserve exact or matching header key)
                        const val = row[propKey] !== undefined ? row[propKey] : row[rawFields.find(f => f.trim() === propKey)];
                        if (val !== undefined && val !== null && String(val).trim() !== '') {
                            updatePayload[propKey] = typeof val === 'string' ? val.trim() : val;
                        } else {
                            // Empty string or null in spreadsheet:
                            // Delete if student previously had this property
                            if (currentKeys.has(propKey)) {
                                updatePayload[propKey] = FieldValue.delete();
                            }
                        }
                    }

                    const docRef = currentDb.collection('classes').doc(classId).collection('studentProperties').doc(uid);
                    batch.set(docRef, updatePayload, { merge: true });

                    processedCount++;
                    batchProcessCount++;
                } else if (email) {
                    notFoundEmails.push(email);
                }
            });

            if (batchProcessCount > 0) {
                currentLogger.info(`[${jobId}] Committing batch of ${batchProcessCount} property updates...`);
                await batch.commit();
            }
        }

        // 5. Update job status
        const finalStatus = notFoundEmails.length > 0 ? 'completed_with_errors' : 'completed';
        const finalError = notFoundEmails.length > 0
            ? `Could not find registered users for ${notFoundEmails.length} emails: ${notFoundEmails.slice(0, 5).join(', ')}`
            : null;

        currentLogger.info(`[${jobId}] Job finished with status: ${finalStatus}, processed: ${processedCount}/${rows.length}`);
        await jobRef.update({
            status: finalStatus,
            error: finalError,
            finishedAt: new Date(),
            processedCount,
            notFoundCount: notFoundEmails.length,
            totalRows: rows.length,
            activeColumns: uploadedPropertyKeys,
        });

    } catch (error) {
        currentLogger.error(`[${jobId}] Error processing property upload:`, error);
        await jobRef.update({ status: 'failed', error: error.message, finishedAt: new Date() });
    }
};

export const processPropertyUpload = onDocumentCreated({
    document: "propertyUploadJobs/{jobId}",
    region: FUNCTION_REGION,
    memory: '256MiB',
    timeoutSeconds: 300,
}, async (event) => handleProcessPropertyUpload(event));