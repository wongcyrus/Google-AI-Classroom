import './firebase.js';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { getStorage } from 'firebase-admin/storage';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { FUNCTION_REGION } from './config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
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
 * Checks if an initial buffer slice contains EBML Matroska index elements:
 * - SeekHead: 0x114D9B74
 * - Cues: 0x1C53BB6B
 * - Duration: 0x4489
 */
export function hasEbmlIndexHeaders(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return false;
  const hasSeekHead = buffer.indexOf(Buffer.from([0x11, 0x4D, 0x9B, 0x74])) !== -1;
  const hasCues = buffer.indexOf(Buffer.from([0x1C, 0x53, 0xBB, 0x6B])) !== -1;
  const hasDuration = buffer.indexOf(Buffer.from([0x44, 0x89])) !== -1;
  return hasSeekHead && hasCues && hasDuration;
}

/**
 * Probes duration of media file in seconds using ffprobe.
 */
export function probeVideoDuration(filePath) {
  ensureFfmpegPath();
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return resolve(0);
      const duration = metadata?.format?.duration;
      if (typeof duration === 'number' && !isNaN(duration)) {
        return resolve(duration);
      }
      if (typeof duration === 'string') {
        const parsed = parseFloat(duration);
        if (!isNaN(parsed)) return resolve(parsed);
      }
      const stream = metadata?.streams?.find((s) => s.codec_type === 'video');
      if (stream?.duration) {
        const sDur = parseFloat(stream.duration);
        if (!isNaN(sDur)) return resolve(sDur);
      }
      resolve(0);
    });
  });
}

/**
 * Runs FFmpeg stream copy (-c copy) to remux WebM and inject SeekHead + Cues + Duration.
 * Pure container remux: 0% re-encoding, 0 quality loss, finishes in ~0.2s - 2s.
 */
export function runFfmpegStreamCopy(inputPath, outputPath) {
  ensureFfmpegPath();
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .outputOptions(['-c copy'])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .run();
  });
}

/**
 * Core business logic to inspect and index an uploaded lecture video.
 * Designed with dependency injection for robust unit testing.
 */
