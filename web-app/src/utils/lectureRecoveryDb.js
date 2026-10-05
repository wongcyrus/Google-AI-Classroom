/**
 * Client-Side Crash Recovery Storage using native browser IndexedDB.
 * Incrementally persists recorded video chunks to the local disk every 10 seconds.
 * If the browser crashes, computer reboots, or tab is killed, chunks saved up to the
 * crash point can be retrieved, assembled, uploaded, and automatically merged.
 */

const DB_NAME = 'ClassroomLectureRecoveryDB';
const DB_VERSION = 1;
const STORE_NAME = 'recovery_sessions';

function openDB() {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'sessionId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Initializes or appends a chunk to the persistent crash recovery record.
 */
export async function persistRecoveryChunk({
  sessionId,
  classId,
  sessionGroupId,
  title,
  topic,
  targetLanguages,
  mimeType,
  chunk,
  startedAt,
}) {
  if (!sessionId || !chunk) return;
  try {
    const db = await openDB();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(sessionId);

      getReq.onsuccess = () => {
        const existing = getReq.result || {
          sessionId,
          classId,
          sessionGroupId,
          title,
          topic,
          targetLanguages,
          mimeType,
          startedAt: startedAt || Date.now(),
          chunks: [],
          updatedAt: Date.now(),
        };

        existing.chunks.push(chunk);
        existing.updatedAt = Date.now();
        if (title && !existing.title) existing.title = title;
        if (sessionGroupId && !existing.sessionGroupId) existing.sessionGroupId = sessionGroupId;

        const putReq = store.put(existing);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      };

      getReq.onerror = () => reject(getReq.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to persist chunk:', err.message);
  }
}

/**
 * Lists all pending unfinalized recovery sessions stored in IndexedDB.
 */
export async function getPendingRecoverySessions() {
  try {
    const db = await openDB();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        resolve(
          sessions.filter((s) => Array.isArray(s.chunks) && s.chunks.length > 0)
        );
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to list recovery sessions:', err.message);
    return [];
  }
}

/**
 * Deletes a session from recovery storage once it has been safely uploaded or discarded.
 */
export async function clearRecoverySession(sessionId) {
  if (!sessionId) return;
  try {
    const db = await openDB();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(sessionId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to clear session:', err.message);
  }
}
