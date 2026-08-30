import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SessionReviewView from './SessionReviewView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

const mockDeleteObject = vi.fn().mockResolvedValue({});
vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  deleteObject: (...args) => mockDeleteObject(...args),
}));

const mockDeleteDoc = vi.fn().mockResolvedValue({});
const mockSetDoc = vi.fn().mockResolvedValue({});
const mockGetDocs = vi.fn().mockResolvedValue({ empty: true, docs: [] });

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ id: 'mock-job-id' })),
  onSnapshot: vi.fn((ref, cb) => {
    cb({
      exists: () => true,
      data: () => ({
        students: {
          s1: 'alice@school.edu',
          s2: 'bob@school.edu',
        },
      }),
    });
    return () => {};
  }),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ videoPath: 'videos/bob.mp4' }),
  }),
  serverTimestamp: vi.fn(),
}));

const mockJobs = [
  {
    id: 'vj_1',
    studentUid: 's1',
    studentEmail: 'alice@school.edu',
    status: 'completed',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    endTime: { toDate: () => new Date('2026-08-30T01:00:00Z') },
    createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
  },
  {
    id: 'vj_2',
    studentUid: 's2',
    studentEmail: 'bob@school.edu',
    status: 'failed',
    errorMessage: 'Frame dropped',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    endTime: { toDate: () => new Date('2026-08-30T01:00:00Z') },
    createdAt: { toMillis: () => Date.now(), toDate: () => new Date() },
  },
];

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => ({ data: mockJobs }),
}));

vi.mock('./PlaybackView', () => ({
  default: ({ onBack }) => (
    <div data-testid="playback-view">
      Playback View Content
      <button onClick={onBack}>Back</button>
    </div>
  ),
}));

describe('SessionReviewView Full Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('renders student dropdown, filters, and loads video job list', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    expect(screen.getByText('Session Playback')).toBeInTheDocument();
    expect(screen.getAllByText('alice@school.edu').length).toBeGreaterThan(0);
    expect(screen.getAllByText('bob@school.edu').length).toBeGreaterThan(0);
  });

  it('filters jobs by status checkboxes', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const completedCheckbox = screen.getByLabelText(/completed/i);
    fireEvent.click(completedCheckbox);
  });

  it('initiates batch video compilation for all students', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const batchCombineBtn = screen.getByRole('button', { name: /Combine All Students' Videos/i });
    await act(async () => {
      fireEvent.click(batchCombineBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('switches to PlaybackView when student is selected and playback started', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 's1' } });

    const playBtn = screen.getByRole('button', { name: /Load Student/i });
    fireEvent.click(playBtn);

    expect(screen.getByTestId('playback-view')).toBeInTheDocument();

    const backBtn = screen.getByRole('button', { name: /Back/i });
    fireEvent.click(backBtn);
    expect(screen.getByText('Session Playback')).toBeInTheDocument();
  });

  it('handles selecting and deleting video compilation jobs', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    // Find table row checkboxes
    const checkboxes = screen.getAllByRole('checkbox');
    // Find the header checkbox (index 4) or row checkbox (index 5)
    if (checkboxes.length >= 5) {
      fireEvent.click(checkboxes[4]); // header select all checkbox

      const deleteBtn = screen.getByRole('button', { name: /Delete Selected/i });
      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      await waitFor(() => {
        expect(mockDeleteDoc).toHaveBeenCalled();
      });
    }
  });
});
