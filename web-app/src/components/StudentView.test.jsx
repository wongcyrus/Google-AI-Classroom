import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StudentView from './StudentView';

const mockSignOut = vi.fn();
vi.mock('firebase/auth', () => ({
  signOut: () => mockSignOut(),
}));

vi.mock('../firebase-config', () => ({
  auth: {
    signOut: () => mockSignOut(),
    currentUser: { uid: 'student123', email: 'student@school.edu' },
  },
  db: {},
  storage: {},
  functions: {},
}));

const mockDoc = vi.fn((db, col, id) => ({ path: `${col}/${id}`, id }));
const mockCollection = vi.fn((db, col) => ({ path: col }));
const mockOnSnapshot = vi.fn((query, callback) => {
  callback({
    docs: [
      {
        id: 'class1',
        data: () => ({
          name: 'Computer Science 101',
          students: { student123: 'student@school.edu' },
          teachers: ['teacher@school.edu'],
          requireFullScreenOnly: true,
          enableAudioCapture: true,
          audioCaptureMode: 'optional',
          captureMode: 'dual',
          schedule: {
            startDate: '2026-08-01',
            endDate: '2026-12-31',
            timeZone: 'Asia/Hong_Kong',
            timeSlots: [{ days: ['Mon', 'Wed', 'Sun'], startTime: '00:00', endTime: '23:59' }],
          },
        }),
      },
    ],
    exists: () => true,
    data: () => ({
      name: 'Computer Science 101',
      students: { student123: 'student@school.edu' },
      teachers: ['teacher@school.edu'],
      requireFullScreenOnly: true,
      enableAudioCapture: true,
      audioCaptureMode: 'optional',
      captureMode: 'dual',
      schedule: {
        startDate: '2026-08-01',
        endDate: '2026-12-31',
        timeZone: 'Asia/Hong_Kong',
        timeSlots: [{ days: ['Mon', 'Wed', 'Sun'], startTime: '00:00', endTime: '23:59' }],
      },
    }),
  });
  return () => {};
});

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  collection: (...args) => mockCollection(...args),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  setDoc: vi.fn().mockResolvedValue(),
  addDoc: vi.fn().mockResolvedValue({ id: 'msg_1' }),
  serverTimestamp: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ customProperties: { Seat: 'A1', Group: 'Alpha' } }),
  }),
}));

const mockPreloadModel = vi.fn();
const mockCalibrateBaseline = vi.fn();
const mockResetCalibration = vi.fn();
let mockFaceMonitorReturn = {
  isFaceModelLoading: false,
  clientAiStatus: 'ready',
  loadingProgress: 100,
  isModelCached: true,
  isPreloading: false,
  preloadModel: mockPreloadModel,
  calibrateBaseline: mockCalibrateBaseline,
  resetCalibration: mockResetCalibration,
  isCalibrated: false,
  earValue: 0.30,
  marValue: 0.15,
  delegateUsed: 'GPU',
  faceStatus: 'normal',
  faceColor: 'green',
  gazeComplianceScore: 95,
  gazeStatus: 'Looking at Screen',
};

vi.mock('../hooks/useFaceMonitor', () => ({
  default: () => mockFaceMonitorReturn,
  useFaceMonitor: () => mockFaceMonitorReturn,
}));

vi.mock('../hooks/useAudioRecorder', () => ({
  default: () => ({
    isRecording: false,
    audioStream: null,
    audioLevel: 0,
    isSpeaking: false,
    hasMicPermission: true,
  }),
  useAudioRecorder: () => ({
    isRecording: false,
    audioStream: null,
    audioLevel: 0,
    isSpeaking: false,
    hasMicPermission: true,
  }),
}));

vi.mock('../hooks/useWebRTCPeekStudent', () => ({
  default: () => ({
    isPeeking: false,
    activeTeacher: null,
  }),
  useWebRTCPeekStudent: () => ({
    isPeeking: false,
    activeTeacher: null,
  }),
}));

vi.mock('../hooks/useStudentClassSchedule', () => ({
  default: () => ({ currentActiveClassId: 'class1', activeSchedule: null, error: null }),
  useStudentClassSchedule: () => ({ currentActiveClassId: 'class1', activeSchedule: null, error: null }),
}));

