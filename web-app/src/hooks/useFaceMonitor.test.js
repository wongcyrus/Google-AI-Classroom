import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFaceMonitor } from './useFaceMonitor';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  },
  FaceLandmarker: {
    createFromOptions: vi.fn().mockResolvedValue({
      detectForVideo: vi.fn().mockReturnValue({
        faceLandmarks: [],
      }),
      close: vi.fn(),
    }),
  },
  DrawingUtils: vi.fn().mockImplementation(() => ({
    drawConnectors: vi.fn(),
  })),
}));

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: vi.fn().mockResolvedValue({ id: 'doc-123' }),
  doc: vi.fn(),
  updateDoc: vi.fn().mockResolvedValue({}),
  serverTimestamp: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn().mockResolvedValue({}),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/img.jpg'),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
}));

describe('useFaceMonitor Hook', () => {
  let mockWebcamVideoRef;
  let mockScreenVideoRef;
  let mockOverlayCanvasRef;

  beforeEach(() => {
    mockWebcamVideoRef = { current: { readyState: 4, currentTime: 1 } };
    mockScreenVideoRef = { current: { readyState: 4, currentTime: 1 } };
    mockOverlayCanvasRef = {
      current: {
        width: 640,
        height: 480,
        getContext: vi.fn().mockReturnValue({
          clearRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
        }),
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sets disabled status when aiMonitoringMode is "disabled"', () => {
    const { result } = renderHook(() =>
      useFaceMonitor({
        webcamVideoRef: mockWebcamVideoRef,
        screenVideoRef: mockScreenVideoRef,
        overlayCanvasRef: mockOverlayCanvasRef,
        activeClass: { id: 'class_1' },
        user: { uid: 'user_1', email: 'student@school.edu' },
        isWebcamSharing: true,
        isScreenSharing: true,
        aiMonitoringMode: 'disabled',
      })
    );

    expect(result.current.faceStatus).toBe('disabled');
    expect(result.current.clientAiStatus).toBe('disabled');
    expect(result.current.yawAngle).toBe(0);
    expect(result.current.pitchAngle).toBe(0);
  });

  it('sets cloud_fallback status when aiMonitoringMode is "cloud_only"', () => {
    const { result } = renderHook(() =>
      useFaceMonitor({
        webcamVideoRef: mockWebcamVideoRef,
        screenVideoRef: mockScreenVideoRef,
        overlayCanvasRef: mockOverlayCanvasRef,
        activeClass: { id: 'class_1' },
        user: { uid: 'user_1', email: 'student@school.edu' },
        isWebcamSharing: true,
        isScreenSharing: true,
        aiMonitoringMode: 'cloud_only',
      })
    );

    expect(result.current.faceStatus).toBe('cloud_fallback');
    expect(result.current.clientAiStatus).toBe('cloud_fallback');
  });

  it('initializes landmarker and sets state in hybrid mode', async () => {
    const { result } = renderHook(() =>
      useFaceMonitor({
        webcamVideoRef: mockWebcamVideoRef,
        screenVideoRef: mockScreenVideoRef,
        overlayCanvasRef: mockOverlayCanvasRef,
        activeClass: { id: 'class_1' },
        user: { uid: 'user_1', email: 'student@school.edu' },
        isWebcamSharing: true,
        isScreenSharing: true,
        isCapturing: true,
        aiMonitoringMode: 'hybrid',
        gazeSensitivity: 'strict',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(result.current.metricDistance).toBe(55);
  });
});
