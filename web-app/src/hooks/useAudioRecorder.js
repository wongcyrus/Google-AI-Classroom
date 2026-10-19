import { useState, useEffect, useRef, useCallback } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase-config';
import { saveToOfflineQueue, flushOfflineQueue } from '../utils/offlineBufferManager';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

/**
 * Hook to manage background audio recording with Moving Window (Sliding Rolling Buffer) support,
 * silence suppression, and direct Cloud Storage upload + Firestore metadata recording.
 */
export function useAudioRecorder({
  classId,
  studentUid,
  studentEmail = '',
  enabled = false,
  enableCloudUpload = true,
  aiMonitoringMode = 'hybrid', // 'hybrid' | 'client_only' | 'cloud_only' | 'server_only' | 'disabled'
  segmentDuration = 30, // seconds (or window duration)
  windowDuration = 30,  // seconds for moving window
  strideDuration = 15,  // seconds between sliding strides (50% overlap)
  enableMovingWindow = true,
  silenceSuppression = true,
  vadSensitivity = 15,
  retentionDays = 30,
  deviceId = '',
  onAudioUploaded = null,
  onDeviceResolved = null,
} = {}) {
  // Derive effective mode
  const effectiveMode = (() => {
    const m = String(aiMonitoringMode || 'hybrid').toLowerCase();
    if (m === 'disabled') return 'disabled';
    if (m === 'client_only') return 'client_only';
    if (m === 'cloud_only' || m === 'server_only') return 'cloud_only';
    return 'hybrid';
  })();

  const [isRecording, setIsRecording] = useState(false);
  const [audioStream, setAudioStream] = useState(null);
  const audioStreamRef = useRef(null);
  const [currentVolume, setCurrentVolume] = useState(0);
  const [isSpeakingState, setIsSpeakingState] = useState(false);
  const speechHangoverTimerRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const [audioError, setAudioError] = useState(null);
  const [uploadedSegmentsCount, setUploadedSegmentsCount] = useState(0);
  const [defaultDeviceRevision, setDefaultDeviceRevision] = useState(0);

  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const isUploadingRef = useRef(false);
  const volumeSamplesRef = useRef([]);

  // Rolling chunk storage for moving window
  const rollingChunksRef = useRef([]); // array of { blob, timestamp, durationSec }
  const strideTimerRef = useRef(null);
  const strideCountRef = useRef(0);
  const sessionStartTimestampRef = useRef(Date.now());
  const onAudioUploadedRef = useRef(onAudioUploaded);
  const onDeviceResolvedRef = useRef(onDeviceResolved);
  useEffect(() => {
    onAudioUploadedRef.current = onAudioUploaded;
    onDeviceResolvedRef.current = onDeviceResolved;
  }, [onAudioUploaded, onDeviceResolved]);

  // Effective window and stride settings
  const effWindowSec = Math.max(10, enableMovingWindow ? (windowDuration || segmentDuration || 30) : (segmentDuration || 30));
  const effStrideSec = Math.max(5, enableMovingWindow ? (strideDuration || 15) : effWindowSec);

  // Calculate volume level continuously for VAD and UI
  const startVolumeAnalysis = useCallback((stream) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    try {
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        try {
          audioContextRef.current.resume().catch(() => {});
        } catch {
          audioContextRef.current = new AudioCtx();
        }
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const analyser = audioContextRef.current.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const loop = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const normalized = Math.min(100, Math.round((avg / 128) * 100));

        setCurrentVolume(normalized);
        volumeSamplesRef.current.push(normalized);

        // Smooth speaking indicator with 1.5s hangover
        if (normalized >= vadSensitivity) {
          if (speechHangoverTimerRef.current) {
            clearTimeout(speechHangoverTimerRef.current);
            speechHangoverTimerRef.current = null;
          }
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true;
            setIsSpeakingState(true);
          }
        } else if (isSpeakingRef.current && !speechHangoverTimerRef.current) {
          speechHangoverTimerRef.current = setTimeout(() => {
            isSpeakingRef.current = false;
            setIsSpeakingState(false);
            speechHangoverTimerRef.current = null;
          }, 1500);
        }

        // Retain samples for the active window duration (~30s * 60fps = 1800 samples)
        const maxSamples = effWindowSec * 60;
        if (volumeSamplesRef.current.length > maxSamples) {
          volumeSamplesRef.current.splice(0, volumeSamplesRef.current.length - maxSamples);
        }

        animationFrameRef.current = requestAnimationFrame(loop);
      };

      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.warn('Volume analysis setup failed:', e);
    }
  }, [effWindowSec, vadSensitivity]);

  const uploadLockTimerRef = useRef(null);
  const uploadAttemptRef = useRef(0);

  // Upload a single audio window blob to Storage and Firestore
  const uploadAudioSegment = useCallback(async (blob, peakVol, avgVol, windowStartOffsetSec = 0) => {
    if (!classId || !studentUid || isUploadingRef.current || !isRecordingRef.current) return;
    if (!blob || blob.size === 0) return;

    // Suppress only consistently silent windows; VAD sensitivity should not discard quiet speech.
    if (silenceSuppression && avgVol < 4 && peakVol < 8) {
      // Update status doc so teacher knows microphone is active and listening
      try {
        const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
        setDoc(statusDocRef, {
          isAudioSharing: true,
          audioLevel: peakVol,
          audioStatus: 'silent',
          lastAudioHeartbeat: new Date(),
        }, { merge: true }).catch(() => {});
      } catch {}
      return;
    }

    const currentAttempt = ++uploadAttemptRef.current;
    isUploadingRef.current = true;
    if (uploadLockTimerRef.current) clearTimeout(uploadLockTimerRef.current);
    uploadLockTimerRef.current = setTimeout(() => {
      if (isUploadingRef.current && uploadAttemptRef.current === currentAttempt) {
        console.warn('[useAudioRecorder] Audio upload safety timeout (15s) elapsed, unlocking.');
        isUploadingRef.current = false;
      }
    }, 15000);

    const now = Date.now();
    const strideIndex = strideCountRef.current;
    const fileName = `audio_${now}_stride_${strideIndex}.webm`;
    const fullAudioPath = `audio/${classId}/${studentUid}/${fileName}`;
    const audioDocId = `${classId}_${studentUid}_${now}_${strideIndex}`;
    const fileRef = storageRef(storage, fullAudioPath);
    let storageUploaded = false;
    let downloadUrl = null;
    let isTimeoutError = false;

    try {
      // 1. Upload .webm blob to Cloud Storage (with 15s timeout so hung sockets never stall capture)
      const uploadPromise = uploadBytes(fileRef, blob, {
        contentType: 'audio/webm',
        customMetadata: {
          classId,
          studentUid,
          studentEmail,
          duration: String(effWindowSec),
          strideDuration: String(effStrideSec),
          strideIndex: String(strideIndex),
          isSlidingWindow: String(enableMovingWindow),
          windowStartSec: String(windowStartOffsetSec),
          peakVolume: String(peakVol),
        },
      });
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => {
          isTimeoutError = true;
          reject(new Error('Audio segment upload timed out after 15s'));
        }, 15000)
      );
      const snapshot = await Promise.race([uploadPromise, timeoutPromise]);
      storageUploaded = true;

      // Resolve direct public download URL immediately
      try {
        downloadUrl = await getDownloadURL(fileRef);
      } catch (err) {
        console.warn('[useAudioRecorder] Could not resolve download URL immediately:', err);
      }

      const expireAt = new Date(Date.now() + (retentionDays || 30) * 86400000);

      // 2. Write metadata document in Firestore audio/{audioId} using deterministic ID for retry idempotency
      const audioDocRef = doc(collection(db, 'audio'), audioDocId);
      await Promise.race([
        setDoc(audioDocRef, {
          audioId: audioDocRef.id || audioDocId,
          classId,
          studentUid,
          studentEmail,
          audioPath: fullAudioPath,
          audioUrl: downloadUrl,
          aiMonitoringMode: effectiveMode,
          allowCloudDiarization: effectiveMode === 'hybrid' || effectiveMode === 'cloud_only',
          duration: effWindowSec,
          strideDuration: effStrideSec,
          strideIndex,
          isSlidingWindow: enableMovingWindow,
          windowStartSec: windowStartOffsetSec,
          windowEndSec: windowStartOffsetSec + effWindowSec,
          size: snapshot?.metadata?.size || blob.size,
          peakVolume: peakVol,
          averageVolume: avgVol,
          hasVoiceActivity: peakVol >= 15,
          timestamp: new Date(now),
          expireAt,
          deleted: false,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Audio Firestore metadata write timed out after 10s')), 10000)
        ),
      ]);

      console.log(`[useAudioRecorder] ✅ Uploaded audio segment & recorded Firestore doc audio/${audioDocRef.id || audioDocId} with audioUrl:`, downloadUrl);

      // 3. Mirror latest audio path and download URL in status/{studentUid}
      try {
        const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
        setDoc(statusDocRef, {
          latestAudioPath: fullAudioPath,
          latestAudioUrl: downloadUrl,
          isAudioSharing: true,
          audioLevel: peakVol,
          audioStatus: peakVol >= 50 ? 'speaking' : 'normal',
          lastAudioTimestamp: new Date(now),
        }, { merge: true }).catch((err) => {
          console.warn('[useAudioRecorder] Could not update status doc:', err);
        });
      } catch (err) {
        console.warn('[useAudioRecorder] Could not update status doc:', err);
      }

      setUploadedSegmentsCount(c => c + 1);
      onAudioUploadedRef.current?.({
        path: fullAudioPath,
        url: downloadUrl,
        timestamp: now,
        size: blob.size,
        strideIndex,
        windowStartSec: windowStartOffsetSec,
        blob,
      });

      // If previous segments timed out while navigator.onLine stayed true, drain them now
      if (hasOfflineAudioRef.current) {
        flushOfflineAudioRef.current?.();
      }
    } catch (err) {
      console.warn('[useAudioRecorder] ❌ Network error uploading audio segment, buffering in IndexedDB:', err);
      try {
        await saveToOfflineQueue({
          id: `audio_${audioDocId}`,
          type: 'audio',
          classId,
          studentUid,
          studentEmail,
          blob,
          timestamp: now,
          metadata: {
            audioPath: fullAudioPath,
            audioDocId,
            alreadyUploaded: storageUploaded,
            timedOut: isTimeoutError,
            downloadUrl: downloadUrl || null,
            aiMonitoringMode: effectiveMode,
            allowCloudDiarization: effectiveMode === 'hybrid' || effectiveMode === 'cloud_only',
            duration: effWindowSec,
            strideDuration: effStrideSec,
            strideIndex,
            isSlidingWindow: enableMovingWindow,
            windowStartSec: windowStartOffsetSec,
            peakVolume: peakVol,
            averageVolume: avgVol,
            retentionDays: retentionDays || 30,
          },
        });
        hasOfflineAudioRef.current = true;
      } catch (queueErr) {
        console.error('Failed to buffer audio offline:', queueErr);
      }

      // Keep student audio sharing status active even when Cloud Storage upload fails
      try {
        if (isRecordingRef.current) {
          const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
          setDoc(statusDocRef, {
            isAudioSharing: true,
            audioLevel: peakVol,
            audioStatus: peakVol >= 50 ? 'speaking' : 'normal',
            lastAudioTimestamp: new Date(now),
          }, { merge: true }).catch(() => {});
        }
      } catch {}

      // Still dispatch blob to local LiteRT Whisper / Gemma 4 voice AI so on-device speech proctoring never drops
      try {
        onAudioUploadedRef.current?.({
          path: fullAudioPath,
          url: downloadUrl || null,
          timestamp: now,
          size: blob.size,
          strideIndex,
          windowStartSec: windowStartOffsetSec,
          blob,
          isOfflineBuffered: true,
        });
      } catch (cbErr) {
        console.warn('[useAudioRecorder] Error in onAudioUploaded offline fallback:', cbErr);
      }
    } finally {
      if (uploadAttemptRef.current === currentAttempt) {
        if (uploadLockTimerRef.current) clearTimeout(uploadLockTimerRef.current);
        isUploadingRef.current = false;
      }
    }
  }, [classId, studentUid, studentEmail, effWindowSec, effStrideSec, enableMovingWindow, silenceSuppression, vadSensitivity, retentionDays, effectiveMode]);

  const hasOfflineAudioRef = useRef(false);
  const flushOfflineAudioRef = useRef(null);

  // Auto-flush offline queue when back online or after recovery from a transient timeout
  useEffect(() => {
    const handleOnline = async () => {
      try {
        const res = await flushOfflineQueue({
          type: 'audio',
          uploadItemHandler: async (item) => {
            if (item.type !== 'audio') return false;
            const itemTime = item.timestamp || Date.now();
            const strideIndex = item.metadata?.strideIndex || 0;
            const fileName = `audio_${itemTime}_stride_${strideIndex}.webm`;
            const audioPath = item.metadata?.audioPath || `audio/${item.classId}/${item.studentUid}/${fileName}`;
            const fileRef = storageRef(storage, audioPath);

            let alreadyUploaded = Boolean(item.metadata?.alreadyUploaded);
            let downloadUrl = item.metadata?.downloadUrl || null;

            // If a 15s client timeout fired on uploadBytes, check if the slow upload actually completed in the background
            if (!alreadyUploaded && item.metadata?.timedOut) {
              try {
                downloadUrl = await getDownloadURL(fileRef);
                alreadyUploaded = true;
              } catch {
                alreadyUploaded = false;
              }
            }

            if (!alreadyUploaded) {
              await uploadBytes(fileRef, item.blob, {
                contentType: 'audio/webm',
                customMetadata: {
                  classId: item.classId,
                  studentUid: item.studentUid,
                  studentEmail: item.studentEmail || '',
                  duration: String(item.metadata?.duration || 30),
                  strideDuration: String(item.metadata?.strideDuration || 15),
                  strideIndex: String(strideIndex),
                  isSlidingWindow: String(Boolean(item.metadata?.isSlidingWindow)),
                  windowStartSec: String(item.metadata?.windowStartSec || 0),
                  peakVolume: String(item.metadata?.peakVolume || 0),
                  isBackfilled: 'true',
                },
              });
            }

            if (!downloadUrl) {
              try {
                downloadUrl = await getDownloadURL(fileRef);
              } catch {}
            }

            const expireAt = new Date(itemTime + (item.metadata?.retentionDays || 30) * 86400000);
            const docId = item.metadata?.audioDocId || `${item.classId}_${item.studentUid}_${itemTime}_${strideIndex}`;
            const audioDocRef = doc(collection(db, 'audio'), docId);
            const mode = item.metadata?.aiMonitoringMode || 'hybrid';
            const allowCloudDiarization =
              item.metadata?.allowCloudDiarization !== undefined
                ? Boolean(item.metadata.allowCloudDiarization)
                : mode === 'hybrid' || mode === 'cloud_only';

            await setDoc(audioDocRef, {
              audioId: audioDocRef.id || docId,
              classId: item.classId,
              studentUid: item.studentUid,
              studentEmail: item.studentEmail || '',
              audioPath,
              audioUrl: downloadUrl,
              aiMonitoringMode: mode,
              allowCloudDiarization,
              duration: item.metadata?.duration || 30,
              strideDuration: item.metadata?.strideDuration || 15,
              strideIndex,
              isSlidingWindow: Boolean(item.metadata?.isSlidingWindow),
              windowStartSec: item.metadata?.windowStartSec || 0,
              windowEndSec: (item.metadata?.windowStartSec || 0) + (item.metadata?.duration || 30),
              size: item.blob.size,
              peakVolume: item.metadata?.peakVolume || 0,
              averageVolume: item.metadata?.averageVolume || 0,
              hasVoiceActivity: (item.metadata?.peakVolume || 0) >= 15,
              timestamp: new Date(itemTime),
              expireAt,
              isBackfilled: true,
              deleted: false,
            });
          },
        });
        if (!res || res.remaining === 0) {
          hasOfflineAudioRef.current = false;
        }
      } catch (err) {
        console.warn('Error flushing offline audio queue:', err);
      }
    };

    flushOfflineAudioRef.current = handleOnline;

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
    }
  }, []);

  const isRecordingRef = useRef(false);
  const automaticStartFailureKeyRef = useRef('');
  const startAttemptRef = useRef(0);

  // Start recording stream with standalone segment cycling for 100% valid container headers
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    const startAttempt = ++startAttemptRef.current;
    isRecordingRef.current = true;
    setAudioError(null);
    console.log('%c[useAudioRecorder:Start] 🎙️ Starting recording stream with deviceId:', 'background:#0891b2;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', deviceId || '(system default)');
    try {
      const stream = await acquireInputDeviceStream('audio', deviceId, {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: false,
      });
      if (startAttempt !== startAttemptRef.current) {
        stream.getTracks().forEach(track => track.stop());
        return null;
      }

      audioStreamRef.current = stream;
      setAudioStream(stream);
      automaticStartFailureKeyRef.current = '';
      startVolumeAnalysis(stream);

      const tracks = stream.getAudioTracks();
      const activeTrack = tracks[0];
      const actualDeviceId = activeTrack?.getSettings?.().deviceId || '';
      if (
        actualDeviceId &&
        actualDeviceId !== deviceId &&
        deviceId !== 'default'
      ) {
        onDeviceResolvedRef.current?.(actualDeviceId);
      }
      console.log('%c[useAudioRecorder:TrackAcquired] ✅ Microphone track acquired:', 'background:#059669;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
        requestedDeviceId: deviceId || '(default)',
        actualLabel: activeTrack?.label || 'unknown',
        actualDeviceId: actualDeviceId || deviceId,
        readyState: activeTrack?.readyState,
        enabled: activeTrack?.enabled,
      });

      let effectiveMime = '';
      const candidateMimes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/aac',
        'audio/wav',
      ];

      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        for (const candidate of candidateMimes) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            effectiveMime = candidate;
            break;
          }
        }
      }

      console.log('[useAudioRecorder] ⏺️ MediaRecorder using MIME:', effectiveMime || 'default');

      volumeSamplesRef.current = [];
      strideCountRef.current = 0;
      sessionStartTimestampRef.current = Date.now();
      isRecordingRef.current = true;
      setIsRecording(true);

      const segmentDurationMs = Math.max(5000, (effStrideSec || 15) * 1000);

      const recordSegment = () => {
        if (!isRecordingRef.current || !audioStreamRef.current) return;

        let recorder;
        try {
          recorder = effectiveMime
            ? new MediaRecorder(audioStreamRef.current, { mimeType: effectiveMime })
            : new MediaRecorder(audioStreamRef.current);
        } catch {
          recorder = new MediaRecorder(audioStreamRef.current);
        }

        mediaRecorderRef.current = recorder;
        const segmentChunks = [];
        const segmentStart = Date.now();

        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            segmentChunks.push(event.data);
          }
        };

        recorder.onerror = (e) => {
          console.error('[useAudioRecorder] ❌ MediaRecorder error:', e);
        };

        recorder.onstop = () => {
          if (segmentChunks.length > 0) {
            const finalMime = effectiveMime || recorder.mimeType || 'audio/webm';
            const segmentBlob = new Blob(segmentChunks, { type: finalMime });

            const samples = volumeSamplesRef.current;
            const avgVol = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
            const peakVol = samples.length > 0 ? Math.max(...samples) : 0;
            volumeSamplesRef.current = []; // Reset for next segment

            const sessionElapsedSec = Math.max(0, Math.round((segmentStart - sessionStartTimestampRef.current) / 1000));
            strideCountRef.current += 1;

            if (enableCloudUpload) {
              uploadAudioSegment(segmentBlob, peakVol, avgVol, sessionElapsedSec);
            } else if (classId && studentUid) {
              // Update live audio telemetry in status doc without uploading blob to storage
              try {
                const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
                setDoc(statusDocRef, {
                  isAudioSharing: true,
                  audioLevel: peakVol,
                  audioStatus: peakVol >= 50 ? 'speaking' : (peakVol >= 15 ? 'active' : 'silent'),
                  lastAudioHeartbeat: new Date(),
                }, { merge: true }).catch(() => {});
              } catch {}
            }
          }

          // Cycle to the next segment if still recording
          if (isRecordingRef.current && audioStreamRef.current) {
            recordSegment();
          }
        };

        // Start recorder cleanly (generates fresh EBML container header for this file)
        recorder.start();

        // Schedule stop for this segment
        strideTimerRef.current = setTimeout(() => {
          if (recorder && recorder.state === 'recording') {
            try {
              recorder.stop();
            } catch (err) {
              console.warn('[useAudioRecorder] Error stopping segment recorder:', err);
            }
          }
        }, segmentDurationMs);
      };

      // Kick off first segment
      recordSegment();
      console.log('[useAudioRecorder] 🟢 Recording active. Segment duration:', effStrideSec, 'seconds.');

      // Immediately notify status doc that microphone recording has started
      try {
        if (classId && studentUid) {
          const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
          setDoc(statusDocRef, {
            isAudioSharing: true,
            audioLevel: 0,
            audioStatus: 'idle',
            lastAudioHeartbeat: new Date(),
          }, { merge: true }).catch(() => {});
        }
      } catch {}

      return stream;
    } catch (err) {
      if (startAttempt !== startAttemptRef.current) {
        return null;
      }
      console.error('[useAudioRecorder] ❌ Error starting audio recorder:', err);
      setAudioError(err.message || 'Microphone capture error');
      automaticStartFailureKeyRef.current = `${classId}:${studentUid}:${deviceId}`;
      isRecordingRef.current = false;
      setIsRecording(false);
      return null;
    }
  }, [deviceId, effStrideSec, enableCloudUpload, uploadAudioSegment, startVolumeAnalysis, classId, studentUid]);

  // Stop recording stream
  const stopRecording = useCallback((options = {}) => {
    const isRestarting = Boolean(options?.restarting);
    console.log('[useAudioRecorder] ⏹️ Stopping audio recording...');
    startAttemptRef.current += 1;
    isRecordingRef.current = false;
    if (!isRestarting) {
      setIsRecording(false);
      setCurrentVolume(0);
    }

    if (strideTimerRef.current) {
      clearTimeout(strideTimerRef.current);
      strideTimerRef.current = null;
    }

    if (mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.onstop = null;
        mediaRecorderRef.current.ondataavailable = null;
        if (mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
        }
      } catch (e) {
        console.warn('[useAudioRecorder] Error stopping MediaRecorder:', e);
      }
      mediaRecorderRef.current = null;
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    if (!isRestarting) {
      setAudioStream(null);
    }

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

    if (!isRestarting) {
      try {
        if (classId && studentUid) {
          const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
          setDoc(statusDocRef, {
            isAudioSharing: false,
            audioLevel: 0,
            audioStatus: 'inactive',
          }, { merge: true }).catch(() => {});
        }
      } catch {}
    }
  }, [classId, studentUid]);

  const recordingConfigKey = [
    deviceId,
    defaultDeviceRevision,
    effWindowSec,
    effStrideSec,
    enableMovingWindow,
    enableCloudUpload,
    silenceSuppression,
    vadSensitivity,
    effectiveMode,
  ].join(':');
  const currentRecordingConfigRef = useRef(recordingConfigKey);

  useEffect(() => {
    if (
      (deviceId !== '' && deviceId !== 'default') ||
      !navigator.mediaDevices?.addEventListener
    ) {
      return;
    }

    const handleDefaultDeviceChange = () => {
      setDefaultDeviceRevision(revision => revision + 1);
    };
    navigator.mediaDevices.addEventListener('devicechange', handleDefaultDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        handleDefaultDeviceChange
      );
    };
  }, [deviceId]);

  // Automatically start/stop when enabled flag or params change
  useEffect(() => {
    const shouldRecord = Boolean(enabled && classId && studentUid);
    const configurationChanged =
      currentRecordingConfigRef.current !== recordingConfigKey;
    const startKey = `${classId}:${studentUid}:${deviceId}`;
    currentRecordingConfigRef.current = recordingConfigKey;

    if (shouldRecord) {
      if (configurationChanged && isRecordingRef.current) {
        console.log('[useAudioRecorder] 🔄 Audio capture settings changed; restarting the recording stream.');
        stopRecording({ restarting: true });
        startRecording();
      } else if (
        !isRecordingRef.current &&
        automaticStartFailureKeyRef.current !== startKey
      ) {
        startRecording();
      }
    } else if (!shouldRecord) {
      automaticStartFailureKeyRef.current = '';
      if (isRecordingRef.current) {
        stopRecording();
      }
    }
  }, [enabled, classId, studentUid, deviceId, recordingConfigKey, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isRecording,
    audioStream,
    currentVolume,
    audioLevel: currentVolume / 100,
    isSpeaking: isSpeakingState,
    hasMicPermission: !audioError,
    audioError,
    effectiveMode,
    isCloudDiarizationAllowed: effectiveMode === 'hybrid' || effectiveMode === 'cloud_only',
    uploadedSegmentsCount,
    startRecording,
    stopRecording,
  };
}

export default useAudioRecorder;
