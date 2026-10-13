/**
 * useTeacherLiveSubtitles.js
 * 
 * Custom hook managing teacher lecture live speech recognition and translation.
 * Supports 2 selectable engines:
 * 1. 'server': On-device LiteRT Whisper + Cloud Function Gemini 3.5 Flash-Lite (translateTeacherSpeech) [Recommended]
 * 2. 'client': On-device LiteRT Whisper + LiteRT.js Gemma 4 E2B (with cloud fallback)
 * 
 * Publishes live subtitles to classes/{classId}/liveSubtitles/current in Firestore.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase-config';
import { transcribeAudioWithFirebaseAI } from '../utils/aiLogic';
import { attachAudioProcessor } from '../utils/audioWorkletHelper';
import { isTeacherEmail } from '../utils/domainConfig';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';
import { isGemmaModelCached } from '../utils/gemmaLiteRTLoader';

const DEFAULT_TARGET_LANGS = ['zh-Hans', 'en'];
const MAX_CONTINUOUS_SPEECH_SAMPLES = 16000 * 15; // Auto-flush after 15s of non-stop speech
const DUPLICATE_SUBTITLE_WINDOW_MS = 2000;

function isMobileOrIosBrowser() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPhone|iPad|iPod|Android|CriOS|FxiOS/i.test(ua) ||
    (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1)
  );
}

/**
 * Detects common Whisper silence/background-noise hallucination tokens so they
 * do not suppress the Cloud AI transcription fallback or publish bogus subtitles.
 */
export function isWhisperNoiseArtifact(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return true;
  return /^(\[.*\]|\(.*\)|♪+.*♪*|thank you\.?|thanks for watching\.?|you\.?)$/i.test(trimmed);
}

