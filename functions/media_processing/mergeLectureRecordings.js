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

const db = getFirestore();
const storage = getStorage();

let ffmpegPathSet = false;
function ensureFfmpegPath() {
  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(ffmpeg_static);
    ffmpegPathSet = true;
  }
}

/**
 * Probes the duration in seconds of a media file using ffprobe.
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export function probeDurationSeconds(filePath) {
  ensureFfmpegPath();
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      const duration = metadata?.format?.duration;
      if (typeof duration === 'number' && !isNaN(duration)) {
        return resolve(duration);
      }
      if (typeof duration === 'string') {
        const parsed = parseFloat(duration);
        if (!isNaN(parsed)) return resolve(parsed);
      }
      // Fallback: estimate from streams
      const videoStream = metadata?.streams?.find((s) => s.codec_type === 'video');
      if (videoStream?.duration) {
        const streamDur = parseFloat(videoStream.duration);
        if (!isNaN(streamDur)) return resolve(streamDur);
      }
      resolve(0);
    });
  });
}

/**
 * Runs ffmpeg command wrapped in a Promise.
 * @param {ffmpeg.FfmpegCommand} cmd
 * @returns {Promise<void>}
 */
function runFfmpegCommand(cmd) {
  return new Promise((resolve, reject) => {
    cmd.on('end', () => resolve());
    cmd.on('error', (err) => reject(err));
    cmd.run();
  });
}

/**
 * Core execution logic for merging lecture recordings.
 */
