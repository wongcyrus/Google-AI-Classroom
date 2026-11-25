import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBatches = [];
const mockWriteBatch = vi.fn(() => {
  const batch = {
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  };
  mockBatches.push(batch);
  return batch;
});

vi.mock('firebase/firestore', () => ({
  writeBatch: (...args) => mockWriteBatch(...args),
}));

import { chunkArray, commitBatchChunks } from './firestoreBatchUtils';

describe('firestoreBatchUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBatches.length = 0;
  });

  it('chunkArray splits arrays into exact max-size chunks', () => {
    expect(chunkArray([], 30)).toEqual([]);
    expect(chunkArray(null, 30)).toEqual([]);
    const items = Array.from({ length: 65 }, (_, i) => i);
    const chunks = chunkArray(items, 30);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(30);
    expect(chunks[1]).toHaveLength(30);
    expect(chunks[2]).toHaveLength(5);
  });

  it('commitBatchChunks splits >450 operations across multiple committed writeBatches', async () => {
    const db = { name: 'mock-db' };
    const ops = Array.from({ length: 1005 }, (_, i) => {
      if (i % 3 === 1) {
        return { type: 'update', ref: { id: `d_${i}` }, data: { idx: i } };
      }
      if (i % 3 === 2) {
        return { type: 'delete', ref: { id: `d_${i}` } };
      }
      return {
        type: 'set',
        ref: { id: `d_${i}` },
        data: { idx: i },
        options: { merge: true },
      };
    });

    const total = await commitBatchChunks(db, ops, 450);

    expect(total).toBe(1005);
    expect(mockWriteBatch).toHaveBeenCalledTimes(3);
    expect(mockBatches[0].commit).toHaveBeenCalledTimes(1);
    expect(mockBatches[1].commit).toHaveBeenCalledTimes(1);
    expect(mockBatches[2].commit).toHaveBeenCalledTimes(1);

    const chunk1Count =
      mockBatches[0].set.mock.calls.length +
      mockBatches[0].update.mock.calls.length +
      mockBatches[0].delete.mock.calls.length;
    const chunk2Count =
      mockBatches[1].set.mock.calls.length +
      mockBatches[1].update.mock.calls.length +
      mockBatches[1].delete.mock.calls.length;
    const chunk3Count =
      mockBatches[2].set.mock.calls.length +
      mockBatches[2].update.mock.calls.length +
      mockBatches[2].delete.mock.calls.length;

    expect(chunk1Count).toBe(450);
    expect(chunk2Count).toBe(450);
    expect(chunk3Count).toBe(105);
  });

  it('commitBatchChunks returns 0 without creating a batch for empty operations', async () => {
    const res = await commitBatchChunks({ name: 'mock-db' }, []);
    expect(res).toBe(0);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});
