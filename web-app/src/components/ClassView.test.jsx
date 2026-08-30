import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClassView from './ClassView';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ classes: ['CLASS-101', 'CLASS-202'] }),
  }),
  onSnapshot: vi.fn((ref, cb) => {
    cb({
      exists: () => true,
      id: 'CLASS-101',
      data: () => ({ name: 'Intro to Computer Science' }),
      docChanges: () => [],
    });
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
}));

vi.mock('../hooks/useClassSchedule', () => ({
  useClassSchedule: vi.fn(() => ({
    lessons: [],
    selectedLesson: '',
    startTime: '2026-08-29T08:00',
    endTime: '2026-08-29T12:00',
    setStartTime: vi.fn(),
    setEndTime: vi.fn(),
    handleLessonChange: vi.fn(),
    timezone: 'UTC',
  })),
}));

// Mock sub-views to keep test lightweight
vi.mock('./MonitorView', () => ({ default: () => <div data-testid="monitor-view">Live Monitor Content</div> }));
vi.mock('./IrregularitiesView', () => ({ default: () => <div data-testid="irregularities-view">Irregularities Content</div> }));
vi.mock('./AttendanceView', () => ({ default: () => <div data-testid="attendance-view">Attendance Content</div> }));
vi.mock('./ClassManagement', () => ({ default: () => <div data-testid="management-view">Class Management Content</div> }));
vi.mock('./MessagesView', () => ({ default: () => <div data-testid="messages-view">Messages Content</div> }));

describe('ClassView Component', () => {
  const mockUser = { uid: 'teacher_001', email: 'teacher@school.edu' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders class header and default monitor tab', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=monitor']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/CLASS-101/i)).toBeInTheDocument();
    expect(screen.getByTestId('monitor-view')).toBeInTheDocument();
  });

  it('navigates to analytics subtabs when clicked', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=attendance']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('attendance-view')).toBeInTheDocument();
  });

  it('renders tab buttons (Live Monitor, Recordings, AI Analytics, Live Alerts, Settings)', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=monitor']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /Live Monitor/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI Analytics/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Class Settings & Roster/i })).toBeInTheDocument();
  });
});
