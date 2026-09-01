/**
 * useClientLiteRTWhisper.js
 * 
 * Custom hook to run on-device Whisper STT via Google LiteRT.js in a Web Worker,
 * store transcribed speech in Firestore, and sync real-time speech telemetry
 * to the Teacher Monitor View.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, updateDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { isWhisperModelCached, DEFAULT_WHISPER_CONFIG } from '../utils/webAiLiteRTLoader';
import { downsamplePcmTo16k } from '../utils/audioDecoder';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

export function useClientLiteRTWhisper({
  classId,
  studentUid,
  enabled = true,
  audioMonitoringMode = 'litert_whisper',
  speechLanguage = 'zh-HK',
  audioStream = null,
  deviceId = '',
  onTranscript,
}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'transcribing' | 'error'
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelCached, setIsModelCached] = useState(false);
  const [delegateUsed, setDelegateUsed] = useState('wasm');
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestLanguage, setLatestLanguage] = useState('mixed');
  const [error, setError] = useState(null);

  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const workerRef = useRef(null);
  const pendingRequestsRef = useRef(new Map());
  const reqIdCounterRef = useRef(0);

  // Check initial cache state
  useEffect(() => {
    let isMounted = true;
    isWhisperModelCached().then((cached) => {
      if (isMounted) setIsModelCached(cached);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Initialize Worker instance
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/litertWhisper.worker.js', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (event) => {
        const { type, payload, id } = event.data;

        if (type === 'STATUS') {
          if (payload?.status) setStatus(payload.status);
          if (typeof payload?.progress === 'number') setLoadingProgress(payload.progress);
        } else if (type === 'PROGRESS') {
          setLoadingProgress(payload.progress);
        } else if (type === 'INIT_COMPLETE') {
          setStatus('ready');
          setLoadingProgress(100);
          setIsModelCached(true);
          if (payload?.delegate) setDelegateUsed(payload.delegate);
          const resolve = pendingRequestsRef.current.get(id);
          if (resolve) {
            resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'TRANSCRIBE_COMPLETE') {
          setStatus('ready');
          setLatestTranscript(payload.transcript || '');
          setLatestLanguage(payload.language || 'mixed');
          const resolve = pendingRequestsRef.current.get(id);
          if (resolve) {
            resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'ERROR') {
          setError(payload?.error || 'Worker error');
          setStatus('error');
          const reject = pendingRequestsRef.current.get(id);
          if (reject) {
            reject(new Error(payload?.error || 'Worker error'));
            pendingRequestsRef.current.delete(id);
          }
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('[useClientLiteRTWhisper] Worker error:', err);
        setError(err.message || 'Worker initialization failed');
        setStatus('error');
      };
    } catch (e) {
      console.warn('[useClientLiteRTWhisper] Failed to instantiate worker:', e);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'DISPOSE' });
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, []);

  /**
   * Preload the LiteRT Whisper model into CacheStorage.
   */
  const preloadModel = useCallback(async () => {
    if (!workerRef.current) return;
    setStatus('loading');
    setLoadingProgress(5);
    setError(null);

    return new Promise((resolve, reject) => {
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, resolve);
      workerRef.current.postMessage({
        type: 'INIT',
        id,
        payload: { modelUrl: DEFAULT_WHISPER_CONFIG.modelUrl },
      });
      // Safety timeout after 60s
      setTimeout(() => {
        if (pendingRequestsRef.current.has(id)) {
          pendingRequestsRef.current.delete(id);
          setStatus('error');
          setError('Model download timeout');
          reject(new Error('Model download timeout'));
        }
      }, 60000);
    });
  }, []);

  // Auto-init worker when enabled
  useEffect(() => {
    if (enabled && workerRef.current && status === 'idle') {
      preloadModel().catch(e => console.debug('[useClientLiteRTWhisper] Auto-init note:', e));
    }
  }, [enabled, status, preloadModel]);

  const classIdRef = useRef(classId);
  const studentUidRef = useRef(studentUid);
  const speechLanguageRef = useRef(speechLanguage);
  const statusRef = useRef(status);
  const deviceIdRef = useRef(deviceId);

  useEffect(() => {
    classIdRef.current = classId;
    studentUidRef.current = studentUid;
    speechLanguageRef.current = speechLanguage;
    statusRef.current = status;
    deviceIdRef.current = deviceId;
  }, [classId, studentUid, speechLanguage, status, deviceId]);

  const preloadModelRef = useRef(preloadModel);
  useEffect(() => {
    preloadModelRef.current = preloadModel;
  }, [preloadModel]);

  /**
   * Transcribe a 16kHz PCM audio chunk, store the result in Firestore,
   * and update live telemetry for the teacher monitor view.
   */
  const transcribeAudioChunk = useCallback(async (audioPcm, metadata = {}) => {
    if (!workerRef.current) return null;

    if (statusRef.current !== 'ready') {
      try {
        await preloadModelRef.current?.();
      } catch (e) {
        console.debug('[useClientLiteRTWhisper] Preload fallback:', e);
      }
    }

    const { audioPath = '', duration = 30, simulatedText = '' } = metadata;
    console.log(`[useClientLiteRTWhisper] 🎙️ Dispatching audio chunk to LiteRT Worker (samples: ${audioPcm?.length || 0}, path: ${audioPath || 'live'})`);

    return new Promise((resolve) => {
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, async (result) => {
        const text = (result?.transcript || simulatedText || '').trim();
        const language = result?.language || 'mixed';
        const timestamp = Date.now();

        if (text) {
          setLatestTranscript(text);
          if (onTranscriptRef.current) {
            try {
              onTranscriptRef.current(text, { language, timestamp, isFinal: true });
            } catch (err) {
              console.warn('[useClientLiteRTWhisper] onTranscript callback error:', err);
            }
          }
          console.log(
            `%c[LiteRT Whisper STT] 🎙️ Speech Transcribed: %c"${text}" %c(Lang: ${language}, Engine: LiteRT Whisper, Device: ${deviceIdRef.current || 'default'})`,
            'background: #064e3b; color: #34d399; font-weight: bold; font-size: 13px; padding: 2px 6px; border-radius: 4px;',
            'color: #ffffff; font-weight: bold; font-size: 13px;',
            'color: #94a3b8; font-size: 11px;'
          );
        }

        // 1. Atomically update classes/{classId}/status/{studentUid} for MonitorView
        const currentClassId = classIdRef.current;
        const currentStudentUid = studentUidRef.current;
        if (currentClassId && currentStudentUid && text) {
          try {
            const statusDocRef = doc(db, 'classes', currentClassId, 'status', currentStudentUid);
            await setDoc(
              statusDocRef,
              {
                liveTranscript: text,
                liveTranscriptTimestamp: timestamp,
                speechLanguage: language,
                clientWhisperStatus: 'ready',
                isAudioSharing: true,
                audioStatus: 'speaking',
                selectedMicDeviceId: deviceIdRef.current || '',
              },
              { merge: true }
            );
          } catch (err) {
            console.error('[useClientLiteRTWhisper] Failed to update live transcript status:', err);
          }

          // 2. Persist permanent audio record in Firestore if text exists
          if (audioPath) {
            try {
              const audioColl = collection(db, 'audio');
              await addDoc(audioColl, {
                classId: currentClassId,
                studentUid: currentStudentUid,
                audioPath,
                duration,
                transcript: text,
                language,
                sttEngine: 'litert_whisper_tiny',
                deviceId: deviceIdRef.current || 'default',
                timestamp: serverTimestamp(),
              });
            } catch (err) {
              console.error('[useClientLiteRTWhisper] Failed to save permanent transcript doc:', err);
            }
          }
        }

        resolve({ transcript: text, language, timestamp });
      });

      console.log('%c[useClientLiteRTWhisper:Dispatch] 🚀 Dispatching audio chunk to LiteRT Worker:', 'background:#d97706;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
        samples: audioPcm?.length,
        durationSec: audioPcm ? (audioPcm.length / 16000).toFixed(1) : 0,
        path: audioPath || 'live_stream',
        deviceId: deviceIdRef.current || '(default)',
      });

      workerRef.current.postMessage({
        type: 'TRANSCRIBE',
        id,
        payload: {
          audioPcm,
          audioPath,
          studentUid: studentUidRef.current,
          classId: classIdRef.current,
          deviceId: deviceIdRef.current || 'default',
          simulatedText,
          language: speechLanguageRef.current,
          speechLanguage: speechLanguageRef.current,
          timestamp: Date.now(),
        },
      });
    });
  }, []);

  // 1. Real-time audio stream listener for the selected microphone stream
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let isMounted = true;
    let localStream = null;
    let audioCtx = null;
    let source = null;
    let processor = null;
    let muteGain = null;

    // Buffer for speech PCM accumulation
    let speechPcmChunks = [];
    let silenceTimer = null;
    let isSpeechActive = false;

    const flushSpeechBuffer = () => {
      if (speechPcmChunks.length === 0) return;

      let totalSamples = 0;
      for (const chunk of speechPcmChunks) {
        totalSamples += chunk.length;
      }
      if (totalSamples < 3200) { // Under 0.2s of audio, likely a transient click
        speechPcmChunks = [];
        isSpeechActive = false;
        return;
      }

      const mergedPcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of speechPcmChunks) {
        mergedPcm.set(chunk, offset);
        offset += chunk.length;
      }

      const durationSec = Math.max(1, Math.round(totalSamples / 16000));
      speechPcmChunks = [];
      isSpeechActive = false;

      console.log('%c[useClientLiteRTWhisper:Flush] 🎙️ Processing speech buffer from selected mic:', 'background:#2563eb;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
        totalSamples,
        durationSec,
        deviceId: deviceIdRef.current || '(default)',
      });
      transcribeAudioChunk(mergedPcm, { duration: durationSec }).catch((err) => {
        console.debug('[useClientLiteRTWhisper] Stream STT dispatch error:', err);
      });
    };

    const attachStream = (targetStream) => {
      if (!isMounted || !targetStream) return;
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }

        const tracks = targetStream.getAudioTracks();
        const activeTrack = tracks && tracks[0];
        console.log('%c[useClientLiteRTWhisper:Attach] 🎙️ Attaching Whisper to microphone track:', 'background:#7c3aed;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
          label: activeTrack?.label || 'unknown',
          deviceId: activeTrack?.getSettings?.().deviceId || deviceIdRef.current || '(default)',
          readyState: activeTrack?.readyState,
          enabled: activeTrack?.enabled,
          sampleRate: audioCtx.sampleRate,
        });

        source = audioCtx.createMediaStreamSource(targetStream);
        if (typeof audioCtx.createScriptProcessor === 'function') {
          processor = audioCtx.createScriptProcessor(4096, 1, 1);

          processor.onaudioprocess = (e) => {
            if (!isMounted) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16k = downsamplePcmTo16k(inputData, audioCtx.sampleRate, 16000);

            // Calculate RMS volume on 16kHz chunk
            let sumSq = 0;
            for (let i = 0; i < pcm16k.length; i++) {
              sumSq += pcm16k[i] * pcm16k[i];
            }
            const rms = Math.sqrt(sumSq / pcm16k.length);

            // Sensitive VAD threshold (0.0020) for external USB mics and quiet/whispering voices
            if (rms >= 0.0020) {
              if (!isSpeechActive) {
                isSpeechActive = true;
                console.log('%c[useClientLiteRTWhisper:VAD] 🗣️ Speech detected on mic:', 'background:#059669;color:white;padding:2px 6px;border-radius:4px;', {
                  rms: rms.toFixed(4),
                  deviceId: deviceIdRef.current || '(default)',
                });
              }
              if (silenceTimer) {
                clearTimeout(silenceTimer);
                silenceTimer = null;
              }
              speechPcmChunks.push(pcm16k);

              // If accumulated speech exceeds 5 seconds, flush to transcribe segment
              const accumulatedSamples = speechPcmChunks.reduce((acc, c) => acc + c.length, 0);
              if (accumulatedSamples >= 16000 * 5) {
                flushSpeechBuffer();
              }
            } else if (isSpeechActive) {
              speechPcmChunks.push(pcm16k);

              if (!silenceTimer) {
                silenceTimer = setTimeout(() => {
                  if (isMounted) {
                    flushSpeechBuffer();
                  }
                  silenceTimer = null;
                }, 800);
              }
            }
          };

          source.connect(processor);
          muteGain = audioCtx.createGain();
          muteGain.gain.value = 0;
          processor.connect(muteGain);
          muteGain.connect(audioCtx.destination);

          console.log('[useClientLiteRTWhisper] 🎙️ Live audio processor attached to selected microphone stream (SampleRate:', audioCtx.sampleRate, ')');
        }
      } catch (err) {
        console.warn('[useClientLiteRTWhisper] Web Audio stream processor setup failed:', err);
      }
    };

    const initStream = async () => {
      if (audioStream) {
        attachStream(audioStream);
        return;
      }

      // If audioStream not passed yet from parent, acquire selected mic device directly
      const targetDeviceId = deviceId || (() => {
        try {
          return localStorage.getItem('preferred_mic_device_id') || '';
        } catch {
          return '';
        }
      })();

      try {
        localStream = await acquireInputDeviceStream('audio', targetDeviceId, {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: false,
        });

        if (isMounted && localStream) {
          attachStream(localStream);
        } else if (localStream) {
          localStream.getTracks().forEach(t => t.stop());
        }
      } catch (err) {
        console.warn('[useClientLiteRTWhisper] Direct microphone acquisition note:', err);
      }
    };

    initStream();

    return () => {
      isMounted = false;
      if (silenceTimer) clearTimeout(silenceTimer);
      if (isSpeechActive) flushSpeechBuffer();

      if (processor) {
        processor.onaudioprocess = null;
        try { processor.disconnect(); } catch {}
      }
      if (source) {
        try { source.disconnect(); } catch {}
      }
      if (muteGain) {
        try { muteGain.disconnect(); } catch {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try { audioCtx.close(); } catch {}
      }
      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
    };
  }, [enabled, audioStream, deviceId, transcribeAudioChunk]);

  return {
    status,
    loadingProgress,
    isModelCached,
    delegateUsed,
    latestTranscript,
    latestLanguage,
    error,
    preloadModel,
    transcribeAudioChunk,
    setLatestTranscript,
  };
}
