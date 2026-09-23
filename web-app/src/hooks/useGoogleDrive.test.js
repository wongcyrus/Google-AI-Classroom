import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGoogleDrive } from './useGoogleDrive';
import * as gdriveService from '../utils/googleDriveService';

const mockUpdateDoc = vi.fn().mockResolvedValue();

const mockSetDoc = vi.fn().mockResolvedValue();

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...pathSegments) => ({ path: pathSegments.join('/') })),
  updateDoc: (...args) => mockUpdateDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn((storage, path) => ({ path })),
  getDownloadURL: vi.fn().mockResolvedValue('https://download.url/task_video.mp4'),
}));

vi.mock('../utils/googleDriveService', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    requestGoogleDriveToken: vi.fn(),
    fetchGoogleUserInfo: vi.fn(),
    uploadVideoToGoogleDrive: vi.fn(),
  };
});

describe('useGoogleDrive Hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it('initializes with disconnected state', () => {
    const { result } = renderHook(() => useGoogleDrive());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectedUser).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('identifies unconfigured state when no client ID key is present', async () => {
    const originalClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    import.meta.env.VITE_GOOGLE_CLIENT_ID = '';
    try {
      const { result } = renderHook(() => useGoogleDrive());
      expect(result.current.isConfigured).toBe(false);
      let success;
      await act(async () => {
        success = await result.current.connect();
      });
      expect(success).toBe(false);
      expect(result.current.error).toBe('Google Drive cloud integration is not configured.');
    } finally {
      import.meta.env.VITE_GOOGLE_CLIENT_ID = originalClientId;
    }
  });

  it('connects to Google Drive successfully and stores user profile', async () => {
    vi.mocked(gdriveService.requestGoogleDriveToken).mockResolvedValue({
      access_token: 'valid_access_token_123',
      expires_in: 3600,
      scope: 'drive.file',
    });
    vi.mocked(gdriveService.fetchGoogleUserInfo).mockResolvedValue({
      email: 'teacher@gmail.com',
      name: 'Teacher Alice',
      picture: 'https://pic.url/photo.jpg',
    });

    const { result } = renderHook(() => useGoogleDrive());

    let success;
    await act(async () => {
      success = await result.current.connect('test-client-id.apps.googleusercontent.com');
    });

    expect(success).toBe(true);
    expect(result.current.isConnected).toBe(true);
    expect(result.current.accessToken).toBe('valid_access_token_123');
    expect(result.current.connectedUser).toEqual({
      email: 'teacher@gmail.com',
      name: 'Teacher Alice',
      picture: 'https://pic.url/photo.jpg',
    });
  });

  it('disconnects and clears state and storage', async () => {
    vi.mocked(gdriveService.requestGoogleDriveToken).mockResolvedValue({
      access_token: 'token_to_clear',
      expires_in: 3600,
    });
    vi.mocked(gdriveService.fetchGoogleUserInfo).mockResolvedValue({
      email: 'teacher@gmail.com',
      name: 'Teacher Alice',
    });

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.connect('test-id');
    });
    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.accessToken).toBeNull();
    expect(result.current.connectedUser).toBeNull();
    expect(sessionStorage.getItem('classroom_gdrive_access_token')).toBeNull();
  });

  it('uploads recording and updates Firestore document', async () => {
    vi.mocked(gdriveService.requestGoogleDriveToken).mockResolvedValue({
      access_token: 'upload_token',
    });
    vi.mocked(gdriveService.fetchGoogleUserInfo).mockResolvedValue({
      email: 'teacher@gmail.com',
    });
    vi.mocked(gdriveService.uploadVideoToGoogleDrive).mockResolvedValue({
      fileId: 'uploaded_file_999',
      name: 'test_class_Lecture_rec_1.webm',
      webViewLink: 'https://drive.google.com/file/d/uploaded_file_999/view',
      embedUrl: 'https://drive.google.com/file/d/uploaded_file_999/preview',
    });

    // Mock global fetch for fetching the video blob
    const mockBlob = new Blob(['video-data'], { type: 'video/webm' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => mockBlob,
    });

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.connect('client-id');
    });

    const mockRecording = {
      id: 'rec_1',
      title: 'Robotics 101',
      videoUrl: 'https://storage.googleapis.com/bucket/video.webm',
      mimeType: 'video/webm',
    };

    let uploadRes;
    await act(async () => {
      uploadRes = await result.current.uploadRecording({
        recording: mockRecording,
        classId: 'class_ai',
      });
    });

    expect(uploadRes).toBeTruthy();
    expect(uploadRes.fileId).toBe('uploaded_file_999');
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/class_ai/lectureRecordings/rec_1' }),
      expect.objectContaining({
        driveFileId: 'uploaded_file_999',
        driveEmbedUrl: 'https://drive.google.com/file/d/uploaded_file_999/preview',
      })
    );
  });

  it('manually links a Google Drive video with valid ID/URL', async () => {
    const { result } = renderHook(() => useGoogleDrive());

    let linked;
    await act(async () => {
      linked = await result.current.linkManualDrive({
        recordingId: 'rec_manual_1',
        classId: 'class_ai',
        driveUrlOrId: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/view',
      });
    });

    expect(linked).toBe(true);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/class_ai/lectureRecordings/rec_manual_1' }),
      expect.objectContaining({
        driveFileId: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08',
        driveEmbedUrl: 'https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OIvE2up08/preview',
      })
    );
  });

  it('unlinks a Google Drive video', async () => {
    const { result } = renderHook(() => useGoogleDrive());

    let unlinked;
    await act(async () => {
      unlinked = await result.current.unlinkRecording({
        recordingId: 'rec_to_unlink',
        classId: 'class_ai',
      });
    });

    expect(unlinked).toBe(true);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/class_ai/lectureRecordings/rec_to_unlink' }),
      expect.objectContaining({
        driveFileId: null,
        driveEmbedUrl: null,
      })
    );
  });

  it('manages and persists custom baseFolderName in localStorage', () => {
    const { result } = renderHook(() => useGoogleDrive());
    expect(result.current.baseFolderName).toBe('Classroom Archives');

    act(() => {
      result.current.setBaseFolderName('Spring2026-CS101');
    });

    expect(result.current.baseFolderName).toBe('Spring2026-CS101');
    expect(localStorage.getItem('classroom_gdrive_base_folder')).toBe('Spring2026-CS101');
  });

  it('backs up student videos in batch to Google Drive with onBatchProgress', async () => {
    vi.mocked(gdriveService.requestGoogleDriveToken).mockResolvedValue({
      access_token: 'valid_access_token_123',
      expires_in: 3600,
      scope: 'drive.file',
    });
    vi.mocked(gdriveService.uploadVideoToGoogleDrive).mockResolvedValue({
      fileId: 'student_drive_1',
      webViewLink: 'https://drive.google.com/file/d/student_drive_1/view',
      embedUrl: 'https://drive.google.com/file/d/student_drive_1/preview',
    });

    // Mock global fetch for fetching video blob
    const mockBlob = new Blob(['student-screencast'], { type: 'video/webm' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => mockBlob,
    });

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.connect('test-client-id');
    });

    const mockVideos = [
      {
        id: 'job_1',
        studentEmail: 'stu1@example.com',
        videoUrl: 'https://download.url/video1.webm',
        lessonName: 'Lab 1',
      },
      {
        id: 'job_2',
        studentEmail: 'stu2@example.com',
        videoUrl: 'https://download.url/video2.webm',
        lessonName: 'Lab 1',
      },
    ];

    const onBatchProgress = vi.fn();

    let backupSummary;
    await act(async () => {
      backupSummary = await result.current.backupStudentVideosToDrive({
        videos: mockVideos,
        classId: 'class_it114115',
        onBatchProgress,
      });
    });

    expect(backupSummary.successCount).toBe(2);
    expect(backupSummary.failedCount).toBe(0);
    expect(onBatchProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
      })
    );
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'videoJobs/job_1' }),
      expect.objectContaining({
        driveFileId: 'student_drive_1',
        driveWebViewLink: 'https://drive.google.com/file/d/student_drive_1/view',
      })
    );
  });

  it('backs up student task submission videos to Google Drive', async () => {
    vi.mocked(gdriveService.requestGoogleDriveToken).mockResolvedValue({
      access_token: 'valid_access_token_123',
    });
    vi.mocked(gdriveService.fetchGoogleUserInfo).mockResolvedValue({
      email: 'teacher@gmail.com',
      name: 'Teacher Alice',
    });
    vi.mocked(gdriveService.uploadVideoToGoogleDrive).mockResolvedValue({
      fileId: 'task_drive_file_99',
      webViewLink: 'https://drive.google.com/file/d/task_drive_file_99/view',
      embedUrl: 'https://drive.google.com/file/d/task_drive_file_99/preview',
    });

    const mockBlob = new Blob(['task-video'], { type: 'video/mp4' });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => mockBlob,
    });

    const { result } = renderHook(() => useGoogleDrive());

    await act(async () => {
      await result.current.connect('test-client-id');
    });

    const task = { id: 'task_docker', title: 'Task 1 - Docker' };
    const mockSubmissions = [
      {
        studentUid: 'stu_100',
        email: 'stu100@example.com',
        compiledVideoPath: 'classes/class_abc/tasks/task_docker/submissions/stu_100/attempt_1.mp4',
        latestAttempt: { attemptNumber: 1 },
      },
    ];

    const onBatchProgress = vi.fn();

    let backupSummary;
    await act(async () => {
      backupSummary = await result.current.backupTaskVideosToDrive({
        classId: 'class_abc',
        className: 'DevOps Class',
        task,
        submissions: mockSubmissions,
        onBatchProgress,
      });
    });

    expect(backupSummary.successCount).toBe(1);
    expect(backupSummary.failedCount).toBe(0);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/class_abc/tasks/task_docker/submissions/stu_100' }),
      expect.objectContaining({
        driveFileId: 'task_drive_file_99',
        driveWebViewLink: 'https://drive.google.com/file/d/task_drive_file_99/view',
      })
    );
  });
});
