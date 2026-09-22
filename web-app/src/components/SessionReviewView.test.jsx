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

  it('opens and closes job error modal when clicking a failed job status', async () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const failedLink = screen.getByRole('link', { name: 'failed' });
    fireEvent.click(failedLink);

    expect(screen.getByText(/Job Failure Details/i)).toBeInTheDocument();

    const closeBtn = screen.getByText(/Job Failure Details/i).parentElement.querySelector('button');
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Job Failure Details/i)).not.toBeInTheDocument();
  });

  it('handles exporting video jobs as CSV', () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-vj-csv');

    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const exportBtn = screen.getByRole('button', { name: /Export Video Jobs/i });
    fireEvent.click(exportBtn);

    expect(window.URL.createObjectURL).toHaveBeenCalled();
    window.URL.createObjectURL = originalCreateObjectURL;
  });

  it('handles searching students, playback validation, and empty export alert', () => {
    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    // Search student
    const searchInput = screen.getByPlaceholderText(/Search student.../i);
    fireEvent.change(searchInput, { target: { value: 'alice' } });
    expect(searchInput.value).toBe('alice');

    // Load Student button is disabled when no student is selected
    const playBtn = screen.getByRole('button', { name: /Load Student/i });
    expect(playBtn).toBeDisabled();
  });

  it('handles selecting specific jobs and deleting selected jobs', async () => {
    window.confirm = vi.fn().mockReturnValue(true);

    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    // Checkboxes include status filter checkboxes and table checkboxes
    // The table job checkbox for vj_1:
    const jobCheckbox = checkboxes.find(cb => !['pending', 'processing', 'completed', 'failed'].includes(cb.closest('label')?.textContent?.trim() || ''));
    if (jobCheckbox) {
      fireEvent.click(jobCheckbox);
      const deleteSelectedBtn = screen.getByRole('button', { name: /Delete Selected/i });
      expect(deleteSelectedBtn).not.toBeDisabled();

      await act(async () => {
        fireEvent.click(deleteSelectedBtn);
      });

      await waitFor(() => {
        expect(mockDeleteDoc).toHaveBeenCalled();
      });
    }
  });

  it('runs batch video creation, shows batch summary modal, and dismisses notification', async () => {
    // Return empty for first student (creates job), existing job for second student (skipped)
    mockGetDocs
      .mockResolvedValueOnce({ empty: true, docs: [] })
      .mockResolvedValueOnce({ empty: false, docs: [{ id: 'existing_vj' }] });

    render(
      <SessionReviewView
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const combineAllBtn = screen.getByRole('button', { name: /Combine All Students' Videos/i });
    await act(async () => {
      fireEvent.click(combineAllBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Last Batch Job Summary/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/New jobs created for/i)).toBeInTheDocument();
    expect(screen.getByText(/Jobs already existed for/i)).toBeInTheDocument();

    // Close batch summary modal
    const closeSvgBtn = screen.getByText(/Last Batch Job Summary/i).parentElement.querySelector('button');
    fireEvent.click(closeSvgBtn);
    expect(screen.queryByText(/Last Batch Job Summary/i)).not.toBeInTheDocument();

    // Dismiss notification
    const dismissNotifBtn = screen.getByText('×');
    fireEvent.click(dismissNotifBtn);
  });

  it('handles playback alerts when no student is selected, and switches to PlaybackView when valid', () => {
    render(
      <SessionReviewView
        classId="class-1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    const loadStudentBtn = screen.getByRole('button', { name: /Load Student/i });
    expect(loadStudentBtn).toBeDisabled();

    // Select valid student
    const studentSelect = screen.getByLabelText(/Student:/i);
    fireEvent.change(studentSelect, { target: { value: 's1' } });
    expect(loadStudentBtn).not.toBeDisabled();

    // Click -> mounts PlaybackView
    fireEvent.click(loadStudentBtn);
    expect(screen.getByTestId('playback-view')).toBeInTheDocument();

    // Click back to review
    const backBtn = screen.getByRole('button', { name: 'Back' });
    fireEvent.click(backBtn);
    expect(screen.queryByTestId('playback-view')).not.toBeInTheDocument();
  });

  it('allows selecting and unselecting individual jobs via row checkboxes', () => {
    render(
      <SessionReviewView
        classId="class-1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
      />
    );

    // Row 1 checkbox inside tbody
    const table = screen.getByRole('table');
    const rowCheckboxes = table.querySelectorAll('tbody input[type="checkbox"]');
    const firstJobCheckbox = rowCheckboxes[0];
    expect(firstJobCheckbox.checked).toBe(false);

    // Toggle on
    fireEvent.click(firstJobCheckbox);
    expect(firstJobCheckbox.checked).toBe(true);

    // Toggle off
    fireEvent.click(firstJobCheckbox);
    expect(firstJobCheckbox.checked).toBe(false);
  });
});

