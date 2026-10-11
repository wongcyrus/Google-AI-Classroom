import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isWhisperModelCached,
  fetchWithProgress,
  checkHardwareAcceleration,
  LITERT_CACHE_NAME,
  DEFAULT_WHISPER_CONFIG,
} from './webAiLiteRTLoader';

describe('webAiLiteRTLoader', () => {
  let originalCaches;

  beforeEach(() => {
    originalCaches = globalThis.caches;
  });

  afterEach(() => {
    globalThis.caches = originalCaches;
    vi.restoreAllMocks();
  });

  it('checks if whisper model is cached in CacheStorage', async () => {
    const mockMatch = vi.fn().mockResolvedValue(new Response('model_data'));
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: mockMatch,
      }),
    };

    const isCached = await isWhisperModelCached();
    expect(isCached).toBe(true);
    expect(globalThis.caches.open).toHaveBeenCalledWith(LITERT_CACHE_NAME);
  });

  it('returns false if cache check throws or misses', async () => {
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
      }),
    };

    const isCached = await isWhisperModelCached();
    expect(isCached).toBe(false);

    // Test cache open throwing error
    globalThis.caches = {
      open: vi.fn().mockRejectedValue(new Error('CacheStorage access denied')),
    };
    expect(await isWhisperModelCached()).toBe(false);
  });

  it('returns cached ArrayBuffer immediately on cache hit', async () => {
    const testUrl = DEFAULT_WHISPER_CONFIG.modelUrl;
    const cachedBuffer = new ArrayBuffer(16);

    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(cachedBuffer),
        }),
      }),
    };

    const progressCalls = [];
    const result = await fetchWithProgress(testUrl, (p) => progressCalls.push(p));
    expect(result).toBe(cachedBuffer);
    expect(progressCalls).toContain(100);
  });

  it('fetches model with progressive streaming when not in cache', async () => {
    const mockData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(mockData);
        controller.close();
      },
    });

    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(),
      }),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': '8' }),
      body: mockStream,
    });

    const progressCalls = [];
    const buffer = await fetchWithProgress(DEFAULT_WHISPER_CONFIG.modelUrl, (p) => {
      progressCalls.push(p);
    });

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBe(8);
    expect(progressCalls).toContain(100);
  });

  it('handles response without body stream by reading arrayBuffer directly', async () => {
    const expectedBuffer = new ArrayBuffer(24);

    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockRejectedValue(new Error('Cache write failed')),
      }),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(expectedBuffer),
      headers: new Headers(),
    });

    const progressCalls = [];
    const buffer = await fetchWithProgress(DEFAULT_WHISPER_CONFIG.modelUrl, (p) => progressCalls.push(p));
    expect(buffer).toBe(expectedBuffer);
    expect(progressCalls).toContain(100);
  });

  it('catches cache read error in fetchWithProgress and proceeds with fetch', async () => {
    globalThis.caches = {
      open: vi.fn().mockRejectedValue(new Error('Cache read error')),
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: new Headers(),
    });

    const buffer = await fetchWithProgress(DEFAULT_WHISPER_CONFIG.modelUrl);
    expect(buffer).toBeDefined();
  });

  it('handles 404 or network errors gracefully by returning null', async () => {
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
      }),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const progressCalls = [];
    const buffer = await fetchWithProgress('https://invalid-url.com/whisper.tflite', (p) => {
      progressCalls.push(p);
    });

    expect(buffer).toBeNull();
    expect(progressCalls).toContain(100);
  });

  it('checks hardware acceleration and returns webgpu delegate when available', async () => {
    const origGpu = navigator.gpu;
    try {
      Object.defineProperty(navigator, 'gpu', {
        value: {
          requestAdapter: vi.fn().mockResolvedValue({}),
        },
        configurable: true,
      });

      const hw = await checkHardwareAcceleration();
      expect(hw.hasWebGPU).toBe(true);
      expect(hw.delegate).toBe('webgpu');
    } finally {
      Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
    }
  });

  it('catches error in checkHardwareAcceleration and falls back to wasm delegate', async () => {
    const origGpu = navigator.gpu;
    try {
      Object.defineProperty(navigator, 'gpu', {
        value: {
          requestAdapter: vi.fn().mockRejectedValue(new Error('Adapter request failed')),
        },
        configurable: true,
      });

      const hw = await checkHardwareAcceleration();
      expect(hw.hasWebGPU).toBe(false);
      expect(hw.delegate).toBe('wasm');
    } finally {
      Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
    }
  });
});
