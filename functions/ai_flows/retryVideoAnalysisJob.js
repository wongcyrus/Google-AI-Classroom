import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { analyzeSingleVideoFlow } from './analysisFlows.js';
import { CORS_ORIGINS, FUNCTION_REGION } from './config.js';
import { estimateCost } from './cost.js';
import { checkQuota } from './quotaManagement.js';
import { logJob } from './jobLogger.js';
import { formatInTimeZone } from 'date-fns-tz';

const db = getFirestore();
const storage = getStorage();

export const retryVideoAnalysisJob = onCall({ region: FUNCTION_REGION, cors: CORS_ORIGINS, cpu: 2, memory: '8GiB', timeoutSeconds: 3600 }, async (request) => {
    if (!request.auth) {
        throw new HttpsError('unauthenticated', 'The function must be called while authenticated.');
    }
    const { jobId } = request.data;
    if (!jobId) {
        throw new HttpsError('invalid-argument', 'The function must be called with a "jobId".');
    }

    const masterJobRef = db.collection('videoAnalysisJobs').doc(jobId);
    const jobDoc = await masterJobRef.get();

    if (!jobDoc.exists) {
        throw new HttpsError('not-found', `Job with ID ${jobId} not found.`);
    }

    const jobData = jobDoc.data();
    let videosToAnalyze = jobData.failedVideos || [];

    // Fallback for legacy jobs that don't have the failedVideos field
    if (videosToAnalyze.length === 0) {
        const aiJobsSnapshot = await db.collection('aiJobs').where('masterJobId', '==', jobId).where('status', '==', 'failed').get();
        if (!aiJobsSnapshot.empty) {
            const bucketName = storage.bucket().name;
            const gsPrefix = `gs://${bucketName}/`;
            const httpsPrefix = `https://storage.googleapis.com/${bucketName}/`;

            videosToAnalyze = aiJobsSnapshot.docs.map(doc => {
                const job = doc.data();
                const url = job.mediaPaths && job.mediaPaths[0];
                if (!url) return null;

                let videoPath;
                if (url.startsWith(gsPrefix)) {
                    videoPath = url.substring(gsPrefix.length);
                } else if (url.startsWith(httpsPrefix)) {
                    videoPath = decodeURIComponent(url.substring(httpsPrefix.length));
                } else {
                    // Assume it's already a relative path, but log a warning.
                    console.warn(`Unknown URL format in mediaPaths for job ${job.id}: ${url}`);
                    videoPath = url;
                }

                return {
                    studentUid: job.studentUid,
                    studentEmail: job.studentEmail,
                    videoPath: videoPath
                };
            }).filter(v => v && v.videoPath && v.studentUid);
        }
    }

    if (videosToAnalyze.length === 0) {
        throw new HttpsError('failed-precondition', 'Could not find any failed videos to retry for this job.');
    }

    await masterJobRef.update({
        status: 'processing',
        failedVideos: [], // Clear the list for the new retry attempt
        retryHistory: FieldValue.arrayUnion({
            retriedAt: FieldValue.serverTimestamp(),
            videoCount: videosToAnalyze.length,
            originalFailures: videosToAnalyze 
        })
    });

    try {
        const bucketName = storage.bucket().name;
        const BATCH_SIZE = 10;
        
        let totalSuccesses = 0;
        let totalFailures = 0;

        const classRef = db.collection('classes').doc(jobData.classId);
        const classDoc = await classRef.get();
        const timezone = classDoc.exists ? classDoc.data().schedule?.timeZone || 'UTC' : 'UTC';
        const startDate = jobData.startTime ? formatInTimeZone(jobData.startTime.toDate(), timezone, 'yyyy-MM-dd HH:mm:ss zzz') : 'N/A';
        const endDate = jobData.endTime ? formatInTimeZone(jobData.endTime.toDate(), timezone, 'yyyy-MM-dd HH:mm:ss zzz') : 'N/A';

        const promptTemplate = (video) => `The following video is from a student.\nEmail: ${video.studentEmail}\nStudent UID: ${video.studentUid}\nClass ID: ${jobData.classId}\nThe video was recorded between ${startDate} and ${endDate}.\nPlease analyze the video based on the user's prompt: "${jobData.prompt}"\nIf you mention specific moments in the video, please provide timestamps in the format HH:MM:SS.`;

        for (let i = 0; i < videosToAnalyze.length; i += BATCH_SIZE) {
            const batch = videosToAnalyze.slice(i, i + BATCH_SIZE);

            let batchEstimatedCost = 0;
            for (const video of batch) {
                const promptText = promptTemplate(video);
                const media = [{ media: { url: `gs://${bucketName}/${video.videoPath}`, contentType: 'video/mp4' } }];
                batchEstimatedCost += estimateCost(promptText, media);
            }

            const hasQuota = await checkQuota(jobData.classId, batchEstimatedCost);

            if (!hasQuota) {
                console.warn(`Insufficient quota for batch starting at index ${i}. Estimated cost: ${batchEstimatedCost}`);
                const blockedJobPromises = batch.map(video => {
                    const promptText = promptTemplate(video);
                    return logJob({
                        classId: jobData.classId,
                        studentUid: video.studentUid,
                        studentEmail: video.studentEmail,
                        jobType: 'analyzeSingleVideo',
                        status: 'blocked-by-quota',
                        promptText: promptText,
                        mediaPaths: [`gs://${bucketName}/${video.videoPath}`],
                        cost: 0,
                        masterJobId: jobId,
                    });
                });
                const blockedJobIds = await Promise.all(blockedJobPromises);

                await masterJobRef.update({
                    aiJobIds: FieldValue.arrayUnion(...blockedJobIds),
                    failedVideos: FieldValue.arrayUnion(...batch)
                });
                totalFailures += batch.length;
                continue;
            }
            
            const analysisPromises = batch.map(video => {
                return (async () => {
                    try {
                        const gsUri = `gs://${bucketName}/${video.videoPath}`;
                        const promptText = promptTemplate(video);

                        const crypto = await import('crypto');
                        const promptHash = crypto.createHash('sha256').update(promptText).digest('hex');

                        // Idempotency Check: Look for an existing job to prevent duplicates.
                        const existingJobsQuery = db.collection('aiJobs')
                            .where('mediaPaths', 'array-contains', gsUri)
                            .where('promptHash', '==', promptHash)
                            .orderBy('timestamp', 'desc')
                            .limit(1);

                        const existingJobsSnapshot = await existingJobsQuery.get();

                        if (!existingJobsSnapshot.empty) {
                            const existingJobDoc = existingJobsSnapshot.docs[0];
                            const existingJobData = existingJobDoc.data();

                            if (existingJobData.status === 'completed' && existingJobData.result) {
                                console.log(`Reusing completed job '${existingJobDoc.id}' for video '${video.videoPath}'.`);
                                return { status: 'success', jobId: existingJobDoc.id };
                            }

                            if (existingJobData.status === 'processing') {
                                console.log(`Skipping job creation for video '${video.videoPath}' as job '${existingJobDoc.id}' is already processing.`);
                                return { status: 'success', jobId: existingJobDoc.id }; // Return existing job to monitor
                            }

                            // For any other status (failed, blocked, etc.), do not create a new job.
                            console.log(`Skipping job creation for video '${video.videoPath}' as existing job '${existingJobDoc.id}' has a non-actionable status: '${existingJobData.status}'.`);
                            return { status: 'failure', video: video, error: `Existing job ${existingJobDoc.id} has status '${existingJobData.status}'. Use retry.` };
                        }

                        // If no valid existing job, proceed with analysis.
                        const result = await analyzeSingleVideoFlow({
                            videoUrl: gsUri,
                            prompt: jobData.prompt,
                            classId: jobData.classId,
                            studentUid: video.studentUid,
                            studentEmail: video.studentEmail,
                            masterJobId: jobId,
                            startTime: jobData.startTime,
                            endTime: jobData.endTime,
                        });

                        if (result && result.jobId) {
                            if (result.result?.startsWith('Error:')) {
                                return { status: 'failure', video: video, error: result.result };
                            }
                            return { status: 'success', jobId: result.jobId };
                        } else {
                            return { status: 'failure', video: video, error: 'Analysis flow did not return a job ID.' };
                        }
                    } catch (e) {
                        return { status: 'failure', video: video, error: e.message };
                    }
                })();
            });

            const batchResults = await Promise.all(analysisPromises);
            
            const successfulJobs = batchResults.filter(r => r.status === 'success');
            const failedJobs = batchResults.filter(r => r.status === 'failure');

            totalSuccesses += successfulJobs.length;
            totalFailures += failedJobs.length;

            const isLastBatch = (i + batch.length) >= videosToAnalyze.length;
            const updatePayload = {};

            if (successfulJobs.length > 0) {
                updatePayload.aiJobIds = FieldValue.arrayUnion(...successfulJobs.map(j => j.jobId));
            }
            if (failedJobs.length > 0) {
                updatePayload.failedVideos = FieldValue.arrayUnion(...failedJobs.map(j => j.video));
            }

            if (isLastBatch) {
                let finalStatus = 'failed';
                if (totalFailures === 0 && totalSuccesses > 0) {
                    finalStatus = 'completed';
                } else if (totalFailures > 0 && totalSuccesses > 0) {
                    finalStatus = 'partial_failure';
                }
                updatePayload.status = finalStatus;
            }

            if (Object.keys(updatePayload).length > 0) {
                await masterJobRef.update(updatePayload);
            }
        }
        return { result: `Retry completed for job ${jobId}. Success: ${totalSuccesses}, Failures: ${totalFailures}.` };

    } catch (error) {
        await masterJobRef.update({
            status: 'failed',
            error: `Retry failed: ${error.message}`,
        });
        throw new HttpsError('internal', `Failed to process retry for job ${jobId}`, error);
    }
});

