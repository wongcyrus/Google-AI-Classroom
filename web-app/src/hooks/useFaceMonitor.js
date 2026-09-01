import { useState, useEffect, useRef, useCallback } from 'react';
import {
  initFaceLandmarkerWithProgress,
  isModelCached,
  fetchModelWithProgress,
  calculateEAR,
  calculateMAR,
  DEFAULT_FACE_MODEL_PATH,
} from '../utils/webAiModelLoader';
import { db, storage, functions } from '../firebase-config';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';

// MediaPipe Canonical 478 Landmark Groups
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10];
const LEFT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33];
const RIGHT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398, 362];
const LEFT_EYEBROW = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const RIGHT_EYEBROW = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61];
const LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78];
const NOSE_BRIDGE = [168, 6, 197, 195, 5, 4, 1, 19, 94, 2];
const NOSE_BOTTOM = [98, 97, 2, 326, 327];
const LEFT_IRIS_RING = [469, 470, 471, 472, 469];
const RIGHT_IRIS_RING = [474, 475, 476, 477, 474];

// Key Triangulation & Structural Tessellation Edges
const TESSELLATION_PAIRS = [
  // Forehead & Temples
  [10, 109], [10, 338], [109, 67], [338, 297], [67, 103], [297, 332], [103, 54], [332, 284],
  [54, 21], [284, 251], [21, 162], [251, 389], [10, 151], [151, 9], [9, 8], [8, 168],
  // Cheeks & Mid-face
  [168, 6], [6, 197], [197, 195], [195, 5], [5, 4], [4, 1], [1, 19], [19, 94], [94, 2],
  [168, 107], [168, 336], [107, 66], [336, 296], [66, 105], [296, 334], [105, 63], [334, 293],
  [70, 156], [300, 383], [156, 143], [383, 372], [143, 111], [372, 340], [111, 117], [340, 346],
  [117, 118], [346, 347], [118, 119], [347, 348], [119, 120], [348, 349], [120, 121], [349, 350],
  // Nose to Cheeks
  [1, 123], [1, 352], [123, 50], [352, 280], [50, 205], [280, 425], [205, 137], [425, 366],
  // Mouth to Chin & Jaw
  [61, 146], [291, 375], [17, 18], [18, 200], [200, 199], [199, 175], [175, 152],
  [152, 148], [152, 377], [148, 176], [377, 400], [176, 149], [400, 378],
  // Eye corners to Temples
  [33, 130], [263, 359], [130, 247], [359, 467], [247, 30], [467, 260],
  // Cheeks Cross-Mesh
  [129, 203], [358, 423], [203, 98], [423, 327], [98, 2], [327, 2]
];

const drawPath = (ctx, landmarks, indices, color, lineWidth = 1.5, close = true, vp = null) => {
  if (!ctx || !landmarks || indices.length === 0) return;
  const defW = ctx.canvas?.width || 640;
  const defH = ctx.canvas?.height || 480;
  const toX = (x) => vp ? vp.offsetX + x * vp.renderW : x * defW;
  const toY = (y) => vp ? vp.offsetY + y * vp.renderH : y * defH;

  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath?.();
  let first = true;
  for (const idx of indices) {
    const pt = landmarks[idx];
    if (!pt) continue;
    if (first) {
      ctx.moveTo?.(toX(pt.x), toY(pt.y));
      first = false;
    } else {
      ctx.lineTo?.(toX(pt.x), toY(pt.y));
    }
  }
  if (close && typeof ctx.closePath === 'function') {
    ctx.closePath();
  }
  ctx.stroke?.();
  ctx.restore?.();
};

const drawEdgePairs = (ctx, landmarks, pairs, color, lineWidth = 1, vp = null) => {
  if (!ctx || !landmarks || pairs.length === 0) return;
  const defW = ctx.canvas?.width || 640;
  const defH = ctx.canvas?.height || 480;
  const toX = (x) => vp ? vp.offsetX + x * vp.renderW : x * defW;
  const toY = (y) => vp ? vp.offsetY + y * vp.renderH : y * defH;

  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.beginPath?.();
  for (let i = 0; i < pairs.length; i++) {
    const [i1, i2] = pairs[i];
    const p1 = landmarks[i1];
    const p2 = landmarks[i2];
    if (p1 && p2) {
      ctx.moveTo?.(toX(p1.x), toY(p1.y));
      ctx.lineTo?.(toX(p2.x), toY(p2.y));
    }
  }
  ctx.stroke?.();
  ctx.restore?.();
};

