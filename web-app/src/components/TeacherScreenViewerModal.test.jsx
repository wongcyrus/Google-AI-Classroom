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
      broadcastInfo: { teacherEmail: 'teacher@school.edu', resolution: '1080p' },
    };

    it('renders teacher screen viewer modal with teacher email, live frame, resolution badge, and zoom toolbar', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      expect(screen.getByText(/teacher@school.edu's Screen/i)).toBeInTheDocument();
      expect(screen.getByText(/🟢 Live Stream/i)).toBeInTheDocument();
      expect(screen.getByText('1080P')).toBeInTheDocument();
      const frameImg = screen.getByRole('img', { name: /Teacher Live Screen/i });
      expect(frameImg).toBeInTheDocument();
      expect(frameImg).toHaveAttribute('src', 'data:image/jpeg;base64,frame_data_xyz');

      // Zoom toolbar elements
      expect(screen.getByRole('button', { name: /Zoom Out/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Reset Zoom/i })).toHaveTextContent('100%');
      expect(screen.getByRole('button', { name: /Zoom In/i })).toBeInTheDocument();
    });

    it('supports interactive zooming in, zooming out, reset zoom, and double click', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      const frameImg = screen.getByRole('img', { name: /Teacher Live Screen/i });
      const zoomInBtn = screen.getByRole('button', { name: /Zoom In/i });
      const zoomOutBtn = screen.getByRole('button', { name: /Zoom Out/i });
      const resetBadge = screen.getByRole('button', { name: /Reset Zoom/i });

      // Initial state: 100%
      expect(resetBadge).toHaveTextContent('100%');
      expect(zoomOutBtn).toBeDisabled();

      // Click Zoom In
      fireEvent.click(zoomInBtn);
      expect(resetBadge).toHaveTextContent('125%');
      expect(zoomOutBtn).not.toBeDisabled();
      expect(frameImg.style.transform).toContain('scale(1.25)');
      expect(screen.getByRole('button', { name: /Fit to Screen/i })).toBeInTheDocument();
      expect(screen.getByText(/Drag to pan screen/i)).toBeInTheDocument();

      // Click Zoom In again
      fireEvent.click(zoomInBtn);
      expect(resetBadge).toHaveTextContent('150%');
      expect(frameImg.style.transform).toContain('scale(1.5)');

      // Click Fit to Screen
      const fitBtn = screen.getByRole('button', { name: /Fit to Screen/i });
      fireEvent.click(fitBtn);
      expect(resetBadge).toHaveTextContent('100%');
      expect(frameImg.style.transform).toContain('scale(1)');

      // Double-click image to toggle zoom
      const videoBox = frameImg.parentElement;
      fireEvent.doubleClick(videoBox);
      expect(resetBadge).toHaveTextContent('175%');
      expect(frameImg.style.transform).toContain('scale(1.75)');

      // Double-click again to reset
      fireEvent.doubleClick(videoBox);
      expect(resetBadge).toHaveTextContent('100%');
      expect(frameImg.style.transform).toContain('scale(1)');
    });

    it('supports mouse wheel zooming on the video box', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      const frameImg = screen.getByRole('img', { name: /Teacher Live Screen/i });
      const videoBox = frameImg.parentElement;

      // Wheel up (deltaY < 0) => zoom in
      fireEvent.wheel(videoBox, { deltaY: -100 });
      expect(screen.getByRole('button', { name: /Reset Zoom/i })).toHaveTextContent('120%');

      // Wheel down (deltaY > 0) => zoom out
      fireEvent.wheel(videoBox, { deltaY: 100 });
      expect(screen.getByRole('button', { name: /Reset Zoom/i })).toHaveTextContent('100%');
    });

    it('supports keyboard shortcuts for zoom (+, -, 0)', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      const resetBadge = screen.getByRole('button', { name: /Reset Zoom/i });

      // '+' key zooms in
      fireEvent.keyDown(window, { key: '+' });
      expect(resetBadge).toHaveTextContent('125%');

      // '-' key zooms out
      fireEvent.keyDown(window, { key: '-' });
      expect(resetBadge).toHaveTextContent('100%');

      // Zoom in then press '0' to reset
      fireEvent.keyDown(window, { key: '=' });
      expect(resetBadge).toHaveTextContent('125%');

      // Click Fit button
      const fitBtn = screen.getByRole('button', { name: /Fit to Screen/i });
      fireEvent.click(fitBtn);
      expect(resetBadge).toHaveTextContent('100%');

      // Zoom in then press Escape to reset
      fireEvent.keyDown(window, { key: '+' });
      expect(resetBadge).toHaveTextContent('125%');
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(resetBadge).toHaveTextContent('100%');

      // Press Escape when at 100% to close modal
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(defaultProps.onClose).toHaveBeenCalled();
    });

    it('supports drag-to-pan when zoomed in', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      const frameImg = screen.getByRole('img', { name: /Teacher Live Screen/i });
      const videoBox = frameImg.parentElement;
      const zoomInBtn = screen.getByRole('button', { name: /Zoom In/i });

      // Zoom in to 150%
      fireEvent.click(zoomInBtn);
      fireEvent.click(zoomInBtn);

      // Mouse drag
      fireEvent.mouseDown(videoBox, { button: 0, clientX: 200, clientY: 200 });
      fireEvent.mouseMove(videoBox, { clientX: 250, clientY: 230 });
      fireEvent.mouseUp(videoBox);

      expect(frameImg.style.transform).toContain('translate(50px, 30px)');
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

      // Modal starts docked: test backdrop click
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
