import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { storage, db, auth, functions } from '../firebase-config';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { collection, onSnapshot, doc, query, where, orderBy, limit, addDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import Banner from './Banner';
import { v4 as uuidv4 } from 'uuid';
import './StudentView.css';

import { useStudentClassSchedule } from '../hooks/useStudentClassSchedule';
import useFaceMonitor from '../hooks/useFaceMonitor';
import useAudioRecorder from '../hooks/useAudioRecorder';
import { useClientLiteRTWhisper } from '../hooks/useClientLiteRTWhisper';
import { useClientLiteRTGemma } from '../hooks/useClientLiteRTGemma';
import useWebRTCPeekStudent from '../hooks/useWebRTCPeekStudent';
import MicSetupModal from './MicSetupModal';
import ExamReadinessWizard from './ExamReadinessWizard';
import { saveToOfflineQueue, flushOfflineQueue, getOfflineQueueCount } from '../utils/offlineBufferManager';
import { decodeAudioBlobToPcm } from '../utils/audioDecoder';
import { isGoogleChrome } from '../utils/browserDetection';
import UnsupportedBrowserNotice from './UnsupportedBrowserNotice';

import Sidebar from './student/Sidebar';

const StudentView = ({ user }) => {
  // Browser validation guard for students
  const isChrome = isGoogleChrome();
  if (!isChrome) {
    return (
      <UnsupportedBrowserNotice
        onBackToLogin={() => signOut(auth)}
      />
    );
  }

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
  const [voiceAiMode, setVoiceAiMode] = useState('hybrid');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [enableSegmentTranscription, setEnableSegmentTranscription] = useState(false);
  const [audioMovingWindowDuration, setAudioMovingWindowDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  const [isMicSetupOpen, setIsMicSetupOpen] = useState(false);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() => {
    try {
      return localStorage.getItem('preferred_mic_device_id') || '';
    } catch {
      return '';
    }
  });
  const [isAudioUserEnabled, setIsAudioUserEnabled] = useState(true);
  const [classSpeechLanguage, setClassSpeechLanguage] = useState('zh-HK');

  // Log state updates to selectedMicDeviceId
  useEffect(() => {
    console.log('%c[StudentView:MicState] 🎙️ selectedMicDeviceId:', 'background:#4338ca;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
      selectedMicDeviceId: selectedMicDeviceId || '(default)',
      isAudioUserEnabled,
      voiceAiMode,
      enableAudioCapture,
    });
  }, [selectedMicDeviceId, isAudioUserEnabled, voiceAiMode, enableAudioCapture]);

  // Refs
  const intervalRef = useRef(null);
  const screenVideoRef = useRef(null);
  const webcamVideoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const screenStreamRef = useRef(null);
  const webcamStreamRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);

  // Client-Side Gemma LLM STT Monitor (LiteRT.js in Web Worker)
  const {
    status: gemmaStatus,
    loadingProgress: gemmaLoadingProgress,
    isModelCached: isGemmaCached,
    delegateUsed: gemmaDelegate,
    latestEvaluation: gemmaEvaluation,
    preloadGemmaModel,
    evaluateTranscript: evaluateSpeechWithGemma,
  } = useClientLiteRTGemma({
    classId: activeClass,
    studentUid: user?.uid,
    studentEmail: user?.email,
    enabled: voiceAiMode !== 'disabled',
  });

  const handleAudioUploadedRef = useRef(null);

  // 1. Segmented Audio Recording Hook with Moving Window & Selected Mic Device
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
    enabled: (isSharing || isWebcamSharing || isScreenSharing || Boolean(myProperties?.examReadiness?.isReady)) && enableAudioCapture && isAudioUserEnabled && !isSessionDisplaced,
    aiMonitoringMode,
    segmentDuration: audioSegmentDuration,
    windowDuration: audioMovingWindowDuration,
    strideDuration: audioMovingWindowStride,
    enableMovingWindow: enableSegmentTranscription || true,
    silenceSuppression: audioSilenceSuppression,
    retentionDays: retentionDays,
    deviceId: selectedMicDeviceId,
    onAudioUploaded: (data) => handleAudioUploadedRef.current?.(data),
  });

  // 2. Client-Side Whisper STT Engine (LiteRT.js in Web Worker) connected to selected audioStream
  const {
    status: whisperStatus,
    loadingProgress: whisperLoadingProgress,
    isModelCached: isWhisperCached,
    delegateUsed: whisperDelegate,
    latestTranscript: whisperTranscript,
    latestLanguage: whisperLanguage,
    preloadModel: preloadWhisperModel,
    transcribeAudioChunk,
    setLatestTranscript: setWhisperTranscript,
  } = useClientLiteRTWhisper({
    classId: activeClass,
    studentUid: user?.uid,
    enabled: voiceAiMode !== 'disabled',
    speechLanguage: classSpeechLanguage,
    audioStream,
    deviceId: selectedMicDeviceId,
    onTranscript: evaluateSpeechWithGemma,
  });

  // Preload Audio AI models on teacher broadcast
  useEffect(() => {
    if (preloadClientAi && voiceAiMode !== 'disabled') {
      if (!isWhisperCached && preloadWhisperModel) {
        preloadWhisperModel().catch(err => console.debug('[StudentView] Whisper preload error:', err));
      }
      if (!isGemmaCached && preloadGemmaModel) {
        preloadGemmaModel().catch(err => console.debug('[StudentView] Gemma preload error:', err));
      }
    }
  }, [preloadClientAi, voiceAiMode, isWhisperCached, isGemmaCached, preloadWhisperModel, preloadGemmaModel]);

  // Stable callback for uploaded audio segments
  const handleAudioUploaded = useCallback(async ({ path, url, blob }) => {
    console.log('%c[StudentView:AudioUploaded] 🎙️ Audio segment upload callback received:', 'background:#4338ca;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
      path,
      blobSize: blob?.size,
      voiceAiMode,
      selectedMicDeviceId: selectedMicDeviceId || '(default)',
    });
    let transcriptText = '';

    // 1. Decode audio blob into 16kHz Float32Array PCM for on-device LiteRT Whisper
    let pcmData = null;
    if (blob) {
      try {
        pcmData = await decodeAudioBlobToPcm(blob, 16000);
        console.log('%c[StudentView:PCMDecoded] 🔊 Blob decoded to 16kHz PCM:', 'background:#0891b2;color:white;padding:2px 6px;border-radius:4px;', {
          samples: pcmData?.length,
          durationSec: pcmData ? (pcmData.length / 16000).toFixed(1) : 0,
        });
      } catch (decodeErr) {
        console.debug('[StudentView] PCM decode note:', decodeErr);
      }
    }

    // 2. On-device LiteRT Whisper transcription
    if (transcribeAudioChunk) {
      try {
        console.log('%c[StudentView:LiteRTDispatch] 🚀 Dispatching segment to LiteRT Whisper:', 'background:#2563eb;color:white;padding:2px 6px;border-radius:4px;', {
          path,
          pcmSamples: pcmData?.length,
          deviceId: selectedMicDeviceId || '(default)',
        });
        const result = await transcribeAudioChunk(pcmData, {
          audioPath: path,
          duration: audioSegmentDuration || 30,
        });
        console.log('%c[StudentView:LiteRTResult] 🎙️ LiteRT transcribe result:', 'background:#059669;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', result);
        if (result?.transcript && result.transcript.trim()) {
          transcriptText = result.transcript.trim();
        }
      } catch (err) {
        console.debug('[StudentView] Client LiteRT STT error:', err);
      }
    }

    // 3. Cloud AI fallback (invoked in hybrid mode when local STT produces no words, or in cloud_only mode)
    const isCloudAllowed = voiceAiMode === 'cloud_only' || voiceAiMode === 'hybrid' || enableCloudFallback;
    if (!transcriptText && url && isCloudAllowed) {
      try {
        console.log('[StudentView] ⚡ Invoking Cloud Gemini Audio Analysis flow for segment:', path);
        const analyzeAudioCallable = httpsCallable(functions, 'analyzeAudio');
        const res = await analyzeAudioCallable({
          audioUrl: url,
          classId: activeClass,
          studentUid: user?.uid,
          studentEmail: user?.email,
        });
        if (res?.data?.transcript) {
          transcriptText = res.data.transcript;
          console.log(
            `%c[Cloud Gemini Audio] 🎙️ Speech Transcribed: %c"${transcriptText}"`,
            'background: #1e1b4b; color: #818cf8; font-weight: bold; font-size: 13px; padding: 2px 6px; border-radius: 4px;',
            'color: #ffffff; font-weight: bold; font-size: 13px;'
          );
        }
      } catch (err) {
        console.warn('[StudentView] Cloud audio analysis call failed:', err);
      }
    }

    // 4. If transcript acquired, sync UI state, Firestore status, and evaluate with Gemma LLM
    if (transcriptText) {
      if (setWhisperTranscript) setWhisperTranscript(transcriptText);
      try {
        const statusDocRef = doc(db, 'classes', activeClass, 'status', user?.uid);
        await setDoc(
          statusDocRef,
          {
            liveTranscript: transcriptText,
            liveTranscriptTimestamp: Date.now(),
            speechLanguage: classSpeechLanguage,
            isAudioSharing: true,
            audioStatus: 'speaking',
            selectedMicDeviceId: selectedMicDeviceId || '',
          },
          { merge: true }
        );
      } catch (err) {
        console.warn('[StudentView] Failed to update live transcript status:', err);
      }

      if (evaluateSpeechWithGemma) {
        await evaluateSpeechWithGemma(transcriptText);
      }
    }
  }, [transcribeAudioChunk, audioSegmentDuration, evaluateSpeechWithGemma, setWhisperTranscript, voiceAiMode, enableCloudFallback, activeClass, user]);

  handleAudioUploadedRef.current = handleAudioUploaded;

  // Automatically evaluate live speech transcript with Gemma LLM intent engine
  useEffect(() => {
    if (whisperTranscript && whisperTranscript.trim() && evaluateSpeechWithGemma) {
      evaluateSpeechWithGemma(whisperTranscript).catch(e => console.debug('[StudentView] Gemma eval error:', e));
    }
  }, [whisperTranscript, evaluateSpeechWithGemma]);

  // Automatically activate verified devices if readiness already completed
  useEffect(() => {
    if (myProperties?.examReadiness?.isReady) {
      setIsAudioUserEnabled(true);
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

  const lastTelemetrySyncRef = useRef(0);
  const telemetryTimerRef = useRef(null);

  // Sync real-time face, gaze, and audio telemetry to student status doc (Throttled to max once per 1.5s)
  useEffect(() => {
    if (!activeClass || !user || !user.uid) return;

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
    if (enableAudioCapture || isAudioUserEnabled || myProperties?.examReadiness?.isReady || isAudioRecording) {
      updateData.isAudioSharing = Boolean(isAudioRecording);
      updateData.audioLevel = Math.round(audioLevel * 100);
      updateData.audioStatus = isSpeaking ? 'speaking' : (isAudioRecording ? 'idle' : 'muted');
    }

    if (Object.keys(updateData).length === 0) return;

    const now = Date.now();
    const timeSinceLast = now - lastTelemetrySyncRef.current;
    const THROTTLE_MS = 1500;

    const performSync = () => {
      lastTelemetrySyncRef.current = Date.now();
      setDoc(statusRef, updateData, { merge: true }).catch(err => console.debug("Error updating telemetry status:", err));
    };

    if (timeSinceLast >= THROTTLE_MS) {
      if (telemetryTimerRef.current) clearTimeout(telemetryTimerRef.current);
      performSync();
    } else {
      if (telemetryTimerRef.current) clearTimeout(telemetryTimerRef.current);
      telemetryTimerRef.current = setTimeout(performSync, THROTTLE_MS - timeSinceLast);
    }

    return () => {
      if (telemetryTimerRef.current) clearTimeout(telemetryTimerRef.current);
    };
  }, [activeClass, user, isWebcamSharing, faceStatus, clientAiStatus, loadingProgress, isModelCached, fallbackReason, delegateUsed, yawAngle, pitchAngle, earValue, marValue, isCalibrated, metricDistance, activeViolation, enableAudioCapture, isAudioUserEnabled, myProperties, isAudioRecording, audioLevel, isSpeaking]);

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

  /**
   * Enumerate all videoinput (webcam) devices on the client machine.
   * Dynamically tracks device labels and ensures selectedWebcamId remains valid
   * when webcams are connected or disconnected.
   */
  const refreshWebcams = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices
        .filter(device => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          label: device.label || (index === 0 ? 'Default Camera' : `Camera ${index + 1}`)
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

  /**
   * Initializes and starts the webcam video stream.
   * 
   * Robust Fallback Hierarchy for Multi-Camera & Hardware Changes:
   * 1. Exact deviceId constraint: Attempts to bind directly to targetDeviceId / selectedWebcamId.
   * 2. Ideal deviceId constraint: If 'exact' throws OverconstrainedError (e.g. device ID rotated by OS),
   *    falls back to 'ideal' which allows Chrome to negotiate the best match.
   * 3. Generic video constraint: If 'ideal' fails, falls back to `{ video: true }` so the student's
   *    camera stream reliably opens on whatever working camera is available.
   * 
   * Lifecycle Management:
   * - Safely stops any existing media stream tracks before acquiring a new stream.
   * - Attaches active video track to on-device Face & Gaze detection (useFaceMonitor) and WebRTC live peek.
   */
  const startWebcam = useCallback(async (targetDeviceId) => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      console.warn("Webcam is not supported by your browser.");
      return;
    }

    // Stop existing webcam track if any
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach(track => track.stop());
      webcamStreamRef.current = null;
    }

    const deviceIdToUse = targetDeviceId || selectedWebcamId;
    let stream = null;

    if (deviceIdToUse) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { deviceId: { exact: deviceIdToUse } }
        });
      } catch (exactErr) {
        console.warn("[StudentView] Webcam exact deviceId failed, falling back to ideal:", exactErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { ideal: deviceIdToUse } }
          });
        } catch (idealErr) {
          console.warn("[StudentView] Webcam ideal deviceId failed, falling back to any available video device:", idealErr);
          try {
            stream = await navigator.mediaDevices.getUserMedia({ video: true });
          } catch (anyErr) {
            console.warn("Webcam unavailable or permission not granted:", anyErr);
            setIsWebcamSharing(false);
            return;
          }
        }
      }
    } else {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (err) {
        console.warn("Webcam unavailable or permission not granted:", err);
        setIsWebcamSharing(false);
        return;
      }
    }

    try {
      if (webcamVideoRef.current) {
        webcamVideoRef.current.srcObject = stream;
      }
      webcamStreamRef.current = stream;
      setIsWebcamSharing(true);

      const activeTrack = stream.getVideoTracks()[0];
      const actualDeviceId = activeTrack?.getSettings?.().deviceId || deviceIdToUse;
      if (actualDeviceId) setSelectedWebcamId(actualDeviceId);

      // Re-enumerate to get human-readable labels now that camera permission is granted
      refreshWebcams();

      const activeStreams = ['webcam', ...(isScreenSharing ? ['screen'] : [])];
      await updateCaptureStatus(activeStreams);

      if (activeTrack) {
        activeTrack.onended = () => {
          stopWebcam();
        };
      }
    } catch (err) {
      console.warn("Webcam setup error:", err);
      setIsWebcamSharing(false);
    }
  }, [selectedWebcamId, availableWebcams, isScreenSharing, updateCaptureStatus, stopWebcam, refreshWebcams]);

  const handleWebcamChange = (e) => {
    const newDeviceId = e.target.value;
    setSelectedWebcamId(newDeviceId);
    if (isWebcamSharing) {
      startWebcam(newDeviceId);
    }
  };

  // Ensure webcam video element srcObject is always attached
  useEffect(() => {
    if (isWebcamSharing && webcamStreamRef.current && webcamVideoRef.current) {
      if (webcamVideoRef.current.srcObject !== webcamStreamRef.current) {
        webcamVideoRef.current.srcObject = webcamStreamRef.current;
      }
    }
  }, [isWebcamSharing, primaryStream]);

  const startScreen = useCallback(async (existingStream = null) => {
    if ('Notification' in window && window.Notification.permission === 'default') {
      try {
        await window.Notification.requestPermission();
      } catch (err) {
        console.error('Error requesting notification permission:', err);
      }
    }

    try {
      let stream = (existingStream && typeof existingStream.getVideoTracks === 'function') ? existingStream : null;
      if (!stream) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          alert("Screen sharing is not supported by your browser. Please use Chrome, Firefox, or Edge.");
          return;
        }

        const displayMediaOptions = {
          video: {
            displaySurface: 'monitor',
          },
          audio: false,
        };

        stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      }

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

  // Ensure screen video element srcObject is always attached
  useEffect(() => {
    if (screenVideoRef.current && screenStreamRef.current && isScreenSharing) {
      if (screenVideoRef.current.srcObject !== screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        screenVideoRef.current.play().catch(e => console.debug('[StudentView] screen video play note:', e));
      }
    }
  }, [isScreenSharing]);

  const isUploadingScreenRef = useRef(false);
  const isUploadingWebcamRef = useRef(false);

  const captureVideoElement = useCallback(async (videoElement, channelName, targetClass) => {
    if (!user || !user.uid) {
      return;
    }

    const activeStream = (videoElement && videoElement.srcObject)
      || (channelName === 'screen' ? screenStreamRef.current : webcamStreamRef.current);

    if (!activeStream && !videoElement) {
      return;
    }

    const streamTracks = (activeStream && typeof activeStream.getVideoTracks === 'function')
      ? activeStream.getVideoTracks()
      : (videoElement?.srcObject && typeof videoElement.srcObject.getVideoTracks === 'function')
        ? videoElement.srcObject.getVideoTracks()
        : [];
    const hasLiveTrack = streamTracks.some(t => t.readyState === 'live');

    if (!hasLiveTrack && (!videoElement || videoElement.readyState < 2)) {
      return;
    }

    // Guard: Prevent stacking/queuing uploads if previous upload is still in-flight
    if (channelName === 'screen') {
      if (isUploadingScreenRef.current) {
        console.debug("[StudentView] Screen upload still in flight, skipping frame.");
        return;
      }
      isUploadingScreenRef.current = true;
    } else if (channelName === 'webcam') {
      if (isUploadingWebcamRef.current) {
        console.debug("[StudentView] Webcam upload still in flight, skipping frame.");
        return;
      }
      isUploadingWebcamRef.current = true;
    }

    try {
      const trackSettings = streamTracks[0]?.getSettings?.() || {};
      const MAX_CAPTURE_WIDTH = 1920;
      let targetWidth = (videoElement && videoElement.videoWidth) || trackSettings.width || 1920;
      let targetHeight = (videoElement && videoElement.videoHeight) || trackSettings.height || 1080;
      if (targetWidth > MAX_CAPTURE_WIDTH) {
        targetHeight = Math.round((targetHeight * MAX_CAPTURE_WIDTH) / targetWidth);
        targetWidth = MAX_CAPTURE_WIDTH;
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');

      let frameDrawn = false;
      // 1. Prefer ImageCapture API on Chromium/Edge directly from hardware track
      if (typeof window !== 'undefined' && 'ImageCapture' in window && streamTracks.length > 0 && streamTracks[0].readyState === 'live') {
        try {
          const imageCapture = new window.ImageCapture(streamTracks[0]);
          const bitmap = await imageCapture.grabFrame();
          ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
          frameDrawn = true;
        } catch {
          // Fallback to videoElement draw
        }
      }

      // 2. Fallback to videoElement drawImage
      if (!frameDrawn && videoElement) {
        try {
          if (videoElement.srcObject !== activeStream && activeStream) {
            videoElement.srcObject = activeStream;
          }
          ctx.drawImage(videoElement, 0, 0, targetWidth, targetHeight);
          frameDrawn = true;
        } catch (e) {
          console.debug('[StudentView] videoElement draw fallback note:', e);
        }
      }

      if (!frameDrawn) {
        console.warn(`[StudentView] Could not draw frame for ${channelName}. Skipping.`);
        return;
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
        setEnableAudioCapture(data.enableAudioCapture !== undefined ? Boolean(data.enableAudioCapture) : false);
        setAudioCaptureMode(prev => (data.audioCaptureMode && data.audioCaptureMode !== prev ? data.audioCaptureMode : (prev || 'mandatory')));
        setVoiceAiMode(prev => (data.voiceAiMode && data.voiceAiMode !== prev ? data.voiceAiMode : (prev || 'hybrid')));
        setClassSpeechLanguage(prev => (data.speechLanguage && data.speechLanguage !== prev ? data.speechLanguage : (prev || 'zh-HK')));
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
                  <button onClick={() => startScreen()} className="student-view-button">
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
                    {isAudioRecording && isAudioUserEnabled && (
                      <div
                        className="student-mic-vu-bar"
                        title={`Live Mic Volume: ${Math.round(audioLevel * 100)}%`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          background: 'rgba(15, 23, 42, 0.6)',
                          padding: '0 8px',
                          height: '40px',
                          boxSizing: 'border-box',
                          borderRadius: '6px',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        <div
                          style={{
                            width: '36px',
                            height: '6px',
                            background: '#334155',
                            borderRadius: '3px',
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              width: `${Math.min(100, Math.round(audioLevel * 100))}%`,
                              height: '100%',
                              backgroundColor: isSpeaking ? '#22c55e' : (audioLevel > 0.03 ? '#38bdf8' : '#94a3b8'),
                              transition: 'width 0.08s ease-out',
                            }}
                          />
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', minWidth: '24px', textAlign: 'right' }}>
                          {Math.round(audioLevel * 100)}%
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setIsMicSetupOpen(true)}
                      className="student-view-button btn-secondary-stream"
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
                            className={`student-view-button ${isCalibrated ? 'btn-calibrated' : 'btn-secondary-stream'}`}
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
                        className="student-view-button btn-secondary-stream ai-preload-btn"
                        title="Download & cache lightweight on-device AI model (~3.8 MB) in advance"
                      >
                        📥 Preload AI (~3.8 MB)
                      </button>
                    )}
                  </div>
                )}

                {/* LiteRT Whisper Speech AI Preload (if audio capture is enabled) */}
                {enableAudioCapture && (
                  <div className="ai-preload-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {whisperStatus === 'ready' || isWhisperCached ? (
                      <span className="student-view-pill ai-ready" title={`LiteRT Whisper speech model cached in browser storage (${whisperDelegate || 'WASM'} active)`}>
                        🎙️ Speech AI Ready
                      </span>
                    ) : whisperStatus === 'loading' ? (
                      <div className="ai-preload-progress-box" title="Downloading LiteRT Whisper on-device speech model (~39 MB)">
                        <span className="ai-progress-label">⏳ Loading Speech AI ({whisperLoadingProgress}%)</span>
                        <div className="ai-progress-track">
                          <div className="ai-progress-bar" style={{ width: `${Math.max(5, whisperLoadingProgress)}%` }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={preloadWhisperModel}
                        className="student-view-button btn-secondary-stream ai-preload-btn"
                        title="Download & cache on-device LiteRT Whisper speech model (~39 MB) in advance"
                      >
                        📥 Preload Speech AI (~39 MB)
                      </button>
                    )}
                  </div>
                )}

                {/* LiteRT Gemma LLM Intent Guard Preload */}
                {enableAudioCapture && (
                  <div className="ai-preload-wrapper" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {gemmaStatus === 'ready' || isGemmaCached ? (
                      <span className="student-view-pill ai-ready" title={`LiteRT Gemma LLM intent model cached in browser storage (${gemmaDelegate || 'WASM'} active)`}>
                        🤖 Gemma LLM Ready
                      </span>
                    ) : gemmaStatus === 'loading' ? (
                      <div className="ai-preload-progress-box" title="Downloading LiteRT Gemma on-device LLM model (~120 MB)">
                        <span className="ai-progress-label">⏳ Loading Gemma ({gemmaLoadingProgress}%)</span>
                        <div className="ai-progress-track">
                          <div className="ai-progress-bar" style={{ width: `${Math.max(5, gemmaLoadingProgress)}%` }} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={preloadGemmaModel}
                        className="student-view-button btn-secondary-stream ai-preload-btn"
                        title="Download & cache on-device LiteRT Gemma LLM model (~120 MB) in advance"
                      >
                        📥 Preload Gemma AI (~120 MB)
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => setIsReadinessWizardOpen(true)}
                  className="student-view-button btn-wizard"
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

            {/* Live Speech AI & Gemma HUD (Placed Underneath Capture & Webcam Stage) */}
            {enableAudioCapture && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: 'var(--color-surface, #ffffff)',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: '10px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                fontSize: '0.875rem',
                color: 'var(--color-text-main, #0f172a)',
                boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05))',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border, #e2e8f0)', paddingBottom: '6px' }}>
                  <span style={{ fontWeight: 700, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    🎙️ Live Speech AI Monitor
                    {isSpeaking && <span style={{ fontSize: '0.7rem', padding: '2px 8px', background: '#10b981', color: '#fff', borderRadius: '9999px', fontWeight: 'bold' }}>SPEAKING</span>}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 500 }}>⚡ LiteRT Whisper + Gemma</span>
                </div>
                {whisperTranscript ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div>
                      <strong style={{ color: '#0f766e' }}>STT Transcript:</strong> <span style={{ fontStyle: 'italic', color: '#0f172a', fontWeight: 500 }}>"{whisperTranscript}"</span>
                    </div>
                    {gemmaEvaluation && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem', marginTop: '2px' }}>
                        <strong style={{ color: '#4338ca' }}>Gemma Intent:</strong>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '6px',
                          fontWeight: 'bold',
                          backgroundColor: gemmaEvaluation.isViolation ? '#fee2e2' : '#dcfce7',
                          color: gemmaEvaluation.isViolation ? '#991b1b' : '#15803d',
                          border: `1px solid ${gemmaEvaluation.isViolation ? '#f87171' : '#86efac'}`
                        }}>
                          {gemmaEvaluation.category || 'BENIGN'} {gemmaEvaluation.isViolation ? '🚨 FLAGGED' : '✅ CLEAN'}
                        </span>
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
                          (Confidence: {Math.round((gemmaEvaluation.confidence || 0.9) * 100)}%)
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.825rem' }}>
                    Listening for speech into microphone... Speak a sentence to test on-device STT & Gemma.
                  </div>
                )}
              </div>
            )}
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

          // 1. Enable user mic state & device (if available)
          if (readinessResult?.micDeviceId) {
            setIsAudioUserEnabled(true);
            setSelectedMicDeviceId(readinessResult.micDeviceId);
          }

          // 2. Start webcam stream if camera is present and verified (non-blocking)
          const camId = readinessResult?.cameraDeviceId;
          if (camId) {
            setSelectedWebcamId(camId);
            try {
              await startWebcam(camId);
            } catch (camErr) {
              console.warn('[StudentView] Webcam start skipped or unavailable:', camErr);
            }
          }

          // 3. Start full screen sharing independently (ALWAYS works standalone)
          try {
            await startScreen(readinessResult?.screenStream);
          } catch (screenErr) {
            console.warn('[StudentView] Screen share start error:', screenErr);
          }
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