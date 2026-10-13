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

  if (auth === null) {
    throw new HttpsError('unauthenticated', 'User must be authenticated to merge student session audio.');
  }

  // 1. Verify caller authorization if called externally via onCall
  let callerUid = 'system';
  if (auth && !auth.isSystem && auth.uid !== 'system') {
    callerUid = auth.uid;
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
  }

  // 2. Resolve start and end timestamps
  const startMs = startTime ? (startTime.toDate ? startTime.toDate().getTime() : (startTime._seconds ? startTime._seconds * 1000 : new Date(startTime).getTime())) : 0;
  const endMs = endTime ? (endTime.toDate ? endTime.toDate().getTime() : (endTime._seconds ? endTime._seconds * 1000 : new Date(endTime).getTime())) : Date.now();

  const startDate = new Date(startMs);
  const endDate = new Date(endMs);

  // 3. Query audio clips for this student and class (avoid composite index error by filtering/sorting in JS)
  const snap = await currentDb.collection('audio')
    .where('classId', '==', classId)
    .where('studentUid', '==', studentUid)
    .get();

  const allDocs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Filter by session time window in JS if specified
  const filteredDocs = allDocs.filter(d => {
    if (!d.timestamp) return true;
    const docTime = d.timestamp.toDate ? d.timestamp.toDate().getTime() : (d.timestamp._seconds ? d.timestamp._seconds * 1000 : new Date(d.timestamp).getTime());
    if (startMs > 0 && docTime < startMs) return false;
    if (endMs > 0 && docTime > endMs) return false;
    return true;
  });

  // Sort chronologically ascending
  filteredDocs.sort((a, b) => {
    const tA = a.timestamp?.toDate ? a.timestamp.toDate().getTime() : (a.timestamp?._seconds ? a.timestamp._seconds * 1000 : new Date(a.timestamp || 0).getTime());
    const tB = b.timestamp?.toDate ? b.timestamp.toDate().getTime() : (b.timestamp?._seconds ? b.timestamp._seconds * 1000 : new Date(b.timestamp || 0).getTime());
    return tA - tB;
  });

  // Deduplicate records pointing to the same storage path and merge transcripts
  const pathMap = new Map();
  for (const d of filteredDocs) {
    const sPath = d.audioPath || d.storagePath;
    if (!sPath) continue;
    if (!pathMap.has(sPath)) {
      pathMap.set(sPath, {
        audioPath: sPath,
        audioUrl: d.audioUrl,
        transcript: d.transcript,
        duration: d.duration,
        timestamp: d.timestamp,
      });
    } else {
      const existing = pathMap.get(sPath);
      if (!existing.transcript && d.transcript) existing.transcript = d.transcript;
      if (!existing.audioUrl && d.audioUrl) existing.audioUrl = d.audioUrl;
    }
  }

  const uniqueClips = Array.from(pathMap.values());

  if (uniqueClips.length === 0) {
    return {
      status: 'no_clips',
      message: 'No speech audio clips found for this student during the selected session.',
      clipCount: 0,
      durationSeconds: 0,
      transcript: null,
    };
  }

  const bucket = currentStorage.bucket();
  const tmpDir = path.join(os.tmpdir(), `student_audio_${classId}_${studentUid}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const downloadedFiles = [];
  const transcripts = [];

  try {
    // 4. Download valid audio chunks and collect transcripts
    for (let i = 0; i < uniqueClips.length; i++) {
      const clip = uniqueClips[i];
      if (clip.transcript && typeof clip.transcript === 'string' && clip.transcript.trim()) {
        transcripts.push(clip.transcript.trim());
      }

      const storagePath = clip.audioPath;
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
        transcript: transcripts.join(' ... ') || null,
      };
    }

    // 5. Concatenate and normalize audio files using FFmpeg
    ensureFfmpegPath();
    const outputFileName = `combined_audio_${Date.now()}.mp3`;
    const localOutputPath = path.join(tmpDir, outputFileName);

    let cmd;
    if (downloadedFiles.length === 1) {
      cmd = ffmpeg(downloadedFiles[0])
        .noVideo()
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(48000)
        .outputOptions(['-avoid_negative_ts make_zero', '-fflags +genpts'])
        .output(localOutputPath);
    } else {
      cmd = ffmpeg();
      downloadedFiles.forEach((file) => {
        cmd.input(file);
      });

      const filterInputs = downloadedFiles.map((_, idx) => `[${idx}:a]`).join('');
      const filterComplex = `${filterInputs}concat=n=${downloadedFiles.length}:v=0:a=1[outa]`;

      cmd
        .complexFilter(filterComplex)
        .outputOptions(['-map [outa]', '-avoid_negative_ts make_zero', '-fflags +genpts'])
        .audioCodec('libmp3lame')
        .audioBitrate('128k')
        .audioChannels(2)
        .audioFrequency(48000)
        .output(localOutputPath);
    }

    await currentFfmpegRunner(cmd);

    const durationSeconds = await currentDurationProber(localOutputPath);

    // 6. Upload combined audio to Cloud Storage
    const effectiveDate = startMs > 0
      ? startDate
      : (uniqueClips[0]?.timestamp ? new Date(uniqueClips[0].timestamp.toDate ? uniqueClips[0].timestamp.toDate() : uniqueClips[0].timestamp) : new Date());
    const dateStr = effectiveDate.toISOString().split('T')[0];
    const destinationPath = `audio/${classId}/${dateStr}/${studentUid}/${outputFileName}`;

    const token = crypto.randomUUID();
    await bucket.upload(localOutputPath, {
      destination: destinationPath,
      metadata: {
        contentType: 'audio/mpeg',
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
    const combinedTranscript = transcripts.length > 0 ? transcripts.join(' ... ') : null;

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
      transcript: combinedTranscript,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
    };
    await combinedAudioRef.set(combinedRecord);

    // 8. Auto-purge routine unflagged raw audio clips from Storage & Firestore once successfully combined
    // (Preserves any clips marked for violation/incident evidence review)
    try {
      const routineDocsToPurge = filteredDocs.filter((d) => {
        const isFlagged = d.isFlagged === true ||
                          d.isViolation === true ||
                          Boolean(d.incidentId) ||
                          d.reviewRequired === true ||
                          d.suspicious === true;
        return !isFlagged;
      });

      if (routineDocsToPurge.length > 0) {
        console.log(`[mergeStudentSessionAudio] Purging ${routineDocsToPurge.length} routine raw audio segments for student ${studentUid} in class ${classId}...`);

        for (const docData of routineDocsToPurge) {
          const sPath = docData.audioPath || docData.storagePath;
          if (sPath && sPath !== destinationPath) {
            try {
              const fileObj = bucket.file(sPath);
              if (fileObj && typeof fileObj.delete === 'function') {
                await fileObj.delete({ ignoreNotFound: true }).catch(() => {});
              }
            } catch (delErr) {
              console.warn(`[mergeStudentSessionAudio] Storage file delete note for ${sPath}:`, delErr.message);
            }
          }
        }

        if (typeof currentDb.batch === 'function') {
          const BATCH_SIZE = 400;
          for (let i = 0; i < routineDocsToPurge.length; i += BATCH_SIZE) {
            const batch = currentDb.batch();
            routineDocsToPurge.slice(i, i + BATCH_SIZE).forEach((d) => {
              if (d.id) batch.delete(currentDb.doc(`audio/${d.id}`));
            });
            await batch.commit();
          }
        }
      }
    } catch (purgeErr) {
      console.warn(`[mergeStudentSessionAudio] Routine raw audio purge note:`, purgeErr.message);
    }

    return {
      status: 'success',
      jobId: combinedAudioRef.id,
      audioUrl,
      audioPath: destinationPath,
      durationSeconds: Math.round(durationSeconds || 0),
      clipCount: downloadedFiles.length,
      transcript: combinedTranscript,
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
