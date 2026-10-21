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
import { formatInTimeZone } from 'date-fns-tz';
import sharp from 'sharp';
import { parsePeriodDateMs } from './examPeriodUtils.js';
import { executeMergeStudentSessionAudio } from './mergeStudentSessionAudio.js';

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

export const isExamTimeRange = (startTime, endTime, examPeriods = [], timeZone = 'Asia/Hong_Kong') => {
  if (!examPeriods || !Array.isArray(examPeriods) || examPeriods.length === 0) return false;
  const jobStartMs = parsePeriodDateMs(startTime, timeZone);
  const jobEndMs = parsePeriodDateMs(endTime, timeZone);
  if (isNaN(jobStartMs) && isNaN(jobEndMs)) return false;

  return examPeriods.some((p) => {
    if (!p?.startDate || !p?.endDate) return false;
    const pStartMs = parsePeriodDateMs(p.startDate, timeZone);
    const pEndMs = parsePeriodDateMs(p.endDate, timeZone);
    if (isNaN(pStartMs) || isNaN(pEndMs)) return false;

    const start = isNaN(jobStartMs) ? jobEndMs : jobStartMs;
    const end = isNaN(jobEndMs) ? jobStartMs : jobEndMs;
    return (start >= pStartMs && start <= pEndMs) ||
           (end >= pStartMs && end <= pEndMs) ||
           (start <= pStartMs && end >= pEndMs);
  });
};

/**
 * Resolves the capture interval directly without empirical delta fallback.
 * Since legacy capture images were purged, all new screenshots strictly contain
 * the authoritative captureInterval metadata tagged from the active session.
 *
 * 1. Explicit jobData.captureInterval (if specified on the videoJob)
 * 2. Tagged captureInterval metadata on individual screenshots
 * 3. Configured class capture interval (sessionFrameRate or frameRate)
 */
export function determineActualCaptureInterval(screenshots, jobCaptureInterval = null, configuredInterval = 15) {
  if (typeof jobCaptureInterval === 'number' && jobCaptureInterval > 0) {
    return jobCaptureInterval;
  }

  if (screenshots && screenshots.length > 0) {
    const taggedIntervals = screenshots
      .map(s => typeof s.captureInterval === 'number' && s.captureInterval > 0 ? s.captureInterval : null)
      .filter(Boolean);
    if (taggedIntervals.length > 0) {
      taggedIntervals.sort((a, b) => a - b);
      return taggedIntervals[Math.floor(taggedIntervals.length / 2)];
    }
  }

  return configuredInterval;
}

/**
 * Approach 2: Slices pending in-class practical task attempt clips directly from
 * the newly compiled class video using ultrafast stream-copying (-c copy),
 * eliminating redundant screenshot downloads and completely avoiding race conditions
 * with post-video screenshot deletion.
 */
