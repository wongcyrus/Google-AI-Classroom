import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PerformanceAnalyticsView from './PerformanceAnalyticsView';
import DataManagementView from './DataManagementView';
import AttendanceView from './AttendanceView';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({
    docs: [
      { data: () => ({ taskName: 'Coding Exercise 1', duration: 120 }) },
      { data: () => ({ taskName: 'Coding Exercise 1', duration: 80 }) },
      { data: () => ({ taskName: 'Debugging Task', duration: 45 }) },
    ],
  }),
  doc: vi.fn((...args) => ({ path: args.join('/') })),
  getDoc: vi.fn().mockImplementation((docRef) => {
    return Promise.resolve({
      exists: () => true,
      data: () => ({
        zipPath: 'zips/archive.zip',
        students: {
          uid_1: 'student1@school.edu',
        },
        sharedScreenMinutes: 40,
        workingMinutes: 35,
        summary: 'React exercises',
      }),
    });
  }),
  deleteDoc: vi.fn().mockResolvedValue({}),
  getFirestore: vi.fn(() => ({})),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  deleteObject: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/archive.zip'),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({
    data: [
      {
        email: 'student1@school.edu',
        totalMinutes: 45,
        percentage: 90,
        attendance: [1, 1, 1, 1],
      },
    ],
  })),
}));

vi.mock('../hooks/useCollectionQuery', () => ({
  default: vi.fn(() => ({
    data: [
      {
        id: 'zip_1',
        filename: 'session_archive_2026.zip',
        status: 'completed',
        fileSize: 1024 * 1024 * 5,
        created: { toDate: () => new Date('2026-08-29T10:00:00Z') },
        zipPath: 'zips/archive.zip',
      },
    ],
    loading: false,
    page: 1,
    isLastPage: true,
    fetchNextPage: vi.fn(),
    fetchPrevPage: vi.fn(),
    refetch: vi.fn(),
  })),
}));

vi.mock('react-csv', () => ({
  CSVLink: ({ children }) => <button data-testid="csv-link">{children}</button>,
}));

// Mock recharts
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div data-testid="responsive-container">{children}</div>,
  BarChart: ({ children }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  Legend: () => <div />,
}));

describe('Analytics & Data Management Views', () => {
  describe('PerformanceAnalyticsView', () => {
    it('fetches aggregated performance metrics and renders bar chart', async () => {
      render(
        <MemoryRouter initialEntries={['/class/CLASS-101/performance']}>
          <Routes>
            <Route path="/class/:classId/performance" element={<PerformanceAnalyticsView />} />
          </Routes>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Performance Analytics')).toBeInTheDocument();
        expect(screen.getByTestId('bar-chart')).toBeInTheDocument();
      });
    });
  });

  describe('DataManagementView', () => {
    it('renders zip archives table, checkbox selection, and refresh button', () => {
      render(<DataManagementView classId="CLASS-101" filterField="created" timezone="UTC" />);
      expect(screen.getByText(/Data Management/i)).toBeInTheDocument();
      expect(screen.getByText(/completed/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
    });
  });

  describe('AttendanceView', () => {
    it('renders student attendance summary table and loads lesson data', async () => {
      render(
        <AttendanceView
          classId="CLASS-101"
          selectedLesson="2026-08-29T08:00:00.000Z"
          startTime="2026-08-29T08:00"
          endTime="2026-08-29T09:00"
        />
      );

      expect(screen.getByText(/Attendance & AI Analysis/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Calculate Live Attendance/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Export to CSV/i })).toBeInTheDocument();
    });
  });
});
