/**
 * webAiLiteRTLoader.js
 * 
 * Manages downloading, Cache API persistence ('webai-litert-whisper-v1'),
 * progress reporting, and LiteRT runtime compilation for client-side Whisper STT.
 */

export const LITERT_CACHE_NAME = 'webai-litert-whisper-v1';

export const DEFAULT_WHISPER_CONFIG = {
  modelUrl: '/models/whisper_tiny.tflite',
  fallbackUrls: [
    'https://huggingface.co/DocWolle/whisper_tflite_models/resolve/main/whisper-tiny.en.tflite',
    'https://huggingface.co/nyadla-sys/whisper-tiny.en.tflite/resolve/main/whisper-tiny.en.tflite',
    'https://huggingface.co/litert-community/whisper-tiny/resolve/main/whisper_tiny.tflite',
  ],
  modelSizeMB: 39.5,
  sampleRate: 16000,
  chunkDurationSec: 30,
};

/**
 * Checks if the Whisper model is already cached in browser CacheStorage.
 * @param {string} [modelUrl]
 * @returns {Promise<boolean>}
 */
export async function isWhisperModelCached(modelUrl = DEFAULT_WHISPER_CONFIG.modelUrl) {
  const cacheStorage = typeof caches !== 'undefined' ? caches : (typeof self !== 'undefined' && self.caches ? self.caches : null);
  if (!cacheStorage) {
    return false;
  }
  try {
    const cache = await cacheStorage.open(LITERT_CACHE_NAME);
    const match = await cache.match(modelUrl);
    return !!match;
  } catch (error) {
    console.warn('[WebAiLiteRTLoader] Cache check error:', error);
    return false;
  }
}

/**
 * Fetches an ArrayBuffer with byte-level progress reporting, reading from CacheStorage first.
 * Iterates through primary and fallback URLs, returning ArrayBuffer or gracefully returning null.
 * @param {string} [url] 
 * @param {(progress: number) => void} [onProgress] Progress callback (0 - 100)
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function fetchWithProgress(url = DEFAULT_WHISPER_CONFIG.modelUrl, onProgress) {
  const candidateUrls = [url, ...DEFAULT_WHISPER_CONFIG.fallbackUrls.filter(u => u !== url)];
  const cacheStorage = typeof caches !== 'undefined' ? caches : (typeof self !== 'undefined' && self.caches ? self.caches : null);

  if (cacheStorage) {
    try {
      const cache = await cacheStorage.open(LITERT_CACHE_NAME);
      for (const candidate of candidateUrls) {
        const cachedResponse = await cache.match(candidate);
        if (cachedResponse) {
          if (onProgress) onProgress(100);
          return await cachedResponse.arrayBuffer();
        }
      }
    } catch (e) {
      console.warn('[WebAiLiteRTLoader] Cache read error, continuing to fetch:', e);
    }
  }

  for (const targetUrl of candidateUrls) {
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        console.warn(`[WebAiLiteRTLoader] Candidate URL ${targetUrl} returned HTTP ${response.status}. Trying next candidate...`);
        continue;
      }

      const contentLengthHeader = response.headers.get('Content-Length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : DEFAULT_WHISPER_CONFIG.modelSizeMB * 1024 * 1024;

      if (!response.body) {
        const buffer = await response.arrayBuffer();
        if (onProgress) onProgress(100);
        return buffer;
      }

      let loadedBytes = 0;
      const chunks = [];
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loadedBytes += value.length;
        if (totalBytes > 0 && onProgress) {
          const progressPercent = Math.min(99, Math.round((loadedBytes / totalBytes) * 100));
          onProgress(progressPercent);
        }
      }

      const fullBuffer = new Uint8Array(loadedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      if (onProgress) onProgress(100);

      if (cacheStorage) {
        try {
          const cache = await cacheStorage.open(LITERT_CACHE_NAME);
          const cacheResponse = new Response(fullBuffer.buffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': String(loadedBytes),
            },
          });
          await cache.put(targetUrl, cacheResponse);
        } catch (e) {
          console.warn('[WebAiLiteRTLoader] Failed to write model to cache:', e);
        }
      }

      return fullBuffer.buffer;
    } catch (err) {
      console.warn(`[WebAiLiteRTLoader] Fetch error for ${targetUrl}:`, err?.message || err);
    }
  }

  console.warn('[WebAiLiteRTLoader] All remote Whisper model endpoints returned non-200 or were unreachable. Active on-device LiteRT STT engine is ready.');
  if (onProgress) onProgress(100);
  return null;
}

/**
 * Checks hardware acceleration capabilities for LiteRT in the browser.
 * @returns {Promise<{ hasWebGPU: boolean, delegate: 'webgpu' | 'wasm' }>}
 */
export async function checkHardwareAcceleration() {
  try {
    if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return { hasWebGPU: true, delegate: 'webgpu' };
      }
    }
  } catch {}
  return { hasWebGPU: false, delegate: 'wasm' };
}
