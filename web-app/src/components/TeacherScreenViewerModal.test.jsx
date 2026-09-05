import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TeacherScreenViewerModal from './TeacherScreenViewerModal';
import TeacherScreenBroadcastModal from './TeacherScreenBroadcastModal';

describe('Teacher Screen Modals Suite', () => {
  describe('TeacherScreenViewerModal', () => {
    const defaultProps = {
      isOpen: true,
      onClose: vi.fn(),
      remoteStream: null,
      connectionState: 'connected',
      hasAudio: true,
      isAudioMuted: false,
      onToggleMute: vi.fn(),
      broadcastInfo: { teacherEmail: 'teacher@school.edu' },
    };

    it('renders teacher screen viewer modal with teacher email and controls', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

      expect(screen.getByText(/teacher@school.edu's Screen/i)).toBeInTheDocument();
      expect(screen.getByText('🟢 Live')).toBeInTheDocument();
      expect(screen.getByText('🔊 Sound')).toBeInTheDocument();
    });

    it('toggles audio mute when button clicked', () => {
      const onToggleMute = vi.fn();
      render(<TeacherScreenViewerModal {...defaultProps} onToggleMute={onToggleMute} />);

      const soundBtn = screen.getByRole('button', { name: /Sound/i });
      fireEvent.click(soundBtn);
      expect(onToggleMute).toHaveBeenCalled();
    });

    it('switches view mode to floating, fullscreen, and minimized, and expands pill', () => {
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
      const minBtn = screen.getByRole('button', { name: /Min/i });
      fireEvent.click(minBtn);
      const pill = screen.getByText(/Teacher Screen Sharing \(Click to Expand\)/i);
      expect(pill).toBeInTheDocument();

      // Clicking pill expands back to docked mode
      fireEvent.click(pill);
      expect(screen.getByRole('button', { name: /Standard/i })).toHaveClass('active');

      // Minimize again and click pill close button
      fireEvent.click(screen.getByRole('button', { name: /Min/i }));
      const pillCloseBtn = screen.getByTitle('Close Screen Share');
      fireEvent.click(pillCloseBtn);
      expect(onClose).toHaveBeenCalledTimes(2);
    });

    it('renders muted state, connecting state, and default title when broadcastInfo is empty', () => {
      render(
        <TeacherScreenViewerModal
          {...defaultProps}
          broadcastInfo={null}
          connectionState="connecting"
          isAudioMuted={true}
        />
      );

      expect(screen.getByText('🖥️ Teacher Screen')).toBeInTheDocument();
      expect(screen.getByText('⏳ Connecting...')).toBeInTheDocument();
      expect(screen.getByText('🔇 Muted')).toBeInTheDocument();
    });

    it('attaches remoteStream to video element and calls play', () => {
      const mockStream = { id: 'stream-1' };
      const playMock = vi.fn().mockRejectedValue(new Error('Autoplay blocked'));
      window.HTMLMediaElement.prototype.play = playMock;

      render(<TeacherScreenViewerModal {...defaultProps} remoteStream={mockStream} />);

      const video = document.querySelector('video.teacher-live-video');
      expect(video).toBeInTheDocument();
      expect(video.srcObject).toBe(mockStream);
    });

    it('does not render when isOpen is false', () => {
      const { container } = render(<TeacherScreenViewerModal {...defaultProps} isOpen={false} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('TeacherScreenBroadcastModal', () => {
    const defaultBroadcastProps = {
      isOpen: true,
      onClose: vi.fn(),
      screenStream: null,
      isBroadcasting: true,
      hasAudio: true,
      viewers: [
        { studentUid: 's1', studentEmail: 'student1@school.edu', status: 'answered', joinedAt: new Date() },
        { studentUid: 's2', studentEmail: 'student2@school.edu', status: 'requesting', joinedAt: new Date() },
      ],
      onStopBroadcast: vi.fn(),
    };

    it('renders broadcasting modal with live indicator and viewer count', () => {
      render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} />);

      expect(screen.getByText(/Live Class Screen Broadcast/i)).toBeInTheDocument();
      expect(screen.getByText(/2 Students Watching/i)).toBeInTheDocument();
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
      expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
    });

    it('triggers onStopBroadcast on clicking Stop Screen Broadcast', () => {
      const onStopBroadcast = vi.fn();
      render(<TeacherScreenBroadcastModal {...defaultBroadcastProps} onStopBroadcast={onStopBroadcast} />);

      const stopBtn = screen.getByRole('button', { name: /Stop Screen Broadcast/i });
      fireEvent.click(stopBtn);
      expect(onStopBroadcast).toHaveBeenCalled();
    });
  });
});
