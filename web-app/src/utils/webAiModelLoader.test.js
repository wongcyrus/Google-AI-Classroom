import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isModelCached,
  fetchModelWithProgress,
  clearModelCache,
  initFaceLandmarkerWithProgress,
  calculateEAR,
  calculateMAR,
  WEBAI_CACHE_NAME,
  DEFAULT_FACE_MODEL_PATH,
} from './webAiModelLoader';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: {
    forVisionTasks: vi.fn(),
  },
  FaceLandmarker: {
    createFromOptions: vi.fn(),
  },
}));

describe('webAiModelLoader Utility', () => {
  let mockCache;
  let mockCaches;

  beforeEach(() => {
    vi.clearAllMocks();

    mockCache = {
      match: vi.fn(),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
    };

    mockCaches = {
      open: vi.fn().mockResolvedValue(mockCache),
      delete: vi.fn().mockResolvedValue(true),
    };

    // Attach to global window
    global.window = global.window || {};
    global.window.caches = mockCaches;
  });

  afterEach(() => {
    delete global.window.caches;
  });

  describe('isModelCached', () => {
    it('returns true when model is in Cache Storage', async () => {
      mockCache.match.mockResolvedValueOnce(new Response('dummy-bytes'));
      const cached = await isModelCached('/test-model.task');
      expect(cached).toBe(true);
      expect(mockCaches.open).toHaveBeenCalledWith(WEBAI_CACHE_NAME);
      expect(mockCache.match).toHaveBeenCalledWith('/test-model.task');
    });

    it('returns false when model is not in Cache Storage', async () => {
      mockCache.match.mockResolvedValueOnce(null);
      const cached = await isModelCached('/test-model.task');
      expect(cached).toBe(false);
    });

    it('handles cache errors gracefully and returns false', async () => {
      mockCaches.open.mockRejectedValueOnce(new Error('Cache disabled'));
      const cached = await isModelCached();
      expect(cached).toBe(false);
    });
  });

  describe('fetchModelWithProgress', () => {
    it('returns cached ArrayBuffer immediately with 100% progress when cache hit occurs', async () => {
      const dummyData = new Uint8Array([1, 2, 3, 4]).buffer;
      const cachedResponse = new Response(dummyData);
      mockCache.match.mockResolvedValueOnce(cachedResponse);

      const progressEvents = [];
      const buffer = await fetchModelWithProgress('/test-model.task', (p) => progressEvents.push(p));

      expect(buffer.byteLength).toBe(4);
      expect(progressEvents.length).toBe(1);
      expect(progressEvents[0]).toEqual({
        loaded: 4,
        total: 4,
        percent: 100,
        fromCache: true,
      });
    });

    it('streams from network, reports progress chunks, and saves to cache when cache misses', async () => {
      mockCache.match.mockResolvedValueOnce(null);

      const chunk1 = new Uint8Array([1, 2]);
      const chunk2 = new Uint8Array([3, 4]);

      let readStep = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readStep++;
          if (readStep === 1) return Promise.resolve({ done: false, value: chunk1 });
          if (readStep === 2) return Promise.resolve({ done: false, value: chunk2 });
          return Promise.resolve({ done: true, value: undefined });
        }),
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          'content-length': '4',
          'content-type': 'application/octet-stream',
        }),
        body: {
          getReader: () => mockReader,
        },
      });

      const progressEvents = [];
      const buffer = await fetchModelWithProgress('/test-model.task', (p) => progressEvents.push(p));

      expect(buffer.byteLength).toBe(4);
      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0]).toEqual({ loaded: 2, total: 4, percent: 50, fromCache: false });
      expect(progressEvents[1]).toEqual({ loaded: 4, total: 4, percent: 100, fromCache: false });
      expect(mockCache.put).toHaveBeenCalled();
    });

    it('throws error when network response is not ok', async () => {
      mockCache.match.mockResolvedValueOnce(null);
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(fetchModelWithProgress('/bad-model.task')).rejects.toThrow('Failed to fetch model asset');
    });

    it('falls back to arrayBuffer() when body.getReader is unavailable', async () => {
      mockCache.match.mockResolvedValueOnce(null);
      const dummyBuffer = new ArrayBuffer(8);
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '8' }),
        body: null,
        arrayBuffer: vi.fn().mockResolvedValue(dummyBuffer),
      });

      const progressEvents = [];
      const result = await fetchModelWithProgress('/test.task', (p) => progressEvents.push(p));

      expect(result).toBe(dummyBuffer);
      expect(progressEvents[0].percent).toBe(100);
    });
  });

  describe('clearModelCache', () => {
    it('deletes specific model from cache when url is provided', async () => {
      await clearModelCache('/test.task');
      expect(mockCache.delete).toHaveBeenCalledWith('/test.task');
    });

    it('deletes entire cache when modelUrl is not specified', async () => {
      await clearModelCache(null);
      expect(mockCaches.delete).toHaveBeenCalledWith(WEBAI_CACHE_NAME);
    });
  });

  describe('initFaceLandmarkerWithProgress', () => {
    it('initializes FaceLandmarker with GPU delegate when successful', async () => {
      mockCache.match.mockResolvedValueOnce(new Response(new ArrayBuffer(10)));
      FilesetResolver.forVisionTasks.mockResolvedValueOnce({ wasm: 'mock-vision' });
      const mockLandmarker = { close: vi.fn() };
      FaceLandmarker.createFromOptions.mockResolvedValueOnce(mockLandmarker);

      const result = await initFaceLandmarkerWithProgress({
        preferredDelegate: 'GPU',
      });

      expect(result.landmarker).toBe(mockLandmarker);
      expect(result.delegateUsed).toBe('GPU');
      expect(result.fromCache).toBe(true);
      expect(FaceLandmarker.createFromOptions).toHaveBeenCalledWith(
        { wasm: 'mock-vision' },
        expect.objectContaining({
          baseOptions: expect.objectContaining({ delegate: 'GPU' }),
        })
      );
    });

    it('falls back to CPU delegate when GPU initialization throws', async () => {
      mockCache.match.mockResolvedValueOnce(new Response(new ArrayBuffer(10)));
      FilesetResolver.forVisionTasks.mockResolvedValueOnce({ wasm: 'mock-vision' });
      const mockLandmarker = { close: vi.fn() };

      FaceLandmarker.createFromOptions
        .mockRejectedValueOnce(new Error('WebGL unsupported'))
        .mockResolvedValueOnce(mockLandmarker);

      const result = await initFaceLandmarkerWithProgress({
        preferredDelegate: 'GPU',
      });

      expect(result.landmarker).toBe(mockLandmarker);
      expect(result.delegateUsed).toBe('CPU');
      expect(FaceLandmarker.createFromOptions).toHaveBeenCalledTimes(2);
    });

    it('falls back to CDN when local WASM path resolution fails', async () => {
      mockCache.match.mockResolvedValueOnce(new Response(new ArrayBuffer(10)));
      FilesetResolver.forVisionTasks
        .mockRejectedValueOnce(new Error('Local 404'))
        .mockResolvedValueOnce({ wasm: 'cdn-vision' });

      FaceLandmarker.createFromOptions.mockResolvedValueOnce({ close: vi.fn() });

      const result = await initFaceLandmarkerWithProgress();
      expect(result.landmarker).toBeDefined();
      expect(FilesetResolver.forVisionTasks).toHaveBeenCalledTimes(2);
    });
  });

  describe('calculateEAR (Eye Aspect Ratio)', () => {
    it('returns default 0.30 when landmarks are null or incomplete', () => {
      expect(calculateEAR(null)).toBe(0.30);
      expect(calculateEAR([])).toBe(0.30);
    });

    it('calculates open eyes EAR accurately', () => {
      const mockLandmarks = [];
      for (let i = 0; i < 478; i++) {
        mockLandmarks[i] = { x: 0.5, y: 0.5, z: 0 };
      }
      // Left eye coords: 362 (p1), 386 (p2), 385 (p3), 263 (p4), 380 (p5), 374 (p6)
      mockLandmarks[362] = { x: 0.40, y: 0.50, z: 0 };
      mockLandmarks[263] = { x: 0.60, y: 0.50, z: 0 }; // horizontal width = 0.20
      mockLandmarks[386] = { x: 0.45, y: 0.47, z: 0 };
      mockLandmarks[374] = { x: 0.45, y: 0.53, z: 0 }; // vertical 1 = 0.06
      mockLandmarks[385] = { x: 0.55, y: 0.47, z: 0 };
      mockLandmarks[380] = { x: 0.55, y: 0.53, z: 0 }; // vertical 2 = 0.06
      // leftEAR = (0.06 + 0.06) / (2 * 0.20) = 0.12 / 0.40 = 0.30

      // Right eye coords: 33 (p1), 159 (p2), 158 (p3), 133 (p4), 153 (p5), 145 (p6)
      mockLandmarks[33] = { x: 0.20, y: 0.50, z: 0 };
      mockLandmarks[133] = { x: 0.40, y: 0.50, z: 0 }; // horizontal width = 0.20
      mockLandmarks[159] = { x: 0.25, y: 0.47, z: 0 };
      mockLandmarks[145] = { x: 0.25, y: 0.53, z: 0 }; // vertical 1 = 0.06
      mockLandmarks[158] = { x: 0.35, y: 0.47, z: 0 };
      mockLandmarks[153] = { x: 0.35, y: 0.53, z: 0 }; // vertical 2 = 0.06
      // rightEAR = (0.06 + 0.06) / (2 * 0.20) = 0.30

      const ear = calculateEAR(mockLandmarks);
      expect(ear).toBeCloseTo(0.30, 2);
    });

    it('detects closed eyes (low EAR < 0.18)', () => {
      const mockLandmarks = [];
      for (let i = 0; i < 478; i++) {
        mockLandmarks[i] = { x: 0.5, y: 0.5, z: 0 };
      }
      mockLandmarks[362] = { x: 0.40, y: 0.50, z: 0 };
      mockLandmarks[263] = { x: 0.60, y: 0.50, z: 0 };
      mockLandmarks[386] = { x: 0.45, y: 0.495, z: 0 };
      mockLandmarks[374] = { x: 0.45, y: 0.505, z: 0 }; // vertical 1 = 0.01
      mockLandmarks[385] = { x: 0.55, y: 0.495, z: 0 };
      mockLandmarks[380] = { x: 0.55, y: 0.505, z: 0 }; // vertical 2 = 0.01

      mockLandmarks[33] = { x: 0.20, y: 0.50, z: 0 };
      mockLandmarks[133] = { x: 0.40, y: 0.50, z: 0 };
      mockLandmarks[159] = { x: 0.25, y: 0.495, z: 0 };
      mockLandmarks[145] = { x: 0.25, y: 0.505, z: 0 };
      mockLandmarks[158] = { x: 0.35, y: 0.495, z: 0 };
      mockLandmarks[153] = { x: 0.35, y: 0.505, z: 0 };

      const ear = calculateEAR(mockLandmarks);
      expect(ear).toBeLessThan(0.18);
    });
  });

  describe('calculateMAR (Mouth Aspect Ratio)', () => {
    it('returns default 0.15 when landmarks are null or empty', () => {
      expect(calculateMAR(null)).toBe(0.15);
      expect(calculateMAR([])).toBe(0.15);
    });

    it('detects talking/open mouth (high MAR > 0.50)', () => {
      const mockLandmarks = [];
      for (let i = 0; i < 478; i++) {
        mockLandmarks[i] = { x: 0.5, y: 0.5, z: 0 };
      }
      // Mouth corners 61 and 291 (width = 0.10)
      mockLandmarks[61] = { x: 0.45, y: 0.70, z: 0 };
      mockLandmarks[291] = { x: 0.55, y: 0.70, z: 0 };
      // Vertical inner lips 13, 14 (height = 0.08)
      mockLandmarks[13] = { x: 0.50, y: 0.66, z: 0 };
      mockLandmarks[14] = { x: 0.50, y: 0.74, z: 0 };
      mockLandmarks[39] = { x: 0.48, y: 0.66, z: 0 };
      mockLandmarks[181] = { x: 0.48, y: 0.74, z: 0 };
      mockLandmarks[269] = { x: 0.52, y: 0.66, z: 0 };
      mockLandmarks[405] = { x: 0.52, y: 0.74, z: 0 };

      const mar = calculateMAR(mockLandmarks);
      expect(mar).toBeGreaterThan(0.50);
    });
  });
});
