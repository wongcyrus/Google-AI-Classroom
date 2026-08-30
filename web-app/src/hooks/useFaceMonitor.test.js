import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useFaceMonitor } from './useFaceMonitor';

const createMockLandmarks = (yawOffset = 0, pitchOffset = 0) => {
  const landmarks = Array.from({ length: 478 }, (_, i) => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
  }));
  landmarks[1] = { x: 0.5 + yawOffset, y: 0.5 + pitchOffset, z: 0 }; // Nose
  landmarks[33] = { x: 0.4, y: 0.4, z: 0 }; // Left Eye Outer
  landmarks[133] = { x: 0.45, y: 0.4, z: 0 }; // Left Eye Inner
  landmarks[362] = { x: 0.55, y: 0.4, z: 0 }; // Right Eye Inner
  landmarks[263] = { x: 0.6, y: 0.4, z: 0 }; // Right Eye Outer
  landmarks[152] = { x: 0.5, y: 0.7, z: 0 }; // Chin
  landmarks[10] = { x: 0.5, y: 0.3, z: 0 }; // Forehead
  landmarks[468] = { x: 0.42, y: 0.4, z: 0 }; // Left Iris Center
  landmarks[473] = { x: 0.58, y: 0.4, z: 0 }; // Right Iris Center
  landmarks[469] = { x: 0.41, y: 0.4, z: 0 };
  landmarks[471] = { x: 0.43, y: 0.4, z: 0 };
  landmarks[474] = { x: 0.57, y: 0.4, z: 0 };
  landmarks[476] = { x: 0.59, y: 0.4, z: 0 };
  return landmarks;
};

let mockDetectForVideo = vi.fn().mockReturnValue({ faceLandmarks: [createMockLandmarks()] });
let mockLandmarkerInstance = {
  detectForVideo: mockDetectForVideo,
  close: vi.fn(),
};

const { mockCalculateEAR, mockCalculateMAR } = vi.hoisted(() => ({
  mockCalculateEAR: vi.fn().mockReturnValue(0.30),
  mockCalculateMAR: vi.fn().mockReturnValue(0.15),
}));

