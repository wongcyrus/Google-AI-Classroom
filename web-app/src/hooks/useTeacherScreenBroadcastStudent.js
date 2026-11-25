import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, getDoc, onSnapshot, deleteDoc, serverTimestamp } from 'firebase/firestore';

const MAX_SNAPSHOT_RETRIES = 8;

function isPermanentSnapshotError(err) {
  const code = String(err?.code || '').toLowerCase();
  const msg = String(err?.message || '');
  return (
    code === 'permission-denied' ||
    code === 'unauthenticated' ||
    /permission[-_ ]denied|missing or insufficient permissions/i.test(msg)
  );
}

function getRetryDelayMs(attempt) {
  return Math.min(32000, 2000 * (2 ** Math.min(attempt, 4)));
}

function toEpochMillis(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value?.toMillis === 'function') {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value?.toDate === 'function') {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'object') {
    const sec = typeof value.seconds === 'number' ? value.seconds : value._seconds;
    if (typeof sec === 'number' && Number.isFinite(sec)) {
      const ns = typeof value.nanoseconds === 'number' ? value.nanoseconds : (value._nanoseconds || 0);
      return Math.round(sec * 1000 + ns / 1e6);
    }
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Student-side hook for receiving teacher classroom screen broadcast (Option B).
 * Listens only to the lightweight `screenBroadcast/session` status doc (On/Off + latest slide URL & timestamp).
 * Loads the initial static slide once on join and relies on explicit manual `refreshFrame()` clicks
 * with timestamp comparison (`frameUpdatedAt`) so static slides trigger zero repeat downloads.
 */
export default function useTeacherScreenBroadcastStudent({ classId, studentUid, studentEmail }) {
  const [isBroadcastActive, setIsBroadcastActive] = useState(false);
  const [broadcastInfo, setBroadcastInfo] = useState(null);
  const [liveFrame, setLiveFrame] = useState(null);
  const [frameUpdatedAt, setFrameUpdatedAt] = useState(null);
  const [latestFrameUpdatedAt, setLatestFrameUpdatedAt] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState('idle'); // 'idle' | 'updated' | 'up_to_date' | 'error'
  const [isViewing, setIsViewing] = useState(false);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'failed'
  const [error, setError] = useState(null);

  const isViewingRef = useRef(isViewing);
  useEffect(() => {
    isViewingRef.current = isViewing;
  }, [isViewing]);

  const latestSessionRef = useRef(null);
  const displayedFrameUrlRef = useRef(null);
  const displayedTimestampRef = useRef(null);
  const displayedLegacySeqRef = useRef(null);
  const lastErroredUrlRef = useRef(null);
  const legacyInitialFetchAttemptedRef = useRef(false);
  const refreshFrameRef = useRef(null);

  const applySlideFrame = useCallback((url, ts, legacySeq = null) => {
    if (!url) return false;
    const normalizedTs = toEpochMillis(ts);
    displayedFrameUrlRef.current = url;
    displayedTimestampRef.current = normalizedTs;
    displayedLegacySeqRef.current = legacySeq ?? null;
    lastErroredUrlRef.current = null;
    setLiveFrame(url);
    setFrameUpdatedAt(normalizedTs);
    setConnectionState('connected');
    setError(null);
    return true;
  }, []);

  // Clean up displayed frame and viewer presence record
  const leaveBroadcast = useCallback(async () => {
    displayedFrameUrlRef.current = null;
    displayedTimestampRef.current = null;
    displayedLegacySeqRef.current = null;
    lastErroredUrlRef.current = null;
    legacyInitialFetchAttemptedRef.current = false;

    if (classId && studentUid) {
      try {
        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
        await deleteDoc(viewerDocRef);
      } catch {
        // Ignore deletion errors on exit
      }
    }

    setIsViewing(false);
    isViewingRef.current = false;
    setLiveFrame(null);
    setFrameUpdatedAt(null);
    setRefreshStatus('idle');
    setConnectionState('idle');
  }, [classId, studentUid]);

  // 1. Listen strictly to session status doc (On/Off + metadata; no liveFrame stream)
  useEffect(() => {
    if (!classId) {
      latestSessionRef.current = null;
      setIsBroadcastActive(false);
      setBroadcastInfo(null);
      setLatestFrameUpdatedAt(null);
      return;
    }

    let cancelled = false;
    let unsubscribeSession = null;
    let retryTimer = null;
    let retryAttempt = 0;

    const subscribeSession = () => {
      if (cancelled) return;
      if (unsubscribeSession) {
        try {
          unsubscribeSession();
        } catch {}
        unsubscribeSession = null;
      }

      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      unsubscribeSession = onSnapshot(
        sessionDocRef,
        (snap) => {
          retryAttempt = 0;
          if (snap.exists()) {
            const data = snap.data() || {};
            const active = Boolean(data.isBroadcasting);
            latestSessionRef.current = active ? data : null;
            setIsBroadcastActive(active);
            setBroadcastInfo(active ? data : null);
            const nextTs = active ? toEpochMillis(data.frameUpdatedAt) : null;
            setLatestFrameUpdatedAt(nextTs);

            if (!active) {
              legacyInitialFetchAttemptedRef.current = false;
              if (isViewingRef.current) {
                leaveBroadcast();
              }
            } else if (isViewingRef.current && !displayedFrameUrlRef.current) {
              if (data.frameUrl) {
                // First slide initial load only — subsequent slide changes wait for manual Refresh click
                legacyInitialFetchAttemptedRef.current = false;
                applySlideFrame(data.frameUrl, nextTs, null);
              } else if (data.broadcastMode !== 'static_url' && !legacyInitialFetchAttemptedRef.current) {
                // Pre-deploy teacher emitting legacy `liveFrame`: perform one-time single getDoc fetch without live listener
                legacyInitialFetchAttemptedRef.current = true;
                refreshFrameRef.current?.();
              }
            }
          } else {
            legacyInitialFetchAttemptedRef.current = false;
            latestSessionRef.current = null;
            setIsBroadcastActive(false);
            setBroadcastInfo(null);
            setLatestFrameUpdatedAt(null);
            if (isViewingRef.current) {
              leaveBroadcast();
            }
          }
        },
        (err) => {
          if (cancelled) return;
          if (isPermanentSnapshotError(err)) {
            console.warn('[Student Screen Broadcast] Session subscription permission denied; stopping retries:', err);
            setConnectionState('failed');
            setError(err.message || 'Permission denied reading broadcast session.');
            return;
          }
          if (retryAttempt >= MAX_SNAPSHOT_RETRIES) {
            console.warn('[Student Screen Broadcast] Session subscription max retries reached:', err);
            setConnectionState('failed');
            return;
          }
          const delayMs = getRetryDelayMs(retryAttempt);
          retryAttempt += 1;
          console.warn(`[Student Screen Broadcast] Session status subscription error (retrying in ${delayMs}ms):`, err);
          retryTimer = setTimeout(subscribeSession, delayMs);
        }
      );
    };

    subscribeSession();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (unsubscribeSession) unsubscribeSession();
    };
  }, [classId, leaveBroadcast, applySlideFrame]);

  // Manual slide refresh: checks `frameUpdatedAt` timestamp first and skips reload if unchanged
  const refreshFrame = useCallback(async () => {
    if (!classId) return { updated: false, reason: 'no_class' };

    setIsRefreshing(true);
    try {
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      let sessionData = latestSessionRef.current;

      if (typeof getDoc === 'function') {
        try {
          const freshSnap = await getDoc(sessionDocRef);
          if (freshSnap?.exists?.()) {
            sessionData = freshSnap.data() || {};
          }
        } catch {
          // Fall back to latest cached session snapshot if getDoc fails transiently
        }
      }

      if (!sessionData || !sessionData.isBroadcasting) {
        setRefreshStatus('idle');
        return { updated: false, reason: 'inactive' };
      }

      latestSessionRef.current = sessionData;
      setBroadcastInfo(sessionData);

      let candidateUrl = sessionData.frameUrl || null;
      let candidateTs = toEpochMillis(sessionData.frameUpdatedAt);
      let candidateLegacySeq = null;

      // Legacy single-read fallback only if teacher is still emitting to liveFrame (never attaches a listener)
      if (!candidateUrl && sessionData.broadcastMode !== 'static_url' && typeof getDoc === 'function') {
        try {
          const legacySnap = await getDoc(doc(db, `classes/${classId}/screenBroadcast/liveFrame`));
          if (legacySnap?.exists?.()) {
            const legacyData = legacySnap.data() || {};
            if (legacyData.frameData) {
              candidateUrl = legacyData.frameData;
              candidateTs = candidateTs ?? toEpochMillis(legacyData.timestamp);
              candidateLegacySeq = legacyData.frameSeq ?? null;
            }
          }
        } catch {}
      }

      setLatestFrameUpdatedAt(candidateTs);

      if (!candidateUrl) {
        setRefreshStatus('idle');
        return { updated: false, reason: 'no_slide' };
      }

      const currentTs = displayedTimestampRef.current;
      const currentUrl = displayedFrameUrlRef.current;
      const currentLegacySeq = displayedLegacySeqRef.current;
      const isLegacySeqUnchanged = Boolean(
        candidateLegacySeq != null && currentLegacySeq != null && candidateLegacySeq === currentLegacySeq
      );
      const isTimestampUnchanged = Boolean(
        candidateLegacySeq == null && currentLegacySeq == null && candidateTs && currentTs && candidateTs === currentTs
      );
      const isSameFallbackUrl = Boolean(
        candidateLegacySeq == null && !candidateTs && currentUrl && currentUrl === candidateUrl
      );

      if (isLegacySeqUnchanged || isTimestampUnchanged || isSameFallbackUrl) {
        setRefreshStatus('up_to_date');
        return { updated: false, reason: 'up_to_date', frameUpdatedAt: currentTs };
      }

      applySlideFrame(candidateUrl, candidateTs, candidateLegacySeq);
      setRefreshStatus('updated');
      return { updated: true, frameUrl: candidateUrl, frameUpdatedAt: candidateTs };
    } catch (err) {
      console.warn('[Student Screen Broadcast] Manual refresh error:', err);
      setRefreshStatus('error');
      setError(err.message || 'Failed to refresh slide.');
      return { updated: false, reason: 'error', error: err.message };
    } finally {
      setIsRefreshing(false);
    }
  }, [classId, applySlideFrame]);

  useEffect(() => {
    refreshFrameRef.current = refreshFrame;
  }, [refreshFrame]);

  // Join broadcast: register presence once and fetch initial slide if available
  const joinBroadcast = useCallback(async () => {
    if (!classId) return;

    setError(null);
    setRefreshStatus('idle');
    setIsViewing(true);
    isViewingRef.current = true;

    const currentLatest = latestSessionRef.current;
    const currentLatestTs = toEpochMillis(currentLatest?.frameUpdatedAt);
    if (currentLatest?.isBroadcasting && currentLatest?.frameUrl && !displayedFrameUrlRef.current) {
      applySlideFrame(currentLatest.frameUrl, currentLatestTs, null);
    } else if (!displayedFrameUrlRef.current) {
      setConnectionState('connecting');
    }

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

      // Perform one-time initial load if not already populated from latestSessionRef
      if (!displayedFrameUrlRef.current) {
        await refreshFrame();
      }
    } catch (err) {
      console.error('[Student Screen Broadcast] Error joining broadcast:', err);
      setError(err.message || 'Failed to connect to classroom screen broadcast.');
    }
  }, [classId, studentUid, studentEmail, applySlideFrame, refreshFrame]);

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

  const handleFrameLoadError = useCallback(() => {
    const failedUrl = displayedFrameUrlRef.current;
    if (!failedUrl || lastErroredUrlRef.current === failedUrl) return;
    lastErroredUrlRef.current = failedUrl;
    // Recover seamlessly if teacher pushed a newer slide and expired the previous URL
    refreshFrame();
  }, [refreshFrame]);

  const hasNewFrame = Boolean(
    isBroadcastActive &&
    latestFrameUpdatedAt &&
    frameUpdatedAt &&
    latestFrameUpdatedAt !== frameUpdatedAt
  );

  return {
    isBroadcastActive,
    broadcastInfo,
    broadcastMode: broadcastInfo?.broadcastMode || 'static_url',
    liveFrame,
    frameUpdatedAt,
    latestFrameUpdatedAt,
    hasNewFrame,
    isRefreshing,
    refreshStatus,
    refreshFrame,
    handleFrameLoadError,
    isViewing,
    connectionState,
    error,
    joinBroadcast,
    leaveBroadcast,
  };
}
