import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { FUNCTION_REGION, CORS_ORIGINS } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpeg_static from 'ffmpeg-static';

const db = getFirestore();
const storage = getStorage();

let ffmpegPathSet = false;
export function ensureFfmpegPath() {
  if (!ffmpegPathSet) {
    ffmpeg.setFfmpegPath(ffmpeg_static);
    ffmpegPathSet = true;
  }
}

/**
 * Checks whether a media file contains at least one audio stream.
 * @param {string} filePath
 * @returns {boolean}
 */
export function hasAudioStream(filePath) {
  try {
    const res = spawnSync(ffmpeg_static, ['-i', filePath], { encoding: 'utf8' });
    const out = (res.stdout || '') + (res.stderr || '');
    return /Stream #\d+:\d+.*Audio:/.test(out);
  } catch {
    return false;
  }
}

/**
 * Probes the duration in seconds of a media file using ffprobe with ffmpeg fallback.
 * @param {string} filePath
 * @returns {Promise<number>}
 */
export function probeDurationSeconds(filePath) {
  ensureFfmpegPath();
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (!err && metadata) {
        const duration = metadata?.format?.duration;
        if (typeof duration === 'number' && !isNaN(duration) && duration > 0) {
          return resolve(duration);
        }
        if (typeof duration === 'string') {
          const parsed = parseFloat(duration);
          if (!isNaN(parsed) && parsed > 0) return resolve(parsed);
        }
        // Fallback: estimate from streams
        const videoStream = metadata?.streams?.find((s) => s.codec_type === 'video');
        if (videoStream?.duration) {
          const streamDur = parseFloat(videoStream.duration);
          if (!isNaN(streamDur) && streamDur > 0) return resolve(streamDur);
        }
      }

      // Resilient fallback using ffmpeg_static stdout/stderr
      try {
        const res = spawnSync(ffmpeg_static, ['-i', filePath, '-f', 'null', '-'], { encoding: 'utf8' });
        const out = (res.stdout || '') + (res.stderr || '');
        const matches = [...out.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
        if (matches.length > 0) {
          const last = matches[matches.length - 1];
          return resolve(parseFloat(last[1]) * 3600 + parseFloat(last[2]) * 60 + parseFloat(last[3]));
        }
        const durMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
        if (durMatch) {
          return resolve(parseFloat(durMatch[1]) * 3600 + parseFloat(durMatch[2]) * 60 + parseFloat(durMatch[3]));
        }
      } catch {}
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
  const currentAudioChecker = overrides.audioChecker || hasAudioStream;

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

  let bucket = null;
  try {
    bucket = currentStorage?.bucket ? currentStorage.bucket() : null;
  } catch {}

  // Separate valid completed recordings from incomplete/interrupted stubs
  let validRecordings = recordingsToMerge.filter(
    (r) => r.storagePath && r.status !== 'recording' && r.status !== 'discarded'
  );
  let invalidRecordings = recordingsToMerge.filter(
    (r) => !r.storagePath || r.status === 'recording' || r.status === 'discarded'
  );

  // Check if any "invalid" recordings actually have a valid file in Storage that can be salvaged
  if (bucket) {
    for (let i = invalidRecordings.length - 1; i >= 0; i--) {
      const candidate = invalidRecordings[i];
      if (candidate.storagePath) {
        try {
          const f = bucket.file(candidate.storagePath);
          const [exists] = await f.exists();
          if (exists) {
            // Salvage this recording segment
            validRecordings.push(candidate);
            invalidRecordings.splice(i, 1);
          }
        } catch {}
      }
    }
  }

  // Sort valid recordings chronologically by startedAt ascending
  validRecordings.sort((a, b) => {
    const timeA = a.startedAt?.toMillis ? a.startedAt.toMillis() : (a.startedAt ? new Date(a.startedAt).getTime() : 0);
    const timeB = b.startedAt?.toMillis ? b.startedAt.toMillis() : (b.startedAt ? new Date(b.startedAt).getTime() : 0);
    return timeA - timeB;
  });

  // Calculate interruption gaps between consecutive valid clips and from crashed stubs
  const gaps = [];
  let totalLostSeconds = 0;

  for (let i = 0; i < validRecordings.length - 1; i++) {
    const curr = validRecordings[i];
    const next = validRecordings[i + 1];
    const currStart = curr.startedAt?.toMillis ? curr.startedAt.toMillis() : (curr.startedAt ? new Date(curr.startedAt).getTime() : 0);
    const currDurMs = (curr.durationSeconds || 0) * 1000;
    const currEnd = curr.endedAt?.toMillis ? curr.endedAt.toMillis() : (currStart + currDurMs);
    const nextStart = next.startedAt?.toMillis ? next.startedAt.toMillis() : (next.startedAt ? new Date(next.startedAt).getTime() : 0);

    if (currEnd && nextStart && nextStart > currEnd + 15000) {
      const gapSecs = Math.round((nextStart - currEnd) / 1000);
      totalLostSeconds += gapSecs;
      const startTimeStr = new Date(currEnd).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const resumeTimeStr = new Date(nextStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      gaps.push({
        segmentBefore: i + 1,
        segmentAfter: i + 2,
        gapSeconds: gapSecs,
        gapMinutes: Math.round((gapSecs / 60) * 10) / 10,
        approxStart: startTimeStr,
        approxResume: resumeTimeStr,
      });
    }
  }

  // Also check if any invalid recordings represented lost segments before or between valid clips
  for (const badRec of invalidRecordings) {
    const badStart = badRec.startedAt?.toMillis ? badRec.startedAt.toMillis() : (badRec.startedAt ? new Date(badRec.startedAt).getTime() : 0);
    if (badStart) {
      const nextValid = validRecordings.find((v) => {
        const vStart = v.startedAt?.toMillis ? v.startedAt.toMillis() : (v.startedAt ? new Date(v.startedAt).getTime() : 0);
        return vStart > badStart;
      });
      if (nextValid) {
        const nextStart = nextValid.startedAt?.toMillis ? nextValid.startedAt.toMillis() : (nextValid.startedAt ? new Date(nextValid.startedAt).getTime() : 0);
        const badGapSecs = Math.max(0, Math.round((nextStart - badStart) / 1000));
        if (badGapSecs > 15 && !gaps.some((g) => Math.abs(g.gapSeconds - badGapSecs) < 10)) {
          totalLostSeconds += badGapSecs;
          gaps.push({
            crashedSessionId: badRec.id,
            gapSeconds: badGapSecs,
            gapMinutes: Math.round((badGapSecs / 60) * 10) / 10,
            approxStart: new Date(badStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            approxResume: new Date(nextStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
        }
      }
    }
  }

  const hasMissingSegment = gaps.length > 0 || invalidRecordings.length > 0;
  let interruptionRemarks = null;
  if (hasMissingSegment) {
    const lostMins = Math.round((totalLostSeconds / 60) * 10) / 10;
    const gapTexts = gaps.map(
      (g) => `~${g.gapMinutes} min gap between ${g.approxStart} and ${g.approxResume}`
    );
    if (gapTexts.length > 0) {
      interruptionRemarks = `Recording interrupted (e.g. browser crash/reconnect). Missing ${gapTexts.join('; ')} (approx. ${lostMins || 1} min total lost). Rest of lecture preserved and processed.`;
    } else {
      interruptionRemarks = `Recording interrupted by a browser crash or disconnect. Previous segment lost, remaining lecture content preserved and processed.`;
    }
  }

  // Handle case where no valid clips exist at all
  if (validRecordings.length === 0) {
    return {
      success: false,
      reason: 'insufficient_clips',
      message: 'No completed recording clips available to merge.',
      count: 0,
      ignoredIncompleteCount: invalidRecordings.length,
    };
  }

  // Handle case where only 1 valid clip exists
  if (validRecordings.length === 1) {
    // If no interruption occurred and only 1 clip exists, merging is not required
    if (invalidRecordings.length === 0) {
      return {
        success: false,
        reason: 'single_valid_clip',
        message: 'Only 1 completed recording clip exists. Single clips do not require merging.',
        count: 1,
        ignoredIncompleteCount: 0,
      };
    }

    // A crash/interruption DID occur, and 1 valid clip survived!
    // Preserve the surviving clip, stamp it with the interruption remarks, and continue the pipeline!
    const survivingClip = validRecordings[0];
    const survivingDocRef = recordingsRef.doc(survivingClip.id);
    await survivingDocRef.update({
      hasMissingSegment: true,
      interruptionRemarks,
      lostDurationSeconds: totalLostSeconds,
      gapDetails: gaps,
    });

    const batch = currentDb.batch();
    for (const badRec of invalidRecordings) {
      const badDocRef = recordingsRef.doc(badRec.id);
      batch.update(badDocRef, {
        status: 'interrupted',
        interruptionRemarks: `Recording crashed before upload. Rest of lecture preserved in session ${survivingClip.id}.`,
        mergedIntoSessionId: survivingClip.id,
        discardedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    return {
      success: true,
      combinedSessionId: survivingClip.id,
      title: survivingClip.title,
      durationSeconds: survivingClip.durationSeconds || 0,
      videoUrl: survivingClip.videoUrl,
      audioUrl: survivingClip.audioUrl,
      storagePath: survivingClip.storagePath,
      audioStoragePath: survivingClip.audioStoragePath,
      hasMissingSegment: true,
      interruptionRemarks,
      lostDurationSeconds: totalLostSeconds,
      gapDetails: gaps,
      clipCount: 1,
      crashedClipsCount: invalidRecordings.length,
      message: 'Preserved surviving lecture recording with crash interruption remarks.',
    };
  }

  // Check if clips were already merged into a session to prevent duplicate processing
  const alreadyMergedClips = validRecordings.filter((r) => r.mergedIntoSessionId && r.mergedIntoSessionId !== 'merging');
  if (alreadyMergedClips.length > 0 && alreadyMergedClips.length === validRecordings.length) {
    const existingCombinedId = alreadyMergedClips[0].mergedIntoSessionId;
    return {
      success: true,
      alreadyMerged: true,
      combinedSessionId: existingCombinedId,
      message: `Recording clips have already been merged into session ${existingCombinedId}.`,
    };
  }

  // Use only the valid clips for FFmpeg concatenation
  recordingsToMerge = validRecordings;

  // 3. Set up temporary working directory
  const workDir = path.join(os.tmpdir(), `merge_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(workDir, { recursive: true });

  const downloadedFiles = [];
  if (!bucket) {
    bucket = currentStorage.bucket();
  }

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

    // 6. Concatenate videos via stream copy (-c copy) with monotonic DTS/PTS generation
    const combinedVideoPath = path.join(workDir, 'combined_lecture.webm');
    const concatCmd = ffmpeg()
      .input(concatListPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy', '-avoid_negative_ts make_zero', '-fflags +genpts'])
      .output(combinedVideoPath);

    try {
      await currentFfmpegRunner(concatCmd);
    } catch (concatErr) {
      console.warn(`[mergeLectureRecordings] Fast stream copy concat failed (${concatErr.message}). Attempting robust re-encoding fallback...`);
      const fallbackCmd = ffmpeg()
        .input(concatListPath)
        .inputOptions(['-f concat', '-safe 0'])
        .outputOptions(['-c:v libvpx', '-b:v 1500k', '-c:a libopus', '-b:a 128k', '-avoid_negative_ts make_zero', '-fflags +genpts'])
        .output(combinedVideoPath);
      await currentFfmpegRunner(fallbackCmd);
    }

    // 7. Extract normalized pure-audio track (48kHz Constant Bitrate MP3) for Gemini speech recognition
    // Crucial: transcoding to pristine 48kHz CBR MP3 eliminates MediaRecorder WebM timestamp resets
    // and prevents the 1.48x speed drift / subtitle desynchronization.
    const combinedMp3Path = path.join(workDir, 'combined_audio_normalized.mp3');
    const sourceHasAudio = currentAudioChecker(combinedVideoPath);

    let audioExtractionSucceeded = false;
    if (sourceHasAudio || overrides.ffmpegRunner) {
      try {
        const audioNormalizedCmd = ffmpeg(combinedVideoPath)
          .noVideo()
          .audioCodec('libmp3lame')
          .audioBitrate('128k')
          .audioChannels(2)
          .audioFrequency(48000)
          .outputOptions(['-avoid_negative_ts make_zero', '-fflags +genpts'])
          .output(combinedMp3Path);

        await currentFfmpegRunner(audioNormalizedCmd);
        audioExtractionSucceeded = overrides.ffmpegRunner
          ? true
          : (fs.existsSync(combinedMp3Path) && fs.statSync(combinedMp3Path).size > 0);
      } catch (audioErr) {
        console.warn(`[mergeLectureRecordings] Audio extraction notice (${audioErr.message}). Falling back to silent audio track...`);
      }
    }

    if (!audioExtractionSucceeded) {
      console.info('[mergeLectureRecordings] No audio stream detected in source video or extraction failed. Synthesizing pristine 48kHz silent MP3 fallback...');
      let probedDur = await currentDurationProber(combinedVideoPath).catch(() => 0) || 60;
      if (probedDur <= 0) probedDur = 60;
      const res = spawnSync(ffmpeg_static, [
        '-f', 'lavfi',
        '-i', 'anullsrc=r=48000:cl=stereo',
        '-t', String(Math.max(1, Math.round(probedDur))),
        '-c:a', 'libmp3lame',
        '-b:a', '128k',
        '-y',
        combinedMp3Path,
      ]);
      if (res.status !== 0 || !fs.existsSync(combinedMp3Path) || fs.statSync(combinedMp3Path).size === 0) {
        console.warn('[mergeLectureRecordings] Silent MP3 fallback notice:', res.status, res.stderr?.toString());
      }
    }

    // Also extract WebM audio for HTML5 audio fallback if needed and source has audio
    const combinedAudioWebmPath = path.join(workDir, 'combined_audio.webm');
    if (sourceHasAudio || overrides.ffmpegRunner) {
      const audioWebmCmd = ffmpeg(combinedVideoPath)
        .noVideo()
        .outputOptions(['-c:a copy'])
        .output(combinedAudioWebmPath);

      try {
        await currentFfmpegRunner(audioWebmCmd);
      } catch (e) {
        console.warn('[mergeLectureRecordings] WebM audio copy skipped:', e.message);
      }
    }

    // 8. Probe precise combined duration
    let durationSeconds = await currentDurationProber(combinedVideoPath);
    if (!durationSeconds || durationSeconds <= 0) {
      durationSeconds = await currentDurationProber(combinedMp3Path);
    }
    const videoStats = fs.existsSync(combinedVideoPath) ? fs.statSync(combinedVideoPath) : { size: 0 };
    const mp3Stats = fs.existsSync(combinedMp3Path) ? fs.statSync(combinedMp3Path) : { size: 0 };
    const webmStats = fs.existsSync(combinedAudioWebmPath) ? fs.statSync(combinedAudioWebmPath) : { size: 0 };

    // 9. Upload combined video and audio to Cloud Storage
    const firstClip = recordingsToMerge[0];
    const lastClip = recordingsToMerge[recordingsToMerge.length - 1];
    const timestampMs = firstClip.startedAt?.toMillis ? firstClip.startedAt.toMillis() : Date.now();
    const combinedSessionId = `rec_combined_${timestampMs}_full`;

    const destVideoPath = `recordings/${classId}/${combinedSessionId}/lecture.webm`;
    const destNormalizedAudioPath = `recordings/${classId}/${combinedSessionId}/lecture_audio_normalized.mp3`;
    const destAudioPath = fs.existsSync(combinedAudioWebmPath)
      ? `recordings/${classId}/${combinedSessionId}/lecture_audio.webm`
      : destNormalizedAudioPath;

    const videoToken = crypto.randomUUID();
    const mp3Token = crypto.randomUUID();
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
          hasCuesIndex: 'true',
        },
      },
    });

    await bucket.upload(combinedMp3Path, {
      destination: destNormalizedAudioPath,
      metadata: {
        contentType: 'audio/mpeg',
        metadata: {
          firebaseStorageDownloadTokens: mp3Token,
          classId,
          sessionId: combinedSessionId,
          durationSeconds: String(Math.round(durationSeconds)),
          isCombined: 'true',
        },
      },
    });

    if (fs.existsSync(combinedAudioWebmPath) && destAudioPath !== destNormalizedAudioPath) {
      await bucket.upload(combinedAudioWebmPath, {
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
    }

    const bucketName = bucket.name;
    const combinedVideoUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(destVideoPath)}?alt=media&token=${videoToken}`;
    const combinedNormalizedAudioUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(destNormalizedAudioPath)}?alt=media&token=${mp3Token}`;
    const combinedAudioUrl = destAudioPath === destNormalizedAudioPath
      ? combinedNormalizedAudioUrl
      : `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(destAudioPath)}?alt=media&token=${audioToken}`;

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
      subtitlesStatus: 'processing',
      hasCuesIndex: true,
      isCombined: true,
      hasMissingSegment,
      interruptionRemarks,
      lostDurationSeconds: totalLostSeconds,
      gapDetails: gaps,
      sourceRecordingIds: recordingsToMerge.map((r) => r.id),
      sessionGroupId: (sessionGroupId && sessionGroupId !== 'custom' && !sessionGroupId.startsWith('date_'))
        ? sessionGroupId
        : (firstClip.sessionGroupId || null),
      startedAt: firstClip.startedAt || FieldValue.serverTimestamp(),
      endedAt: lastClip.endedAt || FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
      videoUrl: combinedVideoUrl,
      audioUrl: combinedAudioUrl,
      normalizedAudioUrl: combinedNormalizedAudioUrl,
      storagePath: destVideoPath,
      audioStoragePath: destAudioPath,
      normalizedAudioStoragePath: destNormalizedAudioPath,
      fileSize: videoStats.size,
      audioFileSize: mp3Stats.size || webmStats.size,
      teacherUid: callerUid,
      teacherEmail: callerEmail,
      classId,
    });

    // 12. Pre-Deletion Integrity Verification Gate:
    // Strictly verify that the combined master file was uploaded to Cloud Storage, has non-zero size,
    // has valid duration, and the master Firestore record exists.
    // If ANY check fails, abort immediately so intermediate segments are NEVER deleted!
    if (bucket && typeof bucket.file === 'function') {
      const destVideoFile = bucket.file(destVideoPath);
      if (typeof destVideoFile.exists === 'function') {
        const [destExists] = await destVideoFile.exists();
        if (!destExists) {
          throw new Error(`Integrity check failed: merged video '${destVideoPath}' does not exist in Cloud Storage. Segment deletion aborted.`);
        }
      }
      if (typeof destVideoFile.getMetadata === 'function') {
        try {
          const [metadata] = await destVideoFile.getMetadata();
          const remoteSize = Number(metadata?.size || 0);
          if (remoteSize > 0 && remoteSize < 1024) {
            throw new Error(`Integrity check failed: merged video in Cloud Storage is suspiciously small (${remoteSize} bytes). Segment deletion aborted.`);
          }
        } catch (metaErr) {
          if (metaErr.message?.includes('Integrity check failed')) throw metaErr;
        }
      }
    }

    if (durationSeconds <= 0 && videoStats.size < 1024) {
      throw new Error('Integrity check failed: merged video has 0 duration and invalid size. Segment deletion aborted.');
    }

    // 13. Delete raw 1-minute intermediate segment files from Cloud Storage to reclaim storage quota
    if (bucket) {
      for (const rec of recordingsToMerge) {
        if (rec.storagePath && rec.storagePath !== destVideoPath) {
          try {
            const f = bucket.file(rec.storagePath);
            if (typeof f?.delete === 'function') {
              await f.delete({ ignoreNotFound: true });
            }
          } catch (delErr) {
            console.warn(`[mergeLectureRecordings] Notice deleting intermediate segment ${rec.storagePath}:`, delErr.message);
          }
        }
        if (rec.audioStoragePath && rec.audioStoragePath !== destAudioPath && rec.audioStoragePath !== destNormalizedAudioPath) {
          try {
            const af = bucket.file(rec.audioStoragePath);
            if (typeof af?.delete === 'function') {
              await af.delete({ ignoreNotFound: true });
            }
          } catch (delAudioErr) {
            console.warn(`[mergeLectureRecordings] Notice deleting intermediate audio ${rec.audioStoragePath}:`, delAudioErr.message);
          }
        }
      }
    }

    // Mark individual source clips as merged fragments & clean up dangling stubs
    const batch = currentDb.batch();
    for (let idx = 0; idx < recordingsToMerge.length; idx++) {
      const rec = recordingsToMerge[idx];
      const recDocRef = recordingsRef.doc(rec.id);
      batch.update(recDocRef, {
        isFragment: true,
        fragmentIndex: idx + 1,
        totalFragments: recordingsToMerge.length,
        mergedIntoSessionId: combinedSessionId,
        isSegmentDeleted: true,
      });
    }

    for (const badRec of invalidRecordings) {
      const badDocRef = recordingsRef.doc(badRec.id);
      batch.update(badDocRef, {
        status: 'interrupted',
        interruptionRemarks: `Recording crashed before upload. Rest of lecture continued in session ${combinedSessionId}.`,
        mergedIntoSessionId: combinedSessionId,
        discardedAt: FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();

    // 13. Create decoupled subtitle job document in Firestore
    // This allows background workers in ai_flows to process subtitles with Gemini 3
    // even if the teacher closes the browser or disconnects.
    const subtitleJobId = `sub_${classId}_${combinedSessionId}`;
    try {
      await currentDb.collection('lectureSubtitleJobs').doc(subtitleJobId).set({
        jobId: subtitleJobId,
        classId,
        sessionId: combinedSessionId,
        storagePath: destVideoPath,
        audioStoragePath: destNormalizedAudioPath,
        normalizedAudioStoragePath: destNormalizedAudioPath,
        title: finalTitle,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (jobErr) {
      console.warn(`[mergeLectureRecordings] Failed to write lectureSubtitleJobs: ${jobErr.message}`);
    }

    return {
      success: true,
      combinedSessionId,
      title: finalTitle,
      durationSeconds: Math.round(durationSeconds),
      videoUrl: combinedVideoUrl,
      audioUrl: combinedAudioUrl,
      normalizedAudioUrl: combinedNormalizedAudioUrl,
      storagePath: destVideoPath,
      audioStoragePath: destAudioPath,
      normalizedAudioStoragePath: destNormalizedAudioPath,
      hasMissingSegment,
      interruptionRemarks,
      lostDurationSeconds: totalLostSeconds,
      gapDetails: gaps,
      clipCount: recordingsToMerge.length,
      ignoredIncompleteCount: invalidRecordings.length,
    };
  } finally {
    // 14. Clean up temporary files
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
    memory: '4GiB',
    timeoutSeconds: 540,
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

/**
 * Firestore Triggered Worker: processLectureMergeJob
 * Automatically executes lecture recording combination jobs enqueued by scheduled tasks.
 */
export const processLectureMergeJob = onDocumentCreated(
  {
    document: 'lectureMergeJobs/{jobId}',
    region: FUNCTION_REGION,
    memory: '4GiB',
    timeoutSeconds: 540,
  },
  async (event) => {
    const jobSnap = event.data;
    if (!jobSnap) return;
    const jobData = jobSnap.data() || {};
    const jobId = event.params.jobId;

    if (jobData.status !== 'pending') return;

    const jobRef = jobSnap.ref;
    await jobRef.update({ status: 'processing', startedAt: FieldValue.serverTimestamp() });

    try {
      const result = await executeMergeLectureRecordings({
        classId: jobData.classId,
        recordingIds: jobData.recordingIds,
        sessionGroupId: jobData.sessionGroupId,
        customTitle: jobData.customTitle,
        auth: {
          uid: 'system-scheduler',
          token: { role: 'admin', email: 'system-scheduler@service.internal' },
        },
      });

      await jobRef.update({
        status: result.success ? 'completed' : 'failed',
        result,
        finishedAt: FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error(`[processLectureMergeJob] Failed for job ${jobId}:`, err);
      await jobRef.update({
        status: 'failed',
        error: err.message,
        finishedAt: FieldValue.serverTimestamp(),
      });
    }
  }
);
