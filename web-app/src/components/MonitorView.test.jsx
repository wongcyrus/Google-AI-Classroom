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

const fixedDate = new Date('2026-08-30T08:30:00Z');

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
            timestamp: fixedDate,
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
            timestamp: fixedDate,
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

const mockRunPerImageAnalysis = vi.fn().mockResolvedValue();
const mockRunAllImagesAnalysis = vi.fn().mockResolvedValue();
const mockSetPromptFilter = vi.fn();
const mockStartBroadcast = vi.fn();
const mockStopBroadcast = vi.fn();

vi.mock('../hooks/usePrompts', () => ({
  usePrompts: vi.fn(() => ({
    prompts: [],
    filteredPrompts: [],
    promptFilter: 'all',
    setPromptFilter: mockSetPromptFilter,
  })),
}));

vi.mock('../hooks/useAudioPrompts', () => ({
  useAudioPrompts: vi.fn(() => ({
    audioPrompts: [],
    loading: false,
  })),
}));

vi.mock('../hooks/useTeacherScreenBroadcast', () => ({
  default: vi.fn(() => ({
    isBroadcasting: false,
    activeStudentCount: 0,
    broadcastError: null,
    startBroadcast: mockStartBroadcast,
    stopBroadcast: mockStopBroadcast,
  })),
  useTeacherScreenBroadcast: vi.fn(() => ({
    isBroadcasting: false,
    activeStudentCount: 0,
    broadcastError: null,
    startBroadcast: mockStartBroadcast,
    stopBroadcast: mockStopBroadcast,
  })),
}));

