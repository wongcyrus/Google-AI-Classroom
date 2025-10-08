import './firebase.js';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { VIDEO_FRAME_RATE, FUNCTION_REGION } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';
import sharp from 'sharp';

const db = getFirestore();
const storage = getStorage();
const bucket = storage.bucket();

let ffmpegPathSet = false;

const retry = async (fn, retries = 3, delay = 2000, finalErr = 'Failed after multiple retries') => {
  try {
    return await fn();
  } catch (err) {
    console.error(err); // Log the error on each retry
    if (retries <= 0) {
      throw new Error(finalErr);
    }
    console.log(`Retrying in ${delay}ms... (${retries} retries left)`);
    await new Promise(res => setTimeout(res, delay));
    return retry(fn, retries - 1, delay * 2, finalErr);
  }
};

export const processVideoJob = onDocumentCreated({ document: 'videoJobs/{jobId}', region: FUNCTION_REGION, cpu: 2, memory: '8GiB', timeoutSeconds: 540, concurrency: 1, maxInstances: 50 }, async (event) => {
  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(ffmpeg_static);
    ffmpegPathSet = true;
  }
  const snap = event.data;
  if (!snap) {
    console.log('No data associated with the event');
    return;
  }
  const jobData = snap.data();
  const { jobId, classId, studentUid, studentEmail, startTime, endTime } = jobData;
  const jobRef = snap.ref;

  if (jobData.status !== 'pending') {
    console.log(`Job ${jobId} was triggered but is not in 'pending' state (current state: '${jobData.status}'). Aborting execution.`);
    return;
  }

  console.log(`Processing video job: ${jobId}`);

  try {
    await jobRef.update({ status: 'processing', startedAt: new Date() });

    const screenshotsRef = db.collection('screenshots');
    const q = screenshotsRef
      .where('classId', '==', classId)
      .where('studentUid', '==', studentUid)
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .where('deleted', '==', false)
      .orderBy('timestamp', 'asc');

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

    // WARNING: A high batch size can lead to out-of-memory errors. Recommended: 5-10.
    const BATCH_SIZE = 50;
    for (let i = 0; i < screenshots.length; i += BATCH_SIZE) {
      const batch = screenshots.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch of ${batch.length} images...`);
      const processPromises = batch.map(async (screenshot, indexInBatch) => {
        const overallIndex = i + indexInBatch;
        const fileName = `image-${overallIndex.toString().padStart(5, '0')}.jpg`;
        const filePath = path.join(tempDir, fileName);
        await bucket.file(screenshot.imagePath).download({ destination: filePath });
        
        const image = sharp(filePath);
        const metadata = await image.metadata();

        let width = metadata.width;
        let height = metadata.height;

        // Ensure dimensions are even for ffmpeg
        if (width % 2 !== 0) width--;
        if (height % 2 !== 0) height--;

        const timestamp = screenshot.timestamp.toDate();
        const date = timestamp.toLocaleDateString();
        const time = timestamp.toLocaleTimeString();
        const text = `Date: ${date}, Time: ${time}, Class: ${classId}, Email: ${studentEmail}`;

        const textHeight = 40;

        const svgText = `<svg width="${width}" height="${textHeight}"><rect x="0" y="0" width="${width}" height="${textHeight}" fill="white"/><text x="10" y="25" font-family="sans-serif" font-size="16" fill="black">${text}</text></svg>`;
        const svgBuffer = Buffer.from(svgText);

        const tempOutputPath = filePath + ".tmp";

        await image
            .resize(width, height)
            .extend({
                top: textHeight,
                background: { r: 255, g: 255, b: 255, alpha: 1 }
            })
            .composite([
                { input: svgBuffer, gravity: 'north' }
            ])
            .jpeg()
            .toFile(tempOutputPath);

        // Overwrite original file
        await fs.promises.rename(tempOutputPath, filePath);
      });
            
      await Promise.all(processPromises);
    }

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
          const ffmpegError = new Error('ffmpeg failed to process video.');
          ffmpegError.ffmpegStderr = stderr;
          reject(ffmpegError);
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
    await retry(() => bucket.upload(outputVideoPath, {
      destination: destinationPath,
      metadata: {
        contentType: 'video/mp4',
        metadata: { classId, studentUid, studentEmail, startTime, endTime, duration, size }
      }
    }), 3, 2000, 'Failed to upload video after multiple retries.');

    console.log(`Video uploaded to ${destinationPath}`);

    await jobRef.update({ status: 'completed', finishedAt: new Date(), videoPath: destinationPath, duration, size });

    // Clean up local files
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(outputVideoPath);

    console.log(`Job ${jobId} completed successfully.`);

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    const updatePayload = {
      status: 'failed',
      finishedAt: new Date(),
      error: error.message,
      errorStack: error.stack,
    };
    if (error.ffmpegStderr) {
      updatePayload.ffmpegError = error.ffmpegStderr;
    } else {
      updatePayload.ffmpegError = 'No specific ffmpeg stderr was captured. The error may have occurred before the ffmpeg process started (e.g., during image download or processing). See the \'error\' and \'errorStack\' fields for more details.';
    }
    await jobRef.update(updatePayload);
  }
});
