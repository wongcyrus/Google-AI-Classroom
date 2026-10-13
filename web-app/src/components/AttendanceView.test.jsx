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
  storage: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn().mockResolvedValue({ docs: [] });
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.mock/video.mp4'),
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
              attendance: [1, 2, 3, 4, 0], // Min 1 present, Min 2 Timeout, Min 3 Correct, Min 4 Incorrect, Min 5 absent
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

    expect(screen.getAllByText(/Bingo Correct/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Bingo Incorrect/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Bingo Timeout/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTitle('Min 2: ⏱️ Bingo Timeout (Missed / AFK)')).toBeInTheDocument();
    expect(screen.getByTitle('Min 3: 🎯 Bingo Correct (Passed Challenge)')).toBeInTheDocument();
    expect(screen.getByTitle('Min 4: ⚠️ Bingo Incorrect (Wrong Answer)')).toBeInTheDocument();
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

    // Click Net Screen Share Minutes header
    const screenMinutesTh = screen.getByTitle(/Click to sort by net verified screen share minutes/i);
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

  it('displays student screencast video player and time-lapse duration in the details modal', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u1: {
              sharedScreenMinutes: 60,
              workingMinutes: 60,
              summary: 'Worked on React project',
              feedback: 'Consistent progress',
              attendance: [1, 1],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameRate: 30,
          students: { u1: 'alice@school.edu' },
        }),
      });

    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'job_alice_123',
          data: () => ({
            classId: 'CLASS_101',
            studentUid: 'u1',
            studentEmail: 'alice@school.edu',
            startTime: '2026-08-30T10:00:00.000Z',
            duration: 120,
            status: 'completed',
            videoPath: 'videos/CLASS_101/alice_123.mp4',
          }),
        },
      ],
    });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00.000Z"
        endTime="2026-08-30T11:00:00.000Z"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    });

    const studentRow = screen.getByText('alice@school.edu').closest('tr');
    fireEvent.click(studentRow);

    // Verify modal opened
    expect(screen.getByText(/AI Analysis for alice@school.edu/i)).toBeInTheDocument();

    // Verify Time-Lapse Screencast banner and duration
    await waitFor(() => {
      expect(screen.getByText(/Time-Lapse Screencast:/i)).toBeInTheDocument();
      expect(screen.getByText(/120s/i)).toBeInTheDocument();
      expect(screen.getByText(/60 minutes/i)).toBeInTheDocument();
    });

    // Verify video element is rendered with storage URL
    await waitFor(() => {
      const videoElement = document.querySelector('video');
      expect(videoElement).toBeInTheDocument();
      expect(videoElement).toHaveAttribute('src', 'https://storage.mock/video.mp4');
    });

    // Verify New Tab button
    expect(screen.getByText(/Open Video in New Tab/i)).toBeInTheDocument();
  });

  it('displays fallback notice when no screen recording exists for the student', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u2: {
              sharedScreenMinutes: 0,
              workingMinutes: 0,
              attendance: [0, 0],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u2: 'bob@school.edu' },
        }),
      });

    mockGetDocs.mockResolvedValueOnce({ docs: [] });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00.000Z"
        endTime="2026-08-30T11:00:00.000Z"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('bob@school.edu')).toBeInTheDocument();
    });

    const studentRow = screen.getByText('bob@school.edu').closest('tr');
    fireEvent.click(studentRow);

    await waitFor(() => {
      expect(screen.getByText(/No recorded screen video found for this lesson/i)).toBeInTheDocument();
    });
  });

  it('accurately scales timelapse minutes according to custom capture interval (15s frame rate)', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u3: {
              sharedScreenMinutes: 30,
              workingMinutes: 30,
              attendance: [1, 1],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameRate: 15,
          students: { u3: 'charlie@school.edu' },
        }),
      });

    mockGetDocs.mockResolvedValueOnce({
      docs: [
        {
          id: 'job_charlie_123',
          data: () => ({
            classId: 'CLASS_101',
            studentUid: 'u3',
            studentEmail: 'charlie@school.edu',
            startTime: '2026-08-30T10:00:00.000Z',
            duration: 120, // 120s video at 15s capture interval = (120 * 15) / 60 = 30 minutes
            status: 'completed',
            videoPath: 'videos/CLASS_101/charlie_123.mp4',
          }),
        },
      ],
    });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00.000Z"
        endTime="2026-08-30T11:00:00.000Z"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('charlie@school.edu')).toBeInTheDocument();
    });

    const studentRow = screen.getByText('charlie@school.edu').closest('tr');
    fireEvent.click(studentRow);

    await waitFor(() => {
      expect(screen.getByText(/Time-Lapse Screencast:/i)).toBeInTheDocument();
      expect(screen.getByText(/~15s per screenshot/i)).toBeInTheDocument();
      expect(screen.getByText(/30 minutes/i)).toBeInTheDocument();
    });
  });

  it('renders Raw Share (min), Deducted (min), and Net Share (min) table headers and values', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u4: {
              sharedScreenMinutes: 45,
              rawScreenMinutes: 50,
              deductedMinutes: 5,
              workingMinutes: 40,
              attendance: [1, 1, 2, 3, 4],
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u4: 'bingo_student@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00.000Z"
        endTime="2026-08-30T11:00:00.000Z"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('bingo_student@school.edu')).toBeInTheDocument();
    });

    expect(screen.getByText('Raw Share')).toBeInTheDocument();
    expect(screen.getByText('Deducted')).toBeInTheDocument();
    expect(screen.getAllByText('Net Share').length).toBeGreaterThanOrEqual(1);

    const studentRow = screen.getByText('bingo_student@school.edu').closest('tr');
    expect(studentRow).toHaveTextContent('50');
    expect(studentRow).toHaveTextContent('-5');
    expect(studentRow).toHaveTextContent('45');
  });

  it('renders 3-color Bingo filter pills and legend in AttendanceView', async () => {
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: {
            u5: {
              sharedScreenMinutes: 30,
              rawScreenMinutes: 30,
              deductedMinutes: 0,
              workingMinutes: 20,
              attendance: [3, 4],
              bingoCount: 2,
              bingoPassedCount: 1,
              bingoFailedCount: 1,
              bingoTimeoutCount: 0,
            },
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          students: { u5: 'legend_student@school.edu' },
        }),
      });

    render(
      <AttendanceView
        classId="CLASS_101"
        selectedLesson="2026-08-30T10:00:00.000Z"
        startTime="2026-08-30T10:00:00.000Z"
        endTime="2026-08-30T11:00:00.000Z"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('legend_student@school.edu')).toBeInTheDocument();
    });

    // Check legend items
    expect(screen.getByText(/🎯 Bingo Correct/i)).toBeInTheDocument();
    expect(screen.getByText(/⚠️ Bingo Incorrect/i)).toBeInTheDocument();
    expect(screen.getByText(/⏱️ Bingo Timeout/i)).toBeInTheDocument();

    // Check filter pills
    expect(screen.getByRole('button', { name: /Bingo Correct/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bingo Incorrect/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bingo Timeout/i })).toBeInTheDocument();
  });
});


