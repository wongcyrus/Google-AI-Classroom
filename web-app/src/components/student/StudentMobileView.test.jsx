import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import StudentMobileView from './StudentMobileView';

// Mock dependencies
const mockSignOut = vi.fn();
vi.mock('firebase/auth', () => ({
  signOut: () => mockSignOut(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

let mockSnapshotCallbacks = [];
const mockDoc = vi.fn((db, ...args) => ({ path: args.join('/'), id: args[args.length - 1] }));
const mockOnSnapshot = vi.fn((ref, callback) => {
  mockSnapshotCallbacks.push({ ref, callback });
  return vi.fn();
});

const mockSubmitBingoFn = vi.fn().mockResolvedValue({ data: { success: true, result: 'passed' } });
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockSubmitBingoFn,
}));

vi.mock('../../firebase-config', () => ({
  auth: { currentUser: { uid: 'student1', email: 'student1@vtc.edu.hk' } },
  db: {},
  functions: {},
}));

let mockSetDoc = vi.fn().mockResolvedValue(true);
vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  setDoc: (...args) => mockSetDoc(...args),
}));

// Mock hooks
let mockBroadcastReturn = {
  isBroadcastActive: false,
  broadcastInfo: null,
  liveFrame: null,
  connectionState: 'idle',
  joinBroadcast: vi.fn(),
};

vi.mock('../../hooks/useTeacherScreenBroadcastStudent', () => ({
  default: () => mockBroadcastReturn,
}));

let mockSubtitlesReturn = {
  active: false,
  originalText: '',
  sourceLang: 'zh-HK',
  currentTranslation: '',
  translations: {},
  availableLanguages: [
    { code: 'zh-Hans', label: '简体中文' },
    { code: 'en', label: 'English' },
  ],
  selectedLanguage: 'zh-Hans',
  setSelectedLanguage: vi.fn(),
  fontSize: 'medium',
  setFontSize: vi.fn(),
  displayMode: 'bilingual',
  setDisplayMode: vi.fn(),
  engine: 'server',
};

vi.mock('../../hooks/useStudentLiveSubtitles', () => ({
  useStudentLiveSubtitles: () => mockSubtitlesReturn,
}));

let mockScheduleReturn = {
  userClasses: [{ id: 'class101', name: 'Cloud Computing 101' }],
  currentActiveClassId: 'class101',
  activeClassIds: ['class101'],
};

vi.mock('../../hooks/useStudentClassSchedule', () => ({
  useStudentClassSchedule: () => mockScheduleReturn,
}));

