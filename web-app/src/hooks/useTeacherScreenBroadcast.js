import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, serverTimestamp, collection } from 'firebase/firestore';

export const BROADCAST_MODES = {
  FRAME: 'frame',
};

/**
 * Teacher-side screen broadcasting hook:
 * Low-Bandwidth Classroom Frame Broadcaster (50+ students, zero-cost, teacher CPU < 2%, no WebRTC).
 */
export default function useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastMode] = useState(BROADCAST_MODES.FRAME);
  const [screenStream, setScreenStream] = useState(null);
  const [viewers, setViewers] = useState([]);
  const [frameStats, setFrameStats] = useState({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
  const [error, setError] = useState(null);

  const screenStreamRef = useRef(null);
  const unsubscribeViewersCollectionRef = useRef(null);
  const isStoppingRef = useRef(false);

  // Frame broadcasting refs
  const frameTimerRef = useRef(null);
  const offscreenVideoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const diffCanvasRef = useRef(null);
  const lastDiffDataRef = useRef(null);
  const frameSeqRef = useRef(0);
  const frameStatsRef = useRef({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });

  // Clean up timer, video, stream tracks, and Firestore records
  const stopBroadcast = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 1. Unsubscribe viewers collection listener
    if (unsubscribeViewersCollectionRef.current) {
      unsubscribeViewersCollectionRef.current();
      unsubscribeViewersCollectionRef.current = null;
    }

    // 2. Stop all screen media tracks
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

    // 3. Clean up frame broadcasting timer and offscreen elements
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (offscreenVideoRef.current) {
      try {
        offscreenVideoRef.current.pause();
        offscreenVideoRef.current.srcObject = null;
      } catch {}
      offscreenVideoRef.current = null;
    }
    lastDiffDataRef.current = null;
    frameSeqRef.current = 0;

    // 4. Update Firestore session doc and liveFrame doc
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
    setViewers([]);
    setFrameStats({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
    isStoppingRef.current = false;
  }, [classId, teacherUid]);

  // Start live screen broadcast
  const startBroadcast = useCallback(async () => {
    if (!classId) {
      setError('Class ID is required to start broadcasting');
      return;
    }

    try {
      setError(null);
      isStoppingRef.current = false;

      // Request display media clamped to 720p @ 12fps
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 10, max: 12 },
        },
        audio: false,
      });

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = 'detail';
        videoTrack.onended = () => {
          stopBroadcast();
        };
      }

      screenStreamRef.current = stream;
      setScreenStream(stream);

      // Create hidden offscreen video element for frame capture
      const offscreenVideo = document.createElement('video');
      offscreenVideo.srcObject = stream;
      offscreenVideo.muted = true;
      offscreenVideo.playsInline = true;
      await offscreenVideo.play().catch(() => {});
      offscreenVideoRef.current = offscreenVideo;

      // Offscreen capture canvas clamped to 720p
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = 1280;
      captureCanvas.height = 720;
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
        teacherUid: teacherUid || null,
        teacherEmail: teacherEmail || null,
        startedAt: serverTimestamp(),
        endedAt: null,
      }, { merge: true });

      // Frame capture and publishing function
      const captureAndPublishFrame = async (force = false) => {
        if (!offscreenVideoRef.current || !captureCanvasRef.current || !diffCanvasRef.current || isStoppingRef.current) {
          return;
        }

        const video = offscreenVideoRef.current;
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;

        // Draw to low-res thumbnail canvas to check pixel delta
        const diffCtx = diffCanvasRef.current.getContext('2d', { willReadFrequently: true });
        if (!diffCtx) return;
        diffCtx.drawImage(video, 0, 0, 32, 18);
        const currentDiffData = diffCtx.getImageData(0, 0, 32, 18).data;

        let hasChanged = force || !lastDiffDataRef.current;
        if (!hasChanged && lastDiffDataRef.current) {
          let diffPixels = 0;
          for (let i = 0; i < currentDiffData.length; i += 4) {
            if (
              Math.abs(currentDiffData[i] - lastDiffDataRef.current[i]) > 15 ||
              Math.abs(currentDiffData[i + 1] - lastDiffDataRef.current[i + 1]) > 15 ||
              Math.abs(currentDiffData[i + 2] - lastDiffDataRef.current[i + 2]) > 15
            ) {
              diffPixels++;
              if (diffPixels > 8) {
                hasChanged = true;
                break;
              }
            }
          }
        }

        const now = Date.now();
        // Heartbeat emission every 5s even if visually static
        if (!hasChanged && now - frameStatsRef.current.lastEmittedTime > 5000) {
          hasChanged = true;
        }

        if (hasChanged) {
          lastDiffDataRef.current = currentDiffData;

          // Render to capture canvas
          const captureCtx = captureCanvasRef.current.getContext('2d');
          if (!captureCtx) return;

          captureCanvasRef.current.width = vWidth;
          captureCanvasRef.current.height = vHeight;
          captureCtx.drawImage(video, 0, 0, vWidth, vHeight);

          // Compress to JPEG at 0.65 quality (~35-65 KB)
          const jpegDataUrl = captureCanvasRef.current.toDataURL('image/jpeg', 0.65);
          frameSeqRef.current += 1;
          const seq = frameSeqRef.current;

          const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
          await setDoc(liveFrameDocRef, {
            frameData: jpegDataUrl,
            frameSeq: seq,
            width: vWidth,
            height: vHeight,
            timestamp: serverTimestamp(),
          });

          const stats = {
            emittedFrames: seq,
            lastEmittedTime: now,
            lastFrameSize: jpegDataUrl.length,
          };
          frameStatsRef.current = stats;
          setFrameStats(stats);
        }
      };

      // Emit first frame immediately
      await captureAndPublishFrame(true);

      // Start periodic capture loop at 1.5s interval
      frameTimerRef.current = setInterval(() => {
        captureAndPublishFrame(false).catch((err) => {
          console.warn('[Teacher Screen Broadcast] Frame capture error:', err);
        });
      }, 1500);

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
    frameStats,
    viewers,
    viewerCount: viewers.length,
    activeViewerCount: viewers.length,
    error,
    startBroadcast,
    stopBroadcast,
  };
}
