import { doc, onSnapshot } from 'firebase/firestore';

/**
 * Reference-counted shared Firestore document listener registry keyed by `(db, canonicalPath)`.
 * Prevents opening duplicate `onSnapshot` subscriptions when multiple mounted components
 * listen to the same document path concurrently (e.g., `studentPasskeys/{uid}`,
 * `system_config/loginPolicy`, or `classes/{classId}/studentProperties/{uid}`).
 */
const dbStoreMap = new WeakMap();

function getDbStore(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    return null;
  }
  let store = dbStoreMap.get(db);
  if (!store) {
    store = new Map();
    dbStoreMap.set(db, store);
  }
  return store;
}

function normalizePathKey(pathOrSegments) {
  if (Array.isArray(pathOrSegments)) {
    return pathOrSegments.map((s) => String(s || '').trim()).filter(Boolean).join('/');
  }
  return String(pathOrSegments || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');
}

/**
 * Subscribes to a Firestore document through a shared ref-counted listener.
 *
 * @param {any} db Firestore instance
 * @param {string | string[]} pathOrSegments Canonical document path or path segments
 * @param {Function} onNext Snapshot callback
 * @param {Function} [onError] Error callback
 * @param {Function} [createDocRef] Optional factory `() => doc(db, ...)` so callers preserve exact `doc()` argument style
 * @returns {Function} Unsubscribe function
 */
export function subscribeDocShared(db, pathOrSegments, onNext, onError, createDocRef) {
  const pathKey = normalizePathKey(pathOrSegments);
  if (!db || !pathKey || typeof onSnapshot !== 'function') {
    return () => {};
  }

  const store = getDbStore(db);
  if (!store) {
    return () => {};
  }

  const subscriber = {
    onNext: typeof onNext === 'function' ? onNext : () => {},
    onError: typeof onError === 'function' ? onError : null,
  };

  let entry = store.get(pathKey);
  if (!entry) {
    entry = {
      listeners: new Set([subscriber]),
      unsub: null,
      hasSnapshot: false,
      lastSnapshot: null,
      hasError: false,
      lastError: null,
      disposed: false,
    };
    store.set(pathKey, entry);

    const docRef = typeof createDocRef === 'function'
      ? createDocRef()
      : (Array.isArray(pathOrSegments) ? doc(db, ...pathOrSegments) : doc(db, pathOrSegments));

    const handleSnapshot = (snapshot) => {
      entry.hasSnapshot = true;
      entry.lastSnapshot = snapshot;
      entry.hasError = false;
      entry.lastError = null;
      Array.from(entry.listeners).forEach((sub) => {
        try {
          sub.onNext(snapshot);
        } catch (cbErr) {
          console.error(`[sharedFirestoreListeners] Error in onNext for ${pathKey}:`, cbErr);
        }
      });
    };

    const handleError = (err) => {
      entry.hasError = true;
      entry.lastError = err;
      Array.from(entry.listeners).forEach((sub) => {
        if (sub.onError) {
          try {
            sub.onError(err);
          } catch (cbErr) {
            console.error(`[sharedFirestoreListeners] Error in onError for ${pathKey}:`, cbErr);
          }
        }
      });
    };

    try {
      const unsub = onSnapshot(docRef, handleSnapshot, handleError);
      if (entry.disposed) {
        if (typeof unsub === 'function') unsub();
      } else {
        entry.unsub = typeof unsub === 'function' ? unsub : null;
      }
    } catch (syncErr) {
      handleError(syncErr);
    }
  } else {
    entry.listeners.add(subscriber);
    if (entry.hasSnapshot) {
      try {
        subscriber.onNext(entry.lastSnapshot);
      } catch (cbErr) {
        console.error(`[sharedFirestoreListeners] Error replaying snapshot for ${pathKey}:`, cbErr);
      }
    } else if (entry.hasError && subscriber.onError) {
      try {
        subscriber.onError(entry.lastError);
      } catch (cbErr) {
        console.error(`[sharedFirestoreListeners] Error replaying error for ${pathKey}:`, cbErr);
      }
    }
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    entry.listeners.delete(subscriber);
    if (entry.listeners.size === 0) {
      entry.disposed = true;
      store.delete(pathKey);
      if (typeof entry.unsub === 'function') {
        try {
          entry.unsub();
        } catch (err) {
          console.warn(`[sharedFirestoreListeners] Error unsubscribing ${pathKey}:`, err);
        }
      }
    }
  };
}