export async function executeMergeLectureRecordings(
  { classId, sessionGroupId, recordingIds, customTitle, auth },
  overrides = {}
) {
  const currentDb = overrides.db || db;
  const currentStorage = overrides.storage || storage;
  const currentDurationProber = overrides.durationProber || probeDurationSeconds;
  const currentFfmpegRunner = overrides.ffmpegRunner || runFfmpegCommand;

  if (!classId) {
    throw new HttpsError('invalid-argument', 'classId is required.');
  }

  // 1. Verify caller authorization (teacher or admin for this class)
  if (!auth) {
    throw new HttpsError('unauthenticated', 'User must be authenticated.');
  }

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
    (classData.teachers && (classData.teachers[callerUid] || Object.values(classData.teachers).includes(callerEmail))) ||
    classData.teacherUid === callerUid ||
    classData.teacherEmail === callerEmail;

  if (!isGlobalTeacher && !isClassTeacher) {
    throw new HttpsError('permission-denied', 'Only teachers of this class can merge lecture recordings.');
  }

  // 2. Fetch target recording documents
  const recordingsRef = currentDb.collection(`classes/${classId}/lectureRecordings`);
  let recordingsToMerge = [];

  if (Array.isArray(recordingIds) && recordingIds.length > 0) {
    // Explicit list of recordings
    const docs = await Promise.all(recordingIds.map((id) => recordingsRef.doc(id).get()));
    recordingsToMerge = docs
      .filter((d) => d.exists)
      .map((d) => ({ id: d.id, ...d.data() }));
  } else if (sessionGroupId) {
    // Query by sessionGroupId
    const snapshot = await recordingsRef
      .where('sessionGroupId', '==', sessionGroupId)
      .get();
    recordingsToMerge = snapshot.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => !r.isCombined); // Don't merge an existing combined lecture into itself
  } else {
    throw new HttpsError('invalid-argument', 'Either recordingIds or sessionGroupId must be specified.');
  }

  if (recordingsToMerge.length < 2) {
    return {
      success: false,
      reason: 'insufficient_clips',
      message: 'At least 2 recording clips are required to merge.',
      count: recordingsToMerge.length,
    };
  }

  // Sort chronologically by startedAt ascending
  recordingsToMerge.sort((a, b) => {
    const timeA = a.startedAt?.toMillis ? a.startedAt.toMillis() : (a.startedAt ? new Date(a.startedAt).getTime() : 0);
    const timeB = b.startedAt?.toMillis ? b.startedAt.toMillis() : (b.startedAt ? new Date(b.startedAt).getTime() : 0);
    return timeA - timeB;
  });

  // Verify all recordings have storage paths
  for (const rec of recordingsToMerge) {
    if (!rec.storagePath) {
      throw new HttpsError('failed-precondition', `Recording "${rec.id}" has no video storage path.`);
    }
  }

  // 3. Set up temporary working directory
  const workDir = path.join(os.tmpdir(), `merge_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(workDir, { recursive: true });

  const bucket = currentStorage.bucket();
  const downloadedFiles = [];

  try {
    ensureFfmpegPath();

    // 4. Download video clips to /tmp
    for (let i = 0; i < recordingsToMerge.length; i++) {
      const rec = recordingsToMerge[i];
      const ext = path.extname(rec.storagePath) || '.webm';
      const localVideoPath = path.join(workDir, `clip_${i}${ext}`);

      await bucket.file(rec.storagePath).download({ destination: localVideoPath });
      downloadedFiles.push(localVideoPath);
    }

    // 5. Generate ffmpeg concat list file
    const concatListPath = path.join(workDir, 'concat_list.txt');
    const concatContent = downloadedFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(concatListPath, concatContent, 'utf-8');

    // 6. Concatenate videos via stream copy (-c copy)
    const combinedVideoPath = path.join(workDir, 'combined_lecture.webm');
    const concatCmd = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .output(combinedVideoPath);

    await currentFfmpegRunner(concatCmd);

    // 7. Extract synchronized pure-audio track for Gemini transcription
    const combinedAudioPath = path.join(workDir, 'combined_audio.webm');
    const audioExtractCmd = ffmpeg(combinedVideoPath)
      .noVideo()
      .outputOptions(['-c:a copy'])
      .output(combinedAudioPath);

    await currentFfmpegRunner(audioExtractCmd);

    // 8. Probe precise combined duration
    const durationSeconds = await currentDurationProber(combinedVideoPath);
    const videoStats = fs.existsSync(combinedVideoPath) ? fs.statSync(combinedVideoPath) : { size: 0 };
    const audioStats = fs.existsSync(combinedAudioPath) ? fs.statSync(combinedAudioPath) : { size: 0 };

    // 9. Upload combined video and audio to Cloud Storage
    const firstClip = recordingsToMerge[0];
    const lastClip = recordingsToMerge[recordingsToMerge.length - 1];
    const timestampMs = firstClip.startedAt?.toMillis ? firstClip.startedAt.toMillis() : Date.now();
    const combinedSessionId = `rec_combined_${timestampMs}_full`;

    const destVideoPath = `recordings/${classId}/${combinedSessionId}/lecture.webm`;
    const destAudioPath = `recordings/${classId}/${combinedSessionId}/lecture_audio.webm`;

    const videoToken = crypto.randomUUID();
    const audioToken = crypto.randomUUID();

    await bucket.upload(combinedVideoPath, {
      destination: destVideoPath,
      metadata: {
        contentType: 'video/webm',
        metadata: {
          firebaseStorageDownloadTokens: videoToken,
          classId,
          sessionId: combinedSessionId,
          durationSeconds: String(Math.round(durationSeconds)),
          isCombined: 'true',
        },
      },
    });

    await bucket.upload(combinedAudioPath, {
      destination: destAudioPath,
      metadata: {
        contentType: 'audio/webm',
        metadata: {
          firebaseStorageDownloadTokens: audioToken,
          classId,
          sessionId: combinedSessionId,
          durationSeconds: String(Math.round(durationSeconds)),
          isCombined: 'true',
        },
      },
    });

    const bucketName = bucket.name;
    const combinedVideoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(destVideoPath)}?alt=media&token=${videoToken}`;
    const combinedAudioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(destAudioPath)}?alt=media&token=${audioToken}`;

    // 10. Format lecture title
    const firstClipDate = firstClip.startedAt?.toDate ? firstClip.startedAt.toDate() : new Date();
    const formattedDate = firstClipDate.toLocaleDateString('en-US');
    const finalTitle = customTitle || `Combined Full Lecture - ${formattedDate}`;

    // 11. Create master combined recording in Firestore
    const combinedDocRef = recordingsRef.doc(combinedSessionId);
    await combinedDocRef.set({
      title: finalTitle,
      durationSeconds: Math.round(durationSeconds),
      status: 'processing_subtitles',
      isCombined: true,
      sourceRecordingIds: recordingsToMerge.map((r) => r.id),
      sessionGroupId: sessionGroupId || firstClip.sessionGroupId || null,
      startedAt: firstClip.startedAt || FieldValue.serverTimestamp(),
      endedAt: lastClip.endedAt || FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      videoUrl: combinedVideoUrl,
      audioUrl: combinedAudioUrl,
      storagePath: destVideoPath,
      audioStoragePath: destAudioPath,
      fileSize: videoStats.size,
      audioFileSize: audioStats.size,
      teacherUid: callerUid,
      teacherEmail: callerEmail,
      classId,
    });

    // 12. Mark individual source clips as merged fragments
    const batch = currentDb.batch();
    for (let idx = 0; idx < recordingsToMerge.length; idx++) {
      const rec = recordingsToMerge[idx];
      const recDocRef = recordingsRef.doc(rec.id);
      batch.update(recDocRef, {
        isFragment: true,
        fragmentIndex: idx + 1,
        totalFragments: recordingsToMerge.length,
        mergedIntoSessionId: combinedSessionId,
      });
    }
    await batch.commit();

    return {
      success: true,
      combinedSessionId,
      title: finalTitle,
      durationSeconds: Math.round(durationSeconds),
      videoUrl: combinedVideoUrl,
      audioUrl: combinedAudioUrl,
      storagePath: destVideoPath,
      audioStoragePath: destAudioPath,
      clipCount: recordingsToMerge.length,
    };
  } finally {
    // 13. Clean up temporary files
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch (cleanupErr) {
      console.warn('Failed to clean up temp workDir:', cleanupErr.message);
    }
  }
}

/**
 * Callable Cloud Function: mergeLectureRecordings
 */
export const mergeLectureRecordings = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    memory: '2GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    return executeMergeLectureRecordings({
      classId: request.data?.classId,
      sessionGroupId: request.data?.sessionGroupId,
      recordingIds: request.data?.recordingIds,
      customTitle: request.data?.customTitle,
      auth: request.auth,
    });
  }
);
