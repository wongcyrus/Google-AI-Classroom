import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SessionReviewView from './SessionReviewView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

let mockSnapshotCallback = null;

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((docRef, cb) => {
    mockSnapshotCallback = cb;
    return vi.fn();
  }),
  deleteDoc: vi.fn().mockResolvedValue(),
  getDoc: vi.fn(),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ empty: true, docs: [] }),
  setDoc: vi.fn().mockResolvedValue(),
  serverTimestamp: vi.fn(),
}));

let mockVideoJobs = [
  {
    id: 'job_1',
    studentUid: 's1',
    studentEmail: 'student1@example.com',
    status: 'completed',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    endTime: { toDate: () => new Date('2026-08-30T01:00:00Z') },
    createdAt: { toMillis: () => 1000, toDate: () => new Date('2026-08-30T00:30:00Z') },
  },
];

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => ({
    data: mockVideoJobs,
    loading: false,
  }),
}));

describe('SessionReviewView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders student dropdown and video job history, and allows opening playback view', async () => {
    render(
      <SessionReviewView
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
      />
    );

    expect(screen.getByText(/Session Playback/i)).toBeInTheDocument();

    // Trigger snapshot update with students list
    mockSnapshotCallback({
      exists: () => true,
      data: () => ({
        students: {
          s1: 'alice@school.edu',
        },
      }),
    });

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    });

    // Select student
    const studentSelect = screen.getByDisplayValue(/Select a student/i);
    fireEvent.change(studentSelect, { target: { value: 's1' } });

    // Load Student button
    const loadBtn = screen.getByText('Load Student');
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(screen.getByText(/Playback for: alice@school.edu/i)).toBeInTheDocument();
    });
  });

  it('filters video jobs by status', async () => {
    render(
      <SessionReviewView
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
      />
    );

    // Toggle status filters
    const completedFilter = screen.getByLabelText(/Completed/i);
    fireEvent.click(completedFilter);
    expect(completedFilter).toBeChecked();

    const failedFilter = screen.getByLabelText(/Failed/i);
    fireEvent.click(failedFilter);
    expect(failedFilter).toBeChecked();
  });
});
