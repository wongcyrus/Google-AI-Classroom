import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import TeacherScreenBroadcastModal from './TeacherScreenBroadcastModal';

describe('TeacherScreenBroadcastModal', () => {
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

  it('renders pre-broadcast setup modal with resolution and framerate options when isBroadcasting is false', () => {
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
    expect(screen.getByText('Share Screen to Class')).toBeInTheDocument();
    expect(screen.getByText(/Configure image size and frame rate/i)).toBeInTheDocument();

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

    // Start action button
    expect(screen.getByRole('button', { name: /Start Sharing Screen/i })).toBeInTheDocument();
  });

  it('allows teacher to select resolution, interval, and triggers onStartBroadcast', async () => {
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

    // Click Native (Original / 2K)
    const nativeCard = screen.getByText('Native (Original / 2K)').closest('.resolution-card');
    fireEvent.click(nativeCard);
    expect(setBroadcastResolution).toHaveBeenCalledWith('native');

    // Click 1.0s / 1 FPS
    const fpsBtn = screen.getByText('1.0s / 1 FPS').closest('button');
    fireEvent.click(fpsBtn);
    expect(setBroadcastInterval).toHaveBeenCalledWith(1000);

    // Click Start Sharing Screen
    const startBtn = screen.getByRole('button', { name: /Start Sharing Screen/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(onStartBroadcast).toHaveBeenCalledWith({
        resolution: 'native',
        interval: 1000,
      });
    });
  });

  it('renders live broadcast view when isBroadcasting is true', () => {
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
    expect(onClose).toHaveBeenCalled();
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

    expect(container.querySelector('video')).toBeNull();

    // Teacher opens the modal to check preview
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
    const mockFrameData = 'data:image/jpeg;base64,sampleframe';

    const { container } = render(
      <TeacherScreenBroadcastModal
        isOpen={true}
        onClose={vi.fn()}
        isBroadcasting={true}
        screenStream={null}
        lastFrameData={mockFrameData}
        viewers={[]}
      />
    );

    const imgEl = container.querySelector('img.broadcast-preview-video');
    expect(imgEl).toBeInTheDocument();
    expect(imgEl.getAttribute('src')).toBe(mockFrameData);
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

  it('renders subtitle controls in active broadcast sidebar and indicates active state', () => {
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
});
