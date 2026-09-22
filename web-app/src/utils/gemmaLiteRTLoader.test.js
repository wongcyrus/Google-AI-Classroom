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
  });

  it('detects hardware acceleration for Gemma', async () => {
    const hw = await checkGemmaHardwareAcceleration();
    expect(hw).toBeDefined();
    expect(['webgpu', 'wasm']).toContain(hw.delegate);
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
  });
});
