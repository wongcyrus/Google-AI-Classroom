import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockBucket, mockStorage, mockBatch } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn().mockResolvedValue(true),
    ref: { delete: vi.fn().mockResolvedValue(true) },
    collection: vi.fn(),
    data: vi.fn(),
    exists: true,
  };

  const mockBatch = {
    delete: vi.fn(),
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(true),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    doc: vi.fn(() => mockDoc),
    batch: vi.fn(() => mockBatch),
  };

  const mockBucket = {
    file: vi.fn(() => ({
      delete: vi.fn().mockResolvedValue(true),
    })),
    deleteFiles: vi.fn().mockResolvedValue(true),
    getFiles: vi.fn().mockResolvedValue([[]]),
  };

  const mockStorage = {
    bucket: vi.fn(() => mockBucket),
  };

  return { mockDoc, mockCollection, mockDb, mockBucket, mockStorage, mockBatch };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    increment: vi.fn((val) => val),
    arrayRemove: vi.fn((val) => val),
    serverTimestamp: vi.fn(() => new Date()),
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => mockStorage),
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

vi.mock('firebase-functions/v2/storage', () => ({
  onObjectFinalized: vi.fn((opts, handler) => handler),
  onObjectDeleted: vi.fn((opts, handler) => handler),
}));

import { purgeClassTelemetryData, deleteScreenshotsByDateRange } from './screenshotManagement.js';

