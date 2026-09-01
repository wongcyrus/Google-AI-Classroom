import { useState, useEffect, useRef, useCallback } from 'react';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase-config';
import { saveToOfflineQueue, flushOfflineQueue } from '../utils/offlineBufferManager';

/**
 * Hook to manage background audio recording with Moving Window (Sliding Rolling Buffer) support,
 * silence suppression, and direct Cloud Storage upload + Firestore metadata recording.
 */
export function useAudioRecorder({
  classId,
  studentUid,
  studentEmail = '',
  enabled = false,
  aiMonitoringMode = 'hybrid', // 'hybrid' | 'client_only' | 'cloud_only' | 'server_only' | 'disabled'
  segmentDuration = 30, // seconds (or window duration)
  windowDuration = 30,  // seconds for moving window
  strideDuration = 15,  // seconds between sliding strides (50% overlap)
  enableMovingWindow = true,
  silenceSuppression = true,
  retentionDays = 30,
  deviceId = '',
  onAudioUploaded = null,
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
  useEffect(() => {
    onAudioUploadedRef.current = onAudioUploaded;
  }, [onAudioUploaded]);

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
        if (normalized >= 15) {
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
  }, [effWindowSec]);

  // Upload a single audio window blob to Storage and Firestore
  const uploadAudioSegment = useCallback(async (blob, peakVol, avgVol, windowStartOffsetSec = 0) => {
    if (!classId || !studentUid || isUploadingRef.current || !isRecordingRef.current) return;
    if (!blob || blob.size === 0) return;

    // Silence suppression check: if enabled and average volume < 4% and peak < 8%
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

    isUploadingRef.current = true;
    const now = Date.now();
    const strideIndex = strideCountRef.current;
    const fileName = `audio_${now}_stride_${strideIndex}.webm`;
    const fullAudioPath = `audio/${classId}/${studentUid}/${fileName}`;
    const fileRef = storageRef(storage, fullAudioPath);

    try {
      // 1. Upload .webm blob to Cloud Storage
      const snapshot = await uploadBytes(fileRef, blob, {
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

      // Resolve direct public download URL immediately
      let downloadUrl = null;
      try {
        downloadUrl = await getDownloadURL(fileRef);
      } catch (err) {
        console.warn('[useAudioRecorder] Could not resolve download URL immediately:', err);
      }

      const expireAt = new Date(Date.now() + (retentionDays || 30) * 86400000);

      // 2. Write metadata document in Firestore audio/{audioId}
      const audioDocRef = doc(collection(db, 'audio'));
      await setDoc(audioDocRef, {
        audioId: audioDocRef.id,
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
        size: snapshot.metadata?.size || blob.size,
        peakVolume: peakVol,
        averageVolume: avgVol,
        hasVoiceActivity: peakVol >= 15,
        timestamp: new Date(now),
        expireAt,
        deleted: false,
      });

      console.log(`[useAudioRecorder] ✅ Uploaded audio segment & recorded Firestore doc audio/${audioDocRef.id} with audioUrl:`, downloadUrl);

      // 3. Mirror latest audio path and download URL in status/{studentUid}
      try {
        const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
        await setDoc(statusDocRef, {
          latestAudioPath: fullAudioPath,
          latestAudioUrl: downloadUrl,
          isAudioSharing: true,
          audioLevel: peakVol,
          audioStatus: peakVol >= 50 ? 'speaking' : 'normal',
          lastAudioTimestamp: new Date(now),
        }, { merge: true });
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
    } catch (err) {
      console.warn('[useAudioRecorder] ❌ Network error uploading audio segment, buffering in IndexedDB:', err);
      try {
        await saveToOfflineQueue({
          type: 'audio',
          classId,
          studentUid,
          studentEmail,
          blob,
          timestamp: now,
          metadata: {
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
      } catch (queueErr) {
        console.error('Failed to buffer audio offline:', queueErr);
      }
    } finally {
      isUploadingRef.current = false;
    }
  }, [classId, studentUid, studentEmail, effWindowSec, effStrideSec, enableMovingWindow, silenceSuppression, retentionDays, onAudioUploaded]);

  // Auto-flush offline queue when back online
  useEffect(() => {
    const handleOnline = async () => {
      try {
        await flushOfflineQueue({
          uploadItemHandler: async (item) => {
            if (item.type !== 'audio') return;
            const itemTime = item.timestamp || Date.now();
            const dateStr = new Date(itemTime).toISOString().slice(0, 10);
            const fileName = `audio_${item.studentUid}_${itemTime}.webm`;
            const audioPath = `audio/${item.classId}/${dateStr}/${item.studentUid}/${fileName}`;
            const fileRef = storageRef(storage, audioPath);

            await uploadBytes(fileRef, item.blob, {
              contentType: 'audio/webm',
              customMetadata: {
                classId: item.classId,
                studentUid: item.studentUid,
                studentEmail: item.studentEmail || '',
                isBackfilled: 'true',
              },
            });

            let downloadUrl = null;
            try {
              downloadUrl = await getDownloadURL(fileRef);
            } catch {}

            const expireAt = new Date(itemTime + (item.metadata?.retentionDays || 30) * 86400000);
            const audioDocRef = doc(collection(db, 'audio'));
            await setDoc(audioDocRef, {
              audioId: audioDocRef.id,
              classId: item.classId,
              studentUid: item.studentUid,
              studentEmail: item.studentEmail || '',
              audioPath,
              audioUrl: downloadUrl,
              duration: item.metadata?.duration || 30,
              strideDuration: item.metadata?.strideDuration || 15,
              strideIndex: item.metadata?.strideIndex || 0,
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
      } catch (err) {
        console.warn('Error flushing offline audio queue:', err);
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      return () => window.removeEventListener('online', handleOnline);
    }
  }, []);

  const isRecordingRef = useRef(false);

  // Start recording stream with standalone segment cycling for 100% valid container headers
  const startRecording = useCallback(async () => {
    if (isRecordingRef.current) return;
    isRecordingRef.current = true;
    setAudioError(null);
    console.log('%c[useAudioRecorder:Start] 🎙️ Starting recording stream with deviceId:', 'background:#0891b2;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', deviceId || '(system default)');
    try {
      let stream = null;
      if (deviceId) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              deviceId: { exact: deviceId },
              autoGainControl: true,
              echoCancellation: true,
              noiseSuppression: false,
            },
            video: false,
          });
        } catch (exactErr) {
          const isConstraintOrDeviceErr = exactErr && (
            exactErr.name === 'OverconstrainedError' ||
            exactErr.name === 'ConstraintNotSatisfiedError' ||
            exactErr.name === 'NotFoundError' ||
            exactErr.name === 'DevicesNotFoundError' ||
            /constraint|overconstrained|not found/i.test(exactErr.message || '')
          );
          if (!isConstraintOrDeviceErr) {
            throw exactErr;
          }
          console.warn('[useAudioRecorder] Exact deviceId match failed, trying ideal:', exactErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                deviceId: { ideal: deviceId },
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: false,
              },
              video: false,
            });
          } catch (idealErr) {
            console.warn('[useAudioRecorder] Ideal deviceId match failed, trying default audio:', idealErr);
            stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                autoGainControl: true,
                echoCancellation: true,
                noiseSuppression: false,
              },
              video: false,
            });
          }
        }
      } else {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: false,
          },
          video: false,
        });
      }

      audioStreamRef.current = stream;
      setAudioStream(stream);
      startVolumeAnalysis(stream);

      const tracks = stream.getAudioTracks();
      const activeTrack = tracks[0];
      console.log('%c[useAudioRecorder:TrackAcquired] ✅ Microphone track acquired:', 'background:#059669;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
        requestedDeviceId: deviceId || '(default)',
        actualLabel: activeTrack?.label || 'unknown',
        actualDeviceId: activeTrack?.getSettings?.().deviceId || deviceId,
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

            uploadAudioSegment(segmentBlob, peakVol, avgVol, sessionElapsedSec);
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
      console.error('[useAudioRecorder] ❌ Error starting audio recorder:', err);
      setAudioError(err.message || 'Microphone capture error');
      isRecordingRef.current = false;
      setIsRecording(false);
      return null;
    }
  }, [deviceId, effStrideSec, uploadAudioSegment, startVolumeAnalysis, classId, studentUid]);

  // Stop recording stream
  const stopRecording = useCallback(() => {
    console.log('[useAudioRecorder] ⏹️ Stopping audio recording...');
    isRecordingRef.current = false;
    setIsRecording(false);
    setCurrentVolume(0);

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
    setAudioStream(null);

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }

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
  }, [classId, studentUid]);

  const currentDeviceIdRef = useRef(deviceId);

  // Automatically start/stop when enabled flag or params change
  useEffect(() => {
    const shouldRecord = Boolean(enabled && classId && studentUid);
    const deviceChanged = currentDeviceIdRef.current !== deviceId;
    currentDeviceIdRef.current = deviceId;

    if (shouldRecord) {
      if (deviceChanged && isRecordingRef.current) {
        console.log('[useAudioRecorder] 🔄 Microphone deviceId changed to:', deviceId || '(default)', '- switching stream...');
        stopRecording();
        startRecording();
      } else if (!isRecordingRef.current) {
        startRecording();
      }
    } else if (!shouldRecord && isRecordingRef.current) {
      stopRecording();
    }
  }, [enabled, effectiveMode, classId, studentUid, deviceId, startRecording, stopRecording]);

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