export function useTeacherLiveSubtitles({
  classId,
  teacherUid,
  teacherEmail = '',
  enabled = false,
  audioStream = null,
  deviceId = '',
  courseContext = '',
  subtitlePrompt = null,
  customPrompt = null,
  targetLanguages: initialTargetLanguages = null,
}) {
  // Engine Mode: 'server' (default & recommended) | 'client' (LiteRT.js Whisper + Gemma 4)
  const [engineMode, setEngineModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      if (isMobileOrIosBrowser()) {
        try {
          localStorage.setItem('teacher_subtitle_engine_mode', 'server');
        } catch {}
        return 'server';
      }
      const saved = localStorage.getItem('teacher_subtitle_engine_mode');
      if (saved === 'client' || saved === 'server') return saved;
      return 'server';
    }
    return 'server';
  });

  const [speechLanguage, setSpeechLanguageState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('teacher_subtitle_source_lang') || 'zh-HK';
    }
    return 'zh-HK';
  });

  const [targetLanguages, setTargetLanguagesState] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('teacher_subtitle_target_langs');
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    if (Array.isArray(initialTargetLanguages) && initialTargetLanguages.length > 0) {
      return initialTargetLanguages;
    }
    return DEFAULT_TARGET_LANGS;
  });

  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'listening' | 'translating' | 'error'
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestTranslations, setLatestTranslations] = useState({});
  const [error, setError] = useState(null);
  const [isGemmaAvailable, setIsGemmaAvailable] = useState(false);
  const [gemmaProgress, setGemmaProgress] = useState(0);
  const [isGemmaCached, setIsGemmaCached] = useState(false);
  const [isGemmaInitializing, setIsGemmaInitializing] = useState(false);
  const [gemmaUnavailableReason, setGemmaUnavailableReason] = useState('');
  const [micVolume, setMicVolume] = useState(0);
  const [activeAudioStream, setActiveAudioStream] = useState(null);

  const seqCounterRef = useRef(0);
  const latestPublishedSeqRef = useRef(0);
  const lastPublishedTextRef = useRef('');
  const lastPublishedAtRef = useRef(0);
  const historyBufferRef = useRef([]);
  const workerRef = useRef(null);
  const gemmaWorkerRef = useRef(null);
  const isGemmaReadyRef = useRef(false);
  const pendingRequestsRef = useRef(new Map());
  const reqIdCounterRef = useRef(0);
  const isWhisperReadyRef = useRef(false);
  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    let isMounted = true;
    isGemmaModelCached()
      .then((cached) => {
        if (isMounted) setIsGemmaCached(Boolean(cached));
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, []);

  const activePrompt = subtitlePrompt || customPrompt;
  const customPromptText = typeof activePrompt === 'string'
    ? activePrompt
    : (activePrompt?.promptText || '');

  // Setters with localStorage persistence
  const setEngineMode = useCallback((mode) => {
    const validMode = mode === 'client' ? 'client' : 'server';
    setEngineModeState(validMode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('teacher_subtitle_engine_mode', validMode);
    }
  }, []);

  const setSpeechLanguage = useCallback((lang) => {
    setSpeechLanguageState(lang);
    if (typeof window !== 'undefined') {
      localStorage.setItem('teacher_subtitle_source_lang', lang);
    }
  }, []);

  const setTargetLanguages = useCallback((langs) => {
    setTargetLanguagesState(langs);
    if (typeof window !== 'undefined') {
      localStorage.setItem('teacher_subtitle_target_langs', JSON.stringify(langs));
    }
  }, []);

  // Initialize LiteRT Whisper Web Worker for on-device STT
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/litertWhisper.worker.js', import.meta.url)
      );

      workerRef.current.onmessage = (event) => {
        const { type, payload, id } = event.data;
        if (type === 'INIT_COMPLETE') {
          isWhisperReadyRef.current = true;
          if (enabledRef.current) {
            setStatus('listening');
          }
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'TRANSCRIBE_COMPLETE') {
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'ERROR') {
          setError(payload?.error || 'Whisper worker error');
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.reject(new Error(payload?.error || 'Whisper error'));
            pendingRequestsRef.current.delete(id);
          }
        }
      };

      // Request initialization
      const initId = ++reqIdCounterRef.current;
      workerRef.current.postMessage({
        type: 'INIT',
        id: initId,
        payload: {
          delegate: 'wasm',
          speechLanguage,
        },
      });
    } catch (err) {
      console.warn('[useTeacherLiveSubtitles] Worker initialization notice:', err);
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [speechLanguage]);

  const terminateGemmaWorker = useCallback(() => {
    if (gemmaWorkerRef.current) {
      gemmaWorkerRef.current.terminate();
      gemmaWorkerRef.current = null;
      isGemmaReadyRef.current = false;
      setIsGemmaAvailable(false);
      setIsGemmaInitializing(false);
      setGemmaProgress(0);
      for (const [reqId, pending] of pendingRequestsRef.current.entries()) {
        if (pending.source === 'gemma') {
          pending.reject(new Error('Gemma worker terminated'));
          pendingRequestsRef.current.delete(reqId);
        }
      }
    }
  }, []);

  const ensureGemmaWorker = useCallback(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    if (gemmaWorkerRef.current) return gemmaWorkerRef.current;

    try {
      gemmaWorkerRef.current = new Worker(
        new URL('../workers/litertGemma.worker.js', import.meta.url)
      );

      gemmaWorkerRef.current.onmessage = (event) => {
        const { type, payload, id } = event.data || {};
        if (type === 'INIT_COMPLETE') {
          const ready = payload?.ready === true && payload?.engine === 'litert_lm_gemma_e2b';
          isGemmaReadyRef.current = ready;
          setIsGemmaAvailable(ready);
          setIsGemmaInitializing(false);
          setGemmaProgress(ready ? 100 : 0);
          if (payload?.cached) {
            setIsGemmaCached(true);
          }
          setGemmaUnavailableReason(ready ? '' : (payload?.unavailableReason || ''));
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'PROGRESS' || type === 'STATUS') {
          if (typeof payload?.progress === 'number') {
            setGemmaProgress(payload.progress);
          }
        } else if (type === 'TRANSLATE_COMPLETE') {
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'ERROR') {
          console.warn('[useTeacherLiveSubtitles] Gemma worker error:', payload?.error);
          if (!isGemmaReadyRef.current) {
            setGemmaProgress(0);
            setIsGemmaInitializing(false);
            if (payload?.error) {
              setGemmaUnavailableReason(payload.error);
            }
          }
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.reject(new Error(payload?.error || 'Gemma translation error'));
            pendingRequestsRef.current.delete(id);
          }
        }
      };
      return gemmaWorkerRef.current;
    } catch (err) {
      console.warn('[useTeacherLiveSubtitles] Gemma worker initialization notice:', err);
      return null;
    }
  }, []);

  // Explicitly download/load the ~1.9 GB Gemma 4 model only when user clicks the Download/Load button
  const loadGemmaModel = useCallback(() => {
    if (isMobileOrIosBrowser()) {
      setGemmaUnavailableReason(
        'On-device Gemma 4 (~1.9 GB) exceeds mobile browser memory limits; using Cloud fallback.'
      );
      setIsGemmaAvailable(false);
      setIsGemmaInitializing(false);
      setGemmaProgress(0);
      return;
    }
    const worker = ensureGemmaWorker();
    if (!worker || isGemmaReadyRef.current) return;
    setIsGemmaInitializing(true);
    setGemmaUnavailableReason('');
    setGemmaProgress((prev) => (prev > 0 && prev < 100 ? prev : 5));
    const initId = ++reqIdCounterRef.current;
    worker.postMessage({
      type: 'INIT',
      id: initId,
      payload: {
        delegate: 'wasm',
      },
    });
  }, [ensureGemmaWorker]);

  // Manage LiteRT Gemma 4 worker shell when in client engine mode (without auto-downloading the 1.9 GB model)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
    if (engineMode !== 'client') {
      terminateGemmaWorker();
      return;
    }

    ensureGemmaWorker();

    return () => {
      terminateGemmaWorker();
    };
  }, [engineMode, ensureGemmaWorker, terminateGemmaWorker]);

  // Translate clean transcript using selected model (Client LiteRT Gemma 4 vs Server Cloud Gemini)
  const translateTranscript = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return {};

    if (engineMode === 'client') {
      // 1. Try On-Device LiteRT Gemma 4 Worker first
      if (gemmaWorkerRef.current && isGemmaReadyRef.current) {
        try {
          const reqId = ++reqIdCounterRef.current;
          const gemmaPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              pendingRequestsRef.current.delete(reqId);
              reject(new Error('Gemma translation timed out'));
            }, 10000);

            pendingRequestsRef.current.set(reqId, {
              source: 'gemma',
              resolve: (val) => {
                clearTimeout(timeout);
                resolve(val);
              },
              reject: (err) => {
                clearTimeout(timeout);
                reject(err);
              },
            });
          });

          gemmaWorkerRef.current.postMessage({
            type: 'TRANSLATE_TRANSCRIPT',
            id: reqId,
            payload: {
              transcript: trimmed,
              sourceLang: speechLanguage,
              targetLangs: targetLanguages,
              courseContext,
              customPrompt: customPromptText,
            },
          });

          const result = await gemmaPromise;
          const gemmaTranslations = result?.translations || {};
          const missingLangs = targetLanguages.filter((l) => !gemmaTranslations[l]);
          if (missingLangs.length === 0) {
            return gemmaTranslations;
          }

          // Fallback to Server Model for missing languages
          try {
            const recentHistoryStrings = (historyBufferRef.current || [])
              .slice(-4)
              .map((entry) => entry.originalText)
              .filter(Boolean);

            const callTranslate = httpsCallable(functions, 'translateTeacherSpeech');
            const response = await callTranslate({
              classId,
              text: trimmed,
              sourceLang: speechLanguage,
              targetLangs: missingLangs,
              context: courseContext,
              customPrompt: customPromptText,
              historyText: recentHistoryStrings,
            });
            const serverMissing = response.data?.translations || {};
            return { ...gemmaTranslations, ...serverMissing };
          } catch (serverFallbackErr) {
            console.warn('[useTeacherLiveSubtitles] Server fallback for missing languages failed:', serverFallbackErr);
            const merged = { ...gemmaTranslations };
            missingLangs.forEach((l) => { merged[l] = trimmed; });
            return merged;
          }
        } catch (gemmaErr) {
          console.warn('[useTeacherLiveSubtitles] On-device Gemma translation fallback:', gemmaErr);
        }
      }
    }

    // Server Model: Cloud Function with Gemini 3.5 Flash-Lite / 3.8 Flash
    try {
      const recentHistoryStrings = (historyBufferRef.current || [])
        .slice(-4)
        .map((entry) => entry.originalText)
        .filter(Boolean);

      const callTranslate = httpsCallable(functions, 'translateTeacherSpeech');
      const response = await callTranslate({
        classId,
        text: trimmed,
        sourceLang: speechLanguage,
        targetLangs: targetLanguages,
        context: courseContext,
        customPrompt: customPromptText,
        historyText: recentHistoryStrings,
      });
      return response.data?.translations || {};
    } catch (serverErr) {
      console.error('[useTeacherLiveSubtitles] Server translation error:', serverErr);
      // Fallback: at least show original
      const fallback = {};
      targetLanguages.forEach((l) => { fallback[l] = trimmed; });
      return fallback;
    }
  }, [engineMode, targetLanguages, speechLanguage, classId, courseContext, customPromptText]);

  // Publish subtitle frame to Firestore
  const publishSubtitle = useCallback(async (originalText, customTranslations = null, isFinal = true) => {
    if (!classId || !originalText || !originalText.trim()) return;

    const trimmed = originalText.trim();
    const now = Date.now();

    // Guard against duplicate consecutive final subtitles emitted by parallel STT streams
    if (
      isFinal &&
      !customTranslations &&
      trimmed === lastPublishedTextRef.current &&
      now - lastPublishedAtRef.current < DUPLICATE_SUBTITLE_WINDOW_MS
    ) {
      return;
    }
    if (isFinal) {
      lastPublishedTextRef.current = trimmed;
      lastPublishedAtRef.current = now;
    }

    // Assign sequence number BEFORE awaiting async translation so out-of-order network responses
    // never overwrite a newer subtitle with an older one.
    const seq = ++seqCounterRef.current;

    setLatestTranscript(trimmed);
    if (isFinal) {
      setStatus('translating');
    }

    try {
      const translations = customTranslations || (await translateTranscript(trimmed));

      const newEntry = {
        seq,
        originalText: trimmed,
        translations,
        timestamp: Date.now(),
      };

      // Keep last 5 entries in history buffer if final turn (maintain chronological order by seq)
      let updatedHistory = historyBufferRef.current;
      if (isFinal) {
        updatedHistory = [...historyBufferRef.current, newEntry]
          .sort((a, b) => a.seq - b.seq)
          .slice(-5);
        historyBufferRef.current = updatedHistory;
      }

      // If a newer subtitle has already finished translating and been published while this
      // older request was in flight, do not overwrite liveSubtitles/current with stale data.
      if (seq < latestPublishedSeqRef.current) {
        return;
      }
      latestPublishedSeqRef.current = seq;
      setLatestTranslations(translations);

      const subDocRef = doc(db, 'classes', classId, 'liveSubtitles', 'current');
      await setDoc(subDocRef, {
        seq,
        originalText: trimmed,
        sourceLang: speechLanguage,
        translations,
        targetLanguages,
        engine: engineMode,
        active: true,
        speakerUid: teacherUid || '',
        speakerEmail: teacherEmail || '',
        timestamp: serverTimestamp(),
        recentHistory: updatedHistory,
      });

      setStatus('listening');
    } catch (err) {
      console.error('[useTeacherLiveSubtitles] Failed to publish subtitle:', err);
      setStatus('listening');
    }
  }, [classId, translateTranscript, speechLanguage, targetLanguages, engineMode, teacherUid, teacherEmail]);

  const publishSubtitleRef = useRef(publishSubtitle);
  useEffect(() => {
    publishSubtitleRef.current = publishSubtitle;
  });

  const targetLanguagesKey = Array.isArray(targetLanguages) ? targetLanguages.join(',') : '';

  // Audio Stream Processing (LiteRT Whisper VAD buffering & Web Speech recognition)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setStatus('idle');
      setMicVolume(0);
      setActiveAudioStream(null);
      return;
    }

    // Defense-in-depth: Ensure non-instructor account cannot capture or broadcast subtitles
    if (teacherEmail && !isTeacherEmail(teacherEmail)) {
      console.warn('[useTeacherLiveSubtitles] Aborting: User is not an authorized instructor.');
      return;
    }

    let isMounted = true;
    const hasAudioTracks = (stream) => Boolean(
      stream &&
      typeof stream.getAudioTracks === 'function' &&
      stream.getAudioTracks().length > 0
    );
    let localStream = hasAudioTracks(audioStream) ? audioStream : null;
    let ownStreamCreated = false;
    let audioCtx = null;
    let source = null;
    let processor = null;
    let recognition = null;

    let pcmBuffer = [];
    let pcmBufferedSamples = 0;
    let silenceTimeout = null;
    let hasSpeechActivity = false;
    let isRecognitionActive = false;
    let restartTimeout = null;
    let lastSpeechRecInterimAt = 0;

    const clearPendingVadBuffer = () => {
      pcmBuffer = [];
      pcmBufferedSamples = 0;
      hasSpeechActivity = false;
      if (silenceTimeout) {
        clearTimeout(silenceTimeout);
        silenceTimeout = null;
      }
    };

    const safeStartRecognition = () => {
      if (!isMounted || !recognition) return;
      if (restartTimeout) {
        clearTimeout(restartTimeout);
        restartTimeout = null;
      }
      restartTimeout = setTimeout(() => {
        if (!isMounted || !recognition || isRecognitionActive) return;
        try {
          recognition.start();
        } catch (startErr) {
          console.debug('[useTeacherLiveSubtitles] Recognition restart notice:', startErr);
        }
      }, 250);
    };

    const flushBufferToWhisper = async () => {
      if (!isMounted || pcmBuffer.length === 0) return;

      let totalSamples = 0;
      for (const chunk of pcmBuffer) totalSamples += chunk.length;

      // Discard clicks under ~0.25s (4000 samples @ 16kHz)
      if (totalSamples < 4000) {
        clearPendingVadBuffer();
        return;
      }

      const mergedPcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of pcmBuffer) {
        mergedPcm.set(chunk, offset);
        offset += chunk.length;
      }

      clearPendingVadBuffer();

      // Dispatch to LiteRT Whisper Worker
      if (workerRef.current) {
        const id = ++reqIdCounterRef.current;
        new Promise((resolve, reject) => {
          pendingRequestsRef.current.set(id, { source: 'whisper', resolve, reject });
          workerRef.current.postMessage({
            type: 'TRANSCRIBE',
            id,
            payload: {
              audioPcm: mergedPcm,
              language: speechLanguage,
              speechLanguage,
              timestamp: Date.now(),
            },
          });
        }).then(async (result) => {
          if (!isMounted) return;
          const rawTranscript = (result?.transcript || '').trim();
          let text = isWhisperNoiseArtifact(rawTranscript) ? '' : rawTranscript;

          if (!text && mergedPcm && mergedPcm.length >= 8000) {
            try {
              const aiTranscript = await transcribeAudioWithFirebaseAI(
                mergedPcm,
                16000,
                speechLanguage,
                { courseContext, customPrompt: customPromptText }
              );
              if (aiTranscript && aiTranscript.trim()) {
                text = aiTranscript.trim();
              }
            } catch (aiErr) {
              console.debug('[useTeacherLiveSubtitles] Firebase AI Logic transcription fallback notice:', aiErr);
            }
          }
          if (isMounted && text) {
            publishSubtitleRef.current?.(text);
          }
        }).catch(async (err) => {
          console.debug('[useTeacherLiveSubtitles] Whisper transcription error:', err);
          if (!isMounted) return;
          if (mergedPcm && mergedPcm.length >= 8000) {
            try {
              const aiTranscript = await transcribeAudioWithFirebaseAI(
                mergedPcm,
                16000,
                speechLanguage,
                { courseContext, customPrompt: customPromptText }
              );
              if (isMounted && aiTranscript && aiTranscript.trim()) {
                publishSubtitleRef.current?.(aiTranscript.trim());
              }
            } catch (aiErr) {
              console.debug('[useTeacherLiveSubtitles] Firebase AI Logic transcription fallback on rejection notice:', aiErr);
            }
          }
        });
      }
    };

    const setupAudio = async () => {
      try {
        if (!hasAudioTracks(localStream)) {
          localStream = null;
          try {
            localStream = await acquireInputDeviceStream('audio', deviceId, {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            });
            ownStreamCreated = true;
          } catch (acquireErr) {
            console.warn('[useTeacherLiveSubtitles] acquireInputDeviceStream fallback:', acquireErr);
            const constraints = {
              audio: deviceId ? { deviceId: { exact: deviceId } } : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            };
            if (navigator.mediaDevices?.getUserMedia) {
              localStream = await navigator.mediaDevices.getUserMedia(constraints);
              ownStreamCreated = true;
            }
          }
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx || !localStream) return;

        if (!hasAudioTracks(localStream)) {
          console.warn('[useTeacherLiveSubtitles] MediaStream has no audio track. Skipping createMediaStreamSource.');
          if (isMounted) {
            setError('Selected microphone has no audio track. Please choose a different microphone.');
            setStatus('idle');
          }
          return;
        }

        if (isMounted) {
          try {
            localStream.__capturedDeviceId = deviceId || '';
          } catch {}
          setActiveAudioStream(localStream);
        }

        let speechVolDecayTimeout = null;
        let lastReportedVol = 0;

        audioCtx = new AudioCtx();
        const tryResumeAudioCtx = () => {
          if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
            try {
              const resumePromise = audioCtx.resume?.();
              if (resumePromise && typeof resumePromise.catch === 'function') {
                resumePromise.catch(() => {});
              }
            } catch {}
          }
        };

        // Never `await` audioCtx.resume() here: in Chrome/Safari/iOS WebKit, calling resume()
        // when user activation has expired returns a permanently pending Promise that would
        // deadlock setupAudio before attachAudioProcessor or SpeechRecognition can start.
        tryResumeAudioCtx();

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('touchstart', tryResumeAudioCtx, { passive: true });
          window.addEventListener('touchend', tryResumeAudioCtx, { passive: true });
          window.addEventListener('pointerdown', tryResumeAudioCtx, { passive: true });
          window.addEventListener('click', tryResumeAudioCtx, { passive: true });
          window.addEventListener('keydown', tryResumeAudioCtx, { passive: true });
        }

        source = audioCtx.createMediaStreamSource(localStream);

        processor = attachAudioProcessor(audioCtx, source, (pcm16k) => {
          if (!isMounted) return;

          // Compute energy RMS
          let sumSq = 0;
          for (let i = 0; i < pcm16k.length; i++) {
            sumSq += pcm16k[i] * pcm16k[i];
          }
          const rms = Math.sqrt(sumSq / pcm16k.length);
          const rmsPct = rms < 0.003 ? 0 : Math.min(100, Math.round(Math.pow(Math.min(1, rms / 0.25), 0.65) * 100));
          if (rmsPct !== lastReportedVol) {
            lastReportedVol = rmsPct;
            setMicVolume(rmsPct);
          }

          // On-Device LiteRT Whisper VAD buffering
          if (rms > 0.015) {
            // Voice active
            hasSpeechActivity = true;
            pcmBuffer.push(pcm16k);
            pcmBufferedSamples += pcm16k.length;
            if (silenceTimeout) {
              clearTimeout(silenceTimeout);
              silenceTimeout = null;
            }
            // Prevent unbounded memory growth or Whisper 30s truncation during non-stop lecturing
            if (pcmBufferedSamples >= MAX_CONTINUOUS_SPEECH_SAMPLES) {
              flushBufferToWhisper();
            }
          } else if (hasSpeechActivity) {
            // Silence detected after speech; wait 700ms for natural pause boundary
            pcmBuffer.push(pcm16k);
            pcmBufferedSamples += pcm16k.length;
            if (!silenceTimeout) {
              silenceTimeout = setTimeout(() => {
                silenceTimeout = null;
                // If Web Speech API is actively streaming interim results for this utterance,
                // give it 600ms to emit its isFinal result before running Whisper fallback.
                if (lastSpeechRecInterimAt > 0 && Date.now() - lastSpeechRecInterimAt < 1500) {
                  lastSpeechRecInterimAt = 0;
                  silenceTimeout = setTimeout(() => {
                    silenceTimeout = null;
                    flushBufferToWhisper();
                  }, 600);
                  return;
                }
                flushBufferToWhisper();
              }, 700);
            }
          }
        });

        // Attach cleanup reference for interaction listeners
        audioCtx.__cleanupResumeListeners = () => {
          if (speechVolDecayTimeout) {
            clearTimeout(speechVolDecayTimeout);
            speechVolDecayTimeout = null;
          }
          if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            window.removeEventListener('touchstart', tryResumeAudioCtx);
            window.removeEventListener('touchend', tryResumeAudioCtx);
            window.removeEventListener('pointerdown', tryResumeAudioCtx);
            window.removeEventListener('click', tryResumeAudioCtx);
            window.removeEventListener('keydown', tryResumeAudioCtx);
          }
        };

        if (isMounted) {
          setStatus('listening');
        }

        const pulseSpeechRecVolume = (textSample = '') => {
          if (!isMounted || lastReportedVol > 0) return;
          const dynamicPct = Math.min(88, 52 + ((textSample.length * 7) % 34));
          setMicVolume(dynamicPct);
          if (speechVolDecayTimeout) clearTimeout(speechVolDecayTimeout);
          speechVolDecayTimeout = setTimeout(() => {
            speechVolDecayTimeout = null;
            if (isMounted && lastReportedVol === 0) {
              setMicVolume(0);
            }
          }, 650);
        };

        // Web Speech recognition live fallback for teacher speech (runs on Chrome / Edge / Windows / Mac / iOS)
        if (typeof window !== 'undefined') {
          const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRec) {
            try {
              recognition = new SpeechRec();
              recognition.continuous = true;
              recognition.interimResults = true;
              recognition.lang = speechLanguage || 'zh-HK';

              recognition.onstart = () => {
                isRecognitionActive = true;
              };

              recognition.onresult = (event) => {
                let interim = '';
                let final = '';
                for (let i = event.resultIndex; i < event.results.length; i++) {
                  if (event.results[i].isFinal) {
                    final += event.results[i][0].transcript;
                  } else {
                    interim += event.results[i][0].transcript;
                  }
                }
                if (interim && interim.trim()) {
                  lastSpeechRecInterimAt = Date.now();
                }
                const speechText = (final || interim || '').trim();
                if (speechText && isMounted) {
                  setLatestTranscript(speechText);
                  pulseSpeechRecVolume(speechText);
                }
                if (final && final.trim() && isMounted) {
                  lastSpeechRecInterimAt = 0;
                  // Clear the parallel VAD buffer so Whisper does not re-transcribe and overwrite
                  // the utterance that SpeechRecognition just finalized.
                  clearPendingVadBuffer();
                  publishSubtitleRef.current?.(final.trim());
                }
              };

              recognition.onerror = (event) => {
                if (event.error !== 'no-speech' && event.error !== 'aborted') {
                  console.debug('[useTeacherLiveSubtitles] Recognition notice:', event.error);
                }
                if (event.error === 'no-speech' || event.error === 'network') {
                  isRecognitionActive = false;
                }
              };

              recognition.onend = () => {
                isRecognitionActive = false;
                if (isMounted) {
                  safeStartRecognition();
                }
              };

              recognition.start();
            } catch (recErr) {
              console.debug('[useTeacherLiveSubtitles] SpeechRecognition initialization note:', recErr);
            }
          }
        }
      } catch (err) {
        console.warn('[useTeacherLiveSubtitles] Microphone attachment notice:', err);
        setError(err.message || 'Microphone error');
      }
    };

    setupAudio();

    return () => {
      isMounted = false;
      setMicVolume(0);
      setActiveAudioStream(null);
      if (silenceTimeout) clearTimeout(silenceTimeout);
      if (restartTimeout) clearTimeout(restartTimeout);
      if (recognition) {
        try {
          recognition.onstart = null;
          recognition.onend = null;
          recognition.onerror = null;
          recognition.onresult = null;
          recognition.abort();
        } catch {}
      }
      if (processor) {
        try { processor.disconnect(); } catch {}
      }
      if (source) {
        try { source.disconnect(); } catch {}
      }
      if (audioCtx) {
        try { audioCtx.__cleanupResumeListeners?.(); } catch {}
        if (audioCtx.state !== 'closed') {
          try { audioCtx.close(); } catch {}
        }
      }
      if (ownStreamCreated && localStream) {
        localStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [enabled, audioStream, deviceId, speechLanguage, engineMode, classId, teacherUid, teacherEmail]);

  // Manage subtitle active session status in Firestore
  useEffect(() => {
    if (!classId) return;
    const subDocRef = doc(db, 'classes', classId, 'liveSubtitles', 'current');

    if (enabled) {
      setDoc(
        subDocRef,
        {
          active: true,
          status: 'listening',
          sourceLang: speechLanguage,
          targetLanguages,
          engine: engineMode,
          speakerUid: teacherUid || '',
          speakerEmail: teacherEmail || '',
          timestamp: serverTimestamp(),
        },
        { merge: true }
      ).catch((err) => {
        console.warn('[useTeacherLiveSubtitles] Session activation warning:', err);
      });
    } else {
      setDoc(subDocRef, { active: false }, { merge: true }).catch(() => {});
    }
  }, [enabled, classId, speechLanguage, targetLanguagesKey, engineMode, teacherUid, teacherEmail]);

  // Clean up subtitle active status strictly on final unmount
  useEffect(() => {
    return () => {
      if (classId) {
        const subDocRef = doc(db, 'classes', classId, 'liveSubtitles', 'current');
        setDoc(subDocRef, { active: false }, { merge: true }).catch(() => {});
      }
    };
  }, [classId]);

  return {
    engineMode,
    setEngineMode,
    speechLanguage,
    setSpeechLanguage,
    targetLanguages,
    setTargetLanguages,
    status,
    latestTranscript,
    latestTranslations,
    error,
    isGemmaAvailable,
    gemmaProgress,
    isGemmaCached,
    isGemmaInitializing,
    gemmaUnavailableReason,
    loadGemmaModel,
    micVolume,
    activeAudioStream,
    publishSubtitle, // exposed for manual trigger or test injection
  };
}

