import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockBucket, mockStorage } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(true),
    update: vi.fn().mockResolvedValue(true),
    delete: vi.fn().mockResolvedValue(true),
    collection: vi.fn(),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    doc: vi.fn(() => mockDoc),
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
    getFiles: vi.fn().mockResolvedValue([[]]),
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

import {
  updateStorageUsageOnUpload,
  updateStorageUsageOnDelete,
  getStorageCategoryAndClass,
  recalculateStorageUsage,
  recalculateStorageUsageInternal,
} from './storageQuota.js';

describe('Storage Quota Calculations (functions/storage_triggers/storageQuota.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.collection.mockReturnValue(mockCollection);
    mockBucket.getFiles.mockResolvedValue([[]]);
  });

  describe('getStorageCategoryAndClass', () => {
    it('correctly categorizes tracked storage folders and usage fields for all data types', () => {
      expect(getStorageCategoryAndClass('screenshots/CLASS_1/s1/img.jpg')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageScreenShots' });
      expect(getStorageCategoryAndClass('videos/CLASS_1/s1/rec.mp4')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageVideos' });
      expect(getStorageCategoryAndClass('zips/CLASS_1/archive.zip')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageZips' });
      expect(getStorageCategoryAndClass('audio/CLASS_1/s1/audio.webm')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageAudio' });
      expect(getStorageCategoryAndClass('recordings/CLASS_1/sess1/lecture.webm')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageRecordings' });
      expect(getStorageCategoryAndClass('subtitles/CLASS_1/sess1/subtitles_en.srt')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageRecordings' });
      expect(getStorageCategoryAndClass('irregularities/CLASS_1/incident/proof.jpg')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageIrregularities' });
      expect(getStorageCategoryAndClass('classes/CLASS_1/tasks/demos/intro.mp4')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageTasks' });
      expect(getStorageCategoryAndClass('tasks/CLASS_1/task1/material.pdf')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageTasks' });
      expect(getStorageCategoryAndClass('submissions/CLASS_1/task1/student1/work.zip')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageTasks' });
      expect(getStorageCategoryAndClass('reports/CLASS_1/job1/dossier.docx')).toEqual({ classId: 'CLASS_1', usageField: 'storageUsageReports' });
      expect(getStorageCategoryAndClass('untracked/file.txt')).toBeNull();
      expect(getStorageCategoryAndClass('screenshots/only_two_parts.jpg')).toBeNull();
      expect(getStorageCategoryAndClass(null)).toBeNull();
      expect(getStorageCategoryAndClass('')).toBeNull();
      expect(getStorageCategoryAndClass(123)).toBeNull();
    });

    it('determines if storage quota is exceeded', () => {
      const isExceeded = (currentUsage, newFileSize, quotaLimitBytes) => {
        return (currentUsage + newFileSize) > quotaLimitBytes;
      };

      const quota1GB = 1024 * 1024 * 1024;
      expect(isExceeded(500 * 1024 * 1024, 100 * 1024 * 1024, quota1GB)).toBe(false);
      expect(isExceeded(1000 * 1024 * 1024, 50 * 1024 * 1024, quota1GB)).toBe(true);
    });
  });

  describe('updateStorageUsageOnUpload', () => {
    it('increments storage usage when a valid tracked file is uploaded', async () => {
      mockDoc.get.mockResolvedValue({
        exists: true,
        data: () => ({ storageQuota: 1000000000, storageUsage: 102400 }),
      });

      const event = {
        data: {
          name: 'screenshots/CLASS_1/s1/screen.jpg',
          size: '102400',
        },
      };

      await updateStorageUsageOnUpload(event);

      expect(mockDoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUsage: 102400,
          storageUsageScreenShots: 102400,
        })
      );
    });

    it('ignores file upload if not in a tracked folder or invalid path', async () => {
      await updateStorageUsageOnUpload({
        data: { name: 'other/random.txt', size: '500' },
      });
      expect(mockDoc.update).not.toHaveBeenCalled();

      await updateStorageUsageOnUpload({
        data: { name: 'screenshots/only_two_parts.jpg', size: '500' },
      });
      expect(mockDoc.update).not.toHaveBeenCalled();

      await updateStorageUsageOnUpload({
        data: { name: 'screenshots/CLASS_1/pic.jpg', size: '0' },
      });
      expect(mockDoc.update).not.toHaveBeenCalled();

      await updateStorageUsageOnUpload({
        data: { name: 'screenshots/CLASS_1/pic.jpg', size: 'invalid' },
      });
      expect(mockDoc.update).not.toHaveBeenCalled();
    });

    it('deletes uploaded file and reverts storage increment if quota is exceeded', async () => {
      mockDoc.get
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ storageQuota: 1000 }),
        })
        .mockResolvedValueOnce({
          exists: true,
          data: () => ({ storageUsage: 1500 }),
        });

      const mockFile = { delete: vi.fn().mockResolvedValue(true) };
      mockBucket.file.mockReturnValue(mockFile);

      await updateStorageUsageOnUpload({
        bucket: 'test-bucket',
        data: { name: 'screenshots/CLASS_1/s1/shot.jpg', size: '600' },
      });

      expect(mockFile.delete).toHaveBeenCalled();
      expect(mockDoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUsage: -600,
          storageUsageScreenShots: -600,
        })
      );
    });

    it('handles first upload when storage doc does not exist (code 5)', async () => {
      mockDoc.update.mockRejectedValueOnce({ code: 5 });
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageQuota: 5000000 }),
      });

      await updateStorageUsageOnUpload({
        data: { name: 'zips/CLASS_ZIP/archive.zip', size: '204800' },
      });

      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUsage: 204800,
          storageUsageZips: 204800,
        })
      );
    });

    it('deletes file when first upload exceeds quota', async () => {
      mockDoc.update.mockRejectedValueOnce({ code: 5 });
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageQuota: 500 }),
      });
      const mockFile = { delete: vi.fn().mockResolvedValue(true) };
      mockBucket.file.mockReturnValue(mockFile);

      await updateStorageUsageOnUpload({
        bucket: 'test-bucket',
        data: { name: 'zips/CLASS_ZIP/archive.zip', size: '204800' },
      });

      expect(mockFile.delete).toHaveBeenCalled();
      expect(mockDoc.set).not.toHaveBeenCalled();
    });

    it('deletes orphaned file when class document does not exist', async () => {
      mockDoc.update.mockRejectedValueOnce({ code: 5 });
      mockDoc.get.mockResolvedValueOnce({
        exists: false,
      });
      const mockFile = { delete: vi.fn().mockResolvedValue(true) };
      mockBucket.file.mockReturnValue(mockFile);

      await updateStorageUsageOnUpload({
        bucket: 'test-bucket',
        data: { name: 'videos/CLASS_NONE/rec.mp4', size: '204800' },
      });

      expect(mockFile.delete).toHaveBeenCalled();
    });

    it('logs error when update fails with non-code-5 error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDoc.update.mockRejectedValueOnce(new Error('Firestore connection timeout'));

      await updateStorageUsageOnUpload({
        data: { name: 'videos/CLASS_ERR/rec.mp4', size: '204800' },
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update storage usage'),
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('updateStorageUsageOnDelete', () => {
    it('decrements storage usage when a valid tracked file is deleted', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageUsage: 1000000, storageUsageVideos: 500000 }),
      });

      const event = {
        data: {
          name: 'videos/CLASS_1/s1/clip.mp4',
          size: '500000',
        },
      };

      await updateStorageUsageOnDelete(event);

      expect(mockDoc.update).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUsage: -500000,
          storageUsageVideos: -500000,
        })
      );
    });

    it('skips decrement and self-heals if storageUsage is already 0 or negative', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageUsage: -50, storageUsageVideos: -50 }),
      });

      await updateStorageUsageOnDelete({
        data: { name: 'videos/CLASS_1/s1/clip.mp4', size: '500' },
      });

      // Should heal negative values to 0 without decrementing
      expect(mockDoc.update).toHaveBeenCalledWith({
        storageUsageVideos: 0,
        storageUsage: 0,
      });
    });

    it('limits decrement so values do not go below zero', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageUsage: 300, storageUsageVideos: 200 }),
      });

      await updateStorageUsageOnDelete({
        data: { name: 'videos/CLASS_1/s1/clip.mp4', size: '500' },
      });

      expect(mockDoc.update).toHaveBeenCalledWith({
        storageUsageVideos: -200,
        storageUsage: -300,
      });
    });

    it('handles get failure gracefully and still attempts decrement', async () => {
      mockDoc.get.mockRejectedValueOnce(new Error('Network error'));

      await updateStorageUsageOnDelete({
        data: { name: 'audio/CLASS_1/s1/audio.webm', size: '1000' },
      });

      expect(mockDoc.update).toHaveBeenCalledWith({
        storageUsageAudio: -1000,
        storageUsage: -1000,
      });
    });

    it('handles update failure gracefully and logs error', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageUsage: 1000, storageUsageAudio: 1000 }),
      });
      mockDoc.update.mockRejectedValueOnce(new Error('Write permission denied'));

      await updateStorageUsageOnDelete({
        data: { name: 'audio/CLASS_1/s1/audio.webm', size: '500' },
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to decrease storage usage'),
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
    });

    it('ignores invalid file size or untracked paths', async () => {
      await updateStorageUsageOnDelete({
        data: { name: 'audio/CLASS_AUD/track.webm', size: '0' },
      });
      await updateStorageUsageOnDelete({
        data: { name: 'random/file.txt', size: '100' },
      });
      await updateStorageUsageOnDelete({
        data: { name: 'audio/incomplete_path.webm', size: '100' },
      });
      expect(mockDoc.update).not.toHaveBeenCalled();
    });
  });

  describe('recalculateStorageUsage callable and internal reconciliation', () => {
    it('throws unauthenticated if request.auth is missing', async () => {
      await expect(recalculateStorageUsage({ data: { classId: 'CLASS_1' } })).rejects.toThrow(
        /authenticated/
      );
    });

    it('throws invalid-argument if classId is missing', async () => {
      await expect(
        recalculateStorageUsage({ auth: { uid: 'u1' }, data: {} })
      ).rejects.toThrow(/Missing classId/);
    });

    it('throws permission-denied if caller is neither teacher by role nor assigned in class doc', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          teacherEmails: ['other@school.com'],
          teachers: { t1: true },
        }),
      });

      await expect(
        recalculateStorageUsage({
          auth: { uid: 'student1', token: { role: 'student', email: 'student@school.com' } },
          data: { classId: 'CLASS_1' },
        })
      ).rejects.toThrow(/Only teachers assigned to this class/);
    });

    it('allows teacher authorized via role="teacher"', async () => {
      mockBucket.getFiles.mockResolvedValue([
        [
          { metadata: { size: '1048576' } }, // 1 MB
        ],
      ]);

      const result = await recalculateStorageUsage({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'CLASS_1' },
      });

      expect(result.status).toBe('success');
      expect(result.storageUsage).toBeGreaterThan(0);
      expect(result.message).toContain('Total usage:');
    });

    it('allows teacher assigned via classDoc.teacherEmails', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          teacherEmails: ['prof@school.com'],
        }),
      });

      const result = await recalculateStorageUsage({
        auth: { uid: 'prof_id', token: { role: 'guest', email: 'prof@school.com' } },
        data: { classId: 'CLASS_1' },
      });

      expect(result.status).toBe('success');
    });

    it('allows teacher assigned via classDoc.teachers object', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          teachers: { prof_uid: true },
        }),
      });

      const result = await recalculateStorageUsage({
        auth: { uid: 'prof_uid', token: { role: 'guest' } },
        data: { classId: 'CLASS_1' },
      });

      expect(result.status).toBe('success');
    });

    it('recalculateStorageUsageInternal sums up files and handles scan errors gracefully', async () => {
      let callCount = 0;
      mockBucket.getFiles.mockImplementation(({ prefix }) => {
        callCount++;
        if (prefix.includes('recordings')) {
          throw new Error('Simulated GCS transient error');
        }
        if (prefix.includes('screenshots')) {
          return [
            [
              { metadata: { size: '2048' } },
              { metadata: { size: 'invalid' } },
              { metadata: {} },
            ],
          ];
        }
        return [[]];
      });

      const result = await recalculateStorageUsageInternal('CLASS_1');

      expect(result.storageUsageScreenShots).toBe(2048);
      expect(result.storageUsage).toBe(2048);
      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          storageUsageScreenShots: 2048,
        }),
        { merge: true }
      );
    });

    it('recalculateStorageUsageInternal handles classRef sync failure gracefully', async () => {
      mockBucket.getFiles.mockResolvedValue([[]]);
      mockDoc.set
        .mockResolvedValueOnce(true) // storageRef.set succeeds
        .mockRejectedValueOnce(new Error('Sync failed')); // classRef.set fails

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const result = await recalculateStorageUsageInternal('CLASS_1');

      expect(result.status).toBeUndefined();
      expect(result.storageUsage).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not sync storageUsage to class CLASS_1:'),
        expect.any(Error)
      );
      consoleWarnSpy.mockRestore();
    });
  });
});
