import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isGemmaModelCached,
  fetchGemmaWithProgress,
  checkGemmaHardwareAcceleration,
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
});
