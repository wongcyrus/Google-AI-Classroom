/**
 * Client-Side Crash Recovery Storage using native browser IndexedDB.
 * Incrementally persists recorded video chunks to the local disk every 10 seconds.
 * If the browser crashes, computer reboots, or tab is killed, chunks saved up to the
 * crash point can be retrieved, assembled, uploaded, and automatically merged.
 */

const DB_NAME = 'ClassroomLectureRecoveryDB';
const DB_VERSION = 2;
const STORE_NAME = 'recovery_sessions';
const SEGMENTS_STORE = 'pending_segments';

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
      if (!db.objectStoreNames.contains(SEGMENTS_STORE)) {
        db.createObjectStore(SEGMENTS_STORE, { keyPath: 'sessionId' });
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

/**
 * Persists an entire finalized 1-minute video/audio segment to the offline buffer.
 * If the network drops or is unstable, this segment remains safe until uploaded.
 */
export async function persistPendingSegment({
  sessionId,
  classId,
  sessionGroupId,
  segmentIndex,
  duration,
  blob,
  audioBlob,
  mimeType,
  audioMimeType,
  title,
  topic,
  targetLanguages,
  teacherEmail,
}) {
  if (!sessionId || !blob) return;
  try {
    const db = await openDB();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(SEGMENTS_STORE, 'readwrite');
      const store = tx.objectStore(SEGMENTS_STORE);
      const record = {
        sessionId,
        classId,
        sessionGroupId,
        segmentIndex: segmentIndex || 1,
        duration: duration || 60,
        blob,
        audioBlob: audioBlob || null,
        mimeType: mimeType || 'video/webm',
        audioMimeType: audioMimeType || 'audio/webm',
        title: title || '',
        topic: topic || '',
        targetLanguages: targetLanguages || ['en', 'zh-Hant', 'zh-Hans', 'ja'],
        teacherEmail: teacherEmail || '',
        createdAt: Date.now(),
      };
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to persist pending segment:', err.message);
  }
}

/**
 * Lists all pending 1-minute segment uploads waiting for network transmission.
 */
export async function getPendingSegments(filterClassId = null) {
  try {
    const db = await openDB();
    if (!db) return [];

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(SEGMENTS_STORE, 'readonly');
      const store = tx.objectStore(SEGMENTS_STORE);
      const request = store.getAll();

      request.onsuccess = () => {
        const segments = request.result || [];
        if (filterClassId) {
          resolve(segments.filter((s) => s.classId === filterClassId));
        } else {
          resolve(segments);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to list pending segments:', err.message);
    return [];
  }
}

/**
 * Deletes a finalized segment from the offline buffer once Cloud Storage confirms receipt.
 */
export async function clearPendingSegment(sessionId) {
  if (!sessionId) return;
  try {
    const db = await openDB();
    if (!db) return;

    await new Promise((resolve, reject) => {
      const tx = db.transaction(SEGMENTS_STORE, 'readwrite');
      const store = tx.objectStore(SEGMENTS_STORE);
      const request = store.delete(sessionId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.debug('[lectureRecoveryDb] Failed to clear pending segment:', err.message);
  }
}