export async function handleLectureVideoFinalized(event, overrides = {}) {
  const currentDb = overrides.db || db;
  const currentStorage = overrides.storage || storage;
  const currentDurationProber = overrides.durationProber || probeVideoDuration;
  const currentFfmpegRunner = overrides.ffmpegRunner || runFfmpegStreamCopy;

  const filePath = event.data?.name || '';
  if (!filePath) {
    return { status: 'skipped', reason: 'empty_file_path' };
  }

  // Strictly match lecture video: recordings/{classId}/{sessionId}/lecture.webm
  const match = filePath.match(/^recordings\/([^/]+)\/([^/]+)\/lecture\.webm$/);
  if (!match) {
    return { status: 'skipped', reason: 'not_a_lecture_webm', filePath };
  }

  // 1. Loop Prevention: if Cloud Storage metadata already has hasCuesIndex === 'true', exit immediately
  const existingMetadata = event.data?.metadata || {};
  if (existingMetadata.hasCuesIndex === 'true') {
    return { status: 'skipped', reason: 'already_indexed_metadata', filePath };
  }

  const [, classId, sessionId] = match;
  const bucketName = event.data?.bucket || currentStorage.app?.options?.storageBucket;
  const bucket = bucketName ? currentStorage.bucket(bucketName) : currentStorage.bucket();
  const fileRef = bucket.file(filePath);

  let tmpInput = null;
  let tmpIndexed = null;

  try {
    const [exists] = await fileRef.exists();
    if (!exists) {
      return { status: 'skipped', reason: 'file_not_found', filePath };
    }

    // Double-check real metadata from Cloud Storage in case event metadata was stale
    const [storageMeta] = await fileRef.getMetadata().catch(() => [{}]);
    if (storageMeta?.metadata?.hasCuesIndex === 'true') {
      return { status: 'skipped', reason: 'already_indexed_storage_metadata', filePath };
    }

    // 2. Download first 1KB to test if container already contains EBML SeekHead + Cues
    let alreadyIndexedInEbml = false;
    try {
      const [headerBuffer] = await fileRef.download({ start: 0, end: 1024 });
      if (hasEbmlIndexHeaders(headerBuffer)) {
        alreadyIndexedInEbml = true;
      }
    } catch {}

    const sessionDocRef = currentDb.doc(`classes/${classId}/lectureRecordings/${sessionId}`);

    if (alreadyIndexedInEbml) {
      // Container already has Cues; simply tag metadata and update Firestore
      await fileRef.setMetadata({
        contentType: 'video/webm',
        metadata: {
          ...(storageMeta?.metadata || {}),
          hasCuesIndex: 'true',
        },
      }).catch(() => {});

      await sessionDocRef.update({
        hasCuesIndex: true,
      }).catch(() => {});

      return { status: 'already_indexed_ebml', filePath };
    }

    // 3. Download raw WebM to local temporary disk
    const tmpDir = os.tmpdir();
    tmpInput = path.join(tmpDir, `trigger_raw_${Date.now()}_${path.basename(filePath)}`);
    tmpIndexed = path.join(tmpDir, `trigger_indexed_${Date.now()}_${path.basename(filePath)}`);

    await fileRef.download({ destination: tmpInput });

    // 4. Remux container with FFmpeg stream copy (-c copy)
    await currentFfmpegRunner(tmpInput, tmpIndexed);

    if (!fs.existsSync(tmpIndexed) || fs.statSync(tmpIndexed).size === 0) {
      throw new Error(`Remuxed video file was empty: ${tmpIndexed}`);
    }

    // 5. Probe accurate duration
    const durationSec = await currentDurationProber(tmpIndexed);

    // 6. Upload remuxed file back to Cloud Storage preserving existing download token
    const token = storageMeta?.metadata?.firebaseStorageDownloadTokens || crypto.randomUUID();
    const updatedCustomMetadata = {
      ...(storageMeta?.metadata || {}),
      hasCuesIndex: 'true',
      durationSeconds: String(Math.round(durationSec || Number(storageMeta?.metadata?.durationSeconds || 0))),
      firebaseStorageDownloadTokens: token,
    };

    await bucket.upload(tmpIndexed, {
      destination: filePath,
      metadata: {
        contentType: 'video/webm',
        metadata: updatedCustomMetadata,
      },
    });

    // 7. Update Firestore recording session document
    const updatePayload = {
      hasCuesIndex: true,
    };
    if (durationSec > 0) {
      updatePayload.durationSeconds = Math.round(durationSec);
    }
    await sessionDocRef.update(updatePayload).catch((err) => {
      console.warn(`[onLectureVideoFinalized] Firestore update non-fatal error: ${err.message}`);
    });

    console.info(`[onLectureVideoFinalized] Successfully indexed WebM for ${filePath} (${durationSec.toFixed(1)}s, ${fs.statSync(tmpIndexed).size} bytes)`);

    return {
      status: 'indexed',
      filePath,
      durationSec,
      fileSize: fs.statSync(tmpIndexed).size,
    };
  } catch (err) {
    console.error(`[onLectureVideoFinalized] Error indexing ${filePath}:`, err);
    throw err;
  } finally {
    if (tmpInput && fs.existsSync(tmpInput)) {
      try { fs.unlinkSync(tmpInput); } catch {}
    }
    if (tmpIndexed && fs.existsSync(tmpIndexed)) {
      try { fs.unlinkSync(tmpIndexed); } catch {}
    }
  }
}

/**
 * Cloud Storage Event Trigger (Gen 2):
 * Automatically fires whenever a file is created or overwritten in Cloud Storage.
 * Filters strictly for `recordings/{classId}/{sessionId}/lecture.webm` and guarantees
 * every uploaded lecture recording has Matroska SeekHead and Cues indexed in seconds,
 * completely decoupled from browser connection or subtitle generation flows.
 */
export const onLectureVideoFinalized = onObjectFinalized(
  {
    bucket: process.env.STORAGE_BUCKET_NAME || `${process.env.GCLOUD_PROJECT || 'it114115-2627'}.firebasestorage.app`,
    region: FUNCTION_REGION,
    memory: '2GiB',
    timeoutSeconds: 300,
    maxInstances: 20,
  },
  async (event) => {
    return await handleLectureVideoFinalized(event);
  }
);
