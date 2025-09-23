import './firebase.js';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import path from 'path';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

ffmpeg.setFfmpegPath(ffmpeg_static);

export const processVideoJob = onDocumentCreated({ document: 'videoJobs/{jobId}', memory: '4GiB', timeoutSeconds: 540 }, async (event) => {
    const snap = event.data;
    if (!snap) {
        console.log("No data associated with the event");
        return;
    }
    const jobData = snap.data();
    const { jobId, classId, student, startTime, endTime } = jobData;
    const jobRef = snap.ref;

    console.log(`Processing video job: ${jobId}`);

    try {
        await jobRef.update({ status: 'processing', startedAt: new Date() });

        const screenshotsRef = db.collection('screenshots');
        const q = screenshotsRef
            .where("classId", "==", classId)
            .where("email", "==", student)
            .where("timestamp", ">=", startTime)
            .where("timestamp", "<=", endTime)
            .orderBy("timestamp", "asc");

        const querySnapshot = await q.get();
        if (querySnapshot.empty) {
            console.log('No screenshots found for the given criteria.');
            await jobRef.update({ status: 'failed', finishedAt: new Date(), error: 'No screenshots found in the selected time range.' });
            return;
        }

        const imagePaths = querySnapshot.docs.map(doc => doc.data().imagePath);
        const tempDir = path.join(os.tmpdir(), jobId);
        fs.mkdirSync(tempDir, { recursive: true });

        console.log(`Downloading ${imagePaths.length} images to ${tempDir}`);

        const downloadPromises = imagePaths.map((filePath, index) => {
            const fileName = path.join(tempDir, `image-${index.toString().padStart(5, '0')}.jpg`);
            return bucket.file(filePath).download({ destination: fileName });
        });
        await Promise.all(downloadPromises);

        console.log('All images downloaded. Starting ffmpeg.');

        const outputVideoName = `${jobId}.mp4`;
        const outputVideoPath = path.join(os.tmpdir(), outputVideoName);

        await new Promise((resolve, reject) => {
            ffmpeg(path.join(tempDir, 'image-%05d.jpg'))
                .inputOptions(['-framerate', '1'])
                .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30'])
                .on('progress', (progress) => {
                    if (progress.percent) {
                        console.log(`[ffmpeg] Processing: ${Math.round(progress.percent)}% done`);
                    }
                })
                .on('end', resolve)
                .on('error', reject)
                .save(outputVideoPath);
        });

        console.log(`Video created at ${outputVideoPath}. Uploading to storage.`);

        const destinationPath = `videos/${classId}/${outputVideoName}`;
        const [file] = await bucket.upload(outputVideoPath, {
            destination: destinationPath,
            metadata: {
                contentType: 'video/mp4',
                metadata: { classId, student, startTime, endTime }
            }
        });
        
        const videoUrl = await file.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        console.log(`Video uploaded to ${destinationPath}`);

        await jobRef.update({ status: 'completed', finishedAt: new Date(), videoUrl: videoUrl[0], videoPath: destinationPath });

        // Clean up local files
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(outputVideoPath);

        console.log(`Job ${jobId} completed successfully.`);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await jobRef.update({ status: 'failed', finishedAt: new Date(), error: error.message });
    }
});
