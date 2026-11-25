import { useState, useRef, useCallback, useEffect } from 'react';
import { db, storage } from '../firebase-config';
import { doc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

export const BROADCAST_MODES = {
  FRAME: 'frame',
  STATIC_URL: 'static_url',
};

const SLIDE_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;

function createRandomSlideToken() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === 'function') {
      return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16);
    }
    if (typeof globalThis.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(8);
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
  }
  return `${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 10)}`.slice(0, 16);
}

async function encodeCanvasToJpeg(canvas, quality) {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise((resolve) => {
      let settled = false;
      const timerId = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, 500);
      try {
        canvas.toBlob((result) => {
          if (!settled) {
            settled = true;
            clearTimeout(timerId);
            resolve(result || null);
          }
        }, 'image/jpeg', quality);
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timerId);
          resolve(null);
        }
      }
    });
    if (blob) {
      return { blob, dataUrl: null };
    }
  }

  // Fallback only when toBlob is unavailable or fails
  const dataUrl = canvas.toDataURL('image/jpeg', quality);
  const base64Part = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
  let byteArray;
  try {
    const binary = atob(base64Part);
    byteArray = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      byteArray[i] = binary.charCodeAt(i);
    }
  } catch {
    byteArray = new Uint8Array(0);
  }
  const fallbackBlob = typeof Blob !== 'undefined'
    ? new Blob([byteArray], { type: 'image/jpeg' })
    : { size: byteArray.byteLength, type: 'image/jpeg' };
  return { blob: fallbackBlob, dataUrl };
}

export const RESOLUTION_PRESETS = {
  '1080p': {
    id: '1080p',
    label: '1080p (Full HD - Sharp)',
    shortLabel: '1080p',
    width: 1920,
    height: 1080,
    quality: 0.82,
    recommendedFor: 'Sharp code, terminal, and slide text (Recommended)',
  },
  'native': {
    id: 'native',
    label: 'Native (Original / 2K)',
    shortLabel: 'Native',
    width: 2560,
    height: 1440,
    quality: 0.85,
    recommendedFor: 'Highest sharpness for 1440p/4K monitors',
  },
  '720p': {
    id: '720p',
    label: '720p (HD - Balanced)',
    shortLabel: '720p',
    width: 1280,
    height: 720,
    quality: 0.78,
    recommendedFor: 'Balanced clarity and lower bandwidth',
  },
  '480p': {
    id: '480p',
    label: '480p (SD - Low Data)',
    shortLabel: '480p',
    width: 854,
    height: 480,
    quality: 0.70,
    recommendedFor: 'Constrained network bandwidth',
  },
};

export const FRAMERATE_PRESETS = [
  { interval: 1000, fps: 1.0, label: '1.0s / 1 FPS (Smooth)' },
  { interval: 1500, fps: 0.67, label: '1.5s / 0.7 FPS (Standard)' },
  { interval: 2000, fps: 0.5, label: '2.0s / 0.5 FPS (Relaxed)' },
  { interval: 3000, fps: 0.33, label: '3.0s / 0.3 FPS (Economy)' },
];

/**
 * Teacher-side screen broadcasting hook:
 * Low-Bandwidth Classroom Frame Broadcaster (50+ students, zero-cost, teacher CPU < 2%, no WebRTC).
 * Resilient against background tab throttling via inline Web Worker timer and hardware ImageCapture API.
 */
