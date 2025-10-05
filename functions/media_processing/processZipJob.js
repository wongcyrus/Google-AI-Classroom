import './firebase.js';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { ZIP_COMPRESSION_LEVEL } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

export const processZipJob = onDocumentCreated({
    document: 'zipJobs/{jobId}',
    memory: '1GiB', // Start with 1GiB, can be increased
    timeoutSeconds: 540
}, async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("No data associated with the event");
        return;
    }
    const jobData = snap.data();
    const { jobId, videos, requester, classId } = jobData;
    const jobRef = snap.ref;

    console.log(`Processing zip job: ${jobId} for ${requester}`);

    try {
        await jobRef.update({ status: 'processing', startedAt: new Date() });

        const tempDir = path.join(os.tmpdir(), jobId);
        fs.mkdirSync(tempDir, { recursive: true });

        console.log(`Downloading ${videos.length} videos to ${tempDir}`);

        const downloadPromises = videos.map(video => {
            const formattedStartTime = new Date(video.startTime.seconds * 1000).toISOString()
                .replace(/:/g, '-')
                .replace(/\..+/, '')
                .replace('T', '_');
            const safeEmail = video.student.replace(/[@.]/g, '_');
            const newFileName = `${video.classId}_${safeEmail}_${formattedStartTime}.mp4`;

            const tempFilePath = path.join(tempDir, newFileName);
            return bucket.file(video.path).download({ destination: tempFilePath });
        });
        await Promise.all(downloadPromises);

        console.log('All videos downloaded. Generating CSV summary.');

        const csvData = videos.map(video => {
            const formattedStartTime = new Date(video.startTime.seconds * 1000).toISOString()
                .replace(/:/g, '-')
                .replace(/\..+/, '')
                .replace('T', '_');
            const safeEmail = video.student.replace(/[@.]/g, '_');
            const newFileName = `${video.classId}_${safeEmail}_${formattedStartTime}.mp4`;

            return {
                student_email: video.student,
                video_start_time: new Date(video.startTime.seconds * 1000).toISOString(),
                filename_in_zip: newFileName
            };
        });

        const csvString = stringify(csvData, { header: true });
        fs.writeFileSync(path.join(tempDir, 'summary.csv'), csvString);

        console.log('CSV summary generated. Starting zip process.');

        const outputZipName = `${jobId}.zip`;
        const outputZipPath = path.join(os.tmpdir(), outputZipName);
        const output = fs.createWriteStream(outputZipPath);
        const archive = archiver('zip', {
            zlib: { level: ZIP_COMPRESSION_LEVEL } // Sets the compression level.
        });

        archive.pipe(output);
        archive.directory(tempDir, false);
        await archive.finalize();

        const destinationPath = `zips/${classId}/${outputZipName}`;
        await bucket.upload(outputZipPath, {
            destination: destinationPath,
            metadata: {
                contentType: 'application/zip',
                metadata: {
                    classId,
                    requester,
                }
            }
        });

        console.log(`Zip file uploaded to ${destinationPath}. Getting signed URL.`);


        const title = `Video archive for class '${classId}'`;

        // Create email document with download link
        await db.collection('mails').add({
            to: requester,
            title: title,
            createdAt: new Date(),
            read: false,
            message: {
                subject: 'Your video archive is ready for download',
                html: `Hello,<br><br>Your requested video archive for class '${classId}' is ready.`
            },
            attachments: [
                { name: jobId + ".zip", key: destinationPath }
            ]
        });

        console.log(`Email with download link sent to ${requester}.`);

        await jobRef.update({ status: 'completed', finishedAt: new Date(), zipPath: destinationPath });

        // Clean up local files
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(outputZipPath);

        console.log(`Job ${jobId} completed successfully.`);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await jobRef.update({ status: 'failed', finishedAt: new Date(), error: error.message });
    }
});