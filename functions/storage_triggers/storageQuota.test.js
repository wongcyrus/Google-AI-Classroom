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

import { updateStorageUsageOnUpload, updateStorageUsageOnDelete } from './storageQuota.js';

describe('Storage Quota Calculations (functions/storage_triggers/storageQuota.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.collection.mockReturnValue(mockCollection);
  });

  it('correctly categorizes tracked storage folders and usage fields', () => {
    const getUsageField = (filePath) => {
      if (filePath.startsWith('screenshots/')) return 'storageUsageScreenShots';
      if (filePath.startsWith('videos/')) return 'storageUsageVideos';
      if (filePath.startsWith('zips/')) return 'storageUsageZips';
      if (filePath.startsWith('audio/')) return 'storageUsageAudio';
      return null;
    };

    expect(getUsageField('screenshots/CLASS_1/s1/img.jpg')).toBe('storageUsageScreenShots');
    expect(getUsageField('videos/CLASS_1/s1/rec.mp4')).toBe('storageUsageVideos');
    expect(getUsageField('zips/CLASS_1/archive.zip')).toBe('storageUsageZips');
    expect(getUsageField('audio/CLASS_1/s1/audio.webm')).toBe('storageUsageAudio');
    expect(getUsageField('untracked/file.txt')).toBeNull();
  });

  it('correctly extracts classId from valid storage file paths', () => {
    const extractClassId = (filePath) => {
      const parts = filePath.split('/');
      if (parts.length < 3) return null;
      return parts[1];
    };

    expect(extractClassId('screenshots/CLASS_IT114115/s1/img.jpg')).toBe('CLASS_IT114115');
    expect(extractClassId('audio/CLASS_MATH101/s2/rec.webm')).toBe('CLASS_MATH101');
    expect(extractClassId('root_file.jpg')).toBeNull();
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
});
