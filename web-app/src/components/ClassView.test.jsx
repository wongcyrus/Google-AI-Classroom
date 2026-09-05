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
      data: () => ({
        name: 'Intro to Computer Science',
        students: { s1: 's1@school.edu', s2: 's2@school.edu' },
        aiQuota: 15,
      }),
      docChanges: () => [],
    });
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
}));

const mockSetStartTime = vi.fn();
const mockSetEndTime = vi.fn();
const mockHandleLessonChange = vi.fn();

vi.mock('../hooks/useClassSchedule', () => ({
  useClassSchedule: vi.fn(() => ({
    lessons: [
      { start: new Date('2026-08-29T08:00:00Z'), end: new Date('2026-08-29T10:00:00Z') },
    ],
    selectedLesson: '2026-08-29T08:00:00.000Z',
    startTime: '2026-08-29T08:00',
    endTime: '2026-08-29T12:00',
    setStartTime: mockSetStartTime,
    setEndTime: mockSetEndTime,
    handleLessonChange: mockHandleLessonChange,
    timezone: 'Asia/Hong_Kong',
  })),
}));

// Mock sub-views to keep tests clean and targeted
vi.mock('./MonitorView', () => ({ default: () => <div data-testid="monitor-view">Live Monitor Content</div> }));
vi.mock('./IrregularitiesView', () => ({ default: () => <div data-testid="irregularities-view">Irregularities Content</div> }));
vi.mock('./AttendanceView', () => ({ default: () => <div data-testid="attendance-view">Attendance Content</div> }));
vi.mock('./ProgressView', () => ({ default: () => <div data-testid="progress-view">Progress Content</div> }));
vi.mock('./PerformanceAnalyticsView', () => ({ default: () => <div data-testid="performance-view">Performance Content</div> }));
vi.mock('./AiCostReportView', () => ({ default: () => <div data-testid="ai-cost-view">AI Cost Content</div> }));
vi.mock('./VideoLibrary', () => ({ default: () => <div data-testid="video-library-view">Video Library Content</div> }));
vi.mock('./SessionReviewView', () => ({ default: () => <div data-testid="session-review-view">Session Review Content</div> }));
vi.mock('./VideoAnalysisJobs', () => ({ default: () => <div data-testid="video-jobs-view">Video Jobs Content</div> }));
vi.mock('./DataManagementView', () => ({ default: () => <div data-testid="data-view">Data Management Content</div> }));
vi.mock('./ClassManagement', () => ({ default: () => <div data-testid="management-view">Class Management Content</div> }));
vi.mock('./MessagesView', () => ({ default: () => <div data-testid="messages-view">Messages Content</div> }));

