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

  it('checks hardware acceleration and returns delegate', async () => {
    const hw = await checkHardwareAcceleration();
    expect(hw).toBeDefined();
    expect(['webgpu', 'wasm']).toContain(hw.delegate);
  });
});
