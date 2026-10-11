import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({
  FUNCTION_REGION: 'us-central1',
  VIDEO_FRAME_RATE: 15
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      upload: vi.fn().mockResolvedValue(),
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: vi.fn(),
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => handler),
}));

const mockFfmpegCommand = {
  setStartTime: vi.fn().mockReturnThis(),
  setDuration: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn(function (event, cb) {
    if (event === 'end') setTimeout(cb, 1);
    return this;
  }),
  run: vi.fn().mockReturnThis(),
};

vi.mock('fluent-ffmpeg', () => {
  const fn = vi.fn(() => mockFfmpegCommand);
  fn.setFfmpegPath = vi.fn();
  fn.ffprobe = vi.fn((path, cb) => cb(null, { format: { duration: 15, size: 50000 } }));
  return { default: fn };
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 50000 })),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 50000 })),
  unlinkSync: vi.fn(),
}));

import { isExamTimeRange, determineActualCaptureInterval, slicePendingTaskSubmissions } from './processVideoJob.js';

describe('processVideoJob - isExamTimeRange', () => {
  const sampleExamPeriods = [
    {
      id: 'exam-1',
      title: 'Midterm Exam',
      startDate: '2026-09-15T09:00:00.000Z',
      endDate: '2026-09-15T11:00:00.000Z'
    },
    {
      id: 'exam-2',
      title: 'Final Practical Exam',
      startDate: '2026-10-20T14:00:00.000Z',
      endDate: '2026-10-20T16:00:00.000Z'
    }
  ];

  it('returns false if examPeriods is empty or undefined', () => {
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', [])).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', null)).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', undefined)).toBe(false);
  });

  it('returns false for timestamps outside exam windows', () => {
    // Before midterm
    expect(isExamTimeRange('2026-09-15T07:00:00.000Z', '2026-09-15T08:30:00.000Z', sampleExamPeriods)).toBe(false);
    // After midterm
    expect(isExamTimeRange('2026-09-15T11:30:00.000Z', '2026-09-15T12:30:00.000Z', sampleExamPeriods)).toBe(false);
    // On another day
    expect(isExamTimeRange('2026-09-16T09:00:00.000Z', '2026-09-16T11:00:00.000Z', sampleExamPeriods)).toBe(false);
  });

  it('returns true when start time falls within exam period', () => {
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T11:30:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('returns true when end time falls within exam period', () => {
    expect(isExamTimeRange('2026-09-15T08:30:00.000Z', '2026-09-15T09:30:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('returns true when recording encompasses the entire exam period', () => {
    expect(isExamTimeRange('2026-09-15T08:00:00.000Z', '2026-09-15T12:00:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('handles invalid or malformed dates gracefully without crashing', () => {
    expect(isExamTimeRange('invalid-date', 'also-invalid', sampleExamPeriods)).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', 'invalid-end', sampleExamPeriods)).toBe(true);
    expect(isExamTimeRange('invalid-start', '2026-09-15T10:30:00.000Z', sampleExamPeriods)).toBe(true);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', [{ invalid: true }])).toBe(false);
  });
});

describe('processVideoJob - determineActualCaptureInterval', () => {
  it('returns jobCaptureInterval when explicitly provided as a positive number', () => {
    expect(determineActualCaptureInterval([], 10, 15)).toBe(10);
    expect(determineActualCaptureInterval(null, 5, 15)).toBe(5);
  });

  it('uses tagged captureInterval from screenshots (median) when jobCaptureInterval is omitted', () => {
    const screenshots = [
      { captureInterval: 10 },
      { captureInterval: 20 },
      { captureInterval: 10 }
    ];
    // Median of [10, 10, 20] is 10
    expect(determineActualCaptureInterval(screenshots, null, 15)).toBe(10);
  });

  it('uses configuredInterval when screenshots lack tags or are empty (no delta guessing fallback)', () => {
    expect(determineActualCaptureInterval([], null, 30)).toBe(30);
    expect(determineActualCaptureInterval([{ notimestamp: true }], null, 25)).toBe(25);
    expect(determineActualCaptureInterval(null, null, 15)).toBe(15);
  });
});

describe('processVideoJob - slicePendingTaskSubmissions (Approach 2)', () => {
  it('returns empty array when missing required inputs', async () => {
    expect(await slicePendingTaskSubmissions({ classId: null })).toEqual([]);
    expect(await slicePendingTaskSubmissions({ classId: 'c1', studentUid: null })).toEqual([]);
    expect(await slicePendingTaskSubmissions({ classId: 'c1', studentUid: 's1', outputVideoPath: null })).toEqual([]);
  });

  it('returns empty array when no pending or awaiting_class_video task jobs are found', async () => {
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({
          docs: [
            { data: () => ({ status: 'completed' }) }
          ]
        })
      })
    };

    const result = await slicePendingTaskSubmissions({
      classId: 'c1',
      studentUid: 's1',
      outputVideoPath: '/tmp/class.mp4',
      db: mockDb
    });

    expect(result).toEqual([]);
  });

  it('slices, uploads, updates Firestore, and marks task videoJob completed when matching task exists', async () => {
    const mockAttemptSet = vi.fn().mockResolvedValue();
    const mockJobUpdate = vi.fn().mockResolvedValue();
    const mockBucketUpload = vi.fn().mockResolvedValue();

    const taskJobDoc = {
      id: 'task_job_1',
      ref: { update: mockJobUpdate },
      data: () => ({
        taskId: 'lab_task_1',
        attemptNumber: 1,
        startTime: new Date('2026-09-19T09:15:00Z'),
        endTime: new Date('2026-09-19T09:45:00Z'),
        status: 'awaiting_class_video',
        studentEmail: 's1@test.com'
      })
    };

    const makeDocRef = () => {
      const docObj = {
        set: mockAttemptSet,
        update: vi.fn().mockResolvedValue(),
        collection: () => makeColRef(),
      };
      return docObj;
    };
    const makeColRef = () => ({
      doc: vi.fn(() => makeDocRef()),
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
    });

    const mockDb = {
      collection: vi.fn((col) => {
        if (col === 'videoJobs') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              docs: [taskJobDoc]
            })
          };
        }
        return makeColRef();
      })
    };

    const mockBucket = {
      upload: mockBucketUpload
    };

    const screenshots = [
      { timestamp: new Date('2026-09-19T09:00:00Z') },
      { activeTaskId: 'lab_task_1', timestamp: new Date('2026-09-19T09:15:00Z') },
      { activeTaskId: 'lab_task_1', timestamp: new Date('2026-09-19T09:45:00Z') },
      { timestamp: new Date('2026-09-19T10:00:00Z') }
    ];

    const result = await slicePendingTaskSubmissions({
      classId: 'c1',
      studentUid: 's1',
      studentEmail: 's1@test.com',
      classStartTime: new Date('2026-09-19T09:00:00Z'),
      classEndTime: new Date('2026-09-19T10:00:00Z'),
      captureInterval: 15,
      outputVideoPath: '/tmp/class.mp4',
      screenshots,
      db: mockDb,
      bucket: mockBucket,
      retry: (fn) => fn()
    });

    expect(result).toEqual(['task_job_1']);
    expect(mockBucketUpload).toHaveBeenCalledWith(
      expect.stringContaining('task_job_1_clip.mp4'),
      expect.objectContaining({
        destination: 'classes/c1/tasks/lab_task_1/submissions/s1/attempt_1.mp4'
      })
    );
    expect(mockAttemptSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'compiling_complete',
        compiledVideoPath: 'classes/c1/tasks/lab_task_1/submissions/s1/attempt_1.mp4'
      }),
      { merge: true }
    );
    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        slicedFromClassVideo: true,
        videoPath: 'classes/c1/tasks/lab_task_1/submissions/s1/attempt_1.mp4'
      })
    );
  });
});
