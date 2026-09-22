import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import PlaybackView from './PlaybackView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue();
const mockGetDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ id: 'mock-job-id' })),
  getDoc: (...args) => mockGetDoc(...args),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  setDoc: (...args) => mockSetDoc(...args),
  serverTimestamp: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/screenshot.jpg'),
}));

describe('PlaybackView Component', () => {
  const mockSessionData = {
    studentUid: 'student_1',
    studentEmail: 'student@example.com',
    start: '2026-08-30T00:00:00Z',
    end: '2026-08-30T01:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads screenshot timeline, allows playback controls, and channel switching', async () => {
    const mockScreenshots = [
      {
        id: 's1',
        channel: 'screen',
        imagePath: 'screenshots/s1.jpg',
        timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') },
      },
      {
        id: 's2',
        channel: 'webcam',
        imagePath: 'screenshots/s2.jpg',
        timestamp: { toDate: () => new Date('2026-08-30T00:00:20Z') },
      },
    ];

    mockGetDocs.mockResolvedValueOnce({
      docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
    });

    const onBack = vi.fn();

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={onBack}
      />
    );

    expect(screen.getByText(/Playback for: student@example.com/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/Frame: 1 \/ 2/i)).toBeInTheDocument();
    });

    // Navigation buttons: Next, Last, First, Prev
    const nextBtn = screen.getByText('Next');
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Frame: 2 \/ 2/i)).toBeInTheDocument();

    const prevBtn = screen.getByText('Prev');
    fireEvent.click(prevBtn);
    expect(screen.getByText(/Frame: 1 \/ 2/i)).toBeInTheDocument();

    const lastBtn = screen.getByText('Last');
    fireEvent.click(lastBtn);
    expect(screen.getByText(/Frame: 2 \/ 2/i)).toBeInTheDocument();

    const firstBtn = screen.getByText('First');
    fireEvent.click(firstBtn);
    expect(screen.getByText(/Frame: 1 \/ 2/i)).toBeInTheDocument();

    // Play / Pause toggle
    const playBtn = screen.getByText('Play');
    fireEvent.click(playBtn);
    expect(screen.getByText('Pause')).toBeInTheDocument();

    // TimelineSlider onChange
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '1' } });
    expect(screen.getByText(/Frame: 2 \/ 2/i)).toBeInTheDocument();

    // Speed select onChange
    const speedSelect = screen.getByDisplayValue('1x');
    fireEvent.change(speedSelect, { target: { value: '2' } });
    expect(screen.getByDisplayValue('2x')).toBeInTheDocument();

    // Channel filter switch
    const channelSelect = screen.getByDisplayValue('All Channels');
    fireEvent.change(channelSelect, { target: { value: 'screen' } });
    expect(screen.getByText(/Frame: 1 \/ 1/i)).toBeInTheDocument();

    // Back to Selection
    const backBtn = screen.getByText('Back to Selection');
    fireEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();
  });

  it('triggers video concatenation job creation', async () => {
    mockGetDocs
      .mockResolvedValueOnce({
        docs: [
          {
            id: 's1',
            data: () => ({
              channel: 'screen',
              imagePath: 'screenshots/s1.jpg',
              timestamp: { toDate: () => new Date() },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({ empty: true }); // No existing job

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Frame: 1 \/ 1/i)).toBeInTheDocument();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('allows changing speed and slider position, and displays empty state message', async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No screenshots found for the selected channel and time range/i)).toBeInTheDocument();
    });

    const speedSelect = screen.getByDisplayValue('1x');
    fireEvent.change(speedSelect, { target: { value: '2' } });
    expect(screen.getByDisplayValue('2x')).toBeInTheDocument();
  });

  it('shows existing video warning if job already exists in Firestore', async () => {
    mockGetDocs
      .mockResolvedValueOnce({
        docs: [
          {
            id: 's1',
            data: () => ({
              channel: 'screen',
              imagePath: 'screenshots/s1.jpg',
              timestamp: { toDate: () => new Date() },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'job-1' }],
      });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Frame: 1 \/ 1/i)).toBeInTheDocument();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/A similar video job already exists/i)).toBeInTheDocument();
    });
  });

  it('correctly calculates disjoint buffered ranges when intermediate screenshots fail download', async () => {
    const { getDownloadURL } = await import('firebase/storage');
    getDownloadURL
      .mockResolvedValueOnce('https://storage.local/s1.jpg')
      .mockRejectedValueOnce(new Error('Missing image s2'))
      .mockResolvedValueOnce('https://storage.local/s3.jpg');

    const mockScreenshots = [
      { id: 's1', channel: 'screen', imagePath: 'screenshots/s1.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') } },
      { id: 's2', channel: 'screen', imagePath: 'screenshots/s2.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:20Z') } },
      { id: 's3', channel: 'screen', imagePath: 'screenshots/s3.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:30Z') } },
    ];

    mockGetDocs.mockResolvedValueOnce({
      docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
    });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Frame: 1 \/ 3/i)).toBeInTheDocument();
    });
  });

  it('creates video job when none exists and polls for completed status', async () => {
    vi.useFakeTimers();

    const mockScreenshots = [
      { id: 's1', channel: 'screen', imagePath: 'screenshots/s1.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') } },
    ];

    mockGetDocs
      .mockResolvedValueOnce({
        docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
      })
      .mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'completed', videoUrl: 'https://example.com/video.mp4' }),
    });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    // Flush initial fetch
    await act(async () => {
      await Promise.resolve();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
      await Promise.resolve();
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        jobId: 'mock-job-id',
        classId: 'CLASS_1',
        status: 'pending',
      })
    );

    // Advance timer to trigger polling
    await act(async () => {
      vi.advanceTimersByTime(10500);
      await Promise.resolve();
    });

    expect(screen.getByText(/Video created successfully!/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('handles failed status and missing job doc during polling', async () => {
    vi.useFakeTimers();

    const mockScreenshots = [
      { id: 's1', channel: 'screen', imagePath: 'screenshots/s1.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') } },
    ];

    mockGetDocs
      .mockResolvedValueOnce({
        docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
      })
      .mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ status: 'failed', error: 'Encoding failed' }),
    });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
      await Promise.resolve();
    });

    // Advance timer for polling
    await act(async () => {
      vi.advanceTimersByTime(10500);
      await Promise.resolve();
    });

    expect(screen.getByText(/Video creation failed: Encoding failed/i)).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('handles unexpected error when creating video job', async () => {
    const mockScreenshots = [
      { id: 's1', channel: 'screen', imagePath: 'screenshots/s1.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') } },
    ];

    mockGetDocs
      .mockResolvedValueOnce({
        docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
      })
      .mockRejectedValueOnce(new Error('Network error during query'));

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Frame: 1 \/ 1/i)).toBeInTheDocument();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Error: Network error during query/i)).toBeInTheDocument();
    });
  });

  it('handles processing, pending, and error states during video job status polling', async () => {
    vi.useFakeTimers();
    const mockScreenshots = [
      { id: 's1', channel: 'screen', imagePath: 'screenshots/s1.jpg', timestamp: { toDate: () => new Date('2026-08-30T00:00:10Z') } },
    ];

    mockGetDocs
      .mockResolvedValueOnce({
        docs: mockScreenshots.map((s) => ({ id: s.id, data: () => s })),
      })
      .mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

    // 1. First poll: processing
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ status: 'processing' }),
      })
      // 2. Second poll: pending
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ status: 'pending' }),
      })
      // 3. Third poll: not found
      .mockResolvedValueOnce({
        exists: () => false,
      });

    render(
      <PlaybackView
        sessionData={mockSessionData}
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        onBack={vi.fn()}
      />
    );

    await act(async () => {
      await Promise.resolve();
    });

    const combineBtn = screen.getByText(/Combine to Video/i);
    await act(async () => {
      fireEvent.click(combineBtn);
      await Promise.resolve();
    });

    // Advance for processing
    await act(async () => {
      vi.advanceTimersByTime(10500);
      await Promise.resolve();
    });
    expect(screen.getByText(/Video is processing\.\.\./i)).toBeInTheDocument();

    // Advance for pending
    await act(async () => {
      vi.advanceTimersByTime(10500);
      await Promise.resolve();
    });
    expect(screen.getByText(/Video job is pending\.\.\./i)).toBeInTheDocument();

    // Advance for not found
    await act(async () => {
      vi.advanceTimersByTime(10500);
      await Promise.resolve();
    });
    expect(screen.getByText(/Video job details not found\./i)).toBeInTheDocument();

    vi.useRealTimers();
  });
});