const drawIrisGlow = (ctx, landmarks, centerIdx, ringIndices, color, pupilColor, vp = null) => {
  if (!ctx || !landmarks) return;
  const defW = ctx.canvas?.width || 640;
  const defH = ctx.canvas?.height || 480;
  const toX = (x) => vp ? vp.offsetX + x * vp.renderW : x * defW;
  const toY = (y) => vp ? vp.offsetY + y * vp.renderH : y * defH;

  const center = landmarks[centerIdx];
  if (!center) return;
  const cx = toX(center.x);
  const cy = toY(center.y);

  ctx.save?.();
  // Draw glowing pupil center
  ctx.beginPath?.();
  ctx.arc?.(cx, cy, 3.5, 0, 2 * Math.PI);
  ctx.fillStyle = pupilColor;
  ctx.shadowColor = pupilColor;
  ctx.shadowBlur = 8;
  ctx.fill?.();

  // Draw iris boundary ring
  if (ringIndices && ringIndices.length > 0) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.beginPath?.();
    let first = true;
    for (const idx of ringIndices) {
      const pt = landmarks[idx];
      if (!pt) continue;
      if (first) {
        ctx.moveTo?.(toX(pt.x), toY(pt.y));
        first = false;
      } else {
        ctx.lineTo?.(toX(pt.x), toY(pt.y));
      }
    }
    if (typeof ctx.closePath === 'function') {
      ctx.closePath();
    }
    ctx.stroke?.();
  }
  ctx.restore?.();
};

const drawFaceBrackets = (ctx, landmarks, color, vp = null) => {
  if (!ctx || !landmarks || landmarks.length === 0) return;
  const defW = ctx.canvas?.width || 640;
  const defH = ctx.canvas?.height || 480;
  const toX = (x) => vp ? vp.offsetX + x * vp.renderW : x * defW;
  const toY = (y) => vp ? vp.offsetY + y * vp.renderH : y * defH;

  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const padX = (maxX - minX) * 0.12;
  const padY = (maxY - minY) * 0.12;
  const x1 = toX(Math.max(0, minX - padX));
  const y1 = toY(Math.max(0, minY - padY));
  const x2 = toX(Math.min(1, maxX + padX));
  const y2 = toY(Math.min(1, maxY + padY));
  const cornerLen = Math.min(24, (x2 - x1) * 0.2);

  ctx.save?.();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath?.();

  // Top-left
  ctx.moveTo?.(x1, y1 + cornerLen); ctx.lineTo?.(x1, y1); ctx.lineTo?.(x1 + cornerLen, y1);
  // Top-right
  ctx.moveTo?.(x2 - cornerLen, y1); ctx.lineTo?.(x2, y1); ctx.lineTo?.(x2, y1 + cornerLen);
  // Bottom-right
  ctx.moveTo?.(x2, y2 - cornerLen); ctx.lineTo?.(x2, y2); ctx.lineTo?.(x2 - cornerLen, y2);
  // Bottom-left
  ctx.moveTo?.(x1 + cornerLen, y2); ctx.lineTo?.(x1, y2); ctx.lineTo?.(x1, y2 - cornerLen);

  ctx.stroke?.();
  ctx.restore?.();
};

