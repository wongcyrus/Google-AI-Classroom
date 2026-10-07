import { useState, useRef, useCallback, useEffect } from 'react';
import { db, storage, functions } from '../firebase-config';
import { collection, doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import fixWebmDuration from 'fix-webm-duration';
import { resolveSessionGroupId } from '../utils/sessionGrouping';
import {
  persistRecoveryChunk,
  getPendingRecoverySessions,
  clearRecoverySession,
  persistPendingSegment,
  getPendingSegments,
  clearPendingSegment,
} from '../utils/lectureRecoveryDb';

/**
 * Injects missing EBML container duration headers into WebM blobs recorded by MediaRecorder.
 * This fixes the Chromium streaming issue where HTML5 video player reports duration < 1 min
 * and prematurely fires 'ended' event while Google Drive displays the full 35+ mins.
 */
export async function injectWebmDuration(blob, durationMs) {
  if (!blob || !durationMs || durationMs <= 0) return blob;
  try {
    const fn = typeof fixWebmDuration === 'function' ? fixWebmDuration : fixWebmDuration?.default;
    if (typeof fn === 'function' && typeof FileReader !== 'undefined') {
      const fixPromise = fn(blob, durationMs, { logger: false });
      const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(blob), 30000));
      return await Promise.race([fixPromise, timeoutPromise]);
    }
  } catch (err) {
    console.warn('[useLectureRecorder] fixWebmDuration failed, falling back to raw blob:', err);
  }
  return blob;
}

/**
 * Supported MIME types in priority order.
 * YouTube natively accepts WebM (VP9/Opus) and MP4 (H.264/AAC).
 */
