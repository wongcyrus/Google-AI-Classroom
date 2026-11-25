import { collection, query, where, onSnapshot } from 'firebase/firestore';

/**
 * Shared reference-counted prompt subscription store keyed per `(db, uid)`.
 * Consolidates the 3 Firestore queries on `prompts` (public, owned, shared)
 * so multiple hooks (`usePrompts`, `useAudioPrompts`, `useVideoPrompts`,
 * `useRubricPrompts`, `useTranslationPrompts`) mounted simultaneously share
 * a single set of 3 snapshots instead of opening `3 × N` listeners.
 */
const dbPromptsStoreMap = new WeakMap();

function getPromptsStore(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) {
    return null;
  }
  let store = dbPromptsStoreMap.get(db);
  if (!store) {
    store = new Map();
    dbPromptsStoreMap.set(db, store);
  }
  return store;
}

function mergePromptBuckets(entry) {
  const all = [...entry.publicPrompts, ...entry.privatePrompts, ...entry.sharedPrompts];
  return Array.from(new Map(all.map((p) => [p.id, p])).values());
}

/**
 * Subscribes to the deduplicated raw prompt list for `uid`.
 *
 * @param {any} db Firestore instance
 * @param {string | null} uid Authenticated user UID
 * @param {(uniquePrompts: Array<object>) => void} callback Receives deduplicated prompt objects
 * @returns {() => void} Unsubscribe handler
 */
export function subscribeSharedPrompts(db, uid, callback) {
  if (!db || !uid || typeof callback !== 'function' || typeof onSnapshot !== 'function') {
    return () => {};
  }

  const store = getPromptsStore(db);
  if (!store) {
    return () => {};
  }

  let entry = store.get(uid);
  if (!entry) {
    entry = {
      listeners: new Set([callback]),
      unsubscribers: [],
      publicPrompts: [],
      privatePrompts: [],
      sharedPrompts: [],
      hasEmitted: false,
      lastMerged: [],
      disposed: false,
    };
    store.set(uid, entry);

    const emit = () => {
      if (entry.disposed) return;
      const merged = mergePromptBuckets(entry);
      entry.hasEmitted = true;
      entry.lastMerged = merged;
      Array.from(entry.listeners).forEach((cb) => {
        try {
          cb(merged);
        } catch (err) {
          console.error('[sharedPromptsStore] Error in prompt subscriber callback:', err);
        }
      });
    };

    const promptsRef = collection(db, 'prompts');
    const qPublic = query(promptsRef, where('accessLevel', '==', 'public'));
    const qOwner = query(promptsRef, where('owner', '==', uid));
    const qShared = query(promptsRef, where('sharedWith', 'array-contains', uid));

    const registerQuery = (q, fieldName) => {
      const unsub = onSnapshot(
        q,
        (snapshot) => {
          entry[fieldName] = (snapshot?.docs || []).map((d) => ({ ...d.data(), id: d.id }));
          emit();
        },
        (err) => {
          console.warn(`[sharedPromptsStore] Error listening to ${fieldName}:`, err);
        }
      );
      if (typeof unsub === 'function') {
        if (entry.disposed) {
          unsub();
        } else {
          entry.unsubscribers.push(unsub);
        }
      }
    };

    registerQuery(qPublic, 'publicPrompts');
    registerQuery(qOwner, 'privatePrompts');
    registerQuery(qShared, 'sharedPrompts');
  } else {
    entry.listeners.add(callback);
    if (entry.hasEmitted) {
      try {
        callback(entry.lastMerged);
      } catch (err) {
        console.error('[sharedPromptsStore] Error replaying cached prompts:', err);
      }
    }
  }

  let unsubscribed = false;
  return () => {
    if (unsubscribed) return;
    unsubscribed = true;
    entry.listeners.delete(callback);
    if (entry.listeners.size === 0) {
      entry.disposed = true;
      store.delete(uid);
      entry.unsubscribers.forEach((unsub) => {
        if (typeof unsub === 'function') {
          try {
            unsub();
          } catch (err) {
            console.warn('[sharedPromptsStore] Error unsubscribing prompt listener:', err);
          }
        }
      });
      entry.unsubscribers = [];
    }
  };
}
