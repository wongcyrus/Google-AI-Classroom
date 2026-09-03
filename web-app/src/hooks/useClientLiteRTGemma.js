/**
 * useClientLiteRTGemma.js
 * 
 * Custom hook to run on-device Gemma LLM evaluation on spoken STT transcripts
 * via Google LiteRT-LM in a dedicated Web Worker.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config';
import { isGemmaModelCached, DEFAULT_GEMMA_CONFIG } from '../utils/gemmaLiteRTLoader';

export function useClientLiteRTGemma({
  classId,
  studentUid,
  studentEmail = '',
  customGemmaPrompt = null,
}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'evaluating' | 'unavailable' | 'error'
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelCached, setIsModelCached] = useState(false);
  const [delegateUsed, setDelegateUsed] = useState('wasm');
  const [engine, setEngine] = useState('uninitialized');
  const [unavailableReason, setUnavailableReason] = useState('');
  const [latestEvaluation, setLatestEvaluation] = useState(null);
  const [error, setError] = useState(null);

  const workerRef = useRef(null);
  const pendingRequestsRef = useRef(new Map());
  const classIdRef = useRef(classId);
  const studentUidRef = useRef(studentUid);
  const studentEmailRef = useRef(studentEmail);
  const reqIdCounterRef = useRef(0);
  const initializationPromiseRef = useRef(null);
  const evaluationInFlightRef = useRef(false);
  const statusRef = useRef(status);
  const engineRef = useRef(engine);
  const customGemmaPromptRef = useRef(customGemmaPrompt);

  useEffect(() => {
    classIdRef.current = classId;
    studentUidRef.current = studentUid;
    studentEmailRef.current = studentEmail;
  }, [classId, studentUid, studentEmail]);

  useEffect(() => {
    customGemmaPromptRef.current = customGemmaPrompt;
  }, [customGemmaPrompt]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Check initial cache state
  useEffect(() => {
    let isMounted = true;
    isGemmaModelCached().then((cached) => {
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
        new URL('../workers/litertGemma.worker.js', import.meta.url)
      );

      workerRef.current.onmessage = (event) => {
        const { type, payload, id } = event.data;

        if (type === 'STATUS') {
          if (payload?.status) setStatus(payload.status);
          if (typeof payload?.progress === 'number') setLoadingProgress(payload.progress);
        } else if (type === 'PROGRESS') {
          setLoadingProgress(payload.progress);
        } else if (type === 'INIT_COMPLETE') {
          const isGemmaReady =
            payload?.ready === true &&
            payload?.engine === 'litert_lm_gemma_e2b';
          const nextStatus = isGemmaReady ? 'ready' : 'unavailable';
          setStatus(nextStatus);
          statusRef.current = nextStatus;
          setLoadingProgress(isGemmaReady ? 100 : 0);
          setIsModelCached(Boolean(payload?.cached));
          const initializedEngine = payload?.engine || 'unavailable';
          setEngine(initializedEngine);
          engineRef.current = initializedEngine;
          setUnavailableReason(payload?.unavailableReason || '');
          if (payload?.delegate) setDelegateUsed(payload.delegate);
          const request = pendingRequestsRef.current.get(id);
          if (request) {
            request.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'EVALUATION_COMPLETE') {
          const request = pendingRequestsRef.current.get(id);
          if (payload?.engine !== 'litert_lm_gemma_e2b') {
            if (request) {
              request.reject(new Error('Rejected evaluation from a non-Gemma engine'));
              pendingRequestsRef.current.delete(id);
            }
            return;
          }
          setStatus('ready');
          statusRef.current = 'ready';
          setLatestEvaluation(payload);
          setEngine(payload.engine);
          engineRef.current = payload.engine;
          setUnavailableReason('');
          if (request) {
            request.resolve(payload);
            pendingRequestsRef.current.delete(id);
          }
        } else if (type === 'ERROR') {
          setError(payload?.error || 'Worker error');
          setUnavailableReason(payload?.error || 'Worker error');
          setStatus('error');
          statusRef.current = 'error';
          const request = pendingRequestsRef.current.get(id);
          if (request) {
            request.reject(new Error(payload?.error || 'Worker error'));
            pendingRequestsRef.current.delete(id);
          }
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('[useClientLiteRTGemma] Worker error:', err);
        setError(err.message || 'Worker initialization failed');
        setUnavailableReason(err.message || 'Worker initialization failed');
        setStatus('error');
        statusRef.current = 'error';
      };
    } catch (e) {
      console.warn('[useClientLiteRTGemma] Failed to instantiate worker:', e);
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
   * Preload the LiteRT Gemma model into CacheStorage.
   */
  const preloadGemmaModel = useCallback(async () => {
    if (!workerRef.current) return;
    if (
      statusRef.current === 'ready' &&
      engineRef.current === 'litert_lm_gemma_e2b'
    ) {
      return;
    }
    if (initializationPromiseRef.current) return initializationPromiseRef.current;

    if (navigator.storage?.persist) {
      try {
        const persisted = await navigator.storage.persist();
        console.log('[useClientLiteRTGemma] Persistent model storage request completed.', {
          persisted,
        });
      } catch (error) {
        console.warn('[useClientLiteRTGemma] Persistent storage request failed:', error);
      }
    }

    console.log('[useClientLiteRTGemma] Starting Gemma 4 E2B preload request.');
    setStatus('loading');
    statusRef.current = 'loading';
    setLoadingProgress(5);
    setError(null);
    setUnavailableReason('');

    const initializationPromise = new Promise((resolve, reject) => {
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, { resolve, reject });
      workerRef.current.postMessage({
        type: 'INIT',
        id,
        payload: { modelUrl: DEFAULT_GEMMA_CONFIG.modelUrl },
      });

      setTimeout(() => {
        if (pendingRequestsRef.current.has(id)) {
          pendingRequestsRef.current.delete(id);
          setStatus('error');
          statusRef.current = 'error';
          setError('Model download timeout');
          reject(new Error('Model download timeout'));
        }
      }, 900000);
    });
    initializationPromiseRef.current = initializationPromise.finally(() => {
      initializationPromiseRef.current = null;
    });
    return initializationPromiseRef.current;
  }, []);

  /**
   * Evaluate a spoken transcript using Gemma, log violations to Firestore,
   * and update live student telemetry for the Teacher Monitor.
   */
  const evaluateTranscript = useCallback(async (transcript, metadata = {}) => {
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      console.debug('[useClientLiteRTGemma:Evaluate] Skipped empty transcript.');
      return null;
    }

    if (!workerRef.current) {
      console.warn('[useClientLiteRTGemma:Evaluate] Skipped because the worker is not instantiated.', {
        transcript,
      });
      return null;
    }
    if (evaluationInFlightRef.current) {
      console.warn('[useClientLiteRTGemma:Evaluate] Skipped because another Gemma evaluation is in progress.', {
        transcript,
      });
      return null;
    }
    if (
      statusRef.current !== 'ready' ||
      engineRef.current !== 'litert_lm_gemma_e2b'
    ) {
      console.warn('[useClientLiteRTGemma:Evaluate] Skipped because Gemma 4 E2B is not ready.', {
        transcript,
        status: statusRef.current,
        engine: engineRef.current,
      });
      return null;
    }

    return new Promise((resolve) => {
      evaluationInFlightRef.current = true;
      setStatus('evaluating');
      statusRef.current = 'evaluating';
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, {
        reject: (requestError) => {
          evaluationInFlightRef.current = false;
          console.error('[useClientLiteRTGemma] Evaluation failed:', requestError);
          resolve(null);
        },
        resolve: async (result) => {
        evaluationInFlightRef.current = false;
        const isViolation = Boolean(result?.isViolation);
        const category = result?.category || 'BENIGN';
        const severity = result?.severity || 'none';
        const confidence = result?.confidence || 0.9;
        const evidence = result?.evidence || '';
        const rationale = result?.rationale || '';

        console.log(
          `%c[LiteRT-LM Gemma 4 E2B] 🤖 Intent Evaluation: %c"${transcript}"\n%cCategory: [${category}] | Severity: ${severity.toUpperCase()} | Violation: ${isViolation ? '🚨 YES' : '✅ NO'} | Confidence: ${Math.round(confidence * 100)}%\nRationale: ${rationale}`,
          'background: #1e1b4b; color: #a5b4fc; font-weight: bold; font-size: 13px; padding: 2px 6px; border-radius: 4px;',
          'color: #ffffff; font-weight: bold; font-size: 13px;',
          isViolation ? 'color: #f87171; font-weight: bold; font-size: 12px;' : 'color: #4ade80; font-weight: bold; font-size: 12px;'
        );

        // 1. If Violation: Create record in /irregularities (root & class subcollection)
        const currentClassId = classIdRef.current;
        const currentStudentUid = studentUidRef.current;
        const currentStudentEmail = studentEmailRef.current;
        if (isViolation && currentClassId && currentStudentUid) {
          const irregPayload = {
            classId: currentClassId,
            studentUid: currentStudentUid,
            email: currentStudentEmail || '',
            studentEmail: currentStudentEmail || '',
            title: `AI Speech Alert: ${category.replace(/_/g, ' ')}`,
            message: rationale || evidence || `Spoken text: "${transcript}"`,
            type: 'audio',
            category,
            severity,
            confidence,
            evidence: evidence || '',
            rationale: rationale || '',
            transcriptSnippet: transcript,
            transcript: transcript,
            source: 'on_device_gemma',
            timestamp: serverTimestamp(),
          };

          try {
            // Write to root collection (queried by IrregularitiesView)
            const rootIrregCol = collection(db, 'irregularities');
            await addDoc(rootIrregCol, irregPayload);

            // Write to class subcollection (queried by dossier report generator)
            const classIrregCol = collection(db, 'classes', currentClassId, 'irregularities');
            await addDoc(classIrregCol, irregPayload);
          } catch (err) {
            console.error('[useClientLiteRTGemma] Failed to log irregularity:', err);
          }
        }

        // 2. Update classes/{classId}/status/{studentUid}
        if (currentClassId && currentStudentUid) {
          try {
            const statusRef = doc(db, 'classes', currentClassId, 'status', currentStudentUid);
            await setDoc(
              statusRef,
              {
                gemmaAlert: isViolation ? category : null,
                gemmaSeverity: isViolation ? severity : null,
                gemmaConfidence: confidence,
                lastGemmaTimestamp: Date.now(),
              },
              { merge: true }
            );
          } catch (err) {
            console.error('[useClientLiteRTGemma] Failed to update gemma status telemetry:', err);
          }
        }

        resolve(result);
        },
      });

      const systemPrompt = customGemmaPromptRef.current?.promptText || 
        (typeof customGemmaPromptRef.current === 'string' ? customGemmaPromptRef.current : undefined);

      console.log('[useClientLiteRTGemma:Dispatch] Sending transcript to the Gemma worker.', {
        requestId: id,
        transcript,
        classId: classIdRef.current,
        hasCustomPrompt: Boolean(systemPrompt?.trim()),
      });
      workerRef.current.postMessage({
        type: 'EVALUATE_TRANSCRIPT',
        id,
        payload: {
          transcript,
          studentUid: studentUidRef.current,
          studentEmail: studentEmailRef.current,
          classId: classIdRef.current,
          timestamp: Date.now(),
          systemPrompt,
          ...metadata,
        },
      });
    });
  }, []);

  return {
    status,
    loadingProgress,
    isModelCached,
    delegateUsed,
    engine,
    unavailableReason,
    latestEvaluation,
    error,
    preloadGemmaModel,
    evaluateTranscript,
  };
}
