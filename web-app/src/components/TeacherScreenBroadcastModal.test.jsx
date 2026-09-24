import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import TeacherScreenBroadcastModal from './TeacherScreenBroadcastModal';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
}));

describe('TeacherScreenBroadcastModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(
      <TeacherScreenBroadcastModal
        isOpen={false}
        onClose={vi.fn()}
        isBroadcasting={false}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders Step 1 (Voice & Subtitles Setup) by default when isBroadcasting is false', () => {
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        broadcastResolution="1080p"
        broadcastInterval={1500}
      />
    );

    // Header & subtitle
    expect(screen.getByText('Broadcast Screen & Voice')).toBeInTheDocument();
    expect(screen.getByText(/Configure microphone, live translations, and screen share/i)).toBeInTheDocument();

    // Wizard tabs
    expect(screen.getByText(/1\. 🎙️ Voice & Subtitles/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. 🖥️ Screen & Recording/i)).toBeInTheDocument();

    // Step 1 controls
    expect(screen.getByText(/Audio Input \(Microphone\)/i)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText(/Translation Model Architecture/i)).toBeInTheDocument();
    expect(screen.getByText(/Spoken Speech Language/i)).toBeInTheDocument();
    expect(screen.getByText(/Target Broadcast Languages/i)).toBeInTheDocument();

    // Navigation button to Step 2
    expect(screen.getByText(/Next: Screen & Recording Setup/i)).toBeInTheDocument();
  });

  it('navigates to Step 2 (Screen & Recording Setup) and displays resolution and framerate options', () => {
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        broadcastResolution="1080p"
        broadcastInterval={1500}
      />
    );

    // Click "Next: Screen & Recording Setup"
    const nextBtn = screen.getByText(/Next: Screen & Recording Setup/i).closest('button');
    fireEvent.click(nextBtn);

    // Resolution cards
    expect(screen.getByText('1080p (Full HD - Sharp)')).toBeInTheDocument();
    expect(screen.getByText('Native (Original / 2K)')).toBeInTheDocument();
    expect(screen.getByText('720p (HD - Balanced)')).toBeInTheDocument();
    expect(screen.getByText('480p (SD - Low Data)')).toBeInTheDocument();

    // Framerate pills
    expect(screen.getByText('1.0s / 1 FPS')).toBeInTheDocument();
    expect(screen.getByText('1.5s / 0.7 FPS')).toBeInTheDocument();
    expect(screen.getByText('2.0s / 0.5 FPS')).toBeInTheDocument();
    expect(screen.getByText('3.0s / 0.3 FPS')).toBeInTheDocument();

    // Back to Voice Setup button
    expect(screen.getByText(/Back to Voice Setup/i)).toBeInTheDocument();

    // Start action button
    expect(screen.getByRole('button', { name: /Start Live Stream/i })).toBeInTheDocument();
  });

  it('allows teacher to select resolution, interval, and triggers synchronized onStartBroadcast from Step 2', async () => {
    const onStartBroadcast = vi.fn().mockResolvedValue();
    const setBroadcastResolution = vi.fn();
    const setBroadcastInterval = vi.fn();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        broadcastResolution="1080p"
        broadcastInterval={1500}
        onStartBroadcast={onStartBroadcast}
        setBroadcastResolution={setBroadcastResolution}
        setBroadcastInterval={setBroadcastInterval}
      />
    );

    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));

    // Click Native (Original / 2K)
    const nativeCard = screen.getByText('Native (Original / 2K)').closest('.resolution-card');
    fireEvent.click(nativeCard);
    expect(setBroadcastResolution).toHaveBeenCalledWith('native');

    // Click 1.0s / 1 FPS
    const fpsBtn = screen.getByText('1.0s / 1 FPS').closest('button');
    fireEvent.click(fpsBtn);
    expect(setBroadcastInterval).toHaveBeenCalledWith(1000);

    // Click Start Sharing Screen / Start Live Stream
    const startBtn = screen.getByRole('button', { name: /Start Live Stream/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution: 'native',
          interval: 1000,
        })
      );
    });
  });

  it('allows navigating back from Step 2 to Step 1 via Back to Voice Setup button', () => {
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
      />
    );

    // Go to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));
    expect(screen.getByText('1080p (Full HD - Sharp)')).toBeInTheDocument();

    // Click Back to Voice Setup
    fireEvent.click(screen.getByText(/Back to Voice Setup/i).closest('button'));
    expect(screen.getByText(/Audio Input \(Microphone\)/i)).toBeInTheDocument();
  });

  it('allows switching steps directly using the wizard step tabs', () => {
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
      />
    );

    // Click Step 2 Tab
    const step2Tab = screen.getByText(/2\. 🖥️ Screen & Recording/i);
    fireEvent.click(step2Tab);
    expect(screen.getByText('1080p (Full HD - Sharp)')).toBeInTheDocument();

    // Click Step 1 Tab
    const step1Tab = screen.getByText(/1\. 🎙️ Voice & Subtitles/i);
    fireEvent.click(step1Tab);
    expect(screen.getByText(/Audio Input \(Microphone\)/i)).toBeInTheDocument();
  });

  it('renders subtitle setup button in pre-broadcast modal and triggers onOpenSubtitles', () => {
    const onOpenSubtitles = vi.fn();
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        onOpenSubtitles={onOpenSubtitles}
        isSubtitlesEnabled={false}
      />
    );

    const subBtn = screen.getByRole('button', { name: /Subtitle Setup/i });
    expect(subBtn).toBeInTheDocument();
    fireEvent.click(subBtn);
    expect(onOpenSubtitles).toHaveBeenCalledTimes(1);
  });

  it('renders subtitle controls in active broadcast sidebar and triggers onOpenSubtitles when clicked', () => {
    const onOpenSubtitles = vi.fn();
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        viewers={[]}
        onOpenSubtitles={onOpenSubtitles}
        isSubtitlesEnabled={true}
      />
    );

    const activeSubBtn = screen.getByRole('button', { name: /Live CC Active/i });
    expect(activeSubBtn).toBeInTheDocument();
    fireEvent.click(activeSubBtn);
    expect(onOpenSubtitles).toHaveBeenCalledTimes(1);
  });

  it('renders broadcast mode selector in Step 2, defaulting to Stream & Record, and starts recording', async () => {
    const mockLectureRecorder = {
      isRecording: false,
      startRecording: vi.fn().mockResolvedValue(),
    };
    const onStartBroadcast = vi.fn().mockResolvedValue();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        lectureRecorder={mockLectureRecorder}
        defaultRecordOnStart={true}
        onStartBroadcast={onStartBroadcast}
      />
    );

    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));

    expect(screen.getByText(/Broadcast Mode & Recording Policy/i)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Stream & Record/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Live Stream Only/i })).toBeInTheDocument();

    // Start button reflects record mode
    const startBtn = screen.getByRole('button', { name: /Start Live Stream and Recording/i });
    expect(startBtn).toBeInTheDocument();
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledTimes(1);
      expect(onStartBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          recordOnStart: true,
        })
      );
    });
  });

  it('allows teacher to toggle to Live Stream Only mode with no recording files saved', async () => {
    const mockLectureRecorder = {
      isRecording: false,
      startRecording: vi.fn().mockResolvedValue(),
    };
    const onStartBroadcast = vi.fn().mockResolvedValue();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        lectureRecorder={mockLectureRecorder}
        defaultRecordOnStart={true}
        onStartBroadcast={onStartBroadcast}
      />
    );

    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));

    // Click "Live Stream Only" card
    const liveOnlyCard = screen.getByRole('radio', { name: /Live Stream Only/i });
    fireEvent.click(liveOnlyCard);

    // Button should now be Live Stream Only
    const startBtn = screen.getByRole('button', { name: /Start Live Stream Only/i });
    expect(startBtn).toBeInTheDocument();
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledTimes(1);
      expect(mockLectureRecorder.startRecording).not.toHaveBeenCalled();
    });
  });

  it('honors defaultRecordOnStart={false} from class policy', () => {
    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        lectureRecorder={{ isRecording: false, startRecording: vi.fn() }}
        defaultRecordOnStart={false}
      />
    );

    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));
    expect(screen.getByRole('button', { name: /Start Live Stream Only/i })).toBeInTheDocument();
  });

  it('renders lecture recorder HUD with pause, resume, stop, and past recordings link in active modal', () => {
    const mockLectureRecorder = {
      isRecording: true,
      isPaused: false,
      isUploading: false,
      recordingState: 'recording',
      durationFormatted: '05:32',
      pauseRecording: vi.fn(),
      resumeRecording: vi.fn(),
      stopRecording: vi.fn(),
      discardRecording: vi.fn(),
    };
    const onOpenRecordings = vi.fn();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        lectureRecorder={mockLectureRecorder}
        onOpenRecordings={onOpenRecordings}
      />
    );

    expect(screen.getByText(/● REC 05:32/)).toBeInTheDocument();
    const pauseBtn = screen.getByRole('button', { name: /Pause/i });
    expect(pauseBtn).toBeInTheDocument();
    fireEvent.click(pauseBtn);
    expect(mockLectureRecorder.pauseRecording).toHaveBeenCalledTimes(1);

    const stopBtn = screen.getByRole('button', { name: /Stop & Save/i });
    expect(stopBtn).toBeInTheDocument();
    fireEvent.click(stopBtn);
    expect(mockLectureRecorder.stopRecording).toHaveBeenCalledTimes(1);

    const pastBtn = screen.getByRole('button', { name: /View Past Recordings & YouTube CC/i });
    expect(pastBtn).toBeInTheDocument();
    fireEvent.click(pastBtn);
    expect(onOpenRecordings).toHaveBeenCalledTimes(1);
  });

  it('renders live broadcast view when isBroadcasting is true', async () => {
    const onStopBroadcast = vi.fn();
    const onClose = vi.fn();
    const mockViewers = [
      { studentUid: 's1', studentEmail: 'alice@school.edu' },
      { studentUid: 's2', studentEmail: 'bob@school.edu' },
    ];

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={onClose}
        isBroadcasting={true}
        broadcastResolution="1080p"
        broadcastInterval={1500}
        viewers={mockViewers}
        onStopBroadcast={onStopBroadcast}
      />
    );

    expect(screen.getByText('🖥️ Live Class Screen Broadcast')).toBeInTheDocument();
    expect(screen.getByText(/2 Students Watching/i)).toBeInTheDocument();
    expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
    expect(screen.getByText('bob@school.edu')).toBeInTheDocument();

    // Clicking Stop Screen Broadcast
    const stopBtn = screen.getByRole('button', { name: /Stop Screen Broadcast/i });
    fireEvent.click(stopBtn);
    expect(onStopBroadcast).toHaveBeenCalled();
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('renders video element and attaches screenStream to video.srcObject', () => {
    const mockPlay = vi.fn().mockResolvedValue();
    window.HTMLMediaElement.prototype.play = mockPlay;

    const mockStream = { id: 'test-stream' };

    const { container } = render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        screenStream={mockStream}
        viewers={[]}
      />
    );

    const videoEl = container.querySelector('video.broadcast-preview-video');
    expect(videoEl).toBeInTheDocument();
    expect(videoEl.srcObject).toBe(mockStream);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('reattaches srcObject and plays video when modal is reopened while broadcasting', () => {
    const mockPlay = vi.fn().mockResolvedValue();
    window.HTMLMediaElement.prototype.play = mockPlay;
    const mockStream = { id: 'persistent-stream' };

    // Initially modal is closed while broadcasting
    const { rerender, container } = render(
      <TeacherScreenBroadcastModal
        isOpen={false}
        onClose={vi.fn()}
        isBroadcasting={true}
        screenStream={mockStream}
        viewers={[]}
      />
    );
    expect(container.firstChild).toBeNull();

    // Modal is opened
    rerender(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        screenStream={mockStream}
        viewers={[]}
      />
    );

    const videoEl = container.querySelector('video.broadcast-preview-video');
    expect(videoEl).toBeInTheDocument();
    expect(videoEl.srcObject).toBe(mockStream);
    expect(mockPlay).toHaveBeenCalled();
  });

  it('renders image fallback when screenStream is null and lastFrameData is provided', () => {
    const base64Data = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...';

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        screenStream={null}
        lastFrameData={base64Data}
        viewers={[]}
      />
    );

    const img = screen.getByAltText('Teacher broadcast live frame preview');
    expect(img).toBeInTheDocument();
    expect(img.getAttribute('src')).toBe(base64Data);
  });

  it('defaults broadcast resolution to 720p and interval to 3000ms when starting broadcast', async () => {
    const onStartBroadcast = vi.fn().mockResolvedValue();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        lectureRecorder={{ isRecording: false, startRecording: vi.fn() }}
        onStartBroadcast={onStartBroadcast}
      />
    );

    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));

    const startBtn = screen.getByRole('button', { name: /Start Live Stream and Recording/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledTimes(1);
      expect(onStartBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          resolution: '720p',
          interval: 3000,
        })
      );
    });
  });

  it('allows enabling Public Presentation Mode with 4-digit PIN and passes options to onStartBroadcast', async () => {
    const onStartBroadcast = vi.fn().mockResolvedValue();

    render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={false}
        lectureRecorder={{ isRecording: false, startRecording: vi.fn() }}
        classId="TALK-2026"
        onStartBroadcast={onStartBroadcast}
      />
    );

    // Navigate to Step 2
    fireEvent.click(screen.getByText(/Next: Screen & Recording Setup/i).closest('button'));

    // Click Public Presentation Mode card
    const publicCard = screen.getByText(/Enable Public Presentation Mode/i).closest('.broadcast-mode-card');
    fireEvent.click(publicCard);

    // PIN input should be displayed
    const pinInput = screen.getByLabelText(/Presentation PIN/i);
    expect(pinInput).toBeInTheDocument();
    fireEvent.change(pinInput, { target: { value: '7788' } });

    // Click preview QR code
    const previewQrBtn = screen.getByRole('button', { name: /Preview Projector QR Code/i });
    fireEvent.click(previewQrBtn);
    expect(screen.getByText(/Presentation Screen & Subtitles QR Code/i)).toBeInTheDocument();
    expect(screen.getByText('7788')).toBeInTheDocument();

    // Close QR modal
    fireEvent.click(screen.getByRole('button', { name: /Done/i }));

    // Start broadcast
    const startBtn = screen.getByRole('button', { name: /Start Live Stream and Recording/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledTimes(1);
      expect(onStartBroadcast).toHaveBeenCalledWith(
        expect.objectContaining({
          isPublic: true,
          publicPin: '7788',
        })
      );
    });
  });
});
