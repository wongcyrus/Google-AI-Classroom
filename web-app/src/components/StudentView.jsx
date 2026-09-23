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
import useTeacherScreenBroadcastStudent from '../hooks/useTeacherScreenBroadcastStudent';
import TeacherScreenViewerModal from './TeacherScreenViewerModal';
import LiveSubtitleOverlay from './subtitles/LiveSubtitleOverlay';
import { useStudentLiveSubtitles } from '../hooks/useStudentLiveSubtitles';
import MicSetupModal from './MicSetupModal';
import ExamReadinessWizard from './ExamReadinessWizard';
import BingoModal, { playBingoChime } from './BingoModal';
import StudentTaskWorkspaceModal from './tasks/StudentTaskWorkspaceModal';
import UnenrolledStudentView from './UnenrolledStudentView';
import { saveToOfflineQueue, flushOfflineQueue, getOfflineQueueCount } from '../utils/offlineBufferManager';
import { decodeAudioBlobToPcm } from '../utils/audioDecoder';
import { isGoogleChrome, isMobileDevice } from '../utils/browserDetection';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';
import {
  allowsLocalVoiceAi,
  normalizeVoiceAiMode,
  shouldSendTranscriptToCloud,
  shouldRunCloudVoiceFallback,
} from '../utils/voiceAiPolicy';
import UnsupportedBrowserNotice from './UnsupportedBrowserNotice';
import StudentMobileView from './student/StudentMobileView';

import Sidebar from './student/Sidebar';

