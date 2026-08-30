import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VideoLibrary from './VideoLibrary';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockSetDoc = vi.fn().mockResolvedValue();
const mockGetDocs = vi.fn();

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

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/video.mp4'),
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
];

let mockUsePaginatedQueryReturn = {
  data: mockVideos,
  loading: false,
  isLastPage: true,
  fetchNextPage: vi.fn(),
};

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => mockUsePaginatedQueryReturn,
}));

describe('VideoLibrary Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('renders video table and allows requesting ZIP for selected video', async () => {
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

    // Select video row checkbox
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // Row checkbox

    const zipSelectedBtn = screen.getByText(/Request Selected as ZIP \(1\)/i);
    await act(async () => {
      fireEvent.click(zipSelectedBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('ZIP request'));
    });
  });

  it('opens prompt selection modal and submits analysis job', async () => {
    render(
      <VideoLibrary
        user={{ uid: 'teacher_1' }}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    // Select video
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    // Open modal
    const openPromptBtn = screen.getByText('Select Video Prompt');
    fireEvent.click(openPromptBtn);

    expect(screen.getByRole('heading', { name: /Select Video Prompt/i })).toBeInTheDocument();

    // Fill prompt text
    const promptInput = screen.getByPlaceholderText(/Select a prompt or enter text here/i);
    fireEvent.change(promptInput, { target: { value: 'Look for academic dishonesty' } });

    // Request analysis for selected
    const submitAnalysisBtn = screen.getByText(/Request Analysis for Selected \(1\)/i);
    await act(async () => {
      fireEvent.click(submitAnalysisBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('analysis request'));
    });
  });
});
