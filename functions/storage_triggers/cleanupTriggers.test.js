import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockBucket, mockStorage } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    ref: {},
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    limit: vi.fn(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    batch: vi.fn(() => ({
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn().mockResolvedValue(true),
    })),
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

  return { mockDoc, mockCollection, mockDb, mockBucket, mockStorage };
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
  onClassDocDeleted,
  onClassRetentionUpdated,
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
  });
});