describe('StudentMobileView Component', () => {
  const mockUser = { uid: 'student1', email: 'student1@vtc.edu.hk' };
  const mockSwitchDesktop = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshotCallbacks = [];
    mockBroadcastReturn = {
      isBroadcastActive: false,
      broadcastInfo: null,
      liveFrame: null,
      connectionState: 'idle',
      joinBroadcast: vi.fn(),
    };
    mockSubtitlesReturn = {
      active: false,
      originalText: '',
      sourceLang: 'zh-HK',
      currentTranslation: '',
      translations: {},
      availableLanguages: [
        { code: 'zh-Hans', label: '简体中文' },
        { code: 'en', label: 'English' },
      ],
      selectedLanguage: 'zh-Hans',
      setSelectedLanguage: vi.fn(),
      fontSize: 'medium',
      setFontSize: vi.fn(),
      displayMode: 'bilingual',
      setDisplayMode: vi.fn(),
      engine: 'server',
    };
  });

  it('renders header with class name, student email, and desktop switch button', () => {
    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    expect(screen.getByText('Cloud Computing 101')).toBeInTheDocument();
    expect(screen.getByText('student1@vtc.edu.hk')).toBeInTheDocument();

    const switchBtn = screen.getByRole('button', { name: /switch to desktop/i });
    expect(switchBtn).toBeInTheDocument();
    fireEvent.click(switchBtn);
    expect(mockSwitchDesktop).toHaveBeenCalledTimes(1);
  });

  it('renders Feature 1: teacher screen idle state and active frame with zoom controls', () => {
    // 1. Inactive stream
    const { rerender } = render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);
    expect(screen.getByText(/teacher is not sharing screen right now/i)).toBeInTheDocument();

    // 2. Active stream with frame
    mockBroadcastReturn = {
      isBroadcastActive: true,
      broadcastInfo: { resolution: '1080p', teacherEmail: 'teacher@vtc.edu.hk' },
      liveFrame: 'data:image/jpeg;base64,mockframe123',
      connectionState: 'connected',
      joinBroadcast: vi.fn(),
    };

    rerender(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);
    const liveImg = screen.getByAltText('Live Teacher Screen');
    expect(liveImg).toBeInTheDocument();
    expect(screen.getByText('1080P')).toBeInTheDocument();

    // Toggle 2x Zoom
    const zoomBtn = screen.getByRole('button', { name: /toggle zoom/i });
    expect(zoomBtn).toHaveTextContent('🔍 2x Zoom');
    fireEvent.click(zoomBtn);
    expect(screen.getByRole('button', { name: /toggle zoom/i })).toHaveTextContent('🔍 Normal');
  });

  it('renders Feature 2: live subtitles, teacher translated languages, font size, and earphone TTS', () => {
    mockSubtitlesReturn = {
      active: true,
      originalText: '今日我哋會講雲端架構設計。',
      sourceLang: 'zh-HK',
      currentTranslation: '今天我们将讨论云架构设计。',
      translations: {
        'zh-Hans': '今天我们将讨论云架构设计。',
        en: 'Today we will discuss cloud architecture design.',
      },
      availableLanguages: [
        { code: 'zh-Hans', label: '简体中文' },
        { code: 'en', label: 'English' },
      ],
      selectedLanguage: 'zh-Hans',
      setSelectedLanguage: vi.fn(),
      fontSize: 'medium',
      setFontSize: vi.fn(),
      engine: 'server',
    };

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // YouTube-style CC button and text cues
    expect(screen.getByRole('button', { name: /toggle closed captions/i })).toBeInTheDocument();
    expect(screen.getByText('今日我哋會講雲端架構設計。')).toBeInTheDocument();
    expect(screen.getByText('今天我们将讨论云架构设计。')).toBeInTheDocument();

    // Language chips strictly from teacher
    const enChip = screen.getByRole('tab', { name: 'English' });
    fireEvent.click(enChip);
    expect(mockSubtitlesReturn.setSelectedLanguage).toHaveBeenCalledWith('en');

    // Font size controls
    const fontBtn = screen.getByRole('button', { name: /toggle font size/i });
    fireEvent.click(fontBtn);
    expect(mockSubtitlesReturn.setFontSize).toHaveBeenCalledWith('large');

    // Earphone Listen Button
    const ttsBtn = screen.getByRole('button', { name: /toggle read aloud/i });
    expect(ttsBtn).toHaveTextContent('🎧 Listen');
    fireEvent.click(ttsBtn);
    expect(ttsBtn).toHaveTextContent('🔊 Speaking');
  });

  it('renders Feature 3: interactive Bingo modal and submits answers', async () => {
    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // Trigger Bingo challenge via studentProperties snapshot
    const studentPropsCb = mockSnapshotCallbacks.find(item =>
      item.ref?.path?.includes('studentProperties/student1')
    );
    expect(studentPropsCb).toBeDefined();

    await act(async () => {
      studentPropsCb.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'bingo_quiz_999',
            question: 'Which service provides serverless compute in Google Cloud?',
            options: ['Cloud Run', 'Compute Engine', 'Cloud Spanner', 'VPC'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() + 45000,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Class Bingo Check/i)).toBeInTheDocument();
      expect(screen.getByText('Which service provides serverless compute in Google Cloud?')).toBeInTheDocument();
      expect(screen.getByText('Cloud Run')).toBeInTheDocument();
      expect(screen.getByText('Compute Engine')).toBeInTheDocument();
    });

    // Select option A (Cloud Run)
    const optionA = screen.getByTestId('bingo-option-0');
    fireEvent.click(optionA);

    await waitFor(() => {
      expect(mockSubmitBingoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class101',
          bingoId: 'bingo_quiz_999',
          selectedIndex: 0,
        })
      );
      expect(screen.queryByTestId('bingo-modal-overlay')).not.toBeInTheDocument();
    });
  });

  it('receives and submits Bingo challenge for inactive-schedule class when enrolled in multiple classes on mobile companion view', async () => {
    mockScheduleReturn = {
      userClasses: [
        { id: 'class101', name: 'Cloud Computing 101' },
        { id: 'class202', name: 'Distributed Systems 202' },
      ],
      currentActiveClassId: 'class101',
      activeClassIds: ['class101'],
    };

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    const class202PropsCb = mockSnapshotCallbacks.find(item =>
      item.ref?.path?.includes('classes/class202/studentProperties/student1')
    );
    expect(class202PropsCb).toBeDefined();

    await act(async () => {
      class202PropsCb.callback({
        exists: () => true,
        data: () => ({
          activeBingo: {
            bingoId: 'dist_sys_bingo_101',
            classId: 'class202',
            question: 'Which consensus algorithm uses Raft?',
            options: ['etcd', 'MySQL', 'Redis', 'Memcached'],
            timeLimitSeconds: 45,
            status: 'pending',
            expiresAtMillis: Date.now() + 45000,
          },
        }),
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/Class Bingo Check/i)).toBeInTheDocument();
      expect(screen.getByTestId('bingo-class-pill')).toHaveTextContent('Distributed Systems 202');
      expect(screen.getByText('Which consensus algorithm uses Raft?')).toBeInTheDocument();
      expect(screen.getByText('etcd')).toBeInTheDocument();
    });

    // Select option A (etcd)
    const optionA = screen.getByTestId('bingo-option-0');
    fireEvent.click(optionA);

    await waitFor(() => {
      expect(mockSubmitBingoFn).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class202',
          bingoId: 'dist_sys_bingo_101',
          selectedIndex: 0,
        })
      );
      expect(screen.queryByTestId('bingo-modal-overlay')).not.toBeInTheDocument();
    });
  });

  it('supports switching between 3 mobile view modes: Screen & CC, Screen Only, and CC Only', () => {
    mockBroadcastReturn = {
      isBroadcastActive: true,
      broadcastInfo: { resolution: '1080p' },
      liveFrame: 'data:image/jpeg;base64,frame123',
      connectionState: 'connected',
      joinBroadcast: vi.fn(),
    };
    mockSubtitlesReturn = {
      active: true,
      originalText: '現在開始上課。',
      sourceLang: 'zh-HK',
      currentTranslation: 'Class begins now.',
      translations: { en: 'Class begins now.' },
      availableLanguages: [
        { code: 'zh-Hans', label: '简体中文' },
        { code: 'en', label: 'English' },
      ],
      selectedLanguage: 'en',
      setSelectedLanguage: vi.fn(),
      fontSize: 'medium',
      setFontSize: vi.fn(),
      engine: 'server',
      recentHistory: [{ originalText: '早晨各位同學', currentTranslation: 'Good morning everyone' }],
    };

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // 1. Default mode: 'overlay' (Screen & CC)
    expect(screen.getByAltText('Live Teacher Screen')).toBeInTheDocument();
    expect(screen.getByLabelText('Closed Captions Overlay')).toBeInTheDocument();
    expect(screen.getByText('Class begins now.')).toBeInTheDocument();

    // Toggle closed captions off/on via YouTube CC button
    const ccBtn = screen.getByRole('button', { name: /toggle closed captions/i });
    fireEvent.click(ccBtn);
    expect(screen.queryByText('Class begins now.')).not.toBeInTheDocument();
    fireEvent.click(ccBtn);
    expect(screen.getByText('Class begins now.')).toBeInTheDocument();

    // 2. Switch to 'screen' (Screen Only)
    const screenOnlyBtn = screen.getByRole('button', { name: /teacher screen only/i });
    fireEvent.click(screenOnlyBtn);
    expect(screen.getByAltText('Live Teacher Screen')).toBeInTheDocument();
    expect(screen.queryByLabelText('Closed Captions Overlay')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Caption and Audio Controls')).not.toBeInTheDocument();

    // 3. Switch to 'cc' (CC Only)
    const ccOnlyBtn = screen.getByRole('button', { name: /subtitles only/i });
    fireEvent.click(ccOnlyBtn);
    // Screen should not be in main content of CC reader
    expect(screen.queryByAltText('Live Teacher Screen')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Dedicated Subtitles Reader')).toBeInTheDocument();
    expect(screen.getByText('Class begins now.')).toBeInTheDocument();
    expect(screen.getByText('早晨各位同學')).toBeInTheDocument();

    // Quick jump back to screen from CC reader banner
    const viewScreenAlert = screen.getByLabelText(/teacher is sharing screen live. tap to switch to screen/i);
    fireEvent.click(viewScreenAlert);
    expect(screen.getByAltText('Live Teacher Screen')).toBeInTheDocument();
  });

  it('allows mobile student to switch class without schedule overriding their selection, and follow schedule reset', async () => {
    localStorage.clear();
    mockScheduleReturn = {
      userClasses: [
        { id: 'class101', name: 'Cloud Computing 101' },
        { id: 'class202', name: 'Advanced AI 202' },
      ],
      currentActiveClassId: 'class101',
      activeClassIds: ['class101', 'class202'],
    };

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    const select = screen.getByLabelText('Select Enrolled Class');
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('class101');

    // Manually switch to class202
    fireEvent.change(select, { target: { value: 'class202' } });

    await waitFor(() => {
      expect(select.value).toBe('class202');
      // Follow schedule button ↩ appears
      expect(screen.getByTitle(/Follow scheduled class: class101/i)).toBeInTheDocument();
    });

    // Tap follow schedule button
    const followBtn = screen.getByTitle(/Follow scheduled class: class101/i);
    fireEvent.click(followBtn);

    await waitFor(() => {
      expect(select.value).toBe('class101');
      expect(screen.queryByTitle(/Follow scheduled class:/i)).not.toBeInTheDocument();
    });
  });

  it('navigates to /student/records when student clicks Records button in mobile header', async () => {
    mockNavigate.mockClear();
    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    const recordsBtn = screen.getByRole('button', { name: /View Attendance & Quiz Records/i });
    expect(recordsBtn).toBeInTheDocument();

    fireEvent.click(recordsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/student/records');
  });

  it('adapts to landscape rotation dynamically', async () => {
    const { container } = render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    const layout = container.querySelector('.student-mobile-layout');
    expect(layout).toBeInTheDocument();

    // Trigger orientation change with landscape dimensions
    window.innerWidth = 844;
    window.innerHeight = 390;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(layout.className).toContain('is-landscape');
  });

  it('toggles fullscreen on layout and exits fullscreen when activeBingo arrives', async () => {
    const mockExit = vi.fn().mockResolvedValue();
    const originalExit = document.exitFullscreen;
    const originalFsElement = document.fullscreenElement;
    document.exitFullscreen = mockExit;

    try {
      mockBroadcastReturn.isBroadcastActive = true;
      mockBroadcastReturn.broadcastInfo = { resolution: '1080p' };
      mockBroadcastReturn.liveFrame = 'data:image/jpeg;base64,sample123';

      const { container } = render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);
      const layout = container.querySelector('.student-mobile-layout');
      layout.requestFullscreen = vi.fn().mockResolvedValue();

      // Find fullscreen button ⛶
      const fsBtn = screen.getByRole('button', { name: /Fullscreen/i });
      expect(fsBtn).toBeInTheDocument();

      // Toggle to fullscreen
      await act(async () => {
        fireEvent.click(fsBtn);
      });
      expect(layout.requestFullscreen).toHaveBeenCalled();

      // Simulate native fullscreen active
      Object.defineProperty(document, 'fullscreenElement', {
        value: layout,
        configurable: true,
        writable: true,
      });

      // Dispatch bingo challenge via snapshot callback
      const targetSub = mockSnapshotCallbacks.find(c => c.ref.path.includes('class101/studentProperties/student1'));
      expect(targetSub).toBeDefined();

      await act(async () => {
        targetSub.callback({
          exists: () => true,
          data: () => ({
            activeBingo: {
              bingoId: 'bingo_fs_test',
              status: 'active',
              question: 'Which tool manages Docker?',
              options: ['Docker CLI', 'Word', 'Excel', 'Photoshop'],
              timeLimitSeconds: 45,
              issuedAtMillis: Date.now(),
              expiresAtMillis: Date.now() + 45000,
            },
          }),
        });
      });

      // Verification: Document exitFullscreen was proactively called to bring modal out from under maximized screen
      expect(mockExit).toHaveBeenCalled();
      expect(screen.getByText('Which tool manages Docker?')).toBeInTheDocument();
    } finally {
      document.exitFullscreen = originalExit;
      Object.defineProperty(document, 'fullscreenElement', {
        value: originalFsElement,
        configurable: true,
        writable: true,
      });
    }
  });

  it('synchronizes landscape-fullscreen state on fullscreenchange events', async () => {
    const { container } = render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);
    const layout = container.querySelector('.student-mobile-layout');

    // Simulate entering fullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: layout,
      configurable: true,
      writable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(layout.className).toContain('landscape-fullscreen');

    // Simulate exiting fullscreen (e.g. user pressed ESC or swiped down)
    Object.defineProperty(document, 'fullscreenElement', {
      value: null,
      configurable: true,
      writable: true,
    });
    act(() => {
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    expect(layout.className).not.toContain('landscape-fullscreen');
  });

  it('renders subtitle controls and handles TTS toggle, font size change, and language selection', async () => {
    mockSubtitlesReturn.active = true;
    mockSubtitlesReturn.currentTranslation = 'Testing real-time subtitle translation';

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // Switch to Subtitles Only mode
    const subtitlesBtn = screen.getByRole('button', { name: /Subtitles Only/i });
    fireEvent.click(subtitlesBtn);

    // Toggle TTS button
    const ttsBtn = screen.getByLabelText('Toggle Read Aloud in Earphones');
    expect(ttsBtn).toBeInTheDocument();
    fireEvent.click(ttsBtn);

    // Click font size buttons
    const smallFontBtn = screen.getByLabelText('Small font');
    const medFontBtn = screen.getByLabelText('Medium font');
    const largeFontBtn = screen.getByLabelText('Large font');

    fireEvent.click(smallFontBtn);
    expect(mockSubtitlesReturn.setFontSize).toHaveBeenCalledWith('small');

    fireEvent.click(medFontBtn);
    expect(mockSubtitlesReturn.setFontSize).toHaveBeenCalledWith('medium');

    fireEvent.click(largeFontBtn);
    expect(mockSubtitlesReturn.setFontSize).toHaveBeenCalledWith('large');

    // Click language chip
    const enChip = screen.getByRole('tab', { name: 'English' });
    fireEvent.click(enChip);
    expect(mockSubtitlesReturn.setSelectedLanguage).toHaveBeenCalledWith('en');
  });

  it('cycles subtitle modes and font sizes in overlay mode and switches bottom dock views', () => {
    localStorage.clear();
    mockBroadcastReturn.isBroadcastActive = true;
    mockSubtitlesReturn.active = true;
    mockSubtitlesReturn.currentTranslation = 'Testing overlay subtitles';
    mockSubtitlesReturn.displayMode = 'bilingual';

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // Toggle Subtitle Mode: bilingual -> translation -> original
    const toggleModeBtn = screen.getByLabelText('Toggle Subtitle Mode');
    expect(toggleModeBtn).toHaveTextContent('双语');

    fireEvent.click(toggleModeBtn);
    expect(mockSubtitlesReturn.setDisplayMode).toHaveBeenCalledWith('translation');

    // Toggle Font Size: small -> medium -> large -> small
    const toggleFontBtn = screen.getByLabelText('Toggle Font Size');
    fireEvent.click(toggleFontBtn);

    // Switch to Screen Only via Dock
    const screenOnlyDockBtn = screen.getByLabelText('Teacher Screen Only');
    fireEvent.click(screenOnlyDockBtn);

    // Switch back to Screen & CC via Dock
    const overlayDockBtn = screen.getByLabelText('Teacher Screen and Overlapping Subtitles');
    fireEvent.click(overlayDockBtn);
  });

  it('supports zoom toggle, reset zoom, and fullscreen actions on live screen overlay', () => {
    mockBroadcastReturn.isBroadcastActive = true;
    mockBroadcastReturn.liveFrame = 'data:image/jpeg;base64,mockframe';
    mockBroadcastReturn.broadcastInfo = { resolution: '1080p' };

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    expect(screen.getByText('SCREEN LIVE')).toBeInTheDocument();
    expect(screen.getByText('1080P')).toBeInTheDocument();

    const zoomBtn = screen.getByRole('button', { name: 'Toggle Zoom' });
    fireEvent.click(zoomBtn);

    // Zoom scale is now 2x, so Reset Zoom (1x) and Normal buttons appear
    const resetZoomBtn = screen.getByRole('button', { name: 'Reset Zoom' });
    expect(resetZoomBtn).toBeInTheDocument();
    fireEvent.click(resetZoomBtn);

    // Toggle fullscreen
    const fsBtn = screen.getByRole('button', { name: 'Fullscreen' });
    expect(fsBtn).toBeInTheDocument();
    fireEvent.click(fsBtn);
  });

  it('renders lecture transcript history in CC Only mode', () => {
    mockSubtitlesReturn.active = true;
    mockSubtitlesReturn.recentHistory = [
      {
        originalText: 'Hello students welcome to lab',
        translations: { en: 'Hello students welcome to lab' },
      },
      {
        originalText: 'Please open Docker Desktop',
        translations: { en: 'Please open Docker Desktop' },
      },
    ];

    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // Switch to CC Only mode
    const ccOnlyDockBtn = screen.getByRole('button', { name: 'Subtitles Only' });
    fireEvent.click(ccOnlyDockBtn);

    expect(screen.getByText('Lecture Transcript History')).toBeInTheDocument();
    expect(screen.getByText('Hello students welcome to lab')).toBeInTheDocument();
    expect(screen.getByText('Please open Docker Desktop')).toBeInTheDocument();

    // Test font size changes
    const smallFontBtn = screen.getByRole('button', { name: 'Small font' });
    const largeFontBtn = screen.getByRole('button', { name: 'Large font' });
    fireEvent.click(largeFontBtn);
    fireEvent.click(smallFontBtn);

    // Test TTS toggle
    const ttsBtn = screen.getByRole('button', { name: 'Toggle Read Aloud in Earphones' });
    fireEvent.click(ttsBtn);
    expect(screen.getByText('🔊 Speaking')).toBeInTheDocument();
  });

  it('handles header actions: records navigation, desktop mode switch, and sign out', () => {
    render(<StudentMobileView user={mockUser} onSwitchToDesktop={mockSwitchDesktop} />);

    // Click Records navigation
    const recordsBtn = screen.getByRole('button', { name: 'View Attendance & Quiz Records' });
    fireEvent.click(recordsBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/student/records');

    // Click Desktop Switch
    const desktopBtn = screen.getByRole('button', { name: 'Switch to Desktop Invigilation' });
    fireEvent.click(desktopBtn);
    expect(mockSwitchDesktop).toHaveBeenCalled();

    // Click Sign Out
    const logoutBtn = screen.getByRole('button', { name: 'Sign Out' });
    fireEvent.click(logoutBtn);
    expect(mockSignOut).toHaveBeenCalled();
  });
});

