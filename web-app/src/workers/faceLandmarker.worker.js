/**
 * faceLandmarker.worker.js
 * Dedicated Web Worker for offloading MediaPipe FaceLandmarker inference,
 * Eye Aspect Ratio (EAR), Mouth Aspect Ratio (MAR), and head pose orientation math.
 */

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';

let landmarker = null;
let isInitializing = false;

// Euclidean distance helper
function dist(p1, p2) {
  if (!p1 || !p2) return 0;
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

// Eye Aspect Ratio (EAR)
function computeEAR(landmarks) {
  if (!landmarks) return 0.3;
  const l_p1 = landmarks[362], l_p2 = landmarks[386], l_p3 = landmarks[385];
  const l_p4 = landmarks[263], l_p5 = landmarks[380], l_p6 = landmarks[374];
  
  const r_p1 = landmarks[33], r_p2 = landmarks[159], r_p3 = landmarks[158];
  const r_p4 = landmarks[133], r_p5 = landmarks[153], r_p6 = landmarks[145];
  
  if (!l_p1 || !l_p2 || !l_p3 || !l_p4 || !l_p5 || !l_p6 ||
      !r_p1 || !r_p2 || !r_p3 || !r_p4 || !r_p5 || !r_p6) {
    return 0.3;
  }

  const leftEAR = (dist(l_p2, l_p6) + dist(l_p3, l_p5)) / (2 * (dist(l_p1, l_p4) || 0.001));
  const rightEAR = (dist(r_p2, r_p6) + dist(r_p3, r_p5)) / (2 * (dist(r_p1, r_p4) || 0.001));
  return (leftEAR + rightEAR) / 2;
}

// Mouth Aspect Ratio (MAR)
function computeMAR(landmarks) {
  if (!landmarks) return 0.15;
  const p61 = landmarks[61], p291 = landmarks[291];
  const p13 = landmarks[13], p14 = landmarks[14];
  const p39 = landmarks[39], p181 = landmarks[181];
  const p269 = landmarks[269], p405 = landmarks[405];

  if (!p61 || !p291 || !p13 || !p14) return 0.15;

  const vertical = dist(p13, p14) +
                   (p39 && p181 ? dist(p39, p181) : 0) +
                   (p269 && p405 ? dist(p269, p405) : 0);
  const numVertical = (p39 && p181 && p269 && p405) ? 3 : 1;
  const horizontal = dist(p61, p291) || 0.001;

  return vertical / (numVertical * horizontal);
}

// Initialize FaceLandmarker in Worker
async function initWorkerLandmarker(wasmPath, modelPath, preferredDelegate = 'GPU') {
  if (landmarker) return { status: 'ready', delegate: preferredDelegate };
  isInitializing = true;
  try {
    const filesetResolver = await FilesetResolver.forVisionTasks(
      wasmPath || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );
    try {
      landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: preferredDelegate,
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 2,
      });
      return { status: 'ready', delegate: preferredDelegate };
    } catch (gpuErr) {
      // Fallback to CPU delegate in worker
      landmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
        baseOptions: {
          modelAssetPath: modelPath || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'CPU',
        },
        outputFaceBlendshapes: false,
        runningMode: 'VIDEO',
        numFaces: 2,
      });
      return { status: 'ready', delegate: 'CPU' };
    }
  } finally {
    isInitializing = false;
  }
}

// Process ImageBitmap
function processFrame(bitmap, timestamp, baselineYaw = 0, baselinePitch = 0) {
  if (!landmarker || !bitmap) return null;
  try {
    const results = landmarker.detectForVideo(bitmap, timestamp || performance.now());
    const faces = results?.faceLandmarks || [];

    if (faces.length === 0) {
      return { faceCount: 0, faceStatus: 'no_face' };
    }
    if (faces.length > 1) {
      return { faceCount: faces.length, faceStatus: 'multiple_faces' };
    }

    const landmarks = faces[0];
    const ear = computeEAR(landmarks);
    const mar = computeMAR(landmarks);

    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const chin = landmarks[152];
    const forehead = landmarks[10];

    let yaw = 0;
    let pitch = 0;

    if (nose && leftEye && rightEye && chin && forehead) {
      const dLeft = dist(nose, leftEye);
      const dRight = dist(nose, rightEye);
      const yawRatio = (dLeft - dRight) / (dLeft + dRight);
      yaw = Math.round(yawRatio * 100) - baselineYaw;

      const dNoseChin = chin.y - nose.y;
      const dNoseForehead = nose.y - forehead.y;
      const pitchRatio = (dNoseChin - dNoseForehead) / (dNoseChin + dNoseForehead);
      pitch = Math.round((pitchRatio - (-0.10)) * 100) - baselinePitch;
    }

    return {
      faceCount: 1,
      faceStatus: 'normal',
      yaw,
      pitch,
      ear: Number(ear.toFixed(3)),
      mar: Number(mar.toFixed(3)),
      landmarks,
    };
  } finally {
    try {
      if (bitmap && typeof bitmap.close === 'function') {
        bitmap.close();
      }
    } catch {}
  }
}

// Worker message listener
self.onmessage = async (e) => {
  const { action, id, wasmPath, modelPath, preferredDelegate, bitmap, timestamp, baselineYaw, baselinePitch } = e.data;

  if (action === 'init') {
    try {
      const res = await initWorkerLandmarker(wasmPath, modelPath, preferredDelegate);
      self.postMessage({ type: 'init_result', id, success: true, delegate: res.delegate });
    } catch (err) {
      self.postMessage({ type: 'init_result', id, success: false, error: err.message });
    }
  } else if (action === 'process') {
    try {
      const result = processFrame(bitmap, timestamp, baselineYaw, baselinePitch);
      self.postMessage({ type: 'process_result', id, result });
    } catch (err) {
      self.postMessage({ type: 'process_result', id, error: err.message });
    }
  } else if (action === 'close') {
    if (landmarker) {
      try { landmarker.close(); } catch {}
      landmarker = null;
    }
  }
};
