/**
 * useTeacherLiveSubtitles.js
 * 
 * Custom hook managing teacher lecture live speech recognition and translation.
 * Supports 3 selectable engines:
 * 1. 'client': On-device LiteRT Whisper + Chrome Gemini Nano (window.Translator)
 * 2. 'server': On-device LiteRT Whisper + Cloud Function Gemini 3.5 Flash-Lite (translateTeacherSpeech)
 * 3. 'firebase_live': Gemini Live bidirectional WebSocket audio streaming via Firebase AI Logic (firebase/ai)
 * 
 * Publishes live subtitles to classes/{classId}/liveSubtitles/current in Firestore.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase-config';
import { downsamplePcmTo16k } from '../utils/audioDecoder';
import { createLiveSubtitleSession, transcribeAudioWithFirebaseAI } from '../utils/aiLogic';
import { attachAudioProcessor } from '../utils/audioWorkletHelper';
import { isTeacherEmail } from '../utils/domainConfig';
import {
  isChromeTranslatorSupported,
  checkMultipleLanguagePairs,
  translateMultipleWithChrome,
} from '../utils/chromeTranslator';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

const DEFAULT_TARGET_LANGS = ['zh-Hans', 'en'];

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
}) {
  // Engine Mode: 'client' | 'server' | 'firebase_live'
  const [engineMode, setEngineModeState] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('teacher_subtitle_engine_mode') || 'server';
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
    return DEFAULT_TARGET_LANGS;
  });

  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'listening' | 'translating' | 'error'
  const [latestTranscript, setLatestTranscript] = useState('');
  const [latestTranslations, setLatestTranslations] = useState({});
  const [error, setError] = useState(null);
  const [isNanoAvailable, setIsNanoAvailable] = useState(false);
  const [isGemmaAvailable, setIsGemmaAvailable] = useState(false);
  const [gemmaProgress, setGemmaProgress] = useState(0);
  const [languagePairStatuses, setLanguagePairStatuses] = useState({});
  const [liveUsageStats, setLiveUsageStats] = useState(null);

  const seqCounterRef = useRef(0);
  const historyBufferRef = useRef([]);
  const workerRef = useRef(null);
  const gemmaWorkerRef = useRef(null);
  const isGemmaReadyRef = useRef(false);
  const liveSessionRef = useRef(null);
  const pendingRequestsRef = useRef(new Map());
  const reqIdCounterRef = useRef(0);
  const isWhisperReadyRef = useRef(false);

  const activePrompt = subtitlePrompt || customPrompt;
  const customPromptText = typeof activePrompt === 'string'
    ? activePrompt
    : (activePrompt?.promptText || '');

  // Setters with localStorage persistence
  const setEngineMode = useCallback((mode) => {
    setEngineModeState(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('teacher_subtitle_engine_mode', mode);
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

  // Check Chrome Built-in AI window.Translator availability for selected language pairs
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let isCancelled = false;

    const checkAvailability = async () => {
      try {
        if (isChromeTranslatorSupported()) {
          const statuses = await checkMultipleLanguagePairs(speechLanguage, targetLanguages);
          if (!isCancelled) {
            setLanguagePairStatuses(statuses);
            const isAnySupported = Object.values(statuses).some(
              (s) => s.baseSource !== s.baseTarget && s.status === 'readily'
            );
            setIsNanoAvailable(isAnySupported);
          }
        } else {
          if (!isCancelled) {
            setIsNanoAvailable(false);
            setLanguagePairStatuses({});
          }
        }
      } catch {
        if (!isCancelled) {
          setIsNanoAvailable(false);
          setLanguagePairStatuses({});
        }
      }
    };
    checkAvailability();

    return () => {
      isCancelled = true;
    };
  }, [speechLanguage, targetLanguages]);

  // Initialize LiteRT Whisper Web Worker for client and server modes
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
    if (engineMode === 'firebase_live') {
      // In Firebase Live mode, Whisper worker is not needed, saving CPU/GPU
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      return;
    }

    try {
      workerRef.current = new Worker(
        new URL('../workers/litertWhisper.worker.js', import.meta.url)
      );

      workerRef.current.onmessage = (event) => {
        const { type, payload, id } = event.data;
        if (type === 'INIT_COMPLETE') {
          isWhisperReadyRef.current = true;
          setStatus('listening');
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
  }, [speechLanguage, engineMode]);

  // Initialize on-device Gemma worker when in client engine mode (matching student AI stack)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
    if (engineMode !== 'client' || !enabled) {
      if (gemmaWorkerRef.current) {
        gemmaWorkerRef.current.terminate();
        gemmaWorkerRef.current = null;
        isGemmaReadyRef.current = false;
        setIsGemmaAvailable(false);
      }
      return;
    }

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
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'PROGRESS') {
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
          const pending = pendingRequestsRef.current.get(id);
          if (pending) {
            pending.reject(new Error(payload?.error || 'Gemma translation error'));
            pendingRequestsRef.current.delete(id);
          }
        }
      };

      const initId = ++reqIdCounterRef.current;
      gemmaWorkerRef.current.postMessage({
        type: 'INIT',
        id: initId,
        payload: {
          delegate: 'wasm',
        },
      });
    } catch (err) {
      console.warn('[useTeacherLiveSubtitles] Gemma worker initialization notice:', err);
    }

    return () => {
      if (gemmaWorkerRef.current) {
        gemmaWorkerRef.current.terminate();
        gemmaWorkerRef.current = null;
        isGemmaReadyRef.current = false;
        setIsGemmaAvailable(false);
      }
    };
  }, [engineMode, enabled]);

  // Translate clean transcript using selected model (Client vs Server)
  const translateTranscript = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return {};

    if (engineMode === 'client') {
      // 1. Try On-Device LiteRT Gemma Worker first (replicated from student on-device AI stack)
      if (gemmaWorkerRef.current && isGemmaReadyRef.current) {
        try {
          const reqId = ++reqIdCounterRef.current;
          const gemmaPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              pendingRequestsRef.current.delete(reqId);
              reject(new Error('Gemma translation timed out'));
            }, 10000);

            pendingRequestsRef.current.set(reqId, {
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
        } catch (gemmaErr) {
          console.warn('[useTeacherLiveSubtitles] On-device Gemma translation fallback:', gemmaErr);
        }
      }

      // 2. Try Chrome Built-in Translator if supported
      if (isChromeTranslatorSupported()) {
        try {
          const localTranslations = await translateMultipleWithChrome(trimmed, speechLanguage, targetLanguages);
          const missingLangs = targetLanguages.filter((l) => !localTranslations[l]);
          if (missingLangs.length === 0) {
            return localTranslations;
          }

          // Partial fallback to Server Model for missing/unsupported pairs
          try {
            const recentHistoryStrings = (historyBufferRef.current || [])
              .slice(-4)
              .map(entry => entry.originalText)
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
            return { ...localTranslations, ...serverMissing };
          } catch (serverFallbackErr) {
            console.warn('[useTeacherLiveSubtitles] Server fallback for missing languages failed:', serverFallbackErr);
            const merged = { ...localTranslations };
            missingLangs.forEach((l) => { merged[l] = trimmed; });
            return merged;
          }
        } catch (clientErr) {
          console.warn('[useTeacherLiveSubtitles] Client translation fallback:', clientErr);
        }
      }
    }

    // Server Model: Cloud Function with Gemini 3.5 Flash-Lite / 3.8 Flash
    try {
      const recentHistoryStrings = (historyBufferRef.current || [])
        .slice(-4)
        .map(entry => entry.originalText)
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
      targetLanguages.forEach(l => { fallback[l] = trimmed; });
      return fallback;
    }
  }, [engineMode, targetLanguages, speechLanguage, classId, courseContext, customPromptText]);

  // Publish subtitle frame to Firestore
  const publishSubtitle = useCallback(async (originalText, customTranslations = null, isFinal = true) => {
    if (!classId || !originalText || !originalText.trim()) return;

    const trimmed = originalText.trim();
    setLatestTranscript(trimmed);
    if (isFinal) {
      setStatus('translating');
    }

    try {
      const translations = customTranslations || (await translateTranscript(trimmed));
      setLatestTranslations(translations);

      const seq = ++seqCounterRef.current;
      const newEntry = {
        seq,
        originalText: trimmed,
        translations,
        timestamp: Date.now(),
      };

      // Keep last 5 entries in history buffer if final turn
      let updatedHistory = historyBufferRef.current;
      if (isFinal) {
        updatedHistory = [...historyBufferRef.current, newEntry].slice(-5);
        historyBufferRef.current = updatedHistory;
      }

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
  }, [classId, translateTranscript, speechLanguage, engineMode, teacherUid, teacherEmail]);

  // Audio Stream Processing (Whisper VAD or Firebase Gemini Live WebSocket)
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

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
    let silenceTimeout = null;
    let hasSpeechActivity = false;

    // Firebase Live streaming state
    let streamingOriginal = '';
    let streamingTranslation = '';

    const flushBufferToWhisper = async () => {
      if (!isMounted || pcmBuffer.length === 0) return;

      let totalSamples = 0;
      for (const chunk of pcmBuffer) totalSamples += chunk.length;

      // Discard clicks under ~0.25s (4000 samples @ 16kHz)
      if (totalSamples < 4000) {
        pcmBuffer = [];
        hasSpeechActivity = false;
        return;
      }

      const mergedPcm = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of pcmBuffer) {
        mergedPcm.set(chunk, offset);
        offset += chunk.length;
      }

      pcmBuffer = [];
      hasSpeechActivity = false;

      // Dispatch to LiteRT Whisper Worker
      if (workerRef.current) {
        const id = ++reqIdCounterRef.current;
        new Promise((resolve, reject) => {
          pendingRequestsRef.current.set(id, { resolve, reject });
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
          let text = (result?.transcript || '').trim();
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
            publishSubtitle(text);
          }
        }).catch(err => {
          console.debug('[useTeacherLiveSubtitles] Whisper transcription error:', err);
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

        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }

        source = audioCtx.createMediaStreamSource(localStream);

        // If in Firebase Live mode, connect the live WebSocket session
        if (engineMode === 'firebase_live') {
          setStatus('loading');
          try {
            const primaryTarget = targetLanguages[0] || 'en';
            let debouncePublishTimer = null;

            liveSessionRef.current = createLiveSubtitleSession({
              targetLanguage: primaryTarget,
              currentUser: { email: teacherEmail },
              courseContext,
              customPrompt: customPromptText,
              speechLanguage,
              onUsageUpdate: (stats) => {
                if (!isMounted) return;
                setLiveUsageStats(stats);
              },
              onOriginalTranscript: (text) => {
                if (!isMounted) return;
                streamingOriginal = text;
                setLatestTranscript(text);
              },
              onTranslatedChunk: (chunk) => {
                if (!isMounted) return;
                streamingTranslation += chunk;
                const translations = { [primaryTarget]: streamingTranslation };
                setLatestTranslations(translations);
                if (!debouncePublishTimer) {
                  debouncePublishTimer = setTimeout(() => {
                    debouncePublishTimer = null;
                    if (isMounted) {
                      publishSubtitle(streamingOriginal || '...', translations, false);
                    }
                  }, 350);
                }
              },
              onTurnComplete: () => {
                if (!isMounted) return;
                if (debouncePublishTimer) {
                  clearTimeout(debouncePublishTimer);
                  debouncePublishTimer = null;
                }
                if (streamingOriginal || streamingTranslation) {
                  publishSubtitle(
                    streamingOriginal || '...',
                    { [primaryTarget]: streamingTranslation },
                    true
                  );
                }
                streamingOriginal = '';
                streamingTranslation = '';
              },
              onError: (err) => {
                console.warn('[useTeacherLiveSubtitles:FirebaseLive] Stream notice:', err);
              }
            });

            await liveSessionRef.current.connect();
            if (isMounted) setStatus('listening');
          } catch (liveErr) {
            console.error('[useTeacherLiveSubtitles] Firebase Live connection error:', liveErr);
            const msg = liveErr?.message || '';
            const isAppCheckOrDeactivated = msg.includes('handshake failed') || msg.includes('has not been used') || msg.includes('disabled') || msg.includes('setupComplete') || msg.includes('deactivated') || msg.includes('App Ch');
            if (isAppCheckOrDeactivated) {
              console.warn('[useTeacherLiveSubtitles] Firebase Live restricted by App Check or project policy. Falling back to Server Model.');
              // Fallback at runtime without permanently overwriting user's persisted engine preference
              setEngineModeState('server');
              setError('Firebase Live is restricted by App Check in this browser. Automatically switched to the reliable Server Model (LiteRT Whisper + Cloud Functions).');
            } else {
              setError(msg || 'Firebase Live connection error');
            }
            if (isMounted) setStatus('idle');
            return;
          }
        }

        processor = attachAudioProcessor(audioCtx, source, (pcm16k) => {
          if (!isMounted) return;

          // Compute energy RMS
          let sumSq = 0;
          for (let i = 0; i < pcm16k.length; i++) {
            sumSq += pcm16k[i] * pcm16k[i];
          }
          const rms = Math.sqrt(sumSq / pcm16k.length);

          if (engineMode === 'firebase_live') {
            // Direct streaming to Gemini Live session over WebSocket
            if (rms > 0.008 && liveSessionRef.current?.isConnected()) {
              liveSessionRef.current.sendAudioChunk(pcm16k);
            }
          } else {
            // On-Device LiteRT Whisper VAD buffering
            if (rms > 0.015) {
              // Voice active
              hasSpeechActivity = true;
              pcmBuffer.push(pcm16k);
              if (silenceTimeout) {
                clearTimeout(silenceTimeout);
                silenceTimeout = null;
              }
            } else if (hasSpeechActivity) {
              // Silence detected after speech; wait 700ms for natural pause boundary
              pcmBuffer.push(pcm16k);
              if (!silenceTimeout) {
                silenceTimeout = setTimeout(() => {
                  silenceTimeout = null;
                  flushBufferToWhisper();
                }, 700);
              }
            }
          }
        });

        if (engineMode !== 'firebase_live') {
          setStatus('listening');
        }

        // Web Speech recognition live fallback for teacher speech in client/server mode
        if (typeof window !== 'undefined' && engineMode !== 'firebase_live') {
          const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
          if (SpeechRec) {
            try {
              recognition = new SpeechRec();
              recognition.continuous = true;
              recognition.interimResults = true;
              recognition.lang = speechLanguage || 'zh-HK';

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
                const speechText = (final || interim || '').trim();
                if (speechText && isMounted) {
                  setLatestTranscript(speechText);
                }
                if (final && final.trim() && isMounted) {
                  publishSubtitle(final.trim());
                }
              };

              recognition.onerror = (event) => {
                if (event.error !== 'no-speech' && event.error !== 'aborted') {
                  console.debug('[useTeacherLiveSubtitles] Recognition notice:', event.error);
                }
              };

              recognition.onend = () => {
                if (isMounted && engineMode !== 'firebase_live') {
                  try { recognition.start(); } catch {}
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
      if (silenceTimeout) clearTimeout(silenceTimeout);
      if (recognition) {
        try {
          recognition.onend = null;
          recognition.abort();
        } catch {}
      }
      if (processor) {
        try { processor.disconnect(); } catch {}
      }
      if (source) {
        try { source.disconnect(); } catch {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try { audioCtx.close(); } catch {}
      }
      if (ownStreamCreated && localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }
      if (liveSessionRef.current) {
        const finalUsage = liveSessionRef.current.getSessionUsage?.();
        if (finalUsage && (finalUsage.totalTokens > 0 || finalUsage.durationSeconds > 5) && classId) {
          addDoc(collection(db, 'aiJobs'), {
            jobType: 'liveSubtitleStream',
            classId,
            teacherUid: teacherUid || 'unknown',
            modelUsed: finalUsage.modelUsed || 'gemini-3.1-flash-live-preview',
            durationSeconds: finalUsage.durationSeconds,
            usage: {
              inputTokens: finalUsage.audioTokens,
              outputTokens: finalUsage.outputTokens,
              totalTokens: finalUsage.totalTokens,
            },
            cost: finalUsage.estimatedCostUsd,
            status: 'completed',
            timestamp: serverTimestamp(),
          }).catch((e) => console.warn('[useTeacherLiveSubtitles] Error logging aiJob:', e));
        }
        liveSessionRef.current.close().catch(() => {});
        liveSessionRef.current = null;
      }
    };
  }, [enabled, audioStream, deviceId, speechLanguage, engineMode, targetLanguages, publishSubtitle, classId, teacherUid]);

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

    return () => {
      setDoc(subDocRef, { active: false }, { merge: true }).catch(() => {});
    };
  }, [enabled, classId, speechLanguage, targetLanguages, engineMode, teacherUid, teacherEmail]);

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
    isNanoAvailable,
    isGemmaAvailable,
    gemmaProgress,
    languagePairStatuses,
    liveUsageStats,
    publishSubtitle, // exposed for manual trigger or test injection
  };
}