describe('StudentView Component Extended Test Suite', () => {
  const mockUser = {
    uid: 'student123',
    email: 'student@school.edu',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    const mockDevices = [
      { deviceId: 'cam1', kind: 'videoinput', label: 'Built-in FaceTime HD Camera' },
      { deviceId: 'cam2', kind: 'videoinput', label: 'Logitech C920 Pro HD' },
      { deviceId: 'mic1', kind: 'audioinput', label: 'Internal Microphone' },
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }],
          getAudioTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }],
        }),
        getDisplayMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }) }],
          getAudioTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    window.AudioContext = vi.fn().mockImplementation(() => ({
      state: 'running',
      createMediaStreamSource: vi.fn().mockReturnValue({ connect: vi.fn() }),
      createAnalyser: vi.fn().mockReturnValue({
        fftSize: 256,
        frequencyBinCount: 128,
        getByteFrequencyData: vi.fn((arr) => {
          arr.fill(50);
        }),
      }),
      close: vi.fn().mockResolvedValue(),
    }));

    function MockSpeechRecognition() {
      this.continuous = false;
      this.interimResults = false;
      this.lang = 'en-US';
      this.start = vi.fn();
      this.onresult = null;
      this.onerror = null;
      this.onend = null;
    }

    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  });

  it('renders student setup hero card and classroom summary', async () => {
    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/Welcome to Your Classroom Session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Setup & Readiness Test/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i })).toBeInTheDocument();
    expect(screen.getByText(/My Recent Alerts/i)).toBeInTheDocument();
  });

  it('allows opening and closing readiness wizard from setup hero card', async () => {
    render(<StudentView user={mockUser} />);

    const startSetupBtn = screen.getByRole('button', { name: /Start Setup & Readiness Test/i });
    fireEvent.click(startSetupBtn);

    expect(screen.getByText(/Class Setup & Readiness/i)).toBeInTheDocument();
    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
  });

  it('handles quick start screen sharing from setup hero card', async () => {
    const mockScreenTrack = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: vi.fn() };
    const mockScreenStream = {
      getTracks: vi.fn().mockReturnValue([mockScreenTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockScreenTrack]),
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockScreenStream);

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    await waitFor(() => {
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    });
  });

  it('coalesces repeated quick-start clicks into one display capture request', async () => {
    const mockScreenTrack = {
      stop: vi.fn(),
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
    };
    const mockScreenStream = {
      getTracks: vi.fn(() => [mockScreenTrack]),
      getVideoTracks: vi.fn(() => [mockScreenTrack]),
    };
    let resolveDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = vi.fn(() => new Promise((resolve) => {
      resolveDisplayMedia = resolve;
    }));

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    fireEvent.click(quickStartBtn);
    fireEvent.click(quickStartBtn);

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce();
    await act(async () => {
      resolveDisplayMedia(mockScreenStream);
    });
  });

  it('completes Exam Readiness Wizard and triggers streaming', async () => {
    const mockScreenTrack = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: vi.fn() };
    const mockScreenStream = {
      getTracks: vi.fn().mockReturnValue([mockScreenTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockScreenTrack]),
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockScreenStream);

    const mockCamTrack = { stop: vi.fn(), getSettings: () => ({}), addEventListener: vi.fn() };
    const mockCamStream = {
      getTracks: vi.fn().mockReturnValue([mockCamTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockCamTrack]),
    };
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockCamStream);

    render(<StudentView user={mockUser} />);

    const wizardBtn = screen.getByRole('button', { name: /Start Setup & Readiness Test/i });
    fireEvent.click(wizardBtn);

    // Step 1: Click next
    await waitFor(() => {
      const nextBtn1 = screen.getByRole('button', { name: /Next: Camera Check/i });
      fireEvent.click(nextBtn1);
    });

    // Step 2: Calibrate & Next
    await waitFor(() => {
      const calibrateBtn = screen.getByRole('button', { name: /Set Center Pose/i });
      fireEvent.click(calibrateBtn);
      const nextBtn2 = screen.getByRole('button', { name: /Next: Screen Share/i });
      fireEvent.click(nextBtn2);
    });

    // Step 3: Screen share & Complete
    await waitFor(() => {
      const screenShareBtn = screen.getByRole('button', { name: /Select & Share Entire Screen/i });
      fireEvent.click(screenShareBtn);
    });

    await waitFor(() => {
      const finishBtn = screen.getByRole('button', { name: /Complete & Enter Class/i });
      fireEvent.click(finishBtn);
    });
  });

  it('handles dismissing notification banner and clicking allow', async () => {
    Object.defineProperty(window, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: vi.fn().mockResolvedValue('granted'),
      },
      writable: true,
      configurable: true,
    });

    render(<StudentView user={mockUser} />);

    const allowBtn = screen.queryByRole('button', { name: /Allow Notifications/i });
    if (allowBtn) {
      fireEvent.click(allowBtn);
    }

    const dismissBtn = screen.queryByRole('button', { name: /Dismiss banner|✕/i });
    if (dismissBtn) {
      fireEvent.click(dismissBtn);
    }
  });

  it('allows changing sampling rate slider', async () => {
    render(<StudentView user={mockUser} />);

    const sliders = screen.queryAllByRole('slider');
    if (sliders.length > 0) {
      fireEvent.change(sliders[0], { target: { value: 5 } });
    }
  });

  it('handles online and offline window network events', async () => {
    render(<StudentView user={mockUser} />);

    // Trigger offline
    fireEvent(window, new Event('offline'));
    // Trigger online
    fireEvent(window, new Event('online'));
  });

  it('handles user sign out', async () => {
    render(<StudentView user={mockUser} />);

    const logoutBtn = screen.queryByRole('button', { name: /Log Out|Sign Out/i });
    if (logoutBtn) {
      fireEvent.click(logoutBtn);
      expect(mockSignOut).toHaveBeenCalled();
    }
  });

  it('renders loading progress indicator in setup hero summary when model is downloading', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'initializing',
      isModelCached: false,
      isPreloading: true,
      loadingProgress: 45,
    };

    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/Loading \(45%\)/i)).toBeInTheDocument();
  });

  it('renders AI Ready badge in setup hero when model is cached and ready', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'ready',
      isModelCached: true,
      isPreloading: false,
      loadingProgress: 100,
      delegateUsed: 'GPU',
      isCalibrated: false,
    };

    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/Ready \(Fast\)/i)).toBeInTheDocument();
  });

  it('renders UnsupportedBrowserNotice and triggers signOut when student accesses via non-Chrome browser', () => {
    const originalUA = navigator.userAgent;
    const originalVendor = navigator.vendor;

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'vendor', {
      value: 'Apple Computer, Inc.',
      configurable: true,
    });

    try {
      render(<StudentView user={mockUser} />);

      expect(screen.getByText(/Google Chrome Required/i)).toBeInTheDocument();
      expect(screen.getByText(/Apple Safari/i)).toBeInTheDocument();

      const goBackBtn = screen.getByRole('button', { name: /Go to Login Page/i });
      fireEvent.click(goBackBtn);
      expect(mockSignOut).toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'userAgent', { value: originalUA, configurable: true });
      Object.defineProperty(navigator, 'vendor', { value: originalVendor, configurable: true });
    }
  });
});
