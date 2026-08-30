import { describe, it, expect } from 'vitest';

describe('Storage Quota Calculations (functions/storage_triggers/storageQuota.js)', () => {
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
});
