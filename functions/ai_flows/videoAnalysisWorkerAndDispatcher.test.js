import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockCollection,
  mockDoc,
  mockUpdate,
  mockGet,
  mockTaskQueue,
  mockEnqueue,
  mockBucket,
  mockAnalyzeFlow,
  mockEstimateCost,
  mockCheckQuota,
  mockLogJob,
} = vi.hoisted(() => {
  const mockUpdate = vi.fn().mockResolvedValue();
  const mockGet = vi.fn();
  const mockDoc = vi.fn(() => ({
    update: mockUpdate,
    get: mockGet,
  }));
  const mockCollection = vi.fn(() => ({
    doc: mockDoc,
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: mockGet,
  }));
  const mockEnqueue = vi.fn().mockResolvedValue();
  const mockTaskQueue = vi.fn(() => ({
    enqueue: mockEnqueue,
  }));
  const mockBucket = vi.fn(() => ({
    name: 'test-bucket.appspot.com',
  }));
  const mockAnalyzeFlow = vi.fn();
  const mockEstimateCost = vi.fn(() => 0.05);
  const mockCheckQuota = vi.fn().mockResolvedValue(true);
  const mockLogJob = vi.fn().mockResolvedValue('blocked-job-id');

  return {
    mockCollection,
    mockDoc,
    mockUpdate,
    mockGet,
    mockTaskQueue,
    mockEnqueue,
    mockBucket,
    mockAnalyzeFlow,
    mockEstimateCost,
    mockCheckQuota,
    mockLogJob,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
    runTransaction: vi.fn(async (cb) => cb({ get: vi.fn().mockResolvedValue({ exists: false }), update: vi.fn() })),
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_TIMESTAMP',
    arrayUnion: (...items) => items,
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: mockBucket,
  }),
}));

vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: mockTaskQueue,
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (opts, handler) => handler || opts,
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: (opts, handler) => handler || opts,
}));

vi.mock('./analysisFlows.js', () => ({
  analyzeSingleVideoFlow: mockAnalyzeFlow,
}));

vi.mock('./cost.js', () => ({
  estimateCost: mockEstimateCost,
}));

vi.mock('./quotaManagement.js', () => ({
  checkQuota: mockCheckQuota,
}));

vi.mock('./jobLogger.js', () => ({
  logJob: mockLogJob,
}));

import { processVideoAnalysisJob } from './processVideoAnalysisJob.js';
import { analyzeSingleVideoTask } from './analyzeSingleVideoTask.js';

