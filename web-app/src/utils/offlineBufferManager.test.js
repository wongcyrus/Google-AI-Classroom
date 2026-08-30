import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  saveToOfflineQueue,
  getOfflineQueueCount,
  getAllQueuedItems,
  removeOfflineItem,
  clearOfflineQueue,
  flushOfflineQueue,
  openOfflineDB,
} from './offlineBufferManager.js';

describe('Offline IndexedDB Buffer Manager', () => {
  let mockStore;

  beforeEach(() => {
    mockStore = new Map();

    const mockIDB = {
      open: vi.fn(() => {
        const req = {
          result: {
            objectStoreNames: { contains: () => false },
            createObjectStore: vi.fn(() => ({
              createIndex: vi.fn(),
            })),
            transaction: vi.fn(() => ({
              objectStore: vi.fn(() => ({
                put: vi.fn((item) => {
                  mockStore.set(item.id, item);
                  const pReq = {};
                  setTimeout(() => {
                    if (pReq.onsuccess) pReq.onsuccess();
                  }, 0);
                  return pReq;
                }),
                count: vi.fn(() => {
                  const cReq = {};
                  setTimeout(() => {
                    cReq.result = mockStore.size;
                    if (cReq.onsuccess) cReq.onsuccess();
                  }, 0);
                  return cReq;
                }),
                index: vi.fn(() => ({
                  getAll: vi.fn(() => {
                    const gReq = {};
                    setTimeout(() => {
                      gReq.result = Array.from(mockStore.values()).sort((a, b) => a.timestamp - b.timestamp);
                      if (gReq.onsuccess) gReq.onsuccess();
                    }, 0);
                    return gReq;
                  }),
                })),
                delete: vi.fn((id) => {
                  mockStore.delete(id);
                  const dReq = {};
                  setTimeout(() => {
                    if (dReq.onsuccess) dReq.onsuccess();
                  }, 0);
                  return dReq;
                }),
                clear: vi.fn(() => {
                  mockStore.clear();
                  const clReq = {};
                  setTimeout(() => {
                    if (clReq.onsuccess) clReq.onsuccess();
                  }, 0);
                  return clReq;
                }),
              })),
            })),
          },
        };
        setTimeout(() => {
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: { result: req.result } });
          }
          if (req.onsuccess) req.onsuccess();
        }, 0);
        return req;
      }),
    };

    global.window = {
      indexedDB: mockIDB,
    };
    global.navigator = {
      onLine: true,
    };
  });

  it('saves items to the offline queue and counts them', async () => {
    await saveToOfflineQueue({
      id: 'shot_1',
      type: 'screenshot',
      classId: 'CLASS_1',
      studentUid: 's1',
      blob: new Blob(['fake-image'], { type: 'image/jpeg' }),
      timestamp: 1000,
    });

    await saveToOfflineQueue({
      id: 'audio_1',
      type: 'audio',
      classId: 'CLASS_1',
      studentUid: 's1',
      blob: new Blob(['fake-audio'], { type: 'audio/webm' }),
      timestamp: 2000,
    });

    const count = await getOfflineQueueCount();
    expect(count).toBe(2);

    const items = await getAllQueuedItems();
    expect(items.length).toBe(2);
    expect(items[0].id).toBe('shot_1');
    expect(items[1].id).toBe('audio_1');
  });

  it('deletes an item from the queue', async () => {
    await saveToOfflineQueue({
      id: 'item_to_delete',
      type: 'screenshot',
      classId: 'CLASS_1',
      studentUid: 's1',
      blob: new Blob(['test']),
      timestamp: 1000,
    });

    expect(await getOfflineQueueCount()).toBe(1);
    await removeOfflineItem('item_to_delete');
    expect(await getOfflineQueueCount()).toBe(0);
  });

  it('clears all items in queue', async () => {
    await saveToOfflineQueue({ id: 'c1', type: 'audio', classId: 'C1', blob: new Blob(['1']) });
    await saveToOfflineQueue({ id: 'c2', type: 'audio', classId: 'C1', blob: new Blob(['2']) });
    expect(await getOfflineQueueCount()).toBe(2);

    await clearOfflineQueue();
    expect(await getOfflineQueueCount()).toBe(0);
  });

  it('flushes queued items in chronological order with upload handler and progress tracking', async () => {
    await saveToOfflineQueue({
      id: 'chunk_2',
      type: 'audio',
      classId: 'CLASS_1',
      studentUid: 's1',
      blob: new Blob(['second']),
      timestamp: 2000,
    });

    await saveToOfflineQueue({
      id: 'chunk_1',
      type: 'audio',
      classId: 'CLASS_1',
      studentUid: 's1',
      blob: new Blob(['first']),
      timestamp: 1000,
    });

    const uploaded = [];
    const progressUpdates = [];

    const result = await flushOfflineQueue({
      uploadItemHandler: async (item) => {
        uploaded.push(item.id);
      },
      onProgress: (progress) => {
        progressUpdates.push(progress);
      },
    });

    expect(result.synced).toBe(2);
    expect(result.remaining).toBe(0);
    expect(uploaded).toEqual(['chunk_1', 'chunk_2']);
    expect(progressUpdates.length).toBe(2);
    expect(progressUpdates[1].current).toBe(2);
  });

  it('returns early when offline (navigator.onLine is false)', async () => {
    global.navigator.onLine = false;

    await saveToOfflineQueue({
      id: 'item_offline',
      type: 'screenshot',
      classId: 'CLASS_1',
      blob: new Blob(['test']),
      timestamp: 1000,
    });

    const result = await flushOfflineQueue({
      uploadItemHandler: vi.fn(),
    });

    expect(result.synced).toBe(0);
    expect(result.isOffline).toBe(true);
  });

  it('handles empty queue flush without error', async () => {
    const result = await flushOfflineQueue({
      uploadItemHandler: vi.fn(),
    });

    expect(result.synced).toBe(0);
    expect(result.remaining).toBe(0);
  });

  it('continues syncing when a single item throws an error', async () => {
    await saveToOfflineQueue({ id: 'bad_item', type: 'audio', classId: 'C1', blob: new Blob(['bad']) });
    await saveToOfflineQueue({ id: 'good_item', type: 'audio', classId: 'C1', blob: new Blob(['good']) });

    const result = await flushOfflineQueue({
      uploadItemHandler: async (item) => {
        if (item.id === 'bad_item') throw new Error('Upload error');
      },
    });

    expect(result.synced).toBe(1);
    expect(result.remaining).toBe(1);
  });
});
