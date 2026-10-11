import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';

let _db = null;
let _storage = null;

export function getDb() {
  if (!_db) _db = getFirestore();
  return _db;
}

export function getStorageBucket() {
  if (!_storage) _storage = getStorage();
  return _storage.bucket();
}

let ffmpegPathSet = false;
export function ensureFfmpegPath() {
  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(ffmpeg_static);
    ffmpegPathSet = true;
  }
}

export const toMs = (ts) => {
  if (!ts) return NaN;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  if (ts instanceof Date) return ts.getTime();
  if (typeof ts === 'number') return ts;
  return new Date(ts).getTime();
};

/**
 * Core business logic to slice a student's attempt clip from an existing class MP4
 * and write Firestore attempt/submission docs + videoJobs doc.
 */
export async function sliceStudentClassVideo({
  classId,
  taskId,
  studentUid,
  studentEmail,
  sourceJob,
  startSec,
  durSec,
  attemptNumber = 1,
  bucket,
  dbInstance,
}) {
  ensureFfmpegPath();
  const firestore = dbInstance || getDb();
  const storageBucket = bucket || getStorageBucket();

  const tempSourcePath = path.join(os.tmpdir(), `source_${sourceJob.id}_${Date.now()}.mp4`);
  const tempClipPath = path.join(os.tmpdir(), `clip_${taskId}_${studentUid}_att${attemptNumber}_${Date.now()}.mp4`);

  try {
    // 1. Download source class video from Cloud Storage
    const sourceFile = storageBucket.file(sourceJob.videoPath);
    const [exists] = await sourceFile.exists();
    if (!exists) {
      throw new Error(`Source class video ${sourceJob.videoPath} does not exist in storage.`);
    }

    await sourceFile.download({ destination: tempSourcePath });

    // 2. Stream-copy slice with ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(tempSourcePath)
        .setStartTime(startSec)
        .setDuration(durSec)
        .outputOptions([
          '-c', 'copy',
          '-avoid_negative_ts', 'make_zero',
          '-movflags', '+faststart'
        ])
        .output(tempClipPath)
        .on('end', resolve)
        .on('error', (err) => {
          console.warn(`[extractRetroactiveTaskSubmissions] Stream-copy failed for student ${studentUid}, falling back to ultrafast re-encode:`, err);
          ffmpeg(tempSourcePath)
            .setStartTime(startSec)
            .setDuration(durSec)
            .outputOptions([
              '-c:v', 'libx264',
              '-pix_fmt', 'yuv420p',
              '-preset', 'ultrafast',
              '-crf', '28',
              '-movflags', '+faststart'
            ])
            .output(tempClipPath)
            .on('end', resolve)
            .on('error', reject)
            .run();
        })
        .run();
    });

    // 3. Probe clip duration and size
    let clipDuration = durSec;
    try {
      const probe = await new Promise((res, rej) => {
        ffmpeg.ffprobe(tempClipPath, (err, meta) => {
          if (err) rej(err);
          else res(meta);
        });
      });
      clipDuration = probe?.format?.duration || durSec;
    } catch (probeErr) {
      console.warn(`[extractRetroactiveTaskSubmissions] ffprobe warning for student ${studentUid}:`, probeErr);
    }

    const stat = fs.statSync(tempClipPath);
    const clipSize = stat.size;

    // 4. Upload sliced task clip to task submission location
    const destinationPath = `classes/${classId}/tasks/${taskId}/submissions/${studentUid}/attempt_${attemptNumber}.mp4`;
    await storageBucket.upload(tempClipPath, {
      destination: destinationPath,
      metadata: {
        contentType: 'video/mp4',
        metadata: {
          classId,
          taskId,
          studentUid,
          attemptNumber: String(attemptNumber),
          slicedFromClassVideo: 'true',
          isRetroactive: 'true',
          sourceJobId: sourceJob.id,
        }
      }
    });

    // 5. Update Firestore task attempt subdocument
    const attemptRef = firestore.collection('classes').doc(classId)
      .collection('tasks').doc(taskId)
      .collection('submissions').doc(studentUid)
      .collection('attempts').doc(String(attemptNumber));

    await attemptRef.set({
      attemptNumber,
      status: 'compiling_complete',
      compiledVideoPath: destinationPath,
      duration: clipDuration,
      size: clipSize,
      isRetroactive: true,
      sourceJobId: sourceJob.id,
      startSec,
      durSec,
      compiledAt: new Date(),
    }, { merge: true });

    // 6. Update student root submission document
    const subRef = firestore.collection('classes').doc(classId)
      .collection('tasks').doc(taskId)
      .collection('submissions').doc(studentUid);

    await subRef.set({
      status: 'compiling_complete',
      attemptsCount: attemptNumber,
      studentUid,
      studentEmail: studentEmail || sourceJob.studentEmail || null,
      isRetroactive: true,
      compiledVideoPath: destinationPath,
      latestAttempt: {
        attemptNumber,
        status: 'compiling_complete',
        compiledVideoPath: destinationPath,
        duration: clipDuration,
        isRetroactive: true,
        finishedAt: new Date(),
      },
      updatedAt: new Date()
    }, { merge: true });

    // 7. Write videoJobs document with transition from pending -> completed to fire triggerAutomaticAnalysis
    const taskJobId = `retro_${taskId}_${studentUid}_att${attemptNumber}`;
    const taskJobRef = firestore.collection('videoJobs').doc(taskJobId);

    await taskJobRef.set({
      jobId: taskJobId,
      classId,
      taskId,
      studentUid,
      studentEmail: studentEmail || sourceJob.studentEmail || null,
      attemptNumber,
      isTaskSubmission: true,
      slicedFromClassVideo: true,
      isRetroactive: true,
      sourceJobId: sourceJob.id,
      status: 'pending',
      videoPath: destinationPath,
      duration: clipDuration,
      size: clipSize,
      createdAt: FieldValue.serverTimestamp(),
    });

    await taskJobRef.update({
      status: 'completed',
      finishedAt: FieldValue.serverTimestamp(),
    });

    return {
      success: true,
      studentUid,
      destinationPath,
      clipDuration,
      clipSize,
      taskJobId,
    };
  } finally {
    try {
      if (fs.existsSync(tempSourcePath)) fs.unlinkSync(tempSourcePath);
    } catch {}
    try {
      if (fs.existsSync(tempClipPath)) fs.unlinkSync(tempClipPath);
    } catch {}
  }
}

