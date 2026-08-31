import { useState, useEffect, useRef, useCallback } from 'react';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
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
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(() => {});
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
    if (!classId || !studentUid || isUploadingRef.current) return;
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

      const expireAt = new Date(Date.now() + (retentionDays || 30) * 86400000);

      // 2. Write metadata document in Firestore audio/{audioId}
      const audioDocRef = doc(collection(db, 'audio'));
      await setDoc(audioDocRef, {
        audioId: audioDocRef.id,
        classId,
        studentUid,
        studentEmail,
        audioPath: fullAudioPath,
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

      // 3. Mirror latest audio path in status/{studentUid}
      try {
        const statusDocRef = doc(db, `classes/${classId}/status/${studentUid}`);
        await updateDoc(statusDocRef, {
          latestAudioPath: fullAudioPath,
          isAudioSharing: true,
          audioLevel: peakVol,
          audioStatus: peakVol >= 50 ? 'speaking' : 'normal',
          lastAudioTimestamp: new Date(now),
        });
      } catch {
        // Status doc might not exist yet, ignore
      }

      setUploadedSegmentsCount(c => c + 1);
      onAudioUploaded?.({
        path: fullAudioPath,
        timestamp: now,
        size: blob.size,
        strideIndex,
        windowStartSec: windowStartOffsetSec,
      });
    } catch (err) {
      console.warn('Network error uploading audio segment, buffering in IndexedDB:', err);
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

            const expireAt = new Date(itemTime + (item.metadata?.retentionDays || 30) * 86400000);
            const audioDocRef = doc(collection(db, 'audio'));
            await setDoc(audioDocRef, {
              audioId: audioDocRef.id,
              classId: item.classId,
              studentUid: item.studentUid,
              studentEmail: item.studentEmail || '',
              audioPath,
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

  // Process and emit sliding window blob
  const processSlidingWindow = useCallback((mimeType) => {
    const now = Date.now();
    const windowStartTimestamp = now - (effWindowSec * 1000);
    const sessionElapsedSec = Math.max(0, Math.round((now - sessionStartTimestampRef.current) / 1000) - effWindowSec);

    // Filter chunks falling within the last windowDuration
    const relevantChunks = rollingChunksRef.current.filter(c => c.timestamp >= windowStartTimestamp);
    if (relevantChunks.length === 0) return;

    const blobs = relevantChunks.map(c => c.blob);
    const windowBlob = new Blob(blobs, { type: mimeType });

    // Compute volume statistics across current buffer
    const samples = volumeSamplesRef.current;
    const avgVol = samples.length > 0 ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
    const peakVol = samples.length > 0 ? Math.max(...samples) : 0;

    strideCountRef.current += 1;
    uploadAudioSegment(windowBlob, peakVol, avgVol, sessionElapsedSec);

    // Prune chunks older than window duration + buffer
    const purgeBefore = now - ((effWindowSec + 10) * 1000);
    rollingChunksRef.current = rollingChunksRef.current.filter(c => c.timestamp >= purgeBefore);
  }, [effWindowSec, uploadAudioSegment]);

  // Start recording stream
  const startRecording = useCallback(async () => {
    setAudioError(null);
    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      audioStreamRef.current = stream;
      setAudioStream(stream);
      startVolumeAnalysis(stream);

      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      rollingChunksRef.current = [];
      volumeSamplesRef.current = [];
      strideCountRef.current = 0;
      sessionStartTimestampRef.current = Date.now();

      // Collect 1-second chunks for granular sliding buffer
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          rollingChunksRef.current.push({
            blob: event.data,
            timestamp: Date.now(),
          });
        }
      };

      // Set up rolling stride interval
      const strideIntervalMs = effStrideSec * 1000;
      strideTimerRef.current = setInterval(() => {
        if (recorder.state === 'recording') {
          processSlidingWindow(mimeType);
        }
      }, strideIntervalMs);

      recorder.onstop = () => {
        if (strideTimerRef.current) {
          clearInterval(strideTimerRef.current);
          strideTimerRef.current = null;
        }
        setIsRecording(false);
      };

      // Request data in 1-second timeslices
      recorder.start(1000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);

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
      console.error('Error starting audio recorder:', err);
      setAudioError(err.message || 'Microphone capture error');
      setIsRecording(false);
      return null;
    }
  }, [deviceId, effStrideSec, processSlidingWindow, startVolumeAnalysis, classId, studentUid]);

  // Stop recording stream
  const stopRecording = useCallback(() => {
    if (strideTimerRef.current) {
      clearInterval(strideTimerRef.current);
      strideTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {
        console.warn('Error stopping MediaRecorder:', e);
      }
    }

    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => track.stop());
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

    setIsRecording(false);
    setCurrentVolume(0);

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

  // Automatically start/stop when enabled flag or effectiveMode changes
  useEffect(() => {
    const isModeActive = effectiveMode !== 'disabled';
    if (enabled && isModeActive && classId && studentUid && !isRecording) {
      startRecording();
    } else if ((!enabled || !isModeActive) && isRecording) {
      stopRecording();
    }

    return () => {
      // Unconditional cleanup on unmount
      stopRecording();
    };
  }, [enabled, effectiveMode, classId, studentUid]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isRecording,
    audioStream,
    currentVolume,
    audioLevel: currentVolume / 100,
    isSpeaking: currentVolume >= 15,
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
