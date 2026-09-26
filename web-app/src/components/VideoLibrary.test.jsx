import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VideoLibrary, { getSafeVideoFilename } from './VideoLibrary';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockSetDoc = vi.fn().mockResolvedValue();
const mockGetDocs = vi.fn().mockResolvedValue({
  docs: [
    {
      id: 'vid_1',
      data: () => ({
        videoPath: 'videos/vid1.mp4',
        classId: 'CLASS_1',
        studentUid: 's1',
        studentEmail: 'student1@example.com',
        startTime: new Date('2026-08-30T00:00:00Z'),
      }),
    },
  ],
  empty: false,
});

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ id: 'mock-zip-job' })),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => ({}) }),
  getDocs: (...args) => mockGetDocs(...args),
  setDoc: (...args) => mockSetDoc(...args),
  onSnapshot: vi.fn(() => vi.fn()),
  serverTimestamp: vi.fn(),
}));

const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.local/video.mp4');

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn(),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const mockVideos = [
  {
    id: 'vid_1',
    classId: 'CLASS_1',
    studentUid: 's1',
    studentEmail: 'student1@example.com',
    videoPath: 'videos/vid1.mp4',
    status: 'completed',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    createdAt: { toDate: () => new Date('2026-08-30T00:30:00Z') },
  },
  {
    id: 'vid_2',
    classId: 'CLASS_1',
    studentUid: 's2',
    studentEmail: 'student2@example.com',
    videoPath: 'videos/vid2.mp4',
    status: 'completed',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    createdAt: { toDate: () => new Date('2026-08-30T00:35:00Z') },
  },
];

const mockFetchNextPage = vi.fn();
let mockUsePaginatedQueryReturn = {
  data: mockVideos,
  loading: false,
  isLastPage: false,
  fetchNextPage: mockFetchNextPage,
};

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => mockUsePaginatedQueryReturn,
}));

vi.mock('../hooks/useVideoPrompts', () => ({
  useVideoPrompts: () => [
    { id: 'p1', name: 'Engagement Prompt', promptText: 'Check student engagement', accessLevel: 'public', category: 'videos' },
  ],
}));

const mockConnectGdrive = vi.fn().mockResolvedValue(true);
let mockBaseFolderName = 'Classroom Archives';
const mockSetBaseFolderName = vi.fn((val) => { mockBaseFolderName = val; });
const mockBackupStudentVideosToDrive = vi.fn().mockImplementation(async ({ videos, onBatchProgress }) => {
  if (onBatchProgress && videos && videos.length > 0) {
    onBatchProgress({ index: 0, total: videos.length, currentVideo: videos[0], percentage: 100, status: 'success' });
  }
  return { successCount: videos?.length || 0, failedCount: 0 };
});
let mockGdriveConnected = true;
let mockGdriveConnecting = false;

vi.mock('../hooks/useGoogleDrive', () => ({
  useGoogleDrive: () => ({
    isConfigured: true,
    isConnected: mockGdriveConnected,
    isConnecting: mockGdriveConnecting,
    connectedUser: { email: 'teacher@vtc.edu.hk', name: 'Teacher' },
    baseFolderName: mockBaseFolderName,
    setBaseFolderName: mockSetBaseFolderName,
    connect: mockConnectGdrive,
    disconnect: vi.fn(),
    backupStudentVideosToDrive: mockBackupStudentVideosToDrive,
  }),
}));

