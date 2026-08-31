import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage, db, auth } from '../firebase-config';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Banner from './Banner';
import { v4 as uuidv4 } from 'uuid';
import './StudentView.css';

import { useStudentClassSchedule } from '../hooks/useStudentClassSchedule';
import useFaceMonitor from '../hooks/useFaceMonitor';
import useAudioRecorder from '../hooks/useAudioRecorder';
import useWebRTCPeekStudent from '../hooks/useWebRTCPeekStudent';
import MicSetupModal from './MicSetupModal';
import ExamReadinessWizard from './ExamReadinessWizard';
import { saveToOfflineQueue, flushOfflineQueue, getOfflineQueueCount } from '../utils/offlineBufferManager';

import Sidebar from './student/Sidebar';

const StudentView = ({ user }) => {
  // State
  const [ipAddress, setIpAddress] = useState(null);
  const [notification, setNotification] = useState('');

  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isWebcamSharing, setIsWebcamSharing] = useState(false);
  const isSharing = isScreenSharing || isWebcamSharing;

  // Schedule-driven class state
  const { currentActiveClassId } = useStudentClassSchedule(user);
  const activeClass = currentActiveClassId;
  const [frameRate, setFrameRate] = useState(15);
  const [imageQuality, setImageQuality] = useState(0.5);
  const [maxImageSize, setMaxImageSize] = useState(0.1 * 1024 * 1024);
  const [captureMode, setCaptureMode] = useState('dual');
  const [requireFullScreenOnly, setRequireFullScreenOnly] = useState(true);
  const displaySurfaceRef = useRef(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureStartedAt, setCaptureStartedAt] = useState(null);
  const [retentionDays, setRetentionDays] = useState(30);
  const [recentIrregularities, setRecentIrregularities] = useState([]);
  const [directMessages, setDirectMessages] = useState([]);
  const [classMessages, setClassMessages] = useState([]);
  const [isReadinessWizardOpen, setIsReadinessWizardOpen] = useState(false);

  // Multi-camera selection & Layout State
  const [availableWebcams, setAvailableWebcams] = useState([]);
  const [selectedWebcamId, setSelectedWebcamId] = useState('');
  const [primaryStream, setPrimaryStream] = useState('screen'); // 'screen' | 'webcam'

  const handleSwapFeeds = useCallback(() => {
    setPrimaryStream(prev => (prev === 'screen' ? 'webcam' : 'screen'));
  }, []);

  // Notification Permission State
  const [notificationPermission, setNotificationPermission] = useState(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      return window.Notification.permission;
    }
    return 'granted';
  });
  const [dismissNotificationBanner, setDismissNotificationBanner] = useState(false);
  const [isSessionDisplaced, setIsSessionDisplaced] = useState(false);
  const [isOnline, setIsOnline] = useState(() => typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);

  // Check offline queue count on mount and sync when online
  useEffect(() => {
    const updateQueueCount = async () => {
      const count = await getOfflineQueueCount();
      setOfflinePendingCount(count);
    };
    updateQueueCount();

    const handleOnline = async () => {
      setIsOnline(true);
      try {
        await flushOfflineQueue({
          uploadItemHandler: async (item) => {
            if (item.type !== 'screenshot') return;
            const itemTime = item.timestamp || Date.now();
            const channelName = item.metadata?.channel || 'screen';
            const screenshotPath = `screenshots/${item.classId}/${item.studentUid}/${channelName}_${itemTime}.jpg`;
            const screenshotRef = ref(storage, screenshotPath);
            await uploadBytes(screenshotRef, item.blob);

            const expireAtDate = new Date(itemTime + (item.metadata?.retentionDays || 30) * 86400000);
            await addDoc(collection(db, 'screenshots'), {
              classId: item.classId,
              studentUid: item.studentUid,
              email: (item.studentEmail || '').toLowerCase(),
              channel: channelName,
              imagePath: screenshotPath,
              size: item.blob.size,
              timestamp: new Date(itemTime),
              expireAt: expireAtDate,
              isBackfilled: true,
              deleted: false,
              ipAddress: item.metadata?.ipAddress || null,
            });
          },
        });
        const remaining = await getOfflineQueueCount();
        setOfflinePendingCount(remaining);
      } catch (err) {
        console.warn('Error flushing offline screenshot queue:', err);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const result = await window.Notification.requestPermission();
        setNotificationPermission(result);
      } catch (err) {
        console.error("Error requesting notification permission:", err);
      }
    }
  }, []);

  // Custom Properties State
  const [classProperties, setClassProperties] = useState(null);
  const [myProperties, setMyProperties] = useState(null);

  const recentMessages = useMemo(() => {
    const alertTitles = new Set(recentIrregularities.map(ir => ir.title));
    const filteredMessagesForUI = [...directMessages, ...classMessages]
      .filter(msg => !alertTitles.has(msg.message));

    filteredMessagesForUI.sort((a, b) => {
      const timeA = a.timestamp?.toMillis() || 0;
      const timeB = b.timestamp?.toMillis() || 0;
      return timeB - timeA;
    });

    return filteredMessagesForUI.slice(0, 5);
  }, [directMessages, classMessages, recentIrregularities]);

  const [faceDebounceSeconds, setFaceDebounceSeconds] = useState(3);
  const [aiMonitoringMode, setAiMonitoringMode] = useState('hybrid');
  const [enableClientAi, setEnableClientAi] = useState(true);
  const [preloadClientAi, setPreloadClientAi] = useState(false);
  const [gazeSensitivity, setGazeSensitivity] = useState('standard');
  const [customYawAngle, setCustomYawAngle] = useState(25);
  const [customPitchDownAngle, setCustomPitchDownAngle] = useState(-22);
  const [customPitchUpAngle, setCustomPitchUpAngle] = useState(26);
  const [enableCloudFallback, setEnableCloudFallback] = useState(false);
  const [cloudFallbackRate, setCloudFallbackRate] = useState(3);
  const [showMeshOverlay, setShowMeshOverlay] = useState(true);

  // Audio Recording & Mic Setup State
  const [enableAudioCapture, setEnableAudioCapture] = useState(false);
  const [audioCaptureMode, setAudioCaptureMode] = useState('mandatory');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [enableSegmentTranscription, setEnableSegmentTranscription] = useState(false);
  const [audioMovingWindowDuration, setAudioMovingWindowDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  const [isMicSetupOpen, setIsMicSetupOpen] = useState(false);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
  const [isAudioUserEnabled, setIsAudioUserEnabled] = useState(true);

  // Refs
  const intervalRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const screenStreamRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);

  // Segmented Audio Recording Hook with Moving Window
  const {
    isRecording: isAudioRecording,
    audioStream,
    audioLevel,
    isSpeaking,
    hasMicPermission,
  } = useAudioRecorder({
    classId: activeClass,
    studentUid: user?.uid,
    studentEmail: user?.email,
    enabled: isSharing && enableAudioCapture && isAudioUserEnabled && !isSessionDisplaced,
    aiMonitoringMode,
    segmentDuration: audioSegmentDuration,
    windowDuration: audioMovingWindowDuration,
    strideDuration: audioMovingWindowStride,
    enableMovingWindow: enableSegmentTranscription || true,
    silenceSuppression: audioSilenceSuppression,
    retentionDays: retentionDays,
    deviceId: selectedMicDeviceId,
  });

  // Automatically activate verified devices & audio capture if readiness already completed
  useEffect(() => {
    if (myProperties?.examReadiness?.isReady) {
      setEnableAudioCapture(true);
      if (myProperties.examReadiness.micDeviceId) {
        setSelectedMicDeviceId(myProperties.examReadiness.micDeviceId);
      }
      if (myProperties.examReadiness.cameraDeviceId) {
        setSelectedWebcamId(myProperties.examReadiness.cameraDeviceId);
      }
    }
  }, [myProperties]);

  const audioStreamRef = useRef(null);
  audioStreamRef.current = audioStream;

  // WebRTC Peer Connection for Teacher Live Peeking
  useWebRTCPeekStudent({
    classId: activeClass,
    studentUid: user?.uid,
    screenStreamRef,
    webcamStreamRef,
    audioStreamRef,
  });

  // MediaPipe Face & Gaze AI Monitor
  const {
    faceStatus,
    clientAiStatus,
    loadingProgress,
    isModelCached,
    isPreloading,
    preloadModel,
    fallbackReason,
    delegateUsed,
    yawAngle,
    pitchAngle,
    earValue,
    marValue,
    isCalibrated,
    calibrateBaseline,
    resetCalibration,
    metricDistance,
    activeViolation,
  } = useFaceMonitor({
    webcamVideoRef,
    screenVideoRef,
    overlayCanvasRef,
    activeClass,
    user,
    isWebcamSharing,
    isScreenSharing,
    isCapturing,
    aiMonitoringMode,
    enableClientAi,
    preloadClientAi,
    gazeSensitivity,
    customYawAngle,
    customPitchDownAngle,
    customPitchUpAngle,
    debounceSeconds: faceDebounceSeconds,
    enableCloudFallback,
    cloudFallbackRate,
    showMeshOverlay,
  });

  // Sync real-time face, gaze, and audio telemetry to student status doc
  useEffect(() => {
    if (activeClass && user && user.uid) {
      const statusRef = doc(db, "classes", activeClass, "status", user.uid);
      const updateData = {};
      if (isWebcamSharing) {
        updateData.faceStatus = faceStatus;
        updateData.clientAiStatus = clientAiStatus;
        updateData.loadingProgress = loadingProgress;
        updateData.isModelCached = isModelCached;
        updateData.fallbackReason = fallbackReason || null;
        updateData.delegateUsed = delegateUsed || null;
        updateData.yawAngle = yawAngle;
        updateData.pitchAngle = pitchAngle;
        updateData.ear = earValue;
        updateData.mar = marValue;
        updateData.isCalibrated = isCalibrated;
        updateData.metricDistance = metricDistance || 55;
        updateData.activeViolation = activeViolation || null;
      }
      if (enableAudioCapture) {
        updateData.isAudioSharing = isAudioRecording;
        updateData.audioLevel = Math.round(audioLevel * 100);
        updateData.audioStatus = isSpeaking ? 'speaking' : 'idle';
      }
      if (Object.keys(updateData).length > 0) {
        setDoc(statusRef, updateData, { merge: true }).catch(err => console.debug("Error updating telemetry status:", err));
      }
    }
  }, [activeClass, user, isWebcamSharing, faceStatus, clientAiStatus, loadingProgress, isModelCached, fallbackReason, delegateUsed, yawAngle, pitchAngle, earValue, marValue, isCalibrated, metricDistance, activeViolation, enableAudioCapture, isAudioRecording, audioLevel, isSpeaking]);

  // Callbacks
  const handleCloseNotification = () => {
    setNotification('');
  };

  const showSystemNotification = useCallback((message) => {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) return;

    if (window.Notification.permission === 'granted') {
      navigator.serviceWorker.ready.then((registration) => {
        if (registration && registration.active) {
          registration.active.postMessage({
            type: 'show-notification',
            title: 'New Message',
            body: message,
          });
        }
      }).catch(err => console.debug("ServiceWorker notification skipped:", err));
    }
  }, []);

  const updateCaptureStatus = useCallback(async (activeStreams, classId) => {
    const targetClass = classId || activeClass;
    if (!targetClass || !user || !user.uid) return;
    const statusRef = doc(db, "classes", targetClass, "status", user.uid);
    try {
      await setDoc(statusRef, {
        isSharing: activeStreams.length > 0,
        activeStreams: activeStreams,
        displaySurface: activeStreams.includes('screen') ? (displaySurfaceRef.current || 'monitor') : null,
        email: user.email,
        name: user.displayName || user.email,
        timestamp: serverTimestamp()
      }, { merge: true });
    } catch (error) {
      console.error("Firestore: Error updating capture status: ", error);
    }
  }, [activeClass, user]);

  const stopScreen = useCallback(async () => {
    displaySurfaceRef.current = null;
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (screenVideoRef.current) {
      screenVideoRef.current.srcObject = null;
    }
    setIsScreenSharing(false);
    const activeStreams = isWebcamSharing ? ['webcam'] : [];
    await updateCaptureStatus(activeStreams);
    showSystemNotification("Screen sharing has stopped.");
  }, [isWebcamSharing, updateCaptureStatus, showSystemNotification]);

  const stopWebcam = useCallback(async () => {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (webcamVideoRef.current) {
      webcamVideoRef.current.srcObject = null;
    }
    setIsWebcamSharing(false);
    const activeStreams = isScreenSharing ? ['screen'] : [];
    await updateCaptureStatus(activeStreams);
    showSystemNotification("Webcam stream has stopped.");
  }, [isScreenSharing, updateCaptureStatus, showSystemNotification]);

  const stopAllStreams = useCallback(async () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach(track => track.stop());
      screenStreamRef.current = null;
    }
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }
    if (screenVideoRef.current) screenVideoRef.current.srcObject = null;
    if (webcamVideoRef.current) webcamVideoRef.current.srcObject = null;
    setIsScreenSharing(false);
    setIsWebcamSharing(false);
    await updateCaptureStatus([]);
  }, [updateCaptureStatus]);

  const refreshWebcams = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || `Camera ${index + 1}`
        }));
      setAvailableWebcams(videoDevices);
      if (videoDevices.length > 0) {
        setSelectedWebcamId(prev => {
          if (prev && videoDevices.some(d => d.deviceId === prev)) return prev;
          return videoDevices[0].deviceId;
        });
      }
    } catch (err) {
      console.error("Error enumerating video devices:", err);
    }
  }, []);

  useEffect(() => {
    refreshWebcams();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshWebcams);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', refreshWebcams);
      };
    }
  }, [refreshWebcams]);

  const startWebcam = useCallback(async (targetDeviceId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("Webcam is not supported by your browser.");
      return;
    }

    // Stop existing webcam track if any
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }

    const deviceIdToUse = targetDeviceId || selectedWebcamId;
    const constraints = {
      video: deviceIdToUse ? { deviceId: { exact: deviceIdToUse } } : true
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      webcamStreamRef.current = stream;
      setIsWebcamSharing(true);
      if (deviceIdToUse) setSelectedWebcamId(deviceIdToUse);

      // Re-enumerate to get human-readable labels now that camera permission is granted
      refreshWebcams();

      const activeStreams = ['webcam', ...(isScreenSharing ? ['screen'] : [])];
      await updateCaptureStatus(activeStreams);

      stream.getVideoTracks()[0].onended = () => {
        stopWebcam();
      };
    } catch (err) {
      console.error("Error starting webcam:", err);
      alert("Could not start webcam. Please grant camera permission.");
    }
  }, [selectedWebcamId, isScreenSharing, updateCaptureStatus, stopWebcam, refreshWebcams]);

  const handleWebcamChange = (e) => {
    const newDeviceId = e.target.value;
    setSelectedWebcamId(newDeviceId);
    if (isWebcamSharing) {
      startWebcam(newDeviceId);
    }
  };

  const startScreen = useCallback(async () => {
    if ('Notification' in window && window.Notification.permission === 'default') {
      try {
        await window.Notification.requestPermission();
      } catch (err) {
        console.error('Error requesting notification permission:', err);
      }
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
      alert("Screen sharing is not supported by your browser. Please use Chrome, Firefox, or Edge.");
      return;
    }

    try {
      const displayMediaOptions = {
        video: {
          displaySurface: 'monitor',
        },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      const videoTrack = stream.getVideoTracks()[0];
      const trackSettings = videoTrack && typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
      const surface = trackSettings.displaySurface;

      // Enforcement: Reject single application window or browser tab sharing
      if (requireFullScreenOnly && surface && surface !== 'monitor') {
        videoTrack.stop();
        stream.getTracks().forEach(t => t.stop());
        setIsScreenSharing(false);
        displaySurfaceRef.current = null;

        // Log irregularity for instructor audit trail only when class is actively capturing / test started
        if (isCapturing && activeClass && user?.uid) {
          let webcamProofUrl = null;
          if (webcamVideoRef.current && isWebcamSharing) {
            try {
              const canvas = document.createElement('canvas');
              const v = webcamVideoRef.current;
              if (v.videoWidth > 0) {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(v, 0, 0);
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.8));
                if (blob) {
                  const proofRef = ref(storage, `irregularities/${activeClass}/${user.uid}/${Date.now()}_screen_reject_webcam.jpg`);
                  const s = await uploadBytes(proofRef, blob);
                  webcamProofUrl = await getDownloadURL(s.ref);
                }
              }
            } catch (e) {
              console.debug("Could not grab webcam proof for screen violation:", e);
            }
          }

          try {
            await addDoc(collection(db, 'irregularities'), {
              classId: activeClass,
              studentUid: user.uid,
              studentEmail: user.email || '',
              type: 'non_fullscreen_screen_share_attempt',
              message: `Attempted to share a single window or tab ('${surface}') instead of Entire Screen during required full-screen test mode.`,
              timestamp: serverTimestamp(),
              startedAt: serverTimestamp(),
              status: 'flagged',
              webcamUrl: webcamProofUrl || null,
              imageUrl: webcamProofUrl || null,
            });
          } catch (err) {
            console.error("Error logging non-fullscreen irregularity:", err);
          }
        }

        alert(`⚠️ Entire Screen Required\n\nYou selected a ${surface === 'window' ? 'single Application Window' : 'single Browser Tab'} ('${surface}').\n\nFor test and exam compliance, you MUST share your "Entire Screen".\n\nPlease click "Start Screen Share" again and choose the "Entire Screen" tab.`);
        return;
      }

      displaySurfaceRef.current = surface || 'monitor';

      if (screenVideoRef.current) {
        screenVideoRef.current.srcObject = stream;
      }
      screenStreamRef.current = stream;
      setIsScreenSharing(true);
      const activeStreams = ['screen', ...(isWebcamSharing ? ['webcam'] : [])];
      await updateCaptureStatus(activeStreams, activeClass);
      showSystemNotification("Screen recording has started.");

      stream.getVideoTracks()[0].onended = () => {
        stopScreen();
      };
    } catch (error) {
      console.error("Error starting screen sharing:", error);
      setIsScreenSharing(false);
      displaySurfaceRef.current = null;
      alert("Could not start screen sharing. Please grant permission.");
    }
  }, [activeClass, isWebcamSharing, requireFullScreenOnly, showSystemNotification, stopScreen, updateCaptureStatus, user]);

  const isUploadingScreenRef = useRef(false);
  const isUploadingWebcamRef = useRef(false);

  const captureVideoElement = useCallback(async (videoElement, channelName, targetClass) => {
    if (!user || !user.uid || !videoElement || videoElement.readyState < 2 || videoElement.videoWidth === 0) {
      return;
    }

    // Guard: Prevent stacking/queuing uploads if previous upload is still in-flight
    if (channelName === 'screen') {
      if (isUploadingScreenRef.current) {
        console.debug("Screen upload still in flight, skipping frame to avoid lag.");
        return;
      }
      isUploadingScreenRef.current = true;
    } else if (channelName === 'webcam') {
      if (isUploadingWebcamRef.current) {
        console.debug("Webcam upload still in flight, skipping frame to avoid lag.");
        return;
      }
      isUploadingWebcamRef.current = true;
    }

    try {
      const MAX_CAPTURE_WIDTH = 1920;
      let targetWidth = videoElement.videoWidth;
      let targetHeight = videoElement.videoHeight;
      if (targetWidth > MAX_CAPTURE_WIDTH) {
        targetHeight = Math.round((targetHeight * MAX_CAPTURE_WIDTH) / targetWidth);
        targetWidth = MAX_CAPTURE_WIDTH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      let frameDrawn = false;
      // Prefer ImageCapture API on Chromium/Edge to grab frame directly from hardware track even if browser is in background
      if (typeof window !== 'undefined' && 'ImageCapture' in window && videoElement.srcObject) {
        try {
          const tracks = videoElement.srcObject.getVideoTracks();
          if (tracks.length > 0 && tracks[0].readyState === 'live') {
            const imageCapture = new window.ImageCapture(tracks[0]);
            const bitmap = await imageCapture.grabFrame();
            ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
            frameDrawn = true;
          }
        } catch {
          // Fallback to videoElement draw
        }
      }

      if (!frameDrawn) {
        ctx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);
      }

      // Screen solid color verification
      if (channelName === 'screen' && canvas.width > 1 && canvas.height > 1) {
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        const isSolid = () => {
          const r = data[0], g = data[1], b = data[2];
          const points = [
            0,
            (canvas.width - 1) * 4,
            (canvas.height - 1) * canvas.width * 4,
            ((canvas.height - 1) * canvas.width + (canvas.width - 1)) * 4,
            (Math.floor(canvas.height / 2) * canvas.width + Math.floor(canvas.width / 2)) * 4
          ];
          for (const pt of points) {
            if (pt < data.length && (data[pt] !== r || data[pt+1] !== g || data[pt+2] !== b)) {
              return false;
            }
          }
          return true;
        };

        if (isSolid() && !frameDrawn) {
          console.warn("Screen capture appears to be a solid black frame.");
          return;
        }
      }

      const MAX_SIZE_BYTES = maxImageSize;

      const getBlob = (c, q) => new Promise(resolve => c.toBlob(resolve, 'image/jpeg', q));

      let currentCanvas = canvas;
      let quality = imageQuality;
      let blob = await getBlob(currentCanvas, quality);

      if (blob && blob.size > MAX_SIZE_BYTES) {
        if (quality > 0.2) {
          blob = await getBlob(currentCanvas, quality - 0.1);
        }
        if (blob && blob.size > MAX_SIZE_BYTES) {
          const scale = Math.sqrt(MAX_SIZE_BYTES / blob.size) * 0.9;
          const newCanvas = document.createElement('canvas');
          newCanvas.width = currentCanvas.width * scale;
          newCanvas.height = currentCanvas.height * scale;
          const newCtx = newCanvas.getContext('2d');
          newCtx.drawImage(currentCanvas, 0, 0, newCanvas.width, newCanvas.height);
          blob = await getBlob(newCanvas, 0.9);
        }
      }

      if (blob) {
        const timestamp = Date.now();
        const screenshotPath = `screenshots/${targetClass}/${user.uid}/${channelName}_${timestamp}.jpg`;
        const screenshotRef = ref(storage, screenshotPath);
        
        try {
          await uploadBytes(screenshotRef, blob);
          const expireAtDate = new Date(Date.now() + (retentionDays || 30) * 24 * 60 * 60 * 1000);
          await addDoc(collection(db, 'screenshots'), {
            classId: targetClass,
            studentUid: user.uid,
            email: user.email.toLowerCase(),
            channel: channelName,
            imagePath: screenshotRef.fullPath,
            size: blob.size,
            timestamp: serverTimestamp(),
            expireAt: expireAtDate,
            deleted: false,
            ipAddress: ipAddress,
          });

          const statusRef = doc(db, "classes", targetClass, "status", user.uid);
          const statusUpdate = {
            isSharing: true,
            email: user.email.toLowerCase(),
            name: user.displayName || user.email,
            timestamp: serverTimestamp()
          };
          if (channelName === 'screen') {
            statusUpdate.latestScreenPath = screenshotRef.fullPath;
            statusUpdate.latestImagePath = screenshotRef.fullPath; // Backwards compatibility
          } else {
            statusUpdate.latestWebcamPath = screenshotRef.fullPath;
          }
          await setDoc(statusRef, statusUpdate, { merge: true });
        } catch (uploadErr) {
          console.warn(`Network error uploading ${channelName} screenshot, buffering offline:`, uploadErr);
          await saveToOfflineQueue({
            type: 'screenshot',
            classId: targetClass,
            studentUid: user.uid,
            studentEmail: user.email.toLowerCase(),
            blob,
            timestamp,
            metadata: {
              channel: channelName,
              retentionDays: retentionDays || 30,
              ipAddress: ipAddress || null,
            },
          });
          setOfflinePendingCount(c => c + 1);
        }
      }
    } catch (err) {
      console.error(`Error processing ${channelName} snapshot:`, err);
    } finally {
      if (channelName === 'screen') {
        isUploadingScreenRef.current = false;
      } else if (channelName === 'webcam') {
        isUploadingWebcamRef.current = false;
      }
    }
  }, [user, maxImageSize, imageQuality, retentionDays, ipAddress]);

  const captureAndUploadAllChannels = useCallback((targetClass) => {
    if (!targetClass) return;
    if (isScreenSharing && screenVideoRef.current) {
      captureVideoElement(screenVideoRef.current, 'screen', targetClass);
    }
    if (isWebcamSharing && webcamVideoRef.current) {
      captureVideoElement(webcamVideoRef.current, 'webcam', targetClass);
    }
  }, [isScreenSharing, isWebcamSharing, captureVideoElement]);

  // Effects
  useEffect(() => {
    fetch('https://api.ipify.org?format=json')
      .then(response => response.json())
      .then(data => setIpAddress(data.ip))
      .catch(error => console.error('Error fetching IP address:', error));
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/service-worker.js')
        .then((registration) => {
          console.log('Service Worker registered with scope:', registration.scope);
        })
        .catch((error) => {
          console.error('Service Worker registration failed:', error);
        });
    }
  }, []);

  const handleResumeSession = useCallback(() => {
    if (!user || !activeClass) return;
    const newSessionId = uuidv4();
    sessionIdRef.current = newSessionId;
    setIsSessionDisplaced(false);
    const statusRef = doc(db, "classes", activeClass, "status", user.uid);
    const statusData = { sessionId: newSessionId };
    if (ipAddress) {
      statusData.ipAddress = ipAddress;
    }
    setDoc(statusRef, statusData, { merge: true })
      .catch(err => console.error("Firestore: Error updating session ID:", err));
  }, [activeClass, ipAddress, user]);

  useEffect(() => {
    if (user && activeClass) {
      const newSessionId = uuidv4();
      sessionIdRef.current = newSessionId;
      const statusRef = doc(db, "classes", activeClass, "status", user.uid);
      const statusData = { sessionId: newSessionId };
      if (ipAddress) {
        statusData.ipAddress = ipAddress;
      }
      setDoc(statusRef, statusData, { merge: true })
        .catch(err => console.error("Firestore: Error setting session ID:", err));

      const unsubscribe = onSnapshot(statusRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.sessionId && data.sessionId !== sessionIdRef.current) {
            console.warn("Classroom session moved to another tab or device.");
            stopAllStreams();
            setIsSessionDisplaced(true);
          } else if (data.sessionId && data.sessionId === sessionIdRef.current) {
            setIsSessionDisplaced(false);
          }
        }
      }, (error) => {
        console.error(`Firestore: Error subscribing to status for ${user.uid}:`, error);
      });

      return () => unsubscribe();
    }
  }, [user, activeClass, ipAddress, stopAllStreams]);

  useEffect(() => {
    if (!activeClass) return;

    const classRef = doc(db, "classes", activeClass);
    const unsubscribe = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setFrameRate(prev => (data.frameRate !== undefined && data.frameRate !== prev ? data.frameRate : (prev || 15)));
        setImageQuality(prev => (data.imageQuality !== undefined && data.imageQuality !== prev ? data.imageQuality : (prev || 0.5)));
        setMaxImageSize(prev => (data.maxImageSize !== undefined && data.maxImageSize !== prev ? data.maxImageSize : (prev || 0.1 * 1024 * 1024)));
        setCaptureMode(prev => (data.captureMode && data.captureMode !== prev ? data.captureMode : (prev || 'dual')));
        setRequireFullScreenOnly(prev => (data.requireFullScreenOnly !== undefined ? data.requireFullScreenOnly : true));
        setFaceDebounceSeconds(prev => (data.faceDebounceSeconds !== undefined ? data.faceDebounceSeconds : (prev || 3)));
        setAiMonitoringMode(prev => (data.aiMonitoringMode && data.aiMonitoringMode !== prev ? data.aiMonitoringMode : (prev || 'hybrid')));
        setEnableClientAi(prev => (data.enableClientAi !== undefined ? data.enableClientAi : true));
        setPreloadClientAi(prev => (data.preloadClientAi !== undefined ? data.preloadClientAi : false));
        setGazeSensitivity(prev => (data.gazeSensitivity && data.gazeSensitivity !== prev ? data.gazeSensitivity : (prev || 'standard')));
        setCustomYawAngle(prev => (data.customYawAngle !== undefined ? data.customYawAngle : (prev || 25)));
        setCustomPitchDownAngle(prev => (data.customPitchDownAngle !== undefined ? data.customPitchDownAngle : (prev || -22)));
        setCustomPitchUpAngle(prev => (data.customPitchUpAngle !== undefined ? data.customPitchUpAngle : (prev || 26)));
        setEnableCloudFallback(prev => (data.enableCloudFallback !== undefined ? data.enableCloudFallback : false));
        setCloudFallbackRate(prev => (data.cloudFallbackRate !== undefined ? data.cloudFallbackRate : (prev || 3)));
        setIsCapturing(prev => (data.isCapturing !== undefined && data.isCapturing !== prev ? data.isCapturing : (prev || false)));
        setEnableAudioCapture(prev => (data.enableAudioCapture !== undefined && data.enableAudioCapture !== prev ? data.enableAudioCapture : (prev || false)));
        setAudioCaptureMode(prev => (data.audioCaptureMode && data.audioCaptureMode !== prev ? data.audioCaptureMode : (prev || 'mandatory')));
        setAudioSegmentDuration(prev => (data.audioSegmentDuration !== undefined && data.audioSegmentDuration !== prev ? data.audioSegmentDuration : (prev || 30)));
        setAudioSilenceSuppression(prev => (data.audioSilenceSuppression !== undefined && data.audioSilenceSuppression !== prev ? data.audioSilenceSuppression : (prev !== undefined ? prev : true)));
        setEnableSegmentTranscription(prev => (data.enableSegmentTranscription !== undefined && data.enableSegmentTranscription !== prev ? data.enableSegmentTranscription : (prev || false)));
        setAudioMovingWindowDuration(prev => (data.audioMovingWindowDuration !== undefined && data.audioMovingWindowDuration !== prev ? data.audioMovingWindowDuration : (prev || 30)));
        setAudioMovingWindowStride(prev => (data.audioMovingWindowStride !== undefined && data.audioMovingWindowStride !== prev ? data.audioMovingWindowStride : (prev || 15)));
        setCaptureStartedAt(prev => {
          if (!data.captureStartedAt) return null;
          const prevMs = prev?.toMillis ? prev.toMillis() : (prev?.seconds ? prev.seconds * 1000 : null);
          const newMs = data.captureStartedAt.toMillis ? data.captureStartedAt.toMillis() : (data.captureStartedAt.seconds ? data.captureStartedAt.seconds * 1000 : null);
          return prevMs === newMs ? prev : data.captureStartedAt;
        });
        setRetentionDays(prev => (data.retentionDays !== undefined && data.retentionDays !== prev ? data.retentionDays : (prev || 30)));
      }
    }, (error) => {
      console.error(`Firestore: Error subscribing to class document ${activeClass}:`, error);
    });

    return () => unsubscribe();
  }, [activeClass]);

  // Listen for Custom Properties
  useEffect(() => {
    if (!activeClass || !user?.uid) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setClassProperties(null);
         
        setMyProperties(null);
        return;
    }

    const classPropsRef = doc(db, 'classes', activeClass, 'classProperties', 'config');
    console.log(`Firestore: Subscribing to class properties for ${activeClass}`);
    const unsubClassProps = onSnapshot(classPropsRef, (docSnap) => {
        console.log("Firestore: Received class properties snapshot.");
        setClassProperties(docSnap.exists() ? docSnap.data() : null);
    }, (error) => {
        console.error(`Firestore: Error subscribing to class properties for ${activeClass}:`, error);
    });

    const studentPropsRef = doc(db, 'classes', activeClass, 'studentProperties', user.uid);
    console.log(`Firestore: Subscribing to student properties for ${user.uid} in ${activeClass}`);
    const unsubStudentProps = onSnapshot(studentPropsRef, (docSnap) => {
        console.log("Firestore: Received student properties snapshot.");
        setMyProperties(docSnap.exists() ? docSnap.data() : null);
    }, (error) => {
        console.error(`Firestore: Error subscribing to student properties for ${user.uid}:`, error);
    });

    return () => {
        unsubClassProps();
        unsubStudentProps();
    };
  }, [activeClass, user]);

  // Listen for class-wide messages
  useEffect(() => {
    if (!activeClass) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setClassMessages([]);
      return;
    }

    const messagesRef = collection(db, 'classes', activeClass, 'messages');
    const q = query(messagesRef, orderBy('timestamp', 'desc'), limit(5));
    console.log(`Firestore: Subscribing to class messages for ${activeClass}`);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log("Firestore: Received class messages snapshot.");
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'class' }));
      setClassMessages(messagesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to class messages for ${activeClass}:`, error);
    });

    return () => unsubscribe();
  }, [activeClass]);

  // Listen for direct student messages
  useEffect(() => {
    if (!user || !user.uid) return;

    const studentMessagesRef = collection(db, 'students', user.uid, 'messages');
    const q = query(studentMessagesRef, orderBy('timestamp', 'desc'), limit(10));
    console.log(`Firestore: Subscribing to direct messages for ${user.uid}`);
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      console.log("Firestore: Received direct messages snapshot.");
      const messagesData = querySnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id, type: 'direct' }));
      setDirectMessages(messagesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to direct messages for ${user.uid}:`, error);
    });

    return () => unsubscribe();
  }, [user]);

  // Handle notifications & warnings
  useEffect(() => {
    const allAlerts = [
      ...directMessages.map(m => ({ text: m.message, timestamp: m.timestamp, id: m.id })),
      ...classMessages.map(m => ({ text: `📢 ${m.message}`, timestamp: m.timestamp, id: m.id })),
      ...recentIrregularities.map(ir => ({ text: `⚠️ Warning: ${ir.title || 'Irregularity Detected'}${ir.message ? ` — ${ir.message}` : ''}`, timestamp: ir.timestamp, id: ir.id }))
    ];

    allAlerts.sort((a, b) => {
      const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : 0);
      const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : 0);
      return timeB - timeA;
    });

    if (allAlerts.length > 0) {
      const latestAlert = allAlerts[0];
      if (latestAlert.timestamp) {
        const alertTimestamp = latestAlert.timestamp.toDate ? latestAlert.timestamp.toDate() : new Date(latestAlert.timestamp.seconds * 1000);
        const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);

        if (
          lastMessageTimestampRef.current?.getTime() !== alertTimestamp.getTime() &&
          alertTimestamp > oneHourAgo
        ) {
          setNotification(latestAlert.text);
          setTimeout(() => showSystemNotification(latestAlert.text), 0);
          lastMessageTimestampRef.current = alertTimestamp;
        }
      }
    }
  }, [directMessages, classMessages, recentIrregularities, showSystemNotification]);

  useEffect(() => {
    if (!user || !user.uid) return;

    const irregularitiesRef = collection(db, "irregularities");
    const q = query(
      irregularitiesRef,
      where("studentUid", "==", user.uid),
      orderBy("timestamp", "desc"),
      limit(10)
    );
    console.log(`Firestore: Subscribing to irregularities for ${user.uid}`);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      console.log("Firestore: Received irregularities snapshot.");
      const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      setRecentIrregularities(irregularitiesData);
    }, (error) => {
      console.error(`Firestore: Error subscribing to irregularities for ${user.uid}:`, error);
    });

    return () => unsubscribe();
  }, [user]);

  const captureAndUploadAllChannelsRef = useRef(captureAndUploadAllChannels);
  useEffect(() => {
    captureAndUploadAllChannelsRef.current = captureAndUploadAllChannels;
  }, [captureAndUploadAllChannels]);

  const lastCaptureTimeRef = useRef(0);

  // Screen Wake Lock API to prevent system / display sleep during active exam session
  useEffect(() => {
    let wakeLock = null;
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && isSharing) {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch (err) {
          console.warn('Wake Lock request failed:', err);
        }
      }
    };
    if (isSharing) {
      requestWakeLock();
    }
    return () => {
      if (wakeLock) {
        wakeLock.release().catch(() => {});
        wakeLock = null;
      }
    };
  }, [isSharing]);

  // Capture interval driven by an inline Web Worker (immune to Edge / background tab throttling)
  useEffect(() => {
    let worker = null;
    let fallbackInterval = null;

    if (isSharing && isCapturing && activeClass) {
      const now = Date.now();
      const startTime = captureStartedAt ? (captureStartedAt.toMillis ? captureStartedAt.toMillis() : (captureStartedAt.toDate ? captureStartedAt.toDate().getTime() : now)) : now;
      const twoAndAHalfHours = 2.5 * 60 * 60 * 1000;

      if (now - startTime < twoAndAHalfHours) {
        const intervalMs = Math.max(1, (frameRate || 15)) * 1000;

        // Perform capture if enough time has passed since last capture or on first run
        if (now - lastCaptureTimeRef.current >= intervalMs) {
          lastCaptureTimeRef.current = now;
          captureAndUploadAllChannelsRef.current(activeClass);
        }

        const handleTick = () => {
          lastCaptureTimeRef.current = Date.now();
          captureAndUploadAllChannelsRef.current(activeClass);
        };

        // Initialize inline Web Worker for throttling-free execution in background / minimized tabs
        try {
          if (typeof window !== 'undefined' && window.Worker && typeof Blob !== 'undefined') {
            const blob = new Blob([`
              let timerId = null;
              self.onmessage = function(e) {
                if (e.data && e.data.action === 'start') {
                  if (timerId) clearInterval(timerId);
                  timerId = setInterval(function() {
                    self.postMessage('tick');
                  }, e.data.interval);
                } else if (e.data && e.data.action === 'stop') {
                  if (timerId) {
                    clearInterval(timerId);
                    timerId = null;
                  }
                }
              };
            `], { type: 'application/javascript' });
            const blobUrl = URL.createObjectURL(blob);
            worker = new Worker(blobUrl);
            worker.onmessage = (e) => {
              if (e.data === 'tick') {
                handleTick();
              }
            };
            worker.postMessage({ action: 'start', interval: intervalMs });
          } else {
            fallbackInterval = setInterval(handleTick, intervalMs);
          }
        } catch {
          fallbackInterval = setInterval(handleTick, intervalMs);
        }
      } else if (isCapturing && user?.uid) {
        const statusRef = doc(db, "classes", activeClass, "status", user.uid);
        console.log(`Firestore: Capture time expired, updating status for ${user.uid}`);
        setDoc(statusRef, { 
            isCapturing: false,
            reason: "Capture time limit reached."
        }, { merge: true })
          .then(() => {
            console.log("Firestore: Successfully updated student status to isCapturing: false.");
          })
          .catch(err => {
            console.error("Firestore: Failed to update student status after capture time expired.", err);
          });
      }
    }

    return () => {
      if (worker) {
        worker.postMessage({ action: 'stop' });
        worker.terminate();
        worker = null;
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };
  }, [isSharing, isCapturing, frameRate, activeClass, captureStartedAt, user?.uid]);

  return (
    <div className="student-view-container">
      <Banner message={notification} onClose={handleCloseNotification} />

      {/* Notification Permission Prompt Banner */}
      {!dismissNotificationBanner && notificationPermission !== 'granted' && (
        <div className={`notification-permission-banner ${notificationPermission === 'denied' ? 'blocked' : 'prompt'}`}>
          <div className="notification-banner-content">
            <span className="notification-banner-icon">
              {notificationPermission === 'denied' ? '⚠️' : '🔔'}
            </span>
            <div className="notification-banner-text">
              {notificationPermission === 'denied' ? (
                <>
                  <strong>Notifications are blocked:</strong> Click the lock/info icon (🔒) in your browser address bar and change <em>Notifications</em> to <strong>Allow</strong> to receive live warnings and instructions.
                </>
              ) : (
                <>
                  <strong>Enable Notifications:</strong> Allow browser notifications so you never miss real-time alerts or instructions from your instructor.
                </>
              )}
            </div>
          </div>
          <div className="notification-banner-actions">
            {notificationPermission === 'default' && (
              <button onClick={requestNotificationPermission} className="allow-notifications-btn">
                🔔 Allow Notifications
              </button>
            )}
            <button 
              onClick={() => setDismissNotificationBanner(true)} 
              className="dismiss-banner-btn"
              title="Dismiss banner"
              aria-label="Dismiss banner"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {isSessionDisplaced && (
        <div style={{
          background: '#fef2f2',
          border: '1px solid #f87171',
          color: '#991b1b',
          padding: '12px 16px',
          borderRadius: '8px',
          margin: '12px 0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.25rem' }}>⚠️</span>
            <div>
              <strong>Classroom session active in another tab or device.</strong>
              <div style={{ fontSize: '0.85rem', color: '#b91c1c' }}>
                Streaming in this tab is paused to prevent dual-streaming conflicts.
              </div>
            </div>
          </div>
          <button 
            onClick={handleResumeSession}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Resume Here
          </button>
        </div>
      )}

      <div className="student-view-content">
        <div className="student-view-main">
            <div className="student-view-controls">
              <div>
                {activeClass ? (
                    <p>Class: <strong>{activeClass}</strong></p>
                ) : (
                    <p>No active class.</p>
                )}
              </div>

              <div className="stream-controls-group">
                {isScreenSharing ? (
                  <button onClick={stopScreen} className="student-view-button active">
                    ⏹️ Stop Screen
                  </button>
                ) : (
                  <button onClick={startScreen} className="student-view-button">
                    🖥️ Share Screen
                  </button>
                )}

                <div className="webcam-controls-container">
                  {isWebcamSharing ? (
                    <button onClick={stopWebcam} className="student-view-button active">
                      ⏹️ Stop Webcam
                    </button>
                  ) : (
                    <button onClick={() => startWebcam()} className="student-view-button">
                      📷 Start Webcam
                    </button>
                  )}

                  {availableWebcams.length > 1 && (
                    <select
                      value={selectedWebcamId}
                      onChange={handleWebcamChange}
                      className="webcam-select-dropdown"
                      aria-label="Select Webcam"
                      title="Select Webcam"
                    >
                      {availableWebcams.map((cam, index) => (
                        <option key={cam.deviceId || index} value={cam.deviceId}>
                          📷 {cam.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                {(enableAudioCapture || myProperties?.examReadiness?.isReady) && (
                  <div className="mic-controls-container" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => setIsAudioUserEnabled(prev => !prev)}
                      className={`student-view-button ${isAudioRecording ? 'active' : (!isAudioUserEnabled ? 'btn-muted' : '')}`}
                      title={
                        !isAudioUserEnabled
                          ? "Microphone Muted - Click to Unmute"
                          : isAudioRecording
                            ? `Audio Recording Active (Level: ${Math.round(audioLevel * 100)}%)`
                            : "Microphone Active (Waiting for stream)"
                      }
                    >
                      {!isAudioUserEnabled
                        ? '🔇 Mic Muted'
                        : isAudioRecording
                          ? (isSpeaking ? '🔊 Speaking' : '🎙️ Mic Active')
                          : '🎙️ Mic Active'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsMicSetupOpen(true)}
                      className="student-view-button"
                      style={{ padding: '6px 10px', fontSize: '0.85rem' }}
                      title="Microphone Setup & Speech Verification"
                    >
                      ⚙️ Mic Test
                    </button>
                  </div>
                )}

                {/* AI Model Preload & Calibration Controls (if AI monitoring is enabled) */}
                {aiMonitoringMode !== 'disabled' && aiMonitoringMode !== 'cloud_only' && (
                  <div className="ai-preload-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {clientAiStatus === 'ready' || isModelCached ? (
                      <>
                        <span className="student-view-pill ai-ready" title={`On-device AI model cached in browser storage (${delegateUsed || 'GPU'} active)`}>
                          ⚡ AI Ready
                        </span>
                        {isWebcamSharing && (
                          <button
                            type="button"
                            onClick={isCalibrated ? resetCalibration : calibrateBaseline}
                            className="student-view-button"
                            style={{
                              padding: '5px 9px',
                              fontSize: '0.8rem',
                              backgroundColor: isCalibrated ? '#059669' : '#334155',
                              color: '#ffffff',
                              border: 'none',
                            }}
                            title={isCalibrated ? "Calibrated to current neutral head angle. Click to reset." : "Click while looking comfortably at center screen to calibrate neutral head angle."}
                          >
                            {isCalibrated ? '🎯 Calibrated' : '🎯 Calibrate View'}
                          </button>
                        )}
                      </>
                    ) : isPreloading || clientAiStatus === 'initializing' ? (
                      <div className="ai-preload-progress-box" title="Downloading lightweight on-device AI model (~3.8 MB)">
                        <span className="ai-progress-label">⏳ Loading AI ({loadingProgress}%)</span>
                        <div className="ai-progress-track">
                          <div className="ai-progress-bar" style={{ width: `${Math.max(5, loadingProgress)}%` }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={preloadModel}
                        className="student-view-button ai-preload-btn"
                        title="Download & cache lightweight on-device AI model (~3.8 MB) in advance"
                      >
                        📥 Preload AI (~3.8 MB)
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsReadinessWizardOpen(true)}
                  className="student-view-button"
                  style={{ backgroundColor: '#4338ca', color: '#fff', fontWeight: '600' }}
                  title="3-Step Pre-Exam Self-Calibration Wizard"
                >
                  🎓 Exam Readiness Check
                </button>
              </div>
            </div>

            {isCapturing && isSharing && (
              <p className="recording-indicator">
                🔴 Live invigilation active: Capturing every {frameRate}s (Quality optimized).
              </p>
            )}
            
            <div className="preview-stage">
              {/* Screen Stream Element */}
              <div
                className={`stream-feed-wrapper ${
                  !isScreenSharing
                    ? 'hidden-stream'
                    : isWebcamSharing && primaryStream === 'webcam'
                    ? 'pip-stream'
                    : 'hero-stream'
                }`}
                onClick={
                  isScreenSharing && isWebcamSharing && primaryStream === 'webcam'
                    ? handleSwapFeeds
                    : undefined
                }
                title={
                  isScreenSharing && isWebcamSharing && primaryStream === 'webcam'
                    ? 'Click to make Screen main feed'
                    : undefined
                }
              >
                <span className="video-preview-tag">🖥️ Screen</span>
                {isScreenSharing && isWebcamSharing && primaryStream === 'webcam' && (
                  <div className="pip-swap-overlay">
                    <span>🔄 Click to Swap</span>
                  </div>
                )}
                <video ref={screenVideoRef} autoPlay muted playsInline className="video-preview" />
              </div>

              {/* Webcam Stream Element */}
              <div
                className={`stream-feed-wrapper ${
                  !isWebcamSharing
                    ? 'hidden-stream'
                    : isScreenSharing && primaryStream === 'screen'
                    ? 'pip-stream'
                    : 'hero-stream'
                }`}
                onClick={
                  isScreenSharing && isWebcamSharing && primaryStream === 'screen'
                    ? handleSwapFeeds
                    : undefined
                }
                title={
                  isScreenSharing && isWebcamSharing && primaryStream === 'screen'
                    ? 'Click to make Webcam main feed'
                    : undefined
                }
              >
                <span className="video-preview-tag">📷 Webcam</span>
                {isScreenSharing && isWebcamSharing && primaryStream === 'screen' && (
                  <div className="pip-swap-overlay">
                    <span>🔄 Click to Swap</span>
                  </div>
                )}
                <video ref={webcamVideoRef} autoPlay muted playsInline className="video-preview" />
                <canvas ref={overlayCanvasRef} className="webcam-mesh-overlay" />
                {isWebcamSharing && (
                  <div className={`ai-face-hud ${clientAiStatus === 'initializing' ? 'initializing' : faceStatus}`}>
                    {clientAiStatus === 'initializing' && <span>⏳ Initializing AI ({loadingProgress}%)...</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'normal' && <span>🟢 Face Centered {metricDistance ? `(~${metricDistance}cm)` : ''}</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'no_face' && <span>🔴 No Face Detected</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'looking_away' && <span>🟡 Please Face Screen (Looking Away)</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'multiple_faces' && <span>🔴 Multiple People in Frame</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'cloud_fallback' && <span>☁️ AI Cloud Fallback Active {fallbackReason ? `(${fallbackReason})` : ''}</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'unsupported' && <span>⚠️ Local AI Unsupported (Cloud Fallback Disabled)</span>}
                    {clientAiStatus !== 'initializing' && faceStatus === 'quota_exceeded' && <span>⚠️ Class AI Quota Exceeded</span>}
                  </div>
                )}
              </div>

              {/* Stage Top Right Action Controls */}
              {isSharing && (
                <div className="stage-actions-overlay">
                  {isScreenSharing && isWebcamSharing && (
                    <button
                      onClick={handleSwapFeeds}
                      className="stage-action-btn"
                      title="Swap Main and PiP Feeds"
                    >
                      🔄 Swap Focus
                    </button>
                  )}
                  {isWebcamSharing && (
                    <button
                      onClick={() => setShowMeshOverlay(prev => !prev)}
                      className={`ai-mesh-toggle-btn ${showMeshOverlay ? 'active' : ''}`}
                      title="Toggle AI Face Detection Mesh & Gaze Points Overlay"
                    >
                      🕸️ AI Mesh: {showMeshOverlay ? 'ON' : 'OFF'}
                    </button>
                  )}
                </div>
              )}

              {/* Inactive Placeholder */}
              {!isSharing && (
                <div className="inactive-streams-placeholder">
                  <div className="placeholder-icon">📡</div>
                  <p className="placeholder-title">Streams Inactive</p>
                  <p className="placeholder-subtitle">
                    Click "Share Screen" or "Start Webcam" above to begin streaming to your instructor.
                  </p>
                </div>
              )}
            </div>
        </div>
        <Sidebar 
          classProperties={classProperties} 
          myProperties={myProperties} 
          recentIrregularities={recentIrregularities} 
          ipAddress={ipAddress} 
          recentMessages={recentMessages} 
        />
      </div>

      <MicSetupModal
        isOpen={isMicSetupOpen}
        onClose={() => setIsMicSetupOpen(false)}
        onConfirm={(payload) => {
          const micId = typeof payload === 'object' && payload !== null ? payload.deviceId : payload;
          setSelectedMicDeviceId(micId || '');
          setIsAudioUserEnabled(true);
          setIsMicSetupOpen(false);
        }}
        isMandatory={enableAudioCapture && audioCaptureMode === 'mandatory'}
      />

      <ExamReadinessWizard
        isOpen={isReadinessWizardOpen}
        onClose={() => setIsReadinessWizardOpen(false)}
        onComplete={async (readinessResult) => {
          setIsReadinessWizardOpen(false);

          // 1. Enable audio capture & unmute mic
          setEnableAudioCapture(true);
          setIsAudioUserEnabled(true);
          const micId = readinessResult?.micDeviceId || selectedMicDeviceId;
          if (micId) {
            setSelectedMicDeviceId(micId);
          }

          // 2. Start webcam stream with verified camera
          const camId = readinessResult?.cameraDeviceId || selectedWebcamId;
          if (camId) {
            setSelectedWebcamId(camId);
          }
          await startWebcam(camId);

          // 3. Start full screen sharing
          await startScreen();
        }}
        user={user}
        classId={activeClass}
        currentMicDeviceId={selectedMicDeviceId}
        onSelectMicDevice={(id) => {
          setSelectedMicDeviceId(id);
          setIsAudioUserEnabled(true);
        }}
        currentCameraDeviceId={selectedWebcamId}
        onSelectCameraDevice={(id) => {
          setSelectedWebcamId(id);
        }}
      />
    </div>
  );
};

export default StudentView;