describe('Video Analysis Dispatcher and Worker Full Flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({
      exists: true,
      empty: true,
      docs: [],
      data: () => ({ aiModel: 'gemini-3.8-flash' }),
    });
  });

  describe('processVideoAnalysisJob Dispatcher', () => {
    it('processes job with explicit videos array and enqueues tasks', async () => {
      const mockEvent = {
        params: { jobId: 'master-job-123' },
        data: {
          data: () => ({
            classId: 'CLASS_1',
            videos: [
              { studentUid: 's1', studentEmail: 's1@test.com', videoPath: 'videos/CLASS_1/s1.mp4' },
              { studentUid: 's2', studentEmail: 's2@test.com', videoPath: 'videos/CLASS_1/s2.mp4' },
            ],
            prompt: 'Check for IDE usage',
          }),
        },
      };

      await processVideoAnalysisJob(mockEvent);

      expect(mockDoc).toHaveBeenCalledWith('master-job-123');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'processing',
          totalVideos: 2,
        })
      );
      expect(mockEnqueue).toHaveBeenCalledTimes(2);
    });

    it('queries videoJobs by time range when videos array is not specified', async () => {
      // 1st get is the videoJobs querySnapshot
      mockGet.mockResolvedValueOnce({
        empty: false,
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 's1',
              studentEmail: 's1@test.com',
              videoPath: 'videos/c1/s1.mp4',
            }),
          });
          cb({
            data: () => ({
              studentUid: 's1',
              studentEmail: 's1@test.com',
              videoPath: 'videos/c1/s1.mp4', // duplicate to test de-duplication
            }),
          });
        },
      });
      // 2nd get is class doc
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ aiModel: 'gemini-3.8-flash' }),
      });

      const mockEvent = {
        params: { jobId: 'range-job-1' },
        data: {
          data: () => ({
            classId: 'CLASS_1',
            filterField: 'createdAt',
            startTime: { toDate: () => new Date('2026-09-19T09:00:00Z') },
            endTime: { toDate: () => new Date('2026-09-19T10:30:00Z') },
          }),
        },
      };

      await processVideoAnalysisJob(mockEvent);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'processing',
          totalVideos: 1, // de-duplicated
        })
      );
      expect(mockEnqueue).toHaveBeenCalledTimes(1);
    });

    it('marks completed immediately when 0 videos are found', async () => {
      const mockEvent = {
        params: { jobId: 'master-job-empty' },
        data: {
          data: () => ({
            classId: 'CLASS_1',
            videos: [],
          }),
        },
      };

      await processVideoAnalysisJob(mockEvent);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          totalVideos: 0,
          processedCount: 0,
        })
      );
      expect(mockEnqueue).not.toHaveBeenCalled();
    });

    it('handles unexpected exceptions and marks master job failed', async () => {
      mockBucket.mockImplementationOnce(() => {
        throw new Error('Storage bucket unavailable');
      });

      const mockEvent = {
        params: { jobId: 'master-job-err' },
        data: {
          data: () => ({
            classId: 'CLASS_1',
            videos: [
              { studentUid: 's1', studentEmail: 's1@test.com', videoPath: 'videos/CLASS_1/s1.mp4' },
            ],
          }),
        },
      };

      await processVideoAnalysisJob(mockEvent);

      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Storage bucket unavailable',
        })
      );
    });
  });

  describe('analyzeSingleVideoTask Worker', () => {
    it('exits cleanly if masterJobId or video is missing', async () => {
      await analyzeSingleVideoTask({ data: {} });
      expect(mockAnalyzeFlow).not.toHaveBeenCalled();
    });

    it('handles missing or unresolvable gsUri by recording failure', async () => {
      await analyzeSingleVideoTask({
        data: {
          masterJobId: 'm1',
          video: { studentEmail: 's1@test.com', videoPath: '' },
        },
      });
      expect(mockAnalyzeFlow).not.toHaveBeenCalled();
    });

    it('reuses existing completed job result if found (idempotency)', async () => {
      mockGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'cached-job-1',
            data: () => ({ status: 'completed', result: 'Previous analysis result' }),
          },
        ],
      });

      await analyzeSingleVideoTask({
        data: {
          masterJobId: 'm1',
          video: { studentEmail: 's1@test.com', videoPath: 'videos/c1/s1.mp4' },
          classId: 'c1',
          prompt: 'Inspect engagement',
        },
      });

      expect(mockAnalyzeFlow).not.toHaveBeenCalled();
    });

    it('blocks and logs job when class has insufficient quota', async () => {
      mockGet.mockResolvedValueOnce({ empty: true }); // No cached job
      mockCheckQuota.mockResolvedValueOnce(false); // Quota denied

      await analyzeSingleVideoTask({
        data: {
          masterJobId: 'm1',
          video: { studentEmail: 's1@test.com', videoPath: 'videos/c1/s1.mp4' },
          classId: 'c1',
          prompt: 'Inspect engagement',
        },
      });

      expect(mockLogJob).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'blocked-by-quota',
        })
      );
      expect(mockAnalyzeFlow).not.toHaveBeenCalled();
    });

    it('executes analysis flow successfully and records result', async () => {
      mockGet.mockResolvedValueOnce({ empty: true });
      mockCheckQuota.mockResolvedValueOnce(true);
      mockAnalyzeFlow.mockResolvedValueOnce({
        jobId: 'ai-job-999',
        result: 'Student was actively coding throughout the session.',
      });

      await analyzeSingleVideoTask({
        data: {
          masterJobId: 'm1',
          video: { studentEmail: 's1@test.com', videoPath: 'videos/c1/s1.mp4' },
          classId: 'c1',
          prompt: 'Inspect engagement',
        },
      });

      expect(mockAnalyzeFlow).toHaveBeenCalled();
    });
  });
});
