import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AttendanceView from './AttendanceView';

const mockCallable = vi.fn().mockResolvedValue({
  data: {
    attendanceData: [],
  },
});

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
}));

describe('AttendanceView Component Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders attendance table and lesson data when lesson document exists', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: {
              sharedScreenMinutes: 50,
              workingMinutes: 45,
              summary: 'Engaged in coding',
              feedback: 'Great focus',
              attendance: [1, 1, 1],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'alice@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    });

    const studentRow = screen.getByText('alice@school.edu').closest('tr');
    expect(studentRow).toHaveTextContent('50');
    expect(studentRow).toHaveTextContent('45');
  });

  it('opens student details modal when table row is clicked', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          generalSummary: 'Good session overall',
          generalFeedback: ['Keep active'],
          students: {
            u1: {
              sharedScreenMinutes: 50,
              workingMinutes: 45,
              summary: 'Engaged in coding',
              feedback: 'Great focus',
              attendance: [1, 1, 1],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'alice@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    });

    const studentRow = screen.getByText('alice@school.edu').closest('tr');
    fireEvent.click(studentRow);

    expect(screen.getByText(/AI Analysis for alice@school.edu/i)).toBeInTheDocument();
    expect(screen.getByText('Engaged in coding')).toBeInTheDocument();
    expect(screen.getByText('Great focus')).toBeInTheDocument();
    expect(screen.getByText('Good session overall')).toBeInTheDocument();
    expect(screen.getByText('Keep active')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/AI Analysis for alice@school.edu/i)).not.toBeInTheDocument();

    const exportBtn = screen.getByRole('button', { name: /Export to (Excel|CSV)/i });
    await act(async () => {
      fireEvent.click(exportBtn);
    });
  });

  it('handles manual Calculate Live Attendance button click', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => false,
    });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Calculate Live Attendance/i })).toBeInTheDocument();
    });

    const fetchBtn = screen.getByRole('button', { name: /Calculate Live Attendance/i });
    await act(async () => {
      fireEvent.click(fetchBtn);
    });

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalled();
    });
  });

  it('renders Bingo deducted minute cells and legend correctly', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: {
              sharedScreenMinutes: 40,
              workingMinutes: 35,
              summary: 'Engaged',
              attendance: [1, 2, 0], // Min 1 present, Min 2 deducted by Bingo, Min 3 absent
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'bob@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
    });

    expect(screen.getByText(/Deducted \(Failed Bingo Checks\)/i)).toBeInTheDocument();
    expect(screen.getByTitle('Min 2: Deducted (Failed consecutive Bingo checks)')).toBeInTheDocument();
  });

  it('supports client-side search filtering by student name or email', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: { sharedScreenMinutes: 40, workingMinutes: 30, attendance: [1, 1, 0] },
            u2: { sharedScreenMinutes: 0, workingMinutes: 0, attendance: [0, 0, 0] },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'alice@school.edu', u2: 'bob@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
      expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search student name, email, class/i);
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    expect(screen.queryByText('bob@school.edu')).not.toBeInTheDocument();

    const clearBtn = screen.getByRole('button', { name: /Clear search/i });
    fireEvent.click(clearBtn);

    expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
  });

  it('supports filtering by status pills (Present vs Absent)', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: { sharedScreenMinutes: 40, workingMinutes: 30, attendance: [1, 1, 0] },
            u2: { sharedScreenMinutes: 0, workingMinutes: 0, attendance: [0, 0, 0] },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'alice@school.edu', u2: 'bob@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
      expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
    });

    // Click Absent pill
    const absentPill = screen.getByRole('button', { name: /Absent/i });
    fireEvent.click(absentPill);

    expect(screen.queryByText('alice@school.edu')).not.toBeInTheDocument();
    expect(screen.getByText('bob@school.edu')).toBeInTheDocument();

    // Click Present pill
    const presentPill = screen.getByRole('button', { name: /Present/i });
    fireEvent.click(presentPill);

    expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    expect(screen.queryByText('bob@school.edu')).not.toBeInTheDocument();
  });

  it('supports sorting when clicking sortable table headers', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: { sharedScreenMinutes: 10, workingMinutes: 10, attendance: [1, 0, 0] },
            u2: { sharedScreenMinutes: 50, workingMinutes: 45, attendance: [1, 1, 1] },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u1: 'alice@school.edu', u2: 'bob@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
      expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
    });

    // Click Screen Share Minutes header
    const screenMinutesTh = screen.getByTitle(/Click to sort by screen share minutes/i);
    fireEvent.click(screenMinutesTh);

    const rows = screen.getAllByRole('row');
    // First data row (index 1) should now be bob (50 min > 10 min)
    expect(rows[1]).toHaveTextContent('bob@school.edu');
    expect(rows[2]).toHaveTextContent('alice@school.edu');

    // Click again to toggle ascending
    fireEvent.click(screenMinutesTh);
    const toggledRows = screen.getAllByRole('row');
    expect(toggledRows[1]).toHaveTextContent('alice@school.edu');
    expect(toggledRows[2]).toHaveTextContent('bob@school.edu');
  });

  it('automatically recalculates live attendance when selectedLesson changes', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => false,
    });

    const { rerender } = render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00"
        endTime="2026-08-30T11:00:00"
      />
    );

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalled();
    });

    mockCallable.mockClear();

    rerender(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-09-06T10:00:00.000Z"
        startTime="2026-09-06T10:00:00"
        endTime="2026-09-06T11:00:00"
      />
    );

    await waitFor(() => {
      expect(mockCallable).toHaveBeenCalled();
    });
  });
});