describe('purgeClassTelemetryData / deleteScreenshotsByDateRange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.collection.mockReturnValue(mockCollection);
  });

  it('rejects unauthenticated requests', async () => {
    await expect(
      purgeClassTelemetryData({
        auth: null,
        data: { classId: 'CLASS_1', startDate: '2026-08-01', endDate: '2026-08-02' },
      })
    ).rejects.toThrow('The function must be called while authenticated.');
  });

  it('rejects missing parameters', async () => {
    await expect(
      purgeClassTelemetryData({
        auth: { uid: 'teacher1', token: { role: 'teacher' } },
        data: { classId: 'CLASS_1' },
      })
    ).rejects.toThrow('The function must be called with classId, startDate, and endDate.');
  });

  it('rejects student callers who are not teachers of the class', async () => {
    mockDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ teacherEmails: ['teacher@school.edu'], teachers: { teacher1: true } }),
    });

    await expect(
      purgeClassTelemetryData({
        auth: { uid: 'student123', token: { role: 'student', email: 'student@school.edu' } },
        data: { classId: 'CLASS_1', startDate: '2026-08-01', endDate: '2026-08-02' },
      })
    ).rejects.toThrow('Only teachers assigned to this class can purge session telemetry data.');
  });

  it('allows teacher by role and purges screenshots and audio by default', async () => {
    const mockScreenshotDocs = [
      {
        id: 's1',
        data: () => ({ imagePath: 'screenshots/CLASS_1/s1.jpg', timestamp: new Date('2026-08-01T10:00:00Z') }),
        ref: { delete: vi.fn() },
      },
    ];
    const mockAudioDocs = [
      {
        id: 'a1',
        data: () => ({ audioPath: 'audio/CLASS_1/a1.webm', timestamp: new Date('2026-08-01T10:05:00Z') }),
        ref: { delete: vi.fn() },
      },
    ];

    // Setup where chain to return the docs
    const queryScreenshots = {
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: mockScreenshotDocs }),
    };
    const queryAudio = {
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: mockAudioDocs }),
    };

    mockDb.collection.mockImplementation((col) => {
      if (col === 'screenshots') return queryScreenshots;
      if (col === 'audio') return queryAudio;
      return mockCollection;
    });

    const result = await purgeClassTelemetryData({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
      },
    });

    expect(result.status).toBe('success');
    expect(result.screenshotsCount).toBe(1);
    expect(result.audioCount).toBe(1);
    expect(result.totalPurged).toBe(2);
    expect(mockBatch.delete).toHaveBeenCalledTimes(2);
    expect(mockBatch.commit).toHaveBeenCalled();
  });

  it('gracefully falls back to class-scoped in-memory query when index throws FAILED_PRECONDITION', async () => {
    const mockAudioDocs = [
      {
        id: 'a1',
        data: () => ({ audioPath: 'audio/CLASS_1/a1.webm', timestamp: new Date('2026-08-01T12:00:00Z') }),
        ref: { delete: vi.fn() },
      },
      {
        id: 'a2_out_of_range',
        data: () => ({ audioPath: 'audio/CLASS_1/a2.webm', timestamp: new Date('2026-07-01T12:00:00Z') }),
        ref: { delete: vi.fn() },
      },
    ];

    // Primary composite query throws index error
    const brokenQuery = {
      where: vi.fn((field) => {
        if (field === 'timestamp') {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockRejectedValue(new Error('9 FAILED_PRECONDITION: The query requires an index.')),
          };
        }
        return brokenQuery;
      }),
      get: vi.fn().mockResolvedValue({ docs: mockAudioDocs }),
    };

    mockDb.collection.mockImplementation((col) => {
      if (col === 'screenshots') {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ docs: [] }),
        };
      }
      if (col === 'audio') return brokenQuery;
      return mockCollection;
    });

    const result = await deleteScreenshotsByDateRange({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
        targets: { screenshots: false, audio: true },
      },
    });

    expect(result.status).toBe('success');
    expect(result.audioCount).toBe(1); // Only in-range doc a1 was purged
    expect(result.screenshotsCount).toBe(0);
  });

  it('supports selective purging of compiled videos and lecture recordings', async () => {
    const mockVideoDocs = [
      {
        id: 'v1',
        data: () => ({ videoPath: 'videos/CLASS_1/v1.mp4', createdAt: new Date('2026-08-01T10:00:00Z') }),
        ref: { delete: vi.fn() },
      },
    ];

    const lectureSubDocs = [
      {
        id: 'session_1',
        data: () => ({ startedAt: new Date('2026-08-01T10:00:00Z') }),
        ref: { delete: vi.fn().mockResolvedValue(true) },
      },
    ];

    mockDb.collection.mockImplementation((col) => {
      if (col === 'videoJobs') {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ docs: mockVideoDocs }),
        };
      }
      if (col === 'classes/CLASS_1/lectureRecordings') {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ docs: lectureSubDocs }),
        };
      }
      return mockCollection;
    });

    const result = await purgeClassTelemetryData({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
        targets: {
          screenshots: false,
          audio: false,
          videos: true,
          lectureRecordings: true,
        },
      },
    });

    expect(result.status).toBe('success');
    expect(result.videosCount).toBe(1);
    expect(result.recordingsCount).toBe(1);
    expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
      prefix: 'recordings/CLASS_1/session_1/',
      force: true,
    });
  });

  it('returns clean message when no telemetry matches the criteria', async () => {
    mockDb.collection.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      doc: vi.fn(() => mockDoc),
    });

    const result = await purgeClassTelemetryData({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
      },
    });

    expect(result.status).toBe('success');
    expect(result.totalPurged).toBe(0);
    expect(result.message).toContain('No session data found');
  });

  it('purges orphaned Cloud Storage files even when Firestore has zero documents', async () => {
    // Firestore returns 0 documents for screenshots and audio
    mockDb.collection.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      get: vi.fn().mockResolvedValue({ docs: [] }),
      doc: vi.fn(() => mockDoc),
    });

    // Cloud Storage has 2 orphaned screenshots and 1 orphaned audio file
    const mockFile1 = {
      name: 'screenshots/CLASS_1/s1/screen_1788926191797.jpg',
      metadata: { timeCreated: '2026-08-01T10:00:00.000Z' },
      delete: vi.fn().mockResolvedValue(true),
    };
    const mockFile2 = {
      name: 'audio/CLASS_1/s1/audio_1789639569373.webm',
      metadata: { timeCreated: '2026-08-01T11:00:00.000Z' },
      delete: vi.fn().mockResolvedValue(true),
    };

    mockBucket.getFiles.mockImplementation(({ prefix }) => {
      if (prefix === 'screenshots/CLASS_1/') return Promise.resolve([[mockFile1]]);
      if (prefix === 'audio/CLASS_1/') return Promise.resolve([[mockFile2]]);
      return Promise.resolve([[]]);
    });

    const result = await purgeClassTelemetryData({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
        targets: { screenshots: true, audio: true },
      },
    });

    expect(result.status).toBe('success');
    expect(result.screenshotsCount).toBe(1);
    expect(result.audioCount).toBe(1);
    expect(result.totalPurged).toBe(2);
    expect(mockFile1.delete).toHaveBeenCalled();
    expect(mockFile2.delete).toHaveBeenCalled();
  });

  it('purges irregularities documents and files when targets.irregularities is true', async () => {
    const mockIrregDocs = [
      {
        id: 'irreg1',
        data: () => ({ imagePath: 'irregularities/CLASS_1/img1.jpg', timestamp: new Date('2026-08-01T10:00:00Z') }),
        ref: { delete: vi.fn() },
      },
    ];

    mockDb.collection.mockImplementation((col) => {
      if (col === 'classes/CLASS_1/irregularities') {
        return {
          where: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({ docs: mockIrregDocs }),
        };
      }
      return {
        where: vi.fn().mockReturnThis(),
        get: vi.fn().mockResolvedValue({ docs: [] }),
        doc: vi.fn(() => mockDoc),
      };
    });

    mockBucket.getFiles.mockResolvedValue([[]]);

    const result = await purgeClassTelemetryData({
      auth: { uid: 'teacher1', token: { role: 'teacher' } },
      data: {
        classId: 'CLASS_1',
        startDate: '2026-08-01T00:00:00Z',
        endDate: '2026-08-01T23:59:59Z',
        targets: { screenshots: false, audio: false, irregularities: true },
      },
    });

    expect(result.status).toBe('success');
    expect(result.irregularitiesCount).toBe(1);
    expect(result.totalPurged).toBe(1);
    expect(mockBatch.delete).toHaveBeenCalled();
  });
});
