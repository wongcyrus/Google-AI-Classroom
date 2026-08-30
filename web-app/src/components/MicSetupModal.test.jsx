import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import MicSetupModal from './MicSetupModal';

const { mockUseAudioSetup } = vi.hoisted(() => ({
  mockUseAudioSetup: {
    audioDevices: [
      { deviceId: 'mic-1', label: 'Default Microphone' },
      { deviceId: 'mic-2', label: 'Studio USB Mic' },
    ],
    selectedDeviceId: 'mic-1',
    setSelectedDeviceId: vi.fn(),
    volumeLevel: 45,
    isMuted: false,
    error: null,
    challengePhrase: 'My student ID is 123456 and my microphone is working',
    isListeningStt: false,
    transcript: '',
    isVerified: false,
    verificationScore: 0,
    startSttVerification: vi.fn(),
    stopSttVerification: vi.fn(),
    startStream: vi.fn(),
    isRecordingPlayback: false,
    isPlayingBack: false,
    startPlaybackTest: vi.fn(),
  },
}));

vi.mock('../hooks/useAudioSetup', () => ({
  useAudioSetup: () => mockUseAudioSetup,
}));

describe('MicSetupModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <MicSetupModal isOpen={false} onClose={vi.fn()} onConfirm={vi.fn()} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders microphone setup UI elements when isOpen is true', () => {
    render(
      <MicSetupModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        studentUid="std-101"
      />
    );

    expect(screen.getByText('Microphone Setup & Verification')).toBeInTheDocument();
    expect(screen.getByLabelText('1. Select Microphone Device')).toBeInTheDocument();
    expect(screen.getByText('2. Live Volume Level')).toBeInTheDocument();
    expect(screen.getByText('3. Voice Verification Challenge')).toBeInTheDocument();
    expect(screen.getByText('4. Audio Loopback Check')).toBeInTheDocument();
    expect(screen.getByText('"My student ID is 123456 and my microphone is working"')).toBeInTheDocument();
  });

  it('handles device change and triggers stream initialization', () => {
    render(
      <MicSetupModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'mic-2' } });

    expect(mockUseAudioSetup.setSelectedDeviceId).toHaveBeenCalledWith('mic-2');
    expect(mockUseAudioSetup.startStream).toHaveBeenCalledWith('mic-2');
  });

  it('triggers STT voice challenge when test button is clicked', () => {
    render(
      <MicSetupModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />
    );

    const testBtn = screen.getByRole('button', { name: /Start Voice Test/i });
    fireEvent.click(testBtn);

    expect(mockUseAudioSetup.startSttVerification).toHaveBeenCalled();
  });

  it('calls onConfirm with selected device details on confirm button click', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <MicSetupModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
      />
    );

    const confirmBtn = screen.getByRole('button', { name: /Proceed with Microphone/i });
    fireEvent.click(confirmBtn);

    expect(onConfirm).toHaveBeenCalledWith({
      deviceId: 'mic-1',
      isVerified: false,
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('hides close & cancel buttons in mandatory exam mode', () => {
    render(
      <MicSetupModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        mandatory={true}
      />
    );

    expect(screen.queryByTitle('Close')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    expect(screen.getByText(/Audio recording is required for this class session/i)).toBeInTheDocument();
  });
});
