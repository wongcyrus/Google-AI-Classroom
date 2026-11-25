import { useState, useEffect, useRef, useCallback } from 'react';

const pendingLockReleases = new Map();

function generateTabId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `tab_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function attemptCloseCurrentTab() {
  if (typeof window === 'undefined' || typeof window.close !== 'function') {
    return false;
  }
  try {
    window.close();
    return Boolean(window.closed);
  } catch {
    return false;
  }
}

export function supportsWebLocks() {
  return (
    typeof navigator !== 'undefined' &&
    Boolean(navigator.locks) &&
    typeof navigator.locks.request === 'function'
  );
}

/**
 * Coordinates single-tab exclusivity for StudentDesktopView within the same browser profile.
 * - Uses navigator.locks (Web Locks API) + BroadcastChannel scoped strictly to desktop uid.
 * - Mobile companion view does NOT use this lock, allowing 1 desktop + 1 mobile simultaneously.
 * - Falls back synchronously to 'acquired' when navigator.locks is unavailable (e.g. JSDOM/older browsers).
 */
export function useSingleDesktopTab({ enabled = true, uid = null } = {}) {
  const canLock = Boolean(enabled && uid && supportsWebLocks());

  const [status, setStatus] = useState(() => (canLock ? 'checking' : 'acquired'));
  const [closeBlockedByBrowser, setCloseBlockedByBrowser] = useState(false);
  const [attemptNonce, setAttemptNonce] = useState(0);

  const tabIdRef = useRef(generateTabId());
  const releaseHoldRef = useRef(null);
  const channelRef = useRef(null);
  const statusRef = useRef(status);
  const takeoverPendingRef = useRef(false);
  statusRef.current = status;

  const lockName = uid ? `student_desktop_tab_${uid}` : null;
  const channelName = uid ? `classroom_desktop_tab_${uid}` : null;

  const tryCloseTab = useCallback(() => {
    const closed = attemptCloseCurrentTab();
    if (!closed) {
      setCloseBlockedByBrowser(true);
    }
    return closed;
  }, []);

  const releaseCurrentLock = useCallback(() => {
    if (releaseHoldRef.current) {
      const release = releaseHoldRef.current;
      releaseHoldRef.current = null;
      release();
    }
  }, []);

  useEffect(() => {
    if (!canLock || !lockName) {
      takeoverPendingRef.current = false;
      setStatus('acquired');
      return;
    }

    let isCancelled = false;
    const isTakeover = takeoverPendingRef.current;
    takeoverPendingRef.current = false;

    setStatus('checking');
    setCloseBlockedByBrowser(false);

    let channel = null;
    if (typeof BroadcastChannel === 'function' && channelName) {
      try {
        channel = new BroadcastChannel(channelName);
        channelRef.current = channel;
        channel.onmessage = (event) => {
          const msg = event?.data;
          if (!msg || msg.sourceTabId === tabIdRef.current) return;
          if (msg.type === 'YIELD_DESKTOP_TAB' && statusRef.current === 'acquired') {
            statusRef.current = 'yielded';
            setStatus('yielded');
            releaseCurrentLock();
            tryCloseTab();
          }
        };
      } catch {
        channel = null;
      }
    }

    let takeoverAbortController = null;
    let takeoverTimeoutId = null;

    const acquire = async () => {
      const priorRelease = pendingLockReleases.get(lockName);
      if (priorRelease) {
        try {
          await priorRelease;
        } catch {
          // Ignore prior release errors
        }
      }
      if (isCancelled) return;

      const lockOptions = isTakeover && typeof AbortController === 'function'
        ? (() => {
            takeoverAbortController = new AbortController();
            takeoverTimeoutId = setTimeout(() => {
              takeoverAbortController?.abort();
            }, 2000);
            return { signal: takeoverAbortController.signal };
          })()
        : { ifAvailable: true };

      try {
        await navigator.locks.request(lockName, lockOptions, (lock) => {
          if (takeoverTimeoutId) {
            clearTimeout(takeoverTimeoutId);
            takeoverTimeoutId = null;
          }
          if (isCancelled) {
            return Promise.resolve();
          }
          if (!lock) {
            statusRef.current = 'duplicate';
            setStatus('duplicate');
            attemptCloseCurrentTab();
            return Promise.resolve();
          }

          statusRef.current = 'acquired';
          setStatus('acquired');

          return new Promise((resolve) => {
            releaseHoldRef.current = resolve;
            if (isCancelled) {
              releaseHoldRef.current = null;
              resolve();
            }
          });
        });
      } catch (err) {
        if (takeoverTimeoutId) {
          clearTimeout(takeoverTimeoutId);
          takeoverTimeoutId = null;
        }
        if (isCancelled) return;
        if (err && err.name === 'AbortError') {
          statusRef.current = 'duplicate';
          setStatus('duplicate');
          return;
        }
        console.warn('[useSingleDesktopTab] Web Lock request failed, falling back to acquired:', err);
        statusRef.current = 'acquired';
        setStatus('acquired');
      }
    };

    const lockPromise = acquire();

    return () => {
      isCancelled = true;
      if (takeoverTimeoutId) {
        clearTimeout(takeoverTimeoutId);
        takeoverTimeoutId = null;
      }
      if (takeoverAbortController) {
        try {
          takeoverAbortController.abort();
        } catch {
          // Ignore abort errors on unmount
        }
      }
      if (channel) {
        try {
          channel.close();
        } catch {
          // Ignore close errors
        }
        if (channelRef.current === channel) {
          channelRef.current = null;
        }
      }
      if (releaseHoldRef.current) {
        const donePromise = Promise.resolve(lockPromise).finally(() => {
          if (pendingLockReleases.get(lockName) === donePromise) {
            pendingLockReleases.delete(lockName);
          }
        });
        pendingLockReleases.set(lockName, donePromise);
        releaseCurrentLock();
      }
    };
  }, [canLock, lockName, channelName, attemptNonce, releaseCurrentLock, tryCloseTab]);

  const takeOverFromDuplicateTab = useCallback(() => {
    if (!canLock || !lockName) {
      setStatus('acquired');
      return;
    }

    setStatus('checking');
    setCloseBlockedByBrowser(false);
    takeoverPendingRef.current = true;

    if (channelRef.current) {
      try {
        channelRef.current.postMessage({
          type: 'YIELD_DESKTOP_TAB',
          sourceTabId: tabIdRef.current,
        });
      } catch {
        // Ignore BroadcastChannel post errors
      }
    }

    setAttemptNonce((n) => n + 1);
  }, [canLock, lockName]);

  const resetLock = useCallback(() => {
    takeoverPendingRef.current = false;
    setCloseBlockedByBrowser(false);
    setAttemptNonce((n) => n + 1);
  }, []);

  return {
    status,
    closeBlockedByBrowser,
    tryCloseTab,
    takeOverFromDuplicateTab,
    resetLock,
  };
}
