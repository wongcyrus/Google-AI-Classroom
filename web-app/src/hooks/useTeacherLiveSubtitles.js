/**
 * useTeacherLiveSubtitles.js
 * 
 * Custom hook managing teacher lecture live speech recognition and translation.
 * Supports 3 selectable engines:
 * 1. 'client': On-device LiteRT Whisper + Chrome Gemini Nano (window.Translator)
 * 2. 'server': On-device LiteRT Whisper + Cloud Function Gemini 2.5 Flash (translateTeacherSpeech)
 * 3. 'firebase_live': Gemini Live bidirectional WebSocket audio streaming via Firebase AI Logic (firebase/ai)
 * 
 * Publishes live subtitles to classes/{classId}/liveSubtitles/current in Firestore.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, serverTimestamp, collection, addDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase-config';
import { downsamplePcmTo16k } from '../utils/audioDecoder';
import { createLiveSubtitleSession } from '../utils/aiLogic';
import { isTeacherEmail } from '../utils/domainConfig';

const DEFAULT_TARGET_LANGS = ['zh-Hant', 'en'];

export function useTeacherLiveSubtitles({
  classId,
  teacherUid,
  teacherEmail = '',
  enabled = false,
  audioStream = null,
  deviceId = '',
  courseContext = '',
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
  const [liveUsageStats, setLiveUsageStats] = useState(null);

  const seqCounterRef = useRef(0);
  const historyBufferRef = useRef([]);
  const workerRef = useRef(null);
  const liveSessionRef = useRef(null);
  const pendingRequestsRef = useRef(new Map());
  const reqIdCounterRef = useRef(0);
  const isWhisperReadyRef = useRef(false);

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

  // Check Chrome Built-in AI window.Translator availability
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const checkAvailability = async () => {
      try {
        if (window.Translator && typeof window.Translator.availability === 'function') {
          const avail = await window.Translator.availability({ sourceLanguage: 'zh', targetLanguage: 'en' });
          setIsNanoAvailable(avail === 'available' || avail === 'downloadable');
        } else {
          setIsNanoAvailable(false);
        }
      } catch {
        setIsNanoAvailable(false);
      }
    };
    checkAvailability();
  }, []);

  // Initialize LiteRT Whisper Web Worker for client and server modes
  useEffect(() => {
    if (typeof window === 'undefined') return;
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

  // Translate clean transcript using selected model (Client vs Server)
  const translateTranscript = useCallback(async (text) => {
    const trimmed = (text || '').trim();
    if (!trimmed) return {};

    if (engineMode === 'client' && typeof window !== 'undefined' && window.Translator) {
      try {
        const localTranslations = {};
        for (const targetLang of targetLanguages) {
          const shortTarget = targetLang.split('-')[0];
          try {
            const translator = await window.Translator.create({
              sourceLanguage: speechLanguage.split('-')[0],
              targetLanguage: shortTarget,
            });
            localTranslations[targetLang] = await translator.translate(trimmed);
          } catch {
            // Local fallback if pair is unsupported
            localTranslations[targetLang] = trimmed;
          }
        }
        return localTranslations;
      } catch (clientErr) {
        console.warn('[useTeacherLiveSubtitles] Client translation fallback:', clientErr);
      }
    }

    // Server Model: Cloud Function with Gemini 2.5 Flash / Flash Lite
    try {
      const callTranslate = httpsCallable(functions, 'translateTeacherSpeech');
      const response = await callTranslate({
        classId,
        text: trimmed,
        sourceLang: speechLanguage,
        targetLangs: targetLanguages,
        context: courseContext,
      });
      return response.data?.translations || {};
    } catch (serverErr) {
      console.error('[useTeacherLiveSubtitles] Server translation error:', serverErr);
      // Fallback: at least show original
      const fallback = {};
      targetLanguages.forEach(l => { fallback[l] = trimmed; });
      return fallback;
    }
  }, [engineMode, targetLanguages, speechLanguage, classId, courseContext]);

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
    let localStream = audioStream;
    let ownStreamCreated = false;
    let audioCtx = null;
    let source = null;
    let processor = null;

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
        }).then(result => {
          if (isMounted && result?.transcript && result.transcript.trim()) {
            publishSubtitle(result.transcript);
          }
        }).catch(err => {
          console.debug('[useTeacherLiveSubtitles] Whisper transcription error:', err);
        });
      }
    };

    const setupAudio = async () => {
      try {
        if (!localStream) {
          const constraints = {
            audio: deviceId ? { deviceId: { exact: deviceId } } : {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          };
          localStream = await navigator.mediaDevices.getUserMedia(constraints);
          ownStreamCreated = true;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx || !localStream) return;

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
            setStatus('listening');
          } catch (liveErr) {
            console.error('[useTeacherLiveSubtitles] Firebase Live connection error:', liveErr);
            setError(liveErr.message || 'Firebase Live error');
          }
        }

        if (typeof audioCtx.createScriptProcessor === 'function') {
          processor = audioCtx.createScriptProcessor(4096, 1, 1);
          processor.onaudioprocess = (e) => {
            if (!isMounted) return;
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16k = downsamplePcmTo16k(inputData, audioCtx.sampleRate, 16000);

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
          };

          source.connect(processor);
          processor.connect(audioCtx.destination);
          if (engineMode !== 'firebase_live') {
            setStatus('listening');
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

  // Clean up subtitle active status in Firestore when broadcasting stops
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
    isNanoAvailable,
    liveUsageStats,
    publishSubtitle, // exposed for manual trigger or test injection
  };
}

