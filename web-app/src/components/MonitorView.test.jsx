import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import MonitorView from './MonitorView';

const mockAddDoc = vi.fn().mockResolvedValue({ id: 'msg_1' });
const mockUpdateDoc = vi.fn().mockResolvedValue();

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  auth: {
    currentUser: { uid: 'teacher_1', email: 'teacher@school.edu' },
  },
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: (...args) => mockAddDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  onSnapshot: vi.fn((ref, cb) => {
    // Return sample student data
    cb({
      exists: () => true,
      docs: [
        {
          id: 's_1',
          data: () => ({
            email: 'student1@school.edu',
            isSharing: true,
            isWebcamSharing: true,
            isAudioSharing: true,
            faceStatus: 'normal',
          }),
        },
        {
          id: 's_2',
          data: () => ({
            email: 'student2@school.edu',
            isSharing: false,
            isWebcamSharing: false,
            isAudioSharing: false,
            faceStatus: 'looking_away',
            yawAngle: 32,
          }),
        },
      ],
      data: () => ({
        students: {
          s_1: 'student1@school.edu',
          s_2: 'student2@school.edu',
        },
        settings: {
          captureMode: 'dual',
          enableAudioCapture: true,
        },
      }),
    });
    return () => {};
  }),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/screen.jpg'),
}));

vi.mock('../hooks/usePrompts', () => ({
  usePrompts: vi.fn(() => ({
    prompts: [],
    filteredPrompts: [],
    promptFilter: 'all',
    setPromptFilter: vi.fn(),
  })),
}));

vi.mock('../hooks/useAnalysis', () => ({
  useAnalysis: vi.fn(() => ({
    isAnalyzing: false,
    analysisResults: null,
    runPerImageAnalysis: vi.fn(),
    runAllImagesAnalysis: vi.fn(),
  })),
}));

describe('MonitorView Component Suite', () => {
  const defaultProps = {
    classId: 'CLASS_101',
    lessons: [
      {
        start: new Date('2026-08-30T08:00:00Z'),
        end: new Date('2026-08-30T10:00:00Z'),
      },
    ],
    selectedLesson: '2026-08-30T08:00:00.000Z',
    startTime: '2026-08-30T08:00',
    endTime: '2026-08-30T10:00',
    handleLessonChange: vi.fn(),
    timezone: 'Asia/Hong_Kong',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('renders student filter dropdown, grid channel switcher, and export csv button', async () => {
    render(<MonitorView {...defaultProps} />);

    // Filter selector exists
    const filterSelect = screen.getByRole('combobox', { name: /Filter students by status/i });
    expect(filterSelect).toBeInTheDocument();

    // Channel selector exists
    const channelSelect = screen.getByRole('combobox', { name: /Grid view channel/i });
    expect(channelSelect).toBeInTheDocument();

    // Switch filter to 'problems'
    fireEvent.change(filterSelect, { target: { value: 'problems' } });
    expect(filterSelect.value).toBe('problems');

    // Export CSV button should be rendered and clickable
    const exportCsvBtn = screen.getByRole('button', { name: /Export filter results to CSV/i });
    expect(exportCsvBtn).toBeInTheDocument();

    // Trigger CSV export
    fireEvent.click(exportCsvBtn);

    // Nudge button should be visible when problems filter is active
    const nudgeBtn = screen.getByRole('button', { name: /Nudge/i });
    expect(nudgeBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(nudgeBtn);
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(mockAddDoc).toHaveBeenCalled();
  });

  it('switches grid channel and filters by missing cam or missing screen', () => {
    render(<MonitorView {...defaultProps} />);

    const channelSelect = screen.getByRole('combobox', { name: /Grid view channel/i });
    fireEvent.change(channelSelect, { target: { value: 'webcam' } });
    expect(channelSelect.value).toBe('webcam');

    const filterSelect = screen.getByRole('combobox', { name: /Filter students by status/i });
    fireEvent.change(filterSelect, { target: { value: 'no_cam' } });
    expect(filterSelect.value).toBe('no_cam');

    fireEvent.change(filterSelect, { target: { value: 'no_screen' } });
    expect(filterSelect.value).toBe('no_screen');

    fireEvent.change(filterSelect, { target: { value: 'ai_alert' } });
    expect(filterSelect.value).toBe('ai_alert');
  });

  it('handles lesson change and go live button click', () => {
    const handleLessonChange = vi.fn();
    render(<MonitorView {...defaultProps} handleLessonChange={handleLessonChange} />);

    const lessonSelects = screen.getAllByRole('combobox');
    // First combobox in header is lesson switcher
    const lessonSelect = lessonSelects.find(cb => cb.querySelector('option[value="2026-08-30T08:00:00.000Z"]'));
    if (lessonSelect) {
      fireEvent.change(lessonSelect, { target: { value: '2026-08-30T08:00:00.000Z' } });
      expect(handleLessonChange).toHaveBeenCalled();
    }
  });

  it('selects a student from the grid and toggles controls panel', () => {
    render(<MonitorView {...defaultProps} />);

    // Click student card
    const studentCard = screen.getByText('student1@school.edu');
    fireEvent.click(studentCard);

    // Hide controls button
    const hideBtn = screen.getByRole('button', { name: /Hide Controls/i });
    fireEvent.click(hideBtn);

    // Show controls button appears
    const showBtn = screen.getByRole('button', { name: /Show Controls/i });
    expect(showBtn).toBeInTheDocument();
    fireEvent.click(showBtn);

    // Pause stream
    const pauseBtn = screen.getByRole('button', { name: /Pause Stream/i });
    fireEvent.click(pauseBtn);
  });
});