describe('VideoLibrary Full Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGdriveConnected = true;
    mockGdriveConnecting = false;
    mockBaseFolderName = 'Classroom Archives';
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
    mockUsePaginatedQueryReturn = {
      data: mockVideos,
      loading: false,
      isLastPage: false,
      fetchNextPage: mockFetchNextPage,
    };
  });

  it('renders video table, selects all, and requests ZIP for all range', async () => {
    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    expect(screen.getByText(/Video Library/i)).toBeInTheDocument();
    expect(screen.getByText('student1@example.com')).toBeInTheDocument();
    expect(screen.getByText('student2@example.com')).toBeInTheDocument();

    // Select All
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(selectAllCheckbox);

    // Request All as ZIP
    const zipAllBtn = screen.getByRole('button', { name: /Request All as ZIP/i });
    await act(async () => {
      fireEvent.click(zipAllBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('handles selecting single video and requesting zip for selected', async () => {
    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // select first video

    const zipSelectedBtn = screen.getByRole('button', { name: /Request Selected as ZIP \(1\)/i });
    await act(async () => {
      fireEvent.click(zipSelectedBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('handles requesting AI analysis modal and submitting job', async () => {
    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    const selectPromptBtn = screen.getByRole('button', { name: /Select Video Prompt/i });
    fireEvent.click(selectPromptBtn);

    const promptSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(promptSelect, { target: { value: 'p1' } });

    const promptInput = screen.getByPlaceholderText(/Select a prompt or enter text here/i);
    expect(promptInput.value).toBe('Check student engagement');
    fireEvent.change(promptInput, { target: { value: 'Analyze student attentiveness' } });

    const analyzeSelectedBtn = screen.getByRole('button', { name: /Request Analysis for Selected/i });
    await act(async () => {
      fireEvent.click(analyzeSelectedBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('handles playing video via modal and pagination load more', async () => {
    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    // Play video button (▶️)
    const playButtons = screen.getAllByText('▶️');
    await act(async () => {
      fireEvent.click(playButtons[0]);
    });

    await waitFor(() => {
      expect(mockGetDownloadURL).toHaveBeenCalled();
    });

    // Pagination Next
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it('handles downloading video directly and requesting analysis for whole class', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(['video-bytes'], { type: 'video/mp4' })),
    });
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();

    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    // Download single video
    const downloadBtns = screen.getAllByRole('button', { name: /Download/i });
    if (downloadBtns.length > 0) {
      await act(async () => {
        fireEvent.click(downloadBtns[0]);
      });
      expect(mockGetDownloadURL).toHaveBeenCalled();
    }

    // Request analysis for whole class
    const selectPromptBtn = screen.getByRole('button', { name: /Select Video Prompt/i });
    fireEvent.click(selectPromptBtn);

    const promptInput = screen.getByPlaceholderText(/Select a prompt or enter text here/i);
    fireEvent.change(promptInput, { target: { value: 'Full class analysis' } });

    const modelSelect = screen.getByDisplayValue(/Gemini 3.5 Flash-Lite/i);
    fireEvent.change(modelSelect, { target: { value: 'gemini-3.7-flash' } });

    const wholeClassBtn = screen.getByRole('button', { name: /Request Analysis for the whole class/i });
    await act(async () => {
      fireEvent.click(wholeClassBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('handles playback failure gracefully and allows closing prompt modal', async () => {
    mockGetDownloadURL.mockRejectedValueOnce(new Error('Storage file not found'));

    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    const playBtns = screen.getAllByRole('button', { name: '▶️' });
    if (playBtns.length > 0) {
      await act(async () => {
        fireEvent.click(playBtns[0]);
      });
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to get video for playback'));
    }

    const selectPromptBtn = screen.getByRole('button', { name: /Select Video Prompt/i });
    fireEvent.click(selectPromptBtn);

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(screen.queryByPlaceholderText(/Select a prompt or enter text here/i)).not.toBeInTheDocument();
  });

  it('handles exporting video manifest as Excel', async () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-manifest');

    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    const exportBtn = screen.getByRole('button', { name: /Export Video Manifest/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });

    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
    });
    window.URL.createObjectURL = originalCreateObjectURL;
  });

  it('alerts when exporting manifest with no videos', () => {
    mockUsePaginatedQueryReturn = {
      data: [],
      loading: false,
      isLastPage: true,
      fetchNextPage: vi.fn(),
    };

    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    const exportBtn = screen.getByRole('button', { name: /Export Video Manifest/i });
    expect(exportBtn).toBeDisabled();
  });

  describe('getSafeVideoFilename', () => {
    it('handles Timestamp objects properly', () => {
      const video = {
        classId: 'IT114115',
        studentEmail: 'test.user@vtc.edu.hk',
        startTime: { toDate: () => new Date('2026-09-18T14:30:00.000Z') },
      };
      expect(getSafeVideoFilename(video)).toBe('IT114115_test_user_vtc_edu_hk_2026-09-18_14-30-00.mp4');
    });

    it('handles Date instances and fallback studentUid and classId', () => {
      const video = {
        studentUid: 'uid123',
        startTime: new Date('2026-09-18T10:15:30.000Z'),
      };
      expect(getSafeVideoFilename(video, 'FALLBACK_CLASS')).toBe('FALLBACK_CLASS_uid123_2026-09-18_10-15-30.mp4');
    });

    it('handles invalid or null dates gracefully', () => {
      const video = {
        startTime: null,
      };
      expect(getSafeVideoFilename(video)).toBe('class_student_unknown_time.mp4');
    });
  });

  describe('handleDownload', () => {
    it('downloads video via blob when fetch succeeds', async () => {
      const originalCreateObjectURL = window.URL.createObjectURL;
      const originalRevokeObjectURL = window.URL.revokeObjectURL;
      window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-video');
      window.URL.revokeObjectURL = vi.fn();

      const mockBlob = new Blob(['dummy content'], { type: 'video/mp4' });
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: vi.fn().mockResolvedValue(mockBlob),
      });

      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      const downloadBtns = screen.getAllByRole('button', { name: /Download/i });
      await act(async () => {
        fireEvent.click(downloadBtns[0]);
      });

      expect(global.fetch).toHaveBeenCalledWith('https://storage.local/video.mp4');
      expect(window.URL.createObjectURL).toHaveBeenCalledWith(mockBlob);

      window.URL.createObjectURL = originalCreateObjectURL;
      window.URL.revokeObjectURL = originalRevokeObjectURL;
    });

    it('gracefully falls back to direct URL download if blob fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const appendSpy = vi.spyOn(document.body, 'appendChild');

      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      const downloadBtns = screen.getAllByRole('button', { name: /Download/i });
      await act(async () => {
        fireEvent.click(downloadBtns[0]);
      });

      expect(global.fetch).toHaveBeenCalled();
      expect(window.alert).not.toHaveBeenCalledWith(expect.stringContaining('Failed to download video'));
      expect(appendSpy).toHaveBeenCalled();
    });
  });

  describe('Google Drive Integration and Backup Workflows', () => {
    it('renders connect Google Drive button when disconnected and triggers connect on click', async () => {
      mockGdriveConnected = false;

      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      const connectBtn = screen.getByRole('button', { name: /Connect Google Drive/i });
      expect(connectBtn).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(connectBtn);
      });

      expect(mockConnectGdrive).toHaveBeenCalledTimes(1);
    });

    it('allows editing base folder name and saving draft', async () => {
      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      expect(screen.getByText('Classroom Archives')).toBeInTheDocument();

      // Click Edit Base Folder
      const editBtn = screen.getByRole('button', { name: /Edit Base Folder/i });
      fireEvent.click(editBtn);

      // Input appears
      const input = screen.getByPlaceholderText(/e\.g\. Classroom Archives/i);
      expect(input).toBeInTheDocument();
      fireEvent.change(input, { target: { value: 'Semester 1 Backup' } });

      // Save
      const saveBtn = screen.getByRole('button', { name: 'Save' });
      fireEvent.click(saveBtn);

      expect(mockSetBaseFolderName).toHaveBeenCalledWith('Semester 1 Backup');
    });

    it('allows canceling base folder editing without saving changes', () => {
      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      const editBtn = screen.getByRole('button', { name: /Edit Base Folder/i });
      fireEvent.click(editBtn);

      const input = screen.getByPlaceholderText(/e\.g\. Classroom Archives/i);
      fireEvent.change(input, { target: { value: 'Discarded Name' } });

      const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
      fireEvent.click(cancelBtn);

      expect(screen.getByText('Classroom Archives')).toBeInTheDocument();
      expect(screen.queryByText('Discarded Name')).not.toBeInTheDocument();
    });

    it('backs up selected videos to Google Drive and updates progress modal', async () => {
      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      // Select first video
      const checkboxes = screen.getAllByRole('checkbox');
      fireEvent.click(checkboxes[1]);

      const backupBtn = screen.getByRole('button', { name: /Backup Selected to Drive \(1\)/i });
      await act(async () => {
        fireEvent.click(backupBtn);
      });

      await waitFor(() => {
        expect(mockBackupStudentVideosToDrive).toHaveBeenCalled();
      });
    });

    it('backs up all class videos to Google Drive when requested', async () => {
      render(
        <VideoLibrary
          user={{ uid: 'teacher_1' }}
          classId="CLASS_1"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T01:00:00Z"
          filterField="startTime"
        />
      );

      const backupAllBtn = screen.getByRole('button', { name: /Backup All Class Videos to Drive/i });
      await act(async () => {
        fireEvent.click(backupAllBtn);
      });

      await waitFor(() => {
        expect(mockBackupStudentVideosToDrive).toHaveBeenCalled();
      });
    });
  });
});

