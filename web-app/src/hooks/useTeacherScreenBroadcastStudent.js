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

  // 1. Listen to active broadcast session status in Firestore
  useEffect(() => {
    if (!classId) return;

    const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
    const unsubscribeSession = onSnapshot(sessionDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const active = Boolean(data.isBroadcasting);
        setIsBroadcastActive(active);
        setBroadcastInfo(active ? data : null);
        if (!active && isViewing) {
          leaveBroadcast();
        }
      } else {
        setIsBroadcastActive(false);
        setBroadcastInfo(null);
        if (isViewing) {
          leaveBroadcast();
        }
      }
    });

    return () => {
      unsubscribeSession();
    };
  }, [classId, isViewing, leaveBroadcast]);

  // Join the teacher's live screen broadcast
  const joinBroadcast = useCallback(async () => {
    if (!classId || !studentUid) return;

    setError(null);
    setConnectionState('connecting');
    setIsViewing(true);

    try {
      // Register viewer presence so teacher sees who is watching
      const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
      await setDoc(viewerDocRef, {
        studentUid,
        studentEmail: studentEmail || 'Student',
        status: 'watching',
        joinedAt: serverTimestamp(),
      });

      // Subscribe to live frame updates from Firestore
      const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
      unsubscribeLiveFrameRef.current = onSnapshot(liveFrameDocRef, (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();
        if (data.frameData) {
          setLiveFrame(data.frameData);
          setConnectionState('connected');
          setError(null);
        }
      });
    } catch (err) {
      console.error('[Student Screen Broadcast] Error subscribing to frame broadcast:', err);
      setError(err.message || 'Failed to connect to classroom screen broadcast.');
      setConnectionState('failed');
    }
  }, [classId, studentUid, studentEmail]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      leaveBroadcast();
    };
  }, [leaveBroadcast]);

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