describe('ClassView Component Full Suite', () => {
  const mockUser = { uid: 'teacher_001', email: 'teacher@school.edu' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders class header, student count, and default monitor tab', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=monitor']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/CLASS-101/i)).toBeInTheDocument();
    expect(screen.getByText(/2 enrolled students/i)).toBeInTheDocument();
    expect(screen.getByTestId('monitor-view')).toBeInTheDocument();
  });

  it('switches between all video subtabs (library, review, jobs)', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=video&sub=library']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('video-library-view')).toBeInTheDocument();
    unmount();

    const { unmount: unmount2 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=video&sub=review']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('session-review-view')).toBeInTheDocument();
    unmount2();

    const { unmount: unmount3 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=video&sub=jobs']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('video-jobs-view')).toBeInTheDocument();
    unmount3();
  });

  it('renders all analytics subtabs (irregularities, progress, attendance, performance, ai-cost)', () => {
    const { unmount: u1 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=irregularities']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('irregularities-view')).toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=progress']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('progress-view')).toBeInTheDocument();
    u2();

    const { unmount: u3 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=attendance']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('attendance-view')).toBeInTheDocument();
    u3();

    const { unmount: u4 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=performance']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('performance-view')).toBeInTheDocument();
    u4();

    const { unmount: u5 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=analytics&sub=ai-cost']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('ai-cost-view')).toBeInTheDocument();
    u5();
  });

  it('renders messages, data, and settings views', () => {
    const { unmount: u1 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=messages']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('messages-view')).toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=data']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('data-view')).toBeInTheDocument();
    u2();

    const { unmount: u3 } = render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=settings']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByTestId('management-view')).toBeInTheDocument();
    u3();
  });

  it('renders date filter controls on video/analytics/data tabs and allows time adjustments', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=video&sub=library']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    const fromInput = screen.getByLabelText(/From:/i);
    const toInput = screen.getByLabelText(/To:/i);

    fireEvent.change(fromInput, { target: { value: '2026-08-29T09:00' } });
    expect(mockSetStartTime).toHaveBeenCalledWith('2026-08-29T09:00');

    fireEvent.change(toInput, { target: { value: '2026-08-29T11:00' } });
    expect(mockSetEndTime).toHaveBeenCalledWith('2026-08-29T11:00');
  });

  it('renders class switcher when teacher belongs to multiple classes', async () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=monitor']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    const switcher = await screen.findByLabelText(/Switch Class:/i);
    expect(switcher).toBeInTheDocument();

    fireEvent.change(switcher, { target: { value: 'CLASS-202' } });
  });

  it('handles clicking all main navigation tabs and sub-tabs smoothly', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    // Click Video tab
    const videoTab = screen.getByRole('button', { name: /Recordings & Sessions/i });
    fireEvent.click(videoTab);

    // Click Review sub-tab
    const reviewSubTab = screen.getByRole('button', { name: /Timeline Session Review/i });
    fireEvent.click(reviewSubTab);

    // Click Jobs sub-tab
    const jobsSubTab = screen.getByRole('button', { name: /AI Video Analysis Jobs/i });
    fireEvent.click(jobsSubTab);

    // Click Analytics tab
    const analyticsTab = screen.getByRole('button', { name: /AI Analytics & Insights/i });
    fireEvent.click(analyticsTab);

    // Click Progress sub-tab
    const progressSubTab = screen.getByRole('button', { name: /Progress Summary/i });
    fireEvent.click(progressSubTab);

    // Click Attendance sub-tab
    const attendanceSubTab = screen.getByRole('button', { name: /Attendance/i });
    fireEvent.click(attendanceSubTab);

    // Click Performance sub-tab
    const performanceSubTab = screen.getByRole('button', { name: /Performance Metrics/i });
    fireEvent.click(performanceSubTab);

    // Click AI Cost sub-tab
    const costSubTab = screen.getByRole('button', { name: /AI Cost Report/i });
    fireEvent.click(costSubTab);

    // Click Data tab
    const dataTab = screen.getByRole('button', { name: /Data & Archives/i });
    fireEvent.click(dataTab);

    // Click Settings tab
    const settingsTab = screen.getByRole('button', { name: /Class Settings & Roster/i });
    fireEvent.click(settingsTab);
  });

  it('handles lesson change and filterField dropdown in shared date filter', () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=video&sub=library']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    const comboboxes = screen.getAllByRole('combobox');
    const lessonSelect = comboboxes.find(cb => cb.querySelector('option[value=""]'));
    if (lessonSelect) {
      fireEvent.change(lessonSelect, { target: { value: '2026-08-29T08:00:00.000Z' } });
      expect(mockHandleLessonChange).toHaveBeenCalled();
    }

    const filterFieldSelect = comboboxes.find(cb => cb.querySelector('option[value="createdAt"]'));
    if (filterFieldSelect) {
      fireEvent.change(filterFieldSelect, { target: { value: 'createdAt' } });
    }
  });

  it('switches class via quick switcher dropdown', async () => {
    render(
      <MemoryRouter initialEntries={['/class/CLASS-101?tab=monitor']}>
        <Routes>
          <Route path="/class/:classId" element={<ClassView user={mockUser} />} />
        </Routes>
      </MemoryRouter>
    );

    const switcher = await screen.findByLabelText(/Switch Class/i);
    expect(switcher).toBeInTheDocument();
    fireEvent.change(switcher, { target: { value: 'CLASS-202' } });
  });
});