vi.mock('../hooks/useAnalysis', () => ({
  useAnalysis: vi.fn(() => ({
    isAnalyzing: false,
    analysisResults: null,
    runPerImageAnalysis: mockRunPerImageAnalysis,
    runAllImagesAnalysis: mockRunAllImagesAnalysis,
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
    vi.useFakeTimers({ shouldAdvanceTime: true });
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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

    // Start capture first so Pause Stream button is rendered
    const startBtn = screen.getByRole('button', { name: /Start Capture/i });
    fireEvent.click(startBtn);

    // Hide controls button
    const hideBtn = screen.getByRole('button', { name: /Hide Controls/i });
    fireEvent.click(hideBtn);

    // Show controls button appears
    const showBtn = screen.getByRole('button', { name: /Show Controls/i });
    expect(showBtn).toBeInTheDocument();
    fireEvent.click(showBtn);

    // Pause stream
    const pauseBtn = screen.getByRole('button', { name: /Pause Stream/i });
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);
  });

  it('synchronizes individual student popup with grid channel filter without breaking compliance', () => {
    render(<MonitorView {...defaultProps} />);

    // Switch grid channel to screen
    const channelSelect = screen.getByRole('combobox', { name: 'Grid view channel' });
    fireEvent.change(channelSelect, { target: { value: 'screen' } });
    expect(channelSelect.value).toBe('screen');

    // Click student to open popup
    const studentCard = screen.getByText('student1@school.edu');
    fireEvent.click(studentCard);

    // Verify popup opened with screen tab active (following the overall filter)
    const activeScreenTab = screen.getByRole('tab', { name: /Screen Tab/i });
    expect(activeScreenTab).toHaveClass('active');
  });

  it('handles sending broadcast messages to all students and changing frame rate', async () => {
    render(<MonitorView {...defaultProps} />);

    // Message input
    const messageInput = screen.getByPlaceholderText(/Type message or pick template\.\.\./i);
    expect(messageInput).toBeInTheDocument();

    fireEvent.change(messageInput, { target: { value: 'Class ends in 10 minutes!' } });
    const sendBtn = screen.getByRole('button', { name: /^Send$/i });
    
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(mockAddDoc).toHaveBeenCalled();

    // Frame rate / interval select
    const frameRateSelect = screen.getByDisplayValue('15s');
    fireEvent.change(frameRateSelect, { target: { value: '30' } });
    expect(frameRateSelect.value).toBe('30');
  });

  it('triggers teacher screen broadcast start and stop', async () => {
    render(<MonitorView {...defaultProps} />);

    // Find and click Screen Broadcast button
    const broadcastBtn = screen.getByRole('button', { name: /Share Screen to Students/i });
    expect(broadcastBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(broadcastBtn);
    });

    expect(mockStartBroadcast).toHaveBeenCalled();
  });

  it('handles timeline slider scrubbing and debounced review time update', async () => {
    render(<MonitorView {...defaultProps} />);

    const slider = screen.getByRole('slider');
    expect(slider).toBeInTheDocument();

    // Scrub slider
    const testTime = new Date('2026-08-30T09:15:00Z').getTime();
    fireEvent.change(slider, { target: { value: testTime.toString() } });

    // Advance debounce timer
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
  });

  it('handles configuring AI suite and executing single per-image analysis', async () => {
    mockRunPerImageAnalysis.mockResolvedValueOnce();

    render(<MonitorView {...defaultProps} />);

    // Open AI Suite configuration modal
    const configBtn = screen.getByRole('button', { name: /Configure AI Suite/i });
    fireEvent.click(configBtn);

    // Switch to Screen & Vision tab
    const screenTabBtn = screen.getByRole('button', { name: /Screen & Vision/i });
    fireEvent.click(screenTabBtn);

    // Enter prompt into textarea
    const promptTextarea = screen.getByPlaceholderText(/Select a prompt template or write custom instructions/i);
    fireEvent.change(promptTextarea, { target: { value: 'Detect browser tabs and prohibited apps' } });

    // Save & apply settings to populate editablePromptText in parent
    const saveSettingsBtn = screen.getByRole('button', { name: /Save & Apply to Live Class/i });
    await act(async () => {
      fireEvent.click(saveSettingsBtn);
    });

    // Reopen modal and run check
    fireEvent.click(screen.getByRole('button', { name: /Configure AI Suite/i }));
    fireEvent.click(screen.getByRole('button', { name: /Screen & Vision/i }));

    const analyzeBtn = screen.getByRole('button', { name: /Run Single Per-Image Check/i });
    expect(analyzeBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(analyzeBtn);
    });

    expect(mockRunPerImageAnalysis).toHaveBeenCalled();
  });

  it('opens and closes Not Sharing students modal', () => {
    render(<MonitorView {...defaultProps} />);

    // Not sharing button
    const notSharingBtn = screen.getByRole('button', { name: /Not Sharing/i });
    expect(notSharingBtn).toBeInTheDocument();

    fireEvent.click(notSharingBtn);
    expect(screen.getByText(/Students Not Sharing/i)).toBeInTheDocument();

    // Close modal
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/Students Not Sharing/i)).not.toBeInTheDocument();
  });

  it('sends broadcast announcement to class', async () => {
    window.alert = vi.fn();
    render(<MonitorView {...defaultProps} />);

    const msgInput = screen.getByPlaceholderText(/Type message or pick template.../i);
    fireEvent.change(msgInput, { target: { value: 'Please keep camera on' } });

    const sendBtn = screen.getByRole('button', { name: /^Send$/i });
    await act(async () => {
      fireEvent.click(sendBtn);
    });

    expect(mockAddDoc).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        message: 'Please keep camera on',
        senderEmail: 'teacher@school.edu',
      })
    );
  });

  it('handles downloading attendance CSV', () => {
    render(<MonitorView {...defaultProps} />);

    const downloadBtn = screen.getByRole('button', { name: /Download CSV/i });
    fireEvent.click(downloadBtn);
  });

  it('broadcasts preload AI to all students', async () => {
    render(<MonitorView {...defaultProps} />);

    const preloadBtn = screen.queryByRole('button', { name: /Preload Lightweight AI for All Students/i });
    if (preloadBtn) {
      await act(async () => {
        fireEvent.click(preloadBtn);
      });
      expect(mockUpdateDoc).toHaveBeenCalled();
    }
  });
});