export function getSupportedMimeType() {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return 'video/webm; codecs=vp9,opus';
  }
  const candidates = [
    'video/webm; codecs=vp9,opus',
    'video/webm; codecs=vp8,opus',
    'video/mp4; codecs=avc1,mp4a',
    'video/webm',
    'video/mp4',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Supported Audio-only MIME types in priority order.
 * Used for the parallel pure-audio recording stream for fast Gemini audio processing.
 */
export function getSupportedAudioMimeType() {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return 'audio/webm; codecs=opus';
  }
  const candidates = [
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/mp4',
  ];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Format duration in seconds to HH:MM:SS.
 */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const DEFAULT_SEGMENT_DURATION_SECONDS = 60; // 1-minute rolling segments
export const DEFAULT_MAX_RECORDING_SECONDS = 3 * 60 * 60; // 3 hours safety auto-stop limit

/**
 * Hook to manage high-definition lecture screen + microphone recording
 * with 1-minute rolling segments, offline-resilient IndexedDB queueing,
 * automatic reconnect draining, and decoupled Cloud Function batch merging.
 */
export default function useLectureRecorder({
  classId,
  teacherUid,
  teacherEmail = '',
  maxDurationSeconds = DEFAULT_MAX_RECORDING_SECONDS,
  segmentDurationSeconds = DEFAULT_SEGMENT_DURATION_SECONDS,
  onRecordingComplete = null,
} = {}) {
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'uploading' | 'completed' | 'error'
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [pendingSegmentsCount, setPendingSegmentsCount] = useState(0);

  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioRecorderRef = useRef(null);
  const audioRecordedChunksRef = useRef([]);
  const pureAudioStreamRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const combinedStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const rootSessionIdRef = useRef(null);
  const sessionGroupIdRef = useRef(null);
  const durationRef = useRef(0);
  const currentSegmentDurationRef = useRef(0);
  const segmentIndexRef = useRef(1);
  const segmentDurationRef = useRef(segmentDurationSeconds);
  const recordedSegmentsRef = useRef([]);
  const uploadQueueRef = useRef([]);
  const isUploadingSegmentRef = useRef(false);
  const isRollingOverRef = useRef(false);
  const metadataRef = useRef({});
  const isStartingOrRecordingRef = useRef(false);
  const maxDurationRef = useRef(maxDurationSeconds);
  const retryTimeoutRef = useRef(null);
  const stopRecordingRef = useRef(null);

  useEffect(() => {
    maxDurationRef.current = maxDurationSeconds;
  }, [maxDurationSeconds]);

  useEffect(() => {
    segmentDurationRef.current = segmentDurationSeconds;
  }, [segmentDurationSeconds]);

  // Clean up timer
  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  // Clean up streams & audio context
  const cleanupStreams = useCallback(() => {
    if (combinedStreamRef.current) {
      combinedStreamRef.current.getTracks().forEach((track) => {
        if (track.__locallyCreated) {
          try { track.stop(); } catch {}
        }
      });
      combinedStreamRef.current = null;
    }
    if (pureAudioStreamRef.current) {
      pureAudioStreamRef.current.getTracks().forEach((track) => {
        if (track.__locallyCreated) {
          try { track.stop(); } catch {}
        }
      });
      pureAudioStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {}
      audioContextRef.current = null;
    }
  }, []);

  /**
   * Sequentially drains the pending upload queue to Cloud Storage.
   * If network is unstable or offline, segments remain safely buffered in IndexedDB.
   */
  const drainUploadQueue = useCallback(
    async (throwOnError = false) => {
      if (isUploadingSegmentRef.current) return;
      if (!uploadQueueRef.current || uploadQueueRef.current.length === 0) return;

      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        console.info('[useLectureRecorder] Network currently offline. Segments buffered in IndexedDB.');
        return;
      }

      isUploadingSegmentRef.current = true;
      try {
        while (uploadQueueRef.current.length > 0) {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            console.info('[useLectureRecorder] Offline event during drain. Queue paused.');
            break;
          }

          const item = uploadQueueRef.current[0];
          const targetClassId = item.classId || classId;
          const mimeType = item.mimeType || 'video/webm';
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';

          let audioUrl = null;
          let audioStoragePath = null;
          let audioFileSize = null;

          // 1. Upload parallel pure audio if recorded
          if (item.audioBlob && item.audioBlob.size > 0) {
            try {
              const audioMimeType = item.audioMimeType || 'audio/webm';
              const audioExt = audioMimeType.includes('mp4') ? 'm4a' : 'webm';
              audioStoragePath = `recordings/${targetClassId}/${item.sessionId}/lecture_audio.${audioExt}`;
              const audioRef = storageRef(storage, audioStoragePath);
              const audioUploadTask = await uploadBytesResumable(audioRef, item.audioBlob, {
                contentType: audioMimeType,
                customMetadata: {
                  classId: targetClassId,
                  sessionId: item.sessionId,
                  sessionGroupId: item.sessionGroupId || '',
                  segmentIndex: String(item.segmentIndex || 1),
                  durationSeconds: String(item.duration || 60),
                  teacherEmail: item.teacherEmail || teacherEmail || '',
                },
              });
              audioUrl = await getDownloadURL(audioUploadTask?.ref || audioRef);
              audioFileSize = item.audioBlob.size;
            } catch (audioErr) {
              console.warn('[useLectureRecorder] Parallel audio upload failed for segment:', item.sessionId, audioErr);
            }
          }

          // 2. Upload video
          const filePath = `recordings/${targetClassId}/${item.sessionId}/lecture.${ext}`;
          const fileRef = storageRef(storage, filePath);
          const uploadTask = uploadBytesResumable(fileRef, item.blob, {
            contentType: mimeType,
            customMetadata: {
              classId: targetClassId,
              sessionId: item.sessionId,
              sessionGroupId: item.sessionGroupId || '',
              segmentIndex: String(item.segmentIndex || 1),
              durationSeconds: String(item.duration || 60),
              teacherEmail: item.teacherEmail || teacherEmail || '',
            },
          });

          await new Promise((resolveUpload, rejectUpload) => {
            uploadTask.on(
              'state_changed',
              (snapshot) => {
                if (snapshot.totalBytes > 0) {
                  const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                  setUploadProgress(progress);
                }
              },
              (err) => rejectUpload(err),
              () => resolveUpload()
            );
          });

          const downloadUrl = await getDownloadURL(uploadTask.snapshot?.ref || fileRef);

          // 3. Update Firestore segment document
          const sessionDocRef = doc(db, `classes/${targetClassId}/lectureRecordings/${item.sessionId}`);
          await updateDoc(sessionDocRef, {
            status: 'ready',
            videoUrl: downloadUrl,
            storagePath: filePath,
            audioUrl: audioUrl || null,
            audioStoragePath: audioStoragePath || null,
            fileSize: item.blob.size,
            audioFileSize: audioFileSize || null,
            durationSeconds: item.duration,
            endedAt: serverTimestamp(),
          });

          // 4. Safely clear from IndexedDB offline storage
          await clearPendingSegment(item.sessionId);
          await clearRecoverySession(item.sessionId);

          // 5. Add to completed segments list
          const completedRecord = {
            sessionId: item.sessionId,
            segmentIndex: item.segmentIndex,
            duration: item.duration,
            blob: item.blob,
            audioBlob: item.audioBlob,
            videoUrl: downloadUrl,
            storagePath: filePath,
            audioUrl,
            audioStoragePath,
            fileSize: item.blob.size,
            audioFileSize,
          };
          recordedSegmentsRef.current.push(completedRecord);

          // 6. Remove from queue
          uploadQueueRef.current.shift();
          setPendingSegmentsCount(uploadQueueRef.current.length);
        }
      } catch (drainErr) {
        console.warn('[useLectureRecorder] Drain error (items remain safely in IndexedDB):', drainErr);
        if (uploadQueueRef.current.length > 0) {
          const top = uploadQueueRef.current[0];
          top.retries = (top.retries || 0) + 1;
          const retryDelay = Math.min(30000, 2000 * Math.pow(1.5, top.retries));
          if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
          retryTimeoutRef.current = setTimeout(() => {
            drainUploadQueue(false);
          }, retryDelay);
        }
        if (throwOnError) {
          throw drainErr;
        }
      } finally {
        isUploadingSegmentRef.current = false;
      }
    },
    [classId, teacherEmail]
  );

  /**
   * Merges multiple lecture clips (by sessionGroupId or explicit recordingIds) into a master lecture.
   */
  const mergeSessionRecordings = useCallback(
    async ({ sessionGroupId, recordingIds, customTitle } = {}) => {
      if (!classId) throw new Error('classId is required to merge recordings.');
      try {
        const callMerge = httpsCallable(functions, 'mergeLectureRecordings');
        const result = await callMerge({
          classId,
          sessionGroupId,
          recordingIds,
          customTitle,
        });

        if (result.data?.success && result.data?.combinedSessionId) {
          let isSubtitlesEnabled = true;
          try {
            const classSnap = await getDoc(doc(db, 'classes', classId));
            if (classSnap.exists() && classSnap.data()?.isLectureSubtitlesEnabled === false) {
              isSubtitlesEnabled = false;
            }
          } catch (e) {
            console.warn('[useLectureRecorder] Notice checking subtitle policy in merge:', e);
          }

          if (isSubtitlesEnabled) {
            try {
              const callSubtitles = httpsCallable(functions, 'processLectureSubtitles');
              callSubtitles({
                classId,
                sessionId: result.data.combinedSessionId,
                storagePath: result.data.storagePath,
                title: result.data.title,
              }).catch((err) => {
                console.warn('[useLectureRecorder] Background combined subtitle trigger notice:', err);
              });
            } catch (triggerErr) {
              console.warn('[useLectureRecorder] Failed to trigger combined subtitles:', triggerErr);
            }
          } else {
            try {
              await updateDoc(doc(db, 'classes', classId, 'lectureRecordings', result.data.combinedSessionId), {
                status: 'ready',
                subtitlesStatus: 'ready',
                subtitlesDisabled: true,
                updatedAt: serverTimestamp(),
              });
            } catch (e) {
              console.warn('[useLectureRecorder] Failed to mark combined session subtitlesDisabled:', e);
            }
          }
        }
        return result.data;
      } catch (err) {
        console.error('[useLectureRecorder] Failed to merge recordings:', err);
        throw err;
      }
    },
    [classId]
  );

  /**
   * Seamlessly rolls over to the next 1-minute recording segment without interrupting live MediaStreams.
   */
  const rolloverSegment = useCallback(async () => {
    if (isRollingOverRef.current) return;
    if (!combinedStreamRef.current || !combinedStreamRef.current.active) return;
    isRollingOverRef.current = true;

    try {
      if (audioRecorderRef.current && audioRecorderRef.current.state === 'recording') {
        try { audioRecorderRef.current.requestData(); } catch {}
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.requestData(); } catch {}
      }

      const curSegmentIdx = segmentIndexRef.current;
      const curSegSessionId = activeSessionIdRef.current;
      const curSegDuration = currentSegmentDurationRef.current || 60;
      const curVideoChunks = [...recordedChunksRef.current];
      const curAudioChunks = [...audioRecordedChunksRef.current];

      recordedChunksRef.current = [];
      audioRecordedChunksRef.current = [];
      currentSegmentDurationRef.current = 0;
      segmentIndexRef.current += 1;

      const nextSegIdx = segmentIndexRef.current;
      const nextSessionId = `${rootSessionIdRef.current}_seg${nextSegIdx}`;
      activeSessionIdRef.current = nextSessionId;
      setActiveSessionId(nextSessionId);

      // 1. Prepare next composite video MediaRecorder on the live combined stream
      const mimeType = getSupportedMimeType();
      const options = mimeType ? { mimeType, videoBitsPerSecond: 2500000 } : {};
      const nextMediaRecorder = new MediaRecorder(combinedStreamRef.current, options);

      nextMediaRecorder.ondataavailable = (event) => {
        if (mediaRecorderRef.current === nextMediaRecorder && event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          persistRecoveryChunk({
            sessionId: nextSessionId,
            classId,
            sessionGroupId: sessionGroupIdRef.current,
            title: metadataRef.current?.title || '',
            topic: metadataRef.current?.topic || '',
            targetLanguages: metadataRef.current?.targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
            mimeType: nextMediaRecorder.mimeType || mimeType,
            chunk: event.data,
            startedAt: Date.now(),
          });
        }
      };

      const videoTrack = combinedStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
            stopRecordingRef.current?.();
          }
        };
      }

      // 2. Prepare next pure audio recorder if available
      let nextAudioRecorder = null;
      if (pureAudioStreamRef.current && pureAudioStreamRef.current.getAudioTracks().length > 0) {
        try {
          const audioMimeType = getSupportedAudioMimeType();
          const audioOptions = audioMimeType ? { mimeType: audioMimeType, audioBitsPerSecond: 64000 } : {};
          nextAudioRecorder = new MediaRecorder(pureAudioStreamRef.current, audioOptions);
          nextAudioRecorder.ondataavailable = (event) => {
            if (audioRecorderRef.current === nextAudioRecorder && event.data && event.data.size > 0) {
              audioRecordedChunksRef.current.push(event.data);
            }
          };
        } catch (audioRecErr) {
          console.warn('[useLectureRecorder] Failed to start next audio recorder:', audioRecErr);
        }
      }

      // 3. Swap active recorder references seamlessly
      const oldMediaRecorder = mediaRecorderRef.current;
      const oldAudioRecorder = audioRecorderRef.current;
      mediaRecorderRef.current = nextMediaRecorder;
      audioRecorderRef.current = nextAudioRecorder;

      nextMediaRecorder.start(10000);
      if (nextAudioRecorder) {
        nextAudioRecorder.start(10000);
      }

      // 4. Register next segment document in Firestore
      const nextDocRef = doc(db, `classes/${classId}/lectureRecordings/${nextSessionId}`);
      const nextMeta = {
        ...metadataRef.current,
        title: `${metadataRef.current?.title || 'Lecture'} (Part ${nextSegIdx})`,
        segmentIndex: nextSegIdx,
        isRollingSegment: true,
        status: 'recording',
        startedAt: serverTimestamp(),
      };
      setDoc(nextDocRef, nextMeta).catch((e) => {
        console.warn('[useLectureRecorder] Failed to create doc for next segment:', e);
      });

      // 5. Finalize the completed segment and queue for background upload
      (async () => {
        try {
          if (oldAudioRecorder && oldAudioRecorder.state !== 'inactive') {
            try { oldAudioRecorder.stop(); } catch {}
          }
          if (oldMediaRecorder && oldMediaRecorder.state !== 'inactive') {
            try { oldMediaRecorder.stop(); } catch {}
          }

          const oldMime = oldMediaRecorder?.mimeType || 'video/webm';
          const rawBlob = new Blob(curVideoChunks, { type: oldMime });
          if (rawBlob.size === 0) return;

          let blob = rawBlob;
          if (oldMime.includes('webm') && curSegDuration > 0) {
            blob = await injectWebmDuration(rawBlob, curSegDuration * 1000);
          }

          let audioBlob = null;
          const oldAudioMime = oldAudioRecorder?.mimeType || 'audio/webm';
          if (curAudioChunks.length > 0) {
            const rawAudio = new Blob(curAudioChunks, { type: oldAudioMime });
            if (rawAudio.size > 0) {
              audioBlob = rawAudio;
              if (oldAudioMime.includes('webm') && curSegDuration > 0) {
                audioBlob = await injectWebmDuration(rawAudio, curSegDuration * 1000);
              }
            }
          }

          // Persist to IndexedDB offline buffer
          await persistPendingSegment({
            sessionId: curSegSessionId,
            classId,
            sessionGroupId: sessionGroupIdRef.current,
            segmentIndex: curSegmentIdx,
            duration: curSegDuration,
            blob,
            audioBlob,
            mimeType: oldMime,
            audioMimeType: oldAudioMime,
            title: `${metadataRef.current?.title || 'Lecture'} (Part ${curSegmentIdx})`,
            topic: metadataRef.current?.topic || '',
            targetLanguages: metadataRef.current?.targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
            teacherEmail,
          });

          // Enqueue for background network upload
          uploadQueueRef.current.push({
            sessionId: curSegSessionId,
            classId,
            sessionGroupId: sessionGroupIdRef.current,
            segmentIndex: curSegmentIdx,
            duration: curSegDuration,
            blob,
            audioBlob,
            mimeType: oldMime,
            audioMimeType: oldAudioMime,
            title: `${metadataRef.current?.title || 'Lecture'} (Part ${curSegmentIdx})`,
            retries: 0,
          });
          setPendingSegmentsCount(uploadQueueRef.current.length);

          drainUploadQueue(false);
        } catch (err) {
          console.error('[useLectureRecorder] Rollover finalize error:', err);
        }
      })();
    } catch (err) {
      console.error('[useLectureRecorder] Rollover error:', err);
    } finally {
      isRollingOverRef.current = false;
    }
  }, [classId, teacherEmail, drainUploadQueue]);

  /**
   * Start a new recording session.
   */
  const startRecording = useCallback(
    async ({
      screenStream = null,
      audioStream = null,
      title = '',
      topic = '',
      className = '',
      targetLanguages = ['en', 'zh-Hant', 'zh-Hans', 'ja'],
      broadcastSessionId = null,
      schedule = null,
      sessionGroupId = null,
    } = {}) => {
      if (!classId) {
        setError('Class ID is required to start lecture recording.');
        return;
      }
      if (
        isStartingOrRecordingRef.current ||
        recordingState === 'recording' ||
        recordingState === 'paused' ||
        recordingState === 'uploading'
      ) {
        console.warn('[useLectureRecorder] Recording already starting or active.');
        return;
      }
      isStartingOrRecordingRef.current = true;

      // Cleanly teardown any lingering previous recorders
      if (mediaRecorderRef.current) {
        try {
          mediaRecorderRef.current.ondataavailable = null;
          mediaRecorderRef.current.onerror = null;
          mediaRecorderRef.current.onstop = null;
          if (mediaRecorderRef.current.state !== 'inactive') {
            mediaRecorderRef.current.stop();
          }
        } catch (_) {}
        mediaRecorderRef.current = null;
      }
      if (audioRecorderRef.current) {
        try {
          audioRecorderRef.current.ondataavailable = null;
          audioRecorderRef.current.onerror = null;
          audioRecorderRef.current.onstop = null;
          if (audioRecorderRef.current.state !== 'inactive') {
            audioRecorderRef.current.stop();
          }
        } catch (_) {}
        audioRecorderRef.current = null;
      }

      setError(null);
      setUploadProgress(0);
      recordedChunksRef.current = [];
      audioRecordedChunksRef.current = [];
      durationRef.current = 0;
      currentSegmentDurationRef.current = 0;
      segmentIndexRef.current = 1;
      recordedSegmentsRef.current = [];
      uploadQueueRef.current = [];
      setPendingSegmentsCount(0);
      setDurationSeconds(0);

      try {
        // 1. Resolve Screen Video Stream
        let activeScreen = screenStream;
        if (!activeScreen || !activeScreen.active || activeScreen.getVideoTracks().length === 0) {
          activeScreen = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor', frameRate: { ideal: 30, max: 60 } },
            audio: true,
          });
          activeScreen.getTracks().forEach((t) => (t.__locallyCreated = true));
        }

        // 2. Resolve Microphone Audio Stream
        let activeMic = audioStream;
        if (!activeMic || !activeMic.active || activeMic.getAudioTracks().length === 0) {
          try {
            activeMic = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            activeMic.getTracks().forEach((t) => (t.__locallyCreated = true));
          } catch (micErr) {
            console.warn('[useLectureRecorder] Microphone access denied or unavailable:', micErr);
            activeMic = null;
          }
        }

        // 3. Merge Video + Audio into a synchronized Combined Stream
        const combinedStream = new MediaStream();
        const videoTrack = activeScreen.getVideoTracks()[0];
        if (videoTrack) {
          combinedStream.addTrack(videoTrack);
        }

        const screenAudioTracks = activeScreen.getAudioTracks();
        const micAudioTracks = activeMic ? activeMic.getAudioTracks() : [];
        let pureAudioStream = null;

        if (
          screenAudioTracks.length > 0 &&
          micAudioTracks.length > 0 &&
          typeof window !== 'undefined' &&
          (window.AudioContext || window.webkitAudioContext)
        ) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const dest = audioCtx.createMediaStreamDestination();

          const screenSource = audioCtx.createMediaStreamSource(new MediaStream(screenAudioTracks));
          const micSource = audioCtx.createMediaStreamSource(new MediaStream(micAudioTracks));

          screenSource.connect(dest);
          micSource.connect(dest);

          const mixedTrack = dest.stream.getAudioTracks()[0];
          mixedTrack.__locallyCreated = true;
          combinedStream.addTrack(mixedTrack);
          pureAudioStream = dest.stream;
        } else if (micAudioTracks.length > 0) {
          combinedStream.addTrack(micAudioTracks[0]);
          pureAudioStream = new MediaStream(micAudioTracks);
        } else if (screenAudioTracks.length > 0) {
          combinedStream.addTrack(screenAudioTracks[0]);
          pureAudioStream = new MediaStream(screenAudioTracks);
        }

        pureAudioStreamRef.current = pureAudioStream;
        combinedStreamRef.current = combinedStream;

        if (videoTrack) {
          videoTrack.onended = () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              console.info('[useLectureRecorder] Screen track ended by system; stopping recording.');
              stopRecordingRef.current?.();
            }
          };
        }

        // 4. Generate unique UUID Session ID & resolve Session Group
        const rootSessionId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        rootSessionIdRef.current = rootSessionId;
        activeSessionIdRef.current = rootSessionId;
        setActiveSessionId(rootSessionId);

        const effectiveSessionGroupId =
          sessionGroupId ||
          resolveSessionGroupId({
            classId,
            broadcastSessionId,
            schedule,
            timestamp: new Date(),
          });
        sessionGroupIdRef.current = effectiveSessionGroupId;

        // 5. Initialize W3C MediaRecorder for Composite Video
        const mimeType = getSupportedMimeType();
        const options = mimeType ? { mimeType, videoBitsPerSecond: 2500000 } : {};
        const mediaRecorder = new MediaRecorder(combinedStream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (mediaRecorderRef.current === mediaRecorder && event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
            persistRecoveryChunk({
              sessionId: rootSessionId,
              classId,
              sessionGroupId: effectiveSessionGroupId,
              title: title || `Lecture - ${new Date().toLocaleDateString()}`,
              topic: topic || '',
              targetLanguages: targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
              mimeType: mediaRecorder.mimeType || mimeType,
              chunk: event.data,
              startedAt: Date.now(),
            });
          }
        };

        // 6. Initialize Parallel Audio-Only Recorder for Gemini Subtitle Processing
        audioRecordedChunksRef.current = [];
        if (pureAudioStream && pureAudioStream.getAudioTracks().length > 0) {
          try {
            const audioMimeType = getSupportedAudioMimeType();
            const audioOptions = audioMimeType ? { mimeType: audioMimeType, audioBitsPerSecond: 64000 } : {};
            const audioRecorder = new MediaRecorder(pureAudioStream, audioOptions);
            audioRecorderRef.current = audioRecorder;

            audioRecorder.ondataavailable = (event) => {
              if (audioRecorderRef.current === audioRecorder && event.data && event.data.size > 0) {
                audioRecordedChunksRef.current.push(event.data);
              }
            };
            audioRecorder.start(10000);
          } catch (audioRecErr) {
            console.warn('[useLectureRecorder] Parallel audio recorder could not start:', audioRecErr);
            audioRecorderRef.current = null;
          }
        }

        const dateStr = new Date().toLocaleDateString();
        const defaultTitle = className ? `${className} - ${dateStr}` : `Lecture - ${dateStr}`;

        const sessionMeta = {
          title: title || defaultTitle,
          topic: topic || '',
          className: className || '',
          targetLanguages: targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
          mimeType: mediaRecorder.mimeType || mimeType,
          startedAt: serverTimestamp(),
          status: 'recording',
          teacherUid: teacherUid || null,
          teacherEmail: teacherEmail || null,
          classId,
          sessionGroupId: effectiveSessionGroupId,
          segmentIndex: 1,
          isRollingSegment: true,
          broadcastSessionId: broadcastSessionId || null,
        };
        metadataRef.current = sessionMeta;

        const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${rootSessionId}`);
        await setDoc(sessionDocRef, sessionMeta);

        mediaRecorder.start(10000);
        setRecordingState('recording');

        // Start duration timer with 1-minute rolling segment check & safety limit auto-stop
        timerIntervalRef.current = setInterval(() => {
          durationRef.current += 1;
          currentSegmentDurationRef.current += 1;
          setDurationSeconds(durationRef.current);

          if (
            segmentDurationRef.current > 0 &&
            currentSegmentDurationRef.current >= segmentDurationRef.current &&
            !isRollingOverRef.current
          ) {
            rolloverSegment();
          }

          if (maxDurationRef.current > 0 && durationRef.current >= maxDurationRef.current) {
            console.warn(`[useLectureRecorder] Safety limit of ${maxDurationRef.current}s reached; auto-stopping recording.`);
            stopRecordingRef.current?.();
          }
        }, 1000);
      } catch (err) {
        isStartingOrRecordingRef.current = false;
        console.error('[useLectureRecorder] Failed to start recording:', err);
        setError(err.message || 'Failed to start lecture recording.');
        setRecordingState('error');
        cleanupStreams();
        stopTimer();
      }
    },
    [classId, teacherUid, teacherEmail, recordingState, cleanupStreams, stopTimer, rolloverSegment]
  );

  /**
   * Pause recording.
   */
  const pauseRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.pause();
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state === 'recording') {
      audioRecorderRef.current.pause();
    }
    stopTimer();
    setRecordingState('paused');

    if (classId && activeSessionIdRef.current) {
      const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${activeSessionIdRef.current}`);
      updateDoc(sessionDocRef, { isPaused: true }).catch(() => {});
    }
  }, [classId, stopTimer]);

  /**
   * Resume recording.
   */
  const resumeRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      mediaRecorderRef.current.resume();
    }
    if (audioRecorderRef.current && audioRecorderRef.current.state === 'paused') {
      audioRecorderRef.current.resume();
    }
    setRecordingState('recording');

    timerIntervalRef.current = setInterval(() => {
      durationRef.current += 1;
      currentSegmentDurationRef.current += 1;
      setDurationSeconds(durationRef.current);

      if (
        segmentDurationRef.current > 0 &&
        currentSegmentDurationRef.current >= segmentDurationRef.current &&
        !isRollingOverRef.current
      ) {
        rolloverSegment();
      }

      if (maxDurationRef.current > 0 && durationRef.current >= maxDurationRef.current) {
        console.warn(`[useLectureRecorder] Safety limit of ${maxDurationRef.current}s reached; auto-stopping recording.`);
        stopRecordingRef.current?.();
      }
    }, 1000);

    if (classId && activeSessionIdRef.current) {
      const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${activeSessionIdRef.current}`);
      updateDoc(sessionDocRef, { isPaused: false }).catch(() => {});
    }
  }, [classId, rolloverSegment]);

  /**
   * Stop recording, finalize current segment, drain queue, and trigger decoupled batch combine job.
   */
  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return null;
    }

    stopTimer();
    isStartingOrRecordingRef.current = false;
    setRecordingState('uploading');

    const finalSegmentIdx = segmentIndexRef.current;
    const finalSegSessionId = activeSessionIdRef.current;
    const finalSegDuration = currentSegmentDurationRef.current || durationRef.current || 1;
    const totalDuration = durationRef.current;

    const activeMediaRec = mediaRecorderRef.current;
    const activeAudioRec = audioRecorderRef.current;
    const videoMime = activeMediaRec?.mimeType || 'video/webm';
    const audioMime = activeAudioRec?.mimeType || 'audio/webm';

    // Flush active media recorders
    if (activeAudioRec && activeAudioRec.state === 'recording') {
      try { activeAudioRec.requestData(); } catch {}
    }
    if (activeMediaRec && activeMediaRec.state === 'recording') {
      try { activeMediaRec.requestData(); } catch {}
    }

    // Stop active media recorders and wait for final chunks to flush
    const stopPromises = [];
    if (activeAudioRec && activeAudioRec.state !== 'inactive') {
      stopPromises.push(new Promise((resolve) => {
        activeAudioRec.addEventListener('stop', () => resolve(), { once: true });
        try { activeAudioRec.stop(); } catch { resolve(); }
      }));
    }
    if (activeMediaRec && activeMediaRec.state !== 'inactive') {
      stopPromises.push(new Promise((resolve) => {
        activeMediaRec.addEventListener('stop', () => resolve(), { once: true });
        try { activeMediaRec.stop(); } catch { resolve(); }
      }));
    }
    await Promise.all(stopPromises);

    const curVideoChunks = [...recordedChunksRef.current];
    const curAudioChunks = [...audioRecordedChunksRef.current];

    cleanupStreams();

    try {
      const rawBlob = new Blob(curVideoChunks, { type: videoMime });
      if (rawBlob.size === 0 && recordedSegmentsRef.current.length === 0 && uploadQueueRef.current.length === 0) {
        throw new Error('Recorded lecture file is empty.');
      }

      if (rawBlob.size === 0) {
        // If final segment stub has 0 bytes (e.g. stopped right after a rollover), clean up stub doc from Firestore
        if (finalSegSessionId && finalSegmentIdx > 1) {
          try {
            const stubRef = doc(db, `classes/${classId}/lectureRecordings/${finalSegSessionId}`);
            deleteDoc(stubRef).catch(() => {});
          } catch {}
        }
      }

      if (rawBlob.size > 0) {
        let blob = rawBlob;
        if (videoMime.includes('webm') && finalSegDuration > 0) {
          blob = await injectWebmDuration(rawBlob, finalSegDuration * 1000);
        }

        let audioBlob = null;
        if (curAudioChunks.length > 0) {
          const rawAudio = new Blob(curAudioChunks, { type: audioMime });
          if (rawAudio.size > 0) {
            audioBlob = rawAudio;
            if (audioMime.includes('webm') && finalSegDuration > 0) {
              audioBlob = await injectWebmDuration(rawAudio, finalSegDuration * 1000);
            }
          }
        }

        // Persist final segment to IndexedDB
        await persistPendingSegment({
          sessionId: finalSegSessionId,
          classId,
          sessionGroupId: sessionGroupIdRef.current,
          segmentIndex: finalSegmentIdx,
          duration: finalSegDuration,
          blob,
          audioBlob,
          mimeType: videoMime,
          audioMimeType: audioMime,
          title: finalSegmentIdx > 1
            ? `${metadataRef.current?.title || 'Lecture'} (Part ${finalSegmentIdx})`
            : (metadataRef.current?.title || 'Lecture'),
          topic: metadataRef.current?.topic || '',
          targetLanguages: metadataRef.current?.targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
          teacherEmail,
        });

        // Enqueue final segment
        uploadQueueRef.current.push({
          sessionId: finalSegSessionId,
          classId,
          sessionGroupId: sessionGroupIdRef.current,
          segmentIndex: finalSegmentIdx,
          duration: finalSegDuration,
          blob,
          audioBlob,
          mimeType: videoMime,
          audioMimeType: audioMime,
          title: finalSegmentIdx > 1
            ? `${metadataRef.current?.title || 'Lecture'} (Part ${finalSegmentIdx})`
            : (metadataRef.current?.title || 'Lecture'),
          retries: 0,
        });
        setPendingSegmentsCount(uploadQueueRef.current.length);
      }

      // Drain upload queue with throwOnError enabled for caller catchability
      await drainUploadQueue(true);

      // Wait briefly if remaining items are processing
      const isOnline = typeof navigator === 'undefined' || navigator.onLine;
      if (isOnline) {
        const startTime = Date.now();
        while (uploadQueueRef.current.length > 0 && Date.now() - startTime < 30000) {
          await drainUploadQueue(true);
          if (uploadQueueRef.current.length > 0) {
            await new Promise((r) => setTimeout(r, 200));
          }
        }
      }

      setRecordingState('completed');

      const totalSegments = recordedSegmentsRef.current;
      let finalResult;

      if (totalSegments.length > 1) {
        // Multi-segment lecture: trigger cloud background combine job
        console.info(`[useLectureRecorder] Multi-segment recording complete (${totalSegments.length} segments). Creating merge job.`);
        try {
          const jobId = `merge_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const mergeJobRef = doc(db, 'lectureMergeJobs', jobId);
          await setDoc(mergeJobRef, {
            classId,
            sessionGroupId: sessionGroupIdRef.current,
            customTitle: metadataRef.current?.title || `Lecture - ${new Date().toLocaleDateString()}`,
            status: 'pending',
            createdAt: serverTimestamp(),
            requesterUid: teacherUid || null,
            requesterEmail: teacherEmail || null,
            segmentsCount: totalSegments.length,
          });
        } catch (jobErr) {
          console.warn('[useLectureRecorder] Falling back to mergeSessionRecordings callable:', jobErr);
          try {
            await mergeSessionRecordings({
              sessionGroupId: sessionGroupIdRef.current,
              customTitle: metadataRef.current?.title,
            });
          } catch (e) {
            console.warn('[useLectureRecorder] Direct merge callable notice:', e.message);
          }
        }

        finalResult = {
          sessionId: rootSessionIdRef.current || finalSegSessionId,
          sessionGroupId: sessionGroupIdRef.current,
          segmentsCount: totalSegments.length,
          durationSeconds: totalDuration,
          videoUrl: totalSegments[0]?.videoUrl,
          storagePath: totalSegments[0]?.storagePath,
          audioUrl: totalSegments[0]?.audioUrl,
          audioStoragePath: totalSegments[0]?.audioStoragePath,
          fileSize: totalSegments.reduce((acc, s) => acc + (s.fileSize || 0), 0),
        };
      } else if (totalSegments.length === 1) {
        const single = totalSegments[0];
        finalResult = {
          sessionId: single.sessionId,
          videoUrl: single.videoUrl,
          storagePath: single.storagePath,
          audioUrl: single.audioUrl || null,
          audioStoragePath: single.audioStoragePath || null,
          durationSeconds: totalDuration,
          fileSize: single.fileSize,
          audioFileSize: single.audioFileSize || null,
        };

        let isSubtitlesEnabled = true;
        try {
          const classSnap = await getDoc(doc(db, 'classes', classId));
          if (classSnap.exists() && classSnap.data()?.isLectureSubtitlesEnabled === false) {
            isSubtitlesEnabled = false;
          }
        } catch (checkErr) {
          console.warn('[useLectureRecorder] Could not check isLectureSubtitlesEnabled policy:', checkErr);
        }

        if (isSubtitlesEnabled) {
          try {
            const callSubtitles = httpsCallable(functions, 'processLectureSubtitles');
            callSubtitles({
              classId,
              sessionId: single.sessionId,
              storagePath: single.storagePath,
              title: metadataRef.current?.title || `Lecture - ${new Date().toLocaleDateString()}`,
              topic: metadataRef.current?.topic || '',
              targetLanguages: metadataRef.current?.targetLanguages,
            }).catch((err) => {
              console.warn('[useLectureRecorder] Background subtitle trigger notice:', err);
            });
          } catch (triggerErr) {
            console.warn('[useLectureRecorder] Failed to invoke processLectureSubtitles:', triggerErr);
          }
        } else {
          console.info(`[useLectureRecorder] Lecture subtitles disabled by class policy for ${classId}. Marking session ready without AI generation.`);
          try {
            await updateDoc(doc(db, 'classes', classId, 'lectureRecordings', single.sessionId), {
              status: 'ready',
              subtitlesStatus: 'ready',
              subtitlesDisabled: true,
              updatedAt: serverTimestamp(),
            });
          } catch (updateErr) {
            console.warn('[useLectureRecorder] Failed to set subtitlesDisabled flag:', updateErr);
          }
        }
      } else {
        finalResult = {
          sessionId: finalSegSessionId,
          durationSeconds: totalDuration,
          isOfflinePending: true,
          pendingSegmentsCount: uploadQueueRef.current.length,
        };
      }

      if (typeof onRecordingComplete === 'function') {
        onRecordingComplete(finalResult);
      }

      return finalResult;
    } catch (finalizeErr) {
      console.error('[useLectureRecorder] Finalize error:', finalizeErr);
      setError(finalizeErr.message);
      setRecordingState('error');
      throw finalizeErr;
    }
  }, [classId, teacherUid, teacherEmail, stopTimer, cleanupStreams, drainUploadQueue, mergeSessionRecordings, onRecordingComplete]);

  stopRecordingRef.current = stopRecording;

  /**
   * Discard/Cancel recording.
   */
  const discardRecording = useCallback(async () => {
    isStartingOrRecordingRef.current = false;
    stopTimer();
    cleanupStreams();

    if (activeSessionIdRef.current) {
      await clearRecoverySession(activeSessionIdRef.current);
      await clearPendingSegment(activeSessionIdRef.current);
    }
    if (rootSessionIdRef.current) {
      await clearRecoverySession(rootSessionIdRef.current);
      await clearPendingSegment(rootSessionIdRef.current);
    }

    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.ondataavailable = null;
        mediaRecorderRef.current.onstop = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch {}
      mediaRecorderRef.current = null;
    }

    if (audioRecorderRef.current) {
      try {
        audioRecorderRef.current.ondataavailable = null;
        audioRecorderRef.current.onstop = null;
        if (audioRecorderRef.current.state !== 'inactive') {
          audioRecorderRef.current.stop();
        }
      } catch {}
      audioRecorderRef.current = null;
    }

    recordedChunksRef.current = [];
    audioRecordedChunksRef.current = [];
    uploadQueueRef.current = [];
    recordedSegmentsRef.current = [];
    durationRef.current = 0;
    currentSegmentDurationRef.current = 0;
    setDurationSeconds(0);
    setPendingSegmentsCount(0);

    if (classId && activeSessionIdRef.current) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${activeSessionIdRef.current}`);
        await updateDoc(sessionDocRef, { status: 'discarded', discardedAt: serverTimestamp() });
      } catch {}
    }

    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    rootSessionIdRef.current = null;
    setRecordingState('idle');
  }, [classId, stopTimer, cleanupStreams]);

  // Online / Offline network listeners for auto-drain
  useEffect(() => {
    const handleOnline = () => {
      console.info('[useLectureRecorder] Network restored. Auto-draining buffered segments.');
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
      drainUploadQueue(false);
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [drainUploadQueue]);

  // Prevent accidental tab closing/refreshing while recording or uploading
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (recordingState === 'recording' || recordingState === 'paused' || recordingState === 'uploading') {
        e.preventDefault();
        e.returnValue = 'A lecture recording is currently active or uploading. Leaving now will discard the current recording segment.';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [recordingState]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopTimer();
      cleanupStreams();
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        try { mediaRecorderRef.current.stop(); } catch {}
      }
      if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
        try { audioRecorderRef.current.stop(); } catch {}
      }
    };
  }, [stopTimer, cleanupStreams]);

  /**
   * Recovers an interrupted recording session saved in local IndexedDB from before a browser crash.
   */
  const recoverInterruptedSession = useCallback(
    async (recoverySession) => {
      if (!recoverySession || !recoverySession.chunks?.length) return null;
      const { sessionId, classId: recClassId, sessionGroupId, mimeType, chunks, title, topic, targetLanguages } = recoverySession;
      try {
        const targetClassId = recClassId || classId;
        const finalMimeType = mimeType || 'video/webm';
        const ext = finalMimeType.includes('mp4') ? 'mp4' : 'webm';
        const rawBlob = new Blob(chunks, { type: finalMimeType });

        if (rawBlob.size === 0) {
          await clearRecoverySession(sessionId);
          return null;
        }

        const filePath = `recordings/${targetClassId}/${sessionId}/lecture.${ext}`;
        const fileRef = storageRef(storage, filePath);
        await uploadBytesResumable(fileRef, rawBlob, {
          contentType: finalMimeType,
          customMetadata: {
            classId: targetClassId,
            sessionId,
            isRecoveredAfterCrash: 'true',
          },
        });
        const downloadUrl = await getDownloadURL(fileRef);

        const sessionDocRef = doc(db, `classes/${targetClassId}/lectureRecordings/${sessionId}`);
        await setDoc(
          sessionDocRef,
          {
            title: title || `Recovered Lecture Segment (${new Date().toLocaleDateString()})`,
            topic: topic || '',
            targetLanguages: targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
            status: 'ready',
            isRecoveredAfterCrash: true,
            videoUrl: downloadUrl,
            storagePath: filePath,
            fileSize: rawBlob.size,
            sessionGroupId: sessionGroupId || null,
            endedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await clearRecoverySession(sessionId);

        if (sessionGroupId) {
          try {
            const callMerge = httpsCallable(functions, 'mergeLectureRecordings');
            await callMerge({
              classId: targetClassId,
              sessionGroupId,
            });
          } catch (e) {
            console.debug('[useLectureRecorder] Auto-merge after crash recovery notice:', e.message);
          }
        }

        return { sessionId, downloadUrl };
      } catch (recErr) {
        console.warn('[useLectureRecorder] Failed to recover session:', recErr);
        return null;
      }
    },
    [classId]
  );

  // On mount, auto-recover crashed sessions and auto-drain offline buffered segments from local IndexedDB
  useEffect(() => {
    if (!classId) return;
    try {
      getPendingRecoverySessions()
        .then(async (sessions) => {
          if (!Array.isArray(sessions)) return;
          const classSessions = sessions.filter((s) => s.classId === classId);
          for (const s of classSessions) {
            console.info('[useLectureRecorder] Auto-recovering crash session from IndexedDB:', s.sessionId);
            await recoverInterruptedSession(s);
          }
        })
        .catch(() => {});

      getPendingSegments(classId)
        .then(async (segments) => {
          if (!Array.isArray(segments) || segments.length === 0) return;
          console.info(`[useLectureRecorder] Found ${segments.length} offline buffered segments in IndexedDB. Enqueueing.`);
          for (const seg of segments) {
            if (!uploadQueueRef.current.some((q) => q.sessionId === seg.sessionId)) {
              uploadQueueRef.current.push({ ...seg, retries: 0 });
            }
          }
          setPendingSegmentsCount(uploadQueueRef.current.length);
          drainUploadQueue(false);
        })
        .catch(() => {});
    } catch {}
  }, [classId, recoverInterruptedSession, drainUploadQueue]);

  return {
    recordingState,
    isRecording: recordingState === 'recording',
    isPaused: recordingState === 'paused',
    isUploading: recordingState === 'uploading',
    isCompleted: recordingState === 'completed',
    durationSeconds,
    durationFormatted: formatDuration(durationSeconds),
    uploadProgress,
    error,
    activeSessionId,
    pendingSegmentsCount,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    mergeSessionRecordings,
    recoverInterruptedSession,
    drainUploadQueue,
  };
}
