/**
 * gemmaLiteRTLoader.js
 * 
 * Utility for loading, streaming progress, and caching quantized Google Gemma models
 * using Google LiteRT.js (@litertjs/core) and the browser CacheStorage API.
 */

export const GEMMA_CACHE_NAME = 'webai-litert-gemma-v1';

export const DEFAULT_GEMMA_CONFIG = {
  modelUrl: null,
  modelName: 'gemma-2b-it-gpu-int4.bin',
  approximateSizeMB: 1350,
};

/**
 * Checks if the Gemma model is already cached in CacheStorage.
 * @returns {Promise<boolean>}
 */
export async function isGemmaModelCached(modelUrl = DEFAULT_GEMMA_CONFIG.modelUrl) {
  if (!modelUrl || typeof window === 'undefined' || !('caches' in window)) {
    return false;
  }
  try {
    const cache = await caches.open(GEMMA_CACHE_NAME);
    const match = await cache.match(modelUrl);
    return Boolean(match);
  } catch (err) {
    return false;
  }
}

/**
 * Downloads the Gemma model binary with progress reporting and saves it to CacheStorage.
 * If no custom model URL is provided or remote candidate is unavailable, returns null
 * so LiteRT worker smoothly runs the on-device intent analysis engine.
 * @param {string|null} url 
 * @param {(progress: number) => void} onProgress 
 * @returns {Promise<ArrayBuffer|null>}
 */
export async function fetchGemmaWithProgress(url = null, onProgress) {
  if (!url) {
    return null;
  }

  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await caches.open(GEMMA_CACHE_NAME);
      const cachedResponse = await cache.match(url);
      if (cachedResponse) {
        onProgress?.(100);
        return await cachedResponse.arrayBuffer();
      }
    } catch (e) {
      // Cache lookup error
    }
  }

  try {
    const response = await fetch(url);
    if (!response || !response.ok) {
      return null;
    }

      const contentLengthHeader = response.headers.get('Content-Length');
      const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : DEFAULT_GEMMA_CONFIG.approximateSizeMB * 1024 * 1024;

      if (!response.body) {
        const buffer = await response.arrayBuffer();
        onProgress?.(100);
        return buffer;
      }

      const reader = response.body.getReader();
      let receivedBytes = 0;
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        if (totalBytes > 0) {
          const percent = Math.min(99, Math.round((receivedBytes / totalBytes) * 100));
          onProgress?.(percent);
        }
      }

      const fullBuffer = new Uint8Array(receivedBytes);
      let offset = 0;
      for (const chunk of chunks) {
        fullBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      onProgress?.(100);

      if (typeof window !== 'undefined' && 'caches' in window) {
        try {
          const cache = await caches.open(GEMMA_CACHE_NAME);
          const cacheResponse = new Response(fullBuffer.buffer, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': String(receivedBytes),
            },
          });
          await cache.put(url, cacheResponse);
        } catch (e) {
          console.warn('[GemmaLiteRTLoader] Failed to write model to cache:', e);
        }
      }

      return fullBuffer.buffer;
    } catch (err) {
      console.warn(`[GemmaLiteRTLoader] Fetch error for ${url}:`, err?.message || err);
      return null;
    }
}

/**
 * Checks hardware acceleration capability for running Gemma.
 * @returns {Promise<{ hasWebGPU: boolean, delegate: 'webgpu' | 'wasm' }>}
 */
export async function checkGemmaHardwareAcceleration() {
  try {
    if (typeof navigator !== 'undefined' && navigator.gpu) {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        return { hasWebGPU: true, delegate: 'webgpu' };
      }
    }
  } catch (e) {
    console.warn('[GemmaLiteRTLoader] WebGPU detection error:', e);
  }
  return { hasWebGPU: false, delegate: 'wasm' };
}
