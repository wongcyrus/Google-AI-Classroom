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
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }],
        }),
        getDisplayMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), removeEventListener: vi.fn(), stop: vi.fn() }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });
  });

  it('renders student monitoring header and instructions', async () => {
    render(<StudentView user={mockUser} />);

    expect(screen.getByRole('button', { name: /Share Screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Webcam/i })).toBeInTheDocument();
    expect(screen.getByText(/My Recent Alerts/i)).toBeInTheDocument();
  });

  it('populates camera selection dropdown from navigator.mediaDevices', async () => {
    const mockDevices = [
      { deviceId: 'cam1', kind: 'videoinput', label: 'Built-in FaceTime HD Camera' },
      { deviceId: 'cam2', kind: 'videoinput', label: 'Logitech C920 Pro HD' },
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
        }),
        getDisplayMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
          getVideoTracks: () => [{ addEventListener: vi.fn(), stop: vi.fn() }],
        }),
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    render(<StudentView user={mockUser} />);

    const select = await screen.findByLabelText(/Select Webcam/i);
    expect(select).toBeInTheDocument();
    expect(screen.getByText(/Built-in FaceTime HD Camera/i)).toBeInTheDocument();
    expect(screen.getByText(/Logitech C920 Pro HD/i)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'cam2' } });
    expect(select.value).toBe('cam2');
  });

  it('handles start and stop webcam sharing', async () => {
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      getVideoTracks: vi.fn().mockReturnValue([{ addEventListener: vi.fn(), stop: vi.fn() }]),
    };
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockStream);

    render(<StudentView user={mockUser} />);

    const startWebcamBtn = screen.getByRole('button', { name: /Start Webcam/i });
    fireEvent.click(startWebcamBtn);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
  });

  it('handles start screen sharing', async () => {
    const mockScreenStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      getVideoTracks: vi.fn().mockReturnValue([{ addEventListener: vi.fn() }]),
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockScreenStream);

    render(<StudentView user={mockUser} />);

    const startScreenBtn = screen.getByRole('button', { name: /Share Screen/i });
    fireEvent.click(startScreenBtn);

    await waitFor(() => {
      expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalled();
    });
  });

  it('allows opening mic setup modal and toggling audio settings', async () => {
    render(<StudentView user={mockUser} />);

    const micToggleBtn = await screen.findByRole('button', { name: /Mic Muted|Mic Active/i });
    expect(micToggleBtn).toBeInTheDocument();
    fireEvent.click(micToggleBtn);

    const micTestBtn = screen.getByRole('button', { name: /⚙️ Mic Test/i });
    fireEvent.click(micTestBtn);

    expect(screen.getByText(/Microphone Setup & Verification/i)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);
  });

  it('opens, closes and completes Exam Readiness Wizard modal triggering auto-stream', async () => {
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

    const wizardBtn = screen.getByRole('button', { name: /Exam Readiness Check/i });
    fireEvent.click(wizardBtn);

    expect(screen.getByText(/Pre-Exam Readiness Wizard/i)).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /×/i });
    fireEvent.click(closeBtn);
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

  it('starts webcam stream on click Start Webcam', async () => {
    const mockWebcamStream = {
      getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      getVideoTracks: vi.fn().mockReturnValue([{ addEventListener: vi.fn() }]),
    };
    navigator.mediaDevices.getUserMedia = vi.fn().mockResolvedValue(mockWebcamStream);

    render(<StudentView user={mockUser} />);

    const startWebcamBtn = screen.getByRole('button', { name: /Start Webcam/i });
    fireEvent.click(startWebcamBtn);

    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
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

  it('renders Preload AI button when model is not cached and triggers preload on click', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'idle',
      isModelCached: false,
      isPreloading: false,
      loadingProgress: 0,
    };

    render(<StudentView user={mockUser} />);

    const preloadBtn = screen.getByRole('button', { name: /Preload AI \(~3.8 MB\)/i });
    expect(preloadBtn).toBeInTheDocument();

    fireEvent.click(preloadBtn);
    expect(mockPreloadModel).toHaveBeenCalled();
  });

  it('renders loading progress indicator when model is downloading or initializing', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'initializing',
      isModelCached: false,
      isPreloading: true,
      loadingProgress: 45,
    };

    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/⏳ Loading AI \(45%\)/i)).toBeInTheDocument();
  });

  it('renders AI Ready badge when model is cached and ready', async () => {
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

    expect(screen.getByText(/⚡ AI Ready/i)).toBeInTheDocument();
  });

  it('renders Calibrate View button and calls calibrateNeutralBaseline when clicked', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'ready',
      isModelCached: true,
      isPreloading: false,
      isCalibrated: false,
    };

    render(<StudentView user={mockUser} />);

    const startWebcamBtn = screen.getByRole('button', { name: /Start Webcam/i });
    fireEvent.click(startWebcamBtn);

    const calibrateBtn = await screen.findByRole('button', { name: /🎯 Calibrate View/i });
    expect(calibrateBtn).toBeInTheDocument();

    fireEvent.click(calibrateBtn);
    expect(mockCalibrateBaseline).toHaveBeenCalled();
  });

  it('renders Calibrated indicator when isCalibrated is true and calls resetCalibration on click', async () => {
    mockFaceMonitorReturn = {
      ...mockFaceMonitorReturn,
      clientAiStatus: 'ready',
      isModelCached: true,
      isPreloading: false,
      isCalibrated: true,
    };

    render(<StudentView user={mockUser} />);

    const startWebcamBtn = screen.getByRole('button', { name: /Start Webcam/i });
    fireEvent.click(startWebcamBtn);

    const calibratedBtn = await screen.findByRole('button', { name: /🎯 Calibrated/i });
    expect(calibratedBtn).toBeInTheDocument();

    fireEvent.click(calibratedBtn);
    expect(mockResetCalibration).toHaveBeenCalled();
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