export default function useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [isPublicBroadcast, setIsPublicBroadcast] = useState(false);
  const [publicPin, setPublicPin] = useState(null);
  const [broadcastMode] = useState(BROADCAST_MODES.STATIC_URL);
  const [screenStream, setScreenStream] = useState(null);
  const [lastFrameData, setLastFrameData] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [frameStats, setFrameStats] = useState({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
  const [error, setError] = useState(null);

  // Resolution and Framerate configuration state with localStorage persistence
  const [broadcastResolution, setBroadcastResolutionState] = useState(() => {
    try {
      const saved = localStorage.getItem('gemini_teacher_broadcast_resolution');
      return (saved && RESOLUTION_PRESETS[saved]) ? saved : '720p';
    } catch {
      return '720p';
    }
  });

  const [broadcastInterval, setBroadcastIntervalState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('gemini_teacher_broadcast_interval'));
      return [1000, 1500, 2000, 3000].includes(saved) ? saved : 3000;
    } catch {
      return 3000;
    }
  });

  const broadcastResolutionRef = useRef(broadcastResolution);
  broadcastResolutionRef.current = broadcastResolution;

  const broadcastIntervalRef = useRef(broadcastInterval);
  broadcastIntervalRef.current = broadcastInterval;

  const isBroadcastingRef = useRef(false);
  isBroadcastingRef.current = isBroadcasting;

  const screenStreamRef = useRef(null);
  const unsubscribeViewersCollectionRef = useRef(null);
  const isStoppingRef = useRef(false);

  // Frame broadcasting refs
  const frameTimerRef = useRef(null);
  const keepAliveTimerRef = useRef(null);
  const workerRef = useRef(null);
  const workerBlobUrlRef = useRef(null);
  const wakeLockRef = useRef(null);
  const offscreenVideoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const diffCanvasRef = useRef(null);
  const lastDiffDataRef = useRef(null);
  const frameSeqRef = useRef(0);
  const frameStatsRef = useRef({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
  const isCapturingFrameRef = useRef(false);
  const captureAndPublishFrameRef = useRef(null);
  const isLocallyCreatedStreamRef = useRef(false);
  const stopBroadcastRef = useRef(null);
  const currentSlideStoragePathRef = useRef(null);
  const uploadedSlidePathsRef = useRef(new Set());
  const lastPreviewBlobUrlRef = useRef(null);

  // Load & sync pre-configured public broadcast state and 4-digit PIN from Firestore DB
  // so switching computers (e.g. from office laptop to stage podium PC) keeps the exact same PIN.
  useEffect(() => {
    if (!classId) return;
    const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
    const unsub = onSnapshot(
      sessionDocRef,
      (snap) => {
        if (typeof snap?.exists === 'function' && snap.exists()) {
          const data = snap.data() || {};
          const dbPin = data.publicPin || data.savedPublicPin || null;
          const dbIsPublic = Boolean(data.isPublic || data.savedIsPublic || data.savedPublicPin);
          if (!isBroadcastingRef.current && data.isBroadcasting && data.frameStoragePath && !currentSlideStoragePathRef.current) {
            currentSlideStoragePathRef.current = data.frameStoragePath;
            uploadedSlidePathsRef.current.add(data.frameStoragePath);
          }
          if (!isBroadcastingRef.current) {
            if (typeof data.isPublic === 'boolean' || typeof data.savedIsPublic === 'boolean' || data.savedPublicPin) {
              setIsPublicBroadcast(dbIsPublic);
            }
            if (dbPin) {
              setPublicPin(String(dbPin));
            }
          }
          if (dbPin || typeof data.isPublic === 'boolean' || typeof data.savedIsPublic === 'boolean') {
            try {
              localStorage.setItem(
                `gemini_public_broadcast_${classId}`,
                JSON.stringify({
                  isPublic: dbIsPublic,
                  publicPin: dbPin ? String(dbPin) : null,
                })
              );
            } catch {}
          }
        }
      },
      () => {}
    );
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [classId]);

  // Pre-configure public presentation mode & 4-digit PIN in Firestore before starting the live stream
  // so speakers can share the broadcast link / QR code in advance and let attendees wait in the lobby.
  const configurePublicAccess = useCallback(async ({ isPublic, publicPin: nextPin }) => {
    const enabled = Boolean(isPublic);
    const cleanPin = enabled && nextPin ? String(nextPin).trim() : null;
    setIsPublicBroadcast(enabled);
    setPublicPin(cleanPin);

    if (classId) {
      try {
        localStorage.setItem(
          `gemini_public_broadcast_${classId}`,
          JSON.stringify({ isPublic: enabled, publicPin: cleanPin })
        );
      } catch {}
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        await setDoc(sessionDocRef, {
          isPublic: enabled,
          savedIsPublic: enabled,
          publicPin: cleanPin,
          savedPublicPin: cleanPin,
          teacherUid: teacherUid || null,
          teacherEmail: teacherEmail || null,
        }, { merge: true });
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error pre-configuring public access:', err);
      }
    }
  }, [classId, teacherUid, teacherEmail]);

  // Update resolution dynamically (persisted to localStorage, Firestore session, and triggers immediate frame)
  const setBroadcastResolution = useCallback(async (newRes) => {
    if (!RESOLUTION_PRESETS[newRes]) return;
    setBroadcastResolutionState(newRes);
    broadcastResolutionRef.current = newRes;
    try {
      localStorage.setItem('gemini_teacher_broadcast_resolution', newRes);
    } catch {}

    // Update broadcast session document in Firestore
    if (classId) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        await setDoc(sessionDocRef, { resolution: newRes }, { merge: true });
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error updating session resolution:', err);
      }
    }

    // Immediately trigger a frame capture with the updated resolution
    if (captureAndPublishFrameRef.current) {
      captureAndPublishFrameRef.current(true).catch(() => {});
    }
  }, [classId]);

  // Update refresh interval dynamically (persisted to localStorage & worker updated on the fly)
  const setBroadcastInterval = useCallback((newInterval) => {
    const val = Number(newInterval);
    if (!val || val < 500) return;
    setBroadcastIntervalState(val);
    broadcastIntervalRef.current = val;
    try {
      localStorage.setItem('gemini_teacher_broadcast_interval', String(val));
    } catch {}
    if (workerRef.current) {
      workerRef.current.postMessage({ action: 'start', interval: val });
    }
  }, []);

  // Clean up timer, worker, wakeLock, video, stream tracks, and Firestore records
  const stopBroadcast = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 1. Release Screen Wake Lock
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {}
      wakeLockRef.current = null;
    }

    // 2. Terminate background Web Worker timer
    if (workerRef.current) {
      try {
        workerRef.current.postMessage({ action: 'stop' });
        workerRef.current.terminate();
      } catch {}
      workerRef.current = null;
    }
    if (workerBlobUrlRef.current) {
      try {
        URL.revokeObjectURL(workerBlobUrlRef.current);
      } catch {}
      workerBlobUrlRef.current = null;
    }

    // 3. Fallback interval & keep-alive timer cleanup
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }

    // 4. Unsubscribe viewers collection listener
    if (unsubscribeViewersCollectionRef.current) {
      unsubscribeViewersCollectionRef.current();
      unsubscribeViewersCollectionRef.current = null;
    }

    // 5. Stop all screen media tracks only if locally created by this hook (preserve caller's shared stream)
    if (screenStreamRef.current) {
      if (isLocallyCreatedStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => {
          try {
            track.stop();
          } catch (err) {
            console.warn('[Teacher Screen Broadcast] Error stopping track:', err);
          }
        });
      }
      screenStreamRef.current = null;
    }

    // 6. Clean up offscreen video element and remove from DOM if attached
    if (offscreenVideoRef.current) {
      try {
        offscreenVideoRef.current.pause();
        offscreenVideoRef.current.srcObject = null;
        if (offscreenVideoRef.current.parentNode) {
          offscreenVideoRef.current.parentNode.removeChild(offscreenVideoRef.current);
        }
      } catch {}
      offscreenVideoRef.current = null;
    }
    lastDiffDataRef.current = null;
    frameSeqRef.current = 0;
    isCapturingFrameRef.current = false;
    captureAndPublishFrameRef.current = null;
    const pathsToDelete = new Set(uploadedSlidePathsRef.current);
    if (currentSlideStoragePathRef.current) {
      pathsToDelete.add(currentSlideStoragePathRef.current);
    }
    currentSlideStoragePathRef.current = null;
    uploadedSlidePathsRef.current.clear();

    // 7. Update Firestore session doc, clean up slide(s) in Storage, and clear legacy liveFrame doc in parallel.
    // Kick off all requests synchronously before awaiting so unmount callers immediately dispatch isBroadcasting: false.
    if (classId) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        const sessionPromise = Promise.resolve(
          setDoc(sessionDocRef, {
            isBroadcasting: false,
            isPublic: false,
            publicPin: null,
            frameUrl: null,
            frameStoragePath: null,
            frameUpdatedAt: null,
            teacherUid: teacherUid || null,
            endedAt: serverTimestamp(),
          }, { merge: true })
        );

        const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
        const liveFramePromise = Promise.resolve(
          setDoc(liveFrameDocRef, {
            frameData: null,
            endedAt: serverTimestamp(),
          }, { merge: true })
        ).catch(() => {});

        const classDocRef = doc(db, `classes/${classId}`);
        const classPromise = Promise.resolve(
          setDoc(classDocRef, {
            isBroadcasting: false,
            overtimeUntil: null,
            broadcastEndedAt: serverTimestamp(),
          }, { merge: true })
        ).catch(() => {});

        const deleteSlidePromise =
          storage && typeof ref === 'function' && typeof deleteObject === 'function' && pathsToDelete.size > 0
            ? Promise.all(
                Array.from(pathsToDelete, (path) =>
                  Promise.resolve(deleteObject(ref(storage, path))).catch(() => {})
                )
              )
            : Promise.resolve();

        await Promise.all([sessionPromise, liveFramePromise, classPromise, deleteSlidePromise]);
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error updating session/storage on stop:', err);
      }
    }

    if (lastPreviewBlobUrlRef.current && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      try {
        URL.revokeObjectURL(lastPreviewBlobUrlRef.current);
      } catch {}
      lastPreviewBlobUrlRef.current = null;
    }
    setIsBroadcasting(false);
    setIsPublicBroadcast(false);
    setPublicPin(null);
    setScreenStream(null);
    setLastFrameData(null);
    setViewers([]);
    setFrameStats({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
    isStoppingRef.current = false;
  }, [classId, teacherUid]);

  // Start live screen broadcast
  const startBroadcast = useCallback(async (options = {}) => {
    if (!classId) {
      setError('Class ID is required to start broadcasting');
      return;
    }

    try {
      setError(null);
      isStoppingRef.current = false;

      const activeRes = options.resolution || broadcastResolutionRef.current || '720p';
      const preset = RESOLUTION_PRESETS[activeRes] || RESOLUTION_PRESETS['720p'];
      const activeInterval = options.interval || broadcastIntervalRef.current || 3000;
      const isPublic = Boolean(options.isPublic);
      const publicPin = options.publicPin ? String(options.publicPin).trim() : null;

      setIsPublicBroadcast(isPublic);
      setPublicPin(isPublic ? publicPin : null);

      // Update refs to match selected startup options
      broadcastResolutionRef.current = activeRes;
      setBroadcastResolutionState(activeRes);
      broadcastIntervalRef.current = activeInterval;
      setBroadcastIntervalState(activeInterval);

      // Check if caller supplied a pre-acquired synchronized screen stream
      let stream = options.existingStream;
      let isLocallyCreatedStream = false;
      if (!stream || !stream.active || stream.getVideoTracks().length === 0) {
        // Request display media at pristine native screen resolution
        // Avoid setting strict max constraints so Chromium desktop compositor does not downsample
        const displayMediaOptions = {
          video: {
            displaySurface: 'monitor',
            frameRate: { ideal: 10, max: 15 },
          },
          audio: false,
        };

        stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        isLocallyCreatedStream = true;
      }
      isLocallyCreatedStreamRef.current = isLocallyCreatedStream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = 'detail';
        const handleTrackEnded = () => {
          stopBroadcast();
        };
        if (typeof videoTrack.addEventListener === 'function') {
          videoTrack.addEventListener('ended', handleTrackEnded, { once: true });
        } else {
          const origEnded = videoTrack.onended;
          videoTrack.onended = () => {
            if (typeof origEnded === 'function') origEnded();
            handleTrackEnded();
          };
        }
      }

      screenStreamRef.current = stream;
      setScreenStream(stream);

      // Create attached hidden video element with full layout dimensions
      // (1px x 1px causes Chromium hardware decoder to allocate minimal texture mipmap and blur frames)
      const offscreenVideo = document.createElement('video');
      offscreenVideo.srcObject = stream;
      offscreenVideo.muted = true;
      offscreenVideo.playsInline = true;
      offscreenVideo.style.position = 'fixed';
      offscreenVideo.style.top = '0';
      offscreenVideo.style.left = '0';
      offscreenVideo.style.width = '1920px';
      offscreenVideo.style.height = '1080px';
      offscreenVideo.style.opacity = '0';
      offscreenVideo.style.pointerEvents = 'none';
      offscreenVideo.style.zIndex = '-9999';
      if (typeof document !== 'undefined' && document.body) {
        document.body.appendChild(offscreenVideo);
      }
      await offscreenVideo.play().catch(() => {});
      offscreenVideoRef.current = offscreenVideo;

      // Offscreen capture canvas configured for resolution preset
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = preset.width;
      captureCanvas.height = preset.height;
      captureCanvasRef.current = captureCanvas;

      // Low-resolution 32x18 diffing canvas
      const diffCanvas = document.createElement('canvas');
      diffCanvas.width = 32;
      diffCanvas.height = 18;
      diffCanvasRef.current = diffCanvas;

      frameSeqRef.current = 0;
      lastDiffDataRef.current = null;
      frameStatsRef.current = { emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 };

      // Initialize broadcast session in Firestore (Option B: static Cloud Storage slide URL + timestamp)
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      await setDoc(sessionDocRef, {
        isBroadcasting: true,
        broadcastMode: BROADCAST_MODES.STATIC_URL,
        resolution: activeRes,
        intervalMs: activeInterval,
        isPublic,
        publicPin: isPublic ? publicPin : null,
        ...(isPublic && publicPin ? { savedIsPublic: true, savedPublicPin: publicPin } : {}),
        teacherUid: teacherUid || null,
        teacherEmail: teacherEmail || null,
        startedAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        endedAt: null,
      }, { merge: true });

      // Mirror live broadcast status and 2-hour overtime protection window onto parent class document
      // so student schedule hooks, class ranking, and scheduled tasks never prematurely cut off an over-running event
      const classDocRef = doc(db, `classes/${classId}`);
      const defaultOvertimeIso = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
      await setDoc(classDocRef, {
        isBroadcasting: true,
        broadcastStartedAt: serverTimestamp(),
        overtimeUntil: options.overtimeUntil || defaultOvertimeIso,
      }, { merge: true }).catch(() => {});

      // Reuse a single ImageCapture instance per track to avoid Chromium handle exhaustion / grabFrame() deadlock
      let reusableImageCapture = null;
      let reusableImageCaptureTrack = null;
      let captureStartedAt = 0;

      // Frame capture and publishing function
      const captureAndPublishFrame = async (force = false) => {
        if (!captureCanvasRef.current || !diffCanvasRef.current || isStoppingRef.current) {
          return;
        }

        // Concurrency guard with 5s watchdog: avoid overlapping capture/upload calls while preventing permanent lockups
        const entryNow = Date.now();
        if (isCapturingFrameRef.current) {
          if (captureStartedAt > 0 && entryNow - captureStartedAt < 5000) {
            return;
          }
          console.warn('[Teacher Screen Broadcast] Watchdog reset stuck frame capture guard after 5s.');
          isCapturingFrameRef.current = false;
        }
        isCapturingFrameRef.current = true;
        captureStartedAt = entryNow;

        let frameSource = null;
        let isBitmap = false;

        const tracks = screenStreamRef.current ? screenStreamRef.current.getVideoTracks() : [];
        const track = (tracks.length > 0 && tracks[0].readyState === 'live') ? tracks[0] : null;
        const trackSettings = (track && typeof track.getSettings === 'function') ? track.getSettings() : {};

        let sourceWidth = trackSettings.width || 0;
        let sourceHeight = trackSettings.height || 0;

        try {
          // 1. Prefer ImageCapture API directly from hardware track (immune to background tab throttling)
          // Guard with a 1000ms timeout because Chromium's grabFrame() can hang indefinitely when desktop has no damage rects
          if (typeof window !== 'undefined' && 'ImageCapture' in window && track) {
            let grabTimeoutId = null;
            try {
              if (!reusableImageCapture || reusableImageCaptureTrack !== track) {
                reusableImageCapture = new window.ImageCapture(track);
                reusableImageCaptureTrack = track;
              }
              const grabPromise = reusableImageCapture.grabFrame();
              const grabTimeoutPromise = new Promise((_, reject) => {
                grabTimeoutId = setTimeout(() => reject(new Error('grabFrame timeout')), 1000);
              });
              frameSource = await Promise.race([grabPromise, grabTimeoutPromise]);
              if (grabTimeoutId) clearTimeout(grabTimeoutId);
              sourceWidth = frameSource.width || sourceWidth;
              sourceHeight = frameSource.height || sourceHeight;
              isBitmap = true;
            } catch {
              if (grabTimeoutId) clearTimeout(grabTimeoutId);
              reusableImageCapture = null;
              reusableImageCaptureTrack = null;
              frameSource = null;
            }
          }

          // 2. Fallback to attached video element
          if (!frameSource && offscreenVideoRef.current) {
            frameSource = offscreenVideoRef.current;
            sourceWidth = frameSource.videoWidth || sourceWidth || 1920;
            sourceHeight = frameSource.videoHeight || sourceHeight || 1080;
          }

          if (!frameSource) return;

          const vWidth = sourceWidth || 1920;
          const vHeight = sourceHeight || 1080;

          // Draw to low-res thumbnail canvas to check pixel delta
          const diffCtx = diffCanvasRef.current.getContext('2d', { willReadFrequently: true });
          if (!diffCtx) return;
          diffCtx.drawImage(frameSource, 0, 0, 32, 18);
          const currentDiffData = diffCtx.getImageData(0, 0, 32, 18).data;

          let hasChanged = force || !lastDiffDataRef.current;
          if (!hasChanged && lastDiffDataRef.current) {
            let diffPixels = 0;
            for (let i = 0; i < currentDiffData.length; i += 4) {
              if (
                Math.abs(currentDiffData[i] - lastDiffDataRef.current[i]) > 10 ||
                Math.abs(currentDiffData[i + 1] - lastDiffDataRef.current[i + 1]) > 10 ||
                Math.abs(currentDiffData[i + 2] - lastDiffDataRef.current[i + 2]) > 10
              ) {
                diffPixels++;
                if (diffPixels > 2) {
                  hasChanged = true;
                  break;
                }
              }
            }
          }

          const now = Date.now();

          // Option B: Only upload a new static slide to Cloud Storage when pixels change or force=true.
          // Do NOT force a 2s static heartbeat write when the slide is unchanged.
          if (hasChanged) {
            // Render to capture canvas dynamically adapting to active resolution preset
            const currentRes = broadcastResolutionRef.current || '720p';
            const currentPreset = RESOLUTION_PRESETS[currentRes] || RESOLUTION_PRESETS['720p'];

            let targetWidth = vWidth;
            let targetHeight = vHeight;
            if (currentRes !== 'native' && (targetWidth > currentPreset.width || targetHeight > currentPreset.height)) {
              const scale = Math.min(currentPreset.width / targetWidth, currentPreset.height / targetHeight, 1);
              targetWidth = Math.round(targetWidth * scale);
              targetHeight = Math.round(targetHeight * scale);
            }

            const captureCtx = captureCanvasRef.current.getContext('2d');
            if (!captureCtx) return;

            if (captureCanvasRef.current.width !== targetWidth) captureCanvasRef.current.width = targetWidth;
            if (captureCanvasRef.current.height !== targetHeight) captureCanvasRef.current.height = targetHeight;

            // Set high-quality bicubic smoothing for downscaling; disable if 1:1 for pixel-perfect sharpness
            const isOneToOne = (targetWidth === vWidth && targetHeight === vHeight);
            captureCtx.imageSmoothingEnabled = !isOneToOne;
            if (!isOneToOne) {
              captureCtx.imageSmoothingQuality = 'high';
            }

            captureCtx.drawImage(frameSource, 0, 0, targetWidth, targetHeight);

            // Compress to JPEG using preset quality and cap below Storage limit (< 2.5 MB for instant slide loads)
            let quality = currentPreset.quality || 0.82;
            let { blob: jpegBlob, dataUrl: jpegDataUrl } = await encodeCanvasToJpeg(captureCanvasRef.current, quality);

            const MAX_SLIDE_BYTES = 2500000;
            if ((jpegBlob?.size || jpegDataUrl?.length || 0) > MAX_SLIDE_BYTES) {
              quality = Math.max(0.65, quality - 0.12);
              ({ blob: jpegBlob, dataUrl: jpegDataUrl } = await encodeCanvasToJpeg(captureCanvasRef.current, quality));
            }

            frameSeqRef.current += 1;
            const seq = frameSeqRef.current;
            const frameUpdatedAt = now;
            const slideNonce = createRandomSlideToken();
            const frameStoragePath = `broadcasts/${classId}/slide_${frameUpdatedAt}_${slideNonce}.jpg`;
            const prevSlidePath = currentSlideStoragePathRef.current;
            let versionedUrl = jpegDataUrl || '';

            if (storage && typeof ref === 'function' && typeof uploadBytes === 'function') {
              const slideStorageRef = ref(storage, frameStoragePath);
              uploadedSlidePathsRef.current.add(frameStoragePath);
              const uploadPromise = (async () => {
                await uploadBytes(slideStorageRef, jpegBlob, {
                  contentType: 'image/jpeg',
                  cacheControl: 'private, max-age=3600',
                });
                if (typeof getDownloadURL === 'function') {
                  const baseUrl = await getDownloadURL(slideStorageRef);
                  const sep = baseUrl.includes('?') ? '&' : '?';
                  return `${baseUrl}${sep}t=${frameUpdatedAt}`;
                }
                return versionedUrl;
              })();
              let uploadTimeoutId = null;
              const uploadTimeoutPromise = new Promise((_, reject) => {
                uploadTimeoutId = setTimeout(() => reject(new Error('Slide upload timeout')), 8000);
              });
              try {
                versionedUrl = await Promise.race([uploadPromise, uploadTimeoutPromise]);
              } finally {
                if (uploadTimeoutId) clearTimeout(uploadTimeoutId);
              }
            }

            // If stopBroadcast() was triggered mid-upload, purge the newly uploaded slide and abort publish
            if (isStoppingRef.current) {
              if (storage && typeof ref === 'function' && typeof deleteObject === 'function') {
                Promise.resolve(deleteObject(ref(storage, frameStoragePath)))
                  .then(() => {
                    uploadedSlidePathsRef.current.delete(frameStoragePath);
                  })
                  .catch(() => {});
              }
              return;
            }

            const sessionPublishDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
            const publishPromise = setDoc(sessionPublishDocRef, {
              isBroadcasting: true,
              broadcastMode: BROADCAST_MODES.STATIC_URL,
              resolution: currentRes,
              frameUrl: versionedUrl,
              frameStoragePath,
              frameUpdatedAt,
              frameSeq: seq,
              width: targetWidth,
              height: targetHeight,
              lastActiveAt: serverTimestamp(),
            }, { merge: true });
            let publishTimeoutId = null;
            const timeoutPromise = new Promise((_, reject) => {
              publishTimeoutId = setTimeout(() => reject(new Error('Slide metadata publish timeout')), 3000);
            });
            try {
              await Promise.race([publishPromise, timeoutPromise]);
            } finally {
              if (publishTimeoutId) clearTimeout(publishTimeoutId);
            }

            currentSlideStoragePathRef.current = frameStoragePath;

            // Expire the previous slide immediately after publishing the replacement URL/token
            if (
              prevSlidePath &&
              prevSlidePath !== frameStoragePath &&
              storage &&
              typeof ref === 'function' &&
              typeof deleteObject === 'function'
            ) {
              Promise.resolve(deleteObject(ref(storage, prevSlidePath)))
                .then(() => {
                  uploadedSlidePathsRef.current.delete(prevSlidePath);
                })
                .catch(() => {});
            }

            // Only mark diff data as emitted after upload + session publish succeed
            lastDiffDataRef.current = currentDiffData;

            const stats = {
              emittedFrames: seq,
              lastEmittedTime: now,
              lastFrameSize: jpegBlob?.size || jpegDataUrl?.length || 0,
            };
            frameStatsRef.current = stats;
            setFrameStats(stats);
            let nextPreviewUrl = jpegDataUrl || versionedUrl || null;
            if (!jpegDataUrl && jpegBlob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
              try {
                const createdObjUrl = URL.createObjectURL(jpegBlob);
                if (lastPreviewBlobUrlRef.current && typeof URL.revokeObjectURL === 'function') {
                  URL.revokeObjectURL(lastPreviewBlobUrlRef.current);
                }
                lastPreviewBlobUrlRef.current = createdObjUrl;
                nextPreviewUrl = createdObjUrl;
              } catch {
                nextPreviewUrl = versionedUrl || null;
              }
            }
            setLastFrameData(nextPreviewUrl);
          }
        } finally {
          // Release GPU texture memory for ImageBitmap immediately to avoid Chromium texture leak
          if (isBitmap && frameSource && typeof frameSource.close === 'function') {
            try {
              frameSource.close();
            } catch {}
          }
          isCapturingFrameRef.current = false;
        }
      };

      captureAndPublishFrameRef.current = captureAndPublishFrame;

      // Emit first frame immediately (non-fatal if initial frame publish times out so broadcast loop still starts)
      await captureAndPublishFrame(true).catch((firstErr) => {
        console.warn('[Teacher Screen Broadcast] Initial frame publish notice (will retry on next tick):', firstErr);
      });

      // Start periodic capture loop driven by inline Web Worker
      // (immune to Edge / Chromium background tab timer throttling)
      const handleTick = () => {
        captureAndPublishFrame(false).catch((err) => {
          console.warn('[Teacher Screen Broadcast] Frame capture error:', err);
        });
      };

      try {
        if (typeof window !== 'undefined' && window.Worker && typeof Blob !== 'undefined') {
          const blob = new Blob([`
            let timerId = null;
            self.onmessage = function(e) {
              if (e.data && e.data.action === 'start') {
                if (timerId) clearInterval(timerId);
                timerId = setInterval(function() {
                  self.postMessage('tick');
                }, e.data.interval);
              } else if (e.data && e.data.action === 'stop') {
                if (timerId) {
                  clearInterval(timerId);
                  timerId = null;
                }
              }
            };
          `], { type: 'application/javascript' });
          const blobUrl = URL.createObjectURL(blob);
          workerBlobUrlRef.current = blobUrl;
          const worker = new Worker(blobUrl);
          worker.onmessage = (e) => {
            if (e.data === 'tick') {
              handleTick();
            }
          };
          worker.postMessage({ action: 'start', interval: activeInterval });
          workerRef.current = worker;
        } else {
          frameTimerRef.current = setInterval(handleTick, activeInterval);
        }
      } catch {
        frameTimerRef.current = setInterval(handleTick, activeInterval);
      }

      // Acquire Screen Wake Lock if supported
      try {
        if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && navigator.wakeLock?.request) {
          navigator.wakeLock.request('screen').then((lock) => {
            wakeLockRef.current = lock;
          }).catch(() => {});
        }
      } catch {}

      // Lightweight session keep-alive every 5 min so static slides are not swept during overtime classes
      if (keepAliveTimerRef.current) clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = setInterval(() => {
        if (!isBroadcastingRef.current || isStoppingRef.current || !classId) return;
        const keepAliveDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        setDoc(keepAliveDocRef, { lastActiveAt: serverTimestamp() }, { merge: true }).catch(() => {});
      }, SLIDE_KEEPALIVE_INTERVAL_MS);

      setIsBroadcasting(true);

      // Listen for student/spectator viewer presence in the collection (coalesced to prevent UI re-render storms during large QR scan waves)
      const viewersCollectionRef = collection(db, `classes/${classId}/screenBroadcastViewers`);
      let lastViewerUpdateAt = 0;
      let pendingViewerTimer = null;
      const rawUnsubViewers = onSnapshot(viewersCollectionRef, (snapshot) => {
        const parseSnapshot = () => {
          const currentViewers = [];
          snapshot.forEach((docSnap) => {
            const vData = docSnap.data() || {};
            const studentUid = docSnap.id;
            const isAnon = Boolean(vData.isAnonymousSpectator);
            currentViewers.push({
              studentUid,
              studentEmail: vData.studentEmail || (isAnon ? 'Public Spectator' : 'Student'),
              isAnonymousSpectator: isAnon,
              status: 'watching',
              connectionState: 'connected',
              joinedAt: vData.joinedAt,
            });
          });
          setViewers(currentViewers);
          lastViewerUpdateAt = Date.now();
        };

        const elapsed = Date.now() - lastViewerUpdateAt;
        if (lastViewerUpdateAt === 0 || elapsed >= 1000) {
          if (pendingViewerTimer) {
            clearTimeout(pendingViewerTimer);
            pendingViewerTimer = null;
          }
          parseSnapshot();
        } else {
          if (pendingViewerTimer) clearTimeout(pendingViewerTimer);
          pendingViewerTimer = setTimeout(() => {
            pendingViewerTimer = null;
            parseSnapshot();
          }, 1000 - elapsed);
        }
      });
      unsubscribeViewersCollectionRef.current = () => {
        if (pendingViewerTimer) {
          clearTimeout(pendingViewerTimer);
          pendingViewerTimer = null;
        }
        rawUnsubViewers();
      };
    } catch (err) {
      console.error('[Teacher Screen Broadcast] Failed to start broadcast:', err);
      setError(err.message || 'Failed to start screen broadcast.');
      await stopBroadcast();
    }
  }, [classId, teacherUid, teacherEmail, stopBroadcast]);

  useEffect(() => {
    stopBroadcastRef.current = stopBroadcast;
  });

  // Clean up on unmount strictly only if a broadcast is actively running
  // (preserves pre-configured public lobby PIN when teacher closes setup before starting stream)
  useEffect(() => {
    return () => {
      if (isBroadcastingRef.current || screenStreamRef.current) {
        stopBroadcastRef.current?.();
      }
    };
  }, []);

  const pushFrameNow = useCallback(async () => {
    if (captureAndPublishFrameRef.current) {
      await captureAndPublishFrameRef.current(true);
    }
  }, []);

  return {
    isBroadcasting,
    isPublicBroadcast,
    publicPin,
    broadcastMode,
    screenStream,
    lastFrameData,
    frameStats,
    viewers,
    viewerCount: viewers.length,
    activeViewerCount: viewers.length,
    error,
    broadcastResolution,
    broadcastInterval,
    setBroadcastResolution,
    setBroadcastInterval,
    configurePublicAccess,
    pushFrameNow,
    startBroadcast,
    stopBroadcast,
  };
}
