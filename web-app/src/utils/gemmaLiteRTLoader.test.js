import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isGemmaModelCached,
  fetchGemmaWithProgress,
  checkGemmaHardwareAcceleration,
  precheckGemmaViability,
  GEMMA_CACHE_NAME,
  DEFAULT_GEMMA_CONFIG,
} from './gemmaLiteRTLoader';

describe('gemmaLiteRTLoader', () => {
  let originalCaches;

  beforeEach(() => {
    originalCaches = globalThis.caches;
  });

  afterEach(() => {
    globalThis.caches = originalCaches;
    vi.restoreAllMocks();
  });

  it('checks if gemma model is cached in CacheStorage', async () => {
    const testUrl = 'https://example.com/gemma-2b.bin';
    const mockMatch = vi.fn().mockResolvedValue(new Response('gemma_model_data'));
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: mockMatch,
      }),
    };

    const isCached = await isGemmaModelCached(testUrl);
    expect(isCached).toBe(true);
    expect(globalThis.caches.open).toHaveBeenCalledWith(GEMMA_CACHE_NAME);
  });

  it('returns false if gemma cache check misses or errors', async () => {
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
      }),
    };

    const isCached = await isGemmaModelCached('https://example.com/gemma-2b.bin');
    expect(isCached).toBe(false);

    // Test null URL
    expect(await isGemmaModelCached(null)).toBe(false);

    // Test cache throws
    globalThis.caches = {
      open: vi.fn().mockRejectedValue(new Error('CacheStorage permission denied')),
    };
    expect(await isGemmaModelCached('https://example.com/gemma-2b.bin')).toBe(false);
  });

  it('returns cached arrayBuffer immediately on cache hit in fetchGemmaWithProgress', async () => {
    const testUrl = 'https://example.com/cached-gemma.bin';
    const cachedBuffer = new ArrayBuffer(16);
    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue({
          arrayBuffer: vi.fn().mockResolvedValue(cachedBuffer),
        }),
      }),
    };

    const progressCalls = [];
    const result = await fetchGemmaWithProgress(testUrl, (p) => progressCalls.push(p));
    expect(result).toBe(cachedBuffer);
    expect(progressCalls).toContain(100);
  });

  it('fetches gemma model with streamed progress reporting', async () => {
    const testUrl = 'https://example.com/gemma-2b.bin';
    const mockData = new Uint8Array([10, 20, 30, 40, 50, 60]);
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
      headers: new Headers({ 'Content-Length': '6' }),
      body: mockStream,
    });

    const progressCalls = [];
    const buffer = await fetchGemmaWithProgress(testUrl, (p) => {
      progressCalls.push(p);
    });

    expect(buffer).toBeDefined();
    expect(buffer.byteLength).toBe(6);
    expect(progressCalls).toContain(100);
  });

  it('handles response without body stream by reading arrayBuffer directly', async () => {
    const testUrl = 'https://example.com/no-stream-body.bin';
    const expectedBuffer = new ArrayBuffer(32);

    globalThis.caches = {
      open: vi.fn().mockResolvedValue({
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockRejectedValue(new Error('QuotaExceeded on put')),
      }),
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(expectedBuffer),
      headers: new Headers(),
    });

    const progressCalls = [];
    const buffer = await fetchGemmaWithProgress(testUrl, (p) => progressCalls.push(p));
    expect(buffer).toBe(expectedBuffer);
    expect(progressCalls).toContain(100);
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
    const buffer = await fetchGemmaWithProgress('https://invalid-url.com/model.bin', (p) => {
      progressCalls.push(p);
    });

    expect(buffer).toBeNull();

    // Test null URL
    expect(await fetchGemmaWithProgress(null)).toBeNull();

    // Test fetch throws exception
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('DNS lookup failure'));
    expect(await fetchGemmaWithProgress('https://offline-dns.com/model.bin')).toBeNull();
  });

  it('catches cache read error in fetchGemmaWithProgress and proceeds with fetch', async () => {
    globalThis.caches = {
      open: vi.fn().mockRejectedValue(new Error('Cache error')),
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      headers: new Headers(),
    });

    const buffer = await fetchGemmaWithProgress('https://example.com/model.bin');
    expect(buffer).toBeDefined();
  });

  it('detects hardware acceleration for Gemma and catches adapter errors', async () => {
    const hw = await checkGemmaHardwareAcceleration();
    expect(hw).toBeDefined();
    expect(['webgpu', 'wasm']).toContain(hw.delegate);

    // Test when navigator.gpu throws
    const origGpu = navigator.gpu;
    try {
      Object.defineProperty(navigator, 'gpu', {
        value: {
          requestAdapter: vi.fn().mockRejectedValue(new Error('GPU context lost')),
        },
        configurable: true,
      });

      const fallbackHw = await checkGemmaHardwareAcceleration();
      expect(fallbackHw.hasWebGPU).toBe(false);
      expect(fallbackHw.delegate).toBe('wasm');
    } finally {
      Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
    }
  });

  describe('precheckGemmaViability', () => {
    it('returns viable false when WebGPU is not supported', async () => {
      const origGpu = navigator.gpu;
      try {
        Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
        const result = await precheckGemmaViability();
        expect(result.viable).toBe(false);
        expect(result.hasWebGPU).toBe(false);
        expect(result.reason).toContain('WebGPU is not supported');
      } finally {
        Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
      }
    });

    it('returns viable false when storage quota is insufficient', async () => {
      const origGpu = navigator.gpu;
      const origStorage = navigator.storage;
      try {
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
        Object.defineProperty(navigator, 'storage', {
          value: {
            estimate: vi.fn().mockResolvedValue({
              quota: 10 * 1024 * 1024 * 1024,
              usage: 9 * 1024 * 1024 * 1024, // only 1GB free, needs 2.5GB
            }),
          },
          configurable: true,
        });

        const result = await precheckGemmaViability();
        expect(result.viable).toBe(false);
        expect(result.hasWebGPU).toBe(true);
        expect(result.reason).toContain('Insufficient storage quota');
      } finally {
        Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
      }
    });

    it('returns viable true when WebGPU and sufficient storage exist', async () => {
      const origGpu = navigator.gpu;
      const origStorage = navigator.storage;
      try {
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
        Object.defineProperty(navigator, 'storage', {
          value: {
            estimate: vi.fn().mockResolvedValue({
              quota: 50 * 1024 * 1024 * 1024,
              usage: 5 * 1024 * 1024 * 1024, // 45GB free
            }),
          },
          configurable: true,
        });

        const result = await precheckGemmaViability();
        expect(result.viable).toBe(true);
        expect(result.hasWebGPU).toBe(true);
      } finally {
        Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
      }
    });

    it('handles storage estimate error gracefully and returns viable true', async () => {
      const origGpu = navigator.gpu;
      const origStorage = navigator.storage;
      try {
        Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });
        Object.defineProperty(navigator, 'storage', {
          value: {
            estimate: vi.fn().mockRejectedValue(new Error('Storage estimate error')),
          },
          configurable: true,
        });

        const result = await precheckGemmaViability();
        expect(result.viable).toBe(true);
        expect(result.hasWebGPU).toBe(true);
      } finally {
        Object.defineProperty(navigator, 'gpu', { value: origGpu, configurable: true });
        Object.defineProperty(navigator, 'storage', { value: origStorage, configurable: true });
      }
    });
  });
});
