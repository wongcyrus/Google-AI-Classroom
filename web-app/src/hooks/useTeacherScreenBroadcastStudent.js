import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore';

/**
 * Student-side hook for receiving live teacher classroom screen broadcast.
 * Automatically monitors broadcast session status and subscribes to live frames.
 */
export default function useTeacherScreenBroadcastStudent({ classId, studentUid, studentEmail }) {
  const [isBroadcastActive, setIsBroadcastActive] = useState(false);
  const [broadcastInfo, setBroadcastInfo] = useState(null);
  const [liveFrame, setLiveFrame] = useState(null);
  const [isViewing, setIsViewing] = useState(false);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'failed'
  const [error, setError] = useState(null);

  const unsubscribeViewerRef = useRef(null);
  const unsubscribeLiveFrameRef = useRef(null);

  // Clean up frame subscription and viewer record
  const leaveBroadcast = useCallback(async () => {
    if (unsubscribeLiveFrameRef.current) {
      unsubscribeLiveFrameRef.current();
      unsubscribeLiveFrameRef.current = null;
    }

    if (unsubscribeViewerRef.current) {
      unsubscribeViewerRef.current();
      unsubscribeViewerRef.current = null;
    }

    if (classId && studentUid) {
      try {
        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
        await deleteDoc(viewerDocRef);
      } catch {
        // Ignore deletion errors on exit
      }
    }

    setIsViewing(false);
    setLiveFrame(null);
    setConnectionState('idle');
  }, [classId, studentUid]);

  const isViewingRef = useRef(isViewing);
  useEffect(() => {
    isViewingRef.current = isViewing;
  }, [isViewing]);

  // 1. Listen to active broadcast session status in Firestore (with automatic re-subscribe on stream error)
  useEffect(() => {
    if (!classId) {
      setIsBroadcastActive(false);
      setBroadcastInfo(null);
      return;
    }

    let cancelled = false;
    let unsubscribeSession = null;
    let retryTimer = null;

    const subscribeSession = () => {
      if (cancelled) return;
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      unsubscribeSession = onSnapshot(
        sessionDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const active = Boolean(data.isBroadcasting);
            setIsBroadcastActive(active);
            setBroadcastInfo(active ? data : null);
            if (!active && isViewingRef.current) {
              leaveBroadcast();
            }
          } else {
            setIsBroadcastActive(false);
            setBroadcastInfo(null);
            if (isViewingRef.current) {
              leaveBroadcast();
            }
          }
        },
        (err) => {
          console.warn('[Student Screen Broadcast] Session status subscription error (retrying in 2s):', err);
          if (!cancelled) {
            retryTimer = setTimeout(subscribeSession, 2000);
          }
        }
      );
    };

    subscribeSession();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsubscribeSession) unsubscribeSession();
    };
  }, [classId, leaveBroadcast]);

  // Join the teacher's live screen broadcast
  const joinBroadcast = useCallback(async () => {
    if (!classId) return;

    setError(null);
    setConnectionState('connecting');
    setIsViewing(true);
    isViewingRef.current = true;

    try {
      // Register viewer presence so teacher sees who is watching (best effort)
      if (studentUid) {
        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
        setDoc(viewerDocRef, {
          studentUid,
          studentEmail: studentEmail || 'Student',
          status: 'watching',
          joinedAt: serverTimestamp(),
        }).catch((presenceErr) => {
          console.warn('[Student Screen Broadcast] Viewer presence registration notice:', presenceErr);
        });
      }

      // Cleanup existing frame subscription if any
      if (unsubscribeLiveFrameRef.current) {
        unsubscribeLiveFrameRef.current();
        unsubscribeLiveFrameRef.current = null;
      }

      // Subscribe to live frame updates from Firestore (with automatic re-subscribe on stream error)
      let frameRetryTimer = null;
      let currentUnsub = null;
      let stopped = false;

      const subscribeFrame = () => {
        if (stopped || !isViewingRef.current) return;
        const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
        currentUnsub = onSnapshot(
          liveFrameDocRef,
          (snap) => {
            if (!snap.exists()) return;
            const data = snap.data();
            if (data && data.frameData) {
              setLiveFrame(data.frameData);
              setConnectionState('connected');
              setError(null);
            }
          },
          (frameErr) => {
            console.warn('[Student Screen Broadcast] Frame listener subscription notice (reconnecting in 2s):', frameErr);
            setConnectionState('connecting');
            if (!stopped && isViewingRef.current) {
              frameRetryTimer = setTimeout(subscribeFrame, 2000);
            }
          }
        );
      };

      subscribeFrame();
      unsubscribeLiveFrameRef.current = () => {
        stopped = true;
        if (frameRetryTimer) clearTimeout(frameRetryTimer);
        if (currentUnsub) currentUnsub();
      };
    } catch (err) {
      console.error('[Student Screen Broadcast] Error subscribing to frame broadcast:', err);
      setError(err.message || 'Failed to connect to classroom screen broadcast.');
    }
  }, [classId, studentUid, studentEmail]);

  const leaveBroadcastRef = useRef(null);
  useEffect(() => {
    leaveBroadcastRef.current = leaveBroadcast;
  });

  // Clean up on unmount strictly
  useEffect(() => {
    return () => {
      leaveBroadcastRef.current?.();
    };
  }, []);

  return {
    isBroadcastActive,
    broadcastInfo,
    broadcastMode: 'frame',
    liveFrame,
    isViewing,
    connectionState,
    error,
    joinBroadcast,
    leaveBroadcast,
  };
}
