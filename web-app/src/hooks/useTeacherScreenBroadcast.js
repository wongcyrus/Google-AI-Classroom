import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';

export const BROADCAST_MODES = {
  FRAME: 'frame',
};

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
  const [broadcastMode] = useState(BROADCAST_MODES.FRAME);
  const [screenStream, setScreenStream] = useState(null);
  const [lastFrameData, setLastFrameData] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [frameStats, setFrameStats] = useState({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
  const [error, setError] = useState(null);

  // Resolution and Framerate configuration state with localStorage persistence
  const [broadcastResolution, setBroadcastResolutionState] = useState(() => {
    try {
      const saved = localStorage.getItem('gemini_teacher_broadcast_resolution');
      return (saved && RESOLUTION_PRESETS[saved]) ? saved : '1080p';
    } catch {
      return '1080p';
    }
  });

  const [broadcastInterval, setBroadcastIntervalState] = useState(() => {
    try {
      const saved = Number(localStorage.getItem('gemini_teacher_broadcast_interval'));
      return [1000, 1500, 2000, 3000].includes(saved) ? saved : 1500;
    } catch {
      return 1500;
    }
  });

  const broadcastResolutionRef = useRef(broadcastResolution);
  broadcastResolutionRef.current = broadcastResolution;

  const broadcastIntervalRef = useRef(broadcastInterval);
  broadcastIntervalRef.current = broadcastInterval;

  const screenStreamRef = useRef(null);
  const unsubscribeViewersCollectionRef = useRef(null);
  const isStoppingRef = useRef(false);

  // Frame broadcasting refs
  const frameTimerRef = useRef(null);
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

    // 3. Fallback interval cleanup
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }

    // 4. Unsubscribe viewers collection listener
    if (unsubscribeViewersCollectionRef.current) {
      unsubscribeViewersCollectionRef.current();
      unsubscribeViewersCollectionRef.current = null;
    }

    // 5. Stop all screen media tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          console.warn('[Teacher Screen Broadcast] Error stopping track:', err);
        }
      });
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

    // 7. Update Firestore session doc and liveFrame doc
    if (classId) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        await setDoc(sessionDocRef, {
          isBroadcasting: false,
          teacherUid: teacherUid || null,
          endedAt: serverTimestamp(),
        }, { merge: true });

        const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
        await setDoc(liveFrameDocRef, {
          frameData: null,
          endedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error updating session/liveFrame doc on stop:', err);
      }
    }

    setIsBroadcasting(false);
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

      const activeRes = options.resolution || broadcastResolutionRef.current || '1080p';
      const preset = RESOLUTION_PRESETS[activeRes] || RESOLUTION_PRESETS['1080p'];
      const activeInterval = options.interval || broadcastIntervalRef.current || 1500;

      // Update refs to match selected startup options
      broadcastResolutionRef.current = activeRes;
      setBroadcastResolutionState(activeRes);
      broadcastIntervalRef.current = activeInterval;
      setBroadcastIntervalState(activeInterval);

      // Request display media at pristine native screen resolution
      // Avoid setting strict max constraints so Chromium desktop compositor does not downsample
      const displayMediaOptions = {
        video: {
          displaySurface: 'monitor',
          frameRate: { ideal: 10, max: 15 },
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = 'detail';
        videoTrack.onended = () => {
          stopBroadcast();
        };
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

      // Initialize broadcast session in Firestore
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      await setDoc(sessionDocRef, {
        isBroadcasting: true,
        broadcastMode: 'frame',
        resolution: activeRes,
        intervalMs: activeInterval,
        teacherUid: teacherUid || null,
        teacherEmail: teacherEmail || null,
        startedAt: serverTimestamp(),
        endedAt: null,
      }, { merge: true });

      // Frame capture and publishing function
      const captureAndPublishFrame = async (force = false) => {
        if (!captureCanvasRef.current || !diffCanvasRef.current || isStoppingRef.current) {
          return;
        }

        // Concurrency guard: avoid overlapping capture/upload calls when browser is backgrounded
        if (isCapturingFrameRef.current) {
          return;
        }
        isCapturingFrameRef.current = true;

        let frameSource = null;
        let isBitmap = false;

        const tracks = screenStreamRef.current ? screenStreamRef.current.getVideoTracks() : [];
        const track = (tracks.length > 0 && tracks[0].readyState === 'live') ? tracks[0] : null;
        const trackSettings = (track && typeof track.getSettings === 'function') ? track.getSettings() : {};

        let sourceWidth = trackSettings.width || 0;
        let sourceHeight = trackSettings.height || 0;

        try {
          // 1. Prefer ImageCapture API directly from hardware track (immune to background tab throttling)
          if (typeof window !== 'undefined' && 'ImageCapture' in window && track) {
            try {
              const imageCapture = new window.ImageCapture(track);
              frameSource = await imageCapture.grabFrame();
              sourceWidth = frameSource.width || sourceWidth;
              sourceHeight = frameSource.height || sourceHeight;
              isBitmap = true;
            } catch {
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
          // Heartbeat emission every 2s even if visually static to keep student view updated
          if (!hasChanged && now - frameStatsRef.current.lastEmittedTime > 2000) {
            hasChanged = true;
          }

          if (hasChanged) {
            lastDiffDataRef.current = currentDiffData;

            // Render to capture canvas dynamically adapting to active resolution preset
            const currentRes = broadcastResolutionRef.current || '1080p';
            const currentPreset = RESOLUTION_PRESETS[currentRes] || RESOLUTION_PRESETS['1080p'];

            let targetWidth = vWidth;
            let targetHeight = vHeight;
            if (currentRes !== 'native' && (targetWidth > currentPreset.width || targetHeight > currentPreset.height)) {
              const scale = Math.min(currentPreset.width / targetWidth, currentPreset.height / targetHeight, 1);
              targetWidth = Math.round(targetWidth * scale);
              targetHeight = Math.round(targetHeight * scale);
            }

            const captureCtx = captureCanvasRef.current.getContext('2d', { willReadFrequently: true });
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

            // Compress to JPEG using preset quality (sharpness tailored for code, text, and slides)
            let quality = currentPreset.quality || 0.82;
            let jpegDataUrl = captureCanvasRef.current.toDataURL('image/jpeg', quality);

            // Guard against Firestore 1MB document limit (1,048,576 bytes)
            // Base64 string length must be < 950,000 to guarantee safe Firestore commit
            const MAX_FIRESTORE_PAYLOAD_LEN = 950000;
            if (jpegDataUrl.length > MAX_FIRESTORE_PAYLOAD_LEN) {
              quality = Math.max(0.60, quality - 0.12);
              jpegDataUrl = captureCanvasRef.current.toDataURL('image/jpeg', quality);
              if (jpegDataUrl.length > MAX_FIRESTORE_PAYLOAD_LEN) {
                const safeCanvas = document.createElement('canvas');
                safeCanvas.width = Math.round(targetWidth * 0.85);
                safeCanvas.height = Math.round(targetHeight * 0.85);
                const safeCtx = safeCanvas.getContext('2d');
                if (safeCtx) {
                  safeCtx.imageSmoothingEnabled = true;
                  safeCtx.imageSmoothingQuality = 'high';
                  safeCtx.drawImage(captureCanvasRef.current, 0, 0, safeCanvas.width, safeCanvas.height);
                  jpegDataUrl = safeCanvas.toDataURL('image/jpeg', 0.78);
                }
              }
            }

            frameSeqRef.current += 1;
            const seq = frameSeqRef.current;

            const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
            await setDoc(liveFrameDocRef, {
              frameData: jpegDataUrl,
              frameSeq: seq,
              width: targetWidth,
              height: targetHeight,
              resolution: currentRes,
              timestamp: serverTimestamp(),
            });

            const stats = {
              emittedFrames: seq,
              lastEmittedTime: now,
              lastFrameSize: jpegDataUrl.length,
            };
            frameStatsRef.current = stats;
            setFrameStats(stats);
            setLastFrameData(jpegDataUrl);
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

      // Emit first frame immediately
      await captureAndPublishFrame(true);

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

      setIsBroadcasting(true);

      // Listen for student viewer presence in the collection
      const viewersCollectionRef = collection(db, `classes/${classId}/screenBroadcastViewers`);
      unsubscribeViewersCollectionRef.current = onSnapshot(viewersCollectionRef, (snapshot) => {
        const currentViewers = [];
        snapshot.forEach((docSnap) => {
          const vData = docSnap.data();
          const studentUid = docSnap.id;
          currentViewers.push({
            studentUid,
            studentEmail: vData.studentEmail || 'Student',
            status: 'watching',
            connectionState: 'connected',
            joinedAt: vData.joinedAt,
          });
        });

        setViewers(currentViewers);
      });
    } catch (err) {
      console.error('[Teacher Screen Broadcast] Failed to start broadcast:', err);
      setError(err.message || 'Failed to start screen broadcast.');
      await stopBroadcast();
    }
  }, [classId, teacherUid, teacherEmail, stopBroadcast]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopBroadcast();
    };
  }, [stopBroadcast]);

  return {
    isBroadcasting,
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
    startBroadcast,
    stopBroadcast,
  };
}
