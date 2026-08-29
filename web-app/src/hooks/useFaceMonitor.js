import { useState, useEffect, useRef, useCallback } from 'react';
import { FilesetResolver, FaceLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import { db, storage, functions } from '../firebase-config';
import { collection, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { v4 as uuidv4 } from 'uuid';

export const useFaceMonitor = ({
  webcamVideoRef,
  screenVideoRef,
  overlayCanvasRef,
  activeClass,
  user,
  isWebcamSharing,
  isScreenSharing,
  isCapturing = false,
  aiMonitoringMode = 'hybrid', // 'hybrid' | 'client_only' | 'cloud_only' | 'disabled'
  enableClientAi, // optional backward-compat
  enableCloudFallback, // optional backward-compat
  gazeSensitivity = 'standard',
  customYawAngle = 25,
  customPitchDownAngle = -22,
  customPitchUpAngle = 26,
  debounceSeconds = 3,
  cloudFallbackRate = 3,
  showMeshOverlay = true,
}) => {
  // Derive effective mode with fallback to legacy booleans
  const effectiveMode = (() => {
    if (aiMonitoringMode) return aiMonitoringMode;
    if (enableClientAi === false && !enableCloudFallback) return 'disabled';
    if (enableClientAi === false && enableCloudFallback) return 'cloud_only';
    if (enableClientAi !== false && !enableCloudFallback) return 'client_only';
    return 'hybrid';
  })();

  const isClientAiAllowed = effectiveMode === 'hybrid' || effectiveMode === 'client_only';
  const isCloudFallbackAllowed = effectiveMode === 'hybrid' || effectiveMode === 'cloud_only';

  const [faceStatus, setFaceStatus] = useState('normal'); // 'normal' | 'no_face' | 'looking_away' | 'multiple_faces' | 'cloud_fallback' | 'unsupported' | 'quota_exceeded' | 'disabled'
  const [clientAiStatus, setClientAiStatus] = useState('initializing'); // 'ready' | 'cloud_fallback' | 'unsupported' | 'disabled'
  const [yawAngle, setYawAngle] = useState(0);
  const [pitchAngle, setPitchAngle] = useState(0);
  const [metricDistance, setMetricDistance] = useState(55); // Estimated distance in cm (Depth-from-Iris)
  const [activeViolation, setActiveViolation] = useState(null);

  const landmarkerRef = useRef(null);
  const requestAnimationRef = useRef(null);
  const isRunningRef = useRef(false);

  // Anti-flooding / Incident session tracking refs
  const anomalyStartRef = useRef(null);
  const lastAnomalyTimeRef = useRef(0);
  const activeIncidentDocRef = useRef(null);
  const lastResolvedTimeRef = useRef(0);
  const isUploadingIncidentRef = useRef(false);

  // Initialize MediaPipe Face Landmarker
  useEffect(() => {
    let isMounted = true;

    if (effectiveMode === 'disabled') {
      setClientAiStatus('disabled');
      setFaceStatus('disabled');
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch {}
        landmarkerRef.current = null;
      }
      return;
    }

    if (effectiveMode === 'cloud_only') {
      setClientAiStatus('cloud_fallback');
      setFaceStatus('cloud_fallback');
      if (landmarkerRef.current) {
        try { landmarkerRef.current.close(); } catch {}
        landmarkerRef.current = null;
      }
      return;
    }

    async function initLandmarker() {
      try {
        setClientAiStatus('initializing');
        
        // Try local wasm first, fallback to CDN
        let vision;
        try {
          vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');
        } catch {
          vision = await FilesetResolver.forVisionTasks(
            'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
          );
        }

        if (!isMounted) return;

        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: '/mediapipe/models/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numFaces: 3,
          minFaceDetectionConfidence: 0.45,
          minFacePresenceConfidence: 0.45,
          minTrackingConfidence: 0.45,
          outputFaceBlendshapes: false,
        });

        if (!isMounted) return;

        landmarkerRef.current = landmarker;
        setClientAiStatus('ready');
        console.log('MediaPipe Face Landmarker initialized successfully on client.');
      } catch (err) {
        console.warn('Client MediaPipe unavailable on this device.', err);
        if (isMounted) {
          if (isCloudFallbackAllowed) {
            setClientAiStatus('cloud_fallback');
            setFaceStatus('cloud_fallback');
          } else {
            setClientAiStatus('unsupported');
            setFaceStatus('unsupported');
          }
        }
      }
    }

    initLandmarker();

    return () => {
      isMounted = false;
      if (landmarkerRef.current) {
        try {
          landmarkerRef.current.close();
        } catch {
          // ignore
        }
        landmarkerRef.current = null;
      }
    };
  }, [effectiveMode, isCloudFallbackAllowed]);

  // Handle dynamic mode change transitions
  useEffect(() => {
    if (clientAiStatus === 'unsupported' && isCloudFallbackAllowed) {
      setClientAiStatus('cloud_fallback');
      setFaceStatus('cloud_fallback');
    } else if (clientAiStatus === 'cloud_fallback' && !isCloudFallbackAllowed) {
      setClientAiStatus('unsupported');
      setFaceStatus('unsupported');
    }
  }, [clientAiStatus, isCloudFallbackAllowed]);

  // Helper: Capture a single frame from a video element as a JPEG Blob
  const grabVideoBlob = useCallback(async (videoEl) => {
    if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return null;
    const canvas = document.createElement('canvas');
    const MAX_W = 1280;
    let w = videoEl.videoWidth;
    let h = videoEl.videoHeight;
    if (w > MAX_W) {
      h = Math.round((h * MAX_W) / w);
      w = MAX_W;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    return new Promise((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    });
  }, []);

  // Anti-flooding Incident Manager: Open Incident
  const startIncident = useCallback(async (violationType, detailsMessage) => {
    if (activeIncidentDocRef.current || isUploadingIncidentRef.current) return;
    if (!activeClass || !user || !user.uid) return;
    if (!isCapturing) {
      console.debug('Class is not actively capturing (test not started). Skipping irregularity incident creation.');
      return;
    }

    // Inter-incident cooldown (4 seconds)
    const now = Date.now();
    if (now - lastResolvedTimeRef.current < 4000) return;

    isUploadingIncidentRef.current = true;
    const incidentId = uuidv4();
    const timestamp = Date.now();

    try {
      console.log(`🚨 Triggering incident [${violationType}]:`, detailsMessage);
      
      // Capture synchronous dual proof (Screen + Webcam)
      let screenUrl = null;
      let webcamUrl = null;

      try {
        const [screenBlob, webcamBlob] = await Promise.all([
          grabVideoBlob(screenVideoRef.current),
          grabVideoBlob(webcamVideoRef.current),
        ]);

        const uploadPromises = [];
        if (screenBlob) {
          const screenRef = ref(storage, `irregularities/${activeClass}/${user.uid}/${timestamp}_${incidentId}_screen.jpg`);
          uploadPromises.push(
            uploadBytes(screenRef, screenBlob).then((s) => getDownloadURL(s.ref)).then((url) => { screenUrl = url; }).catch(e => console.warn('Screen upload err:', e))
          );
        }
        if (webcamBlob) {
          const webcamRef = ref(storage, `irregularities/${activeClass}/${user.uid}/${timestamp}_${incidentId}_webcam.jpg`);
          uploadPromises.push(
            uploadBytes(webcamRef, webcamBlob).then((s) => getDownloadURL(s.ref)).then((url) => { webcamUrl = url; }).catch(e => console.warn('Webcam upload err:', e))
          );
        }

        await Promise.all(uploadPromises);
      } catch (uploadErr) {
        console.warn('Incident snapshot upload error (proceeding with doc creation):', uploadErr);
      }

      // Create exactly 1 initial document in Firestore
      const docRef = await addDoc(collection(db, 'irregularities'), {
        classId: activeClass,
        studentUid: user.uid,
        studentEmail: user.email || '',
        email: user.email || '',
        studentName: user.displayName || user.email || '',
        type: violationType,
        message: detailsMessage,
        status: 'active',
        timestamp: serverTimestamp(),
        startedAt: serverTimestamp(),
        endedAt: null,
        durationSeconds: null,
        screenUrl: screenUrl || null,
        webcamUrl: webcamUrl || null,
        imageUrl: webcamUrl || screenUrl || null,
      });

      activeIncidentDocRef.current = {
        id: docRef.id,
        type: violationType,
        startedAtTime: timestamp,
      };
      console.log(`✅ Irregularity Incident recorded to Firestore [ID: ${docRef.id}]`);
    } catch (err) {
      console.error('Error starting incident:', err);
    } finally {
      isUploadingIncidentRef.current = false;
    }
  }, [activeClass, grabVideoBlob, isCapturing, screenVideoRef, user, webcamVideoRef]);

  // Anti-flooding Incident Manager: Resolve Incident
  const resolveIncident = useCallback(async () => {
    if (!activeIncidentDocRef.current) return;
    const { id, startedAtTime } = activeIncidentDocRef.current;
    activeIncidentDocRef.current = null;
    lastResolvedTimeRef.current = Date.now();

    const durationSeconds = Math.max(1, Math.round((Date.now() - startedAtTime) / 1000));

    try {
      const docRef = doc(db, 'irregularities', id);
      await updateDoc(docRef, {
        status: 'resolved',
        endedAt: serverTimestamp(),
        durationSeconds: durationSeconds,
      });
      console.log(`✅ Irregularity Incident resolved [ID: ${id}] Duration: ${durationSeconds}s`);
    } catch (err) {
      console.error('Error resolving incident:', err);
    }
  }, []);

  // Periodic Cloud Fallback Loop (only when capturing, enabled, and client-side AI is unsupported or in cloud_only mode)
  useEffect(() => {
    if (!isCapturing || clientAiStatus !== 'cloud_fallback' || !isCloudFallbackAllowed || !isWebcamSharing) {
      return;
    }

    const intervalMs = Math.max(4000, (cloudFallbackRate || 3) * 4000);
    const analyzeFaceFallbackCallable = httpsCallable(functions, 'analyzeFaceFallback');
    let isCancelled = false;

    const intervalId = setInterval(async () => {
      if (isCancelled) return;
      try {
        const webcamBlob = await grabVideoBlob(webcamVideoRef?.current);
        if (!webcamBlob || isCancelled) return;

        const tempPath = `temp_ai/fallback_${user.uid}_${Date.now()}.jpg`;
        const storageRef = ref(storage, tempPath);
        await uploadBytes(storageRef, webcamBlob, { contentType: 'image/jpeg' });
        const webcamUrl = await getDownloadURL(storageRef);

        if (isCancelled) return;

        const res = await analyzeFaceFallbackCallable({
          classId: activeClass,
          studentUid: user.uid,
          studentEmail: user.email || '',
          webcamUrl,
        });

        const data = res?.data || {};
        if (data.faceStatus === 'disabled') {
          setClientAiStatus('unsupported');
          setFaceStatus('unsupported');
        } else if (data.faceStatus === 'quota_exceeded') {
          setFaceStatus('quota_exceeded');
        } else if (data.faceStatus === 'looking_away' || data.faceStatus === 'no_face' || data.faceStatus === 'multiple_faces') {
          setFaceStatus(data.faceStatus);
          setActiveViolation(data.faceStatus);
          
          const now = Date.now();
          lastAnomalyTimeRef.current = now;
          if (!anomalyStartRef.current || anomalyStartRef.current.type !== data.faceStatus) {
            anomalyStartRef.current = { type: data.faceStatus, startTime: now };
          } else {
            const elapsed = (now - anomalyStartRef.current.startTime) / 1000;
            if (elapsed >= debounceSeconds) {
              startIncident(data.faceStatus, data.reason || 'Cloud Fallback AI Anomaly detected.');
            }
          }
        } else if (data.faceStatus === 'normal') {
          setFaceStatus('normal');
          setActiveViolation(null);
          anomalyStartRef.current = null;
          if (activeIncidentDocRef.current) {
            resolveIncident();
          }
        }
      } catch (err) {
        console.warn('Cloud Fallback analysis tick error:', err);
      }
    }, intervalMs);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [clientAiStatus, isCloudFallbackAllowed, cloudFallbackRate, isCapturing, isWebcamSharing, grabVideoBlob, webcamVideoRef, user, activeClass, debounceSeconds, startIncident, resolveIncident]);

  // Continuous Video Processing Loop (MediaPipe Client-Side WASM)
  useEffect(() => {
    if (!isClientAiAllowed || clientAiStatus !== 'ready' || !isWebcamSharing || !landmarkerRef.current) {
      if (overlayCanvasRef?.current) {
        const ctx = overlayCanvasRef.current.getContext?.('2d');
        if (ctx) {
          ctx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
        }
      }
      if (!isClientAiAllowed) {
        setFaceStatus(effectiveMode === 'disabled' ? 'disabled' : 'cloud_fallback');
        setActiveViolation(null);
      }
      return;
    }

    isRunningRef.current = true;
    let lastVideoTime = -1;

    // Configurable Gaze & Orientation Thresholds
    let yawThresh = 22;
    let pitchDownThresh = -20;
    let pitchUpThresh = 26;
    let irisLowThresh = 0.22;
    let irisHighThresh = 0.78;

    if (gazeSensitivity === 'relaxed') {
      yawThresh = 28;
      pitchDownThresh = -26;
      pitchUpThresh = 30;
      irisLowThresh = 0.18;
      irisHighThresh = 0.82;
    } else if (gazeSensitivity === 'strict') {
      yawThresh = 16;
      pitchDownThresh = -16;
      pitchUpThresh = 22;
      irisLowThresh = 0.28;
      irisHighThresh = 0.72;
    } else if (gazeSensitivity === 'custom') {
      yawThresh = Math.abs(parseInt(customYawAngle, 10)) || 25;
      pitchDownThresh = -Math.abs(parseInt(customPitchDownAngle, 10) || 22);
      pitchUpThresh = Math.abs(parseInt(customPitchUpAngle, 10)) || 26;
      irisLowThresh = 0.22;
      irisHighThresh = 0.78;
    }

    const detectFrame = () => {
      if (!isRunningRef.current) return;

      const video = webcamVideoRef.current;
      const canvas = overlayCanvasRef?.current;

      if (video && video.readyState >= 2 && landmarkerRef.current) {
        const currentTime = video.currentTime;

        try {
          if (currentTime !== lastVideoTime) {
            lastVideoTime = currentTime;
          }

          const results = landmarkerRef.current.detectForVideo(video, performance.now());

          // Overlay Drawing (Points & Connectors Mesh)
          if (canvas) {
            const ctx = canvas.getContext?.('2d');
            if (ctx) {
              canvas.width = video.videoWidth || 640;
              canvas.height = video.videoHeight || 480;
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              if (showMeshOverlay && results && results.faceLandmarks) {
                const drawingUtils = new DrawingUtils(ctx);
                for (const landmarks of results.faceLandmarks) {
                  const meshColor = activeViolation ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.4)';
                  const eyeColor = activeViolation ? 'rgba(220, 38, 38, 0.85)' : 'rgba(5, 150, 105, 0.8)';
                  const irisColor = activeViolation ? '#EF4444' : '#06B6D4';

                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_TESSELATION,
                    { color: meshColor, lineWidth: 1 }
                  );
                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
                    { color: eyeColor, lineWidth: 1.5 }
                  );
                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
                    { color: eyeColor, lineWidth: 1.5 }
                  );
                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
                    { color: irisColor, lineWidth: 2 }
                  );
                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
                    { color: irisColor, lineWidth: 2 }
                  );
                  drawingUtils.drawConnectors(
                    landmarks,
                    FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
                    { color: meshColor, lineWidth: 1.5 }
                  );

                  // Draw Gaze / Head Pose Orientation Arrow from Nose Tip
                  const nose = landmarks[1];
                  const leftEye = landmarks[33];
                  const rightEye = landmarks[263];
                  const chin = landmarks[152];
                  const forehead = landmarks[10];
                  const leftIrisCenter = landmarks[468];
                  const rightIrisCenter = landmarks[473];

                  if (nose && leftEye && rightEye && chin && forehead) {
                    const noseX = nose.x * canvas.width;
                    const noseY = nose.y * canvas.height;
                    
                    // Horizontal Yaw: difference between left eye and right eye distance to nose
                    const dLeft = Math.hypot(nose.x - leftEye.x, nose.y - leftEye.y);
                    const dRight = Math.hypot(nose.x - rightEye.x, nose.y - rightEye.y);
                    const yawRatio = (dLeft - dRight) / (dLeft + dRight);

                    // Vertical Pitch: ratio of nose-chin vs nose-forehead (neutral baseline is ~ -0.10)
                    const dNoseChin = chin.y - nose.y;
                    const dNoseForehead = nose.y - forehead.y;
                    const pitchRatio = (dNoseChin - dNoseForehead) / (dNoseChin + dNoseForehead);
                    const pitchOffset = pitchRatio - (-0.10); // > 0 when looking UP, < 0 when looking DOWN

                    // Direction vector (-Y is UP in canvas, +Y is DOWN in canvas)
                    const dirX = yawRatio * canvas.width * 2.5;
                    const dirY = -pitchOffset * canvas.height * 2.2;

                    const targetX = noseX + dirX;
                    const targetY = noseY + dirY;

                    // Draw anchor at nose
                    ctx.beginPath();
                    ctx.arc(noseX, noseY, 3, 0, 2 * Math.PI);
                    ctx.fillStyle = activeViolation ? '#DC2626' : '#10B981';
                    ctx.fill();

                    // Draw gaze direction line
                    ctx.beginPath();
                    ctx.moveTo(noseX, noseY);
                    ctx.lineTo(targetX, targetY);
                    ctx.strokeStyle = activeViolation ? '#EF4444' : '#10B981';
                    ctx.lineWidth = 3;
                    ctx.stroke();

                    // Draw pointer tip
                    ctx.beginPath();
                    ctx.arc(targetX, targetY, 5, 0, 2 * Math.PI);
                    ctx.fillStyle = activeViolation ? '#DC2626' : '#059669';
                    ctx.fill();

                    // Draw Iris Eye-Gaze Rays from Pupils (MediaPipe Iris)
                    if (leftIrisCenter && rightIrisCenter) {
                      [leftIrisCenter, rightIrisCenter].forEach((pupil) => {
                        const px = pupil.x * canvas.width;
                        const py = pupil.y * canvas.height;
                        
                        // Pupil center point
                        ctx.beginPath();
                        ctx.arc(px, py, 2.5, 0, 2 * Math.PI);
                        ctx.fillStyle = activeViolation ? '#EF4444' : '#22D3EE';
                        ctx.fill();

                        // Short gaze ray from pupil
                        ctx.beginPath();
                        ctx.moveTo(px, py);
                        ctx.lineTo(px + dirX * 0.4, py + dirY * 0.4);
                        ctx.strokeStyle = activeViolation ? '#EF4444' : '#06B6D4';
                        ctx.lineWidth = 1.5;
                        ctx.stroke();
                      });
                    }
                  }
                }
              }
            }
          }

          // Face Presence, Orientation & MediaPipe Iris Analysis
          const faces = results.faceLandmarks || [];
          let currentAnomaly = null;
          let detailsMessage = '';

          if (faces.length === 0) {
            currentAnomaly = 'no_face';
            detailsMessage = 'No student face detected in webcam frame.';
            setFaceStatus('no_face');
          } else if (faces.length > 1) {
            currentAnomaly = 'multiple_faces';
            detailsMessage = `Multiple faces (${faces.length}) detected in frame.`;
            setFaceStatus('multiple_faces');
          } else {
            const landmarks = faces[0];
            const nose = landmarks[1];
            const leftEyeOuter = landmarks[33];
            const leftEyeInner = landmarks[133];
            const rightEyeInner = landmarks[362];
            const rightEyeOuter = landmarks[263];
            const chin = landmarks[152];
            const forehead = landmarks[10];
            const leftIris = landmarks[468];
            const rightIris = landmarks[473];

            // MediaPipe Iris: Depth-from-Iris Distance Calculation (11.7mm constant diameter)
            let calculatedDistanceCm = 55;
            if (landmarks[469] && landmarks[471] && landmarks[474] && landmarks[476]) {
              const leftIrisPx = Math.hypot(landmarks[469].x - landmarks[471].x, landmarks[469].y - landmarks[471].y) * (video.videoWidth || 640);
              const rightIrisPx = Math.hypot(landmarks[474].x - landmarks[476].x, landmarks[474].y - landmarks[476].y) * (video.videoWidth || 640);
              const avgIrisPx = (leftIrisPx + rightIrisPx) / 2;
              
              if (avgIrisPx > 2) {
                const focalLength = 0.85 * (video.videoWidth || 640);
                calculatedDistanceCm = Math.round((focalLength * 1.17) / avgIrisPx);
                calculatedDistanceCm = Math.max(15, Math.min(220, calculatedDistanceCm));
                setMetricDistance(calculatedDistanceCm);
              }
            }

            if (nose && leftEyeOuter && rightEyeOuter && chin && forehead) {
              const dLeft = Math.hypot(nose.x - leftEyeOuter.x, nose.y - leftEyeOuter.y);
              const dRight = Math.hypot(nose.x - rightEyeOuter.x, nose.y - rightEyeOuter.y);
              const yawRatio = (dLeft - dRight) / (dLeft + dRight);
              
              const calculatedYaw = Math.round(yawRatio * 100);
              setYawAngle(calculatedYaw);

              const dNoseChin = chin.y - nose.y;
              const dNoseForehead = nose.y - forehead.y;
              const pitchRatio = (dNoseChin - dNoseForehead) / (dNoseChin + dNoseForehead);
              const calculatedPitch = Math.round(pitchRatio * 100);
              setPitchAngle(calculatedPitch);

              // MediaPipe Iris: Eye-Gaze Ratio (Iris position within eye aperture)
              let irisGazeAway = false;
              let irisDirection = '';
              if (leftIris && rightIris && leftEyeInner && rightEyeInner) {
                const leftEyeW = Math.max(0.001, Math.abs(leftEyeInner.x - leftEyeOuter.x));
                const rightEyeW = Math.max(0.001, Math.abs(rightEyeOuter.x - rightEyeInner.x));
                const leftRatio = (leftIris.x - Math.min(leftEyeOuter.x, leftEyeInner.x)) / leftEyeW;
                const rightRatio = (rightIris.x - Math.min(rightEyeInner.x, rightEyeOuter.x)) / rightEyeW;
                const avgIrisRatio = (leftRatio + rightRatio) / 2;
                
                if (avgIrisRatio < irisLowThresh) {
                  irisGazeAway = true;
                  irisDirection = 'left';
                } else if (avgIrisRatio > irisHighThresh) {
                  irisGazeAway = true;
                  irisDirection = 'right';
                }
              }

              // Responsive & Accurate Gaze & Distance Thresholds
              if (Math.abs(calculatedYaw) >= yawThresh) {
                currentAnomaly = 'looking_away';
                const direction = calculatedYaw > 0 ? 'right' : 'left';
                detailsMessage = `Student is looking away to the ${direction} (Head Yaw: ${calculatedYaw}°).`;
                setFaceStatus('looking_away');
              } else if (calculatedPitch < pitchDownThresh) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is looking down away from screen (Head Pitch: ${calculatedPitch}°).`;
                setFaceStatus('looking_away');
              } else if (calculatedPitch > pitchUpThresh) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is looking up away from screen (Head Pitch: ${calculatedPitch}°).`;
                setFaceStatus('looking_away');
              } else if (irisGazeAway) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student eye gaze is directed to the ${irisDirection} off-screen (Iris Gaze Shift).`;
                setFaceStatus('looking_away');
              } else if (calculatedDistanceCm > 140) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is too far away from desk/camera (Distance: ~${calculatedDistanceCm} cm).`;
                setFaceStatus('looking_away');
              } else if (calculatedDistanceCm < 20) {
                currentAnomaly = 'looking_away';
                detailsMessage = `Student is excessively close to camera lens (Distance: ~${calculatedDistanceCm} cm).`;
                setFaceStatus('looking_away');
              } else {
                setFaceStatus('normal');
              }
            }
          }

          // Anti-Jitter Debounce Gate Logic with 600ms Grace Window
          const now = Date.now();
          if (currentAnomaly) {
            lastAnomalyTimeRef.current = now;
            if (!anomalyStartRef.current || anomalyStartRef.current.type !== currentAnomaly) {
              anomalyStartRef.current = { type: currentAnomaly, startTime: now, details: detailsMessage };
            } else {
              const elapsedSeconds = (now - anomalyStartRef.current.startTime) / 1000;
              if (elapsedSeconds >= debounceSeconds) {
                setActiveViolation(currentAnomaly);
                startIncident(currentAnomaly, detailsMessage);
              }
            }
          } else {
            // Grace window of 600ms to tolerate blinks / momentary noise
            const timeSinceLastAnomaly = now - (lastAnomalyTimeRef.current || 0);
            if (timeSinceLastAnomaly > 600) {
              anomalyStartRef.current = null;
              setActiveViolation(null);
              if (activeIncidentDocRef.current) {
                resolveIncident();
              }
            }
          }
        } catch (err) {
          console.debug('MediaPipe detection tick error:', err);
        }
      }

      requestAnimationRef.current = requestAnimationFrame(detectFrame);
    };

    requestAnimationRef.current = requestAnimationFrame(detectFrame);

    return () => {
      isRunningRef.current = false;
      if (requestAnimationRef.current) {
        cancelAnimationFrame(requestAnimationRef.current);
      }
      if (activeIncidentDocRef.current) {
        resolveIncident();
      }
    };
  }, [clientAiStatus, customPitchDownAngle, customPitchUpAngle, customYawAngle, debounceSeconds, effectiveMode, gazeSensitivity, isClientAiAllowed, isWebcamSharing, overlayCanvasRef, resolveIncident, showMeshOverlay, startIncident, webcamVideoRef]);

  return {
    faceStatus,
    clientAiStatus,
    yawAngle,
    pitchAngle,
    metricDistance,
    activeViolation,
  };
};

export default useFaceMonitor;
