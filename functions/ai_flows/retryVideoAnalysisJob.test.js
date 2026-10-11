import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDoc,
  mockCollection,
  mockDb,
  mockBucket,
  mockStorage,
  mockTaskQueue,
  mockEnqueue,
} = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    set: vi.fn().mockResolvedValue(true),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn().mockReturnThis(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
  };

  const mockBucket = {
    name: 'test-bucket.appspot.com',
  };

  const mockStorage = {
    bucket: vi.fn(() => mockBucket),
  };

  const mockEnqueue = vi.fn().mockResolvedValue(true);
  const mockTaskQueue = vi.fn(() => ({
    enqueue: mockEnqueue,
  }));

  return {
    mockDoc,
    mockCollection,
    mockDb,
    mockBucket,
    mockStorage,
    mockTaskQueue,
    mockEnqueue,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    arrayUnion: vi.fn((val) => [val]),
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => mockStorage),
}));

vi.mock('firebase-admin/functions', () => ({
  getFunctions: vi.fn(() => ({
    taskQueue: mockTaskQueue,
  })),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((opts, handler) => handler),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

import { retryVideoAnalysisJob } from './retryVideoAnalysisJob.js';

describe('retryVideoAnalysisJob (functions/ai_flows/retryVideoAnalysisJob.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
  });

  it('rejects unauthenticated requests', async () => {
    await expect(
      retryVideoAnalysisJob({ auth: null, data: { jobId: 'job_1' } })
    ).rejects.toThrow(/authenticated/);
  });

  it('rejects missing jobId', async () => {
    await expect(
      retryVideoAnalysisJob({ auth: { uid: 'user_1' }, data: {} })
    ).rejects.toThrow(/jobId/);
  });

  it('rejects if the master job document does not exist', async () => {
    mockDoc.get.mockResolvedValueOnce({ exists: false });

    await expect(
      retryVideoAnalysisJob({ auth: { uid: 'user_1' }, data: { jobId: 'job_404' } })
    ).rejects.toThrow(/not found/);
  });

  it('rejects with failed-precondition if no failed videos exist anywhere', async () => {
    // 1. Master job doc exists with no failed videos
    mockDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        classId: 'CLASS_A',
        failedVideos: [],
      }),
    });

    // 2. aiJobs query returns empty
    mockCollection.get.mockResolvedValueOnce({
      empty: true,
      docs: [],
    });

    await expect(
      retryVideoAnalysisJob({ auth: { uid: 'user_1' }, data: { jobId: 'job_none' } })
    ).rejects.toThrow(/Could not find any failed videos to retry/);
  });

  it('successfully retries failed videos from failedVideos array in chunks', async () => {
    const failedVideos = Array.from({ length: 25 }, (_, i) => ({
      studentUid: `student_${i}`,
      videoPath: `videos/CLASS_A/student_${i}/video.mp4`,
    }));

    // 1. Master job doc
    mockDoc.get
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          classId: 'CLASS_A',
          failedVideos,
          aiJobIds: ['job_done_1'],
          startTime: { toDate: () => new Date('2026-08-01T09:00:00Z') },
          endTime: { toDate: () => new Date('2026-08-01T10:00:00Z') },
          prompt: 'Identify attention levels',
        }),
      })
      // 2. Class doc
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          aiModel: 'gemini-3.5-flash-lite',
          schedule: { timeZone: 'Asia/Taipei' },
        }),
      });

    const result = await retryVideoAnalysisJob({
      auth: { uid: 'user_teacher' },
      data: { jobId: 'master_job_1' },
    });

    expect(result.result).toContain('Successfully enqueued 25 failed videos');
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'processing',
        failedVideos: [],
        totalVideos: 26, // 1 success + 25 retrying
        processedCount: 1,
        successCount: 1,
        failureCount: 0,
      })
    );

    // Verify 25 tasks were enqueued
    expect(mockEnqueue).toHaveBeenCalledTimes(25);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        masterJobId: 'master_job_1',
        classId: 'CLASS_A',
        modelToUse: 'gemini-3.5-flash-lite',
        prompt: 'Identify attention levels',
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^retry-master_job_1-/),
      })
    );
  });

  it('successfully retries failed videos from aiJobs query when failedVideos is empty', async () => {
    // 1. Master job doc
    mockDoc.get
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          classId: 'CLASS_B',
          failedVideos: [],
          aiJobIds: [],
          startTime: { toDate: () => new Date('2026-08-01T08:00:00Z') },
          endTime: { toDate: () => new Date('2026-08-01T09:00:00Z') },
        }),
      })
      // 2. Class doc (not found)
      .mockResolvedValueOnce({
        exists: false,
      });

    // aiJobs query returning failed job
    const mockAiJobDoc = {
      data: () => ({
        studentUid: 'student_failed',
        studentEmail: 'student@example.com',
        mediaPaths: ['gs://test-bucket.appspot.com/videos/CLASS_B/student_failed/clip.mp4'],
      }),
    };

    mockCollection.get.mockResolvedValueOnce({
      empty: false,
      docs: [mockAiJobDoc],
    });

    const result = await retryVideoAnalysisJob({
      auth: { uid: 'teacher_1' },
      data: { jobId: 'master_job_ai' },
    });

    expect(result.result).toContain('Successfully enqueued 1 failed videos');
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
  });

  it('handles enqueuing failure and marks job status as failed', async () => {
    mockDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        classId: 'CLASS_ERR',
        failedVideos: [{ studentUid: 's1', videoPath: 'videos/CLASS_ERR/s1/vid.mp4' }],
      }),
    });

    // Class doc get throws
    mockDoc.get.mockRejectedValueOnce(new Error('Cloud Tasks rate limited'));

    await expect(
      retryVideoAnalysisJob({
        auth: { uid: 'teacher_1' },
        data: { jobId: 'master_job_err' },
      })
    ).rejects.toThrow(/Failed to process retry for job/);

    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('Cloud Tasks rate limited'),
      })
    );
  });
});
