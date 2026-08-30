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

  it('renders Step 1 audio check, allows microphone selection, and triggers speech test', async () => {
    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={vi.fn()}
        onComplete={vi.fn()}
        user={{ uid: 'student_1', email: 'student@example.com' }}
        classId="CLASS_1"
      />
    );

    expect(screen.getByText(/Pre-Exam Readiness Wizard/i)).toBeInTheDocument();
    expect(screen.getByText(/1. 🎙️ Audio Check/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Internal Mic')).toBeInTheDocument();
    });

    const micSelect = screen.getByRole('combobox');
    fireEvent.change(micSelect, { target: { value: 'mic_2' } });
    expect(micSelect.value).toBe('mic_2');

    // Speech test button
    const speechBtn = screen.getByText('Test Speech');
    fireEvent.click(speechBtn);
    expect(activeRecognitionInstance).not.toBeNull();
    expect(activeRecognitionInstance.start).toHaveBeenCalled();

    // Simulate STT speech result
    act(() => {
      activeRecognitionInstance.onresult({
        results: [[{ transcript: 'I am ready for the exam' }]],
      });
    });

    expect(screen.getByText(/Recognized: "I am ready for the exam"/i)).toBeInTheDocument();
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

    // Verify speech first to enable Next button
    const speechBtn = screen.getByText('Test Speech');
    fireEvent.click(speechBtn);
    act(() => {
      activeRecognitionInstance.onresult({
        results: [[{ transcript: 'Ready for proctoring' }]],
      });
    });

    // Step 1: Click Next
    const nextBtn1 = screen.getByText(/Next: Camera Check/i);
    expect(nextBtn1).not.toBeDisabled();
    fireEvent.click(nextBtn1);

    // Step 2: Camera Check & Neutral Gaze Calibration
    await waitFor(() => {
      expect(screen.getByText(/Calibrate Neutral Pose/i)).toBeInTheDocument();
    });

    // Change camera
    const cameraSelect = screen.getByRole('combobox');
    fireEvent.change(cameraSelect, { target: { value: 'cam_2' } });
    expect(cameraSelect.value).toBe('cam_2');

    const calibrateBtn = screen.getByText(/Calibrate Neutral Pose/i);
    fireEvent.click(calibrateBtn);
    expect(screen.getByText(/✓ Calibrated/i)).toBeInTheDocument();

    // Step 2: Back button test
    const backBtn1 = screen.getByText('← Back');
    fireEvent.click(backBtn1);
    expect(screen.getByText(/1. 🎙️ Audio Check/i)).toBeInTheDocument();

    // Return to Step 2 then Step 3
    fireEvent.click(screen.getByText(/Next: Camera Check/i));
    const nextBtn2 = screen.getByText(/Next: Screen Share/i);
    fireEvent.click(nextBtn2);

    // Step 3: Screen Share Verification
    expect(screen.getByText(/3. 🖥️ Screen Share/i)).toBeInTheDocument();
    const screenShareBtn = screen.getByText(/Test Share Entire Screen/i);
    await act(async () => {
      fireEvent.click(screenShareBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/✓ Screen Verified/i)).toBeInTheDocument();
    });

    // Step 3: Back button test
    const backBtn2 = screen.getByText('← Back');
    fireEvent.click(backBtn2);
    expect(screen.getByText(/2. 👁️ Camera Pose/i)).toBeInTheDocument();

    // Back to Step 3 and complete
    fireEvent.click(screen.getByText(/Next: Screen Share/i));
    const finishBtn = screen.getByText(/Complete & Enter Exam/i);
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

  it('handles screen share failure gracefully and finishes even if save fails', async () => {
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockRejectedValue(new Error('User cancelled screen share'));
    mockSetDoc.mockRejectedValueOnce(new Error('Firestore offline'));

    const onComplete = vi.fn();

    render(
      <ExamReadinessWizard
        isOpen={true}
        onClose={vi.fn()}
        onComplete={onComplete}
        user={{ uid: 'student_1' }}
        classId="CLASS_1"
      />
    );

    // Complete Step 1
    fireEvent.click(screen.getByText('Test Speech'));
    act(() => {
      activeRecognitionInstance.onresult({ results: [[{ transcript: 'Ready' }]] });
    });
    fireEvent.click(screen.getByText(/Next: Camera Check/i));

    // Step 2: Calibrate
    await waitFor(() => expect(screen.getByText(/Calibrate Neutral Pose/i)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Calibrate Neutral Pose/i));
    fireEvent.click(screen.getByText(/Next: Screen Share/i));

    // Step 3: Test screen share rejection
    const screenShareBtn = screen.getByText(/Test Share Entire Screen/i);
    await act(async () => {
      fireEvent.click(screenShareBtn);
    });
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
