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
});
