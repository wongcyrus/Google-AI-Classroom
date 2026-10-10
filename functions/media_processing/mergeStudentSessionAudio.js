import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';
import { ensureFfmpegPath, probeDurationSeconds } from './mergeLectureRecordings.js';

const db = getFirestore();
const storage = getStorage();

/**
 * Runs ffmpeg command wrapped in a Promise.
 */
function runFfmpegCommand(cmd) {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve());
    cmd.on('error', (err) => reject(err));
    cmd.run();
  });
}

/**
 * Core execution logic for merging student voice session clips.
 */
export async function executeMergeStudentSessionAudio(
  { classId, studentUid, startTime, endTime, auth },
  overrides = {}
) {
  const currentDb = overrides.db || db;
  const currentStorage = overrides.storage || storage;
  const currentFfmpegRunner = overrides.ffmpegRunner || runFfmpegCommand;
  const currentDurationProber = overrides.durationProber || probeDurationSeconds;

  if (!classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }
  if (!studentUid) {
    throw new HttpsError('invalid-argument', 'studentUid is required.');
  }
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

  // 1. Verify caller authorization (teacher or admin for this class)
  const callerUid = auth.uid;
  const callerEmail = auth.token?.email || '';
  const isGlobalTeacher = auth.token?.role === 'teacher' || auth.token?.role === 'admin';

  const classDocRef = currentDb.doc(`classes/${classId}`);
  const classDoc = await classDocRef.get();
  if (!classDoc.exists) {
    throw new HttpsError('not-found', `Class "${classId}" does not exist.`);
  }

  const classData = classDoc.data() || {};
  const isClassTeacher =
    (classData.teacherEmails && classData.teacherEmails.includes(callerEmail)) ||
    (classData.teachers && (classData.teachers[callerUid] || Object.values(classData.teachers).includes(callerEmail))) ||
    classData.teacherUid === callerUid ||
    classData.teacherEmail === callerEmail;

  if (!isGlobalTeacher && !isClassTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers assigned to this class can merge student audio sessions.');
  }

  // 2. Resolve start and end timestamps
  const startMs = startTime ? (startTime.toDate ? startTime.toDate().getTime() : new Date(startTime).getTime()) : 0;
  const endMs = endTime ? (endTime.toDate ? endTime.toDate().getTime() : new Date(endTime).getTime()) : Date.now();

  const startDate = new Date(startMs);
  const endDate = new Date(endMs);

  // 3. Query audio clips for this student and class
  let audioDocs = [];
  try {
    const snap = await currentDb.collection('audio')
      .where('classId', '==', classId)
      .where('studentUid', '==', studentUid)
      .where('timestamp', '>=', startDate)
      .where('timestamp', '<=', endDate)
      .orderBy('timestamp', 'asc')
      .get();
    audioDocs = snap.docs;
  } catch (err) {
    // In-memory filter fallback if composite index is building
    const snap = await currentDb.collection('audio')
      .where('classId', '==', classId)
      .where('studentUid', '==', studentUid)
      .get();
    audioDocs = snap.docs
      .filter((d) => {
        const dData = d.data() || {};
        const ts = dData.timestamp?.toDate ? dData.timestamp.toDate() : new Date(dData.timestamp);
        const tMs = ts.getTime();
        return !isNaN(tMs) && tMs >= startMs && tMs <= endMs;
      })
      .sort((a, b) => {
        const aTs = a.data()?.timestamp?.toDate ? a.data().timestamp.toDate().getTime() : new Date(a.data()?.timestamp).getTime();
        const bTs = b.data()?.timestamp?.toDate ? b.data().timestamp.toDate().getTime() : new Date(b.data()?.timestamp).getTime();
        return aTs - bTs;
      });
  }

  if (audioDocs.length === 0) {
    return {
      status: 'no_clips',
      message: 'No speech audio clips found for this student during the selected session.',
      clipCount: 0,
      durationSeconds: 0,
    };
  }

  const bucket = currentStorage.bucket();
  const tmpDir = path.join(os.tmpdir(), `student_audio_${classId}_${studentUid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const downloadedFiles = [];

  try {
    // 4. Download valid audio chunks
    for (let i = 0; i < audioDocs.length; i++) {
      const aData = audioDocs[i].data() || {};
      const storagePath = aData.audioPath || aData.storagePath;
      if (!storagePath) continue;

      const ext = path.extname(storagePath) || '.webm';
      const localChunkPath = path.join(tmpDir, `chunk_${String(i).padStart(4, '0')}${ext}`);

      try {
        const fileObj = bucket.file(storagePath);
        const [exists] = await fileObj.exists();
        if (!exists) continue;

        await fileObj.download({ destination: localChunkPath });
        downloadedFiles.push(localChunkPath);
      } catch (dlErr) {
        console.warn(`[mergeStudentSessionAudio] Failed to download clip ${storagePath}:`, dlErr.message);
      }
    }

    if (downloadedFiles.length === 0) {
      return {
        status: 'no_clips',
        message: 'No downloadable speech files found in storage.',
        clipCount: 0,
        durationSeconds: 0,
      };
    }

    // 5. Concatenate audio files using FFmpeg
    ensureFfmpegPath();
    const concatListPath = path.join(tmpDir, 'concat_list.txt');
    const concatFileContent = downloadedFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatListPath, concatFileContent, 'utf8');

    const outputFileName = `combined_audio_${Date.now()}.m4a`;
    const localOutputPath = path.join(tmpDir, outputFileName);

    const cmd = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .audioCodec('aac')
      .audioBitrate('128k')
      .output(localOutputPath);

    await currentFfmpegRunner(cmd);

    const durationSeconds = await currentDurationProber(localOutputPath);

    // 6. Upload combined audio to Cloud Storage
    const dateStr = startDate.toISOString().split('T')[0];
    const destinationPath = `audio/${classId}/${dateStr}/${studentUid}/${outputFileName}`;
    const destinationFile = bucket.file(destinationPath);

    const token = crypto.randomUUID();
    await bucket.upload(localOutputPath, {
      destination: destinationPath,
      metadata: {
        contentType: 'audio/mp4',
        metadata: {
          firebaseStorageDownloadTokens: token,
          classId,
          studentUid,
          isCombinedSessionAudio: 'true',
          clipCount: String(downloadedFiles.length),
        },
      },
    });

    const audioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(destinationPath)}?alt=media&token=${token}`;

    // 7. Save metadata record in Firestore
    const combinedAudioRef = currentDb.collection(`classes/${classId}/combinedAudios`).doc();
    const combinedRecord = {
      id: combinedAudioRef.id,
      classId,
      studentUid,
      startTime: startDate,
      endTime: endDate,
      audioPath: destinationPath,
      audioUrl,
      durationSeconds: Math.round(durationSeconds || 0),
      clipCount: downloadedFiles.length,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
    };
    await combinedAudioRef.set(combinedRecord);

    return {
      status: 'success',
      jobId: combinedAudioRef.id,
      audioUrl,
      audioPath: destinationPath,
      durationSeconds: Math.round(durationSeconds || 0),
      clipCount: downloadedFiles.length,
      message: `Successfully combined ${downloadedFiles.length} voice clip(s) (${Math.round(durationSeconds || 0)}s total).`,
    };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * Callable Cloud Function: mergeStudentSessionAudio
 */
export const mergeStudentSessionAudio = onCall({
  region: FUNCTION_REGION,
  cors: CORS_ORIGINS,
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (request) => {
  return executeMergeStudentSessionAudio({
    classId: request.data?.classId,
    studentUid: request.data?.studentUid,
    startTime: request.data?.startTime,
    endTime: request.data?.endTime,
    auth: request.auth,
  });
});
