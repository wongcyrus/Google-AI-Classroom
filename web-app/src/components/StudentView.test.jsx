import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StudentView from './StudentView';

const mockSignOut = vi.fn();
vi.mock('firebase/auth', () => ({
  signOut: () => mockSignOut(),
}));

const mockCallableInstance = vi.fn().mockResolvedValue({ data: { success: true, result: 'passed' } });
const mockHttpsCallable = vi.fn(() => mockCallableInstance);
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args) => mockHttpsCallable(...args),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
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

let testExamActive = false;
let testExamPeriods = [];
let snapshotCallbacks = [];
const mockDoc = vi.fn((db, ...args) => ({ path: args.join('/'), id: args[args.length - 1] }));
const mockCollection = vi.fn((db, ...args) => ({ path: args.join('/') }));
const mockOnSnapshot = vi.fn((refOrQuery, callback) => {
  snapshotCallbacks.push({ ref: refOrQuery, callback });
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
          isExamActive: testExamActive,
          examPeriods: testExamPeriods,
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
      isExamActive: testExamActive,
      examPeriods: testExamPeriods,
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

const mockSetDoc = vi.fn().mockResolvedValue();

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  collection: (...args) => mockCollection(...args),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  setDoc: (...args) => mockSetDoc(...args),
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

let mockWhisperReturn = {
  transcript: '',
  whisperStatus: 'ready',
  isWhisperCached: true,
  preloadWhisperModel: vi.fn(),
};

let mockGemmaReturn = {
  latestEvaluation: null,
  isGemmaReady: true,
  isGemmaCached: true,
  preloadGemmaModel: vi.fn(),
  gemmaStatus: 'ready',
  shouldEvaluateVoiceWithGemma: true,
};

let mockTeacherBroadcastReturn = {
  isBroadcastActive: false,
  broadcastInfo: null,
  liveFrame: null,
  connectionState: 'idle',
  joinBroadcast: vi.fn(),
  leaveBroadcast: vi.fn(),
};

vi.mock('../hooks/useClientLiteRTWhisper', () => ({
  default: () => mockWhisperReturn,
  useClientLiteRTWhisper: () => mockWhisperReturn,
}));

vi.mock('../hooks/useClientLiteRTGemma', () => ({
  default: () => mockGemmaReturn,
  useClientLiteRTGemma: () => mockGemmaReturn,
}));

vi.mock('../hooks/useTeacherScreenBroadcastStudent', () => ({
  default: () => mockTeacherBroadcastReturn,
  useTeacherScreenBroadcastStudent: () => mockTeacherBroadcastReturn,
}));

let mockScheduleReturn = { currentActiveClassId: 'class1', activeSchedule: null, error: null, userClasses: ['class1'] };

vi.mock('../hooks/useStudentClassSchedule', () => ({
  default: () => mockScheduleReturn,
  useStudentClassSchedule: () => mockScheduleReturn,
}));

let mockSubtitlesReturn = {
  active: false,
  originalText: '',
  translations: {},
  currentTranslation: '',
  availableLanguages: [
    { code: 'zh-Hans', label: '简体中文' },
    { code: 'en', label: 'English' },
  ],
  selectedLanguage: 'zh-Hans',
  setSelectedLanguage: vi.fn(),
  displayMode: 'bilingual',
  setDisplayMode: vi.fn(),
  fontSize: 'medium',
  setFontSize: vi.fn(),
  isVisible: true,
  setIsVisible: vi.fn(),
  engine: 'cloud',
  recentHistory: [],
};

vi.mock('../hooks/useStudentLiveSubtitles', () => ({
  default: () => mockSubtitlesReturn,
  useStudentLiveSubtitles: () => mockSubtitlesReturn,
}));


describe('StudentView Component Extended Test Suite', () => {
  const mockUser = {
    uid: 'student123',
    email: 'student@school.edu',
  };

  beforeEach(() => {
    testExamActive = false;
    testExamPeriods = [];
    mockScheduleReturn = { currentActiveClassId: 'class1', activeSchedule: null, error: null, userClasses: ['class1'] };
    vi.clearAllMocks();
    window.alert = vi.fn();
    snapshotCallbacks = [];

    mockWhisperReturn = {
      status: 'ready',
      loadingProgress: 100,
      isModelCached: true,
      delegateUsed: 'wasm',
      latestTranscript: '',
      latestLanguage: 'english',
      preloadModel: vi.fn(),
      transcribeAudioChunk: vi.fn(),
      setLatestTranscript: vi.fn(),
    };
    mockGemmaReturn = {
      latestEvaluation: null,
      isGemmaReady: true,
      isGemmaCached: true,
      preloadGemmaModel: vi.fn(),
      gemmaStatus: 'ready',
      shouldEvaluateVoiceWithGemma: true,
    };
    mockTeacherBroadcastReturn = {
      isBroadcastActive: false,
      broadcastInfo: null,
      liveFrame: null,
      connectionState: 'idle',
      joinBroadcast: vi.fn(),
      leaveBroadcast: vi.fn(),
    };

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

    mockSubtitlesReturn = {
      active: false,
      originalText: '',
      translations: {},
      currentTranslation: '',
      availableLanguages: [
        { code: 'zh-Hans', label: '简体中文' },
        { code: 'en', label: 'English' },
      ],
      selectedLanguage: 'zh-Hans',
      setSelectedLanguage: vi.fn(),
      displayMode: 'bilingual',
      setDisplayMode: vi.fn(),
      fontSize: 'medium',
      setFontSize: vi.fn(),
      isVisible: true,
      setIsVisible: vi.fn(),
      engine: 'cloud',
      recentHistory: [],
    };
  });

  it('renders student setup hero card and classroom summary', async () => {
    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/Welcome to Your Classroom Session/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Setup & Readiness Test/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /My Records/i })).not.toBeInTheDocument();
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

    await waitFor(() => {
      expect(screen.getByText(/Live invigilation active/i)).toBeInTheDocument();
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

  it('rejects single application window share and displays alert when requireFullScreenOnly is true', async () => {
    const mockWindowTrack = {
      stop: vi.fn(),
      getSettings: () => ({ displaySurface: 'window' }),
      addEventListener: vi.fn(),
    };
    const mockWindowStream = {
      getTracks: vi.fn().mockReturnValue([mockWindowTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockWindowTrack]),
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockWindowStream);

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    expect(mockWindowTrack.stop).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Entire Screen Required'));
  });

  it('allows muting audio in active invigilation mode', async () => {
    const mockScreenTrack = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor' }), addEventListener: vi.fn() };
    const mockScreenStream = {
      getTracks: vi.fn().mockReturnValue([mockScreenTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockScreenTrack]),
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(mockScreenStream);

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

    await waitFor(() => {
      expect(screen.getByText(/Live invigilation active/i)).toBeInTheDocument();
    });

    // Mute mic button
    const muteBtn = screen.queryByRole('button', { name: /Mic Active/i });
    if (muteBtn) {
      fireEvent.click(muteBtn);
      expect(screen.getByRole('button', { name: /Unmute/i })).toBeInTheDocument();
    }
  });

  it('handles offline queue buffering when offline', async () => {
    render(<StudentView user={mockUser} />);
    fireEvent(window, new Event('offline'));
    fireEvent(window, new Event('online'));
  });

  it('renders Whisper transcript and Gemma intent evaluation when speech is detected', async () => {
    mockWhisperReturn = {
      ...mockWhisperReturn,
      latestTranscript: 'Can you help me with question 3?',
    };
    mockGemmaReturn = {
      ...mockGemmaReturn,
      latestEvaluation: {
        category: 'COLLABORATION',
        isViolation: true,
        rationale: 'Student asked for question help',
        confidence: 0.95,
      },
    };

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Transcribed Speech:/i)).toBeInTheDocument();
      expect(screen.getByText(/"Can you help me with question 3\?"*/i)).toBeInTheDocument();
      expect(screen.getByText(/Gemma Intent Check:/i)).toBeInTheDocument();
      expect(screen.getByText(/COLLABORATION 🚨 FLAGGED/i)).toBeInTheDocument();
      expect(screen.getByText(/Student asked for question help/i)).toBeInTheDocument();
      expect(screen.getByText(/Confidence: 95%/i)).toBeInTheDocument();
    });
  });

  it('automatically opens TeacherScreenViewerModal when teacher broadcast starts and joins broadcast', async () => {
    mockTeacherBroadcastReturn = {
      ...mockTeacherBroadcastReturn,
      isBroadcastActive: true,
      broadcastInfo: { title: 'Exam Instructions Review', teacherEmail: 'teacher@school.edu' },
    };

    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      expect(mockTeacherBroadcastReturn.joinBroadcast).toHaveBeenCalled();
      expect(screen.getByText(/teacher@school\.edu's Screen/i)).toBeInTheDocument();
    });

    const closeBtn = screen.getByTitle('Close Stream');
    fireEvent.click(closeBtn);
    expect(mockTeacherBroadcastReturn.leaveBroadcast).toHaveBeenCalled();
  });

  it('allows manual preloading of Gemma intent model from setup hero', async () => {
    mockGemmaReturn = {
      ...mockGemmaReturn,
      isGemmaReady: false,
      isGemmaCached: false,
      gemmaStatus: 'idle',
      shouldEvaluateVoiceWithGemma: true,
    };

    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const preloadBtns = screen.getAllByRole('button', { name: /Preload/i });
      expect(preloadBtns.length).toBeGreaterThan(0);
      fireEvent.click(preloadBtns[0]);
    });
    expect(mockGemmaReturn.preloadGemmaModel).toHaveBeenCalled();
  });

  it('handles session displacement and resuming session in current tab', async () => {
    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const statusCallbackObj = snapshotCallbacks.find(item => item.ref?.path?.includes('status'));
      expect(statusCallbackObj).toBeDefined();
    });

    const statusCallbackObj = snapshotCallbacks.find(item => item.ref?.path?.includes('status'));
    act(() => {
      statusCallbackObj.callback({
        exists: () => true,
        data: () => ({ sessionId: 'different-uuid-from-another-tab' }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Classroom session active in another tab or device/i)).toBeInTheDocument();
    });

    const resumeBtn = screen.getByRole('button', { name: /Resume Here/i });
    fireEvent.click(resumeBtn);

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: expect.any(String) }),
      { merge: true }
    );
  });

  it('allows switching webcam selection in active invigilation mode', async () => {
    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    const camSelect = screen.getByLabelText(/Select Webcam/i);
    expect(camSelect).toBeInTheDocument();

    await act(async () => {
      fireEvent.change(camSelect, { target: { value: 'cam2' } });
    });

    expect(camSelect.value).toBe('cam2');
  });

  it('handles permission denied error when student rejects screen sharing', async () => {
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('Could not start screen sharing. Please grant permission.')
    );
  });

  it('alerts student when browser does not support getDisplayMedia', async () => {
    const originalGetDisplayMedia = navigator.mediaDevices.getDisplayMedia;
    navigator.mediaDevices.getDisplayMedia = undefined;

    render(<StudentView user={mockUser} />);

    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    expect(window.alert).toHaveBeenCalledWith(
      expect.stringContaining('Screen sharing is not supported by your browser')
    );

    navigator.mediaDevices.getDisplayMedia = originalGetDisplayMedia;
  });

  it('renders Official Examination banner when exam is active in class', async () => {
    testExamActive = true;
    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText(/Official Examination in Progress — Proctored Session/i)).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Full screen sharing and continuous proctoring are mandatory/i)
    ).toBeInTheDocument();
  });

  it('does NOT popup BingoModal when activeBingo in studentProperties has expired', async () => {
    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
      expect(studentPropsCallback).toBeDefined();
    });

    const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
    act(() => {
      studentPropsCallback.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'expired_bingo_123',
            question: 'What is Kubernetes?',
            options: ['Tool', 'Car', 'Book', 'Game'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() - 60000, // Expired 1 minute ago
          },
        }),
      });
    });

    // Bingo modal must NOT appear
    expect(screen.queryByText('🎯 Class Bingo Check')).toBeNull();
    expect(screen.queryByText('What is Kubernetes?')).toBeNull();
  });

  it('renders BingoModal when activeBingo is fresh and pending', async () => {
    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
      expect(studentPropsCallback).toBeDefined();
    });

    const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
    act(() => {
      studentPropsCallback.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'fresh_bingo_123',
            question: 'What is React JSX?',
            options: ['Syntax extension', 'Database', 'Operating System', 'Network Cable'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() + 45000, // Valid for 45s
          },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText('🎯 Class Bingo Check')).toBeInTheDocument();
      expect(screen.getByText('What is React JSX?')).toBeInTheDocument();
    });
  });

  it('receives and submits Bingo challenge for inactive-schedule class when enrolled in multiple classes', async () => {
    mockScheduleReturn = {
      currentActiveClassId: 'class1',
      activeClassIds: ['class1'],
      activeSchedule: null,
      error: null,
      userClasses: [
        { id: 'class1', name: 'Cloud Computing' },
        { id: 'class2', name: 'DevOps & CI/CD' },
      ],
    };

    render(<StudentView user={mockUser} />);

    // Locate studentProperties subscription for class2
    await waitFor(() => {
      const class2PropsCb = snapshotCallbacks.slice().reverse().find(item =>
        item.ref?.path === 'classes/class2/studentProperties/student123'
      );
      expect(class2PropsCb).toBeDefined();
    });

    const class2PropsCb = snapshotCallbacks.slice().reverse().find(item =>
      item.ref?.path === 'classes/class2/studentProperties/student123'
    );

    // Teacher in class2 issues a Bingo challenge
    await act(async () => {
      class2PropsCb.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'devops_bingo_777',
            classId: 'class2',
            question: 'What file configures GitHub Actions workflows?',
            options: ['.github/workflows/ci.yml', 'Jenkinsfile', 'Dockerfile', 'package.json'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() + 45000,
          },
        }),
      });
    });

    // Verify Bingo modal is displayed with the class2 identifier
    await waitFor(() => {
      expect(screen.getByText('What file configures GitHub Actions workflows?')).toBeInTheDocument();
      expect(screen.getByTestId('bingo-class-pill')).toHaveTextContent('DevOps & CI/CD');
      expect(screen.getByText('.github/workflows/ci.yml')).toBeInTheDocument();
    });

    // Select the correct option
    const optionBtn = screen.getByTestId('bingo-option-0');
    await act(async () => {
      fireEvent.click(optionBtn);
    });

    // Verify submitBingoAnswer was called with classId: 'class2'
    expect(mockCallableInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class2',
        bingoId: 'devops_bingo_777',
        selectedIndex: 0,
      })
    );
  });

  it('ignores stale flat activeBingo.status keys and renders new pending activeBingo challenge', async () => {
    mockScheduleReturn = {
      currentActiveClassId: 'class1',
      activeClassIds: ['class1'],
      activeSchedule: null,
      error: null,
      userClasses: [
        { id: 'class1', name: 'Cloud Computing 101' },
      ],
    };

    render(<StudentView user={mockUser} />);

    // Simulate studentProperties snapshot having stale flat keys ('activeBingo.status': 'passed') alongside new pending challenge
    const studentPropCb = snapshotCallbacks.find(item => item.ref?.path === 'classes/class1/studentProperties/student123');
    expect(studentPropCb).toBeDefined();

    act(() => {
      studentPropCb.callback({
        exists: () => true,
        data: () => ({
          'activeBingo.status': 'passed',
          'activeBingo.result': 'passed',
          'activeBingo.responseTimeSec': 12,
          activeBingo: {
            bingoId: 'fresh_challenge_999',
            classId: 'class1',
            question: 'What is the capital of Cloud Computing?',
            options: ['Datacenter', 'Server', 'Silicon', 'Kubernetes'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() + 45000,
          },
        }),
      });
    });

    // Verify Bingo modal is displayed and not suppressed by 'passed' flat key
    await waitFor(() => {
      expect(screen.getByText('What is the capital of Cloud Computing?')).toBeInTheDocument();
      expect(screen.getByText('Datacenter')).toBeInTheDocument();
    });
  });

  it('sanitizes and deduplicates class metadata debug logs without leaking student emails', async () => {
    const logSpy = vi.spyOn(console, 'log');

    render(<StudentView user={mockUser} />);

    // Trigger class snapshot with sensitive student and teacher lists
    const classSnapshotCb = snapshotCallbacks.find(item => item.ref?.path === 'classes/class1');
    expect(classSnapshotCb).toBeDefined();

    await act(async () => {
      classSnapshotCb.callback({
        exists: () => true,
        data: () => ({
          name: 'Secure Network Architecture',
          captureMode: 'dual',
          frameRate: 15,
          isCapturing: true,
          isExamActive: false,
          studentEmails: ['classmate_a@gmail.com', 'classmate_b@gmail.com'],
          students: {
            uid_a: 'classmate_a@gmail.com',
            uid_b: 'classmate_b@gmail.com',
          },
          teacherEmails: ['head_instructor@vtc.edu.hk'],
          teachers: { tuid: 'head_instructor@vtc.edu.hk' },
        }),
      });
    });

    // Verify no debug logs for class metadata or raw class data are emitted
    const debugLogs = logSpy.mock.calls.filter(call =>
      typeof call[0] === 'string' && (
        call[0].includes('[StudentView] DEBUG:') ||
        call[0].includes('Raw class data:')
      )
    );
    expect(debugLogs.length).toBe(0);

    // Verify sensitive student/teacher emails are never logged
    const loggedText = logSpy.mock.calls.map(call => JSON.stringify(call)).join(' ');
    expect(loggedText).not.toContain('classmate_a@gmail.com');
    expect(loggedText).not.toContain('classmate_b@gmail.com');
    expect(loggedText).not.toContain('head_instructor@vtc.edu.hk');

    logSpy.mockRestore();
  });

  it('renders UnenrolledStudentView when student has no active class and no enrolled classes', () => {
    mockScheduleReturn = { currentActiveClassId: null, activeSchedule: null, error: null, userClasses: [] };
    render(<StudentView user={mockUser} />);
    expect(screen.getByTestId('unenrolled-student-view')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Instructor Enrollment')).toBeInTheDocument();
    expect(screen.getByText('student@school.edu')).toBeInTheDocument();
  });

  it('allows student to switch from desktop view to mobile companion view', async () => {
    render(<StudentView user={mockUser} />);
    const mobileSwitchBtn = screen.getByRole('button', { name: /mobile view/i });
    expect(mobileSwitchBtn).toBeInTheDocument();

    fireEvent.click(mobileSwitchBtn);

    // Now in mobile companion view
    await waitFor(() => {
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /switch to desktop/i })).toBeInTheDocument();
    });
  });

  it('allows student to manually switch class even when currentActiveClassId is present, persisting override and showing Follow Schedule button', async () => {
    localStorage.clear();
    mockScheduleReturn = {
      currentActiveClassId: 'class1',
      activeClassIds: ['class1'],
      activeSchedule: null,
      error: null,
      userClasses: ['class1', 'class2'],
    };

    render(<StudentView user={mockUser} />);

    // Initially activeClass is class1
    expect(screen.getByText('Class: class1')).toBeInTheDocument();

    // Select class2 from dropdown
    const select = screen.getByLabelText('Select Enrolled Class');
    expect(select).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'class2' } });

    // Should now be class2 and not snap back to class1
    await waitFor(() => {
      expect(screen.getByText('Class: class2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Follow Schedule \(class1\)/i })).toBeInTheDocument();
    });

    // Clicking Follow Schedule should revert to class1
    const followScheduleBtn = screen.getByRole('button', { name: /Follow Schedule \(class1\)/i });
    fireEvent.click(followScheduleBtn);

    await waitFor(() => {
      expect(screen.getByText('Class: class1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Follow Schedule/i })).not.toBeInTheDocument();
    });
  });

  it('allows switching active class during active session and shows scheduled indicator', async () => {
    localStorage.clear();
    mockScheduleReturn = {
      currentActiveClassId: 'class1',
      activeClassIds: ['class1', 'class2'],
      activeSchedule: null,
      error: null,
      userClasses: ['class1', 'class2'],
    };

    render(<StudentView user={mockUser} />);

    // Start sharing
    const quickStartBtn = screen.getByRole('button', { name: /Quick Start \(Screen Only\)/i });
    await act(async () => {
      fireEvent.click(quickStartBtn);
    });

    // Active session switcher should exist
    const activeSwitcher = await screen.findByLabelText('Switch Active Class Session');
    expect(activeSwitcher).toBeInTheDocument();

    // Switch to class2
    await act(async () => {
      fireEvent.change(activeSwitcher, { target: { value: 'class2' } });
    });

    expect(activeSwitcher.value).toBe('class2');
  });

  it('allows switching between desktop mode and mobile companion view', async () => {
    localStorage.clear();
    const onViewModeChange = vi.fn();
    render(<StudentView user={mockUser} onViewModeChange={onViewModeChange} />);

    expect(onViewModeChange).toHaveBeenCalledWith('desktop');

    // Switch to Mobile Companion Mode
    const switchMobileBtn = screen.getByRole('button', { name: /Mobile View/i });
    await act(async () => {
      fireEvent.click(switchMobileBtn);
    });

    expect(document.body.classList.contains('in-student-mobile-view')).toBe(true);
    expect(onViewModeChange).toHaveBeenCalledWith('mobile');

    // Switch back to Desktop mode
    const switchDesktopBtn = screen.getByRole('button', { name: /Switch to Desktop Invigilation/i });
    await act(async () => {
      fireEvent.click(switchDesktopBtn);
    });

    expect(document.body.classList.contains('in-student-mobile-view')).toBe(false);
    expect(onViewModeChange).toHaveBeenCalledWith('desktop');
  });

  it('renders YouTube-style player bottom bar and supports toggling screen modes (max, smallest, standard)', async () => {
    localStorage.clear();
    mockTeacherBroadcastReturn.isBroadcastActive = true;
    mockTeacherBroadcastReturn.liveFrame = 'data:image/jpeg;base64,frame123';

    render(<StudentView user={mockUser} />);

    // YouTube bottom bar should be rendered
    const playerBar = screen.getByRole('toolbar', { name: /Player Controls/i });
    expect(playerBar).toBeInTheDocument();

    // Default mode is standard
    const contentContainer = document.querySelector('.student-view-content');
    expect(contentContainer.classList.contains('mode-standard')).toBe(true);

    // Switch to Max (Theater) mode using title
    const maxBtn = screen.getByTitle('Max / Theater Mode (Full Width)');
    await act(async () => {
      fireEvent.click(maxBtn);
    });

    expect(contentContainer.classList.contains('mode-max')).toBe(true);
    expect(localStorage.getItem('student_desktop_screen_mode')).toBe('max');

    // Switch to Smallest (Mini-Player) mode using title
    const smallestBtn = screen.getByTitle('Smallest / Mini-Player Mode (Compact Corner)');
    await act(async () => {
      fireEvent.click(smallestBtn);
    });

    expect(contentContainer.classList.contains('mode-smallest')).toBe(true);
    expect(localStorage.getItem('student_desktop_screen_mode')).toBe('smallest');
    expect(screen.getByText(/Mini-Player Active:/i)).toBeInTheDocument();

    // Switch back to Standard mode using title
    const standardBtn = screen.getByTitle('Standard Mode (Side-by-Side)');
    await act(async () => {
      fireEvent.click(standardBtn);
    });

    expect(contentContainer.classList.contains('mode-standard')).toBe(true);
    expect(localStorage.getItem('student_desktop_screen_mode')).toBe('standard');
  });

  it('renders YouTube-style closed captions overlay, supports toggling CC and changing language/settings', async () => {
    mockTeacherBroadcastReturn.isBroadcastActive = true;
    mockTeacherBroadcastReturn.liveFrame = 'data:image/jpeg;base64,frame123';
    mockSubtitlesReturn.active = true;
    mockSubtitlesReturn.originalText = 'Welcome to today lecture';
    mockSubtitlesReturn.currentTranslation = '欢迎来到今天的讲座';

    render(<StudentView user={mockUser} />);

    // Check closed captions cues in player overlay specifically
    const originalCue = document.querySelector('.youtube-cc-cue.original .youtube-cc-text');
    const translatedCue = document.querySelector('.youtube-cc-cue.translated .youtube-cc-text');
    expect(originalCue).toHaveTextContent('Welcome to today lecture');
    expect(translatedCue).toHaveTextContent('欢迎来到今天的讲座');

    // YouTube CC toggle button
    const ccBtn = document.querySelector('.yt-cc-btn');
    expect(ccBtn).toBeInTheDocument();
    expect(ccBtn.classList.contains('active')).toBe(true);

    // Toggle CC off
    await act(async () => {
      fireEvent.click(ccBtn);
    });
    expect(document.querySelector('.youtube-cc-cue-container')).toBeNull();
    expect(ccBtn.classList.contains('active')).toBe(false);

    // Toggle CC back on
    await act(async () => {
      fireEvent.click(ccBtn);
    });
    expect(document.querySelector('.youtube-cc-cue-container')).toBeInTheDocument();
    expect(document.querySelector('.youtube-cc-cue.original .youtube-cc-text')).toHaveTextContent('Welcome to today lecture');

    // Language dropdown
    const langSelect = screen.getByRole('combobox', { name: /Caption Language/i });
    expect(langSelect).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(langSelect, { target: { value: 'en' } });
    });
    expect(mockSubtitlesReturn.setSelectedLanguage).toHaveBeenCalledWith('en');

    // Settings popover
    const settingsBtn = screen.getByTitle('Subtitle and Player Settings');
    await act(async () => {
      fireEvent.click(settingsBtn);
    });

    expect(screen.getByText('CC Font Size')).toBeInTheDocument();
    const largeFontBtn = screen.getByRole('button', { name: 'Large' });
    await act(async () => {
      fireEvent.click(largeFontBtn);
    });
    expect(mockSubtitlesReturn.setFontSize).toHaveBeenCalledWith('large');
  });

  it('guarantees Classroom Bingo presence alert banner and modal persist safely across screen modes', async () => {
    mockTeacherBroadcastReturn.isBroadcastActive = true;
    mockTeacherBroadcastReturn.liveFrame = 'data:image/jpeg;base64,frame123';

    render(<StudentView user={mockUser} />);

    // Simulate active, valid Bingo challenge arriving from Firestore
    await waitFor(() => {
      const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
      expect(studentPropsCallback).toBeDefined();
    });

    const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
    act(() => {
      studentPropsCallback.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'safe_bingo_999',
            question: 'Is attendance mandatory for this session?',
            options: ['Yes, fully mandatory', 'No, optional', 'Only for audit', 'Not sure'],
            timeLimitSeconds: 60,
            status: 'pending',
            expiresAtMillis: Date.now() + 60000,
          },
        }),
      });
    });

    // Top alert banner MUST be rendered
    await waitFor(() => {
      expect(screen.getByText('Classroom Bingo Presence Challenge Active!')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Answer Challenge ➔/i })).toBeInTheDocument();
    });

    // Bingo modal MUST also be rendered
    expect(screen.getByText('🎯 Class Bingo Check')).toBeInTheDocument();
    expect(screen.getByText('Is attendance mandatory for this session?')).toBeInTheDocument();

    // Switch screen modes while Bingo is active: mode-max
    const maxBtn = screen.getByRole('button', { name: /^🗖 Max$/i });
    await act(async () => {
      fireEvent.click(maxBtn);
    });

    // Verify Bingo challenge and banner are NOT dismissed or broken
    expect(screen.getByText('Classroom Bingo Presence Challenge Active!')).toBeInTheDocument();
    expect(screen.getByText('Is attendance mandatory for this session?')).toBeInTheDocument();

    // Switch to mode-smallest
    const smallestBtn = screen.getByRole('button', { name: /^🗗 Smallest$/i });
    await act(async () => {
      fireEvent.click(smallestBtn);
    });

    // Verify Bingo challenge is STILL present and intact
    expect(screen.getByText('Classroom Bingo Presence Challenge Active!')).toBeInTheDocument();
    expect(screen.getByText('Is attendance mandatory for this session?')).toBeInTheDocument();
  });

  it('proactively exits native browser fullscreen when an active Bingo challenge arrives', async () => {
    const mockExitFullscreen = vi.fn().mockResolvedValue();
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.createElement('div'),
      configurable: true,
      writable: true,
    });
    document.exitFullscreen = mockExitFullscreen;

    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
      expect(studentPropsCallback).toBeDefined();
    });

    const studentPropsCallback = snapshotCallbacks.find(item => item.ref?.path?.includes('studentProperties'));
    act(() => {
      studentPropsCallback.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'fullscreen_bingo_123',
            question: 'Confirm your screen presence now',
            options: ['Confirmed', 'Absent'],
            timeLimitSeconds: 30,
            status: 'pending',
            expiresAtMillis: Date.now() + 30000,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(mockExitFullscreen).toHaveBeenCalled();
    });

    // Reset document.fullscreenElement
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
  });
});






