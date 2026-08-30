import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AttendanceView from './AttendanceView';

const mockCallable = vi.fn().mockResolvedValue({
  data: {
    attendanceData: [
      { email: 'student1@school.edu', totalMinutes: 45, percentage: '75.00%', attendance: [1, 1, 0] },
    ],
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
});
