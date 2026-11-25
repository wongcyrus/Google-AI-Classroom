import './firebase.js';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { ZIP_COMPRESSION_LEVEL, FUNCTION_REGION } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import archiver from 'archiver';
import { stringify } from 'csv-stringify/sync';

const db = getFirestore();
const storage = getStorage();
const adminAuth = getAuth();
const bucket = storage.bucket();

function toDateSafe(ts) {
  if (!ts) return new Date(NaN);
  if (typeof ts.toDate === 'function') return ts.toDate();
  if (typeof ts.seconds === 'number') return new Date(ts.seconds * 1000);
  if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000);
  if (ts instanceof Date) return ts;
  return new Date(ts);
}

export const processZipJob = onDocumentCreated({
  document: 'zipJobs/{jobId}',
  region: FUNCTION_REGION,
  cpu: 2,
  memory: '8GiB', 
  timeoutSeconds: 540
}, async (event) => {
  const snap = event.data;
  if (!snap) {
    console.log('No data associated with the event');
    return;
  }
  const jobData = snap.data() || {};
  const { jobId = event.params?.jobId, videos, requester, classId } = jobData;
  const jobRef = snap.ref;

  if (jobData.status && jobData.status !== 'pending') {
    console.log(`Zip job ${jobId} is not in 'pending' state (${jobData.status}). Aborting.`);
    return;
  }

  console.log(`Processing zip job: ${jobId} for ${requester}`);

  let tempDir = null;
  let outputZipPath = null;

  try {
    if (!Array.isArray(videos) || videos.length === 0) {
      await jobRef.update({ status: 'failed', finishedAt: new Date(), error: 'No videos supplied for archive.' });
      return;
    }

    await jobRef.update({ status: 'processing', startedAt: new Date() });

    tempDir = path.join(os.tmpdir(), jobId);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`Downloading ${videos.length} videos to ${tempDir}`);

    const buildVideoFilename = (video, idx) => {
      const parsedDate = toDateSafe(video.startTime);
      const formattedStartTime = !isNaN(parsedDate.getTime())
        ? parsedDate.toISOString().replace(/:/g, '-').replace(/\..+/, '').replace('T', '_')
        : `clip_${idx}`;
      const safeEmail = (video.studentEmail || 'unknown').replace(/[@.]/g, '_');
      return `${video.classId || classId || 'class'}_${safeEmail}_${formattedStartTime}_${idx}.mp4`;
    };

    const DOWNLOAD_CONCURRENCY = 10;
    for (let i = 0; i < videos.length; i += DOWNLOAD_CONCURRENCY) {
      const chunk = videos.slice(i, i + DOWNLOAD_CONCURRENCY);
      await Promise.all(chunk.map((video, offset) => {
        const idx = i + offset;
        const newFileName = buildVideoFilename(video, idx);
        const tempFilePath = path.join(tempDir, newFileName);
        return bucket.file(video.path).download({ destination: tempFilePath });
      }));
    }

    console.log('All videos downloaded. Generating CSV summary.');

    const csvData = videos.map((video, idx) => {
      const parsedDate = toDateSafe(video.startTime);
      return {
        student_email: video.studentEmail || '',
        video_start_time: !isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : '',
        filename_in_zip: buildVideoFilename(video, idx)
      };
    });

    const csvString = stringify(csvData, { header: true });
    fs.writeFileSync(path.join(tempDir, 'summary.csv'), csvString);

    console.log('CSV summary generated. Starting zip process.');

    const outputZipName = `${jobId}.zip`;
    outputZipPath = path.join(os.tmpdir(), outputZipName);
    const output = fs.createWriteStream(outputZipPath);
    const archive = archiver('zip', {
      zlib: { level: ZIP_COMPRESSION_LEVEL } // Sets the compression level.
    });

    const outputClosedPromise = new Promise((resolve, reject) => {
      output.on('close', resolve);
      output.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await Promise.all([outputClosedPromise, archive.finalize()]);

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

    const requesterUser = await adminAuth.getUser(requester);
    const requesterEmail = requesterUser.email;

    if (!requesterEmail) {
      console.error(`Requester ${requester} has no email address.`);
      // Still mark job as complete, but admin may need to manually notify.
    } else {
      const title = `Video archive for class '${classId}'`;

      // Create email document with download link
      await db.collection('mails').add({
        to: requesterEmail,
        title: title,
        createdAt: new Date(),
        read: false,
        message: {
          subject: 'Your video archive is ready for download',
          html: `Hello,<br><br>Your requested video archive for class '${classId}' is ready.`
        },
        attachments: [
          { name: jobId + '.zip', key: destinationPath }
        ]
      });
      console.log(`Email with download link sent to ${requesterEmail}.`);
    }

    await jobRef.update({ status: 'completed', finishedAt: new Date(), zipPath: destinationPath });

    console.log(`Job ${jobId} completed successfully.`);

  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    await jobRef.update({ status: 'failed', finishedAt: new Date(), error: error.message });
  } finally {
    try {
      if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    try {
      if (outputZipPath && fs.existsSync(outputZipPath)) fs.unlinkSync(outputZipPath);
    } catch {}
  }
});