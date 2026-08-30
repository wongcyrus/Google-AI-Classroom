import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from './useAudioRecorder';

// Mock Firebase
vi.mock('firebase/storage', () => ({
  ref: vi.fn((storage, path) => ({ fullPath: path })),
  uploadBytes: vi.fn().mockResolvedValue({
    metadata: { size: 1024 },
    ref: { fullPath: 'audio/test.webm' },
  }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ id: 'audio_col' })),
  doc: vi.fn((col, path) => ({ id: path || 'mock-doc-id' })),
  setDoc: vi.fn().mockResolvedValue({}),
  updateDoc: vi.fn().mockResolvedValue({}),
}));

vi.mock('../firebase-config', () => ({
  storage: {},
  db: {},
}));

describe('useAudioRecorder Hook', () => {
  let originalMediaDevices;
  let originalAudioContext;
  let originalMediaRecorder;

  beforeEach(() => {
    originalMediaDevices = navigator.mediaDevices;
    originalAudioContext = window.AudioContext;
    originalMediaRecorder = window.MediaRecorder;

    const mockStream = {
      getTracks: vi.fn(() => [{ stop: vi.fn() }]),
    };

    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue(mockStream),
    };

    class MockAudioContext {
      constructor() {
        this.state = 'running';
      }
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          smoothingTimeConstant: 0.8,
          frequencyBinCount: 128,
          getByteFrequencyData: vi.fn((arr) => {
            arr.fill(20);
          }),
        };
      }
      close() {
        return Promise.resolve();
      }
      resume() {
        return Promise.resolve();
      }
    }

    window.AudioContext = MockAudioContext;

    // Mock MediaRecorder
    class MockMediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
      requestData() {
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['mock-audio-chunk'], { type: 'audio/webm' }) });
        }
      }
      static isTypeSupported() {
        return true;
      }
    }

    window.MediaRecorder = MockMediaRecorder;
  });

  afterEach(() => {
    navigator.mediaDevices = originalMediaDevices;
    window.AudioContext = originalAudioContext;
    window.MediaRecorder = originalMediaRecorder;
    vi.clearAllMocks();
  });

  it('initializes with default inactive state when disabled', () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 'STD_1',
        enabled: false,
      })
    );

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioStream).toBeNull();
    expect(result.current.currentVolume).toBe(0);
    expect(result.current.uploadedSegmentsCount).toBe(0);
  });

  it('starts recording when enabled is true and classId + studentUid are present', async () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 'STD_1',
        enabled: true,
        segmentDuration: 30,
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isRecording).toBe(true);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: true,
      video: false,
    });
  });

  it('stops recording and releases stream tracks when stopRecording is called', async () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 'STD_1',
        enabled: true,
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioStream).toBeNull();
  });

  it('handles microphone access permission error gracefully', async () => {
    navigator.mediaDevices.getUserMedia = vi.fn().mockRejectedValue(new Error('Permission denied'));

    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 'STD_1',
        enabled: true,
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.isRecording).toBe(false);
    expect(result.current.audioError).toBe('Permission denied');
    expect(result.current.hasMicPermission).toBe(false);
  });
});