export const useFaceMonitor = ({
  webcamVideoRef,
  screenVideoRef,
  overlayCanvasRef,
  activeClass,
  user,
  isWebcamSharing,
  isScreenSharing,
  isCapturing = false,
  aiMonitoringMode = 'hybrid', // 'hybrid' | 'client_only' | 'cloud_only' | 'disabled'
  enableClientAi, // optional backward-compat
  enableCloudFallback, // optional backward-compat
  preloadClientAi = false, // Teacher preload trigger
  gazeSensitivity = 'standard',
  customYawAngle = 25,
  customPitchDownAngle = -22,
  customPitchUpAngle = 26,
  debounceSeconds = 3,
  cloudFallbackRate = 3,
  showMeshOverlay = true,
}) => {
  // Derive effective mode with fallback to legacy booleans
  const effectiveMode = (() => {
    if (aiMonitoringMode) return aiMonitoringMode;
    if (enableClientAi === false && !enableCloudFallback) return 'disabled';
    if (enableClientAi === false && enableCloudFallback) return 'cloud_only';
    if (enableClientAi !== false && !enableCloudFallback) return 'client_only';
    return 'hybrid';
  })();

  const isClientAiAllowed = effectiveMode === 'hybrid' || effectiveMode === 'client_only';
  const isCloudFallbackAllowed = effectiveMode === 'hybrid' || effectiveMode === 'cloud_only';

  const [faceStatus, setFaceStatus] = useState('normal'); // 'normal' | 'no_face' | 'looking_away' | 'eyes_closed' | 'talking' | 'multiple_faces' | 'cloud_fallback' | 'unsupported' | 'quota_exceeded' | 'disabled'
  const [clientAiStatus, setClientAiStatus] = useState('initializing'); // 'ready' | 'cloud_fallback' | 'unsupported' | 'disabled'
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [isCached, setIsCached] = useState(false);
  const [fallbackReason, setFallbackReason] = useState(null);
  const [delegateUsed, setDelegateUsed] = useState(null);
  const [isPreloading, setIsPreloading] = useState(false);

  const [yawAngle, setYawAngle] = useState(0);
  const [pitchAngle, setPitchAngle] = useState(0);
  const [earValue, setEarValue] = useState(0.30);
  const [marValue, setMarValue] = useState(0.15);
  const [metricDistance, setMetricDistance] = useState(55); // Estimated distance in cm (Depth-from-Iris)
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [activeViolation, setActiveViolation] = useState(null);

  const landmarkerRef = useRef(null);
  const requestAnimationRef = useRef(null);
  const videoFrameCallbackIdRef = useRef(null);
  const isRunningRef = useRef(false);
  const baselineOffsetRef = useRef({ yaw: 0, pitch: 0 });
  const rawYawRef = useRef(0);
  const rawPitchRef = useRef(0);

  // Anti-flooding / Incident session tracking refs
  const anomalyStartRef = useRef(null);
  const lastAnomalyTimeRef = useRef(0);
  const activeIncidentDocRef = useRef(null);
  const lastResolvedTimeRef = useRef(0);
  const isUploadingIncidentRef = useRef(false);

  // Calibration functions
  const calibrateBaseline = useCallback(() => {
    baselineOffsetRef.current = {
      yaw: rawYawRef.current || 0,
      pitch: rawPitchRef.current || 0,
    };
    setIsCalibrated(true);
    return baselineOffsetRef.current;
  }, []);

  const resetCalibration = useCallback(() => {
    baselineOffsetRef.current = { yaw: 0, pitch: 0 };
    setIsCalibrated(false);
  }, []);

  // Check initial cache status
  useEffect(() => {
    let isMounted = true;
    isModelCached(DEFAULT_FACE_MODEL_PATH).then((cached) => {
      if (isMounted) setIsCached(cached);
    });
    return () => { isMounted = false; };
  }, []);

  // Preload function that can be triggered by student button or teacher signal
  const preloadModel = useCallback(async () => {
    if (isCached || landmarkerRef.current || isPreloading) return;
    setIsPreloading(true);
    try {
      await fetchModelWithProgress(DEFAULT_FACE_MODEL_PATH, ({ percent, fromCache }) => {
        setLoadingProgress(percent);
        if (fromCache) setIsCached(true);
      });
      setIsCached(true);
      setLoadingProgress(100);
    } catch (err) {
      console.warn('[useFaceMonitor] Preload failed:', err);
    } finally {
      setIsPreloading(false);
    }
  }, [isCached, isPreloading]);

  // Listen to teacher preload broadcast
  useEffect(() => {
    if (preloadClientAi && !isCached && isClientAiAllowed) {
      preloadModel();
    }
  }, [preloadClientAi, isCached, isClientAiAllowed, preloadModel]);

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    let isMounted = true;

    if (effectiveMode === 'disabled') {
      setClientAiStatus('disabled');
      setFaceStatus('disabled');
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch {}
        landmarkerRef.current = null;
      }
      return;
    }

    if (effectiveMode === 'cloud_only') {
      setClientAiStatus('cloud_fallback');
      setFaceStatus('cloud_fallback');
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch {}
        landmarkerRef.current = null;
      }
      return;
    }

    // If landmarker is already created and ready, don't recreate and don't destroy
    if (landmarkerRef.current) {
      setClientAiStatus('ready');
      return;
    }

    async function initLandmarker() {
      try {
        setClientAiStatus('initializing');
        setLoadingProgress(0);
        
        const { landmarker, delegateUsed: dUsed, fromCache: cached } = await initFaceLandmarkerWithProgress({
          onProgress: ({ percent, fromCache: isFromCache }) => {
            if (isMounted) {
              setLoadingProgress(percent);
              if (isFromCache) setIsCached(true);
            }
          },
          preferredDelegate: 'GPU',
        });

        if (!isMounted) {
          try { landmarker?.close?.(); } catch {}
          return;
        }

        landmarkerRef.current = landmarker;
        setDelegateUsed(dUsed);
        setIsCached(true);
        setLoadingProgress(100);
        setClientAiStatus('ready');
        setFallbackReason(null);
      } catch (err) {
        if (isMounted) {
          setFallbackReason(err?.message || 'initialization_error');
          if (isCloudFallbackAllowed) {
            setClientAiStatus('cloud_fallback');
            setFaceStatus('cloud_fallback');
          } else {
            setClientAiStatus('unsupported');
            setFaceStatus('unsupported');
          }
        }
      }
    }

    initLandmarker();

    return () => {
      isMounted = false;
    };
  }, [effectiveMode, isCloudFallbackAllowed]);

  // Clean up Landmarker on final unmount
  useEffect(() => {
    return () => {
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch {}
        landmarkerRef.current = null;
      }
    };
  }, []);

  // Handle dynamic mode change transitions
  useEffect(() => {
    if (clientAiStatus === 'unsupported' && isCloudFallbackAllowed) {
      setClientAiStatus('cloud_fallback');
      setFaceStatus('cloud_fallback');
    } else if (clientAiStatus === 'cloud_fallback' && !isCloudFallbackAllowed) {
      setClientAiStatus('unsupported');
      setFaceStatus('unsupported');
    }
  }, [clientAiStatus, isCloudFallbackAllowed]);

  // Helper: Capture a single frame from a video element as a JPEG Blob
  const grabVideoBlob = useCallback(async (videoEl) => {
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    const MAX_W = 1280;
    let w = videoEl.videoWidth;
    let h = videoEl.videoHeight;
    if (w > MAX_W) {
      h = Math.round((h * MAX_W) / w);
      w = MAX_W;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  }, []);

  // Anti-flooding Incident Manager: Open Incident
  const startIncident = useCallback(async (violationType, detailsMessage) => {
    if (activeIncidentDocRef.current || isUploadingIncidentRef.current) return;
    if (!activeClass || !user || !user.uid) return;
    if (!isCapturing) {
      console.debug('Class is not actively capturing (test not started). Skipping irregularity incident creation.');
      return;
    }

    // Inter-incident cooldown (4 seconds)
    const now = Date.now();
    if (now - lastResolvedTimeRef.current < 4000) return;

    isUploadingIncidentRef.current = true;
    const incidentId = uuidv4();
    const timestamp = Date.now();

    try {
      console.log(`🚨 Triggering incident [${violationType}]:`, detailsMessage);
      
      // Capture synchronous dual proof (Screen + Webcam)
      let screenUrl = null;
      let webcamUrl = null;

      try {
        const [screenBlob, webcamBlob] = await Promise.all([
          grabVideoBlob(screenVideoRef.current),
          grabVideoBlob(webcamVideoRef.current),
        ]);

        const uploadPromises = [];
        if (screenBlob) {
          const screenRef = ref(storage, `irregularities/${activeClass}/${user.uid}/${timestamp}_${incidentId}_screen.jpg`);
          uploadPromises.push(
            uploadBytes(screenRef, screenBlob).then((s) => getDownloadURL(s.ref)).then((url) => { screenUrl = url; }).catch(e => console.warn('Screen upload err:', e))
          );
        }
        if (webcamBlob) {
          const webcamRef = ref(storage, `irregularities/${activeClass}/${user.uid}/${timestamp}_${incidentId}_webcam.jpg`);
          uploadPromises.push(
            uploadBytes(webcamRef, webcamBlob).then((s) => getDownloadURL(s.ref)).then((url) => { webcamUrl = url; }).catch(e => console.warn('Webcam upload err:', e))
          );
        }

        await Promise.all(uploadPromises);
      } catch (uploadErr) {
        console.warn('Incident snapshot upload error (proceeding with doc creation):', uploadErr);
      }

      // Create exactly 1 initial document in Firestore
      const docRef = await addDoc(collection(db, 'irregularities'), {
        classId: activeClass,
        studentUid: user.uid,
        studentEmail: user.email || '',
        email: user.email || '',
        studentName: user.displayName || user.email || '',
        type: violationType,
        message: detailsMessage,
        status: 'active',
        timestamp: serverTimestamp(),
        startedAt: serverTimestamp(),
        endedAt: null,
        durationSeconds: null,
        screenUrl: screenUrl || null,
        webcamUrl: webcamUrl || null,
        imageUrl: webcamUrl || screenUrl || null,
      });

      activeIncidentDocRef.current = {
        id: docRef.id,
        type: violationType,
        startedAtTime: timestamp,
      };
      console.log(`✅ Irregularity Incident recorded to Firestore [ID: ${docRef.id}]`);
    } catch (err) {
      console.error('Error starting incident:', err);
    } finally {
      isUploadingIncidentRef.current = false;
    }
  }, [activeClass, grabVideoBlob, isCapturing, screenVideoRef, user, webcamVideoRef]);

  // Anti-flooding Incident Manager: Resolve Incident
  const resolveIncident = useCallback(async () => {
    if (!activeIncidentDocRef.current) return;
    const { id, startedAtTime } = activeIncidentDocRef.current;
    activeIncidentDocRef.current = null;
    lastResolvedTimeRef.current = Date.now();

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtTime) / 1000));

    try {
      const docRef = doc(db, 'irregularities', id);
      await updateDoc(docRef, {
        status: 'resolved',
        endedAt: serverTimestamp(),
        durationSeconds: durationSeconds,
      });
      console.log(`✅ Irregularity Incident resolved [ID: ${id}] Duration: ${durationSeconds}s`);
    } catch (err) {
      console.error('Error resolving incident:', err);
    }
  }, []);

  // Periodic Cloud Fallback Loop (only when capturing, enabled, and client-side AI is unsupported or in cloud_only mode)
  useEffect(() => {
    if (!isCapturing || clientAiStatus !== 'cloud_fallback' || !isCloudFallbackAllowed || !isWebcamSharing) {
      return;
    }

    const intervalMs = Math.max(4000, (cloudFallbackRate || 3) * 4000);
    const analyzeFaceFallbackCallable = httpsCallable(functions, 'analyzeFaceFallback');
    let isCancelled = false;

    const intervalId = setInterval(async () => {
      if (isCancelled) return;
      try {
        const webcamBlob = await grabVideoBlob(webcamVideoRef?.current);
        if (!webcamBlob || isCancelled) return;

        const tempPath = `temp_ai/fallback_${user.uid}_${Date.now()}.jpg`;
        const storageRef = ref(storage, tempPath);
        await uploadBytes(storageRef, webcamBlob, { contentType: 'image/jpeg' });
        const webcamUrl = await getDownloadURL(storageRef);

        if (isCancelled) return;

        const res = await analyzeFaceFallbackCallable({
          classId: activeClass,
          studentUid: user.uid,
          studentEmail: user.email || '',
          webcamUrl,
        });

        const data = res?.data || {};
        if (data.faceStatus === 'disabled') {
          setClientAiStatus('unsupported');
          setFaceStatus('unsupported');
        } else if (data.faceStatus === 'quota_exceeded') {
          setFaceStatus('quota_exceeded');
        } else if (data.faceStatus === 'looking_away' || data.faceStatus === 'no_face' || data.faceStatus === 'multiple_faces') {
          setFaceStatus(data.faceStatus);
          setActiveViolation(data.faceStatus);
          
          const now = Date.now();
          lastAnomalyTimeRef.current = now;
          if (!anomalyStartRef.current || anomalyStartRef.current.type !== data.faceStatus) {
            anomalyStartRef.current = { type: data.faceStatus, startTime: now };
          } else {
            const elapsed = (now - anomalyStartRef.current.startTime) / 1000;
            if (elapsed >= debounceSeconds) {
              startIncident(data.faceStatus, data.reason || 'Cloud Fallback AI Anomaly detected.');
            }
          }
        } else if (data.faceStatus === 'normal') {
          setFaceStatus('normal');
          setActiveViolation(null);
          anomalyStartRef.current = null;
          if (activeIncidentDocRef.current) {
            resolveIncident();
          }
        }
      } catch (err) {
        console.warn('Cloud Fallback analysis tick error:', err);
      }
    }, intervalMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [clientAiStatus, isCloudFallbackAllowed, cloudFallbackRate, isCapturing, isWebcamSharing, grabVideoBlob, webcamVideoRef, user, activeClass, debounceSeconds, startIncident, resolveIncident]);

  // Continuous Video Processing Loop (MediaPipe Client-Side WASM)
  useEffect(() => {
    if (!isClientAiAllowed || clientAiStatus !== 'ready' || !isWebcamSharing || !landmarkerRef.current) {
      if (overlayCanvasRef?.current) {
        const ctx = overlayCanvasRef.current.getContext?.('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
        }
      }
      if (!isClientAiAllowed) {
        setFaceStatus(effectiveMode === 'disabled' ? 'disabled' : 'cloud_fallback');
        setActiveViolation(null);
      }
      return;
    }

    isRunningRef.current = true;
    let lastVideoTime = -1;
    let lastDetectionTimestamp = -1;
    let frameCount = 0;

    // Configurable Gaze & Orientation Thresholds
    let yawThresh = 22;
    let pitchDownThresh = -20;
    let pitchUpThresh = 26;
    let irisLowThresh = 0.22;
    let irisHighThresh = 0.78;

    if (gazeSensitivity === 'relaxed') {
      yawThresh = 28;
      pitchDownThresh = -26;
      pitchUpThresh = 30;
      irisLowThresh = 0.18;
      irisHighThresh = 0.82;
    } else if (gazeSensitivity === 'strict') {
      yawThresh = 16;
      pitchDownThresh = -16;
      pitchUpThresh = 22;
      irisLowThresh = 0.28;
      irisHighThresh = 0.72;
    } else if (gazeSensitivity === 'custom') {
      yawThresh = Math.abs(parseInt(customYawAngle, 10)) || 25;
      pitchDownThresh = -Math.abs(parseInt(customPitchDownAngle, 10) || 22);
      pitchUpThresh = Math.abs(parseInt(customPitchUpAngle, 10)) || 26;
      irisLowThresh = 0.22;
      irisHighThresh = 0.78;
    }

    const detectFrame = () => {
      if (!isRunningRef.current) return;

      const video = webcamVideoRef.current;
      const canvas = overlayCanvasRef?.current;

      if (video && video.readyState >= 2 && video.videoWidth > 0 && landmarkerRef.current) {
        const currentTime = video.currentTime;
        frameCount++;

        try {
          if (currentTime !== lastVideoTime) {
            lastVideoTime = currentTime;
          }

          let nowMs = performance.now();
          if (nowMs <= lastDetectionTimestamp) {
            nowMs = lastDetectionTimestamp + 1;
          }
          lastDetectionTimestamp = nowMs;

          const results = landmarkerRef.current.detectForVideo(video, nowMs);
          const faces = results?.faceLandmarks || [];

          // Overlay Drawing (Points & Connectors Mesh)
          if (canvas) {
            const ctx = canvas.getContext?.('2d');
            if (ctx) {
              const vWidth = video.videoWidth || 640;
              const vHeight = video.videoHeight || 480;
              const cWidth = canvas.clientWidth || vWidth;
              const cHeight = canvas.clientHeight || vHeight;

              if (canvas.width !== cWidth || canvas.height !== cHeight) {
                canvas.width = cWidth;
                canvas.height = cHeight;
              }
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // Calculate viewport geometry to perfectly overlay letterboxed or cover video
              const videoAspect = vWidth / vHeight;
              const containerAspect = cWidth / cHeight;
              let renderW = cWidth;
              let renderH = cHeight;
              let offsetX = 0;
              let offsetY = 0;

              const isCover = canvas.classList?.contains?.('pip-overlay') || canvas.parentElement?.classList?.contains?.('pip-stream');
              if (isCover) {
                if (containerAspect > videoAspect) {
                  renderW = cWidth;
                  renderH = cWidth / videoAspect;
                  offsetX = 0;
                  offsetY = (cHeight - renderH) / 2;
                } else {
                  renderH = cHeight;
                  renderW = cHeight * videoAspect;
                  offsetX = (cWidth - renderW) / 2;
                  offsetY = 0;
                }
              } else {
                if (containerAspect > videoAspect) {
                  renderH = cHeight;
                  renderW = cHeight * videoAspect;
                  offsetX = (cWidth - renderW) / 2;
                  offsetY = 0;
                } else {
                  renderW = cWidth;
                  renderH = cWidth / videoAspect;
                  offsetX = 0;
                  offsetY = (cHeight - renderH) / 2;
                }
              }

              const vp = { offsetX, offsetY, renderW, renderH };

              if (showMeshOverlay && results && results.faceLandmarks) {
                for (const landmarks of results.faceLandmarks) {
                  const isViolating = !!activeViolation;
                  const meshColor = isViolating ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.40)';
                  const contourColor = isViolating ? 'rgba(239, 68, 68, 0.95)' : 'rgba(5, 150, 105, 0.90)';
                  const featureColor = isViolating ? '#EF4444' : '#10B981';
                  const irisColor = isViolating ? '#F87171' : '#06B6D4';
                  const pupilColor = isViolating ? '#EF4444' : '#38BDF8';
                  const bracketColor = isViolating ? 'rgba(239, 68, 68, 0.85)' : 'rgba(16, 185, 129, 0.80)';

                  // 1. Structural Mesh Triangulation
                  drawEdgePairs(ctx, landmarks, TESSELLATION_PAIRS, meshColor, 1.2, vp);

                  // 2. Face Oval & Feature Contours
                  drawPath(ctx, landmarks, FACE_OVAL, contourColor, 2, true, vp);
                  drawPath(ctx, landmarks, LEFT_EYE, contourColor, 1.8, true, vp);
                  drawPath(ctx, landmarks, RIGHT_EYE, contourColor, 1.8, true, vp);
                  drawPath(ctx, landmarks, LEFT_EYEBROW, featureColor, 1.6, false, vp);
                  drawPath(ctx, landmarks, RIGHT_EYEBROW, featureColor, 1.6, false, vp);
                  drawPath(ctx, landmarks, LIPS_OUTER, featureColor, 1.6, true, vp);
                  drawPath(ctx, landmarks, LIPS_INNER, featureColor, 1.2, true, vp);
                  drawPath(ctx, landmarks, NOSE_BRIDGE, featureColor, 1.6, false, vp);
                  drawPath(ctx, landmarks, NOSE_BOTTOM, featureColor, 1.4, false, vp);

                  // 3. Iris Centers & Rings
                  drawIrisGlow(ctx, landmarks, 468, LEFT_IRIS_RING, irisColor, pupilColor, vp);
                  drawIrisGlow(ctx, landmarks, 473, RIGHT_IRIS_RING, irisColor, pupilColor, vp);

                  // 4. Futuristic Tracking Target Brackets
                  drawFaceBrackets(ctx, landmarks, bracketColor, vp);

                  // Draw Gaze / Head Pose Orientation Arrow from Nose Tip
                  const nose = landmarks[1];
                  const leftEye = landmarks[33];
                  const rightEye = landmarks[263];
                  const chin = landmarks[152];
                  const forehead = landmarks[10];
                  const leftIrisCenter = landmarks[468];
                  const rightIrisCenter = landmarks[473];

                  if (nose && leftEye && rightEye && chin && forehead) {
                    const toX = (x) => vp.offsetX + x * vp.renderW;
                    const toY = (y) => vp.offsetY + y * vp.renderH;
                    const noseX = toX(nose.x);
                    const noseY = toY(nose.y);
                    
                    // Horizontal Yaw: difference between left eye and right eye distance to nose
                    const dLeft = Math.hypot(nose.x - leftEye.x, nose.y - leftEye.y);
                    const dRight = Math.hypot(nose.x - rightEye.x, nose.y - rightEye.y);
                    const yawRatio = (dLeft - dRight) / (dLeft + dRight);

                    // Vertical Pitch: ratio of nose-chin vs nose-forehead
                    const dNoseChin = chin.y - nose.y;
                    const dNoseForehead = nose.y - forehead.y;
                    const pitchRatio = (dNoseChin - dNoseForehead) / (dNoseChin + dNoseForehead);
                    const pitchOffset = pitchRatio - (-0.10);

                    // Direction vector
                    const dirX = yawRatio * vp.renderW * 2.5;
                    const dirY = -pitchOffset * vp.renderH * 2.2;

                    const targetX = noseX + dirX;
                    const targetY = noseY + dirY;

                    // Draw anchor at nose
                    ctx.beginPath();
                    ctx.arc(noseX, noseY, 3.5, 0, 2 * Math.PI);
                    ctx.fillStyle = activeViolation ? '#DC2626' : '#10B981';
                    ctx.fill();

                    // Draw gaze direction line
                    ctx.beginPath();
                    ctx.moveTo(noseX, noseY);
                    ctx.lineTo(targetX, targetY);
                    ctx.strokeStyle = activeViolation ? '#EF4444' : '#10B981';
                    ctx.lineWidth = 3;
                    ctx.stroke();

                    // Draw pointer tip
                    ctx.beginPath();
                    ctx.arc(targetX, targetY, 5, 0, 2 * Math.PI);
                    ctx.fillStyle = activeViolation ? '#DC2626' : '#059669';
                    ctx.fill();

                    // Draw Iris Eye-Gaze Rays from Pupils
                    if (leftIrisCenter && rightIrisCenter) {
                      [leftIrisCenter, rightIrisCenter].forEach((pupil) => {
                        const px = toX(pupil.x);
                        const py = toY(pupil.y);
                        
                        ctx.beginPath();
                        ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
                        ctx.fillStyle = activeViolation ? '#EF4444' : '#22D3EE';
                        ctx.fill();

                        ctx.beginPath();
                        ctx.moveTo(px, py);
                        ctx.lineTo(px + dirX * 0.4, py + dirY * 0.4);
                        ctx.strokeStyle = activeViolation ? '#EF4444' : '#06B6D4';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                      });
                    }
                  }
                }
              }
            }
          }

          // Face Presence, Orientation & MediaPipe Iris Analysis
          let currentAnomaly = null;
          let detailsMessage = '';

          if (faces.length === 0) {
            currentAnomaly = 'no_face';
            detailsMessage = 'No student face detected in webcam frame.';
            setFaceStatus('no_face');
          } else if (faces.length > 1) {
            currentAnomaly = 'multiple_faces';
            detailsMessage = `Multiple faces (${faces.length}) detected in frame.`;
            setFaceStatus('multiple_faces');
          } else {
            const landmarks = faces[0];
            const nose = landmarks[1];
            const leftEyeOuter = landmarks[33];
            const leftEyeInner = landmarks[133];
            const rightEyeInner = landmarks[362];
            const rightEyeOuter = landmarks[263];
            const chin = landmarks[152];
            const forehead = landmarks[10];
            const leftIris = landmarks[468];
            const rightIris = landmarks[473];

            // MediaPipe Iris: Depth-from-Iris Distance Calculation (11.7mm constant diameter)
            let calculatedDistanceCm = 55;
            if (landmarks[469] && landmarks[471] && landmarks[474] && landmarks[476]) {
              const leftIrisPx = Math.hypot(landmarks[469].x - landmarks[471].x, landmarks[469].y - landmarks[471].y) * (video.videoWidth || 640);
              const rightIrisPx = Math.hypot(landmarks[474].x - landmarks[476].x, landmarks[474].y - landmarks[476].y) * (video.videoWidth || 640);
              const avgIrisPx = (leftIrisPx + rightIrisPx) / 2;
              
              if (avgIrisPx > 2) {
                const focalLength = 0.85 * (video.videoWidth || 640);
                calculatedDistanceCm = Math.round((focalLength * 1.17) / avgIrisPx);
                calculatedDistanceCm = Math.max(15, Math.min(220, calculatedDistanceCm));
                setMetricDistance(calculatedDistanceCm);
              }
            }

            if (nose && leftEyeOuter && rightEyeOuter && chin && forehead) {
              const dLeft = Math.hypot(nose.x - leftEyeOuter.x, nose.y - leftEyeOuter.y);
              const dRight = Math.hypot(nose.x - rightEyeOuter.x, nose.y - rightEyeOuter.y);
              const yawRatio = (dLeft - dRight) / (dLeft + dRight);
              
              const rawYaw = Math.round(yawRatio * 100);
              rawYawRef.current = rawYaw;

              const dNoseChin = chin.y - nose.y;
              const dNoseForehead = nose.y - forehead.y;
              const pitchRatio = (dNoseChin - dNoseForehead) / (dNoseChin + dNoseForehead);
              const rawPitch = Math.round(pitchRatio * 100);
              rawPitchRef.current = rawPitch;

              // Apply adaptive neutral baseline calibration offset
              const calculatedYaw = rawYaw - (baselineOffsetRef.current?.yaw || 0);
              const calculatedPitch = rawPitch - (baselineOffsetRef.current?.pitch || 0);

              setYawAngle(calculatedYaw);
              setPitchAngle(calculatedPitch);

              // Calculate Eye Aspect Ratio (EAR) & Mouth Aspect Ratio (MAR)
              const ear = calculateEAR(landmarks);
              const mar = calculateMAR(landmarks);
              setEarValue(ear);
              setMarValue(mar);

              // MediaPipe Iris: Eye-Gaze Ratio (Iris position within eye aperture)
              let irisGazeAway = false;
              let irisDirection = '';
              if (leftIris && rightIris && leftEyeInner && rightEyeInner) {
                const leftEyeW = Math.max(0.001, Math.abs(leftEyeInner.x - leftEyeOuter.x));
                const rightEyeW = Math.max(0.001, Math.abs(rightEyeOuter.x - rightEyeInner.x));
                const leftRatio = (leftIris.x - Math.min(leftEyeOuter.x, leftEyeInner.x)) / leftEyeW;
                const rightRatio = (rightIris.x - Math.min(rightEyeInner.x, rightEyeOuter.x)) / rightEyeW;
                const avgIrisRatio = (leftRatio + rightRatio) / 2;
                
                if (avgIrisRatio < irisLowThresh) {
                  irisGazeAway = true;
                  irisDirection = 'left';
                } else if (avgIrisRatio > irisHighThresh) {
                  irisGazeAway = true;
                  irisDirection = 'right';
                }
              }

              // Responsive & Accurate Multi-Signal Anomaly Checks
              if (ear < 0.18) {
                currentAnomaly = 'eyes_closed';
                detailsMessage = `Student eyes are closed / possible drowsiness (EAR: ${ear}).`;
                setFaceStatus('eyes_closed');
              } else if (mar > 0.58) {
                currentAnomaly = 'talking';
                detailsMessage = `Student mouth is open / possible talking or whispering (MAR: ${mar}).`;
                setFaceStatus('talking');
              } else if (Math.abs(calculatedYaw) >= yawThresh) {
                currentAnomaly = 'looking_away';
                const direction = calculatedYaw > 0 ? 'right' : 'left';
                detailsMessage = `Student is looking away to the ${direction} (Head Yaw: ${calculatedYaw}°).`;
                setFaceStatus('looking_away');
              } else if (calculatedPitch < pitchDownThresh) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is looking down away from screen (Head Pitch: ${calculatedPitch}°).`;
                setFaceStatus('looking_away');
              } else if (calculatedPitch > pitchUpThresh) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is looking up away from screen (Head Pitch: ${calculatedPitch}°).`;
                setFaceStatus('looking_away');
              } else if (irisGazeAway) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student eye gaze is directed to the ${irisDirection} off-screen (Iris Gaze Shift).`;
                setFaceStatus('looking_away');
              } else if (calculatedDistanceCm > 140) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is too far away from desk/camera (Distance: ~${calculatedDistanceCm} cm).`;
                setFaceStatus('looking_away');
              } else if (calculatedDistanceCm < 20) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is excessively close to camera lens (Distance: ~${calculatedDistanceCm} cm).`;
                setFaceStatus('looking_away');
              } else {
                setFaceStatus('normal');
              }
            }
          }

          // Anti-Jitter Debounce Gate Logic with 600ms Grace Window
          const now = Date.now();
          if (currentAnomaly) {
            lastAnomalyTimeRef.current = now;
            if (!anomalyStartRef.current || anomalyStartRef.current.type !== currentAnomaly) {
              anomalyStartRef.current = { type: currentAnomaly, startTime: now, details: detailsMessage };
            } else {
              const elapsedSeconds = (now - anomalyStartRef.current.startTime) / 1000;
              if (elapsedSeconds >= debounceSeconds) {
                setActiveViolation(currentAnomaly);
                startIncident(currentAnomaly, detailsMessage);
              }
            }
          } else {
            // Grace window of 600ms to tolerate blinks / momentary noise
            const timeSinceLastAnomaly = now - (lastAnomalyTimeRef.current || 0);
            if (timeSinceLastAnomaly > 600) {
              anomalyStartRef.current = null;
              setActiveViolation(null);
              if (activeIncidentDocRef.current) {
                resolveIncident();
              }
            }
          }
        } catch (err) {
          console.debug('MediaPipe detection tick error:', err);
        }
      }

      // Hardware Frame Sync: Use requestVideoFrameCallback if supported, fallback to requestAnimationFrame
      const videoEl = webcamVideoRef.current;
      if (videoEl && typeof videoEl.requestVideoFrameCallback === 'function') {
        videoFrameCallbackIdRef.current = videoEl.requestVideoFrameCallback(detectFrame);
      } else {
        requestAnimationRef.current = requestAnimationFrame(detectFrame);
      }
    };

    const videoEl = webcamVideoRef.current;
    if (videoEl && typeof videoEl.requestVideoFrameCallback === 'function') {
      videoFrameCallbackIdRef.current = videoEl.requestVideoFrameCallback(detectFrame);
    } else {
      requestAnimationRef.current = requestAnimationFrame(detectFrame);
    }

    return () => {
      isRunningRef.current = false;
      if (requestAnimationRef.current) {
        cancelAnimationFrame(requestAnimationRef.current);
      }
      if (videoFrameCallbackIdRef.current && webcamVideoRef.current && typeof webcamVideoRef.current.cancelVideoFrameCallback === 'function') {
        try { webcamVideoRef.current.cancelVideoFrameCallback(videoFrameCallbackIdRef.current); } catch {}
      }
      if (activeIncidentDocRef.current) {
        resolveIncident();
      }
    };
  }, [clientAiStatus, customPitchDownAngle, customPitchUpAngle, customYawAngle, debounceSeconds, effectiveMode, gazeSensitivity, isClientAiAllowed, isWebcamSharing, overlayCanvasRef, resolveIncident, showMeshOverlay, startIncident, webcamVideoRef]);

  return {
    faceStatus,
    clientAiStatus,
    loadingProgress,
    isModelCached: isCached,
    isPreloading,
    preloadModel,
    fallbackReason,
    delegateUsed,
    yawAngle,
    pitchAngle,
    earValue,
    marValue,
    isCalibrated,
    calibrateBaseline,
    resetCalibration,
    metricDistance,
    activeViolation,
  };
};

export default useFaceMonitor;
