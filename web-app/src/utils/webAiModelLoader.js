import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

export const WEBAI_CACHE_NAME = 'webai-models-v1';
export const DEFAULT_FACE_MODEL_PATH = '/mediapipe/models/face_landmarker.task';
export const DEFAULT_WASM_PATH = '/mediapipe/wasm';
export const CDN_WASM_FALLBACK = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

/**
 * Checks whether a model file is stored in browser Cache Storage.
 * @param {string} modelUrl - URL/path of the model asset.
 * @returns {Promise<boolean>}
 */
export async function isModelCached(modelUrl = DEFAULT_FACE_MODEL_PATH) {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) {
      return false;
    }
    const cache = await window.caches.open(WEBAI_CACHE_NAME);
    const matched = await cache.match(modelUrl);
    return !!matched;
  } catch (err) {
    console.warn('[WebAiModelLoader] Cache check error:', err);
    return false;
  }
}

/**
 * Streams model download with byte-level progress reporting and caches in browser storage.
 * @param {string} modelUrl - URL/path of the model asset.
 * @param {Function} [onProgress] - Callback ({ loaded, total, percent, fromCache }) => void.
 * @returns {Promise<ArrayBuffer>}
 */
export async function fetchModelWithProgress(modelUrl = DEFAULT_FACE_MODEL_PATH, onProgress) {
  // 1. Check Cache Storage first
  if (typeof window !== 'undefined' && 'caches' in window) {
    try {
      const cache = await window.caches.open(WEBAI_CACHE_NAME);
      const cachedResponse = await cache.match(modelUrl);
      if (cachedResponse) {
        const buffer = await cachedResponse.arrayBuffer();
        if (typeof onProgress === 'function') {
          onProgress({
            loaded: buffer.byteLength,
            total: buffer.byteLength,
            percent: 100,
            fromCache: true,
          });
        }
        return buffer;
      }
    } catch (cacheErr) {
      console.warn('[WebAiModelLoader] Error reading from cache:', cacheErr);
    }
  }

  // 2. Fetch from network with streaming progress
  let fetchUrl = modelUrl;
  if (typeof window !== 'undefined' && window.location && window.location.origin && modelUrl.startsWith('/')) {
    fetchUrl = `${window.location.origin}${modelUrl}`;
  }
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch model asset from ${modelUrl} (status ${response.status})`);
  }

  const contentLengthHeader = response.headers.get('content-length');
  const totalBytes = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 3758596; // Fallback to ~3.76MB known size

  // If body reader is unavailable (e.g. older browser or mock env), fallback to arrayBuffer()
  if (!response.body || typeof response.body.getReader !== 'function') {
    const buffer = await response.arrayBuffer();
    if (typeof onProgress === 'function') {
      onProgress({
        loaded: buffer.byteLength,
        total: buffer.byteLength,
        percent: 100,
        fromCache: false,
      });
    }
    // Attempt cache
    await cacheModelBuffer(modelUrl, buffer, response.headers.get('content-type'));
    return buffer;
  }

  const reader = response.body.getReader();
  let receivedBytes = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      receivedBytes += value.length;
      if (typeof onProgress === 'function') {
        const percent = Math.min(100, Math.round((receivedBytes / totalBytes) * 100));
        onProgress({
          loaded: receivedBytes,
          total: totalBytes,
          percent,
          fromCache: false,
        });
      }
    }
  }

  // Combine chunks
  const combined = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  const finalBuffer = combined.buffer;

  // Cache downloaded bytes
  await cacheModelBuffer(modelUrl, finalBuffer, response.headers.get('content-type'));

  return finalBuffer;
}

/**
 * Saves an ArrayBuffer response to Cache Storage for instant offline/subsequent re-use.
 */
async function cacheModelBuffer(modelUrl, buffer, contentType = 'application/octet-stream') {
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await window.caches.open(WEBAI_CACHE_NAME);
      const res = new Response(buffer, {
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          'Content-Length': String(buffer.byteLength),
        },
      });
      await cache.put(modelUrl, res);
    }
  } catch (err) {
    console.warn('[WebAiModelLoader] Failed to persist model to Cache Storage:', err);
  }
}

/**
 * Clears cached Web AI model storage.
 */
export async function clearModelCache(modelUrl = DEFAULT_FACE_MODEL_PATH) {
  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cache = await window.caches.open(WEBAI_CACHE_NAME);
      if (modelUrl) {
        await cache.delete(modelUrl);
      } else {
        await window.caches.delete(WEBAI_CACHE_NAME);
      }
    }
  } catch (err) {
    console.warn('[WebAiModelLoader] Failed to clear model cache:', err);
  }
}

/**
 * High-level initializer: loads Vision WASM, fetches & caches model, and initializes FaceLandmarker
 * with automated GPU -> CPU delegate fallback.
 * @param {Object} options
 * @param {Function} [options.onProgress]
 * @param {'GPU' | 'CPU'} [options.preferredDelegate='GPU']
 * @param {string} [options.modelAssetPath=DEFAULT_FACE_MODEL_PATH]
 * @param {string} [options.wasmPath=DEFAULT_WASM_PATH]
 * @returns {Promise<{ landmarker: FaceLandmarker, delegateUsed: string, fromCache: boolean }>}
 */
export async function initFaceLandmarkerWithProgress({
  onProgress,
  preferredDelegate = 'GPU',
  modelAssetPath = DEFAULT_FACE_MODEL_PATH,
  wasmPath = DEFAULT_WASM_PATH,
} = {}) {
  let fromCache = false;

  // 1. Download / retrieve model weights with progress
  await fetchModelWithProgress(modelAssetPath, (progress) => {
    if (progress.fromCache) fromCache = true;
    if (typeof onProgress === 'function') {
      onProgress(progress);
    }
  });

  // 2. Resolve Vision Tasks WASM
  let vision;
  try {
    vision = await FilesetResolver.forVisionTasks(wasmPath);
  } catch (wasmErr) {
    console.warn('[WebAiModelLoader] Local WASM path failed, falling back to CDN...', wasmErr);
    vision = await FilesetResolver.forVisionTasks(CDN_WASM_FALLBACK);
  }

  // 3. Attempt FaceLandmarker initialization (Try GPU first, then fallback to CPU)
  let landmarker = null;
  let delegateUsed = preferredDelegate;

  const baseConfig = {
    runningMode: 'VIDEO',
    numFaces: 3,
    minFaceDetectionConfidence: 0.45,
    minFacePresenceConfidence: 0.45,
    minTrackingConfidence: 0.45,
    outputFaceBlendshapes: false,
  };

  if (preferredDelegate === 'GPU') {
    try {
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: {
          modelAssetPath,
          delegate: 'GPU',
        },
      });
      delegateUsed = 'GPU';
    } catch (gpuErr) {
      console.warn('[WebAiModelLoader] GPU delegate failed. Falling back to CPU delegate...', gpuErr);
      landmarker = await FaceLandmarker.createFromOptions(vision, {
        ...baseConfig,
        baseOptions: {
          modelAssetPath,
          delegate: 'CPU',
        },
      });
      delegateUsed = 'CPU';
    }
  } else {
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      ...baseConfig,
      baseOptions: {
        modelAssetPath,
        delegate: 'CPU',
      },
    });
    delegateUsed = 'CPU';
  }

  return {
    landmarker,
    delegateUsed,
    fromCache,
  };
}

/**
 * Calculates Eye Aspect Ratio (EAR) from MediaPipe 478 landmarks.
 * @param {Array<Object>} landmarks
 * @returns {number} Average EAR (normally 0.25 - 0.35 open, < 0.20 closed)
 */
export function calculateEAR(landmarks) {
  if (!landmarks || !Array.isArray(landmarks)) return 0.30;
  
  // Left Eye: 362 (p1), 386 (p2), 385 (p3), 263 (p4), 380 (p5), 374 (p6)
  const l_p1 = landmarks[362], l_p2 = landmarks[386], l_p3 = landmarks[385];
  const l_p4 = landmarks[263], l_p5 = landmarks[380], l_p6 = landmarks[374];
  
  // Right Eye: 33 (p1), 159 (p2), 158 (p3), 133 (p4), 153 (p5), 145 (p6)
  const r_p1 = landmarks[33], r_p2 = landmarks[159], r_p3 = landmarks[158];
  const r_p4 = landmarks[133], r_p5 = landmarks[153], r_p6 = landmarks[145];
  
  if (!l_p1 || !l_p2 || !l_p3 || !l_p4 || !l_p5 || !l_p6 ||
      !r_p1 || !r_p2 || !r_p3 || !r_p4 || !r_p5 || !r_p6) {
    return 0.30;
  }

  const leftVertical = Math.hypot(l_p2.x - l_p6.x, l_p2.y - l_p6.y) + Math.hypot(l_p3.x - l_p5.x, l_p3.y - l_p5.y);
  const leftHorizontal = 2 * (Math.hypot(l_p1.x - l_p4.x, l_p1.y - l_p4.y) || 0.001);
  const leftEAR = leftVertical / leftHorizontal;

  const rightVertical = Math.hypot(r_p2.x - r_p6.x, r_p2.y - r_p6.y) + Math.hypot(r_p3.x - r_p5.x, r_p3.y - r_p5.y);
  const rightHorizontal = 2 * (Math.hypot(r_p1.x - r_p4.x, r_p1.y - r_p4.y) || 0.001);
  const rightEAR = rightVertical / rightHorizontal;

  return Number(((leftEAR + rightEAR) / 2).toFixed(3));
}

/**
 * Calculates Mouth Aspect Ratio (MAR) from MediaPipe 478 landmarks.
 * @param {Array<Object>} landmarks
 * @returns {number} MAR (normally < 0.30 closed, 0.35 - 0.55 talking, > 0.60 yawning)
 */
export function calculateMAR(landmarks) {
  if (!landmarks || !Array.isArray(landmarks)) return 0.15;
  const p61 = landmarks[61], p291 = landmarks[291];
  const p13 = landmarks[13], p14 = landmarks[14];
  const p39 = landmarks[39], p181 = landmarks[181];
  const p269 = landmarks[269], p405 = landmarks[405];

  if (!p61 || !p291 || !p13 || !p14) return 0.15;

  const vertical = Math.hypot(p13.x - p14.x, p13.y - p14.y) +
                   (p39 && p181 ? Math.hypot(p39.x - p181.x, p39.y - p181.y) : 0) +
                   (p269 && p405 ? Math.hypot(p269.x - p405.x, p269.y - p405.y) : 0);
  const numVertical = (p39 && p181 && p269 && p405) ? 3 : 1;
  const horizontal = Math.hypot(p61.x - p291.x, p61.y - p291.y) || 0.001;

  return Number((vertical / (numVertical * horizontal)).toFixed(3));
}

