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
          { data: () => ({ taskName: 'Code Editor', duration: 120 }) },
          { data: () => ({ taskName: 'Code Editor', duration: 60 }) },
          { data: () => ({ taskName: 'Terminal', duration: 45 }) },
        ],
      });

      render(<PerformanceAnalyticsView classId="CLASS_101" />);

      await waitFor(() => {
        expect(screen.getByText(/Performance Analytics/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/This chart displays the total time students have spent on different tasks/i)).toBeInTheDocument();
    });

    it('renders empty state message when no metrics available', async () => {
      mockGetDocs.mockResolvedValueOnce({
        docs: [],
      });

      render(<PerformanceAnalyticsView classId="CLASS_101" />);

      await waitFor(() => {
        expect(screen.getByText(/No performance data has been collected yet/i)).toBeInTheDocument();
      });
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
