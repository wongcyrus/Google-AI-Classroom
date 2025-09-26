import './firebase.js';
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { VIDEO_FRAME_RATE } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';
import Jimp from 'jimp';

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

ffmpeg.setFfmpegPath(ffmpeg_static);

export const processVideoJob = onDocumentCreated({ document: 'videoJobs/{jobId}', memory: '8GiB', timeoutSeconds: 540 }, async (event) => {
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
            .where("deleted", "==", false)
            .orderBy("timestamp", "asc");

        const querySnapshot = await q.get();
        if (querySnapshot.empty) {
            console.log('No screenshots found for the given criteria.');
            await jobRef.update({ status: 'failed', finishedAt: new Date(), error: 'No screenshots found in the selected time range.' });
            return;
        }

        const screenshots = querySnapshot.docs.map(doc => doc.data());
        const tempDir = path.join(os.tmpdir(), jobId);
        fs.mkdirSync(tempDir, { recursive: true });

        console.log(`Downloading and processing ${screenshots.length} images to ${tempDir}`);

        const font = await Jimp.loadFont(Jimp.FONT_SANS_16_BLACK);

        const processPromises = screenshots.map(async (screenshot, index) => {
            const fileName = `image-${index.toString().padStart(5, '0')}.jpg`;
            const filePath = path.join(tempDir, fileName);
            await bucket.file(screenshot.imagePath).download({ destination: filePath });
            
            const image = await Jimp.read(filePath);

            if (image.bitmap.width % 2 !== 0 || image.bitmap.height % 2 !== 0) {
                image.resize(
                    image.bitmap.width % 2 === 0 ? image.bitmap.width : image.bitmap.width - 1,
                    image.bitmap.height % 2 === 0 ? image.bitmap.height : image.bitmap.height - 1
                );
            }

            const timestamp = screenshot.timestamp.toDate();
            const date = timestamp.toLocaleDateString();
            const time = timestamp.toLocaleTimeString();
            const text = `Date: ${date}, Time: ${time}, Class: ${classId}, Email: ${student}`;

            const textHeight = 40;
            const newHeight = image.bitmap.height + textHeight;

            const newImage = new Jimp(image.bitmap.width, newHeight, '#FFFFFF');
            newImage.composite(image, 0, textHeight);
            newImage.print(font, 10, 12, text);
            
            await newImage.writeAsync(filePath);
        });
        
        await Promise.all(processPromises);

        console.log('All images downloaded and processed. Starting ffmpeg.');

        const outputVideoName = `${jobId}.mp4`;
        const outputVideoPath = path.join(os.tmpdir(), outputVideoName);

        await new Promise((resolve, reject) => {
            let lastPercent = -1;
            ffmpeg(path.join(tempDir, 'image-%05d.jpg'))
                .inputOptions(['-framerate', VIDEO_FRAME_RATE])
                .outputOptions(['-c:v', 'libx264', '-pix_fmt', 'yuv420p'])
                .on('progress', (progress) => {
                    if (progress.frames) {
                        const totalFrames = screenshots.length;
                        if (totalFrames > 0) {
                            const percent = Math.min(100, Math.floor((progress.frames / totalFrames) * 100));
                            if (percent > lastPercent) {
                                console.log(`[ffmpeg] Processing: ${percent}% done`);
                                lastPercent = percent;
                            }
                        }
                    }
                })
                .on('end', resolve)
                .on('error', (err, stdout, stderr) => {
                    console.error('ffmpeg stdout:', stdout);
                    console.error('ffmpeg stderr:', stderr);
                    reject(err);
                })
                .save(outputVideoPath);
        });

        console.log(`Video created at ${outputVideoPath}. Uploading to storage.`);

        const videoStats = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(outputVideoPath, (err, metadata) => {
                if (err) reject(err);
                resolve(metadata);
            });
        });

        const duration = videoStats.format.duration;
        const size = videoStats.format.size;

        const destinationPath = `videos/${classId}/${outputVideoName}`;
        await bucket.upload(outputVideoPath, {
            destination: destinationPath,
            metadata: {
                contentType: 'video/mp4',
                metadata: { classId, student, startTime, endTime, duration, size }
            }
        });

        console.log(`Video uploaded to ${destinationPath}`);

        await jobRef.update({ status: 'completed', finishedAt: new Date(), videoPath: destinationPath, duration, size });

        // Clean up local files
        fs.rmSync(tempDir, { recursive: true, force: true });
        fs.unlinkSync(outputVideoPath);

        console.log(`Job ${jobId} completed successfully.`);

    } catch (error) {
        console.error(`Job ${jobId} failed:`, error);
        await jobRef.update({ status: 'failed', finishedAt: new Date(), error: error.message });
    }
});
