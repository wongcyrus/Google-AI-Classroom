import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTransactionGet, mockTransactionUpdate, mockRunTransaction } = vi.hoisted(() => {
  const mockTransactionGet = vi.fn();
  const mockTransactionUpdate = vi.fn();
  const mockRunTransaction = vi.fn(async (cb) => {
    return await cb({
      get: mockTransactionGet,
      update: mockTransactionUpdate,
    });
  });
  return { mockTransactionGet, mockTransactionUpdate, mockRunTransaction };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    runTransaction: mockRunTransaction,
  }),
  FieldValue: {
    arrayUnion: (...items) => items,
    serverTimestamp: () => 'MOCK_TIMESTAMP',
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({ name: 'test-bucket.appspot.com' }),
  }),
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: vi.fn((opts, handler) => handler),
}));

import { recordTaskResult } from './analyzeSingleVideoTask.js';

describe('Video Analysis Cloud Tasks Architecture', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordTaskResult logic', () => {
    it('increments success counts and marks completed when all tasks finish', async () => {
      let masterData = {
        totalVideos: 3,
        processedCount: 2,
        successCount: 2,
        failureCount: 0,
        aiJobIds: ['job-1', 'job-2'],
        failedVideos: []
      };

      mockTransactionGet.mockResolvedValue({
        exists: true,
        data: () => masterData,
      });

      let capturedUpdate = null;
      mockTransactionUpdate.mockImplementation((ref, payload) => {
        capturedUpdate = payload;
      });

      const mockMasterJobRef = { id: 'master-job-1' };
      await recordTaskResult({
        masterJobRef: mockMasterJobRef,
        isSuccess: true,
        jobId: 'job-3',
        video: { studentUid: 's3', studentEmail: 's3@school.edu' },
        error: null,
      });

      expect(mockTransactionGet).toHaveBeenCalledWith(mockMasterJobRef);
      expect(mockTransactionUpdate).toHaveBeenCalled();
      expect(capturedUpdate.processedCount).toBe(3);
      expect(capturedUpdate.successCount).toBe(3);
      expect(capturedUpdate.failureCount).toBe(0);
      expect(capturedUpdate.status).toBe('completed');
      expect(capturedUpdate.finishedAt).toBe('MOCK_TIMESTAMP');
    });

    it('marks partial_failure when some videos fail and some succeed upon completion', async () => {
      let masterData = {
        totalVideos: 2,
        processedCount: 1,
        successCount: 1,
        failureCount: 0,
        aiJobIds: ['job-1'],
        failedVideos: []
      };

      mockTransactionGet.mockResolvedValue({
        exists: true,
        data: () => masterData,
      });

      let capturedUpdate = null;
      mockTransactionUpdate.mockImplementation((ref, payload) => {
        capturedUpdate = payload;
      });

      const mockMasterJobRef = { id: 'master-job-2' };
      await recordTaskResult({
        masterJobRef: mockMasterJobRef,
        isSuccess: false,
        jobId: null,
        video: { studentUid: 's2', studentEmail: 's2@school.edu', videoPath: 'v2.mp4' },
        error: 'Video corrupted',
      });

      expect(mockTransactionGet).toHaveBeenCalledWith(mockMasterJobRef);
      expect(mockTransactionUpdate).toHaveBeenCalled();
      expect(capturedUpdate.processedCount).toBe(2);
      expect(capturedUpdate.successCount).toBe(1);
      expect(capturedUpdate.failureCount).toBe(1);
      expect(capturedUpdate.status).toBe('partial_failure');
      expect(capturedUpdate.finishedAt).toBe('MOCK_TIMESTAMP');
    });

    it('marks failed when all videos fail', async () => {
      let masterData = {
        totalVideos: 1,
        processedCount: 0,
        successCount: 0,
        failureCount: 0,
        aiJobIds: [],
        failedVideos: []
      };

      mockTransactionGet.mockResolvedValue({
        exists: true,
        data: () => masterData,
      });

      let capturedUpdate = null;
      mockTransactionUpdate.mockImplementation((ref, payload) => {
        capturedUpdate = payload;
      });

      const mockMasterJobRef = { id: 'master-job-3' };
      await recordTaskResult({
        masterJobRef: mockMasterJobRef,
        isSuccess: false,
        jobId: null,
        video: { studentUid: 's1', studentEmail: 's1@school.edu', videoPath: 'v1.mp4' },
        error: 'Quota exhausted',
      });

      expect(mockTransactionGet).toHaveBeenCalledWith(mockMasterJobRef);
      expect(mockTransactionUpdate).toHaveBeenCalled();
      expect(capturedUpdate.processedCount).toBe(1);
      expect(capturedUpdate.successCount).toBe(0);
      expect(capturedUpdate.failureCount).toBe(1);
      expect(capturedUpdate.status).toBe('failed');
      expect(capturedUpdate.finishedAt).toBe('MOCK_TIMESTAMP');
    });

    it('does not transition status if more videos are still processing', async () => {
      let masterData = {
        totalVideos: 5,
        processedCount: 1,
        successCount: 1,
        failureCount: 0,
        aiJobIds: ['job-1'],
        failedVideos: []
      };

      mockTransactionGet.mockResolvedValue({
        exists: true,
        data: () => masterData,
      });

      let capturedUpdate = null;
      mockTransactionUpdate.mockImplementation((ref, payload) => {
        capturedUpdate = payload;
      });

      const mockMasterJobRef = { id: 'master-job-midway' };
      await recordTaskResult({
        masterJobRef: mockMasterJobRef,
        isSuccess: true,
        jobId: 'job-2',
        video: { studentUid: 's2', studentEmail: 's2@school.edu' },
      });

      expect(capturedUpdate.processedCount).toBe(2);
      expect(capturedUpdate.successCount).toBe(2);
      expect(capturedUpdate.failureCount).toBe(0);
      expect(capturedUpdate.status).toBeUndefined(); // Still in processing
      expect(capturedUpdate.finishedAt).toBeUndefined();
    });
  });
});
