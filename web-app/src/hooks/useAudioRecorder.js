import { useState, useEffect, useRef, useCallback } from 'react';
import { ref as storageRef, uploadBytes } from 'firebase/storage';
import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { storage, db } from '../firebase-config';

/**
 * Hook to manage background audio recording with Moving Window (Sliding Rolling Buffer) support,
 * silence suppression, and direct Cloud Storage upload + Firestore metadata recording.
 */
export function useAudioRecorder({
  classId,
  studentUid,
  studentEmail = '',
  enabled = false,
  segmentDuration = 30, // seconds (or window duration)
  windowDuration = 30,  // seconds for moving window
  strideDuration = 15,  // seconds between sliding strides (50% overlap)
  enableMovingWindow = true,
  silenceSuppression = true,
  retentionDays = 30,
  deviceId = '',
  onAudioUploaded = null,
} = {}) {
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
      console.error('Failed to upload audio segment:', err);
    } finally {
      isUploadingRef.current = false;
    }
  }, [classId, studentUid, studentEmail, effWindowSec, effStrideSec, enableMovingWindow, silenceSuppression, retentionDays, onAudioUploaded]);

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

      return stream;
    } catch (err) {
      console.error('Error starting audio recorder:', err);
      setAudioError(err.message || 'Microphone capture error');
      setIsRecording(false);
      return null;
    }
  }, [deviceId, effStrideSec, processSlidingWindow, startVolumeAnalysis]);

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
  }, []);

  // Automatically start/stop when enabled flag changes
  useEffect(() => {
    if (enabled && classId && studentUid && !isRecording) {
      startRecording();
    } else if (!enabled && isRecording) {
      stopRecording();
    }

    return () => {
      // Unconditional cleanup on unmount
      stopRecording();
    };
  }, [enabled, classId, studentUid]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    isRecording,
    audioStream,
    currentVolume,
    audioLevel: currentVolume / 100,
    isSpeaking: currentVolume >= 15,
    hasMicPermission: !audioError,
    audioError,
    uploadedSegmentsCount,
    startRecording,
    stopRecording,
  };
}

export default useAudioRecorder;
