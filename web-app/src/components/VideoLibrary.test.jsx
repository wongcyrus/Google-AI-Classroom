import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VideoLibrary from './VideoLibrary';

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

describe('VideoLibrary Full Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
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

    const promptInput = screen.getByPlaceholderText(/Select a prompt or enter text here/i);
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
});