export async function slicePendingTaskSubmissions({
  classId,
  studentUid,
  studentEmail,
  classStartTime,
  classEndTime,
  captureInterval = 15,
  outputVideoPath,
  screenshots = [],
  db,
  bucket,
  retry,
}) {
  if (!classId || !studentUid || !outputVideoPath || (typeof fs.existsSync === 'function' && !fs.existsSync(outputVideoPath))) {
    return [];
  }

  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(ffmpeg_static);
    ffmpegPathSet = true;
  }

  const taskJobsSnap = await db.collection('videoJobs')
    .where('classId', '==', classId)
    .where('studentUid', '==', studentUid)
    .where('isTaskSubmission', '==', true)
    .get();

  const pendingDocs = taskJobsSnap.docs.filter((d) => {
    const s = d.data().status;
    return s === 'awaiting_class_video' || s === 'pending';
  });

  if (pendingDocs.length === 0) {
    return [];
  }

  console.log(`[slicePendingTaskSubmissions] Found ${pendingDocs.length} pending task submission(s) for student ${studentUid} to slice from class video.`);

  const toMs = (ts) => {
    if (!ts) return NaN;
    if (typeof ts.toMillis === 'function') return ts.toMillis();
    if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    if (ts instanceof Date) return ts.getTime();
    return new Date(ts).getTime();
  };

  const classStartMs = toMs(classStartTime);
  const processedTaskIds = [];

  for (const taskJobDoc of pendingDocs) {
    const taskJob = taskJobDoc.data();
    const taskId = taskJob.taskId;
    const attemptNumber = taskJob.attemptNumber || 1;
    const taskStartMs = toMs(taskJob.startTime);
    const taskEndMs = toMs(taskJob.endTime);

    if (!taskId || isNaN(taskStartMs) || isNaN(taskEndMs)) {
      continue;
    }

    // Identify start frame index and duration
    let firstIndex = screenshots.findIndex((s) => {
      if (s.activeTaskId && s.activeTaskId === taskId) {
        return true;
      }
      const sMs = toMs(s.timestamp);
      return !isNaN(sMs) && sMs >= taskStartMs;
    });

    let lastIndex = -1;
    for (let i = screenshots.length - 1; i >= 0; i--) {
      const s = screenshots[i];
      if (s.activeTaskId && s.activeTaskId === taskId) {
        lastIndex = i;
        break;
      }
      const sMs = toMs(s.timestamp);
      if (!isNaN(sMs) && sMs <= taskEndMs) {
        lastIndex = i;
        break;
      }
    }

    let startSec = 0;
    let durSec = 1;

    if (firstIndex !== -1 && lastIndex >= firstIndex) {
      startSec = firstIndex;
      durSec = Math.max(1, lastIndex - firstIndex + 1);
    } else {
      if (!isNaN(classStartMs) && taskStartMs >= classStartMs) {
        startSec = Math.max(0, Math.floor((taskStartMs - classStartMs) / 1000 / captureInterval));
      }
      durSec = Math.max(1, Math.ceil((taskEndMs - taskStartMs) / 1000 / captureInterval));
    }

    console.log(`[slicePendingTaskSubmissions] Slicing task ${taskId} (att #${attemptNumber}) at startSec=${startSec}, durSec=${durSec}`);

    const taskClipPath = path.join(os.tmpdir(), `${taskJobDoc.id}_clip.mp4`);

    try {
      await new Promise((resolve, reject) => {
        ffmpeg(outputVideoPath)
          .setStartTime(startSec)
          .setDuration(durSec)
          .outputOptions([
            '-c', 'copy',
            '-avoid_negative_ts', 'make_zero',
            '-movflags', '+faststart'
          ])
          .output(taskClipPath)
          .on('end', resolve)
          .on('error', (err) => {
            console.warn(`[slicePendingTaskSubmissions] Stream copy slice failed, attempting ultrafast re-encode fallback:`, err);
            ffmpeg(outputVideoPath)
              .setStartTime(startSec)
              .setDuration(durSec)
              .outputOptions([
                '-c:v', 'libx264',
                '-pix_fmt', 'yuv420p',
                '-preset', 'ultrafast',
                '-crf', '28',
                '-movflags', '+faststart'
              ])
              .output(taskClipPath)
              .on('end', resolve)
              .on('error', reject)
              .run();
          })
          .run();
      });

      let clipDuration = durSec;
      let clipSize = 0;
      try {
        const probe = await new Promise((res, rej) => {
          ffmpeg.ffprobe(taskClipPath, (err, meta) => {
            if (err) rej(err);
            else res(meta);
          });
        });
        clipDuration = probe?.format?.duration || durSec;
        clipSize = probe?.format?.size || (fs.existsSync(taskClipPath) ? fs.statSync(taskClipPath).size : 0);
      } catch {
        try {
          if (fs.existsSync(taskClipPath)) clipSize = fs.statSync(taskClipPath).size;
        } catch {}
      }

      const destinationPath = `classes/${classId}/tasks/${taskId}/submissions/${studentUid}/attempt_${attemptNumber}.mp4`;

      await retry(() => bucket.upload(taskClipPath, {
        destination: destinationPath,
        metadata: {
          contentType: 'video/mp4',
          metadata: {
            classId,
            studentUid,
            studentEmail: studentEmail || taskJob.studentEmail || '',
            startTime: taskJob.startTime,
            endTime: taskJob.endTime,
            duration: String(clipDuration),
            size: String(clipSize),
            captureInterval: String(captureInterval),
            isTaskSubmission: 'true',
            taskId,
            attemptNumber: String(attemptNumber),
            slicedFromClassVideo: 'true'
          }
        }
      }), 3, 2000, 'Failed to upload sliced task clip');

      console.log(`[slicePendingTaskSubmissions] Successfully uploaded task clip to ${destinationPath}`);

      // Update attempt document
      try {
        const attemptRef = db.collection('classes').doc(classId)
          .collection('tasks').doc(taskId)
          .collection('submissions').doc(studentUid)
          .collection('attempts').doc(String(attemptNumber));

        await attemptRef.set({
          status: 'compiling_complete',
          compiledVideoPath: destinationPath,
          videoJobId: taskJobDoc.id,
          duration: clipDuration,
          size: clipSize,
          compiledAt: new Date()
        }, { merge: true });

        const subRef = db.collection('classes').doc(classId)
          .collection('tasks').doc(taskId)
          .collection('submissions').doc(studentUid);

        await subRef.set({
          status: 'compiling_complete',
          compiledVideoPath: destinationPath,
          latestAttempt: {
            status: 'compiling_complete',
            compiledVideoPath: destinationPath,
            attemptNumber,
            finishedAt: taskJob.endTime || new Date(),
          },
          updatedAt: new Date()
        }, { merge: true });
      } catch (attErr) {
        console.warn(`[slicePendingTaskSubmissions] Failed to update task attempt Firestore doc:`, attErr);
      }

      // Mark the task videoJobs document as completed so triggerAutomaticAnalysis triggers automated AI evaluation
      await taskJobDoc.ref.update({
        status: 'completed',
        finishedAt: new Date(),
        videoPath: destinationPath,
        duration: clipDuration,
        size: clipSize,
        captureInterval,
        slicedFromClassVideo: true,
      });

      processedTaskIds.push(taskJobDoc.id);
    } catch (err) {
      console.error(`[slicePendingTaskSubmissions] Failed to slice and process task ${taskId}:`, err);
    } finally {
      try {
        if (fs.existsSync(taskClipPath)) {
          fs.unlinkSync(taskClipPath);
        }
      } catch {}
    }
  }

  return processedTaskIds;
}

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

    const classRef = db.collection('classes').doc(classId);
    const classDoc = await classRef.get();
    const classData = classDoc.data();
    const timezone = classData.schedule?.timeZone || 'UTC';

    const screenshotsRef = db.collection('screenshots');
    let q = screenshotsRef
      .where('classId', '==', classId)
      .where('studentUid', '==', studentUid);

    if (jobData.channel && jobData.channel !== 'all') {
      q = q.where('channel', '==', jobData.channel);
    }

    q = q
      .where('timestamp', '>=', startTime)
      .where('timestamp', '<=', endTime)
      .where('deleted', '==', false)
      .orderBy('timestamp', 'asc');

    const querySnapshot = await q.get();
    if (querySnapshot.empty) {
      console.log('No screenshots found for the given criteria.');
      const emptyError = 'No screenshots found in the selected time range.';
      await jobRef.update({ status: 'failed', finishedAt: new Date(), error: emptyError });
      if (isTaskSubmission && taskId && studentUid) {
        try {
          const subRef = db.collection('classes').doc(classId)
            .collection('tasks').doc(taskId)
            .collection('submissions').doc(studentUid);
          await subRef.set({
            status: 'compilation_failed',
            compilationError: emptyError,
            updatedAt: new Date(),
          }, { merge: true });
          const attemptRef = subRef.collection('attempts').doc(String(attemptNumber));
          await attemptRef.set({
            status: 'compilation_failed',
            compilationError: emptyError,
            updatedAt: new Date(),
          }, { merge: true });
        } catch (subErr) {
          console.warn('[processVideoJob] Failed to mark task submission as compilation_failed:', subErr);
        }
      }
      return;
    }

    const seenImagePaths = new Set();
    const screenshots = querySnapshot.docs
      .map(doc => doc.data())
      .filter(s => {
        const imgPath = s?.imagePath || s?.storagePath;
        if (!imgPath) return true;
        if (seenImagePaths.has(imgPath)) return false;
        seenImagePaths.add(imgPath);
        return true;
      });
    const tempDir = path.join(os.tmpdir(), jobId);
    fs.mkdirSync(tempDir, { recursive: true });

    console.log(`Downloading and processing ${screenshots.length} images to ${tempDir}`);

    // BATCH_SIZE of 15 provides optimal throughput without memory pressure
    const BATCH_SIZE = 15;
    const MAX_WIDTH = 1920;

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

        // Cap maximum width to 1080p width (1920) preserving aspect ratio
        if (width > MAX_WIDTH) {
          height = Math.round((height * MAX_WIDTH) / width);
          width = MAX_WIDTH;
        }

        // Ensure dimensions are even for ffmpeg
        if (width % 2 !== 0) width--;
        if (height % 2 !== 0) height--;

        const timestamp = screenshot.timestamp.toDate();
        const date = formatInTimeZone(timestamp, timezone, 'yyyy-MM-dd');
        const time = formatInTimeZone(timestamp, timezone, 'HH:mm:ss');
        const channelTag = screenshot.channel ? ` [${screenshot.channel.toUpperCase()}]` : '';
        const text = `Date: ${date}, Time: ${time}, Class: ${classId}, Email: ${studentEmail}${channelTag}`;

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
            .jpeg({ quality: 85 })
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
        .outputOptions([
          '-c:v', 'libx264',
          '-pix_fmt', 'yuv420p',
          '-preset', 'fast',
          '-crf', '30',
          '-tune', 'stillimage',
          '-movflags', '+faststart'
        ])
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

    const configuredInterval = classData?.sessionFrameRate ? Number(classData.sessionFrameRate) : (classData?.frameRate ? Number(classData.frameRate) : 15);
    const captureInterval = determineActualCaptureInterval(screenshots, jobData.captureInterval, configuredInterval);

    const isExamSession = Boolean(
      jobData.isExam ||
      isExamTimeRange(startTime, endTime, classData?.examPeriods, timezone)
    );

    const isTaskSubmission = Boolean(jobData.isTaskSubmission);
    const taskId = jobData.taskId || null;
    const attemptNumber = jobData.attemptNumber || 1;

    const destinationPath = isTaskSubmission && taskId
      ? `classes/${classId}/tasks/${taskId}/submissions/${studentUid}/attempt_${attemptNumber}.mp4`
      : `videos/${classId}/${outputVideoName}`;

    await retry(() => bucket.upload(outputVideoPath, {
      destination: destinationPath,
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          classId,
          studentUid,
          studentEmail,
          startTime,
          endTime,
          duration,
          size,
          captureInterval: String(captureInterval),
          isExam: isExamSession ? 'true' : 'false',
          isTaskSubmission: isTaskSubmission ? 'true' : 'false',
          taskId: taskId || '',
          attemptNumber: String(attemptNumber)
        }
      }
    }), 3, 2000, 'Failed to upload video after multiple retries.');

    console.log(`Video uploaded to ${destinationPath} (isExam: ${isExamSession}, isTaskSubmission: ${isTaskSubmission}, captureInterval: ${captureInterval}s)`);

    await jobRef.update({
      status: 'completed',
      finishedAt: new Date(),
      videoPath: destinationPath,
      duration,
      size,
      captureInterval,
      isExam: isExamSession,
      isTaskSubmission,
      taskId,
      attemptNumber
    });

    // Auto-combine student microphone voice clips into a unified session audio track
    if (!isTaskSubmission) {
      try {
        console.log(`[processVideoJob] Automatically merging student session audio for ${studentUid} in class ${classId}...`);
        const audioMergeResult = await executeMergeStudentSessionAudio({
          classId,
          studentUid,
          startTime,
          endTime,
        }, { db, storage });

        if (audioMergeResult?.status === 'success') {
          console.log(`[processVideoJob] Successfully auto-merged ${audioMergeResult.clipCount} audio clip(s) for student ${studentUid}`);
          await jobRef.update({
            hasAudio: true,
            audioUrl: audioMergeResult.audioUrl || null,
            audioPath: audioMergeResult.audioPath || null,
            audioDuration: audioMergeResult.durationSeconds || null,
            audioClipCount: audioMergeResult.clipCount || null,
            transcript: audioMergeResult.transcript || null,
          });
        }
      } catch (audioMergeErr) {
        console.warn(`[processVideoJob] Auto audio merge note for ${studentUid}:`, audioMergeErr.message);
      }
    }

    if (isTaskSubmission && taskId) {
      try {
        const subRef = db.collection('classes').doc(classId)
          .collection('tasks').doc(taskId)
          .collection('submissions').doc(studentUid);
        const attemptRef = subRef.collection('attempts').doc(String(attemptNumber));

        await attemptRef.set({
          status: 'compiling_complete',
          compiledVideoPath: destinationPath,
          videoJobId: jobId,
          duration,
          size,
          compiledAt: new Date()
        }, { merge: true });

        await subRef.set({
          status: 'compiling_complete',
          compiledVideoPath: destinationPath,
          durationSeconds: duration,
          latestAttempt: {
            status: 'compiling_complete',
            compiledVideoPath: destinationPath,
            attemptNumber,
            duration,
            size,
            finishedAt: endTime || new Date(),
          },
          updatedAt: new Date()
        }, { merge: true });
      } catch (attErr) {
        console.warn(`[processVideoJob] Failed to update task attempt document:`, attErr);
      }
    } else {
      // Approach 2: Slicing pending in-class task submission clips directly from the newly compiled class video
      try {
        await slicePendingTaskSubmissions({
          classId,
          studentUid,
          studentEmail,
          classStartTime: startTime,
          classEndTime: endTime,
          captureInterval,
          outputVideoPath,
          screenshots,
          db,
          bucket,
          retry,
        });
      } catch (sliceErr) {
        console.error(`[processVideoJob] Error slicing task submissions from class video:`, sliceErr);
      }
    }

    // Clean up local files
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.unlinkSync(outputVideoPath);

    // Auto-delete routine screenshots once combined into video (preserving flagged/irregularity evidence)
    // Only class-level video jobs should trigger routine screenshot purge, never standalone task jobs
    if (!isTaskSubmission) {
      try {
        // 1. Freeze authentic timestamp attendance bitmask directly into lessons/{lessonId} before deleting raw screenshots
        try {
          const crypto = await import('crypto');
          const startMs = startTime instanceof Date ? startTime.getTime() : (startTime?.toDate ? startTime.toDate().getTime() : new Date(startTime).getTime());
          const endMs = endTime instanceof Date ? endTime.getTime() : (endTime?.toDate ? endTime.toDate().getTime() : new Date(endTime).getTime());
          const durationMins = Math.max(1, Math.round((endMs - startMs) / 60000));

          const startISO = new Date(startMs).toISOString();
          const endISO = new Date(endMs).toISOString();
          const lessonId = crypto.createHash('sha256').update(`${startISO}-${endISO}`).digest('hex');
          const lessonRef = db.collection('classes').doc(classId).collection('lessons').doc(lessonId);

          const existingLessonSnap = typeof lessonRef.get === 'function' ? await lessonRef.get().catch(() => null) : null;
          const existingStudentData = existingLessonSnap?.exists ? (existingLessonSnap.data()?.students?.[studentUid] || {}) : {};
          const existingBitmask = Array.isArray(existingStudentData.attendance) ? existingStudentData.attendance : [];

          const studentBitmask = Array(durationMins).fill(0);
          for (let i = 0; i < durationMins; i++) {
            if (i < existingBitmask.length && existingBitmask[i] > 0) {
              studentBitmask[i] = existingBitmask[i];
            }
          }

          querySnapshot.docs.forEach((docSnap) => {
            const sData = docSnap.data() || {};
            const rawTs = sData.timestamp;
            const ts = rawTs?.toDate ? rawTs.toDate() : (rawTs ? new Date(rawTs) : null);
            if (!ts || isNaN(ts.getTime())) return;
            const minIdx = Math.floor((ts.getTime() - startMs) / 60000);
            if (minIdx >= 0 && minIdx < durationMins && studentBitmask[minIdx] === 0) {
              studentBitmask[minIdx] = 1;
            }
          });

          const sharedMins = studentBitmask.reduce((sum, v) => sum + (v === 1 || v === 3 || v === 4 ? 1 : 0), 0);
          await lessonRef.set({
            startTime: new Date(startMs),
            endTime: new Date(endMs),
            students: {
              [studentUid]: {
                ...existingStudentData,
                email: studentEmail,
                sharedScreenMinutes: sharedMins,
                rawScreenMinutes: Math.max(sharedMins, existingStudentData.rawScreenMinutes || 0),
                attendance: studentBitmask,
              },
            },
          }, { merge: true });

          console.log(`[processVideoJob] Successfully saved attendance bitmask (${sharedMins} active minutes) for student ${studentUid} in lesson ${lessonId} before screenshot cleanup.`);
        } catch (freezeErr) {
          console.warn(`[processVideoJob] Could not freeze attendance bitmask before cleanup:`, freezeErr);
        }

        console.log(`[processVideoJob] Purging routine unflagged screenshots for student ${studentUid} in class ${classId}...`);
        const docsToPurge = querySnapshot.docs.filter((docSnap) => {
          const sData = docSnap.data() || {};
          const isFlagged = sData.isFlagged === true ||
                            sData.isViolation === true ||
                            Boolean(sData.incidentId) ||
                            sData.reviewRequired === true ||
                            sData.suspicious === true;
          return !isFlagged;
        });

        if (docsToPurge.length > 0) {
          console.log(`[processVideoJob] Purging ${docsToPurge.length} routine screenshots for student ${studentUid} in class ${classId} (preserved ${querySnapshot.docs.length - docsToPurge.length} flagged records).`);
          const BATCH_SIZE = 400;
          for (let i = 0; i < docsToPurge.length; i += BATCH_SIZE) {
            const batch = db.batch();
            docsToPurge.slice(i, i + BATCH_SIZE).forEach((d) => batch.delete(d.ref));
            await batch.commit();
          }
        }
      } catch (purgeErr) {
        console.warn(`[processVideoJob] Failed to purge routine screenshots after video compilation:`, purgeErr);
      }
    }

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
    if (Boolean(jobData?.isTaskSubmission) && jobData?.taskId && studentUid) {
      try {
        const subRef = db.collection('classes').doc(classId)
          .collection('tasks').doc(jobData.taskId)
          .collection('submissions').doc(studentUid);
        if (typeof subRef?.set === 'function') {
          await subRef.set({
            status: 'compilation_failed',
            compilationError: error.message,
            updatedAt: new Date(),
          }, { merge: true });
        }
        const attemptRef = subRef?.collection?.('attempts')?.doc?.(String(jobData.attemptNumber || 1));
        if (typeof attemptRef?.set === 'function') {
          await attemptRef.set({
            status: 'compilation_failed',
            compilationError: error.message,
            updatedAt: new Date(),
          }, { merge: true });
        }
      } catch (subErr) {
        console.warn('[processVideoJob] Failed to mark task submission as compilation_failed on error:', subErr);
      }
    }
  }
});
