/**
 * useClientLiteRTGemma.js
 * 
 * Custom hook to run on-device Gemma LLM evaluation on spoken STT transcripts
 * via Google LiteRT.js in a dedicated Web Worker.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc, updateDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase-config';
import { isGemmaModelCached, DEFAULT_GEMMA_CONFIG } from '../utils/gemmaLiteRTLoader';

export function useClientLiteRTGemma({
  classId,
  studentUid,
  studentEmail = '',
  enabled = true,
}) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'ready' | 'evaluating' | 'error'
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isModelCached, setIsModelCached] = useState(false);
  const [delegateUsed, setDelegateUsed] = useState('wasm');
  const [latestEvaluation, setLatestEvaluation] = useState(null);
  const [error, setError] = useState(null);

  const workerRef = useRef(null);
  const pendingRequestsRef = useRef(new Map());
  const reqIdCounterRef = useRef(0);

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
        new URL('../workers/litertGemma.worker.js', import.meta.url),
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
        } else if (type === 'EVALUATION_COMPLETE') {
          setStatus('ready');
          setLatestEvaluation(payload);
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
        console.error('[useClientLiteRTGemma] Worker error:', err);
        setError(err.message || 'Worker initialization failed');
        setStatus('error');
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
    setStatus('loading');
    setLoadingProgress(5);
    setError(null);

    return new Promise((resolve, reject) => {
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, resolve);
      workerRef.current.postMessage({
        type: 'INIT',
        id,
        payload: { modelUrl: DEFAULT_GEMMA_CONFIG.modelUrl },
      });

      setTimeout(() => {
        if (pendingRequestsRef.current.has(id)) {
          pendingRequestsRef.current.delete(id);
          setStatus('error');
          setError('Model download timeout');
          reject(new Error('Model download timeout'));
        }
      }, 90000);
    });
  }, []);

  // Auto-init worker when enabled
  useEffect(() => {
    if (enabled && workerRef.current && status === 'idle') {
      preloadGemmaModel().catch(e => console.debug('[useClientLiteRTGemma] Auto-init note:', e));
    }
  }, [enabled, status, preloadGemmaModel]);

  const classIdRef = useRef(classId);
  const studentUidRef = useRef(studentUid);
  const studentEmailRef = useRef(studentEmail);

  useEffect(() => {
    classIdRef.current = classId;
    studentUidRef.current = studentUid;
    studentEmailRef.current = studentEmail;
  }, [classId, studentUid, studentEmail]);

  /**
   * Evaluate a spoken transcript using Gemma, log violations to Firestore,
   * and update live student telemetry for the Teacher Monitor.
   */
  const evaluateTranscript = useCallback(async (transcript, metadata = {}) => {
    if (!transcript || typeof transcript !== 'string' || !transcript.trim()) {
      return null;
    }

    if (!workerRef.current) {
      console.warn('[useClientLiteRTGemma] Worker not instantiated yet');
      return null;
    }

    return new Promise((resolve) => {
      const id = ++reqIdCounterRef.current;
      pendingRequestsRef.current.set(id, async (result) => {
        const isViolation = Boolean(result?.isViolation);
        const category = result?.category || 'BENIGN';
        const severity = result?.severity || 'none';
        const confidence = result?.confidence || 0.9;
        const evidence = result?.evidence || '';
        const rationale = result?.rationale || '';

        console.log(
          `%c[LiteRT Gemma LLM] 🤖 Intent Evaluation: %c"${transcript}"\n%cCategory: [${category}] | Severity: ${severity.toUpperCase()} | Violation: ${isViolation ? '🚨 YES' : '✅ NO'} | Confidence: ${Math.round(confidence * 100)}%\nRationale: ${rationale}`,
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
      });

      workerRef.current.postMessage({
        type: 'EVALUATE_TRANSCRIPT',
        id,
        payload: {
          transcript,
          studentUid: studentUidRef.current,
          classId: classIdRef.current,
          timestamp: Date.now(),
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
    latestEvaluation,
    error,
    preloadGemmaModel,
    evaluateTranscript,
  };
}
