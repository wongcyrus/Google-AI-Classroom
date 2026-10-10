import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockBucket, mockStorage } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    collection: vi.fn(),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
    batch: vi.fn(() => ({
      delete: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(),
    })),
  };

  const mockBucket = {
    file: vi.fn(() => ({
      delete: vi.fn(),
    })),
    deleteFiles: vi.fn(),
  };

  const mockStorage = {
    bucket: vi.fn(() => mockBucket),
  };

  return { mockDoc, mockCollection, mockDb, mockBucket, mockStorage };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    increment: vi.fn(val => val),
    arrayRemove: vi.fn(val => val),
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => mockStorage),
}));

vi.mock('firebase-functions/v2/storage', () => ({
  onObjectFinalized: vi.fn((opts, handler) => handler),
  onObjectDeleted: vi.fn((opts, handler) => handler),
}));

import { updateStorageUsageOnUpload, updateStorageUsageOnDelete, getStorageCategoryAndClass } from './storageQuota.js';

describe('Storage Quota Calculations (functions/storage_triggers/storageQuota.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.collection.mockReturnValue(mockCollection);
  });

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
  });

  it('determines if storage quota is exceeded', () => {
    const isExceeded = (currentUsage, newFileSize, quotaLimitBytes) => {
      return (currentUsage + newFileSize) > quotaLimitBytes;
    };

    const quota1GB = 1024 * 1024 * 1024;
    expect(isExceeded(500 * 1024 * 1024, 100 * 1024 * 1024, quota1GB)).toBe(false);
    expect(isExceeded(1000 * 1024 * 1024, 50 * 1024 * 1024, quota1GB)).toBe(true);
  });

  it('increments storage usage when a valid tracked file is uploaded', async () => {
    mockDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageLimit: 1000000000 }),
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
  });

  it('decrements storage usage when a valid tracked file is deleted', async () => {
    mockDoc.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({ storageLimit: 1000000000 }),
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

  it('handles uploads for zips and audio folders, and creates doc if metadata does not exist', async () => {
    // 1. Doc does not exist on upload -> update fails with code 5, class doc exists
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

    // 2. Audio upload
    mockDoc.get
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageQuota: 1000000000 }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({ storageUsage: 409600 }),
      });

    await updateStorageUsageOnUpload({
      data: { name: 'audio/CLASS_AUD/lecture.webm', size: '409600' },
    });

    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        storageUsageAudio: 409600,
      })
    );
  });

  it('handles delete for zips and audio, ignoring invalid size and handling errors', async () => {
    // Delete zips
    await updateStorageUsageOnDelete({
      data: { name: 'zips/CLASS_ZIP/archive.zip', size: '204800' },
    });
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        storageUsageZips: -204800,
      })
    );

    // Delete audio
    await updateStorageUsageOnDelete({
      data: { name: 'audio/CLASS_AUD/track.webm', size: '102400' },
    });
    expect(mockDoc.update).toHaveBeenCalledWith(
      expect.objectContaining({
        storageUsageAudio: -102400,
      })
    );

    // Invalid size ignored
    await updateStorageUsageOnDelete({
      data: { name: 'audio/CLASS_AUD/track.webm', size: '0' },
    });

    // Ignored paths
    await updateStorageUsageOnDelete({
      data: { name: 'random/file.txt', size: '100' },
    });
    await updateStorageUsageOnDelete({
      data: { name: 'audio/incomplete_path.webm', size: '100' },
    });
  });
});

