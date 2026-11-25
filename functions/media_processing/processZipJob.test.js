import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';

const { mockDownload, mockBucketUpload, mockMailsAdd, mockGetUser, mockRmSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockDownload: vi.fn(),
  mockBucketUpload: vi.fn(),
  mockMailsAdd: vi.fn(),
  mockGetUser: vi.fn(),
  mockRmSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({ ZIP_COMPRESSION_LEVEL: 6, FUNCTION_REGION: 'asia-east2' }));
vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => handler),
}));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: vi.fn((name) => (name === 'mails' ? { add: mockMailsAdd } : {})),
  })),
}));
vi.mock('firebase-admin/storage', () => ({
  getStorage: vi.fn(() => ({
    bucket: vi.fn(() => ({
      file: vi.fn(() => ({ download: mockDownload })),
      upload: mockBucketUpload,
    })),
  })),
}));
vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({ getUser: mockGetUser })),
}));
vi.mock('csv-stringify/sync', () => ({
  stringify: vi.fn(() => 'csv-header\nrow1'),
}));

let fakeStreamCloseCb = null;
vi.mock('archiver', () => ({
  default: vi.fn(() => ({
    on: vi.fn(),
    pipe: vi.fn(),
    directory: vi.fn(),
    finalize: vi.fn(async () => {
      if (fakeStreamCloseCb) fakeStreamCloseCb();
    }),
  })),
}));

vi.mock('fs', () => {
  const createWriteStream = vi.fn(() => ({
    on: vi.fn((evt, cb) => {
      if (evt === 'close') fakeStreamCloseCb = cb;
    }),
  }));
  const mockFs = {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: mockRmSync,
    unlinkSync: mockUnlinkSync,
    createWriteStream,
  };
  return { default: mockFs, ...mockFs };
});

import { processZipJob } from './processZipJob.js';

describe('processZipJob Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStreamCloseCb = null;
    mockDownload.mockResolvedValue();
    mockBucketUpload.mockResolvedValue();
    mockMailsAdd.mockResolvedValue({ id: 'mail_1' });
    mockGetUser.mockResolvedValue({ email: 'teacher@vtc.edu.hk' });
  });

  it('aborts idempotently when status is already processing or completed', async () => {
    const updateMock = vi.fn();
    await processZipJob({
      params: { jobId: 'zip_done' },
      data: {
        ref: { update: updateMock },
        data: () => ({ status: 'completed', videos: [{ path: 'v.mp4' }], requester: 't1', classId: 'c1' }),
      },
    });

    expect(updateMock).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('marks job failed cleanly when videos array is empty', async () => {
    const updateMock = vi.fn().mockResolvedValue();
    await processZipJob({
      params: { jobId: 'zip_empty' },
      data: {
        ref: { update: updateMock },
        data: () => ({ status: 'pending', videos: [], requester: 't1', classId: 'c1' }),
      },
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'No videos supplied for archive.' })
    );
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it('handles Firestore {seconds} startTime objects and uploads zip without crashing', async () => {
    const updateMock = vi.fn().mockResolvedValue();
    await processZipJob({
      params: { jobId: 'zip_sec_ts' },
      data: {
        ref: { update: updateMock },
        data: () => ({
          status: 'pending',
          requester: 't1',
          classId: 'CLASS_1',
          videos: [
            {
              path: 'videos/CLASS_1/s1/clip.mp4',
              studentEmail: 's1@stu.vtc.edu.hk',
              startTime: { seconds: 1756540800 },
            },
          ],
        }),
      },
    });

    expect(mockDownload).toHaveBeenCalledTimes(1);
    expect(mockBucketUpload).toHaveBeenCalledWith(
      expect.stringContaining('zip_sec_ts.zip'),
      expect.objectContaining({ destination: 'zips/CLASS_1/zip_sec_ts.zip' })
    );
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
    expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('zip_sec_ts'), { recursive: true, force: true });
    expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('zip_sec_ts.zip'));
  });

  it('cleans up temporary directory in finally even when download fails', async () => {
    const updateMock = vi.fn().mockResolvedValue();
    mockDownload.mockRejectedValueOnce(new Error('Storage read failed'));

    await processZipJob({
      params: { jobId: 'zip_err_cleanup' },
      data: {
        ref: { update: updateMock },
        data: () => ({
          status: 'pending',
          requester: 't1',
          classId: 'CLASS_1',
          videos: [{ path: 'videos/CLASS_1/s1/missing.mp4', startTime: new Date().toISOString() }],
        }),
      },
    });

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed', error: 'Storage read failed' })
    );
    expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining('zip_err_cleanup'), { recursive: true, force: true });
  });
});
