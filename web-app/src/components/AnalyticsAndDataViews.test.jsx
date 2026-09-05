import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import AttendanceView from './AttendanceView';
import PerformanceAnalyticsView from './PerformanceAnalyticsView';
import DataManagementView from './DataManagementView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

const mockHttpsCallable = vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ data: { success: true, count: 50 } }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => mockHttpsCallable(...args),
}));

const mockDoc = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue();
const mockDeleteDoc = vi.fn().mockResolvedValue();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  startAfter: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
  setDoc: (...args) => mockSetDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  writeBatch: vi.fn(() => ({
    delete: vi.fn(),
    commit: vi.fn().mockResolvedValue({}),
  })),
  serverTimestamp: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ classId: 'CLASS_101' }),
}));

// Mock recharts ResponsiveContainer to render children
vi.mock('recharts', async () => {
  const OriginalModule = await vi.importActual('recharts');
  return {
    ...OriginalModule,
    ResponsiveContainer: ({ children }) => <div>{children}</div>,
  };
});

describe('Analytics & Data Management Views Full Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
    window.open = vi.fn();
  });

  describe('AttendanceView', () => {
    it('renders attendance view header and buttons', () => {
      render(
        <AttendanceView
          classId="CLASS_101"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T23:59:59Z"
          filterField="startTime"
        />
      );

      expect(screen.getByText(/Attendance & AI Analysis/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Calculate Live Attendance/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Export to CSV/i })).toBeInTheDocument();
    });
  });

  describe('PerformanceAnalyticsView', () => {
    it('renders performance analytics metrics when data exists', async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [
          { id: 'm1', data: () => ({ studentUid: 'stu_1', taskName: 'Task 1: Account Setup & MFA', duration: 1200 }) },
          { id: 'm2', data: () => ({ studentUid: 'stu_1', taskName: 'Task 2: AWS CloudShell & IDE', duration: 1800 }) },
          { id: 'm3', data: () => ({ studentUid: 'stu_2', taskName: 'Task 1: Account Setup & MFA', duration: 1500 }) },
        ],
      });

      render(<PerformanceAnalyticsView classId="CLASS_101" />);

      await waitFor(() => {
        expect(screen.getByText(/Lab Performance & Mastery Analytics/i)).toBeInTheDocument();
      });

      // KPI cards
      expect(screen.getByText(/Avg Total Duration/i)).toBeInTheDocument();
      expect(screen.getByText(/Lab Completion Rate/i)).toBeInTheDocument();
      expect(screen.getByText(/Primary Bottleneck/i)).toBeInTheDocument();

      // Student matrix table and export buttons
      expect(screen.getByText('Student Milestone Matrix')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^📥 Export CSV$/i })).toBeInTheDocument();
      const exportMatrixBtn = screen.getByRole('button', { name: /Export Matrix CSV/i });
      expect(exportMatrixBtn).toBeInTheDocument();
      fireEvent.click(exportMatrixBtn);
      expect(screen.getAllByText('stu_1').length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('stu_2').length).toBeGreaterThanOrEqual(1);

      // Verify header sorting interactions
      const studentHeader = screen.getByText(/Student ▲/i);
      fireEvent.click(studentHeader);
      expect(screen.getByText(/Student ▼/i)).toBeInTheDocument();

      const totalTimeHeader = screen.getByText(/Total Lab Time ↕/i);
      fireEvent.click(totalTimeHeader);
      expect(screen.getByText(/Total Lab Time ▲/i)).toBeInTheDocument();
      fireEvent.click(totalTimeHeader);
      expect(screen.getByText(/Total Lab Time ▼/i)).toBeInTheDocument();
    });

    it('filters metrics by selected lesson matching the top filter', async () => {
      const lessonDate = new Date('2026-09-04T01:30:00.000Z');
      const lessonEnd = new Date('2026-09-04T03:30:00.000Z');
      const lessons = [{ start: lessonDate, end: lessonEnd }];
      const selectedLesson = lessonDate.toISOString();

      mockGetDocs.mockResolvedValueOnce({
        docs: [
          {
            id: 'm1',
            data: () => ({
              studentUid: 'stu_1',
              taskName: 'Task 1: Account Setup & MFA',
              duration: 1200,
              startTime: lessonDate,
            }),
          },
          {
            id: 'm2',
            data: () => ({
              studentUid: 'stu_outside',
              taskName: 'Task 1: Account Setup & MFA',
              duration: 1800,
              startTime: new Date('2026-08-20T00:00:00.000Z'), // Outside lesson window
            }),
          },
        ],
      });

      render(
        <PerformanceAnalyticsView
          classId="CLASS_101"
          lessons={lessons}
          selectedLesson={selectedLesson}
          startTime={lessonDate.toISOString()}
          endTime={lessonEnd.toISOString()}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Filtered by Lesson:/i)).toBeInTheDocument();
      });

      expect(screen.getAllByText('stu_1').length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText('stu_outside')).not.toBeInTheDocument();
    });

    it('renders empty state message when no metrics available and calls handleLessonChange to reset', async () => {
      const mockHandleLessonChange = vi.fn();
      mockGetDocs.mockResolvedValueOnce({
        docs: [],
      });

      render(
        <PerformanceAnalyticsView
          classId="CLASS_101"
          startTime="2026-09-04T01:30:00.000Z"
          endTime="2026-09-04T03:30:00.000Z"
          handleLessonChange={mockHandleLessonChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/No performance metrics recorded for the selected lesson window/i)).toBeInTheDocument();
      });

      const resetBtn = screen.getByRole('button', { name: /View All Recorded Class Data/i });
      fireEvent.click(resetBtn);
      expect(mockHandleLessonChange).toHaveBeenCalledWith({ target: { value: '' } });
    });
  });

  describe('DataManagementView', () => {
    it('renders data management table and controls', async () => {
      render(
        <DataManagementView
          user={{ uid: 'teacher_1' }}
          classId="CLASS_101"
          startTime="2026-08-30T00:00:00Z"
          endTime="2026-08-30T23:59:59Z"
        />
      );

      expect(screen.getByText(/Data Management/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Delete Screenshots in Range/i })).toBeInTheDocument();
    });
  });
});
