import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockBucket, mockStorage, mockBatch } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ref: {},
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
    startAfter: vi.fn(),
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
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => mockStorage),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentDeleted: vi.fn((opts, handler) => handler),
  onDocumentUpdated: vi.fn((opts, handler) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  onScreenshotDocDeleted,
  onAudioDocDeleted,
  onLectureRecordingDeleted,
  onClassDocDeleted,
  onClassRetentionUpdated,
  onVideoJobDocDeleted,
  onZipJobDocDeleted,
} from './cleanupTriggers.js';

describe('Cleanup Triggers & Retention Calculation (functions/storage_triggers/cleanupTriggers.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
    mockCollection.limit.mockReturnValue(mockCollection);
    mockCollection.get.mockResolvedValue({ empty: true, docs: [] });
  });

  describe('Storage object deletion triggers', () => {
    it('deletes physical screenshot file when screenshot doc is deleted', async () => {
      const event = {
        data: {
          data: () => ({
            imagePath: 'screenshots/CLASS_1/s1/shot.jpg',
          }),
        },
        params: { screenshotId: 'shot1' },
      };

      await onScreenshotDocDeleted(event);

      expect(mockBucket.file).toHaveBeenCalledWith('screenshots/CLASS_1/s1/shot.jpg');
    });

    it('ignores screenshot doc deletion if no data or no imagePath', async () => {
      await onScreenshotDocDeleted({ data: null, params: { screenshotId: 'shot2' } });
      await onScreenshotDocDeleted({
        data: { data: () => ({}) },
        params: { screenshotId: 'shot3' },
      });

      expect(mockBucket.file).not.toHaveBeenCalled();
    });

    it('deletes physical audio file when audio doc is deleted', async () => {
      const event = {
        data: {
          data: () => ({
            audioPath: 'audio/CLASS_1/s1/chunk.webm',
          }),
        },
        params: { audioId: 'aud1' },
      };

      await onAudioDocDeleted(event);

      expect(mockBucket.file).toHaveBeenCalledWith('audio/CLASS_1/s1/chunk.webm');
    });

    it('deletes physical video file when videoJob doc is deleted', async () => {
      const event = {
        data: {
          data: () => ({
            videoPath: 'videos/CLASS_1/s1/video.mp4',
          }),
        },
        params: { jobId: 'job_vid_1' },
      };

      await onVideoJobDocDeleted(event);

      expect(mockBucket.file).toHaveBeenCalledWith('videos/CLASS_1/s1/video.mp4');
    });

    it('deletes physical zip file when zipJob doc is deleted', async () => {
      const event = {
        data: {
          data: () => ({
            zipPath: 'zips/CLASS_1/bundle.zip',
          }),
        },
        params: { jobId: 'job_zip_1' },
      };

      await onZipJobDocDeleted(event);

      expect(mockBucket.file).toHaveBeenCalledWith('zips/CLASS_1/bundle.zip');
    });

    it('purges all storage assets under recordings prefix when lecture recording doc is deleted', async () => {
      const event = {
        params: { classId: 'CLASS_1', sessionId: 'REC_SESSION_99' },
      };

      await onLectureRecordingDeleted(event);

      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'recordings/CLASS_1/REC_SESSION_99/',
        force: true,
      });
    });

    it('skips storage purge when lecture recording was copied from another class', async () => {
      const event = {
        params: { classId: 'CLASS_TARGET', sessionId: 'REC_COPIED_1' },
        data: {
          data: () => ({ copiedFromClassId: 'CLASS_SOURCE' }),
        },
      };

      await onLectureRecordingDeleted(event);

      expect(mockBucket.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('Class deletion cascading purge', () => {
    it('purges storage prefixes and related collections on class doc deletion', async () => {
      const event = {
        params: { classId: 'CLASS_EXP_1' },
      };

      await onClassDocDeleted(event);

      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'screenshots/CLASS_EXP_1/',
        force: true,
      });
      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'videos/CLASS_EXP_1/',
        force: true,
      });
      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'zips/CLASS_EXP_1/',
        force: true,
      });
      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'audio/CLASS_EXP_1/',
        force: true,
      });
      expect(mockBucket.deleteFiles).toHaveBeenCalledWith({
        prefix: 'recordings/CLASS_EXP_1/',
        force: true,
      });
    });
  });

  describe('Retention Days calculations', () => {
    it('correctly calculates new expireAt timestamps on retention update', () => {
      const calculateNewExpireAt = (createdAtTimestamp, retentionDays) => {
        const baseTime =
          createdAtTimestamp instanceof Date
            ? createdAtTimestamp.getTime()
            : new Date(createdAtTimestamp).getTime();
        return new Date(baseTime + retentionDays * 24 * 60 * 60 * 1000);
      };

      const now = new Date('2026-08-01T00:00:00Z');
      const expire14Days = calculateNewExpireAt(now, 14);
      const expire60Days = calculateNewExpireAt(now, 60);

      expect(expire14Days.toISOString()).toBe('2026-08-15T00:00:00.000Z');
      expect(expire60Days.toISOString()).toBe('2026-09-30T00:00:00.000Z');
    });

    it('determines if retentionDays has actually changed', () => {
      const hasRetentionChanged = (beforeData, afterData) => {
        const beforeRet = beforeData?.retentionDays ?? 14;
        const afterRet = afterData?.retentionDays ?? 14;
        return beforeRet !== afterRet;
      };

      expect(hasRetentionChanged({ retentionDays: 14 }, { retentionDays: 30 })).toBe(true);
      expect(hasRetentionChanged({ retentionDays: 14 }, { retentionDays: 14 })).toBe(false);
      expect(hasRetentionChanged({}, { retentionDays: 14 })).toBe(false);
    });

    it('ignores onClassRetentionUpdated if retentionDays did not change', async () => {
      const event = {
        data: {
          before: { data: () => ({ retentionDays: 14 }) },
          after: { data: () => ({ retentionDays: 14 }) },
        },
        params: { classId: 'CLASS_1' },
      };

      await onClassRetentionUpdated(event);
      expect(mockDb.collection).not.toHaveBeenCalled();
    });

    it('retroactively updates expireAt for active screenshots and deletes expired ones when retentionDays changes', async () => {
      const now = Date.now();
      const recentTimestamp = { toDate: () => new Date(now - 2 * 24 * 60 * 60 * 1000) }; // 2 days old
      const expiredTimestamp = { toDate: () => new Date(now - 20 * 24 * 60 * 60 * 1000) }; // 20 days old

      const docRecent = {
        ref: { id: 'shot_recent' },
        data: () => ({ timestamp: recentTimestamp }),
      };
      const docExpired = {
        ref: { id: 'shot_expired' },
        data: () => ({ timestamp: expiredTimestamp }),
      };

      // Query returns 2 screenshot docs, then 1 audio doc
      mockCollection.get
        .mockResolvedValueOnce({
          empty: false,
          size: 2,
          docs: [docRecent, docExpired],
        })
        .mockResolvedValueOnce({
          empty: false,
          size: 1,
          docs: [docRecent],
        });

      const event = {
        data: {
          before: { data: () => ({ retentionDays: 30 }) },
          after: { data: () => ({ retentionDays: 7 }) }, // Reduced to 7 days
        },
        params: { classId: 'CLASS_RET' },
      };

      await onClassRetentionUpdated(event);

      // docRecent updated with new expireAt
      expect(mockBatch.update).toHaveBeenCalledWith(
        docRecent.ref,
        expect.objectContaining({ expireAt: expect.any(Date) })
      );

      // docExpired deleted because 20 days > 7 days retention
      expect(mockBatch.delete).toHaveBeenCalledWith(docExpired.ref);
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('retroactively updates expireAt for videoJobs and deletes expired ones when videoRetentionDays changes', async () => {
      const now = Date.now();
      const recentDate = { toDate: () => new Date(now - 10 * 24 * 60 * 60 * 1000) }; // 10 days old
      const expiredDate = { toDate: () => new Date(now - 100 * 24 * 60 * 60 * 1000) }; // 100 days old

      const videoRecent = {
        ref: { id: 'vid_recent' },
        data: () => ({ createdAt: recentDate }),
      };
      const videoExpired = {
        ref: { id: 'vid_expired' },
        data: () => ({ createdAt: expiredDate }),
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        size: 2,
        docs: [videoRecent, videoExpired],
      });

      const event = {
        data: {
          before: { data: () => ({ videoRetentionDays: 90 }) },
          after: { data: () => ({ videoRetentionDays: 30 }) },
        },
        params: { classId: 'CLASS_RET_VID' },
      };

      await onClassRetentionUpdated(event);

      expect(mockBatch.update).toHaveBeenCalledWith(
        videoRecent.ref,
        expect.objectContaining({ expireAt: expect.any(Date) })
      );
      expect(mockBatch.delete).toHaveBeenCalledWith(videoExpired.ref);
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('returns early if before or after event data is missing', async () => {
      await onClassRetentionUpdated({
        data: null,
        params: { classId: 'CLASS_MISSING' },
      });
      await onClassRetentionUpdated({
        data: { before: null, after: null },
        params: { classId: 'CLASS_MISSING' },
      });
      expect(mockDb.collection).not.toHaveBeenCalled();
    });

    it('handles audio documents with string timestamps and videoJobs with startTime', async () => {
      const now = Date.now();
      const shotDoc = {
        ref: { id: 'shot_1' },
        data: () => ({ timestamp: { toDate: () => new Date(now - 1000) } }),
      };
      const stringTsAudio = {
        ref: { id: 'aud_str' },
        data: () => ({ timestamp: new Date(now - 1000).toISOString() }),
      };
      const startTimeVideo = {
        ref: { id: 'vid_start' },
        data: () => ({ startTime: { toDate: () => new Date(now - 1000) } }),
      };

      // 1. screenshots
      // 2. audio
      // 3. videoJobs
      mockCollection.get
        .mockResolvedValueOnce({
          empty: false,
          size: 1,
          docs: [shotDoc],
        })
        .mockResolvedValueOnce({
          empty: false,
          size: 1,
          docs: [stringTsAudio],
        })
        .mockResolvedValueOnce({
          empty: false,
          size: 1,
          docs: [startTimeVideo],
        });

      await onClassRetentionUpdated({
        data: {
          before: { data: () => ({ retentionDays: 30, videoRetentionDays: 60 }) },
          after: { data: () => ({ retentionDays: 10, videoRetentionDays: 20 }) },
        },
        params: { classId: 'CLASS_RET_MIX' },
      });

      expect(mockBatch.update).toHaveBeenCalled();
    });
  });

  describe('Edge cases and error handling across triggers', () => {
    it('handles file deletion errors gracefully in onScreenshotDocDeleted', async () => {
      mockBucket.file.mockReturnValueOnce({
        delete: vi.fn().mockRejectedValueOnce(new Error('Storage permission error')),
      });

      await expect(
        onScreenshotDocDeleted({
          data: { data: () => ({ imagePath: 'screenshots/CLASS_1/err.jpg' }) },
          params: { screenshotId: 'shot_err' },
        })
      ).resolves.not.toThrow();
    });

    it('handles missing paths and deletion errors in onAudioDocDeleted', async () => {
      await onAudioDocDeleted({
        data: null,
        params: { audioId: 'aud_null' },
      });
      await onAudioDocDeleted({
        data: { data: () => ({}) },
        params: { audioId: 'aud_empty' },
      });

      mockBucket.file.mockReturnValueOnce({
        delete: vi.fn().mockRejectedValueOnce(new Error('Audio delete error')),
      });

      await expect(
        onAudioDocDeleted({
          data: { data: () => ({ audioPath: 'audio/CLASS_1/err.webm' }) },
          params: { audioId: 'aud_err' },
        })
      ).resolves.not.toThrow();
    });

    it('handles missing params and deletion errors in onLectureRecordingDeleted', async () => {
      await onLectureRecordingDeleted({
        params: { classId: null, sessionId: null },
      });

      mockBucket.deleteFiles.mockRejectedValueOnce(new Error('GCS error'));

      await expect(
        onLectureRecordingDeleted({
          params: { classId: 'CLASS_1', sessionId: 'sess_err' },
          data: { data: () => ({}) },
        })
      ).resolves.not.toThrow();
    });

    it('handles null data, missing paths, fallback resultVideoPath, and errors in onVideoJobDocDeleted', async () => {
      await onVideoJobDocDeleted({ data: null, params: { jobId: 'j1' } });
      await onVideoJobDocDeleted({ data: { data: () => ({}) }, params: { jobId: 'j2' } });

      // Fallback to resultVideoPath
      await onVideoJobDocDeleted({
        data: { data: () => ({ resultVideoPath: 'videos/CLASS_1/res.mp4' }) },
        params: { jobId: 'j3' },
      });
      expect(mockBucket.file).toHaveBeenCalledWith('videos/CLASS_1/res.mp4');

      // Error handling
      mockBucket.file.mockReturnValueOnce({
        delete: vi.fn().mockRejectedValueOnce(new Error('GCS video err')),
      });
      await expect(
        onVideoJobDocDeleted({
          data: { data: () => ({ videoPath: 'videos/CLASS_1/err.mp4' }) },
          params: { jobId: 'j4' },
        })
      ).resolves.not.toThrow();
    });

    it('handles null data, missing paths, fallback destinationPath, and errors in onZipJobDocDeleted', async () => {
      await onZipJobDocDeleted({ data: null, params: { jobId: 'z1' } });
      await onZipJobDocDeleted({ data: { data: () => ({}) }, params: { jobId: 'z2' } });

      // Fallback to destinationPath
      await onZipJobDocDeleted({
        data: { data: () => ({ destinationPath: 'zips/CLASS_1/archive.zip' }) },
        params: { jobId: 'z3' },
      });
      expect(mockBucket.file).toHaveBeenCalledWith('zips/CLASS_1/archive.zip');

      // Error handling
      mockBucket.file.mockReturnValueOnce({
        delete: vi.fn().mockRejectedValueOnce(new Error('GCS zip err')),
      });
      await expect(
        onZipJobDocDeleted({
          data: { data: () => ({ zipPath: 'zips/CLASS_1/err.zip' }) },
          params: { jobId: 'z4' },
        })
      ).resolves.not.toThrow();
    });

    it('cleans up subcollections (tasks, submissions, bingo, status, ephemeral) on class deletion', async () => {
      const mockTaskDoc = {
        ref: {
          delete: vi.fn().mockResolvedValue(true),
          collection: vi.fn(() => ({
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [{ ref: { delete: vi.fn() } }],
            }),
          })),
        },
      };

      const mockSubDoc = { ref: { delete: vi.fn() } };

      mockDb.collection.mockImplementation((col) => {
        if (col.includes('tasks')) {
          return {
            get: vi.fn().mockResolvedValue({
              empty: false,
              size: 1,
              docs: [mockTaskDoc],
            }),
          };
        }
        if (col.includes('lectureRecordings') || col.includes('bingoSessions') || col.includes('status')) {
          return {
            get: vi.fn().mockResolvedValue({
              empty: false,
              size: 1,
              docs: [mockSubDoc],
            }),
          };
        }
        if (col.includes('Profiles')) {
          return {
            where: vi.fn().mockReturnThis(),
            get: vi.fn().mockResolvedValue({
              empty: false,
              docs: [mockSubDoc],
            }),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            empty: false,
            size: 1,
            docs: [mockSubDoc],
          }),
        };
      });

      await onClassDocDeleted({ params: { classId: 'CLASS_SUBCOLS' } });

      expect(mockBatch.delete).toHaveBeenCalled();
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });
});