const StudentDesktopView = ({ user, onSwitchToMobile }) => {
  // Browser validation guard for desktop proctored students
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
  const [webcamError, setWebcamError] = useState('');
  const isSharing = isScreenSharing || isWebcamSharing;

  // Desktop YouTube-Style Screen Mode: 'standard' | 'max' | 'smallest'
  const [desktopScreenMode, setDesktopScreenMode] = useState(() => {
    try {
      return localStorage.getItem('student_desktop_screen_mode') || 'standard';
    } catch {
      return 'standard';
    }
  });

  const handleSetDesktopScreenMode = useCallback((mode) => {
    setDesktopScreenMode(mode);
    try {
      localStorage.setItem('student_desktop_screen_mode', mode);
    } catch {}
  }, []);

  const [isCcEnabled, setIsCcEnabled] = useState(true);
  const [showYtSettings, setShowYtSettings] = useState(false);
  const [teacherZoomScale, setTeacherZoomScale] = useState(1);
  const playerContainerRef = useRef(null);
  const [isPlayerFullscreen, setIsPlayerFullscreen] = useState(false);

  const togglePlayerFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      playerContainerRef.current?.requestFullscreen?.().catch(() => {});
      setIsPlayerFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsPlayerFullscreen(false);
    }
  }, []);

  // Sync fullscreenchange events
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsPlayerFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Schedule-driven class state with enrolled classes fallback
  const { userClasses, currentActiveClassId, activeClassIds } = useStudentClassSchedule(user);
  const [isManualScheduleOverride, setIsManualScheduleOverride] = useState(() => {
    try {
      return localStorage.getItem('isManualScheduleOverride') === 'true';
    } catch {
      return false;
    }
  });
  const [selectedClassId, setSelectedClassId] = useState(() => {
    try {
      return localStorage.getItem('selectedStudentClassId') || '';
    } catch {
      return '';
    }
  });

  const activeClass = useMemo(() => {
    // If student explicitly chose a manual class override, honor it as highest priority
    if (isManualScheduleOverride && selectedClassId && userClasses?.some(c => (typeof c === 'string' ? c : c.id) === selectedClassId)) {
      return selectedClassId;
    }
    // Otherwise follow schedule if active class is detected
    if (currentActiveClassId) return currentActiveClassId;
    // Fallback to selectedClassId if valid
    if (selectedClassId && userClasses?.some(c => (typeof c === 'string' ? c : c.id) === selectedClassId)) {
      return selectedClassId;
    }
    // Fallback to first enrolled class
    if (userClasses && userClasses.length > 0) {
      const first = userClasses[0];
      return typeof first === 'string' ? first : (first?.id || null);
    }
    return null;
  }, [isManualScheduleOverride, selectedClassId, currentActiveClassId, userClasses]);

  // Target classes for multi-class background telemetry & screenshot ingestion during overlaps
  const targetClasses = useMemo(() => {
    const list = [];
    if (activeClass) list.push(activeClass);
    if (Array.isArray(activeClassIds)) {
      for (const id of activeClassIds) {
        if (id && !list.includes(id) && userClasses?.some(c => (typeof c === 'string' ? c : c.id) === id)) {
          list.push(id);
        }
      }
    }
    return list;
  }, [activeClass, activeClassIds, userClasses]);

  const handleSelectClass = useCallback((val) => {
    setSelectedClassId(val);
    setIsManualScheduleOverride(true);
    try {
      localStorage.setItem('selectedStudentClassId', val);
      localStorage.setItem('isManualScheduleOverride', 'true');
    } catch {}
  }, []);

  const handleFollowSchedule = useCallback(() => {
    setIsManualScheduleOverride(false);
    try {
      localStorage.setItem('isManualScheduleOverride', 'false');
    } catch {}
  }, []);
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
  const [isExamReadyLocal, setIsExamReadyLocal] = useState(false);
  const [isViewingTeacherScreen, setIsViewingTeacherScreen] = useState(false);

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
  const [enrolledBingoChallenges, setEnrolledBingoChallenges] = useState({});

  // Active Practical Tasks State
  const [activeTaskSession, setActiveTaskSession] = useState(null);
  const [classTasks, setClassTasks] = useState([]);
  const [isTaskWorkspaceOpen, setIsTaskWorkspaceOpen] = useState(false);
  const [selectedTaskChallenge, setSelectedTaskChallenge] = useState(null);
  const [currentTaskSubmission, setCurrentTaskSubmission] = useState(null);

  // Subscribe to published tasks for activeClass
  useEffect(() => {
    if (!activeClass) {
      setClassTasks([]);
      return;
    }
    const tasksRef = collection(db, 'classes', activeClass, 'tasks');
    const unsub = onSnapshot(tasksRef, (snapshot) => {
      const list = snapshot.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.status === 'published');
      setClassTasks(list);
    }, (err) => console.warn('[StudentView] Tasks fetch error:', err));
    return () => unsub();
  }, [activeClass]);

  const isClassSessionOngoing = Boolean(isCapturing || activeClass);

  // Active Bingo Challenge resolver across all enrolled classes
  const currentBingoChallenge = useMemo(() => {
    // 1. Check activeClass in enrolledBingoChallenges or myProperties first
    const activeFromMap = activeClass ? enrolledBingoChallenges[activeClass] : null;
    if (activeFromMap && (activeFromMap.status === 'pending' || activeFromMap.status === 'active') && (!activeFromMap.result || activeFromMap.result === 'pending')) {
      const expiresAt = activeFromMap.expiresAtMillis || (activeFromMap.issuedAtMillis ? activeFromMap.issuedAtMillis + (activeFromMap.timeLimitSeconds || 30) * 1000 : null);
      if (!expiresAt || expiresAt > Date.now()) {
        return activeFromMap;
      }
    }

    const ab = myProperties?.activeBingo;
    if (ab && (ab.status === 'pending' || ab.status === 'active') && (!ab.result || ab.result === 'pending')) {
      const expiresAt = ab.expiresAtMillis || (ab.issuedAtMillis ? ab.issuedAtMillis + (ab.timeLimitSeconds || 30) * 1000 : null);
      if (!expiresAt || expiresAt > Date.now()) {
        return { ...ab, classId: ab.classId || activeClass };
      }
    }

    // 2. Check any other enrolled class's challenge in enrolledBingoChallenges
    for (const [cId, b] of Object.entries(enrolledBingoChallenges)) {
      if (b && (b.status === 'pending' || b.status === 'active') && (!b.result || b.result === 'pending')) {
        const expiresAt = b.expiresAtMillis || (b.issuedAtMillis ? b.issuedAtMillis + (b.timeLimitSeconds || 30) * 1000 : null);
        if (!expiresAt || expiresAt > Date.now()) {
          return { ...b, classId: b.classId || cId };
        }
      }
    }
    return null;
  }, [enrolledBingoChallenges, activeClass, myProperties?.activeBingo]);

  // Compute whether an active Bingo challenge is genuinely active, valid, and unexpired
  const isBingoActiveAndValid = useMemo(() => {
    if (!currentBingoChallenge) return false;
    if (!isClassSessionOngoing && (!userClasses || userClasses.length === 0)) return false;

    // Must be strictly 'pending' or 'active'
    if (currentBingoChallenge.status !== 'pending' && currentBingoChallenge.status !== 'active') return false;

    // Must not already have a finalized result
    if (currentBingoChallenge.result && currentBingoChallenge.result !== 'pending') return false;

    // Crucial: Must NOT be expired! If expiresAtMillis is in the past, do not popup!
    const expiresAt = currentBingoChallenge.expiresAtMillis || (currentBingoChallenge.issuedAtMillis ? currentBingoChallenge.issuedAtMillis + (currentBingoChallenge.timeLimitSeconds || 30) * 1000 : null);
    if (expiresAt && expiresAt <= Date.now()) {
      return false;
    }

    return true;
  }, [currentBingoChallenge, isClassSessionOngoing, userClasses]);

  // Proactively exit browser fullscreen when active Bingo challenge is issued to ensure unhindered visibility
  useEffect(() => {
    if (isBingoActiveAndValid && currentBingoChallenge) {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      setIsPlayerFullscreen(false);
    }
  }, [isBingoActiveAndValid, currentBingoChallenge]);

  // Auto-dismiss pending Bingo modal if class session ends and no enrolled classes
  useEffect(() => {
    if (!isClassSessionOngoing && (!userClasses || userClasses.length === 0) && currentBingoChallenge?.status === 'pending') {
      setEnrolledBingoChallenges({});
      setMyProperties((prev) =>
        prev
          ? {
              ...prev,
              activeBingo: { ...prev.activeBingo, status: 'closed' },
            }
          : null
      );
    }
  }, [isClassSessionOngoing, userClasses, currentBingoChallenge?.status]);

  // Silently mark expired Bingo challenges as closed in Firestore without popping up to student
  useEffect(() => {
    if (!user?.uid || !currentBingoChallenge) return;
    const targetClassId = currentBingoChallenge.classId || activeClass;
    if (!targetClassId) return;

    const expiresAt = currentBingoChallenge.expiresAtMillis || (currentBingoChallenge.issuedAtMillis ? currentBingoChallenge.issuedAtMillis + (currentBingoChallenge.timeLimitSeconds || 30) * 1000 : null);
    const isExpired = Boolean(expiresAt && expiresAt <= Date.now());

    if (isExpired && currentBingoChallenge.status === 'pending') {
      console.log(`[StudentView] Bingo challenge expired in ${targetClassId} before student viewed. Silently closing.`);
      setEnrolledBingoChallenges((prev) => {
        if (!prev[targetClassId]) return prev;
        const next = { ...prev };
        delete next[targetClassId];
        return next;
      });
      setMyProperties((prev) =>
        prev
          ? {
              ...prev,
              activeBingo: { ...prev.activeBingo, status: 'closed', result: prev.activeBingo.result || 'missed_timeout' },
            }
          : null
      );

      const studentPropsRef = doc(db, 'classes', targetClassId, 'studentProperties', user.uid);
      setDoc(
        studentPropsRef,
        {
          activeBingo: {
            ...currentBingoChallenge,
            status: 'closed',
            result: currentBingoChallenge.result || 'missed_timeout',
          },
        },
        { merge: true }
      ).catch((err) => {
        console.warn('[StudentView] Silently closing expired bingo in Firestore:', err);
      });

      // Submit background timeout if not already submitted
      if (currentBingoChallenge.bingoId && !currentBingoChallenge.result) {
        handleBingoSubmit({
          bingoId: currentBingoChallenge.bingoId,
          selectedIndex: null,
          responseTimeSec: currentBingoChallenge.timeLimitSeconds || 30,
          windowFocused: false,
        }).catch(() => {});
      }
    }
  }, [activeClass, user?.uid, currentBingoChallenge]);

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
  const [vadSensitivity, setVadSensitivity] = useState(15);
  const [voiceAiCloudFallbackRate, setVoiceAiCloudFallbackRate] = useState(1);
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
  const [lastAudioSegmentStatus, setLastAudioSegmentStatus] = useState(null);
  const [isClassExamActive, setIsClassExamActive] = useState(false);
  const [classExamPeriods, setClassExamPeriods] = useState([]);

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
  const isStartingScreenRef = useRef(false);
  const webcamStreamRef = useRef(null);
  const sessionIdRef = useRef(null);
  const lastMessageTimestampRef = useRef(null);
  const effectiveVoiceAiMode = normalizeVoiceAiMode(voiceAiMode);
  const isLocalVoiceAiEnabled = allowsLocalVoiceAi(effectiveVoiceAiMode);
  const shouldEvaluateVoiceWithGemma = effectiveVoiceAiMode === 'hybrid';

  const [gemmaIntentPrompt, setGemmaIntentPrompt] = useState(null);
  const [liveAudioPrompt, setLiveAudioPrompt] = useState(null);
  const [sessionAudioPrompt, setSessionAudioPrompt] = useState(null);

  // Client-Side Gemma LLM STT Monitor (LiteRT.js in Web Worker)
  const {
    status: gemmaStatus,
    loadingProgress: gemmaLoadingProgress,
    isModelCached: isGemmaCached,
    delegateUsed: gemmaDelegate,
    engine: gemmaEngine,
    unavailableReason: gemmaUnavailableReason,
    latestEvaluation: gemmaEvaluation,
    preloadGemmaModel,
    evaluateTranscript: evaluateSpeechWithGemma,
  } = useClientLiteRTGemma({
    classId: activeClass,
    studentUid: user?.uid,
    studentEmail: user?.email,
    customGemmaPrompt: liveAudioPrompt || gemmaIntentPrompt,
  });
  const isGemmaReady =
    gemmaEngine === 'litert_lm_gemma_e2b' &&
    (gemmaStatus === 'ready' || gemmaStatus === 'evaluating');
  const handleLiveVoiceTranscript = useCallback(async (transcript) => {
    if (!shouldEvaluateVoiceWithGemma) return null;

    const localEvaluationPromise = isGemmaReady
      ? evaluateSpeechWithGemma(transcript)
      : Promise.resolve(null);
    if (!shouldSendTranscriptToCloud(effectiveVoiceAiMode)) {
      return localEvaluationPromise;
    }

    console.log('[StudentView:CloudTranscriptAnalysis] Sending selected-track STT to Genkit.', {
      transcript,
      gemmaStatus,
      gemmaEngine,
    });
    try {
      const analyzeAudioCallable = httpsCallable(functions, 'analyzeAudio');
      const [, response] = await Promise.all([
        localEvaluationPromise,
        analyzeAudioCallable({
          transcript,
          classId: activeClass,
          studentUid: user?.uid,
          studentEmail: user?.email,
          prompt: liveAudioPrompt?.promptText ||
            (typeof liveAudioPrompt === 'string' ? liveAudioPrompt : undefined),
        }),
      ]);
      console.log('[StudentView:CloudTranscriptAnalysis] Genkit analysis completed.', response?.data);
      return response?.data || null;
    } catch (error) {
      console.warn('[StudentView:CloudTranscriptAnalysis] Genkit analysis failed:', error);
      return null;
    }
  }, [
    activeClass,
    effectiveVoiceAiMode,
    evaluateSpeechWithGemma,
    gemmaEngine,
    gemmaStatus,
    isGemmaReady,
    liveAudioPrompt,
    shouldEvaluateVoiceWithGemma,
    user?.email,
    user?.uid,
  ]);

  const handleAudioUploadedRef = useRef(null);
  const handleMicDeviceResolved = useCallback((actualDeviceId) => {
    if (!actualDeviceId || actualDeviceId === selectedMicDeviceId) return;
    try {
      localStorage.setItem('preferred_mic_device_id', actualDeviceId);
    } catch {
      // The in-memory selection still remains valid when storage is unavailable.
    }
    setSelectedMicDeviceId(actualDeviceId);
  }, [selectedMicDeviceId]);
  const isNowInExamPeriod = useMemo(() => {
    if (isClassExamActive) return true;
    if (!classExamPeriods || !Array.isArray(classExamPeriods)) return false;
    const nowMs = Date.now();
    return classExamPeriods.some(p => {
      if (!p?.startDate || !p?.endDate) return false;
      const s = new Date(p.startDate).getTime();
      const e = new Date(p.endDate).getTime();
      return !isNaN(s) && !isNaN(e) && nowMs >= s && nowMs <= e;
    });
  }, [isClassExamActive, classExamPeriods]);

  const isExamActive = Boolean(isExamReadyLocal || myProperties?.examReadiness?.isReady || isNowInExamPeriod);
  const isAudioCaptureActive =
    Boolean(enableAudioCapture) &&
    (isSharing || isWebcamSharing || isScreenSharing || isExamActive) &&
    isAudioUserEnabled &&
    !isSessionDisplaced;

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
    enabled: isAudioCaptureActive,
    enableCloudUpload: Boolean(enableAudioCapture),
    aiMonitoringMode: effectiveVoiceAiMode,
    segmentDuration: audioSegmentDuration,
    windowDuration: audioMovingWindowDuration,
    strideDuration: audioMovingWindowStride,
    enableMovingWindow: enableSegmentTranscription,
    silenceSuppression: audioSilenceSuppression,
    vadSensitivity,
    retentionDays: retentionDays,
    deviceId: selectedMicDeviceId,
    onAudioUploaded: (data) => handleAudioUploadedRef.current?.(data),
    onDeviceResolved: handleMicDeviceResolved,
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
    enabled: isAudioCaptureActive && isLocalVoiceAiEnabled,
    speechLanguage: classSpeechLanguage,
    audioStream,
    deviceId: selectedMicDeviceId,
    vadSensitivity,
    onTranscript: shouldEvaluateVoiceWithGemma ? handleLiveVoiceTranscript : undefined,
  });

  // Teacher broadcast preloads only lightweight models. Gemma E2B remains
  // student-controlled because its download is approximately 2 GB.
  useEffect(() => {
    if (preloadClientAi && effectiveVoiceAiMode !== 'disabled') {
      console.log('[StudentView:PreloadBroadcast] Teacher AI preload signal received.', {
        preloadClientAi,
        voiceAiMode: effectiveVoiceAiMode,
      });
      if (isLocalVoiceAiEnabled && !isWhisperCached && preloadWhisperModel) {
        preloadWhisperModel().catch(err => console.debug('[StudentView] Whisper preload error:', err));
      }
    }
  }, [preloadClientAi, effectiveVoiceAiMode, isLocalVoiceAiEnabled, isWhisperCached, preloadWhisperModel]);

  const gemmaModelStatus = !shouldEvaluateVoiceWithGemma
    ? 'disabled'
    : isGemmaReady
      ? 'ready'
      : gemmaStatus === 'loading'
        ? 'loading'
        : gemmaUnavailableReason
          ? 'unavailable'
          : 'not_loaded';
  const gemmaProgressBucket = Math.floor((gemmaLoadingProgress || 0) / 10) * 10;

  useEffect(() => {
    if (!activeClass || !user?.uid) return;

    const statusDocRef = doc(db, 'classes', activeClass, 'status', user.uid);
    setDoc(statusDocRef, {
      gemmaModelStatus,
      gemmaEngine,
      gemmaLoadingProgress: gemmaProgressBucket,
      gemmaUnavailableReason: gemmaUnavailableReason
        ? gemmaUnavailableReason.slice(0, 240)
        : '',
      gemmaStatusUpdatedAt: serverTimestamp(),
    }, { merge: true }).catch(error => {
      console.warn('[StudentView] Failed to publish Gemma capability status:', error);
    });
  }, [
    activeClass,
    user?.uid,
    gemmaModelStatus,
    gemmaEngine,
    gemmaProgressBucket,
    gemmaUnavailableReason,
  ]);

  // Stable callback for uploaded audio segments
  const handleAudioUploaded = useCallback(async ({ path, url, blob, strideIndex }) => {
    console.log('%c[StudentView:AudioUploaded] 🎙️ Audio segment upload callback received:', 'background:#4338ca;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
      path,
      blobSize: blob?.size,
      voiceAiMode,
      selectedMicDeviceId: selectedMicDeviceId || '(default)',
    });
    let transcriptText = '';
    let usedEngine = effectiveVoiceAiMode === 'disabled'
      ? 'Voice AI Disabled'
      : isLocalVoiceAiEnabled
        ? 'LiteRT Whisper (Local)'
        : 'Cloud Gemini Transcribe';

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
    if (isLocalVoiceAiEnabled && transcribeAudioChunk) {
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
          usedEngine = 'LiteRT Whisper (Local)';
        }
      } catch (err) {
        console.debug('[StudentView] Client LiteRT STT error:', err);
      }
    }

    // 3. Cloud AI fallback (invoked ONLY when cloud is permitted and NOT in client_only or disabled mode)
    const shouldUseCloud = shouldRunCloudVoiceFallback({
      mode: effectiveVoiceAiMode,
      fallbackRate: voiceAiCloudFallbackRate,
      strideIndex,
      hasLocalTranscript: Boolean(transcriptText),
      hasAudioUrl: Boolean(url),
    });
    if (shouldUseCloud) {
      try {
        usedEngine = 'Cloud Gemini Transcribe';
        console.log('[StudentView] ⚡ Invoking Cloud Gemini Audio Analysis flow for segment:', path);
        const analyzeAudioCallable = httpsCallable(functions, 'analyzeAudio');
        const res = await analyzeAudioCallable({
          audioUrl: url,
          classId: activeClass,
          studentUid: user?.uid,
          studentEmail: user?.email,
          model: 'gemini-3.5-transcribe-preview',
          prompt: liveAudioPrompt?.promptText || (typeof liveAudioPrompt === 'string' ? liveAudioPrompt : undefined),
        });
        if (res?.data?.transcript && !res.data.transcript.includes('[NO_SPEECH_DETECTED]')) {
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

    // Update last audio segment telemetry for UI monitor
    setLastAudioSegmentStatus({
      strideIndex,
      durationSec: audioSegmentDuration || 30,
      engine: usedEngine,
      transcript: transcriptText,
      timestamp: Date.now(),
      hasSpeech: Boolean(transcriptText && !transcriptText.includes('[NO_SPEECH_DETECTED]')),
    });

    // 4. If transcript acquired, sync UI state, Firestore status, and evaluate with Gemma LLM
    if (transcriptText) {
      if (setWhisperTranscript) setWhisperTranscript(transcriptText);
      const classesToSync = targetClasses.length > 0 ? targetClasses : (activeClass ? [activeClass] : []);
      for (const cls of classesToSync) {
        try {
          const statusDocRef = doc(db, 'classes', cls, 'status', user?.uid);
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
          console.warn(`[StudentView] Failed to update live transcript status for ${cls}:`, err);
        }
      }

      if (shouldEvaluateVoiceWithGemma && evaluateSpeechWithGemma) {
        await evaluateSpeechWithGemma(transcriptText);
      }
    }
  }, [transcribeAudioChunk, audioSegmentDuration, evaluateSpeechWithGemma, setWhisperTranscript, effectiveVoiceAiMode, isLocalVoiceAiEnabled, shouldEvaluateVoiceWithGemma, voiceAiCloudFallbackRate, activeClass, targetClasses, user, selectedMicDeviceId, classSpeechLanguage]);

  handleAudioUploadedRef.current = handleAudioUploaded;

  const appliedReadinessDevicesRef = useRef('');

  // Apply readiness devices once per completed device selection, not on every status snapshot.
  useEffect(() => {
    const readiness = myProperties?.examReadiness;
    if (!readiness?.isReady) {
      appliedReadinessDevicesRef.current = '';
      return;
    }

    const readinessKey = `${readiness.micDeviceId || ''}:${readiness.cameraDeviceId || ''}`;
    if (appliedReadinessDevicesRef.current !== readinessKey) {
      appliedReadinessDevicesRef.current = readinessKey;
      setIsAudioUserEnabled(true);
      let hasLocalMicSelection = false;
      try {
        hasLocalMicSelection = Boolean(localStorage.getItem('preferred_mic_device_id'));
      } catch {
        // Fall back to the readiness selection when storage is unavailable.
      }
      if (readiness.micDeviceId && !hasLocalMicSelection) {
        setSelectedMicDeviceId(readiness.micDeviceId);
      }
      if (readiness.cameraDeviceId) {
        setSelectedWebcamId(readiness.cameraDeviceId);
      }
    }
  }, [
    myProperties?.examReadiness?.isReady,
    myProperties?.examReadiness?.micDeviceId,
    myProperties?.examReadiness?.cameraDeviceId,
  ]);


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

  // Receiver Hook for Teacher Screen Broadcast (Classroom Frame Stream)
  const {
    isBroadcastActive: isTeacherBroadcastActive,
    broadcastInfo: teacherBroadcastInfo,
    liveFrame: teacherLiveFrame,
    connectionState: teacherConnectionState,
    joinBroadcast: joinTeacherBroadcast,
    leaveBroadcast: leaveTeacherBroadcast,
  } = useTeacherScreenBroadcastStudent({
    classId: activeClass,
    studentUid: user?.uid,
    studentEmail: user?.email,
  });

  const studentSubtitles = useStudentLiveSubtitles({
    classId: activeClass,
  });

  // Automatically open teacher broadcast viewer for student when teacher starts sharing
  useEffect(() => {
    if (isTeacherBroadcastActive && activeClass) {
      setIsViewingTeacherScreen(true);
      joinTeacherBroadcast();
    } else if (!isTeacherBroadcastActive) {
      setIsViewingTeacherScreen(false);
    }
  }, [isTeacherBroadcastActive, activeClass, joinTeacherBroadcast]);

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

  // Background Auto-Preload AI models silently so student doesn't need to manually click preload buttons
  useEffect(() => {
    if (!activeClass) return;
    if (aiMonitoringMode !== 'disabled' && aiMonitoringMode !== 'cloud_only' && !isModelCached && !isPreloading && clientAiStatus === 'idle') {
      preloadModel?.();
    }
    if (isAudioCaptureActive && isLocalVoiceAiEnabled && !isWhisperCached && whisperStatus === 'idle') {
      preloadWhisperModel?.();
    }
  }, [activeClass, aiMonitoringMode, isModelCached, isPreloading, clientAiStatus, isAudioCaptureActive, isLocalVoiceAiEnabled, isWhisperCached, whisperStatus, preloadModel, preloadWhisperModel]);

  const lastTelemetrySyncRef = useRef(0);
  const telemetryTimerRef = useRef(null);

  // Sync real-time face, gaze, and audio telemetry to student status doc (Throttled to max once per 1.5s)
  useEffect(() => {
    if (!user || !user.uid) return;
    const classesToSync = targetClasses.length > 0 ? targetClasses : (activeClass ? [activeClass] : []);
    if (classesToSync.length === 0) return;

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
    if (enableAudioCapture || isLocalVoiceAiEnabled || effectiveVoiceAiMode !== 'disabled' || isAudioUserEnabled || myProperties?.examReadiness?.isReady || isAudioRecording) {
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
      for (const cls of classesToSync) {
        const statusRef = doc(db, "classes", cls, "status", user.uid);
        setDoc(statusRef, updateData, { merge: true }).catch(err => console.debug(`Error updating telemetry status for ${cls}:`, err));
      }
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
  }, [activeClass, targetClasses, user, isWebcamSharing, faceStatus, clientAiStatus, loadingProgress, isModelCached, fallbackReason, delegateUsed, yawAngle, pitchAngle, earValue, marValue, isCalibrated, metricDistance, activeViolation, enableAudioCapture, isLocalVoiceAiEnabled, effectiveVoiceAiMode, isAudioUserEnabled, myProperties, isAudioRecording, audioLevel, isSpeaking]);

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

  const updateCaptureStatus = useCallback(async (activeStreams, classIdOrClasses) => {
    const rawClasses = classIdOrClasses || targetClasses;
    const classes = Array.isArray(rawClasses) ? rawClasses.filter(Boolean) : [rawClasses].filter(Boolean);
    if (classes.length === 0 || !user || !user.uid) return;

    for (const cls of classes) {
      const statusRef = doc(db, "classes", cls, "status", user.uid);
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
        console.error(`Firestore: Error updating capture status for ${cls}: `, error);
      }
    }
  }, [targetClasses, user]);

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
   * Requests generic camera access first so Chrome can show its permission prompt,
   * then binds the selected camera exactly without silently substituting another device.
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
    try {
      setWebcamError('');
      const stream = await acquireInputDeviceStream('video', deviceIdToUse);

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
      console.warn("Webcam unavailable or permission not granted:", err);
      const permissionDenied = err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError';
      setWebcamError(permissionDenied
        ? 'Camera access is blocked. Allow Camera from Chrome site settings, then try again.'
        : `Unable to start the selected webcam: ${err?.message || 'camera unavailable'}`);
      setIsWebcamSharing(false);
      return;
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
      try {
        const playPromise = webcamVideoRef.current.play?.();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(e => console.debug('[StudentView] webcam video play note:', e));
        }
      } catch (playErr) {
        console.debug('[StudentView] webcam play error:', playErr);
      }
    }
  }, [isWebcamSharing, primaryStream]);

  const startScreen = useCallback(async (existingStream = null) => {
    const currentTrack = screenStreamRef.current?.getVideoTracks?.()[0];
    if (
      !existingStream &&
      currentTrack &&
      currentTrack.readyState !== 'ended'
    ) {
      return screenStreamRef.current;
    }
    if (isStartingScreenRef.current) {
      return null;
    }
    isStartingScreenRef.current = true;

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

      if (screenStreamRef.current && screenStreamRef.current !== stream) {
        screenStreamRef.current.getTracks().forEach(track => track.stop());
      }
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
    } finally {
      isStartingScreenRef.current = false;
    }
  }, [activeClass, isWebcamSharing, requireFullScreenOnly, showSystemNotification, stopScreen, updateCaptureStatus, user]);

  // Ensure screen video element srcObject is always attached
  useEffect(() => {
    if (screenVideoRef.current && screenStreamRef.current && isScreenSharing) {
      if (screenVideoRef.current.srcObject !== screenStreamRef.current) {
        screenVideoRef.current.srcObject = screenStreamRef.current;
        try {
          const playPromise = screenVideoRef.current.play?.();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(e => console.debug('[StudentView] screen video play note:', e));
          }
        } catch (playErr) {
          console.debug('[StudentView] screen play error:', playErr);
        }
      }
    }
  }, [isScreenSharing]);

  const isUploadingScreenRef = useRef(false);
  const isUploadingWebcamRef = useRef(false);

  const captureVideoElement = useCallback(async (videoElement, channelName, targetClassesInput) => {
    if (!user || !user.uid) {
      return;
    }

    const rawClasses = targetClassesInput || targetClasses;
    const classes = Array.isArray(rawClasses) ? rawClasses.filter(Boolean) : [rawClasses].filter(Boolean);
    if (classes.length === 0) return;
    const primaryClass = classes[0];

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
        const screenshotPath = `screenshots/${primaryClass}/${user.uid}/${channelName}_${timestamp}.jpg`;
        const screenshotRef = ref(storage, screenshotPath);
        
        try {
          await uploadBytes(screenshotRef, blob);
          const expireAtDate = new Date(Date.now() + (retentionDays || 30) * 24 * 60 * 60 * 1000);

          for (const cls of classes) {
            try {
              const docData = {
                classId: cls,
                studentUid: user.uid,
                email: user.email.toLowerCase(),
                channel: channelName,
                imagePath: screenshotRef.fullPath,
                size: blob.size,
                timestamp: serverTimestamp(),
                expireAt: expireAtDate,
                deleted: false,
                ipAddress: ipAddress,
              };
              if (activeTaskSession?.taskId) {
                docData.activeTaskId = activeTaskSession.taskId;
                docData.activeAttemptNumber = activeTaskSession.attemptNumber || 1;
              }
              await addDoc(collection(db, 'screenshots'), docData);

              const statusRef = doc(db, "classes", cls, "status", user.uid);
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
            } catch (err) {
              console.warn(`[StudentView] Error recording screenshot doc for overlapping class ${cls}:`, err);
            }
          }
          console.log(`[StudentView] 📸 Successfully uploaded ${channelName} snapshot (${blob.size} bytes) to ${screenshotRef.fullPath} for classes:`, classes);
        } catch (uploadErr) {
          console.warn(`Network error uploading ${channelName} screenshot, buffering offline:`, uploadErr);
          for (const cls of classes) {
            await saveToOfflineQueue({
              type: 'screenshot',
              classId: cls,
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
          }
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
  }, [user, maxImageSize, imageQuality, retentionDays, ipAddress, targetClasses]);

  const captureAndUploadAllChannels = useCallback((targetClassesInput) => {
    const classes = targetClassesInput || targetClasses;
    if (!classes || (Array.isArray(classes) && classes.length === 0)) return;
    if (isScreenSharing && screenVideoRef.current) {
      captureVideoElement(screenVideoRef.current, 'screen', classes);
    }
    if (isWebcamSharing && webcamVideoRef.current) {
      captureVideoElement(webcamVideoRef.current, 'webcam', classes);
    }
  }, [isScreenSharing, isWebcamSharing, captureVideoElement, targetClasses]);

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
        const incomingAiMode = data.aiMonitoringMode || 'hybrid';
        setAiMonitoringMode(incomingAiMode);
        setEnableClientAi(data.enableClientAi !== undefined ? data.enableClientAi : (incomingAiMode === 'hybrid' || incomingAiMode === 'client_only'));
        setPreloadClientAi(prev => (data.preloadClientAi !== undefined ? data.preloadClientAi : false));
        setGazeSensitivity(prev => (data.gazeSensitivity && data.gazeSensitivity !== prev ? data.gazeSensitivity : (prev || 'standard')));
        setCustomYawAngle(prev => (data.customYawAngle !== undefined ? data.customYawAngle : (prev || 25)));
        setCustomPitchDownAngle(prev => (data.customPitchDownAngle !== undefined ? data.customPitchDownAngle : (prev || -22)));
        setCustomPitchUpAngle(prev => (data.customPitchUpAngle !== undefined ? data.customPitchUpAngle : (prev || 26)));
        setEnableCloudFallback(data.enableCloudFallback !== undefined ? data.enableCloudFallback : (incomingAiMode === 'hybrid' || incomingAiMode === 'cloud_only'));
        setCloudFallbackRate(prev => (data.cloudFallbackRate !== undefined ? data.cloudFallbackRate : (prev || 3)));
        setIsCapturing(prev => (data.isCapturing !== undefined && data.isCapturing !== prev ? data.isCapturing : (prev || false)));
        setEnableAudioCapture(data.enableAudioCapture !== undefined ? Boolean(data.enableAudioCapture) : false);
        setAudioCaptureMode(prev => (data.audioCaptureMode && data.audioCaptureMode !== prev ? data.audioCaptureMode : (prev || 'mandatory')));
        setVoiceAiMode(data.voiceAiMode || incomingAiMode);
        setClassSpeechLanguage(prev => (data.speechLanguage && data.speechLanguage !== prev ? data.speechLanguage : (prev || 'zh-HK')));
        setAudioSegmentDuration(prev => (data.audioSegmentDuration !== undefined && data.audioSegmentDuration !== prev ? data.audioSegmentDuration : (prev || 30)));
        setAudioSilenceSuppression(prev => (data.audioSilenceSuppression !== undefined && data.audioSilenceSuppression !== prev ? data.audioSilenceSuppression : (prev !== undefined ? prev : true)));
        setVadSensitivity(data.vadSensitivity !== undefined ? data.vadSensitivity : 15);
        setVoiceAiCloudFallbackRate(data.voiceAiCloudFallbackRate !== undefined ? data.voiceAiCloudFallbackRate : 1);
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
        setGemmaIntentPrompt(data.gemmaIntentPrompt || null);
        setLiveAudioPrompt(data.liveAudioPrompt || null);
        setSessionAudioPrompt(data.sessionAudioPrompt || null);
        if (data.isExamActive !== undefined) {
          setIsClassExamActive(Boolean(data.isExamActive));
        }
        if (data.examPeriods !== undefined) {
          setClassExamPeriods(data.examPeriods || []);
        }
        if (data.isExamActive) {
          setRequireFullScreenOnly(true);
        }
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
        if (docSnap.exists()) {
          const data = docSnap.data();
          // Fallback to legacy activeBingo fields ONLY if structured activeBingo map does not exist
          if (!data.activeBingo && data['activeBingo.status']) {
            data.activeBingo = {
              status: data['activeBingo.status'],
              result: data['activeBingo.result'] || data['activeBingo.status'],
              responseTimeSec: data['activeBingo.responseTimeSec'] || null,
            };
          }
          setMyProperties(data);
        } else {
          setMyProperties(null);
        }
    }, (error) => {
        console.error(`Firestore: Error subscribing to student properties for ${user.uid}:`, error);
    });

    return () => {
        unsubClassProps();
        unsubStudentProps();
    };
  }, [activeClass, user]);

  // Listen for studentProperties across all enrolled classes to support multi-class Bingo presence
  useEffect(() => {
    if (!user?.uid || !userClasses || userClasses.length === 0) {
      setEnrolledBingoChallenges({});
      return;
    }

    const unsubs = [];
    const enrolledClassIds = userClasses.map(c => typeof c === 'string' ? c : c.id).filter(Boolean);

    enrolledClassIds.forEach(cId => {
      const classObj = userClasses.find(c => (typeof c === 'string' ? c : c.id) === cId);
      const cName = typeof classObj === 'string' ? classObj : (classObj?.name || cId);

      const studentPropsRef = doc(db, 'classes', cId, 'studentProperties', user.uid);
      const unsub = onSnapshot(studentPropsRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          let bingo = data.activeBingo;
          if (!bingo && data['activeBingo.status']) {
            bingo = {
              status: data['activeBingo.status'],
              result: data['activeBingo.result'],
            };
          }

          if (bingo && (bingo.status === 'pending' || bingo.status === 'active') && (!bingo.result || bingo.result === 'pending')) {
            const totalSeconds = bingo.timeLimitSeconds || 30;
            const expiresAt = bingo.expiresAtMillis || (bingo.issuedAtMillis ? bingo.issuedAtMillis + totalSeconds * 1000 : null);
            if (expiresAt && expiresAt <= Date.now()) {
              setEnrolledBingoChallenges(prev => {
                if (!prev[cId]) return prev;
                const next = { ...prev };
                delete next[cId];
                return next;
              });
              return;
            }

            setEnrolledBingoChallenges(prev => ({
              ...prev,
              [cId]: {
                ...bingo,
                classId: bingo.classId || cId,
                className: cName,
              }
            }));
          } else {
            setEnrolledBingoChallenges(prev => {
              if (!prev[cId]) return prev;
              const next = { ...prev };
              delete next[cId];
              return next;
            });
          }
        } else {
          setEnrolledBingoChallenges(prev => {
            if (!prev[cId]) return prev;
            const next = { ...prev };
            delete next[cId];
            return next;
          });
        }
      }, (err) => {
        console.warn(`[StudentView] Error subscribing to studentProperties for ${cId}:`, err);
      });
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(u => u());
    };
  }, [user?.uid, userClasses]);

  const handleBingoSubmit = async ({ bingoId, selectedIndex, responseTimeSec, windowFocused }) => {
    const targetClassId = currentBingoChallenge?.classId || activeClass;
    if (!targetClassId || !bingoId) return;
    try {
      const submitBingoFn = httpsCallable(functions, 'submitBingoAnswer');
      const res = await submitBingoFn({
        classId: targetClassId,
        bingoId,
        selectedIndex,
        responseTimeSec,
        windowFocused,
      });
      return res.data;
    } catch (err) {
      console.warn('[StudentView] Callable submitBingoAnswer failed:', err);
      return { success: false };
    }
  };

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

    const shouldCapture = isSharing && (isCapturing || isExamActive) && activeClass;

    if (shouldCapture) {
      const now = Date.now();
      const rawStart = captureStartedAt || (isExamActive && myProperties?.examReadiness?.calibratedAt ? new Date(myProperties.examReadiness.calibratedAt) : null);
      const startTime = rawStart ? (rawStart.toMillis ? rawStart.toMillis() : (rawStart.toDate ? rawStart.toDate().getTime() : (rawStart.getTime ? rawStart.getTime() : now))) : now;
      const twoAndAHalfHours = 2.5 * 60 * 60 * 1000;

      if (now - startTime < twoAndAHalfHours) {
        const intervalMs = Math.max(1, (frameRate || 15)) * 1000;

        // Perform capture if enough time has passed since last capture or on first run
        if (now - lastCaptureTimeRef.current >= intervalMs) {
          lastCaptureTimeRef.current = now;
          captureAndUploadAllChannelsRef.current(targetClasses);
        }

        const handleTick = () => {
          lastCaptureTimeRef.current = Date.now();
          captureAndUploadAllChannelsRef.current(targetClasses);
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
        const classesToExpire = targetClasses.length > 0 ? targetClasses : (activeClass ? [activeClass] : []);
        for (const cls of classesToExpire) {
          const statusRef = doc(db, "classes", cls, "status", user.uid);
          console.log(`Firestore: Capture time expired, updating status for ${user.uid} in ${cls}`);
          setDoc(statusRef, { 
              isCapturing: false,
              reason: "Capture time limit reached."
          }, { merge: true })
            .catch(err => {
              console.error(`Firestore: Failed to update student status for ${cls} after capture time expired:`, err);
            });
        }
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
  }, [isSharing, isCapturing, frameRate, activeClass, targetClasses, captureStartedAt, myProperties?.examReadiness?.isReady, myProperties?.examReadiness?.calibratedAt, user?.uid]);

  if (!activeClass && (!userClasses || userClasses.length === 0)) {
    return (
      <UnenrolledStudentView
        user={user}
        onRefresh={() => window.location.reload()}
        onSignOut={() => signOut(auth)}
      />
    );
  }

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

      {/* Live Exam Mode Protected Session Banner */}
      {isExamActive && (
        <div
          className="exam-security-banner"
          style={{
            background: '#fef2f2',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            margin: '0.75rem 0',
            display: 'flex',
            alignItems: 'center',
            gap: '12px'
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>🔒</span>
          <div>
            <strong style={{ color: '#991b1b', fontSize: '0.92rem' }}>
              Official Examination in Progress — Proctored Session
            </strong>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#7f1d1d' }}>
              Full screen sharing and continuous proctoring are mandatory. Screen recordings and audio transcripts are protected under exam confidentiality policies and will not be shared.
            </p>
          </div>
        </div>
      )}

      {/* Teacher Live Screen Broadcast Alert Banner */}
      {isTeacherBroadcastActive && !isViewingTeacherScreen && (
        <div className="teacher-broadcast-alert-banner">
          <div className="broadcast-banner-info">
            <span className="live-pulse-dot" />
            <span className="broadcast-banner-title">
              🖥️ <strong>Teacher is sharing their screen:</strong>{' '}
              {teacherBroadcastInfo?.teacherEmail ? teacherBroadcastInfo.teacherEmail : 'Live Classroom Broadcast'}
            </span>
          </div>
          <div className="broadcast-banner-action">
            <button
              type="button"
              className="broadcast-view-btn"
              onClick={() => {
                setIsViewingTeacherScreen(true);
                joinTeacherBroadcast();
              }}
            >
              🖥️ View Teacher's Screen
            </button>
          </div>
        </div>
      )}

      {/* Active Classroom Bingo Presence Challenge Banner (Guaranteed Presence Alert) */}
      {isBingoActiveAndValid && currentBingoChallenge && (
        <div className="bingo-top-alert-banner" role="alert">
          <div className="bingo-alert-info">
            <span className="bingo-pulse-icon">🎲</span>
            <div className="bingo-alert-text">
              <strong>Classroom Bingo Presence Challenge Active!</strong>
              <span>Confirm your attendance by answering the verification question.</span>
            </div>
          </div>
          <button
            type="button"
            className="bingo-banner-open-btn"
            onClick={() => {
              try {
                playBingoChime();
              } catch {}
            }}
          >
            Answer Challenge ➔
          </button>
        </div>
      )}

      {/* Active Practical Task Challenge Banner */}
      {classTasks.length > 0 && (
        <div className="bingo-top-alert-banner" style={{ background: 'linear-gradient(90deg, #1e3a8a, #2563eb)' }} role="alert">
          <div className="bingo-alert-info">
            <span className="bingo-pulse-icon">📋</span>
            <div className="bingo-alert-text">
              <strong style={{ color: '#fff' }}>Practical Task Available: {classTasks[0].title}</strong>
              <span style={{ color: '#bfdbfe' }}>
                {activeTaskSession ? 'Active attempt in progress — screen sharing is recorded.' : 'Complete this hands-on assignment.'}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="bingo-banner-open-btn"
            style={{ background: '#ffffff', color: '#1e3a8a', fontWeight: 'bold' }}
            onClick={() => {
              setSelectedTaskChallenge(classTasks[0]);
              setIsTaskWorkspaceOpen(true);
            }}
          >
            {activeTaskSession ? 'Open Workspace ➔' : 'Start Task ➔'}
          </button>
        </div>
      )}

      <div className={`student-view-content mode-${desktopScreenMode}`}>
        <div className="student-view-main">
          {/* Smallest / Mini-Player Mode Workspace Callout */}
          {desktopScreenMode === 'smallest' && (
            <div className="mini-player-active-callout">
              <div className="callout-text">
                📺 <strong>Mini-Player Active:</strong> Video player is compact in the corner. You have full room for notes, IDE, and course materials.
              </div>
              <div className="callout-actions">
                <button
                  type="button"
                  className="callout-btn"
                  onClick={() => handleSetDesktopScreenMode('standard')}
                  title="Switch to Standard Side-by-Side Mode"
                >
                  🔲 Standard Mode
                </button>
                <button
                  type="button"
                  className="callout-btn"
                  onClick={() => handleSetDesktopScreenMode('max')}
                  title="Switch to Max Theater Mode"
                >
                  🗖 Max Mode
                </button>
              </div>
            </div>
          )}
          {!isSharing ? (
            <div className="student-setup-hero-card">
                <div className="setup-hero-header">
                  <div className="setup-class-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                    <span>{activeClass ? `Class: ${activeClass}` : 'No active class'}</span>
                    {userClasses && userClasses.length > 1 && (
                      <select
                        aria-label="Select Enrolled Class"
                        value={activeClass || ''}
                        onChange={(e) => handleSelectClass(e.target.value)}
                        style={{
                          background: 'rgba(255, 255, 255, 0.9)',
                          border: '1px solid #cbd5e1',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '0.8rem',
                          color: '#1e293b',
                          cursor: 'pointer'
                        }}
                      >
                        {userClasses.map(c => {
                          const cId = typeof c === 'string' ? c : c.id;
                          const cName = typeof c === 'string' ? c : (c.name || c.id);
                          const isScheduled = activeClassIds?.includes(cId);
                          return (
                            <option key={cId} value={cId}>
                              {cName}{isScheduled ? ' 🕒 (Scheduled)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    )}
                    {isManualScheduleOverride && currentActiveClassId && currentActiveClassId !== activeClass && (
                      <button
                        type="button"
                        onClick={handleFollowSchedule}
                        className="btn-follow-schedule"
                        title={`Reset manual override and follow scheduled class: ${currentActiveClassId}`}
                        style={{
                          padding: '2px 8px',
                          fontSize: '0.75rem',
                          borderRadius: '4px',
                          border: '1px solid #3b82f6',
                          backgroundColor: '#eff6ff',
                          color: '#1d4ed8',
                          cursor: 'pointer',
                          fontWeight: '600'
                        }}
                      >
                        ↩ Follow Schedule ({currentActiveClassId})
                      </button>
                    )}
                  </div>
                  <h2 className="setup-hero-title">Welcome to Your Classroom Session</h2>
                  <p className="setup-hero-subtitle">
                    Please complete the guided device check and pose calibration before starting your proctored session.
                  </p>
                </div>

                <div className="setup-hero-actions">
                  <button
                    type="button"
                    onClick={() => setIsReadinessWizardOpen(true)}
                    className="btn-start-setup-wizard"
                  >
                    🚀 Start Setup & Readiness Test
                  </button>
                  <button
                    type="button"
                    onClick={() => startScreen()}
                    className="btn-quick-start-screen"
                    title="Start Screen Sharing Directly"
                  >
                    🖥️ Quick Start (Screen Only)
                  </button>
                  <button
                    type="button"
                    onClick={onSwitchToMobile}
                    className="btn-switch-mobile-mode"
                    title="Switch to Mobile Companion View (Teacher Screen, Subtitles, Bingo)"
                    style={{
                      background: '#10b981',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 14px',
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    📱 Mobile View (Screen, CC, Bingo)
                  </button>
                </div>

                <div className="setup-system-summary">
                  <div className="summary-item">
                    <span className="summary-icon">🖥️</span>
                    <div className="summary-text">
                      <strong>Screen Sharing</strong>
                      <span>Full desktop verification</span>
                    </div>
                    <span className="summary-badge ready">Ready</span>
                  </div>

                  <div className="summary-item">
                    <span className="summary-icon">📷</span>
                    <div className="summary-text">
                      <strong>Camera & Gaze</strong>
                      <span>{availableWebcams.length > 0 ? `${availableWebcams.length} Detected` : 'Optional / Screen-Only'}</span>
                    </div>
                    <span className={`summary-badge ${availableWebcams.length > 0 ? 'ready' : 'info'}`}>
                      {availableWebcams.length > 0 ? 'Detected' : 'No Webcam'}
                    </span>
                  </div>

                  <div className="summary-item">
                    <span className="summary-icon">🎙️</span>
                    <div className="summary-text">
                      <strong>Microphone</strong>
                      <span>
                        {enableAudioCapture
                          ? (audioCaptureMode === 'mandatory' ? 'Required (Recording)' : 'Optional (Recording)')
                          : 'Not Recording'}
                      </span>
                    </div>
                    <span className={`summary-badge ${enableAudioCapture && isAudioUserEnabled ? 'ready' : 'info'}`}>
                      {enableAudioCapture ? (isAudioUserEnabled ? 'Active' : 'Muted') : 'Off'}
                    </span>
                  </div>

                  <div className="summary-item">
                    <span className="summary-icon">⚡</span>
                    <div className="summary-text">
                      <strong>On-Device AI</strong>
                      <span>{clientAiStatus === 'ready' ? 'Ready (Fast)' : isPreloading ? `Loading (${loadingProgress}%)` : 'Auto-Loads in Background'}</span>
                    </div>
                    <span className={`summary-badge ${clientAiStatus === 'ready' ? 'ready' : 'loading'}`}>
                      {clientAiStatus === 'ready' ? 'Active' : 'Auto'}
                    </span>
                  </div>

                  {enableAudioCapture && shouldEvaluateVoiceWithGemma && (
                    <div className="summary-item">
                      <span className="summary-icon">🤖</span>
                      <div className="summary-text">
                        <strong>Gemma Intent AI</strong>
                        <span>
                          {isGemmaReady || isGemmaCached
                            ? 'Ready (On-Device)'
                            : gemmaStatus === 'loading'
                            ? `Downloading (${gemmaLoadingProgress}%)`
                            : 'Cloud Fallback (Optional Preload)'}
                        </span>
                      </div>
                      {gemmaStatus === 'loading' ? (
                        <span className="summary-badge loading">Loading</span>
                      ) : isGemmaReady || isGemmaCached ? (
                        <span className="summary-badge ready">Ready</span>
                      ) : (
                        <button
                          type="button"
                          onClick={preloadGemmaModel}
                          style={{
                            fontSize: '0.75rem',
                            padding: '4px 8px',
                            background: '#e0e7ff',
                            color: '#4338ca',
                            borderRadius: '6px',
                            border: '1px solid #c7d2fe',
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          title="Download & cache on-device Gemma 4 E2B model in browser storage"
                        >
                          Preload
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="student-active-top-bar">
                <div className="active-status-left">
                  <div className="active-pulse-badge">
                    <span className="pulse-dot"></span>
                    <span className="active-badge-label">
                      {isScreenSharing && isWebcamSharing && isAudioRecording
                        ? '🟢 Streaming Active (Screen + Cam + Mic)'
                        : isScreenSharing && isWebcamSharing
                        ? '🟢 Streaming Active (Screen + Cam)'
                        : '🟡 Streaming Active (Screen Only)'}
                    </span>
                  </div>
                  {userClasses && userClasses.length > 1 ? (
                    <div className="active-class-switcher-wrap" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                      <select
                        aria-label="Switch Active Class Session"
                        value={activeClass || ''}
                        onChange={(e) => handleSelectClass(e.target.value)}
                        className="active-class-select"
                        style={{
                          padding: '3px 8px',
                          fontSize: '12px',
                          fontWeight: '600',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          backgroundColor: '#f8fafc',
                          color: '#1e293b',
                          cursor: 'pointer'
                        }}
                      >
                        {userClasses.map((cls) => {
                          const id = typeof cls === 'string' ? cls : cls.id;
                          const name = typeof cls === 'string' ? cls : (cls.name || cls.id);
                          const isScheduled = activeClassIds?.includes(id);
                          return (
                            <option key={id} value={id}>
                              {name}{isScheduled ? ' 🕒 (Scheduled)' : ''}
                            </option>
                          );
                        })}
                      </select>
                      {isManualScheduleOverride && currentActiveClassId && currentActiveClassId !== activeClass && (
                        <button
                          type="button"
                          onClick={handleFollowSchedule}
                          className="btn-follow-schedule-active"
                          title={`Reset and follow scheduled class: ${currentActiveClassId}`}
                          style={{
                            padding: '2px 8px',
                            fontSize: '11px',
                            borderRadius: '4px',
                            border: '1px solid #3b82f6',
                            backgroundColor: '#eff6ff',
                            color: '#1d4ed8',
                            cursor: 'pointer',
                            fontWeight: '500'
                          }}
                        >
                          ↩ Follow Schedule ({currentActiveClassId})
                        </button>
                      )}
                    </div>
                  ) : (
                    <span className="active-class-pill">Class: {activeClass}</span>
                  )}
                  {(isCapturing || isExamActive) && (
                    <span className="active-telemetry-pill">📸 {frameRate}s capture</span>
                  )}
                </div>

                <div className="active-controls-right">
                  {/* Mic Mute Toggle */}
                  {(enableAudioCapture || isAudioRecording) && (
                    <button
                      type="button"
                      onClick={() => setIsAudioUserEnabled((prev) => !prev)}
                      className={`active-tool-button ${!isAudioUserEnabled ? 'muted' : 'active'}`}
                      title={!isAudioUserEnabled ? 'Unmute Mic' : 'Mute Mic'}
                    >
                      {!isAudioUserEnabled ? '🔇 Unmute' : isSpeaking ? '🔊 Speaking' : '🎙️ Mic Active'}
                    </button>
                  )}

                  {/* Webcam Switcher if multiple webcams */}
                  {availableWebcams.length > 1 && (
                    <select
                      value={selectedWebcamId}
                      onChange={handleWebcamChange}
                      className="active-webcam-select"
                      aria-label="Select Webcam"
                    >
                      {availableWebcams.map((cam, index) => (
                        <option key={cam.deviceId || index} value={cam.deviceId}>
                          📷 {cam.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Re-Open Setup / Calibration Wizard */}
                  <button
                    type="button"
                    onClick={() => setIsReadinessWizardOpen(true)}
                    className="active-tool-button btn-retest"
                    title="Open Setup & Device Calibration"
                  >
                    ⚙️ Setup & Re-Test
                  </button>

                  {/* Stop Session Button */}
                  <button
                    type="button"
                    onClick={() => {
                      stopScreen();
                      stopWebcam();
                    }}
                    className="active-tool-button btn-stop-session"
                    title="Stop All Sharing"
                  >
                    ⏹️ Stop Session
                  </button>
                </div>
              </div>
            )}

            {(isCapturing || isExamActive) && isSharing && (
              <p className="recording-indicator">
                🔴 Live invigilation active: Capturing every {frameRate}s (Quality optimized).
              </p>
            )}
            
            <div
              className={`preview-stage desktop-yt-player-box mode-${desktopScreenMode} ${isPlayerFullscreen ? 'fullscreen-mode' : ''}`}
              ref={playerContainerRef}
            >
              {/* Teacher Live Stream Frame Overlay (if teacher broadcast active) */}
              {isTeacherBroadcastActive && teacherLiveFrame && (
                <div className="teacher-live-stream-container">
                  <div className="teacher-live-top-bar">
                    <div className="live-badges-group">
                      <span className="live-pill"><span className="live-dot" /> LIVE</span>
                      <span className="res-tag">1080P</span>
                      <span className="teacher-name-tag">{teacherBroadcastInfo?.teacherEmail || 'Teacher Stream'}</span>
                    </div>
                    <div className="stream-zoom-controls">
                      <button
                        type="button"
                        onClick={() => setTeacherZoomScale(prev => (prev > 1 ? 1 : 1.75))}
                        className="yt-zoom-btn"
                        title="Toggle Zoom (1x / 1.75x)"
                      >
                        {teacherZoomScale > 1 ? '🔍 1x' : '🔍 Zoom'}
                      </button>
                    </div>
                  </div>
                  <img
                    src={teacherLiveFrame}
                    alt="Teacher Live Screen Broadcast"
                    className="teacher-live-screen-img"
                    style={{
                      transform: `scale(${teacherZoomScale})`,
                    }}
                  />
                </div>
              )}

              {/* Screen Stream Element */}
              <div
                className={`stream-feed-wrapper ${
                  !isScreenSharing
                    ? 'hidden-stream'
                    : isWebcamSharing && primaryStream === 'webcam'
                    ? 'pip-stream'
                    : 'hero-stream'
                } ${isTeacherBroadcastActive && teacherLiveFrame ? 'docked-proctor-pip' : ''}`}
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
                } ${isTeacherBroadcastActive && teacherLiveFrame ? 'docked-proctor-pip' : ''}`}
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
              {!isSharing && !isTeacherBroadcastActive && (
                <div className="inactive-streams-placeholder">
                  <div className="placeholder-icon">📡</div>
                  <p className="placeholder-title">Streams Inactive</p>
                  <p className="placeholder-subtitle">
                    Click "Share Screen" or "Start Webcam" above to begin streaming to your instructor.
                  </p>
                </div>
              )}

              {/* YouTube-Style Live Closed Captions Cue Overlay */}
              {isCcEnabled && studentSubtitles.active && (studentSubtitles.originalText || studentSubtitles.currentTranslation) && (
                <div
                  className={`youtube-cc-cue-container font-${studentSubtitles.fontSize}`}
                  aria-live="polite"
                  aria-label="Closed Captions Overlay"
                >
                  {(studentSubtitles.displayMode === 'bilingual' || studentSubtitles.displayMode === 'original') && studentSubtitles.originalText && (
                    <div className="youtube-cc-cue original">
                      <span className="youtube-cc-text">{studentSubtitles.originalText}</span>
                    </div>
                  )}
                  {(studentSubtitles.displayMode === 'bilingual' || studentSubtitles.displayMode === 'translation') && studentSubtitles.currentTranslation && (
                    <div className="youtube-cc-cue translated">
                      <span className="youtube-cc-text highlight">
                        {studentSubtitles.currentTranslation}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* YouTube-Style Player Bottom Control Bar */}
              <div className="yt-player-bottom-bar" role="toolbar" aria-label="Player Controls">
                <div className="yt-bar-left">
                  {/* YouTube CC Toggle Button */}
                  <button
                    type="button"
                    className={`yt-control-btn yt-cc-btn ${isCcEnabled ? 'active' : ''}`}
                    onClick={() => setIsCcEnabled(prev => !prev)}
                    title={isCcEnabled ? 'Subtitles / Closed Captions ON' : 'Subtitles / Closed Captions OFF'}
                    aria-pressed={isCcEnabled}
                  >
                    <span className="yt-cc-badge">CC</span>
                  </button>

                  {/* Language Selector */}
                  {studentSubtitles.availableLanguages && studentSubtitles.availableLanguages.length > 0 && (
                    <select
                      className="yt-lang-select"
                      value={studentSubtitles.selectedLanguage}
                      onChange={(e) => studentSubtitles.setSelectedLanguage(e.target.value)}
                      title="Select Subtitle Translation Language"
                      aria-label="Caption Language"
                    >
                      {studentSubtitles.availableLanguages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.label || l.code}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Live Status Pill */}
                  <div className="yt-live-indicator">
                    <span className="yt-live-dot" />
                    <span className="yt-live-label">{isTeacherBroadcastActive ? 'LIVE' : isSharing ? 'PROCTORED' : 'STANDBY'}</span>
                  </div>
                </div>

                <div className="yt-bar-right">
                  {/* Screen Mode Switches: Max vs Smallest vs Standard */}
                  <div className="yt-screen-mode-group" role="group" aria-label="Screen Mode">
                    <button
                      type="button"
                      className={`yt-mode-btn ${desktopScreenMode === 'max' ? 'active' : ''}`}
                      onClick={() => handleSetDesktopScreenMode('max')}
                      title="Max / Theater Mode (Full Width)"
                    >
                      🗖 Max
                    </button>
                    <button
                      type="button"
                      className={`yt-mode-btn ${desktopScreenMode === 'smallest' ? 'active' : ''}`}
                      onClick={() => handleSetDesktopScreenMode('smallest')}
                      title="Smallest / Mini-Player Mode (Compact Corner)"
                    >
                      🗗 Smallest
                    </button>
                    <button
                      type="button"
                      className={`yt-mode-btn ${desktopScreenMode === 'standard' ? 'active' : ''}`}
                      onClick={() => handleSetDesktopScreenMode('standard')}
                      title="Standard Mode (Side-by-Side)"
                    >
                      🔲 Standard
                    </button>
                  </div>

                  {/* Settings Gear & Popover */}
                  <div className="yt-settings-wrapper">
                    <button
                      type="button"
                      className={`yt-control-btn yt-settings-btn ${showYtSettings ? 'active' : ''}`}
                      onClick={() => setShowYtSettings(prev => !prev)}
                      title="Subtitle and Player Settings"
                    >
                      ⚙️
                    </button>

                    {showYtSettings && (
                      <div className="yt-settings-popover">
                        <div className="yt-popover-row">
                          <span className="yt-popover-label">CC Font Size</span>
                          <div className="yt-popover-options">
                            {['small', 'medium', 'large'].map((sz) => (
                              <button
                                key={sz}
                                type="button"
                                className={`yt-opt-btn ${studentSubtitles.fontSize === sz ? 'active' : ''}`}
                                onClick={() => studentSubtitles.setFontSize(sz)}
                              >
                                {sz.charAt(0).toUpperCase() + sz.slice(1)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="yt-popover-row">
                          <span className="yt-popover-label">Display Mode</span>
                          <div className="yt-popover-options">
                            {[
                              { id: 'bilingual', label: 'Bilingual' },
                              { id: 'translation', label: 'Translation' },
                              { id: 'original', label: 'Original' },
                            ].map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                className={`yt-opt-btn ${studentSubtitles.displayMode === m.id ? 'active' : ''}`}
                                onClick={() => studentSubtitles.setDisplayMode(m.id)}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Fullscreen Button */}
                  <button
                    type="button"
                    className="yt-control-btn yt-fullscreen-btn"
                    onClick={togglePlayerFullscreen}
                    title={isPlayerFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
                  >
                    {isPlayerFullscreen ? '⤦' : '⛶'}
                  </button>
                </div>
              </div>
            </div>

            {/* Live Speech AI & Voice Proctoring HUD (Shown only when teacher enables audio recording) */}
            {enableAudioCapture && (
              <div
                className="student-voice-proctoring-hud"
                style={{
                marginTop: '16px',
                padding: '16px',
                backgroundColor: 'var(--color-surface, #ffffff)',
                border: '1px solid var(--color-border, #e2e8f0)',
                borderRadius: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                fontSize: '0.875rem',
                color: 'var(--color-text-main, #0f172a)',
                boxShadow: 'var(--shadow-sm, 0 1px 3px rgba(0, 0, 0, 0.05))',
              }}>
                {/* Header with Live Engine & Speaking Status */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border, #e2e8f0)', paddingBottom: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 700, color: '#4f46e5', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.95rem' }}>
                      🎙️ Voice AI & Speech Invigilation
                    </span>
                    {isSpeaking ? (
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', background: '#10b981', color: '#fff', borderRadius: '9999px', fontWeight: 'bold' }}>
                        🗣️ SPEAKING
                      </span>
                    ) : (
                      <span style={{ fontSize: '0.72rem', padding: '2px 8px', background: '#f1f5f9', color: '#64748b', borderRadius: '9999px', fontWeight: 600 }}>
                        🤫 LISTENING
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    {whisperStatus === 'loading' && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#fef3c7', color: '#92400e', borderRadius: '9999px', fontWeight: 600 }}>
                        ⏳ Loading Whisper STT ({whisperLoadingProgress}%)
                      </span>
                    )}
                    {whisperStatus === 'transcribing' && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#e0e7ff', color: '#3730a3', borderRadius: '9999px', fontWeight: 600 }}>
                        🧠 Transcribing Speech...
                      </span>
                    )}
                    {whisperStatus === 'ready' && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#dcfce7', color: '#166534', borderRadius: '9999px', fontWeight: 600 }}>
                        🟢 Whisper Ready ({whisperDelegate.toUpperCase()})
                      </span>
                    )}
                    {whisperStatus === 'error' && (
                      <span style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#fee2e2', color: '#991b1b', borderRadius: '9999px', fontWeight: 600 }}>
                        ☁️ Cloud STT Mode
                      </span>
                    )}

                    {/* Gemma On-Device Intent LLM Status & Preload Control */}
                    {shouldEvaluateVoiceWithGemma && (
                      isGemmaReady || isGemmaCached ? (
                        <span
                          style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#ede9fe', color: '#5b21b6', borderRadius: '9999px', fontWeight: 600 }}
                          title={`On-device Gemma 4 E2B intent model ready (${gemmaDelegate || 'WASM'})`}
                        >
                          🤖 Gemma Ready
                        </span>
                      ) : gemmaStatus === 'loading' ? (
                        <span
                          style={{ fontSize: '0.72rem', padding: '3px 9px', background: '#fef3c7', color: '#92400e', borderRadius: '9999px', fontWeight: 600 }}
                          title="Downloading on-device Gemma LLM model into browser storage"
                        >
                          ⏳ Loading Gemma ({gemmaLoadingProgress}%)
                        </span>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <button
                            type="button"
                            onClick={preloadGemmaModel}
                            style={{
                              fontSize: '0.72rem',
                              padding: '3px 9px',
                              background: '#4f46e5',
                              color: '#ffffff',
                              borderRadius: '9999px',
                              fontWeight: 600,
                              border: 'none',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                            title="Download & cache on-device Gemma 4 E2B model (~1.5GB) in browser storage for zero-cloud intent analysis"
                          >
                            📥 Preload Gemma AI
                          </button>
                          <span style={{ fontSize: '0.68rem', color: '#64748b' }} title="Cloud Gemini analyzes audio while local Gemma is not loaded">
                            (☁️ Cloud Active)
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </div>

                {/* Sub-bar with Live Volume Meter, Device, Mode, and Model Info */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', flex: '1 1 200px' }}>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#475569', whiteSpace: 'nowrap' }}>
                      Mic Input Level:
                    </span>
                    <div style={{
                      flex: 1,
                      height: '8px',
                      backgroundColor: '#e2e8f0',
                      borderRadius: '4px',
                      overflow: 'hidden',
                      position: 'relative'
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(100, Math.max(2, Math.round(audioLevel * 100)))}%`,
                        backgroundColor: audioLevel > 0.4 ? '#ef4444' : audioLevel > 0.15 ? '#10b981' : '#3b82f6',
                        transition: 'width 0.1s ease-out, background-color 0.2s',
                        borderRadius: '4px'
                      }} />
                    </div>
                    <span style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: 'monospace', minWidth: '32px' }}>
                      {Math.round(audioLevel * 100)}%
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', fontSize: '0.75rem', color: '#64748b' }}>
                    <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                      🌐 Mode: <strong>{effectiveVoiceAiMode.toUpperCase()}</strong> ({classSpeechLanguage})
                    </span>
                    <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                      📦 {isWhisperCached ? 'Whisper Cached' : 'On-Device STT'}
                    </span>
                    <span style={{ background: '#f1f5f9', padding: '3px 8px', borderRadius: '4px', border: '1px solid #e2e8f0' }}>
                      ☁️ Cloud Storage: <strong>{enableAudioCapture ? 'Enabled' : 'Off (Local Only)'}</strong>
                    </span>
                  </div>
                </div>

                {/* Last Segment Telemetry */}
                {lastAudioSegmentStatus && (
                  <div style={{
                    backgroundColor: '#f8fafc',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.78rem',
                    color: '#475569',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <span>
                      <strong>Last Audio Chunk:</strong> Stride #{lastAudioSegmentStatus.strideIndex} ({lastAudioSegmentStatus.durationSec}s) via <span style={{ color: '#4f46e5', fontWeight: 600 }}>{lastAudioSegmentStatus.engine}</span>
                    </span>
                    <span style={{
                      color: lastAudioSegmentStatus.hasSpeech ? '#059669' : '#64748b',
                      fontWeight: 600,
                    }}>
                      {lastAudioSegmentStatus.hasSpeech ? '💬 Speech Detected' : '🤫 Silence / Background'}
                    </span>
                  </div>
                )}

                {/* STT Transcript & Gemma Intent */}
                {whisperTranscript ? (
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    padding: '10px 12px',
                    borderRadius: '8px'
                  }}>
                    <div>
                      <strong style={{ color: '#0f766e' }}>🎙️ Transcribed Speech:</strong> <span style={{ fontStyle: 'italic', color: '#0f172a', fontWeight: 600 }}>"{whisperTranscript}"</span>
                    </div>
                    {gemmaEvaluation && (
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: '0.8rem' }}>
                        <strong style={{ color: '#4338ca' }}>
                          🤖 Gemma Intent Check:
                        </strong>
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
                        {gemmaEvaluation.rationale && (
                          <span style={{ color: '#475569', fontSize: '0.75rem' }}>
                            ({gemmaEvaluation.rationale})
                          </span>
                        )}
                        <span style={{ color: '#64748b', fontSize: '0.75rem' }}>
                          • Confidence: {Math.round((gemmaEvaluation.confidence || 0.9) * 100)}%
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    color: '#64748b',
                    fontStyle: 'italic',
                    fontSize: '0.825rem',
                    padding: '8px 12px',
                    backgroundColor: '#f8fafc',
                    borderRadius: '6px',
                    border: '1px dashed #cbd5e1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}>
                    <span>👂 Listening for speech into microphone... Speak a sentence to test on-device STT & AI intent analysis.</span>
                    <button
                      type="button"
                      onClick={() => setIsReadinessWizardOpen(true)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#4f46e5',
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        padding: 0
                      }}
                    >
                      Test Microphone ➔
                    </button>
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
          liveTranscriptHistory={studentSubtitles.recentHistory}
          currentOriginalText={studentSubtitles.originalText}
          currentTranslationText={studentSubtitles.currentTranslation}
          selectedLanguage={studentSubtitles.selectedLanguage}
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
        studentUid={user?.uid}
        studentName={user?.displayName || user?.email || ''}
        currentMicDeviceId={selectedMicDeviceId}
        isMandatory={enableAudioCapture && audioCaptureMode === 'mandatory'}
      />

      <ExamReadinessWizard
        isOpen={isReadinessWizardOpen}
        onClose={() => setIsReadinessWizardOpen(false)}
        onComplete={async (readinessResult) => {
          setIsReadinessWizardOpen(false);
          setIsExamReadyLocal(true);

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
        currentScreenStream={screenStreamRef.current}
        onSelectCameraDevice={(id) => {
          setSelectedWebcamId(id);
        }}
      />

      {/* Teacher Live Screen Viewer Modal for Students */}
      <TeacherScreenViewerModal
        isOpen={isViewingTeacherScreen}
        onClose={() => {
          setIsViewingTeacherScreen(false);
          leaveTeacherBroadcast();
        }}
        liveFrame={teacherLiveFrame}
        connectionState={teacherConnectionState}
        broadcastInfo={teacherBroadcastInfo}
        classId={activeClass}
        subtitleState={studentSubtitles}
      />

      {/* Floating Subtitle Overlay when not viewing screen broadcast */}
      {!isViewingTeacherScreen && (
        <LiveSubtitleOverlay
          active={studentSubtitles.active}
          originalText={studentSubtitles.originalText}
          sourceLang={studentSubtitles.sourceLang}
          currentTranslation={studentSubtitles.currentTranslation}
          translations={studentSubtitles.translations}
          selectedLanguage={studentSubtitles.selectedLanguage}
          onSelectLanguage={studentSubtitles.setSelectedLanguage}
          displayMode={studentSubtitles.displayMode}
          onSelectDisplayMode={studentSubtitles.setDisplayMode}
          fontSize={studentSubtitles.fontSize}
          onSelectFontSize={studentSubtitles.setFontSize}
          isVisible={studentSubtitles.isVisible}
          onToggleVisible={studentSubtitles.setIsVisible}
          isDocked={false}
          engine={studentSubtitles.engine}
        />
      )}

      {/* Active Bingo Verification Modal (dismissed when class ends or expired) */}
      {isBingoActiveAndValid && currentBingoChallenge && (
        <BingoModal
          key={currentBingoChallenge.bingoId || 'bingo-modal'}
          activeBingo={currentBingoChallenge}
          onSubmit={handleBingoSubmit}
          onClose={() => {
            const targetClassId = currentBingoChallenge.classId || activeClass;
            if (targetClassId && user?.uid && currentBingoChallenge) {
              const studentPropsRef = doc(db, 'classes', targetClassId, 'studentProperties', user.uid);
              setDoc(
                studentPropsRef,
                {
                  activeBingo: {
                    ...currentBingoChallenge,
                    status: 'closed',
                  },
                },
                { merge: true }
              ).catch(() => {});
            }
            setEnrolledBingoChallenges(prev => {
              if (!prev[targetClassId]) return prev;
              const next = { ...prev };
              delete next[targetClassId];
              return next;
            });
            setMyProperties(prev => prev ? {
              ...prev,
              activeBingo: { ...prev.activeBingo, status: 'closed' }
            } : null);
          }}
        />
      )}

      {/* Practical Task Workspace Modal */}
      {isTaskWorkspaceOpen && selectedTaskChallenge && (
        <StudentTaskWorkspaceModal
          isOpen={isTaskWorkspaceOpen}
          onClose={() => setIsTaskWorkspaceOpen(false)}
          task={selectedTaskChallenge}
          submission={currentTaskSubmission}
          existingScreenStream={screenStreamRef.current}
          onStartAttempt={async (taskId, startedAttempt) => {
            setActiveTaskSession({ taskId, attemptNumber: startedAttempt.attemptNumber });
            if (activeClass && user?.uid) {
              const subRef = doc(db, 'classes', activeClass, 'tasks', taskId, 'submissions', user.uid);
              await setDoc(subRef, {
                studentUid: user.uid,
                email: user.email?.toLowerCase(),
                status: 'in_progress',
                latestAttempt: startedAttempt,
                updatedAt: serverTimestamp(),
              }, { merge: true });
            }
          }}
          onFinishAttempt={async (taskId, finishedAttempt) => {
            setActiveTaskSession(null);
            if (activeClass && user?.uid) {
              const subRef = doc(db, 'classes', activeClass, 'tasks', taskId, 'submissions', user.uid);
              const finished = { ...finishedAttempt, finishedAt: new Date(), status: 'compiling' };
              await setDoc(subRef, {
                status: 'compiling',
                latestAttempt: finished,
                updatedAt: serverTimestamp(),
              }, { merge: true });

              await addDoc(collection(db, 'videoJobs'), {
                jobId: `task_${taskId}_${user.uid}_att${finished.attemptNumber}_${Date.now()}`,
                classId: activeClass,
                studentUid: user.uid,
                studentEmail: user.email?.toLowerCase(),
                startTime: finished.startedAt,
                endTime: finished.finishedAt,
                status: 'pending',
                isTaskSubmission: true,
                taskId,
                attemptNumber: finished.attemptNumber,
                createdAt: serverTimestamp(),
              });
            }
          }}
        />
      )}
    </div>
  );
};

const StudentView = ({ user, onViewModeChange }) => {
  const [preferredViewMode, setPreferredViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem('student_view_mode');
      if (stored === 'mobile' || stored === 'desktop') return stored;
    } catch {}
    return isMobileDevice() ? 'mobile' : 'desktop';
  });

  const updateViewMode = useCallback((mode) => {
    setPreferredViewMode(mode);
    try {
      localStorage.setItem('student_view_mode', mode);
    } catch {}
    onViewModeChange?.(mode);
  }, [onViewModeChange]);

  // Synchronize body class for instant CSS layout adaptation
  useEffect(() => {
    if (preferredViewMode === 'mobile') {
      document.body.classList.add('in-student-mobile-view');
    } else {
      document.body.classList.remove('in-student-mobile-view');
    }
    return () => {
      document.body.classList.remove('in-student-mobile-view');
    };
  }, [preferredViewMode]);

  // Notify parent on initial mount
  useEffect(() => {
    onViewModeChange?.(preferredViewMode);
  }, [preferredViewMode, onViewModeChange]);

  if (preferredViewMode === 'mobile') {
    return (
      <StudentMobileView
        user={user}
        onSwitchToDesktop={() => updateViewMode('desktop')}
      />
    );
  }

  return (
    <StudentDesktopView
      user={user}
      onSwitchToMobile={() => updateViewMode('mobile')}
    />
  );
};

export default StudentView;