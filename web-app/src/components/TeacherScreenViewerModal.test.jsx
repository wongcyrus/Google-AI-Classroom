import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeacherScreenViewerModal from './TeacherScreenViewerModal';
import TeacherScreenBroadcastModal from './TeacherScreenBroadcastModal';

vi.mock('../hooks/useStudentLiveSubtitles', () => ({
  useStudentLiveSubtitles: vi.fn(() => ({
    active: true,
    originalText: '今日我哋講 React Hooks',
    sourceLang: 'zh-HK',
    currentTranslation: 'Today we discuss React Hooks',
    translations: { en: 'Today we discuss React Hooks' },
    selectedLanguage: 'en',
    setSelectedLanguage: vi.fn(),
    displayMode: 'bilingual',
    setDisplayMode: vi.fn(),
    fontSize: 'medium',
    setFontSize: vi.fn(),
    isVisible: true,
    setIsVisible: vi.fn(),
    engine: 'client',
  })),
}));

describe('Teacher Screen Modals Suite', () => {
  describe('TeacherScreenViewerModal', () => {
    const defaultProps = {
      isOpen: true,
      onClose: vi.fn(),
      liveFrame: 'data:image/jpeg;base64,frame_data_xyz',
      connectionState: 'connected',
      broadcastInfo: { teacherEmail: 'teacher@school.edu' },
    };

    it('renders teacher screen viewer modal with teacher email, classroom stream badge, and live frame image', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      expect(screen.getByText(/teacher@school.edu's Screen/i)).toBeInTheDocument();
      expect(screen.getByText('🟢 Live Classroom Stream (50+ Students)')).toBeInTheDocument();
      const frameImg = screen.getByRole('img', { name: /Teacher Live Screen/i });
      expect(frameImg).toBeInTheDocument();
      expect(frameImg).toHaveAttribute('src', 'data:image/jpeg;base64,frame_data_xyz');
    });

    it('renders loading spinner and connecting state when frame is not yet received', () => {
      render(
        <TeacherScreenViewerModal
          {...defaultProps}
          liveFrame={null}
          connectionState="connecting"
          broadcastInfo={null}
        />
      );

      expect(screen.getByText('🖥️ Teacher Screen')).toBeInTheDocument();
      expect(screen.getByText('⏳ Connecting...')).toBeInTheDocument();
      expect(screen.getByText('Receiving classroom screen broadcast...')).toBeInTheDocument();
    });

    it('switches view mode to floating, standard docked, fullscreen, and minimized pill, and expands pill', () => {
      const onClose = vi.fn();
      render(<TeacherScreenViewerModal {...defaultProps} onClose={onClose} />);

      // Switch to docked and test backdrop click
      const dockedBtn = screen.getByRole('button', { name: /Standard/i });
      fireEvent.click(dockedBtn);
      expect(dockedBtn).toHaveClass('active');
      const backdrop = document.querySelector('.viewer-backdrop');
      expect(backdrop).toBeInTheDocument();
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();

      // Switch to floating
      const floatBtn = screen.getByRole('button', { name: /Float/i });
      fireEvent.click(floatBtn);
      expect(floatBtn).toHaveClass('active');

      // Switch to fullscreen
      const maxBtn = screen.getByRole('button', { name: /Max/i });
      fireEvent.click(maxBtn);
      expect(maxBtn).toHaveClass('active');

      // Minimize to floating pill
      const minBtn = screen.getByRole('button', { name: /➖ Min/i });
      fireEvent.click(minBtn);
      const pill = screen.getByText(/Teacher Screen Sharing \(Click to Expand\)/i);
      expect(pill).toBeInTheDocument();

      // Clicking pill expands back to docked mode
      fireEvent.click(pill);
      expect(screen.getByRole('button', { name: /Standard/i })).toHaveClass('active');

      // Minimize again and click pill close button
      fireEvent.click(screen.getByRole('button', { name: /➖ Min/i }));
      const pillCloseBtn = screen.getByTitle('Close Screen Share');
      fireEvent.click(pillCloseBtn);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('does not render when isOpen is false', () => {
      const { container } = render(<TeacherScreenViewerModal {...defaultProps} isOpen={false} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders docked LiveSubtitleOverlay inside the video box', () => {
      const { container } = render(<TeacherScreenViewerModal {...defaultProps} classId="CLASS_TEST" />);
      const videoBox = container.querySelector('.teacher-stream-video-box');
      expect(videoBox).toBeInTheDocument();
      // Subtitle overlay container is mounted inside videoBox with docked class
      const overlay = container.querySelector('.live-subtitle-container.docked');
      expect(overlay).toBeInTheDocument();
    });
  });

  describe('TeacherScreenBroadcastModal', () => {
    const defaultBroadcastProps = {
      isOpen: true,
      onClose: vi.fn(),
      screenStream: null,
      isBroadcasting: true,
      frameStats: { emittedFrames: 42 },
      viewers: [
        { studentUid: 's1', studentEmail: 'student1@school.edu', status: 'watching', connectionState: 'connected', joinedAt: new Date() },
        { studentUid: 's2', studentEmail: 'student2@school.edu', status: 'watching', connectionState: 'connected', joinedAt: new Date() },
      ],
      onStopBroadcast: vi.fn(),
    };

    it('renders broadcasting modal with classroom frame stream metrics and student roster', () => {
      render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} />);

      expect(screen.getByText(/Live Class Screen Broadcast/i)).toBeInTheDocument();
      expect(screen.getByText(/2 Students Watching/i)).toBeInTheDocument();
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
      expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
      expect(screen.getByText(/Classroom Frame Stream/i)).toBeInTheDocument();
      expect(screen.getByText(/50\+ Students \(Unlimited\)/i)).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });

    it('renders empty student notice when no viewers are connected', () => {
      render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} viewers={[]} />);

      expect(screen.getByText(/0 Students Watching/i)).toBeInTheDocument();
      expect(screen.getByText('Waiting for students to connect...')).toBeInTheDocument();
    });

    it('triggers onStopBroadcast on clicking Stop Screen Broadcast', () => {
      const onStopBroadcast = vi.fn();
      render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} onStopBroadcast={onStopBroadcast} />);

      const stopBtn = screen.getByRole('button', { name: /Stop Screen Broadcast/i });
      fireEvent.click(stopBtn);
      expect(onStopBroadcast).toHaveBeenCalled();
    });

    it('does not render when isOpen is false', () => {
      const { container } = render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} isOpen={false} />);
      expect(container.firstChild).toBeNull();
    });
  });
});
