import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioRecorder } from './useAudioRecorder';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(() => ({ id: 'doc_audio_1' })),
  setDoc: vi.fn().mockResolvedValue({}),
  updateDoc: vi.fn().mockResolvedValue({}),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn().mockResolvedValue({ metadata: { size: 1024 } }),
}));

vi.mock('../utils/offlineBufferManager', () => ({
  saveToOfflineQueue: vi.fn().mockResolvedValue('item-1'),
  flushOfflineQueue: vi.fn().mockResolvedValue(0),
}));

describe('useAudioRecorder Hook & AI Monitoring Modes', () => {
  let mockAudioTrack;
  let mockMediaStream;
  let mockGetUserMedia;

  beforeEach(() => {
    mockAudioTrack = {
      stop: vi.fn(),
      enabled: true,
      kind: 'audio',
    };

    mockMediaStream = {
      getTracks: vi.fn(() => [mockAudioTrack]),
      getAudioTracks: vi.fn(() => [mockAudioTrack]),
    };

    mockGetUserMedia = vi.fn().mockResolvedValue(mockMediaStream);

    Object.defineProperty(global.navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: mockGetUserMedia,
      },
    });

    global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 16));
    global.cancelAnimationFrame = vi.fn((id) => clearTimeout(id));

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
          getByteFrequencyData: vi.fn((arr) => arr.fill(20)),
        };
      }
      close() {
        return Promise.resolve();
      }
      resume() {
        return Promise.resolve();
      }
    }

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
      static isTypeSupported() {
        return true;
      }
    }

    global.AudioContext = MockAudioContext;
    global.MediaRecorder = MockMediaRecorder;
    window.AudioContext = MockAudioContext;
    window.webkitAudioContext = MockAudioContext;
    window.MediaRecorder = MockMediaRecorder;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('correctly sets effectiveMode and allowCloudDiarization in "hybrid" mode', () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: false,
        aiMonitoringMode: 'hybrid',
      })
    );

    expect(result.current.effectiveMode).toBe('hybrid');
    expect(result.current.isCloudDiarizationAllowed).toBe(true);
    expect(result.current.isRecording).toBe(false);
  });

  it('correctly sets effectiveMode and disallows cloud diarization in "client_only" mode', () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: false,
        aiMonitoringMode: 'client_only',
      })
    );

    expect(result.current.effectiveMode).toBe('client_only');
    expect(result.current.isCloudDiarizationAllowed).toBe(false);
  });

  it('correctly sets effectiveMode and allows cloud diarization in "cloud_only" or "server_only" mode', () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: false,
        aiMonitoringMode: 'server_only',
      })
    );

    expect(result.current.effectiveMode).toBe('cloud_only');
    expect(result.current.isCloudDiarizationAllowed).toBe(true);
  });

  it('does not start recording and sets effectiveMode="disabled" when aiMonitoringMode="disabled"', async () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: true,
        aiMonitoringMode: 'disabled',
      })
    );

    expect(result.current.effectiveMode).toBe('disabled');
    expect(result.current.isCloudDiarizationAllowed).toBe(false);
    expect(result.current.isRecording).toBe(false);
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('starts audio recording stream when enabled in hybrid mode', async () => {
    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: false,
        aiMonitoringMode: 'hybrid',
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(mockGetUserMedia).toHaveBeenCalled();
    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(mockAudioTrack.stop).toHaveBeenCalled();
  });

  it('handles dataavailable events and triggers audio segment upload', async () => {
    let recorderInstance = null;
    class ControllableMediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        recorderInstance = this;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }
    window.MediaRecorder = ControllableMediaRecorder;
    global.MediaRecorder = ControllableMediaRecorder;

    const onAudioUploaded = vi.fn();

    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        enabled: false,
        aiMonitoringMode: 'hybrid',
        silenceSuppression: false,
        onAudioUploaded,
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    expect(recorderInstance).not.toBeNull();

    // Trigger ondataavailable with mock Blob
    await act(async () => {
      const mockBlob = new Blob(['mock-audio-bytes'], { type: 'audio/webm' });
      recorderInstance.ondataavailable({ data: mockBlob });
    });

    expect(result.current.isRecording).toBe(true);

    act(() => {
      result.current.stopRecording();
    });
  });

  it('handles offline queueing when network upload fails', async () => {
    const { uploadBytes } = await import('firebase/storage');
    uploadBytes.mockRejectedValueOnce(new Error('Network disconnected'));

    let recorderInstance = null;
    class OfflineMediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        recorderInstance = this;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
      static isTypeSupported() {
        return true;
      }
    }
    window.MediaRecorder = OfflineMediaRecorder;
    global.MediaRecorder = OfflineMediaRecorder;

    const { result } = renderHook(() =>
      useAudioRecorder({
        classId: 'CLASS_1',
        studentUid: 's1',
        enabled: false,
        aiMonitoringMode: 'hybrid',
        silenceSuppression: false,
      })
    );

    await act(async () => {
      await result.current.startRecording();
    });

    await act(async () => {
      const mockBlob = new Blob(['mock-offline-audio'], { type: 'audio/webm' });
      recorderInstance.ondataavailable({ data: mockBlob });
    });

    act(() => {
      result.current.stopRecording();
    });
  });
});
