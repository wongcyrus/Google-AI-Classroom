import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  persistRecoveryChunk,
  getPendingRecoverySessions,
  clearRecoverySession,
  persistPendingSegment,
  getPendingSegments,
  clearPendingSegment,
} from './lectureRecoveryDb';

describe('lectureRecoveryDb Utility', () => {
  let mockStore;
  let mockTx;
  let mockDb;

  beforeEach(() => {
    mockStore = {
      data: new Map(),
      get: vi.fn((key) => {
        const req = {
          result: mockStore.data.get(key),
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
      }),
      put: vi.fn((item) => {
        mockStore.data.set(item.sessionId, item);
        const req = {
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
      }),
      getAll: vi.fn(() => {
        const req = {
          result: Array.from(mockStore.data.values()),
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
      }),
      delete: vi.fn((key) => {
        mockStore.data.delete(key);
        const req = {
          onsuccess: null,
          onerror: null,
        };
        setTimeout(() => req.onsuccess && req.onsuccess({ target: req }), 0);
        return req;
      }),
    };

    mockTx = {
      objectStore: vi.fn(() => mockStore),
    };

    mockDb = {
      objectStoreNames: {
        contains: vi.fn(() => true),
      },
      createObjectStore: vi.fn(),
      transaction: vi.fn(() => mockTx),
    };

    window.indexedDB = {
      open: vi.fn(() => {
        const req = {
          result: mockDb,
          onsuccess: null,
          onerror: null,
          onupgradeneeded: null,
        };
        setTimeout(() => {
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: { result: mockDb } });
          }
          if (req.onsuccess) {
            req.onsuccess({ target: req });
          }
        }, 0);
        return req;
      }),
    };
  });

  afterEach(() => {
    delete window.indexedDB;
  });

  it('handles environment when indexedDB is undefined', async () => {
    delete window.indexedDB;
    await expect(persistRecoveryChunk({ sessionId: 's1', chunk: new Blob(['data']) })).resolves.toBeUndefined();
    await expect(getPendingRecoverySessions()).resolves.toEqual([]);
    await expect(clearRecoverySession('s1')).resolves.toBeUndefined();
  });

  it('no-ops when sessionId or chunk is missing', async () => {
    await persistRecoveryChunk({ sessionId: null, chunk: new Blob(['test']) });
    await persistRecoveryChunk({ sessionId: 's1', chunk: null });
    expect(mockStore.data.size).toBe(0);

    await clearRecoverySession(null);
    expect(mockStore.delete).not.toHaveBeenCalled();
  });

  it('persists chunks to new session and appends to existing session', async () => {
    const chunk1 = new Blob(['chunk-1']);
    const chunk2 = new Blob(['chunk-2']);

    await persistRecoveryChunk({
      sessionId: 'sess_1',
      classId: 'c1',
      sessionGroupId: 'grp1',
      title: 'Math Lecture',
      topic: 'Calculus',
      targetLanguages: ['en'],
      mimeType: 'video/webm',
      chunk: chunk1,
      startedAt: 123456,
    });

    expect(mockStore.data.has('sess_1')).toBe(true);
    let session = mockStore.data.get('sess_1');
    expect(session.chunks).toHaveLength(1);
    expect(session.title).toBe('Math Lecture');

    // Append second chunk
    await persistRecoveryChunk({
      sessionId: 'sess_1',
      chunk: chunk2,
    });

    session = mockStore.data.get('sess_1');
    expect(session.chunks).toHaveLength(2);
  });

  it('retrieves pending recovery sessions', async () => {
    mockStore.data.set('sess_empty', { sessionId: 'sess_empty', chunks: [] });
    mockStore.data.set('sess_active', { sessionId: 'sess_active', chunks: [new Blob(['test'])] });

    const sessions = await getPendingRecoverySessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess_active');
  });

  it('clears recovery session by id', async () => {
    mockStore.data.set('sess_1', { sessionId: 'sess_1', chunks: [new Blob(['test'])] });
    await clearRecoverySession('sess_1');
    expect(mockStore.data.has('sess_1')).toBe(false);
  });

  it('creates object store during onupgradeneeded if not existing', async () => {
    mockDb.objectStoreNames.contains.mockReturnValue(false);
    await persistRecoveryChunk({ sessionId: 'sess_new', chunk: new Blob(['data']) });
    expect(mockDb.createObjectStore).toHaveBeenCalledWith('recovery_sessions', { keyPath: 'sessionId' });
  });

  it('catches and logs errors gracefully', async () => {
    window.indexedDB.open = vi.fn(() => {
      const req = {
        result: null,
        error: new Error('Permission denied to open DB'),
      };
      setTimeout(() => req.onerror && req.onerror({ target: req }), 0);
      return req;
    });

    await expect(persistRecoveryChunk({ sessionId: 's1', chunk: new Blob(['x']) })).resolves.toBeUndefined();
    await expect(getPendingRecoverySessions()).resolves.toEqual([]);
    await expect(clearRecoverySession('s1')).resolves.toBeUndefined();
  });

  it('persists, retrieves, and clears pending 1-minute segments', async () => {
    const dummyBlob = new Blob(['video-segment-data'], { type: 'video/webm' });
    const dummyAudioBlob = new Blob(['audio-segment-data'], { type: 'audio/webm' });

    await persistPendingSegment({
      sessionId: 'seg_1',
      classId: 'class_a',
      sessionGroupId: 'group_1',
      segmentIndex: 1,
      duration: 60,
      blob: dummyBlob,
      audioBlob: dummyAudioBlob,
      title: 'Math Lecture Pt 1',
    });

    expect(mockStore.data.has('seg_1')).toBe(true);

    const segments = await getPendingSegments('class_a');
    expect(segments).toHaveLength(1);
    expect(segments[0].sessionId).toBe('seg_1');
    expect(segments[0].segmentIndex).toBe(1);

    await clearPendingSegment('seg_1');
    expect(mockStore.data.has('seg_1')).toBe(false);
  });
});
