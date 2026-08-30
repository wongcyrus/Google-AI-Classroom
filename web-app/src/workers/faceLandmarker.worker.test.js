import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createMockLandmarks = (yawOffset = 0, pitchOffset = 0) => {
  const landmarks = Array.from({ length: 478 }, () => ({
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

  // Eye landmarks for EAR
  landmarks[386] = { x: 0.45, y: 0.38, z: 0 };
  landmarks[374] = { x: 0.45, y: 0.42, z: 0 };
  landmarks[385] = { x: 0.55, y: 0.38, z: 0 };
  landmarks[380] = { x: 0.55, y: 0.42, z: 0 };
  landmarks[159] = { x: 0.25, y: 0.38, z: 0 };
  landmarks[145] = { x: 0.25, y: 0.42, z: 0 };
  landmarks[158] = { x: 0.35, y: 0.38, z: 0 };
  landmarks[153] = { x: 0.35, y: 0.42, z: 0 };

  // Mouth landmarks for MAR
  landmarks[61] = { x: 0.45, y: 0.60, z: 0 };
  landmarks[291] = { x: 0.55, y: 0.60, z: 0 };
  landmarks[13] = { x: 0.50, y: 0.58, z: 0 };
  landmarks[14] = { x: 0.50, y: 0.62, z: 0 };

  return landmarks;
};

const mockDetectForVideo = vi.fn();
const mockLandmarker = {
  detectForVideo: mockDetectForVideo,
  close: vi.fn(),
};

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn().mockResolvedValue({}),
  },
  FaceLandmarker: {
    createFromOptions: vi.fn().mockImplementation(async (resolver, options) => {
      if (options?.baseOptions?.delegate === 'GPU_FAIL') {
        throw new Error('GPU WebGL failed');
      }
      return mockLandmarker;
    }),
  },
}));

describe('faceLandmarker.worker.js Web Worker Logic', () => {
  let onMessageHandler;
  let postedMessages = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    postedMessages = [];

    if (!onMessageHandler) {
      // Simulate Worker global scope once
      global.self = {
        set onmessage(fn) {
          onMessageHandler = fn;
        },
        get onmessage() {
          return onMessageHandler;
        },
        postMessage: vi.fn((msg) => postedMessages.push(msg)),
      };

      await import('./faceLandmarker.worker.js');
    }

    global.self.postMessage = vi.fn((msg) => postedMessages.push(msg));
    mockDetectForVideo.mockReturnValue({
      faceLandmarks: [createMockLandmarks()],
    });
  });

  afterEach(() => {
    // Keep global.self
  });

  it('handles "init" action and responds with delegateUsed', async () => {
    await onMessageHandler({
      data: {
        action: 'init',
        id: 'init_1',
        preferredDelegate: 'GPU',
      },
    });

    expect(global.self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'init_result',
        id: 'init_1',
        success: true,
        delegate: 'GPU',
      })
    );
  });

  it('handles "process" action and computes EAR, MAR, and yaw/pitch with baseline offsets', async () => {
    const mockBitmap = { close: vi.fn() };

    await onMessageHandler({
      data: {
        action: 'process',
        id: 'req_1',
        bitmap: mockBitmap,
        timestamp: 1000,
        baselineYaw: 5,
        baselinePitch: -3,
      },
    });

    expect(global.self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'process_result',
        id: 'req_1',
        result: expect.objectContaining({
          faceCount: 1,
          faceStatus: 'normal',
          ear: expect.any(Number),
          mar: expect.any(Number),
        }),
      })
    );
    expect(mockBitmap.close).toHaveBeenCalled();
  });

  it('returns "no_face" when no facial landmarks are detected', async () => {
    mockDetectForVideo.mockReturnValueOnce({ faceLandmarks: [] });
    const mockBitmap = { close: vi.fn() };

    await onMessageHandler({
      data: {
        action: 'process',
        id: 'req_2',
        bitmap: mockBitmap,
        timestamp: 2000,
      },
    });

    expect(global.self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'process_result',
        id: 'req_2',
        result: {
          faceCount: 0,
          faceStatus: 'no_face',
        },
      })
    );
  });

  it('returns "multiple_faces" when more than one face is detected', async () => {
    mockDetectForVideo.mockReturnValueOnce({
      faceLandmarks: [createMockLandmarks(), createMockLandmarks()],
    });
    const mockBitmap = { close: vi.fn() };

    await onMessageHandler({
      data: {
        action: 'process',
        id: 'req_3',
        bitmap: mockBitmap,
        timestamp: 3000,
      },
    });

    expect(global.self.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'process_result',
        id: 'req_3',
        result: {
          faceCount: 2,
          faceStatus: 'multiple_faces',
        },
      })
    );
  });

  it('handles "close" action and cleans up landmarker resources', async () => {
    await onMessageHandler({
      data: {
        action: 'close',
      },
    });

    expect(mockLandmarker.close).toHaveBeenCalled();
  });
});
