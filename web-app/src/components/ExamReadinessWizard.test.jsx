import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ExamReadinessWizard from './ExamReadinessWizard';

const mockSetDoc = vi.fn().mockResolvedValue();

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'mock-doc' })),
  setDoc: (...args) => mockSetDoc(...args),
}));

describe('ExamReadinessWizard Component', () => {
  let activeRecognitionInstance = null;

  beforeEach(() => {
    vi.clearAllMocks();
    activeRecognitionInstance = null;

    const mockTrack = { stop: vi.fn(), getSettings: () => ({ displaySurface: 'monitor', width: 1920, height: 1080 }) };
    const mockStream = {
      getTracks: vi.fn().mockReturnValue([mockTrack]),
      getVideoTracks: vi.fn().mockReturnValue([mockTrack]),
      getAudioTracks: vi.fn().mockReturnValue([mockTrack]),
    };

    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'audioinput', deviceId: 'mic_1', label: 'Internal Mic' },
        { kind: 'audioinput', deviceId: 'mic_2', label: 'USB Headset' },
        { kind: 'videoinput', deviceId: 'cam_1', label: 'FaceTime HD Camera' },
        { kind: 'videoinput', deviceId: 'cam_2', label: 'USB Web Camera' },
      ]),
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
      getDisplayMedia: vi.fn().mockResolvedValue(mockStream),
    };

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
      activeRecognitionInstance = this;
    }

    window.SpeechRecognition = MockSpeechRecognition;
    window.webkitSpeechRecognition = MockSpeechRecognition;
  });

  it('renders Step 1 audio check, allows microphone selection, and handles skip/test', async () => {
    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        user={{ uid: 'student_1', email: 'student@example.com' }}
        classId="CLASS_1"
      />
    );

    expect(screen.getByText(/Class Setup & Readiness/i)).toBeInTheDocument();
    expect(screen.getByText(/1. 🎙️ Microphone/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Internal Mic')).toBeInTheDocument();
    });

    const micSelect = screen.getByRole('combobox');
    fireEvent.change(micSelect, { target: { value: 'mic_2' } });
    expect(micSelect.value).toBe('mic_2');

    // Skip / Proceed without Mic
    const skipMicBtn = screen.getByText(/Proceed without Mic/i);
    fireEvent.click(skipMicBtn);
    expect(screen.getByText(/2. 📷 Camera & Pose/i)).toBeInTheDocument();
  });

  it('navigates through all 3 steps, changes camera, calibrates face, verifies screen share and finishes', async () => {
    const onComplete = vi.fn();
    const onClose = vi.fn();
    const onSelectMicDevice = vi.fn();
    const onSelectCameraDevice = vi.fn();

    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={onClose}
        onComplete={onComplete}
        onSelectMicDevice={onSelectMicDevice}
        onSelectCameraDevice={onSelectCameraDevice}
        user={{ uid: 'student_1', email: 'student@example.com' }}
        classId="CLASS_1"
      />
    );

    // Step 1: Click Next
    await waitFor(() => {
      const nextBtn1 = screen.getByRole('button', { name: /Next: Camera Check/i });
      expect(nextBtn1).not.toBeDisabled();
      fireEvent.click(nextBtn1);
    });

    // Step 2: Camera Check & Neutral Gaze Calibration
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Set Center Pose/i })).toBeInTheDocument();
    });

    // Change camera
    const cameraSelect = screen.getByRole('combobox');
    fireEvent.change(cameraSelect, { target: { value: 'cam_2' } });
    expect(cameraSelect.value).toBe('cam_2');

    const calibrateBtn = screen.getByRole('button', { name: /Set Center Pose/i });
    fireEvent.click(calibrateBtn);
    expect(screen.getByText(/✓ Pose Calibrated/i)).toBeInTheDocument();

    // Step 2: Back button test
    const backBtn1 = screen.getByRole('button', { name: /← Back/i });
    fireEvent.click(backBtn1);
    expect(screen.getByText(/1. 🎙️ Microphone/i)).toBeInTheDocument();

    // Return to Step 2 then Step 3
    fireEvent.click(screen.getByRole('button', { name: /Next: Camera Check/i }));
    const nextBtn2 = screen.getByRole('button', { name: /Next: Screen Share/i });
    fireEvent.click(nextBtn2);

    // Step 3: Screen Share Verification
    expect(screen.getByText(/3. 🖥️ Screen Share/i)).toBeInTheDocument();
    const screenShareBtn = screen.getByRole('button', { name: /Select & Share Entire Screen/i });
    await act(async () => {
      fireEvent.click(screenShareBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Screen Verified/i)).toBeInTheDocument();
    });

    // Step 3: Back button test
    const backBtn2 = screen.getByRole('button', { name: /← Back/i });
    fireEvent.click(backBtn2);
    expect(screen.getByText(/2. 📷 Camera & Pose/i)).toBeInTheDocument();

    // Back to Step 3 and complete
    fireEvent.click(screen.getByRole('button', { name: /Next: Screen Share/i }));
    const finishBtn = screen.getByRole('button', { name: /Complete & Enter Class/i });
    await act(async () => {
      fireEvent.click(finishBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
      expect(onSelectMicDevice).toHaveBeenCalled();
      expect(onSelectCameraDevice).toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('handles zero hardware devices gracefully (no webcam, no mic)', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);
    const onComplete = vi.fn();

    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={vi.fn()}
        onComplete={onComplete}
        user={{ uid: 'student_no_hardware' }}
        classId="CLASS_1"
      />
    );

    // Step 1 detects no mic
    await waitFor(() => {
      expect(screen.getByText(/No Microphone Detected/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Proceed Without Mic/i }));

    // Step 2 detects no camera
    await waitFor(() => {
      expect(screen.getByText(/No Webcam Detected/i)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Proceed Without Camera/i }));

    // Step 3: Screen share test
    expect(screen.getByText(/3. 🖥️ Screen Share/i)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Select & Share Entire Screen/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/✅ Verified/i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Complete & Enter Class/i }));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({
        hasCamera: false,
        hasMic: false,
      }));
    });
  });

  it('reuses an active StudentView screen stream instead of requesting a second one', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);
    const activeTrack = {
      stop: vi.fn(),
      readyState: 'live',
      getSettings: () => ({
        displaySurface: 'monitor',
        width: 1920,
        height: 1080,
      }),
    };
    const activeStream = {
      getTracks: () => [activeTrack],
      getVideoTracks: () => [activeTrack],
    };

    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        user={{ uid: 'student_1' }}
        classId="CLASS_1"
        currentScreenStream={activeStream}
      />
    );

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Proceed Without Mic/i }));
    });
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Proceed Without Camera/i }));
    });

    expect(screen.getByText(/✅ Verified/i)).toBeInTheDocument();
    expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    expect(activeTrack.stop).not.toHaveBeenCalled();
  });

  it('stops an untransferred wizard screen stream when the wizard closes', async () => {
    navigator.mediaDevices.enumerateDevices = vi.fn().mockResolvedValue([]);
    const wizardTrack = {
      stop: vi.fn(),
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'monitor' }),
    };
    const wizardStream = {
      getTracks: () => [wizardTrack],
      getVideoTracks: () => [wizardTrack],
    };
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockResolvedValue(wizardStream);

    const props = {
      onClose: vi.fn(),
      onComplete: vi.fn(),
      user: { uid: 'student_1' },
      classId: 'CLASS_1',
    };
    const { rerender } = render(
      <ExamReadinessWizard isOpen={true} {...props} />
    );

    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Proceed Without Mic/i }));
    });
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /Proceed Without Camera/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Select & Share Entire Screen/i }));
    });
    await waitFor(() => expect(screen.getByText(/✅ Verified/i)).toBeInTheDocument());

    rerender(<ExamReadinessWizard isOpen={false} {...props} />);
    expect(wizardTrack.stop).toHaveBeenCalledOnce();
  });

  it('triggers onClose when close icon is clicked', () => {
    const onClose = vi.fn();
    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={onClose}
        onComplete={vi.fn()}
        user={{ uid: 'student_1' }}
        classId="CLASS_1"
      />
    );

    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });
});
