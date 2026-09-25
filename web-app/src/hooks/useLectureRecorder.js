import { useState, useRef, useCallback, useEffect } from 'react';
import { db, storage, functions } from '../firebase-config';
import { collection, doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { resolveSessionGroupId } from '../utils/sessionGrouping';

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
 * Used for the parallel pure-audio recording stream for fast Gemini transcription.
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

/**
 * Hook to manage high-definition lecture screen + microphone recording
 * with full teacher control (Start, Pause, Resume, Stop, Discard),
 * zero automated recording without permission, and direct Cloud Storage upload.
 */
export default function useLectureRecorder({
  classId,
  teacherUid,
  teacherEmail = '',
  onRecordingComplete = null,
} = {}) {
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'uploading' | 'completed' | 'error'
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [activeSessionId, setActiveSessionId] = useState(null);

  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const audioRecorderRef = useRef(null);
  const audioRecordedChunksRef = useRef([]);
  const pureAudioStreamRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const combinedStreamRef = useRef(null);
  const audioContextRef = useRef(null);
  const activeSessionIdRef = useRef(null);
  const durationRef = useRef(0);
  const metadataRef = useRef({});
  const isStartingOrRecordingRef = useRef(false);

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
        // Do not stop external tracks if they are shared with live screen broadcast;
        // only stop cloned or locally acquired ones
        if (track.__locallyCreated) {
          track.stop();
        }
      });
      combinedStreamRef.current = null;
    }
    if (pureAudioStreamRef.current) {
      pureAudioStreamRef.current.getTracks().forEach((track) => {
        if (track.__locallyCreated) {
          track.stop();
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
   * Start a new recording session.
   * Can accept an existing screenStream and audioStream, or acquire fresh ones.
   */
  const startRecording = useCallback(
    async ({
      screenStream = null,
      audioStream = null,
      title = '',
      topic = '',
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

      // Cleanly teardown any lingering previous recorders to prevent chunk pollution
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
      durationRef.current = 0;
      setDurationSeconds(0);

      try {
        // 1. Resolve Screen Video Stream
        let activeScreen = screenStream;
        let createdScreenStream = false;
        if (!activeScreen || !activeScreen.active || activeScreen.getVideoTracks().length === 0) {
          activeScreen = await navigator.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'monitor', frameRate: { ideal: 30, max: 60 } },
            audio: true, // capture system audio if user permits
          });
          createdScreenStream = true;
          activeScreen.getTracks().forEach((t) => (t.__locallyCreated = true));
        }

        // 2. Resolve Microphone Audio Stream
        let activeMic = audioStream;
        let createdMicStream = false;
        if (!activeMic || !activeMic.active || activeMic.getAudioTracks().length === 0) {
          try {
            activeMic = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            });
            createdMicStream = true;
            activeMic.getTracks().forEach((t) => (t.__locallyCreated = true));
          } catch (micErr) {
            console.warn('[useLectureRecorder] Microphone access denied or unavailable:', micErr);
            activeMic = null;
          }
        }

        // 3. Merge Video + Audio into a synchronized Combined Stream
        const combinedStream = new MediaStream();

        // Add screen video track
        const videoTrack = activeScreen.getVideoTracks()[0];
        if (videoTrack) {
          combinedStream.addTrack(videoTrack);
        }

        // Audio mixing (screen audio + mic audio if both exist)
        const screenAudioTracks = activeScreen.getAudioTracks();
        const micAudioTracks = activeMic ? activeMic.getAudioTracks() : [];
        let pureAudioStream = null;

        if (screenAudioTracks.length > 0 && micAudioTracks.length > 0 && typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
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

        // Auto-stop recording if the screen track is ended by user clicking Chrome's "Stop sharing" bar
        if (videoTrack) {
          videoTrack.onended = () => {
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              console.info('[useLectureRecorder] Screen track ended by system; stopping recording.');
              stopRecording();
            }
          };
        }

        // 4. Initialize W3C MediaRecorder for Composite Video
        const mimeType = getSupportedMimeType();
        const options = mimeType ? { mimeType, videoBitsPerSecond: 2500000 } : {};
        const mediaRecorder = new MediaRecorder(combinedStream, options);
        mediaRecorderRef.current = mediaRecorder;

        mediaRecorder.ondataavailable = (event) => {
          if (mediaRecorderRef.current === mediaRecorder && event.data && event.data.size > 0) {
            recordedChunksRef.current.push(event.data);
          }
        };

        // 5. Initialize Parallel Audio-Only Recorder for Gemini Subtitle Processing (~25MB vs 1.5GB)
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
            console.warn('[useLectureRecorder] Parallel audio recorder could not start, continuing with video only:', audioRecErr);
            audioRecorderRef.current = null;
          }
        }

        // 6. Generate unique UUID Session ID & initialize Firestore document
        const sessionId = `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        activeSessionIdRef.current = sessionId;
        setActiveSessionId(sessionId);

        const effectiveSessionGroupId =
          sessionGroupId ||
          resolveSessionGroupId({
            classId,
            broadcastSessionId,
            schedule,
            timestamp: new Date(),
          });

        const sessionMeta = {
          title: title || `Lecture - ${new Date().toLocaleDateString()}`,
          topic: topic || '',
          targetLanguages: targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
          mimeType: mediaRecorder.mimeType || mimeType,
          startedAt: serverTimestamp(),
          status: 'recording',
          teacherUid: teacherUid || null,
          teacherEmail: teacherEmail || null,
          classId,
          sessionGroupId: effectiveSessionGroupId,
          broadcastSessionId: broadcastSessionId || null,
        };
        metadataRef.current = sessionMeta;

        const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${sessionId}`);
        await setDoc(sessionDocRef, sessionMeta);

        // Start recorder with 10-second timeslice chunking to avoid memory bloat
        mediaRecorder.start(10000);
        setRecordingState('recording');

        // Start duration timer
        timerIntervalRef.current = setInterval(() => {
          durationRef.current += 1;
          setDurationSeconds(durationRef.current);
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
    [classId, teacherUid, teacherEmail, recordingState, cleanupStreams, stopTimer]
  );

  /**
   * Pause the current recording (e.g. for break or lab exercise).
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
   * Resume recording after a pause.
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
      setDurationSeconds(durationRef.current);
    }, 1000);

    if (classId && activeSessionIdRef.current) {
      const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${activeSessionIdRef.current}`);
      updateDoc(sessionDocRef, { isPaused: false }).catch(() => {});
    }
  }, [classId]);

  /**
   * Stop recording, assemble video blob, and upload directly to Cloud Storage.
   */
  const stopRecording = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
      return null;
    }

    stopTimer();
    const finalDuration = durationRef.current;
    const sessionId = activeSessionIdRef.current;
    setRecordingState('uploading');
    isStartingOrRecordingRef.current = false;

    return new Promise((resolve, reject) => {
      mediaRecorderRef.current.onstop = async () => {
        try {
          cleanupStreams();

          const mimeType = mediaRecorderRef.current?.mimeType || 'video/webm';
          const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(recordedChunksRef.current, { type: mimeType });

          if (blob.size === 0) {
            throw new Error('Recorded lecture file is empty.');
          }

          // Upload parallel pure-audio track if recorded (~25MB Opus vs ~1.2GB Video)
          let audioUrl = null;
          let audioStoragePath = null;
          let audioFileSize = null;

          if (audioRecordedChunksRef.current.length > 0) {
            try {
              const audioMimeType = audioRecorderRef.current?.mimeType || 'audio/webm';
              const audioExt = audioMimeType.includes('mp4') ? 'm4a' : 'webm';
              const audioBlob = new Blob(audioRecordedChunksRef.current, { type: audioMimeType });

              if (audioBlob.size > 0) {
                audioStoragePath = `recordings/${classId}/${sessionId}/lecture_audio.${audioExt}`;
                const audioRef = storageRef(storage, audioStoragePath);
                const audioUploadTask = await uploadBytesResumable(audioRef, audioBlob, {
                  contentType: audioMimeType,
                  customMetadata: {
                    classId,
                    sessionId,
                    durationSeconds: String(finalDuration),
                    teacherEmail,
                  },
                });
                audioUrl = await getDownloadURL(audioUploadTask.ref);
                audioFileSize = audioBlob.size;
              }
            } catch (audioErr) {
              console.warn('[useLectureRecorder] Parallel audio upload failed, continuing with video only:', audioErr);
            }
          }

          // Upload to Cloud Storage: recordings/{classId}/{sessionId}/lecture.{ext}
          const filePath = `recordings/${classId}/${sessionId}/lecture.${ext}`;
          const fileRef = storageRef(storage, filePath);
          const uploadTask = uploadBytesResumable(fileRef, blob, {
            contentType: mimeType,
            customMetadata: {
              classId,
              sessionId,
              durationSeconds: String(finalDuration),
              teacherEmail,
            },
          });

          uploadTask.on(
            'state_changed',
            (snapshot) => {
              const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
              setUploadProgress(progress);
            },
            (uploadErr) => {
              console.error('[useLectureRecorder] Upload error:', uploadErr);
              setError('Failed to upload lecture video to Cloud Storage.');
              setRecordingState('error');
              reject(uploadErr);
            },
            async () => {
              try {
                const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);

                // Update Firestore session document
                const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${sessionId}`);
                await updateDoc(sessionDocRef, {
                  status: 'processing_subtitles',
                  videoUrl: downloadUrl,
                  storagePath: filePath,
                  audioUrl: audioUrl || null,
                  audioStoragePath: audioStoragePath || null,
                  fileSize: blob.size,
                  audioFileSize: audioFileSize || null,
                  durationSeconds: finalDuration,
                  endedAt: serverTimestamp(),
                });

                setRecordingState('completed');

                // Automatically trigger Gemini subtitle & chapter processing in the background
                try {
                  const callSubtitles = httpsCallable(functions, 'processLectureSubtitles');
                  callSubtitles({
                    classId,
                    sessionId,
                    storagePath: filePath,
                    title: metadataRef.current?.title || `Lecture - ${new Date().toLocaleDateString()}`,
                    topic: metadataRef.current?.topic || '',
                  }).catch((err) => {
                    console.warn('[useLectureRecorder] Background subtitle trigger failed (can retry in UI):', err);
                  });
                } catch (triggerErr) {
                  console.warn('[useLectureRecorder] Failed to invoke processLectureSubtitles:', triggerErr);
                }

                const result = {
                  sessionId,
                  videoUrl: downloadUrl,
                  storagePath: filePath,
                  audioUrl: audioUrl || null,
                  audioStoragePath: audioStoragePath || null,
                  durationSeconds: finalDuration,
                  fileSize: blob.size,
                  audioFileSize: audioFileSize || null,
                };

                if (typeof onRecordingComplete === 'function') {
                  onRecordingComplete(result);
                }

                resolve(result);
              } catch (updateErr) {
                console.error('[useLectureRecorder] Finalize error:', updateErr);
                setError(updateErr.message);
                setRecordingState('error');
                reject(updateErr);
              }
            }
          );
        } catch (processErr) {
          console.error('[useLectureRecorder] OnStop processing error:', processErr);
          setError(processErr.message);
          setRecordingState('error');
          reject(processErr);
        }
      };

      try {
        if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
          try {
            audioRecorderRef.current.stop();
          } catch {}
        }
        mediaRecorderRef.current.stop();
      } catch (stopErr) {
        reject(stopErr);
      }
    });
  }, [classId, teacherEmail, stopTimer, cleanupStreams, onRecordingComplete]);

  /**
   * Discard/Cancel recording (the safety hatch).
   * Deletes in-memory buffers and removes the Firestore draft with zero storage or AI cost.
   */
  const discardRecording = useCallback(async () => {
    isStartingOrRecordingRef.current = false;
    stopTimer();
    cleanupStreams();

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
    durationRef.current = 0;
    setDurationSeconds(0);

    if (classId && activeSessionIdRef.current) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/lectureRecordings/${activeSessionIdRef.current}`);
        await updateDoc(sessionDocRef, { status: 'discarded', discardedAt: serverTimestamp() });
      } catch {}
    }

    setActiveSessionId(null);
    activeSessionIdRef.current = null;
    setRecordingState('idle');
  }, [classId, stopTimer, cleanupStreams]);

  /**
   * Merges multiple lecture clips (by sessionGroupId or explicit recordingIds) into a single master lecture.
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
          // Auto-trigger processLectureSubtitles for the master combined lecture
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
        }
        return result.data;
      } catch (err) {
        console.error('[useLectureRecorder] Failed to merge recordings:', err);
        throw err;
      }
    },
    [classId]
  );

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
        try {
          mediaRecorderRef.current.stop();
        } catch {}
      }
      if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
        try {
          audioRecorderRef.current.stop();
        } catch {}
      }
    };
  }, [stopTimer, cleanupStreams]);

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
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    discardRecording,
    mergeSessionRecordings,
  };
}
