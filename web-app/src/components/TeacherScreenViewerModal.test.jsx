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

    it('switches view mode to floating, fullscreen, and minimized', () => {
      render(<TeacherScreenViewerModal {...defaultProps} />);

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
      expect(screen.getByText(/Teacher Screen Sharing \(Click to Expand\)/i)).toBeInTheDocument();
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
