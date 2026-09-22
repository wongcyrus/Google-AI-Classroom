import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocGet,
  mockDocRef,
  mockJobUpdate,
  mockCollection,
  mockBucketFile,
  mockBucketUpload,
  mockBucket,
  mockSharpInstance,
  mockFfmpegCommand,
  mockFfprobe,
  setFfmpegShouldFail,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocRef = vi.fn(() => ({
    get: mockDocGet,
  }));
  const mockJobUpdate = vi.fn().mockResolvedValue();
  const mockCollection = vi.fn();

  const mockBucketFile = vi.fn(() => ({
    download: vi.fn().mockResolvedValue(),
  }));
  const mockBucketUpload = vi.fn().mockResolvedValue();
  const mockBucket = vi.fn(() => ({
    file: mockBucketFile,
    upload: mockBucketUpload,
  }));

  const mockSharpInstance = {
    metadata: vi.fn().mockResolvedValue({ width: 2560, height: 1440 }),
    resize: vi.fn().mockReturnThis(),
    extend: vi.fn().mockReturnThis(),
    composite: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    toFile: vi.fn().mockResolvedValue(),
  };

  let ffmpegShouldFail = false;
  const mockFfmpegCommand = {
    inputOptions: vi.fn().mockReturnThis(),
    outputOptions: vi.fn().mockReturnThis(),
    on: vi.fn(function (event, cb) {
      if (event === 'progress') {
        cb({ frames: 1 });
      } else if (event === 'end' && !ffmpegShouldFail) {
        setTimeout(cb, 5);
      } else if (event === 'error' && ffmpegShouldFail) {
        setTimeout(() => cb(new Error('ffmpeg killed'), '', 'Corrupt frames'), 5);
      }
      return this;
    }),
    save: vi.fn().mockReturnThis(),
  };

  const mockFfprobe = vi.fn((path, cb) => {
    cb(null, { format: { duration: 12.5, size: 1048576 } });
  });

  return {
    mockDocGet,
    mockDocRef,
    mockJobUpdate,
    mockCollection,
    mockBucketFile,
    mockBucketUpload,
    mockBucket,
    mockSharpInstance,
    mockFfmpegCommand,
    mockFfprobe,
    setFfmpegShouldFail: (val) => {
      ffmpegShouldFail = val;
    },
  };
});

vi.mock('fluent-ffmpeg', () => {
  const ffmpegFn = vi.fn(() => mockFfmpegCommand);
  ffmpegFn.setFfmpegPath = vi.fn();
  ffmpegFn.ffprobe = mockFfprobe;
  return { default: ffmpegFn };
});

vi.mock('ffmpeg-static', () => ({ default: '/usr/bin/ffmpeg' }));

vi.mock('sharp', () => ({
  default: vi.fn(() => mockSharpInstance),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
  }),
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: mockBucket,
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (opts, handler) => handler || opts,
}));

vi.mock('fs', () => {
  const renameMock = vi.fn().mockResolvedValue();
  const fsMock = {
    mkdirSync: vi.fn(),
    rmSync: vi.fn(),
    unlinkSync: vi.fn(),
    promises: {
      rename: renameMock,
    },
  };
  return {
    default: fsMock,
    ...fsMock,
  };
});

import { processVideoJob } from './processVideoJob.js';

describe('processVideoJob Cloud Function Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setFfmpegShouldFail(false);
  });

  it('exits safely when event.data is missing', async () => {
    await processVideoJob({ data: null });
    expect(mockJobUpdate).not.toHaveBeenCalled();
  });

  it('aborts execution when job status is not pending', async () => {
    const mockSnap = {
      data: () => ({ jobId: 'j1', status: 'processing' }),
      ref: { update: mockJobUpdate },
    };
    await processVideoJob({ data: mockSnap });
    expect(mockJobUpdate).not.toHaveBeenCalled();
  });

  it('marks job failed when no screenshots are found for the criteria', async () => {
    const mockSnap = {
      data: () => ({
        jobId: 'j2',
        status: 'pending',
        classId: 'c1',
        studentUid: 's1',
        studentEmail: 's1@test.com',
        startTime: new Date('2026-09-19T09:00:00Z'),
        endTime: new Date('2026-09-19T10:00:00Z'),
      }),
      ref: { update: mockJobUpdate },
    };

    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              data: () => ({ schedule: { timeZone: 'Asia/Hong_Kong' } }),
            }),
          }),
        };
      }
      if (name === 'screenshots') {
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: true,
            docs: [],
          }),
        };
      }
      return { doc: vi.fn() };
    });

    await processVideoJob({ data: mockSnap });

    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: 'No screenshots found in the selected time range.',
      })
    );
  });

  it('processes screenshots, runs sharp, ffmpeg, uploads video, and updates job to completed', async () => {
    const mockSnap = {
      data: () => ({
        jobId: 'j-success-123',
        status: 'pending',
        classId: 'c1',
        studentUid: 's1',
        studentEmail: 's1@test.com',
        channel: 'screen',
        startTime: new Date('2026-09-19T09:00:00Z'),
        endTime: new Date('2026-09-19T10:00:00Z'),
      }),
      ref: { update: mockJobUpdate },
    };

    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              data: () => ({
                schedule: { timeZone: 'Asia/Hong_Kong' },
                examPeriods: [],
              }),
            }),
          }),
        };
      }
      if (name === 'screenshots') {
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: false,
            docs: [
              {
                data: () => ({
                  imagePath: 'screenshots/c1/s1/img1.jpg',
                  channel: 'screen',
                  timestamp: { toDate: () => new Date('2026-09-19T09:15:00Z') },
                }),
              },
            ],
          }),
        };
      }
      return { doc: vi.fn() };
    });

    await processVideoJob({ data: mockSnap });

    expect(mockBucketUpload).toHaveBeenCalledWith(
      expect.stringContaining('j-success-123.mp4'),
      expect.objectContaining({
        destination: 'videos/c1/j-success-123.mp4',
      })
    );

    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        videoPath: 'videos/c1/j-success-123.mp4',
        duration: 12.5,
        size: 1048576,
      })
    );
  });

  it('catches and logs ffmpeg error when video rendering fails', async () => {
    const mockSnap = {
      data: () => ({
        jobId: 'j-err-123',
        status: 'pending',
        classId: 'c1',
        studentUid: 's1',
        studentEmail: 's1@test.com',
        startTime: new Date('2026-09-19T09:00:00Z'),
        endTime: new Date('2026-09-19T10:00:00Z'),
      }),
      ref: { update: mockJobUpdate },
    };

    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              data: () => ({ schedule: { timeZone: 'UTC' } }),
            }),
          }),
        };
      }
      if (name === 'screenshots') {
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: false,
            docs: [
              {
                data: () => ({
                  imagePath: 'screenshots/c1/s1/img1.jpg',
                  timestamp: { toDate: () => new Date('2026-09-19T09:15:00Z') },
                }),
              },
            ],
          }),
        };
      }
      return { doc: vi.fn() };
    });

    setFfmpegShouldFail(true);

    await processVideoJob({ data: mockSnap });

    expect(mockJobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('ffmpeg failed to process video'),
        ffmpegError: 'Corrupt frames',
      })
    );
  });
});