vi.mock('../utils/webAiModelLoader', () => ({
  DEFAULT_FACE_MODEL_PATH: '/mediapipe/models/face_landmarker.task',
  isModelCached: vi.fn().mockResolvedValue(false),
  fetchModelWithProgress: vi.fn().mockImplementation(async (url, onProgress) => {
    onProgress?.({ loaded: 3758596, total: 3758596, percent: 100, fromCache: false });
    return new ArrayBuffer(8);
  }),
  initFaceLandmarkerWithProgress: vi.fn().mockImplementation(async ({ onProgress } = {}) => {
    onProgress?.({ loaded: 3758596, total: 3758596, percent: 100, fromCache: false });
    return {
      landmarker: mockLandmarkerInstance,
      delegateUsed: 'GPU',
      fromCache: false,
    };
  }),
  calculateEAR: mockCalculateEAR,
  calculateMAR: mockCalculateMAR,
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  },
  FaceLandmarker: {
    FACE_LANDMARKS_TESSELATION: [],
    FACE_LANDMARKS_RIGHT_EYE: [],
    FACE_LANDMARKS_LEFT_EYE: [],
    FACE_LANDMARKS_RIGHT_IRIS: [],
    FACE_LANDMARKS_LEFT_IRIS: [],
    FACE_LANDMARKS_FACE_OVAL: [],
    createFromOptions: vi.fn().mockImplementation(async () => mockLandmarkerInstance),
  },
  DrawingUtils: class MockDrawingUtils {
    constructor(ctx) {
      this.ctx = ctx;
    }
    drawConnectors() {}
  },
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
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => cb(performance.now()), 10);
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      clearTimeout(id);
    });
    mockDetectForVideo.mockReturnValue({ faceLandmarks: [createMockLandmarks()] });
    mockWebcamVideoRef = { current: { readyState: 4, currentTime: 1, videoWidth: 640, videoHeight: 480 } };
    mockScreenVideoRef = { current: { readyState: 4, currentTime: 1, videoWidth: 1280, videoHeight: 720 } };
    mockOverlayCanvasRef = {
      current: {
        width: 640,
        height: 480,
        getContext: vi.fn().mockReturnValue({
          clearRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          beginPath: vi.fn(),
          arc: vi.fn(),
          fill: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(),
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

  it('sets ready state and processes normal face landmarks in hybrid mode', async () => {
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
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(result.current.clientAiStatus).toBe('ready');
    expect(result.current.metricDistance).toBeGreaterThan(0);
  });

  it('detects no face when landmarks array is empty', async () => {
    mockDetectForVideo.mockReturnValue({ faceLandmarks: [] });

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
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.faceStatus).toBe('no_face');
  });

  it('detects multiple faces when more than one face landmark set is returned', async () => {
    mockDetectForVideo.mockReturnValue({
      faceLandmarks: [createMockLandmarks(), createMockLandmarks()],
    });

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
        aiMonitoringMode: 'client_only',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.faceStatus).toBe('multiple_faces');
  });

  it('detects looking away when yaw angle exceeds sensitivity threshold', async () => {
    mockDetectForVideo.mockReturnValue({
      faceLandmarks: [createMockLandmarks(0.25, 0)],
    });

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
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.faceStatus).toBe('looking_away');
  });

  it('supports relaxed and custom gazeSensitivity modes', async () => {
    mockDetectForVideo.mockReturnValue({
      faceLandmarks: [createMockLandmarks(0.05, 0)],
    });

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
        gazeSensitivity: 'custom',
        customYawAngle: 30,
        customPitchDownAngle: -25,
        customPitchUpAngle: 35,
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(result.current.clientAiStatus).toBe('ready');
  });

  it('provides loadingProgress, isModelCached, and preloadModel trigger', async () => {
    const { result } = renderHook(() =>
      useFaceMonitor({
        webcamVideoRef: mockWebcamVideoRef,
        screenVideoRef: mockScreenVideoRef,
        overlayCanvasRef: mockOverlayCanvasRef,
        activeClass: { id: 'class_1' },
        user: { uid: 'user_1', email: 'student@school.edu' },
        isWebcamSharing: false,
        aiMonitoringMode: 'hybrid',
      })
    );

    await act(async () => {
      await result.current.preloadModel();
    });

    expect(result.current.loadingProgress).toBe(100);
    expect(result.current.isModelCached).toBe(true);
  });

  it('supports adaptive baseline calibration and offset subtraction', async () => {
    mockDetectForVideo.mockReturnValue({
      faceLandmarks: [createMockLandmarks(0.12, 0.05)],
    });

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
        aiMonitoringMode: 'client_only',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(result.current.isCalibrated).toBe(false);

    act(() => {
      result.current.calibrateBaseline();
    });

    expect(result.current.isCalibrated).toBe(true);

    act(() => {
      result.current.resetCalibration();
    });

    expect(result.current.isCalibrated).toBe(false);
  });

  it('uses requestVideoFrameCallback when available on video element', async () => {
    const mockRvf = vi.fn().mockReturnValue(999);
    const mockCancelRvf = vi.fn();
    mockWebcamVideoRef.current.requestVideoFrameCallback = mockRvf;
    mockWebcamVideoRef.current.cancelVideoFrameCallback = mockCancelRvf;

    const { unmount } = renderHook(() =>
      useFaceMonitor({
        webcamVideoRef: mockWebcamVideoRef,
        screenVideoRef: mockScreenVideoRef,
        overlayCanvasRef: mockOverlayCanvasRef,
        activeClass: { id: 'class_1' },
        user: { uid: 'user_1', email: 'student@school.edu' },
        isWebcamSharing: true,
        isScreenSharing: true,
        isCapturing: true,
        aiMonitoringMode: 'client_only',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 60));
    });

    expect(mockRvf).toHaveBeenCalled();

    unmount();
    expect(mockCancelRvf).toHaveBeenCalledWith(999);
  });

  it('detects eyes_closed when EAR is below 0.18', async () => {
    mockCalculateEAR.mockReturnValue(0.12);

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
        aiMonitoringMode: 'client_only',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.faceStatus).toBe('eyes_closed');
    mockCalculateEAR.mockReturnValue(0.30);
  });

  it('detects talking when MAR is above 0.58', async () => {
    mockCalculateMAR.mockReturnValue(0.65);

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
        aiMonitoringMode: 'client_only',
      })
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(result.current.faceStatus).toBe('talking');
    mockCalculateMAR.mockReturnValue(0.15);
  });
});

