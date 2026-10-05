import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hasEbmlIndexHeaders,
  handleLectureVideoFinalized,
} from './onLectureVideoFinalized.js';
import fs from 'fs';

describe('onLectureVideoFinalized Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasEbmlIndexHeaders', () => {
    it('returns true when SeekHead, Cues, and Duration byte sequences are present', () => {
      const buffer = Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), // EBML header
        Buffer.from([0x11, 0x4d, 0x9b, 0x74]), // SeekHead
        Buffer.from([0x44, 0x89]),             // Duration
        Buffer.from([0x1c, 0x53, 0xbb, 0x6b]), // Cues
      ]);
      expect(hasEbmlIndexHeaders(buffer)).toBe(true);
    });

    it('returns false when Cues index is missing', () => {
      const buffer = Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.from([0x11, 0x4d, 0x9b, 0x74]), // SeekHead
        Buffer.from([0x44, 0x89]),             // Duration
      ]);
      expect(hasEbmlIndexHeaders(buffer)).toBe(false);
    });

    it('returns false when buffer is empty or null', () => {
      expect(hasEbmlIndexHeaders(null)).toBe(false);
      expect(hasEbmlIndexHeaders(undefined)).toBe(false);
      expect(hasEbmlIndexHeaders(Buffer.alloc(0))).toBe(false);
    });
  });

  describe('handleLectureVideoFinalized', () => {
    it('skips when file path is missing or empty', async () => {
      const res = await handleLectureVideoFinalized({ data: { name: '' } });
      expect(res.status).toBe('skipped');
      expect(res.reason).toBe('empty_file_path');
    });

    it('skips non-lecture files (e.g. screenshots or audio tracks)', async () => {
      const res1 = await handleLectureVideoFinalized({ data: { name: 'screenshots/c1/s1.jpg' } });
      expect(res1.status).toBe('skipped');
      expect(res1.reason).toBe('not_a_lecture_webm');

      const res2 = await handleLectureVideoFinalized({
        data: { name: 'recordings/c1/s1/lecture_audio.webm' },
      });
      expect(res2.status).toBe('skipped');
      expect(res2.reason).toBe('not_a_lecture_webm');
    });

    it('skips immediately if hasCuesIndex is already true in event metadata (infinite loop prevention)', async () => {
      const res = await handleLectureVideoFinalized({
        data: {
          name: 'recordings/c1/s1/lecture.webm',
          metadata: { hasCuesIndex: 'true' },
        },
      });
      expect(res.status).toBe('skipped');
      expect(res.reason).toBe('already_indexed_metadata');
    });

    it('skips if file does not exist in bucket', async () => {
      const mockBucket = {
        file: vi.fn().mockReturnValue({
          exists: vi.fn().mockResolvedValue([false]),
        }),
      };
      const mockStorage = {
        bucket: vi.fn().mockReturnValue(mockBucket),
      };

      const res = await handleLectureVideoFinalized(
        { data: { name: 'recordings/c1/s1/lecture.webm' } },
        { storage: mockStorage }
      );
      expect(res.status).toBe('skipped');
      expect(res.reason).toBe('file_not_found');
    });

    it('tags metadata and skips re-muxing if file already has EBML SeekHead + Cues in container', async () => {
      const indexedHeader = Buffer.concat([
        Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
        Buffer.from([0x11, 0x4d, 0x9b, 0x74]), // SeekHead
        Buffer.from([0x1c, 0x53, 0xbb, 0x6b]), // Cues
        Buffer.from([0x44, 0x89]),             // Duration
      ]);

      const mockSetMetadata = vi.fn().mockResolvedValue([]);
      const mockFile = {
        exists: vi.fn().mockResolvedValue([true]),
        getMetadata: vi.fn().mockResolvedValue([{ metadata: {} }]),
        download: vi.fn().mockResolvedValue([indexedHeader]),
        setMetadata: mockSetMetadata,
      };
      const mockBucket = {
        file: vi.fn().mockReturnValue(mockFile),
      };
      const mockStorage = {
        bucket: vi.fn().mockReturnValue(mockBucket),
      };

      const mockDocUpdate = vi.fn().mockResolvedValue({});
      const mockDb = {
        doc: vi.fn().mockReturnValue({ update: mockDocUpdate }),
      };

      const res = await handleLectureVideoFinalized(
        { data: { name: 'recordings/c1/s1/lecture.webm' } },
        { storage: mockStorage, db: mockDb }
      );

      expect(res.status).toBe('already_indexed_ebml');
      expect(mockSetMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ hasCuesIndex: 'true' }),
        })
      );
      expect(mockDocUpdate).toHaveBeenCalledWith({ hasCuesIndex: true });
    });

    it('successfully remuxes unindexed WebM, probes duration, uploads with hasCuesIndex, and updates Firestore', async () => {
      const unindexedHeader = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00]);

      let downloadedDestination = null;
      const mockFile = {
        exists: vi.fn().mockResolvedValue([true]),
        getMetadata: vi.fn().mockResolvedValue([
          {
            metadata: {
              firebaseStorageDownloadTokens: 'existing-token-123',
              classId: 'c1',
              sessionId: 's1',
            },
          },
        ]),
        download: vi.fn().mockImplementation(({ start, end, destination }) => {
          if (typeof start === 'number') {
            return Promise.resolve([unindexedHeader]);
          }
          downloadedDestination = destination;
          fs.writeFileSync(destination, 'dummy-video-content');
          return Promise.resolve();
        }),
      };

      const mockUpload = vi.fn().mockImplementation((srcPath) => {
        expect(fs.existsSync(srcPath)).toBe(true);
        return Promise.resolve();
      });

      const mockBucket = {
        file: vi.fn().mockReturnValue(mockFile),
        upload: mockUpload,
      };
      const mockStorage = {
        bucket: vi.fn().mockReturnValue(mockBucket),
      };

      const mockDocUpdate = vi.fn().mockResolvedValue({});
      const mockDb = {
        doc: vi.fn().mockReturnValue({ update: mockDocUpdate }),
      };

      const mockFfmpegRunner = vi.fn().mockImplementation((input, output) => {
        fs.writeFileSync(output, 'indexed-webm-content-with-cues');
        return Promise.resolve();
      });

      const mockDurationProber = vi.fn().mockResolvedValue(2211.46);

      const res = await handleLectureVideoFinalized(
        {
          data: {
            name: 'recordings/c1/s1/lecture.webm',
            bucket: 'test-bucket.appspot.com',
          },
        },
        {
          storage: mockStorage,
          db: mockDb,
          ffmpegRunner: mockFfmpegRunner,
          durationProber: mockDurationProber,
        }
      );

      expect(res.status).toBe('indexed');
      expect(res.durationSec).toBe(2211.46);
      expect(mockFfmpegRunner).toHaveBeenCalled();
      expect(mockUpload).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          destination: 'recordings/c1/s1/lecture.webm',
          metadata: expect.objectContaining({
            metadata: expect.objectContaining({
              hasCuesIndex: 'true',
              durationSeconds: '2211',
              firebaseStorageDownloadTokens: 'existing-token-123',
            }),
          }),
        })
      );
      expect(mockDocUpdate).toHaveBeenCalledWith({
        hasCuesIndex: true,
        durationSeconds: 2211,
      });
    });
  });
});
