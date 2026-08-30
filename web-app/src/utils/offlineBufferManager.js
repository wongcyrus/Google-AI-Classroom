/**
 * Offline IndexedDB Buffer & Synchronization Engine
 * Queues student capture items (screenshots and audio chunks) when offline / network drops,
 * and automatically drains and backfills them in chronological order upon reconnection.
 */

const DB_NAME = 'ClassroomAssistantOfflineDB';
const DB_VERSION = 1;
const STORE_NAME = 'offline_queue';

/**
 * Opens or initializes the IndexedDB database.
 */
export function openOfflineDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB is not available in this environment'));
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
        store.createIndex('classId', 'classId', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves a captured item (screenshot or audio chunk) to IndexedDB.
 */
export async function saveToOfflineQueue({
  id = `offline_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
  type, // 'screenshot' | 'audio'
  classId,
  studentUid,
  studentEmail,
  blob,
  metadata = {},
  timestamp = Date.now(),
}) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const item = {
        id,
        type,
        classId,
        studentUid,
        studentEmail,
        blob,
        metadata,
        timestamp,
        retryCount: 0,
        createdAt: new Date().toISOString(),
      };

      const request = store.put(item);
      request.onsuccess = () => {
        console.warn(`[OfflineBuffer] Queued ${type} item (${id}) locally in IndexedDB.`);
        resolve(item);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[OfflineBuffer] Failed to save item to IndexedDB:', err);
    throw err;
  }
}

/**
 * Retrieves the count of items currently pending in the offline buffer.
 */
export async function getOfflineQueueCount() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.count();

      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return 0;
  }
}

/**
 * Retrieves all queued items sorted by timestamp ascending (chronological).
 */
export async function getAllQueuedItems() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('timestamp');
      const request = index.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

/**
 * Deletes a processed item from IndexedDB.
 */
export async function removeOfflineItem(id) {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error(`[OfflineBuffer] Failed to delete item ${id}:`, err);
  }
}

/**
 * Clears the entire offline queue (e.g. on session end or manual purge).
 */
export async function clearOfflineQueue() {
  try {
    const db = await openOfflineDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[OfflineBuffer] Failed to clear queue:', err);
  }
}

/**
 * Flushes all pending items in chronological order using the provided handlers.
 */
export async function flushOfflineQueue({
  uploadItemHandler,
  onProgress,
}) {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { synced: 0, remaining: await getOfflineQueueCount(), isOffline: true };
  }

  const items = await getAllQueuedItems();
  if (items.length === 0) {
    return { synced: 0, remaining: 0, isOffline: false };
  }

  let synced = 0;
  const total = items.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      if (uploadItemHandler) {
        await uploadItemHandler(item);
      }
      await removeOfflineItem(item.id);
      synced++;

      if (onProgress) {
        onProgress({ current: synced, total, item });
      }
    } catch (err) {
      console.warn(`[OfflineBuffer] Error syncing item ${item.id}:`, err);
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        break;
      }
    }
  }

  const remaining = await getOfflineQueueCount();
  return { synced, remaining, isOffline: remaining > 0 && typeof navigator !== 'undefined' && !navigator.onLine };
}
