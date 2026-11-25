import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockLimit, mockWhere, mockQueryGet, mockBatchUpdate, mockBatchCommit, mockBatch } = vi.hoisted(() => {
  const mockQueryGet = vi.fn();
  const mockLimit = vi.fn(() => ({ get: mockQueryGet }));
  const mockWhere = vi.fn();
  const queryChain = {
    where: mockWhere,
    limit: mockLimit,
    get: mockQueryGet,
  };
  mockWhere.mockReturnValue(queryChain);

  const mockBatchUpdate = vi.fn();
  const mockBatchCommit = vi.fn().mockResolvedValue(true);
  const mockBatch = vi.fn(() => ({
    update: mockBatchUpdate,
    commit: mockBatchCommit,
  }));

  return { mockLimit, mockWhere, mockQueryGet, mockBatchUpdate, mockBatchCommit, mockBatch };
});

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({ FUNCTION_REGION: 'asia-east2' }));
vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((opts, handler) => handler),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn(() => ({
      where: mockWhere,
    })),
    batch: mockBatch,
  })),
}));

import { cleanupStuckJobs } from './cleanupStuckJobs.js';

describe('cleanupStuckJobs Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exits without batch commit when no stuck jobs exist', async () => {
    mockQueryGet.mockResolvedValueOnce({ empty: true, size: 0, docs: [], forEach: vi.fn() });

    await cleanupStuckJobs();

    expect(mockLimit).toHaveBeenCalledWith(400);
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('chunks updates into limit(400) batches across multiple iterations', async () => {
    const makeDocs = (count, offset = 0) =>
      Array.from({ length: count }, (_, idx) => ({
        ref: { id: `job_${offset + idx}` },
      }));

    const batch1Docs = makeDocs(400, 0);
    const batch2Docs = makeDocs(2, 400);

    mockQueryGet
      .mockResolvedValueOnce({
        empty: false,
        size: 400,
        docs: batch1Docs,
        forEach: (cb) => batch1Docs.forEach(cb),
      })
      .mockResolvedValueOnce({
        empty: false,
        size: 2,
        docs: batch2Docs,
        forEach: (cb) => batch2Docs.forEach(cb),
      });

    await cleanupStuckJobs();

    expect(mockLimit).toHaveBeenNthCalledWith(1, 400);
    expect(mockLimit).toHaveBeenNthCalledWith(2, 400);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(402);
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      { id: 'job_0' },
      expect.objectContaining({ status: 'failed' })
    );
  });
});