/**
 * Evaluates candidate videoJobs and extracts retroactive task submissions for students.
 */
export async function executeExtractRetroactiveTaskSubmissions({
  classId,
  taskId,
  windowType = 'relative_offset',
  startOffsetSeconds = 0,
  endOffsetSeconds,
  startTime,
  endTime,
  lessonId = null,
  sessionDate = null,
  studentUids = null,
  attemptNumber = 1,
  auth = null,
  dbInstance = null,
  bucketInstance = null,
}) {
  const firestore = dbInstance || getDb();
  const storageBucket = bucketInstance || getStorageBucket();

  if (!classId || !taskId) {
    throw new HttpsError('invalid-argument', 'Missing required parameters: classId, taskId');
  }

  // 1. Fetch Class and Task Documents
  const classDoc = await firestore.collection('classes').doc(classId).get();
  if (!classDoc.exists) {
    throw new HttpsError('not-found', `Class ${classId} not found.`);
  }
  const classData = classDoc.data() || {};

  const taskDoc = await firestore.collection('classes').doc(classId).collection('tasks').doc(taskId).get();
  if (!taskDoc.exists) {
    throw new HttpsError('not-found', `Task ${taskId} not found in class ${classId}.`);
  }
  const taskData = taskDoc.data() || {};

  // 2. Query completed class videos for this class
  const jobsSnap = await firestore.collection('videoJobs')
    .where('classId', '==', classId)
    .where('status', '==', 'completed')
    .get();

  let candidateJobs = jobsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(j => !j.isTaskSubmission && j.videoPath && j.studentUid);

  if (Array.isArray(studentUids) && studentUids.length > 0) {
    candidateJobs = candidateJobs.filter(j => studentUids.includes(j.studentUid));
  }

  if (lessonId) {
    candidateJobs = candidateJobs.filter(j => j.lessonId === lessonId);
  }

  if (sessionDate) {
    candidateJobs = candidateJobs.filter(j => {
      const d = j.startTime ? new Date(toMs(j.startTime)) : (j.createdAt ? new Date(toMs(j.createdAt)) : null);
      if (!d || isNaN(d.getTime())) return false;
      return d.toISOString().slice(0, 10) === sessionDate;
    });
  }

  if (windowType === 'absolute_time' && startTime && endTime) {
    const taskStartMs = toMs(startTime);
    const taskEndMs = toMs(endTime);
    if (!isNaN(taskStartMs) && !isNaN(taskEndMs)) {
      candidateJobs = candidateJobs.filter(j => {
        const jStartMs = toMs(j.startTime);
        const jEndMs = toMs(j.endTime);
        if (isNaN(jStartMs) || isNaN(jEndMs)) return false;
        return jStartMs <= taskEndMs && jEndMs >= taskStartMs;
      });
    }
  }

  // De-duplicate by studentUid, preferring the longest recording
  const studentJobMap = new Map();
  for (const job of candidateJobs) {
    const existing = studentJobMap.get(job.studentUid);
    if (!existing || (job.duration || 0) > (existing.duration || 0)) {
      studentJobMap.set(job.studentUid, job);
    }
  }

  const results = [];
  const processedStudentUids = new Set();

  for (const [studentUid, job] of studentJobMap.entries()) {
    processedStudentUids.add(studentUid);
    try {
      let startSec = 0;
      let durSec = 1;

      if (windowType === 'absolute_time' && startTime && endTime) {
        const studentStartMs = toMs(job.startTime);
        const taskStartMs = toMs(startTime);
        const taskEndMs = toMs(endTime);
        const captureInterval = job.captureInterval || 15;
        const targetFrameRate = job.targetFrameRate || (1 / captureInterval);

        const realOffsetSec = Math.max(0, Math.floor((taskStartMs - studentStartMs) / 1000));
        const realWindowSec = Math.max(1, Math.ceil((taskEndMs - taskStartMs) / 1000));

        // If targetFrameRate == 1 FPS (timelapse mode), video time = real time / captureInterval
        // If targetFrameRate == 1 / captureInterval (real-time playback mode), video time = real time
        const isTimelapseOneFps = Math.abs(targetFrameRate - 1) < 0.05 && captureInterval > 1;
        startSec = isTimelapseOneFps ? Math.floor(realOffsetSec / captureInterval) : realOffsetSec;
        durSec = isTimelapseOneFps ? Math.ceil(realWindowSec / captureInterval) : realWindowSec;
      } else {
        startSec = Math.max(0, Number(startOffsetSeconds) || 0);
        const availableDuration = job.duration || 3600;
        const endSec = typeof endOffsetSeconds === 'number' && endOffsetSeconds > startSec
          ? endOffsetSeconds
          : availableDuration;
        durSec = Math.max(1, Math.min(endSec - startSec, availableDuration - startSec));
      }

      console.log(`[extractRetroactiveTaskSubmissions] Slicing student ${studentUid} from job ${job.id}: startSec=${startSec}, durSec=${durSec}`);

      const sliceResult = await sliceStudentClassVideo({
        classId,
        taskId,
        studentUid,
        studentEmail: job.studentEmail,
        sourceJob: job,
        startSec,
        durSec,
        attemptNumber,
        bucket: storageBucket,
        dbInstance: firestore,
      });

      results.push(sliceResult);
    } catch (studentErr) {
      console.error(`[extractRetroactiveTaskSubmissions] Error processing student ${studentUid}:`, studentErr);
      results.push({
        success: false,
        studentUid,
        error: studentErr.message || String(studentErr),
      });
    }
  }

  // Handle enrolled students who were absent or have no class video
  const enrolledStudents = Array.isArray(classData.students) ? classData.students : [];
  let absentCount = 0;

  for (const enrolled of enrolledStudents) {
    const studentUid = typeof enrolled === 'string' ? enrolled : (enrolled?.uid || enrolled?.id);
    if (!studentUid || processedStudentUids.has(studentUid)) continue;
    if (Array.isArray(studentUids) && !studentUids.includes(studentUid)) continue;

    absentCount++;
    try {
      const subRef = firestore.collection('classes').doc(classId)
        .collection('tasks').doc(taskId)
        .collection('submissions').doc(studentUid);

      const existingSub = await subRef.get();
      if (!existingSub.exists || existingSub.data()?.status === 'missing') {
        await subRef.set({
          status: 'missing',
          studentUid,
          studentEmail: typeof enrolled === 'object' ? (enrolled.email || null) : null,
          isRetroactive: true,
          absent: true,
          reason: 'No completed class video recording found for this session.',
          updatedAt: new Date(),
        }, { merge: true });
      }
    } catch (absentErr) {
      console.warn(`[extractRetroactiveTaskSubmissions] Failed to record absent submission for ${studentUid}:`, absentErr);
    }
  }

  return {
    success: true,
    classId,
    taskId,
    totalCandidates: studentJobMap.size,
    processedCount: results.filter(r => r.success).length,
    failedCount: results.filter(r => !r.success).length,
    absentCount,
    results,
  };
}

/**
 * Callable Cloud Function: extractRetroactiveTaskSubmissions
 * Callable by instructors to slice and grade retroactive task submissions from completed class videos.
 */
export const extractRetroactiveTaskSubmissions = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    memory: '4GiB',
    timeoutSeconds: 540,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'User must be authenticated.');
    }

    const { classId, taskId, ...options } = request.data || {};
    if (!classId || !taskId) {
      throw new HttpsError('invalid-argument', 'Missing classId or taskId.');
    }

    // Role check: verify caller is teacher or admin
    const callerUid = request.auth.uid;
    const callerEmail = request.auth.token?.email;
    const isTeacher = request.auth.token?.role === 'teacher' ||
      (callerEmail && callerEmail.endsWith('@vtc.edu.hk'));

    if (!isTeacher) {
      // Check if caller is listed in teacherProfiles
      const teacherProfileDoc = await getDb().collection('teacherProfiles').doc(callerUid).get();
      if (!teacherProfileDoc.exists) {
        throw new HttpsError('permission-denied', 'Only teachers can extract retroactive task submissions.');
      }
    }

    return executeExtractRetroactiveTaskSubmissions({
      classId,
      taskId,
      ...options,
      auth: request.auth,
    });
  }
);
