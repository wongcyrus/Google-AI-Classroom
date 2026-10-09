import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import './MonitorView.css';

import { db, storage, auth, functions } from '../firebase-config';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';


import Modal from './Modal';
import TeacherScreenBroadcastModal from './TeacherScreenBroadcastModal';
import TeacherSubtitleControlModal from './subtitles/TeacherSubtitleControlModal';
import { useTeacherLiveSubtitles } from '../hooks/useTeacherLiveSubtitles';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

import ControlsPanel from './monitor/ControlsPanel';
import StudentsGrid from './monitor/StudentsGrid';
import TimelineSlider from './TimelineSlider';
import IndividualStudentView from './IndividualStudentView';

import { usePrompts } from '../hooks/usePrompts';
import { useAudioPrompts } from '../hooks/useAudioPrompts';
import useTeacherScreenBroadcast from '../hooks/useTeacherScreenBroadcast';
import useLectureRecorder from '../hooks/useLectureRecorder';
import LectureRecordingsView from './LectureRecordingsView';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';
import BingoResultsView from './BingoResultsView';
import LectureQrBingoModal from './monitor/LectureQrBingoModal';


import { useAnalysis } from '../hooks/useAnalysis';
import {
  getComplianceSummary,
  filterStudentsByCompliance,
  getNudgeMessageForFilter,
  exportComplianceResultsToExcel,
} from '../utils/studentCompliance';
import { exportToExcel } from '../utils/exportUtils';
import { getStudentVoiceStatus } from '../utils/studentVoiceStatus';

const parseAutoRollConfig = (value) => {
  if (!value || value === 'off') return null;
  const parts = value.split('_');
  const stepRows = parts[0] === '2row' ? 2 : 1;
  const intervalSeconds = parseInt(parts[1], 10) || 10;
  return { stepRows, intervalMs: intervalSeconds * 1000 };
};

const MonitorView = ({ user, classId, className = '', lessons, selectedLesson, startTime, endTime, handleLessonChange: originalHandleLessonChange, timezone, filterField, onBroadcastStateChange, activeLiveClass = null, onSwitchClass = null }) => {
  const { prompts, filteredPrompts, promptFilter, setPromptFilter } = usePrompts('Per Image');
  const audioPrompts = useAudioPrompts(user);
  const { isAnalyzing, analysisResults, runPerImageAnalysis, runAllImagesAnalysis } = useAnalysis(classId);
  const [showAnalysisResultsModal, setShowAnalysisResultsModal] = useState(false);
  const [showBingoModal, setShowBingoModal] = useState(false);
  const [showLectureQrModal, setShowLectureQrModal] = useState(false);
  const [classList, setClassList] = useState([]);
  const [studentStatuses, setStudentStatuses] = useState([]);
  const [screenshots, setScreenshots] = useState({});
  const [selectedChannel, setSelectedChannel] = useState('both');
  const [problemFilter, setProblemFilter] = useState('all');
  const [captureMode, setCaptureMode] = useState('dual');
  const [message, setMessage] = useState('');

  const [frameRate, setFrameRate] = useState(15);
  const [maxImageSize, setMaxImageSize] = useState(0.1 * 1024 * 1024);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showNotSharingModal, setShowNotSharingModal] = useState(false);
  const [notSharingSortBy, setNotSharingSortBy] = useState('name');
  const [notSharingSortDirection, setNotSharingSortDirection] = useState('asc');
  const [notSharingSearchQuery, setNotSharingSearchQuery] = useState('');
  const [now, setNow] = useState(new Date());
  const [showControls, setShowControls] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);


  const [reviewTime, setReviewTime] = useState(null);
  const [timelineScrubTime, setTimelineScrubTime] = useState(null);
  const [showBroadcastModal, setShowBroadcastModal] = useState(false);
  const [showRecordingsModal, setShowRecordingsModal] = useState(false);
  const timelineDebounceTimer = useRef(null);

  const [autoRollSpeed, setAutoRollSpeed] = useState(() => {
    try {
      return localStorage.getItem('monitor_auto_roll_speed') || 'off';
    } catch {
      return 'off';
    }
  });
  const [rollRowIndex, setRollRowIndex] = useState(0);
  const [gridColumns, setGridColumns] = useState(4);
  const [isGridHovered, setIsGridHovered] = useState(false);
  const studentsGridRef = useRef(null);

  const handleAutoRollChange = (e) => {
    const val = e.target.value;
    setAutoRollSpeed(val);
    setRollRowIndex(0);
    try {
      localStorage.setItem('monitor_auto_roll_speed', val);
    } catch {}
  };

  const teacherUid = user?.uid || auth?.currentUser?.uid || null;
  const teacherEmail = user?.email || auth?.currentUser?.email || null;

  const lectureRecorder = useLectureRecorder({
    classId,
    teacherUid,
    teacherEmail,
  });


  const {
    isBroadcasting: isScreenBroadcasting,
    frameStats,
    screenStream: broadcastScreenStream,
    lastFrameData: broadcastLastFrameData,
    viewers: broadcastViewers = [],
    broadcastResolution,
    broadcastInterval,
    isPublicBroadcast,
    publicPin,
    setBroadcastResolution,
    setBroadcastInterval,
    startBroadcast: startScreenBroadcast,
    stopBroadcast: stopScreenBroadcast,
  } = useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail });

  const [showSubtitleModal, setShowSubtitleModal] = useState(false);
  const [isSubtitleBroadcastEnabled, setIsSubtitleBroadcastEnabled] = useState(true);
  const [selectedMicDeviceId, setSelectedMicDeviceId] = useState(() => {
    try {
      return localStorage.getItem('preferred_teacher_mic_device_id') || '';
    } catch {
      return '';
    }
  });

  const [classSubjectDomain, setClassSubjectDomain] = useState('');
  const [classSubtitlePrompt, setClassSubtitlePrompt] = useState(null);
  const [classDefaultLectureRecording, setClassDefaultLectureRecording] = useState(true);
  const [classSchedule, setClassSchedule] = useState(null);
  const [pendingBypassRequests, setPendingBypassRequests] = useState([]);
  const [classEmergencyPin, setClassEmergencyPin] = useState('');
  const [bypassTickerTime, setBypassTickerTime] = useState(() => Date.now());

  // Real-time countdown & auto-expiration ticker
  useEffect(() => {
    if (pendingBypassRequests.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setBypassTickerTime(now);

      // Auto-expire requests that cross the expiration mark while viewing
      const expiredNow = pendingBypassRequests.filter((req) => {
        const expiry = req.expiresAtMillis || 0;
        return expiry > 0 && expiry <= now;
      });

      if (expiredNow.length > 0 && classId) {
        expiredNow.forEach((r) => {
          updateDoc(doc(db, 'classes', classId, 'passkeyBypassRequests', r.id), {
            status: 'expired',
            expiredAt: serverTimestamp(),
          }).catch((err) => console.warn('[MonitorView] Error auto-expiring claim:', r.id, err));
        });
        setPendingBypassRequests((prev) => prev.filter((r) => !expiredNow.some((exp) => exp.id === r.id)));
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [pendingBypassRequests, classId]);

  // Derived active unexpired claims
  const activeBypassRequests = useMemo(() => {
    return pendingBypassRequests.filter((req) => {
      if (req.status && req.status !== 'pending') return false;
      const expiry = req.expiresAtMillis;
      if (!expiry) return false;
      return expiry > bypassTickerTime;
    });
  }, [pendingBypassRequests, bypassTickerTime]);

  const handleSelectMicDeviceId = (newId) => {
    setSelectedMicDeviceId(newId);
    try {
      localStorage.setItem('preferred_teacher_mic_device_id', newId);
    } catch {}
  };

  const handleSelectSubtitlePrompt = async (prompt) => {
    setClassSubtitlePrompt(prompt);
    if (classId) {
      try {
        await updateDoc(doc(db, 'classes', classId), {
          subtitlePrompt: prompt || null,
        });
      } catch (err) {
        console.error('Failed to update subtitle prompt:', err);
      }
    }
  };

  const handleSelectCourseContext = async (domain) => {
    setClassSubjectDomain(domain);
    if (classId) {
      try {
        await updateDoc(doc(db, 'classes', classId), {
          subjectDomain: domain,
        });
      } catch (err) {
        console.error('Failed to update subject domain:', err);
      }
    }
  };

  const [synchronizedAudioStream, setSynchronizedAudioStream] = useState(null);
  const activeBroadcastStreamsRef = useRef(null);
  const activeBroadcastSessionIdRef = useRef(null);
  const isStartingBroadcastRef = useRef(false);

  const teacherSubtitles = useTeacherLiveSubtitles({
    classId,
    teacherUid,
    teacherEmail,
    enabled: isSubtitleBroadcastEnabled,
    audioStream: synchronizedAudioStream,
    deviceId: selectedMicDeviceId,
    courseContext: classSubjectDomain || `Class ${classId}`,
    subtitlePrompt: classSubtitlePrompt,
  });

  // Synchronized Screen & Voice Launch Handler to prevent out-of-sync A/V
  const handleStartSynchronizedBroadcast = async (options = {}) => {
    if (isStartingBroadcastRef.current || isScreenBroadcasting) {
      console.warn('[MonitorView] Broadcast start already in progress or already active.');
      return null;
    }
    isStartingBroadcastRef.current = true;
    try {
      const {
        resolution = broadcastResolution || '720p',
        interval = broadcastInterval || 3000,
        isPublic = false,
        publicPin = null,
        micDeviceId = selectedMicDeviceId || '',
        enableSubtitles = isSubtitleBroadcastEnabled,
        recordOnStart = false,
        lectureTitle = '',
        lectureTopic = '',
      } = options;

    if (setBroadcastResolution) setBroadcastResolution(resolution);
    if (setBroadcastInterval) setBroadcastInterval(interval);

    // 1. Acquire screen media stream (with system audio if shared by user)
    let screenStream = null;
    if (navigator?.mediaDevices?.getDisplayMedia) {
      try {
        const displayMediaOptions = {
          video: {
            displaySurface: 'monitor',
            frameRate: { ideal: 10, max: 15 },
          },
          audio: true,
        };
        screenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
      } catch (dispErr) {
        console.warn('[MonitorView] Display media acquisition warning:', dispErr);
        throw dispErr;
      }
    }

    // 2. Acquire microphone audio stream
    let micStream = null;
    try {
      micStream = await acquireInputDeviceStream('audio', micDeviceId, {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    } catch (micErr) {
      console.warn('[MonitorView] Microphone acquisition fallback notice:', micErr);
      if (navigator?.mediaDevices?.getUserMedia) {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
        }).catch(() => null);
      }
    }

    // 3. Hardware clock A/V synchronization & Web Audio mixing
    const screenAudioTracks = screenStream ? screenStream.getAudioTracks() : [];
    const micAudioTracks = micStream ? micStream.getAudioTracks() : [];
    let synchronizedAudio = micStream;
    let mixedAudioCtx = null;

    if (
      screenAudioTracks.length > 0 &&
      micAudioTracks.length > 0 &&
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext)
    ) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      mixedAudioCtx = new AudioCtx();
      const dest = mixedAudioCtx.createMediaStreamDestination();
      const screenSource = mixedAudioCtx.createMediaStreamSource(new MediaStream(screenAudioTracks));
      const micSource = mixedAudioCtx.createMediaStreamSource(new MediaStream(micAudioTracks));
      screenSource.connect(dest);
      micSource.connect(dest);
      synchronizedAudio = dest.stream;
    }

    setSynchronizedAudioStream(synchronizedAudio);

    // 4. Atomic concurrent launch of Screen Broadcast, Subtitles, and Recording
    await startScreenBroadcast(
      screenStream
        ? { resolution, interval, isPublic, publicPin, existingStream: screenStream }
        : { resolution, interval, isPublic, publicPin }
    );

    if (enableSubtitles) {
      setIsSubtitleBroadcastEnabled(true);
    }

    if (!activeBroadcastSessionIdRef.current) {
      activeBroadcastSessionIdRef.current = `bcast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    }
    const currentBroadcastSessionId = activeBroadcastSessionIdRef.current;

    if (recordOnStart && lectureRecorder) {
      await lectureRecorder.startRecording({
        screenStream,
        audioStream: synchronizedAudio,
        title: lectureTitle,
        topic: lectureTopic,
        className,
        broadcastSessionId: currentBroadcastSessionId,
        schedule: classSchedule,
      });
    }

    activeBroadcastStreamsRef.current = {
      screenStream,
      micStream,
      mixedAudioCtx,
    };

    // Auto cleanup when user clicks "Stop sharing" on browser chrome bar
    const videoTrack = screenStream?.getVideoTracks?.()?.[0];
    if (videoTrack) {
      const origEnded = videoTrack.onended;
      videoTrack.onended = () => {
        if (typeof origEnded === 'function') origEnded();
        handleStopSynchronizedBroadcast();
      };
    }

    return screenStream;
    } finally {
      isStartingBroadcastRef.current = false;
    }
  };

  // Synchronized Stop Handler
  const handleStopSynchronizedBroadcast = async () => {
    const broadcastSessionIdToMerge = activeBroadcastSessionIdRef.current;
    activeBroadcastSessionIdRef.current = null;

    await stopScreenBroadcast();
    setSynchronizedAudioStream(null);

    if (lectureRecorder && (lectureRecorder.isRecording || lectureRecorder.isPaused)) {
      try {
        await lectureRecorder.stopRecording();
      } catch (err) {
        console.warn('[MonitorView] Stop lecture recording notice:', err.message);
      }
    }

    if (activeBroadcastStreamsRef.current) {
      const { screenStream, micStream, mixedAudioCtx } = activeBroadcastStreamsRef.current;
      if (screenStream) {
        screenStream.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      }
      if (micStream) {
        micStream.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
      }
      if (mixedAudioCtx && mixedAudioCtx.state !== 'closed') {
        try { mixedAudioCtx.close(); } catch {}
      }
      activeBroadcastStreamsRef.current = null;
    }
  };

  // Sync broadcast state with ClassHub header launcher
  useEffect(() => {
    if (onBroadcastStateChange) {
      onBroadcastStateChange({
        isBroadcasting: isScreenBroadcasting,
        viewersCount: broadcastViewers?.length || 0,
        openStudio: () => setShowBroadcastModal(true),
        stopBroadcast: handleStopSynchronizedBroadcast,
      });
    }
  }, [onBroadcastStateChange, isScreenBroadcasting, broadcastViewers?.length]);



  const handleLessonChange = (e) => {
    originalHandleLessonChange(e);
    setReviewTime(null);
  };

  const handleTimelineChange = (e) => {
    const time = parseInt(e.target.value, 10);
    setTimelineScrubTime(time);

    clearTimeout(timelineDebounceTimer.current);
    timelineDebounceTimer.current = setTimeout(() => {
      setReviewTime(new Date(time).toISOString());
      setTimelineScrubTime(null);
    }, 500);
  };
  const [storageUsage, setStorageUsage] = useState(0);
  const [storageQuota, setStorageQuota] = useState(0);
  const [storageUsageScreenShots, setStorageUsageScreenShots] = useState(0);
  const [storageUsageVideos, setStorageUsageVideos] = useState(0);
  const [storageUsageAudio, setStorageUsageAudio] = useState(0);
  const storageUsageZips = 0;
  const [aiQuota, setAiQuota] = useState(0);
  const [aiUsedQuota, setAiUsedQuota] = useState(0);
  const [enableAudioCapture, setEnableAudioCapture] = useState(false);



  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [editablePromptText, setEditablePromptText] = useState('');
  const [selectedAiModel, setSelectedAiModel] = useState('gemini-3.5-flash-lite');
  const [aiMonitoringMode, setAiMonitoringMode] = useState('hybrid');
  const [enableClientAi, setEnableClientAi] = useState(true);
  const [gazeSensitivity, setGazeSensitivity] = useState('standard');
  const [customYawAngle, setCustomYawAngle] = useState(25);
  const [customPitchDownAngle, setCustomPitchDownAngle] = useState(-22);
  const [customPitchUpAngle, setCustomPitchUpAngle] = useState(26);
  const [faceDebounceSeconds, setFaceDebounceSeconds] = useState(3);
  const [enableCloudFallback, setEnableCloudFallback] = useState(false);
  const [cloudFallbackRate, setCloudFallbackRate] = useState(3);
  const [isExamActive, setIsExamActive] = useState(false);

  // Voice AI States
  const [voiceAiMode, setVoiceAiMode] = useState('hybrid');
  const [speechLanguage, setSpeechLanguage] = useState('zh-HK');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [vadSensitivity, setVadSensitivity] = useState(15);
  const [voiceAiCloudFallbackRate, setVoiceAiCloudFallbackRate] = useState(3);
  const [liveAudioPrompt, setLiveAudioPrompt] = useState(null);

  const [isPerImageAnalysisRunning, setIsPerImageAnalysisRunning] = useState(false);
  const [isAllImagesAnalysisRunning, setIsAllImagesAnalysisRunning] = useState(false);
  const [samplingRate, setSamplingRate] = useState(5);
  const analysisCounterRef = useRef(0);
  const lastAnalyzedPathMapRef = useRef(new Map()); // studentUid -> { imagePath, timestamp }
  const activeAnalysisInFlightRef = useRef(new Set()); // studentUid set of currently in-flight Gemini calls
  const lastAllImagesPathsRef = useRef(new Map()); // studentUid -> imagePath
  const lastAllImagesRunTimeRef = useRef(0); // timestamp of last all-images analysis execution
  const studentUidMap = useRef(new Map());
  const [uidToEmailMap, setUidToEmailMap] = useState(new Map());
  const [studentProfiles, setStudentProfiles] = useState({});

  // Auto-synchronize and hydrate prompt selection when prompts library finishes loading asynchronously
  useEffect(() => {
    if (prompts && prompts.length > 0) {
      if (selectedPrompt && (!selectedPrompt.promptText || !editablePromptText)) {
        const match = prompts.find(p => p.id === selectedPrompt.id || p.originalId === selectedPrompt.id || p.id === selectedPrompt.originalId || p.originalId === selectedPrompt.originalId || p.name === selectedPrompt.name);
        if (match && match.promptText) {
          setSelectedPrompt(prev => ({ ...match, ...prev, promptText: prev?.promptText || match.promptText }));
          if (!editablePromptText) {
            setEditablePromptText(match.promptText);
          }
        }
      }
    }
  }, [prompts, selectedPrompt, editablePromptText]);

  // Auto-synchronize live audio prompts when audio prompts library finishes loading asynchronously
  useEffect(() => {
    if (audioPrompts && audioPrompts.length > 0) {
      if (liveAudioPrompt && typeof liveAudioPrompt === 'object' && !liveAudioPrompt.promptText) {
        const match = audioPrompts.find(p => p.id === liveAudioPrompt.id || p.originalId === liveAudioPrompt.id || p.id === liveAudioPrompt.originalId || p.originalId === liveAudioPrompt.originalId || p.name === liveAudioPrompt.name);
        if (match && match.promptText) {
          setLiveAudioPrompt(prev => ({ ...match, ...prev, promptText: match.promptText }));
        }
      }
    }
  }, [audioPrompts, liveAudioPrompt]);

  const handleAiModelChange = async (newModel) => {
    setSelectedAiModel(newModel);
    if (classId) {
      try {
        await updateDoc(doc(db, "classes", classId), { aiModel: newModel });
      } catch (e) {
        console.error("Failed to persist aiModel to class:", e);
      }
    }
  };

  const handleSaveAiSettings = async (settings) => {
    if (!classId) return;
    try {
      const mode = settings.aiMonitoringMode || 'hybrid';
      const clientAllowed = mode === 'hybrid' || mode === 'client_only';
      const cloudAllowed = mode === 'hybrid' || mode === 'cloud_only';

      const payload = {
        // Vision / Gaze
        aiMonitoringMode: mode,
        enableClientAi: clientAllowed,
        gazeSensitivity: settings.gazeSensitivity || 'standard',
        customYawAngle: parseInt(settings.customYawAngle, 10) || 25,
        customPitchDownAngle: parseInt(settings.customPitchDownAngle, 10) || -22,
        customPitchUpAngle: parseInt(settings.customPitchUpAngle, 10) || 26,
        faceDebounceSeconds: parseInt(settings.faceDebounceSeconds, 10) || 3,
        enableCloudFallback: cloudAllowed,
        cloudFallbackRate: parseInt(settings.cloudFallbackRate, 10) || 3,
        // Voice AI
        voiceAiMode: settings.voiceAiMode || 'hybrid',
        speechLanguage: settings.speechLanguage || 'zh-HK',
        audioSegmentDuration: parseInt(settings.audioSegmentDuration, 10) || 30,
        audioMovingWindowStride: parseInt(settings.audioMovingWindowStride, 10) || 15,
        audioSilenceSuppression: settings.audioSilenceSuppression !== undefined ? settings.audioSilenceSuppression : true,
        vadSensitivity: parseInt(settings.vadSensitivity, 10) || 15,
        voiceAiCloudFallbackRate: parseInt(settings.voiceAiCloudFallbackRate, 10) || 3,
      };

      if (settings.liveAudioPrompt !== undefined) {
        payload.liveAudioPrompt = settings.liveAudioPrompt;
        setLiveAudioPrompt(settings.liveAudioPrompt);
      }

      if (settings.liveImagePrompt !== undefined) {
        payload.liveImagePrompt = settings.liveImagePrompt;
        setSelectedPrompt(settings.liveImagePrompt);
        setEditablePromptText(settings.liveImagePrompt?.promptText || '');
      }

      if (settings.selectedAiModel) {
        payload.aiModel = settings.selectedAiModel;
        setSelectedAiModel(settings.selectedAiModel);
      }

      if (settings.samplingRate !== undefined) {
        const parsedSamplingRate = parseInt(settings.samplingRate, 10) || 5;
        payload.samplingRate = parsedSamplingRate;
        setSamplingRate(parsedSamplingRate);
      }

      setAiMonitoringMode(payload.aiMonitoringMode);
      setEnableClientAi(payload.enableClientAi);
      setGazeSensitivity(payload.gazeSensitivity);
      setCustomYawAngle(payload.customYawAngle);
      setCustomPitchDownAngle(payload.customPitchDownAngle);
      setCustomPitchUpAngle(payload.customPitchUpAngle);
      setFaceDebounceSeconds(payload.faceDebounceSeconds);
      setEnableCloudFallback(payload.enableCloudFallback);
      setCloudFallbackRate(payload.cloudFallbackRate);

      setVoiceAiMode(payload.voiceAiMode);
      setSpeechLanguage(payload.speechLanguage);
      setAudioSegmentDuration(payload.audioSegmentDuration);
      setAudioMovingWindowStride(payload.audioMovingWindowStride);
      setAudioSilenceSuppression(payload.audioSilenceSuppression);
      setVadSensitivity(payload.vadSensitivity);
      setVoiceAiCloudFallbackRate(payload.voiceAiCloudFallbackRate);

      await updateDoc(doc(db, "classes", classId), payload);
    } catch (e) {
      console.error("Failed to update class AI settings:", e);
      alert("Failed to update AI settings: " + e.message);
    }
  };

  const handleSaveGazeSettings = handleSaveAiSettings;

  const handleFaceDebounceChange = async (val) => {
    const num = parseInt(val, 10) || 3;
    setFaceDebounceSeconds(num);
    if (classId) {
      try {
        await updateDoc(doc(db, "classes", classId), { faceDebounceSeconds: num });
      } catch (e) {
        console.error("Failed to update faceDebounceSeconds:", e);
      }
    }
  };

  const handleEnableCloudFallbackChange = async (enabled) => {
    setEnableCloudFallback(enabled);
    if (classId) {
      try {
        await updateDoc(doc(db, "classes", classId), { enableCloudFallback: enabled });
      } catch (e) {
        console.error("Failed to update enableCloudFallback:", e);
      }
    }
  };

  const handleCloudFallbackRateChange = async (val) => {
    const num = parseInt(val, 10) || 3;
    setCloudFallbackRate(num);
    if (classId) {
      try {
        await updateDoc(doc(db, "classes", classId), { cloudFallbackRate: num });
      } catch (e) {
        console.error("Failed to update cloudFallbackRate:", e);
      }
    }
  };

  const pausedRef = useRef(isPaused);
  useEffect(() => { pausedRef.current = isPaused; }, [isPaused]);

  const screenshotsRef = useRef(screenshots);
  useEffect(() => { screenshotsRef.current = screenshots; }, [screenshots]);
  const urlCacheRef = useRef(new Map());
  const inFlightUrlPromisesRef = useRef(new Map());

  const getStorageDownloadUrl = useCallback(async (path) => {
    if (!path) return null;
    if (urlCacheRef.current.has(path)) {
      return urlCacheRef.current.get(path);
    }
    if (inFlightUrlPromisesRef.current.has(path)) {
      return inFlightUrlPromisesRef.current.get(path);
    }
    const promise = (async () => {
      try {
        const url = await getDownloadURL(ref(storage, path));
        urlCacheRef.current.set(path, url);
        return url;
      } catch (error) {
        console.error(`Error getting download URL for ${path}:`, error);
        return null;
      } finally {
        inFlightUrlPromisesRef.current.delete(path);
      }
    })();
    inFlightUrlPromisesRef.current.set(path, promise);
    return promise;
  }, []);

  const frameRateOptions = [1, 5, 10, 15, 20, 25, 30];
  const maxImageSizeOptions = [
    { label: '1MB', value: 1024 * 1024 },
    { label: '0.75MB', value: 0.75 * 1024 * 1024 },
    { label: '0.5MB', value: 0.5 * 1024 * 1024 },
    { label: '0.25MB', value: 0.25 * 1024 * 1024 },
    { label: '0.1MB', value: 0.1 * 1024 * 1024 }
  ];

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 2000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!classId) return;

    const classRef = doc(db, "classes", classId);
    const unsubscribeClass = onSnapshot(classRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        const studentUids = data.students ? Object.keys(data.students) : [];
        setClassList(studentUids);
        setClassEmergencyPin(data.teacherBypassPin || data.emergencyPasskeyPin || '');

        const newMap = new Map();
        if (data.students && typeof data.students === 'object' && !Array.isArray(data.students)) {
            Object.entries(data.students).forEach(([uid, email]) => {
                newMap.set(uid, email);
            });
        }
        setUidToEmailMap(newMap);
        
        const baseProfiles = data.studentProfiles || {};
        getDocs(collection(db, 'studentDirectory')).then(dirSnap => {
          const dirProfiles = {};
          if (dirSnap && typeof dirSnap.forEach === 'function') {
            dirSnap.forEach(d => {
              dirProfiles[d.id.trim().toLowerCase()] = d.data();
            });
          }
          setStudentProfiles({ ...dirProfiles, ...baseProfiles });
        }).catch(() => {
          setStudentProfiles(baseProfiles);
        });

        if (data.aiModel) {
          setSelectedAiModel(data.aiModel);
        }
        if (data.schedule) {
          setClassSchedule(data.schedule);
        }

        setFrameRate(prevRate => {
          const newRate = data.frameRate || 15;
          return newRate === prevRate ? prevRate : newRate;
        });
        if (data.samplingRate !== undefined) {
          const loadedSamplingRate = parseInt(data.samplingRate, 10) || 5;
          setSamplingRate(loadedSamplingRate);
        }
        setMaxImageSize(prevSize => {
          const newSize = data.maxImageSize || 0.1 * 1024 * 1024;
          return newSize === prevSize ? prevSize : newSize;
        });
        setIsCapturing(prev => {
          const serverCapturing = Boolean(data.isCapturing);
          if (prev && !serverCapturing) {
            setIsPerImageAnalysisRunning(false);
            setIsAllImagesAnalysisRunning(false);
          }
          return serverCapturing;
        });
        if (data.aiMonitoringMode !== undefined) {
          setAiMonitoringMode(data.aiMonitoringMode);
        }
        if (data.enableClientAi !== undefined) {
          setEnableClientAi(data.enableClientAi);
        }
        if (data.gazeSensitivity !== undefined) {
          setGazeSensitivity(data.gazeSensitivity);
        }
        if (data.customYawAngle !== undefined) {
          setCustomYawAngle(data.customYawAngle);
        }
        if (data.customPitchDownAngle !== undefined) {
          setCustomPitchDownAngle(data.customPitchDownAngle);
        }
        if (data.customPitchUpAngle !== undefined) {
          setCustomPitchUpAngle(data.customPitchUpAngle);
        }
        if (data.faceDebounceSeconds !== undefined) {
          setFaceDebounceSeconds(data.faceDebounceSeconds);
        }
        if (data.enableCloudFallback !== undefined) {
          setEnableCloudFallback(data.enableCloudFallback);
        }
        if (data.cloudFallbackRate !== undefined) {
          setCloudFallbackRate(data.cloudFallbackRate);
        }
        if (data.enableAudioCapture !== undefined) {
          setEnableAudioCapture(data.enableAudioCapture);
        }
        if (data.isExamActive !== undefined) {
          setIsExamActive(Boolean(data.isExamActive));
        }
        if (data.subjectDomain !== undefined) {
          setClassSubjectDomain(data.subjectDomain === 'Other (Custom)' && data.customSubjectDomain ? data.customSubjectDomain : data.subjectDomain);
        }
        if (data.subtitlePrompt !== undefined) {
          setClassSubtitlePrompt(data.subtitlePrompt);
        }
        if (data.defaultLectureRecording !== undefined) {
          setClassDefaultLectureRecording(Boolean(data.defaultLectureRecording));
        }

        const classCapture = data.captureMode || data.settings?.captureMode;
        if (classCapture !== undefined) {
          setCaptureMode(classCapture);
        }
        if (data.voiceAiMode !== undefined) {
          setVoiceAiMode(data.voiceAiMode);
        }
        if (data.speechLanguage !== undefined) {
          setSpeechLanguage(data.speechLanguage);
        }
        if (data.audioSegmentDuration !== undefined) {
          setAudioSegmentDuration(data.audioSegmentDuration);
        }
        if (data.audioMovingWindowStride !== undefined) {
          setAudioMovingWindowStride(data.audioMovingWindowStride);
        }
        if (data.audioSilenceSuppression !== undefined) {
          setAudioSilenceSuppression(data.audioSilenceSuppression);
        }
        if (data.vadSensitivity !== undefined) {
          setVadSensitivity(data.vadSensitivity);
        }
        if (data.voiceAiCloudFallbackRate !== undefined) {
          setVoiceAiCloudFallbackRate(data.voiceAiCloudFallbackRate);
        }
        if (data.liveAudioPrompt !== undefined) {
          setLiveAudioPrompt(data.liveAudioPrompt);
        }
        if (data.liveImagePrompt !== undefined) {
          setSelectedPrompt(data.liveImagePrompt);
          setEditablePromptText(data.liveImagePrompt?.promptText || '');
        }
        setStorageQuota(data.storageQuota || 0);
        setAiQuota(data.aiQuota || 0);
        setAiUsedQuota(data.aiUsedQuota || 0);
      } else {
        setClassList([]);
        setUidToEmailMap(new Map());
      }
    });

    const storageRef = doc(db, "classes", classId, "metadata", "storage");
    const unsubscribeStorage = onSnapshot(storageRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStorageUsage(data.storageUsage || 0);
        setStorageUsageScreenShots(data.storageUsageScreenShots || 0);
        setStorageUsageVideos(data.storageUsageVideos || 0);
        setStorageUsageAudio(data.storageUsageAudio || 0);
      }
    });

    const aiMetaRef = doc(db, "classes", classId, "metadata", "ai");
    const unsubscribeAiMeta = onSnapshot(aiMetaRef, (docSnap) => {
      if (docSnap.exists()) {
        setAiUsedQuota(docSnap.data().aiUsedQuota || 0);
      } else {
        setAiUsedQuota(0);
      }
    });

    const statusQuery = query(collection(db, 'classes', classId, 'status'));
    const unsubscribeStatus = onSnapshot(statusQuery, (snapshot) => {
      const statuses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      statuses.forEach(status => {
        if (status.email && status.id) {
          studentUidMap.current.set(status.email.toLowerCase(), status.id);
        }
      });

      const getTs = (obj) => {
        if (!obj?.timestamp) return 0;
        if (typeof obj.timestamp.toMillis === 'function') return obj.timestamp.toMillis();
        if (obj.timestamp.seconds) return obj.timestamp.seconds * 1000;
        if (obj.timestamp instanceof Date) return obj.timestamp.getTime();
        if (typeof obj.timestamp === 'number') return obj.timestamp;
        return 0;
      };

      const latestStatuses = Object.values(statuses.reduce((acc, curr) => {
        if (!curr.id) return acc; // Use UID as the key
        const existingTs = getTs(acc[curr.id]);
        const currentTs = getTs(curr);

        if (currentTs >= existingTs) {
          acc[curr.id] = curr;
        }
        return acc;
      }, {}));
      setStudentStatuses(latestStatuses);
      setUidToEmailMap(prev => {
        let changed = false;
        const updated = new Map(prev);
        latestStatuses.forEach(s => {
          if (s.id && s.email && !updated.has(s.id)) {
            updated.set(s.id, s.email);
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    });

    let unsubscribeBypass = () => {};
    try {
      const bypassQuery = query(
        collection(db, 'classes', classId, 'passkeyBypassRequests'),
        where('status', '==', 'pending')
      );
      unsubscribeBypass = onSnapshot(bypassQuery, (snapshot) => {
        const requests = [];
        const now = Date.now();
        const expiredToUpdate = [];

        if (snapshot && typeof snapshot.forEach === 'function') {
          snapshot.forEach((docSnap) => {
            const data = docSnap.data() || {};
            const id = docSnap.id;
            let expiresAt = data.expiresAtMillis;
            if (!expiresAt) {
              const reqTime = data.requestedAt?.toMillis ? data.requestedAt.toMillis()
                : (data.requestedAt?.seconds ? data.requestedAt.seconds * 1000
                : (data.requestedAt ? new Date(data.requestedAt).getTime() : 0));
              if (reqTime > 0) {
                expiresAt = reqTime + 15 * 60 * 1000;
              }
            }

            // Exclude already expired claims and mark them expired in Firestore
            if (expiresAt && expiresAt <= now) {
              expiredToUpdate.push(id);
            } else {
              requests.push({
                id,
                ...data,
                expiresAtMillis: expiresAt || (now + 15 * 60 * 1000),
              });
            }
          });
        }
        setPendingBypassRequests(requests);

        // Auto-mark expired in Firestore in the background so queries won't fetch them again
        if (expiredToUpdate.length > 0) {
          expiredToUpdate.forEach((expId) => {
            updateDoc(doc(db, 'classes', classId, 'passkeyBypassRequests', expId), {
              status: 'expired',
              expiredAt: serverTimestamp(),
            }).catch((err) => console.warn('[MonitorView] Could not expire request:', expId, err));
          });
        }
      }, (err) => {
        console.warn('[MonitorView] Bypass listener notice:', err);
      });
    } catch (e) {
      console.warn('[MonitorView] Error setting up bypass listener:', e);
    }

    return () => {
      unsubscribeClass();
      unsubscribeStorage();
      unsubscribeStatus();
      unsubscribeAiMeta();
      if (typeof unsubscribeBypass === 'function') unsubscribeBypass();
    };
  }, [classId]);

  const handleResolveBypass = async (requestId, studentUid, studentEmail, approved) => {
    if (!classId) return;
    // Optimistic removal from UI
    setPendingBypassRequests((prev) => prev.filter((r) => r.id !== requestId));
    try {
      const approveFn = httpsCallable(functions, 'approveTeacherPasskeyBypass');
      await approveFn({
        requestId,
        classId,
        studentUid,
        studentEmail,
        approved,
        bypassDurationMinutes: 180,
      });
    } catch (err) {
      console.error('[MonitorView] Error resolving bypass request:', err);
      // Fallback: If rejection fails on Cloud Function, directly mark request as rejected in Firestore
      if (!approved && requestId) {
        try {
          await updateDoc(doc(db, 'classes', classId, 'passkeyBypassRequests', requestId), {
            status: 'rejected',
            resolvedAt: serverTimestamp(),
            resolvedBy: auth.currentUser?.email || 'teacher',
          });
          return;
        } catch (innerErr) {
          console.warn('[MonitorView] Fallback reject also failed:', innerErr);
        }
      }
      alert('Failed to resolve passkey bypass: ' + (err.message || 'Error'));
    }
  };

  const handleDismissBypass = async (requestId) => {
    if (!classId || !requestId) return;
    setPendingBypassRequests((prev) => prev.filter((r) => r.id !== requestId));
    try {
      await updateDoc(doc(db, 'classes', classId, 'passkeyBypassRequests', requestId), {
        status: 'dismissed',
        dismissedAt: serverTimestamp(),
        dismissedBy: auth.currentUser?.email || 'teacher',
      });
    } catch (err) {
      console.error('[MonitorView] Error dismissing bypass request:', err);
    }
  };

  const handleDismissAllBypasses = async () => {
    if (!classId || activeBypassRequests.length === 0) return;
    const toDismiss = [...activeBypassRequests];
    setPendingBypassRequests([]);
    try {
      await Promise.all(
        toDismiss.map((req) =>
          updateDoc(doc(db, 'classes', classId, 'passkeyBypassRequests', req.id), {
            status: 'dismissed',
            dismissedAt: serverTimestamp(),
            dismissedBy: auth.currentUser?.email || 'teacher',
          })
        )
      );
    } catch (err) {
      console.error('[MonitorView] Error dismissing all bypass requests:', err);
    }
  };

  useEffect(() => {
    if (!reviewTime || classList.length === 0) return;

    let isCancelled = false;

    const fetchScreenshotsForReview = async () => {
      const reviewTimeDate = new Date(reviewTime);
      const studentTasks = classList.filter(Boolean);

      const resolveStudentReview = async (studentUid) => {
        try {
          const screenshotsQuery = query(
            collection(db, 'screenshots'),
            where('classId', '==', classId),
            where('studentUid', '==', studentUid),
            where('timestamp', '<=', reviewTimeDate),
            orderBy('timestamp', 'desc'),
            limit(6)
          );

          const snapshot = await getDocs(screenshotsQuery);
          if (snapshot.empty) return null;

          let screenItem = null;
          let webcamItem = null;

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const channel = data.channel || 'screen';
            if (channel === 'screen' && !screenItem) {
              const url = await getStorageDownloadUrl(data.imagePath);
              if (url) {
                screenItem = { url, timestamp: data.timestamp, imagePath: data.imagePath, channel: 'screen' };
              }
            } else if (channel === 'webcam' && !webcamItem) {
              const url = await getStorageDownloadUrl(data.imagePath);
              if (url) {
                webcamItem = { url, timestamp: data.timestamp, imagePath: data.imagePath, channel: 'webcam' };
              }
            }
            if (screenItem && webcamItem) break;
          }

          const primaryItem = screenItem || webcamItem;
          if (!primaryItem) return null;

          return {
            studentUid,
            entry: {
              screen: screenItem,
              webcam: webcamItem,
              url: primaryItem.url,
              timestamp: primaryItem.timestamp,
              imagePath: primaryItem.imagePath,
            },
          };
        } catch (e) {
          console.error(`Error fetching review screenshots for ${studentUid}:`, e);
          return null;
        }
      };

      const CONCURRENCY = 10;
      const newScreenshots = {};

      for (let i = 0; i < studentTasks.length; i += CONCURRENCY) {
        if (isCancelled) break;
        const chunk = studentTasks.slice(i, i + CONCURRENCY);
        const results = await Promise.all(chunk.map(resolveStudentReview));
        for (const res of results) {
          if (res?.studentUid && res?.entry) {
            newScreenshots[res.studentUid] = res.entry;
          }
        }
      }

      if (!isCancelled) {
        setScreenshots(newScreenshots);
      }
    };

    fetchScreenshotsForReview();

    return () => {
      isCancelled = true;
    };
  }, [reviewTime, classList, classId, getStorageDownloadUrl]);

  const students = useMemo(() => {
    const currentNow = now.getTime();
    const staleThresholdMs = Math.max(frameRate * 4, 45) * 1000;

    const getTs = (obj) => {
      if (!obj) return 0;
      const parseVal = (val) => {
        if (!val) return 0;
        if (typeof val.toMillis === 'function') return val.toMillis();
        if (val.seconds) return val.seconds * 1000;
        if (val instanceof Date) return val.getTime();
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = new Date(val).getTime();
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };
      const ts1 = parseVal(obj.timestamp);
      const ts2 = parseVal(obj.lastHeartbeat);
      const ts3 = parseVal(obj.lastAudioHeartbeat);
      return Math.max(ts1, ts2, ts3);
    };

    return classList.map(uid => {
      const status = studentStatuses.find(s => s.id === uid);
      const email = uidToEmailMap.get(uid) || (status ? status.email : '');
      const studentProfile = getStudentProfile(email, studentProfiles);
      const friendlyName = getStudentDisplayName({ email, name: status?.name }, studentProfiles);
      const statusTs = getTs(status);
      const isStatusFresh = reviewTime
        ? true
        : (statusTs > 0 && (currentNow - statusTs) <= staleThresholdMs);

      const isActuallySharing = Boolean(status && status.isSharing && isStatusFresh);

      return {
        id: uid,
        email: email,
        name: friendlyName,
        displayName: friendlyName,
        profile: studentProfile,
        studentClass: studentProfile.studentClass,
        programme: studentProfile.programme,
        isSharing: isActuallySharing,
        isWebcamSharing: isActuallySharing && Boolean(status.isWebcamSharing || (status.activeStreams && status.activeStreams.includes('webcam'))),
        isAudioSharing: isActuallySharing && Boolean(status.isAudioSharing || (status.activeStreams && status.activeStreams.includes('audio')) || status.isAudioRecording),
        audioStatus: isActuallySharing ? status?.audioStatus : null,
        audioLevel: isActuallySharing ? (status?.audioLevel || 0) : 0,
        audioError: status ? status.audioError : null,
        ...getStudentVoiceStatus(status),
        faceStatus: isActuallySharing ? status?.faceStatus : null,
        clientAiStatus: isActuallySharing ? status?.clientAiStatus : null,
        gemmaModelStatus: status?.gemmaModelStatus || 'not_loaded',
        gemmaEngine: status?.gemmaEngine || 'uninitialized',
        gemmaLoadingProgress: status?.gemmaLoadingProgress || 0,
        gemmaUnavailableReason: status?.gemmaUnavailableReason || '',
        yawAngle: isActuallySharing ? status?.yawAngle : null,
        pitchAngle: isActuallySharing ? status?.pitchAngle : null,
        isMultiSpeaker: isActuallySharing ? Boolean(status?.isMultiSpeaker) : false,
        speakerCount: isActuallySharing ? (status?.speakerCount || 1) : 1,
        activeViolation: isActuallySharing ? status?.activeViolation : null,
        lastHeartbeat: statusTs,
      };
    });
  }, [classList, studentStatuses, uidToEmailMap, studentProfiles, now, frameRate, reviewTime]);

  // Live screenshot URL resolution with bounded concurrency and in-flight deduplication
  useEffect(() => {
    if (reviewTime || studentStatuses.length === 0 || pausedRef.current) return;

    let isCancelled = false;

    const resolveAllStatuses = async () => {
      const currentNow = Date.now();
      const staleThresholdMs = Math.max(frameRate * 3, 30) * 1000;

      const getTs = (obj) => {
        if (!obj?.timestamp) return 0;
        if (typeof obj.timestamp.toMillis === 'function') return obj.timestamp.toMillis();
        if (obj.timestamp.seconds) return obj.timestamp.seconds * 1000;
        if (obj.timestamp instanceof Date) return obj.timestamp.getTime();
        if (typeof obj.timestamp === 'number') return obj.timestamp;
        return 0;
      };

      const studentTasks = studentStatuses.filter(
        (s) => s?.id && (s.latestScreenPath || s.latestImagePath || s.latestWebcamPath)
      );

      const resolveStudent = async (status) => {
        const studentUid = status.id;
        const statusTs = getTs(status);
        const isFresh = (currentNow - statusTs) <= staleThresholdMs;
        const isActivelySharing = Boolean(status.isSharing && isFresh);

        const screenPath = status.latestScreenPath || status.latestImagePath;
        const webcamPath = status.latestWebcamPath;

        const [resolvedScreenUrl, resolvedWebcamUrl] = await Promise.all([
          screenPath ? getStorageDownloadUrl(screenPath) : Promise.resolve(null),
          webcamPath ? getStorageDownloadUrl(webcamPath) : Promise.resolve(null),
        ]);

        const primaryUrl = resolvedScreenUrl || resolvedWebcamUrl;
        const primaryPath = screenPath || webcamPath;

        return {
          studentUid,
          entry: {
            screen: resolvedScreenUrl
              ? {
                  url: resolvedScreenUrl,
                  timestamp: status.timestamp,
                  imagePath: screenPath,
                  isLive: isActivelySharing,
                }
              : null,
            webcam: resolvedWebcamUrl
              ? {
                  url: resolvedWebcamUrl,
                  timestamp: status.timestamp,
                  imagePath: webcamPath,
                  isLive: isActivelySharing,
                }
              : null,
            url: primaryUrl,
            timestamp: status.timestamp,
            imagePath: primaryPath,
            isLive: isActivelySharing,
          },
        };
      };

      const CONCURRENCY = 10;
      const resolvedEntries = [];

      for (let i = 0; i < studentTasks.length; i += CONCURRENCY) {
        if (isCancelled) break;
        const chunk = studentTasks.slice(i, i + CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(resolveStudent));
        resolvedEntries.push(...chunkResults);
      }

      if (!isCancelled) {
        setScreenshots((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const item of resolvedEntries) {
            if (item?.studentUid && item?.entry?.url) {
              const currentItem = next[item.studentUid];
              if (
                !currentItem ||
                currentItem.url !== item.entry.url ||
                currentItem.imagePath !== item.entry.imagePath ||
                currentItem.isLive !== item.entry.isLive
              ) {
                next[item.studentUid] = item.entry;
                changed = true;
              }
            }
          }
          return changed ? next : prev;
        });
      }
    };

    resolveAllStatuses();

    return () => {
      isCancelled = true;
    };
  }, [studentStatuses, reviewTime, isPaused, frameRate, getStorageDownloadUrl]);

  // Decoupled Per-Image AI Analysis Effect
  useEffect(() => {
    if (!isCapturing || !isPerImageAnalysisRunning || isPaused || reviewTime || studentStatuses.length === 0) return;

    const currentNow = Date.now();
    const staleThresholdMs = Math.max(frameRate * 3, 30) * 1000;
    const minIntervalMs = (Number(samplingRate) || 5) * (Number(frameRate) || 15) * 1000;

    const getTs = (obj) => {
      if (!obj?.timestamp) return 0;
      if (typeof obj.timestamp.toMillis === 'function') return obj.timestamp.toMillis();
      if (obj.timestamp.seconds) return obj.timestamp.seconds * 1000;
      if (obj.timestamp instanceof Date) return obj.timestamp.getTime();
      if (typeof obj.timestamp === 'number') return obj.timestamp;
      return 0;
    };

    for (const status of studentStatuses) {
      const studentUid = status?.id;
      if (!studentUid) continue;

      const statusTs = getTs(status);
      const isFresh = (currentNow - statusTs) <= staleThresholdMs;
      const isActivelySharing = Boolean(status.isSharing && isFresh);
      const primaryPath = status.latestScreenPath || status.latestImagePath || status.latestWebcamPath;
      const studentScreenshot = screenshots[studentUid];
      const primaryUrl = studentScreenshot?.url;

      if (isActivelySharing && primaryUrl && primaryPath) {
        const lastAnalysis = lastAnalyzedPathMapRef.current.get(studentUid);
        const isSameImage = lastAnalysis && lastAnalysis.imagePath === primaryPath;
        const isCoolingDown = lastAnalysis && (currentNow - lastAnalysis.timestamp) < minIntervalMs;
        const isInFlight = activeAnalysisInFlightRef.current.has(studentUid);

        // Deduplication Guard: Never analyze the exact same screenshot twice, enforce cooldown & prevent overlapping calls
        if (!isSameImage && !isCoolingDown && !isInFlight) {
          const studentEmail = uidToEmailMap.get(studentUid) || status.email;
          lastAnalyzedPathMapRef.current.set(studentUid, { imagePath: primaryPath, timestamp: Date.now() });
          activeAnalysisInFlightRef.current.add(studentUid);

          const promptToUse = (editablePromptText || selectedPrompt?.promptText || '').trim();
          if (promptToUse) {
            runPerImageAnalysis({ [studentUid]: { url: primaryUrl, email: studentEmail } }, promptToUse, selectedAiModel)
              .catch((err) => {
                console.error(`[MonitorView] Error during per-image analysis for ${studentEmail}:`, err);
              })
              .finally(() => {
                activeAnalysisInFlightRef.current.delete(studentUid);
              });
          } else {
            activeAnalysisInFlightRef.current.delete(studentUid);
          }
        }
      }
    }
  }, [isCapturing, studentStatuses, screenshots, isPerImageAnalysisRunning, isPaused, reviewTime, frameRate, samplingRate, editablePromptText, selectedPrompt, selectedAiModel, uidToEmailMap, runPerImageAnalysis]);

  useEffect(() => {
    if (!isCapturing || !isAllImagesAnalysisRunning) {
      lastAllImagesRunTimeRef.current = 0;
      return;
    }

    const promptToUse = (editablePromptText || selectedPrompt?.promptText || '').trim();
    if (!promptToUse) {
      console.warn('[MonitorView] Cannot run all-images analysis without a prompt.');
      return;
    }

    const intervalMs = (Number(samplingRate) || 5) * (Number(frameRate) || 15) * 1000;

    const performAllImagesAnalysis = () => {
      const now = Date.now();
      // Strict Interval Guard: Ensure full sampling interval has elapsed before next analysis
      if (lastAllImagesRunTimeRef.current > 0 && (now - lastAllImagesRunTimeRef.current) < (intervalMs - 500)) {
        return;
      }

      const screenshotsToAnalyze = {};
      let hasNewImages = false;

      for (const student of students) {
        // Skip students who are not actively sharing their screen to prevent analyzing stale images and wasting AI tokens
        if (!student.isSharing) {
          lastAllImagesPathsRef.current.delete(student.id);
          continue;
        }

        const studentScreenshot = screenshotsRef.current[student.id];
        const studentUrl = studentScreenshot?.url || studentScreenshot?.screen?.url;
        const studentPath = studentScreenshot?.imagePath || studentScreenshot?.screen?.imagePath;

        if (studentUrl && studentPath) {
          screenshotsToAnalyze[student.id] = { url: studentUrl, email: student.email };
          const previousPath = lastAllImagesPathsRef.current.get(student.id);
          if (previousPath !== studentPath) {
            hasNewImages = true;
          }
        }
      }

      // Deduplication Guard: Only trigger Gemini when new images have arrived across the class
      if (Object.keys(screenshotsToAnalyze).length > 0 && hasNewImages) {
        lastAllImagesRunTimeRef.current = now;
        for (const [sId] of Object.entries(screenshotsToAnalyze)) {
          const sPath = screenshotsRef.current[sId]?.imagePath || screenshotsRef.current[sId]?.screen?.imagePath;
          if (sPath) lastAllImagesPathsRef.current.set(sId, sPath);
        }
        console.log(`[MonitorView] Triggering all-images analysis (${Object.keys(screenshotsToAnalyze).length} screens, interval: every ${samplingRate} rounds / ${intervalMs / 1000}s) using model:`, selectedAiModel);
        runAllImagesAnalysis(screenshotsToAnalyze, promptToUse, selectedAiModel);
      }
    };

    // Run initially once on toggle on
    if (lastAllImagesRunTimeRef.current === 0) {
      performAllImagesAnalysis();
    }

    const intervalId = setInterval(performAllImagesAnalysis, 1000);

    return () => clearInterval(intervalId);
  }, [isCapturing, isAllImagesAnalysisRunning, samplingRate, frameRate, runAllImagesAnalysis, students, editablePromptText, selectedPrompt, selectedAiModel]);

  const handleSendMessage = async (customText = null) => {
    const textToSend = typeof customText === 'string' ? customText : message;
    if (!textToSend.trim()) return;

    const senderUid = auth.currentUser?.uid;
    if (!senderUid) {
      alert("Could not send message: user not authenticated.");
      return;
    }

    try {
      // Optimized: 1 single Firestore write to class-wide messages stream
      const classMessagesRef = collection(db, 'classes', classId, 'messages');
      await addDoc(classMessagesRef, {
        message: textToSend.trim(),
        timestamp: serverTimestamp(),
        senderUid: senderUid,
        senderEmail: auth.currentUser?.email || '',
        classId: classId,
      });

      setMessage('');
      alert("📢 Broadcast message sent to the class!");
    } catch (error) {
      console.error("Error sending class broadcast message: ", error);
      alert("An error occurred while sending the message.");
    }
  };

  const handleBroadcastPreloadAi = useCallback(async () => {
    if (!classId) return;
    try {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, {
        preloadClientAi: serverTimestamp(),
      });
    } catch (err) {
      console.error('Error broadcasting preloadClientAi:', err);
    }
  }, [classId]);

  const handleToggleExamMode = useCallback(async () => {
    if (!classId) return;
    try {
      const classRef = doc(db, 'classes', classId);
      const nextState = !isExamActive;
      await updateDoc(classRef, {
        isExamActive: nextState,
        examActiveUpdatedAt: serverTimestamp(),
      });
      setIsExamActive(nextState);
    } catch (err) {
      console.error('Error toggling exam mode:', err);
      alert(`Could not update Exam Mode: ${err.message}`);
    }
  }, [classId, isExamActive]);

  const handleDownloadAttendance = async () => {
    const uidToStatusMap = new Map(studentStatuses.map(status => [status.id, status]));

    const headers = [
      'Student Name',
      'Student Email',
      'Class / Cohort',
      'Programme',
      'Student UID',
      'Sharing Screen',
      'Webcam Sharing',
      'Audio Sharing',
      'Face / Gaze Status',
      'Active Violation',
      'Last Activity Time'
    ];

    const rows = classList.map(uid => {
      const status = uidToStatusMap.get(uid);
      const isEmailUid = typeof uid === 'string' && uid.includes('@');
      const email = uidToEmailMap.get(uid) || status?.email || status?.studentEmail || status?.userEmail || (isEmailUid ? uid : '');
      const prof = getStudentProfile(email || uid, studentProfiles);
      const displayName = status?.displayName || status?.studentName || prof.studentName || getStudentDisplayName(email || uid, studentProfiles);
      const studentClass = prof.studentClass || status?.studentClass || status?.cohort || '';
      const programme = prof.programme || status?.programme || '';

      const isSharing = status ? Boolean(status.isSharing) : false;
      const isWebcamSharing = status ? Boolean(status.isWebcamSharing || (status.activeStreams && status.activeStreams.includes('webcam'))) : false;
      const isAudioSharing = status ? Boolean(status.isAudioSharing || (status.activeStreams && status.activeStreams.includes('audio')) || status.isAudioRecording) : false;
      const faceStatus = status?.faceStatus || 'normal';
      const activeViolation = status?.activeViolation || 'None';

      let lastActivityTime = 'N/A';
      if (status?.timestamp instanceof Date) {
        lastActivityTime = status.timestamp.toISOString();
      } else if (typeof status?.timestamp === 'number' && status.timestamp > 0) {
        lastActivityTime = new Date(status.timestamp).toISOString();
      } else if (status?.lastHeartbeat) {
        lastActivityTime = new Date(status.lastHeartbeat).toISOString();
      }

      return [
        displayName,
        email || prof.email || (isEmailUid ? uid : ''),
        studentClass,
        programme,
        uid,
        isSharing ? 'Yes' : 'No',
        isWebcamSharing ? 'Yes' : 'No',
        isAudioSharing ? 'Yes' : 'No',
        faceStatus,
        activeViolation,
        lastActivityTime
      ];
    });

    const now = new Date();
    const timeString = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`;
    await exportToExcel(headers, rows, `${classId}_attendance_${timeString}.xlsx`);
  };

  const handleFrameRateChange = useCallback(async (e) => {
    const newRate = parseInt(e.target.value, 10);
    const oldRate = frameRate;
    setFrameRate(newRate); // Optimistic update
    if (classId) {
      try {
        const classRef = doc(db, 'classes', classId);
        await updateDoc(classRef, { frameRate: newRate });
      } catch (error) {
        console.error("Error updating frame rate:", error);
        setFrameRate(oldRate); // Revert on error
        alert("Failed to update frame rate. Please try again.");
      }
    }
  }, [classId, frameRate]);

  const handleMaxImageSizeChange = async (e) => {
    const newSize = parseFloat(e.target.value);
    if (classId) {
      try {
        const classRef = doc(db, 'classes', classId);
        await updateDoc(classRef, { maxImageSize: newSize });
      } catch (error) {
        console.error("Error updating max image size:", error);
        alert("Failed to update max image size. Please try again.");
      }
    }
  };

  const toggleCapture = useCallback(async () => {
    if (!classId) return;
    const newIsCapturing = !isCapturing;
    setIsCapturing(newIsCapturing); // Optimistic update
    try {
      const classRef = doc(db, 'classes', classId);
      await updateDoc(classRef, {
        isCapturing: newIsCapturing,
        captureStartedAt: newIsCapturing ? serverTimestamp() : null
      });

      if (!newIsCapturing) {
        setIsPerImageAnalysisRunning(false);
        setIsAllImagesAnalysisRunning(false);
        // Teacher stopped capture: immediately clean up active bingo and pending retries
        try {
          const cancelFn = httpsCallable(functions, 'cancelActiveBingo');
          await cancelFn({ classId });
        } catch (cancelErr) {
          console.warn('[MonitorView] Note: could not auto-cancel active bingo on capture stop:', cancelErr);
        }
      }
    } catch (error) {
      console.error("Error toggling capture:", error);
      setIsCapturing(!newIsCapturing); // Revert on error
      alert("Failed to update capture status. Please try again.");
    }
  }, [classId, isCapturing]);

  const handleStudentClick = (student) => {
    setSelectedStudent(student);
  };

  const notSharingStudents = useMemo(() => {
    return students
      .filter(s => !s.isSharing)
      .map(s => {
        const rawDisplayName = s.displayName;
        const displayName = rawDisplayName && rawDisplayName !== 'Unknown Student'
          ? rawDisplayName
          : (s.email || (s.id ? `Student (${s.id.slice(0, 8)})` : 'Unknown Student'));
        return {
          ...s,
          displayName,
          name: displayName,
          studentClass: s.studentClass || s.profile?.studentClass || '',
          programme: s.programme || s.profile?.programme || '',
        };
      });
  }, [students]);

  const sortedNotSharingStudents = useMemo(() => {
    let list = [...notSharingStudents];

    if (notSharingSearchQuery.trim()) {
      const q = notSharingSearchQuery.trim().toLowerCase();
      list = list.filter(s =>
        (s.displayName || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q) ||
        (s.studentClass || '').toLowerCase().includes(q) ||
        (s.programme || '').toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let valA = '';
      let valB = '';

      if (notSharingSortBy === 'name') {
        valA = (a.displayName || a.name || a.email || '').toLowerCase();
        valB = (b.displayName || b.name || b.email || '').toLowerCase();
      } else if (notSharingSortBy === 'email') {
        valA = (a.email || '').toLowerCase();
        valB = (b.email || '').toLowerCase();
      } else if (notSharingSortBy === 'studentClass') {
        valA = `${a.studentClass || ''} ${a.programme || ''}`.trim().toLowerCase();
        valB = `${b.studentClass || ''} ${b.programme || ''}`.trim().toLowerCase();
      }

      const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
      return notSharingSortDirection === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [notSharingStudents, notSharingSortBy, notSharingSortDirection, notSharingSearchQuery]);

  const liveSelectedStudent = selectedStudent
    ? students.find(student => student.id === selectedStudent.id) || selectedStudent
    : null;
  const selectedScreenshotUrl = liveSelectedStudent && screenshots[liveSelectedStudent.id]
    ? screenshots[liveSelectedStudent.id].url
    : null;

  const classComplianceSettings = useMemo(() => ({
    captureMode: captureMode || 'dual',
    enableAudioCapture: enableAudioCapture,
    isCapturing: isCapturing,
  }), [captureMode, enableAudioCapture, isCapturing]);

  const complianceSummary = useMemo(() => {
    return getComplianceSummary(students, classComplianceSettings, screenshots);
  }, [students, classComplianceSettings, screenshots]);

  const filteredStudents = useMemo(() => {
    return filterStudentsByCompliance(students, problemFilter, classComplianceSettings, screenshots);
  }, [students, problemFilter, classComplianceSettings, screenshots]);

  // Base list of students sorted alphabetically for live monitoring
  const sortedLiveStudents = useMemo(() => {
    return filteredStudents.slice().sort((a, b) => (a.email || '').localeCompare(b.email || ''));
  }, [filteredStudents]);

  // Base list of students for review mode
  const reviewStudents = useMemo(() => {
    if (!reviewTime) return [];
    return classList.slice().sort((a, b) => a.localeCompare(b)).map((studentUid) => {
      const email = uidToEmailMap.get(studentUid) || studentUid;
      const existingStudent = students.find((s) => s.id === studentUid);
      return existingStudent || { id: studentUid, email, isSharing: !!screenshots[studentUid] };
    });
  }, [reviewTime, classList, uidToEmailMap, students, screenshots]);

  const currentBaseStudents = reviewTime ? reviewStudents : sortedLiveStudents;

  const getItemsPerRow = useCallback(() => {
    if (!studentsGridRef.current) return 4;
    const container = studentsGridRef.current.querySelector('.students-container');
    if (!container) return 4;

    try {
      const computed = window.getComputedStyle(container).getPropertyValue('grid-template-columns');
      if (computed && computed !== 'none') {
        const cols = computed.trim().split(/\s+/).length;
        if (cols > 0) return cols;
      }
    } catch {}

    const cards = Array.from(container.children).filter(c => !c.classList.contains('empty-filter-state'));
    if (cards.length > 0) {
      const firstTop = cards[0].offsetTop;
      const count = cards.filter(c => c.offsetTop === firstTop).length;
      if (count > 0) return count;
    }

    const width = container.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 1200);
    return Math.max(1, Math.floor((width + 24) / 324));
  }, []);

  // Dynamically update column count when window resizes or show/hide controls toggles
  useEffect(() => {
    const updateCols = () => {
      const cols = getItemsPerRow();
      setGridColumns(cols);
    };

    updateCols();

    let resizeObserver;
    if (typeof ResizeObserver !== 'undefined' && studentsGridRef.current) {
      resizeObserver = new ResizeObserver(() => {
        updateCols();
      });
      resizeObserver.observe(studentsGridRef.current);
    }

    window.addEventListener('resize', updateCols);

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      window.removeEventListener('resize', updateCols);
    };
  }, [getItemsPerRow, showControls]);

  // Compute student list with auto-rolling rows (reordering student cards without window scrolling)
  const rolledStudents = useMemo(() => {
    if (!currentBaseStudents || currentBaseStudents.length === 0) return [];
    if (autoRollSpeed === 'off' || rollRowIndex === 0) return currentBaseStudents;

    const cols = gridColumns || getItemsPerRow();
    const totalRows = Math.ceil(currentBaseStudents.length / cols);
    if (totalRows <= 2) return currentBaseStudents;

    const validRowIndex = rollRowIndex % totalRows;
    const startIndex = validRowIndex * cols;
    if (startIndex >= currentBaseStudents.length) return currentBaseStudents;

    return [
      ...currentBaseStudents.slice(startIndex),
      ...currentBaseStudents.slice(0, startIndex),
    ];
  }, [currentBaseStudents, autoRollSpeed, rollRowIndex, gridColumns, getItemsPerRow]);

  // Auto-rolling rows timer: increments row offset by reordering cards without page scrolling
  useEffect(() => {
    const config = parseAutoRollConfig(autoRollSpeed);
    if (!config) {
      setRollRowIndex(0);
      return;
    }

    const isModalOpen = Boolean(
      selectedStudent ||
      showBroadcastModal ||
      showNotSharingModal ||
      showPromptModal ||
      showBingoModal ||
      showLectureQrModal ||
      showRecordingsModal ||
      showAnalysisResultsModal
    );

    if (isGridHovered || isModalOpen) {
      return;
    }

    const intervalId = setInterval(() => {
      const cols = gridColumns || getItemsPerRow();
      setRollRowIndex((prev) => {
        const totalCount = currentBaseStudents.length;
        if (totalCount === 0) return 0;
        const totalRows = Math.ceil(totalCount / cols);
        if (totalRows <= 2) {
          return 0; // All rows already visible on screen without rolling
        }
        return (prev + config.stepRows) % totalRows;
      });
    }, config.intervalMs);

    return () => clearInterval(intervalId);
  }, [
    autoRollSpeed,
    isGridHovered,
    selectedStudent,
    showBroadcastModal,
    showNotSharingModal,
    showPromptModal,
    showBingoModal,
    showLectureQrModal,
    showRecordingsModal,
    showAnalysisResultsModal,
    currentBaseStudents.length,
    gridColumns,
    getItemsPerRow,
  ]);

  useEffect(() => {
    setRollRowIndex(0);
  }, [problemFilter, selectedLesson, autoRollSpeed, showControls, gridColumns]);

  const handleNudgeProblemStudents = async () => {
    const count = filteredStudents.length;
    if (count === 0) return;
    const nudgeMsg = getNudgeMessageForFilter(problemFilter);
    const confirmed = window.confirm(`📢 Send invigilation reminder to ${count} filtered student(s)?\n\n"${nudgeMsg}"`);
    if (confirmed) {
      await handleSendMessage(nudgeMsg);
    }
  };

  const handleExportFilteredCsv = async () => {
    if (filteredStudents.length === 0) {
      alert('No students in the current filter to export.');
      return;
    }
    await exportComplianceResultsToExcel(filteredStudents, problemFilter, classComplianceSettings, screenshots, classId);
  };

  const handleRunAnalysis = async (overridePromptText, overrideModel) => {
    const promptToUse = (overridePromptText !== undefined ? overridePromptText : (editablePromptText || selectedPrompt?.promptText)) || '';
    const modelToUse = overrideModel || selectedAiModel || 'gemini-3.5-flash-lite';

    if (!promptToUse.trim()) {
      alert('Please select or enter a prompt.');
      return;
    }

    const screenshotsToAnalyze = {};
    if (reviewTime) {
      for (const studentId in screenshots) {
        const student = students.find(s => s.id === studentId);
        if (student && screenshots[studentId]?.url) {
          screenshotsToAnalyze[studentId] = {
            url: screenshots[studentId].url,
            email: student.email,
            imagePath: screenshots[studentId].imagePath
          };
        }
      }
    } else {
      // Only include students who are actively sharing their screen. Non-sharing students are strictly skipped to avoid wasting tokens on stale images.
      for (const student of students) {
        if (student.isSharing && screenshots[student.id]?.url) {
          screenshotsToAnalyze[student.id] = {
            url: screenshots[student.id].url,
            email: student.email,
            imagePath: screenshots[student.id].imagePath
          };
        }
      }
    }

    if (Object.keys(screenshotsToAnalyze).length === 0) {
      alert('No students are currently sharing their screen. Analysis skipped to avoid analyzing stale images and wasting AI tokens.');
      return;
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
    await runPerImageAnalysis(screenshotsToAnalyze, promptToUse, modelToUse);
  };

  const handleRunAllImagesAnalysis = async (overridePromptText, overrideModel) => {
    const promptToUse = (overridePromptText !== undefined ? overridePromptText : (editablePromptText || selectedPrompt?.promptText)) || '';
    const modelToUse = overrideModel || selectedAiModel || 'gemini-3.5-flash-lite';

    if (!promptToUse.trim()) {
      alert('Please select or enter a prompt.');
      return;
    }

    const screenshotsToAnalyze = {};
    if (reviewTime) {
      for (const studentId in screenshots) {
        const student = students.find(s => s.id === studentId);
        if (student && screenshots[studentId]?.url) {
          screenshotsToAnalyze[studentId] = {
            url: screenshots[studentId].url,
            email: student.email,
            imagePath: screenshots[studentId].imagePath
          };
        }
      }
    } else {
      // Only include students who are actively sharing their screen. Non-sharing students are strictly skipped to avoid wasting tokens on stale images.
      for (const student of students) {
        if (student.isSharing && screenshots[student.id]?.url) {
          screenshotsToAnalyze[student.id] = {
            url: screenshots[student.id].url,
            email: student.email,
            imagePath: screenshots[student.id].imagePath
          };
        }
      }
    }

    if (Object.keys(screenshotsToAnalyze).length === 0) {
      alert('No students are currently sharing their screen. Analysis skipped to avoid analyzing stale images and wasting AI tokens.');
      return;
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
    await runAllImagesAnalysis(screenshotsToAnalyze, promptToUse, modelToUse);
  };

  const displayTime = timelineScrubTime ?? (reviewTime ? new Date(reviewTime).getTime() : now.getTime());

  const analysisResultItems = useMemo(() => 
    Object.entries(analysisResults || {}).map(([studentId, result]) => {
      const studentObj = students.find(s => s.id === studentId);
      const email = studentObj?.email || uidToEmailMap.get(studentId) || studentId;
      const displayName = studentObj?.displayName || getStudentDisplayName(email, studentProfiles);
      
      let textContent = '';
      let isError = false;

      if (typeof result === 'string') {
        textContent = result;
        isError = result.startsWith('Error:');
      } else if (result && typeof result === 'object') {
        if (result.error) {
          textContent = `Error: ${result.error}`;
          isError = true;
        } else {
          textContent = result.text || result.result || JSON.stringify(result, null, 2);
        }
      } else {
        textContent = String(result ?? '');
      }

      return (
        <li key={studentId} style={{ marginBottom: '16px', paddingBottom: '12px', borderBottom: '1px solid #e0e0e0', listStyle: 'none' }}>
          <strong style={{ display: 'block', marginBottom: '4px', color: '#1976d2', fontSize: '1.05em' }}>
            {displayName}
          </strong>
          {displayName !== email && (
            <div style={{ fontSize: '0.8em', color: '#666', marginBottom: '6px' }}>{email}</div>
          )}
          <div style={{ color: isError ? '#d32f2f' : '#2c3e50', whiteSpace: 'pre-wrap', lineHeight: '1.6', background: isError ? '#ffebee' : '#f8f9fa', padding: '10px 14px', borderRadius: '6px' }}>
            {textContent}
          </div>
        </li>
      );
    }), [analysisResults, uidToEmailMap, students, studentProfiles]);

  const handleAudioCaptureToggle = async (enabled) => {
    setEnableAudioCapture(enabled);
    if (!classId) return;
    try {
      const classRef = doc(db, "classes", classId);
      await updateDoc(classRef, { enableAudioCapture: enabled });
    } catch (err) {
      console.error("Failed to update audio capture setting:", err);
    }
  };

  const handleCaptureModeChange = async (newMode) => {
    setCaptureMode(newMode);
    if (!classId) return;
    try {
      const classRef = doc(db, "classes", classId);
      await updateDoc(classRef, { captureMode: newMode });
    } catch (err) {
      console.error("Failed to update class captureMode setting:", err);
    }
  };

  return (
    <div className="monitor-view">
      {showControls && <ControlsPanel
        message={message}
        setMessage={setMessage}
        handleSendMessage={handleSendMessage}
        setShowControls={setShowControls}
        frameRate={frameRate}
        handleFrameRateChange={handleFrameRateChange}
        frameRateOptions={frameRateOptions}
        maxImageSize={maxImageSize}
        handleMaxImageSizeChange={handleMaxImageSizeChange}
        maxImageSizeOptions={maxImageSizeOptions}
        captureMode={captureMode}
        handleCaptureModeChange={handleCaptureModeChange}
        selectedChannel={selectedChannel}
        setSelectedChannel={setSelectedChannel}
        isCapturing={isCapturing}
        toggleCapture={toggleCapture}
        isPaused={isPaused}
        setIsPaused={setIsPaused}
        isExamActive={isExamActive}
        handleToggleExamMode={handleToggleExamMode}
        setShowPromptModal={setShowPromptModal}
        notSharingStudents={notSharingStudents}
        setShowNotSharingModal={setShowNotSharingModal}
        handleDownloadAttendance={handleDownloadAttendance}
        editablePromptText={editablePromptText}
        isPerImageAnalysisRunning={isPerImageAnalysisRunning}
        isAllImagesAnalysisRunning={isAllImagesAnalysisRunning}
        setIsPerImageAnalysisRunning={setIsPerImageAnalysisRunning}
        setIsAllImagesAnalysisRunning={setIsAllImagesAnalysisRunning}
        samplingRate={samplingRate}
        setSamplingRate={setSamplingRate}
        storageUsage={storageUsage}
        storageQuota={storageQuota}
        storageUsageScreenShots={storageUsageScreenShots}
        storageUsageVideos={storageUsageVideos}
        storageUsageZips={storageUsageZips}
        storageUsageAudio={storageUsageAudio}
        aiQuota={aiQuota}
        aiUsedQuota={aiUsedQuota}
        selectedAiModel={selectedAiModel}
        handleAiModelChange={handleAiModelChange}
        enableAudioCapture={enableAudioCapture}
        handleAudioCaptureToggle={handleAudioCaptureToggle}
        aiMonitoringMode={aiMonitoringMode}
        enableClientAi={enableClientAi}
        gazeSensitivity={gazeSensitivity}
        customYawAngle={customYawAngle}
        customPitchDownAngle={customPitchDownAngle}
        customPitchUpAngle={customPitchUpAngle}
        faceDebounceSeconds={faceDebounceSeconds}
        handleFaceDebounceChange={handleFaceDebounceChange}
        enableCloudFallback={enableCloudFallback}
        handleEnableCloudFallbackChange={handleEnableCloudFallbackChange}
        cloudFallbackRate={cloudFallbackRate}
        handleCloudFallbackRateChange={handleCloudFallbackRateChange}
        voiceAiMode={voiceAiMode}
        speechLanguage={speechLanguage}
        audioSegmentDuration={audioSegmentDuration}
        audioMovingWindowStride={audioMovingWindowStride}
        audioSilenceSuppression={audioSilenceSuppression}
        vadSensitivity={vadSensitivity}
        voiceAiCloudFallbackRate={voiceAiCloudFallbackRate}
        liveAudioPrompt={liveAudioPrompt}
        liveImagePrompt={selectedPrompt}
        audioPrompts={audioPrompts}
        handleSaveAiSettings={handleSaveAiSettings}
        handleSaveGazeSettings={handleSaveGazeSettings}
        handleBroadcastPreloadAi={handleBroadcastPreloadAi}
        classId={classId}
        prompts={prompts}
        selectedPrompt={selectedPrompt}
        setSelectedPrompt={setSelectedPrompt}
        promptFilter={promptFilter}
        setPromptFilter={setPromptFilter}
        filteredPrompts={filteredPrompts}
        setEditablePromptText={setEditablePromptText}
        handleRunAnalysis={handleRunAnalysis}
        handleRunAllImagesAnalysis={handleRunAllImagesAnalysis}
        isAnalyzing={isAnalyzing}
        onOpenBingoModal={() => setShowBingoModal(true)}
        onOpenLectureQrModal={() => setShowLectureQrModal(true)}
      />}

      <div className="monitor-main-content" style={{ flexGrow: 1 }}>
        {activeBypassRequests.length > 0 && (
          <div className="passkey-bypass-podium-banner" role="alert" style={{
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
            border: '1px solid #6366f1',
            borderRadius: '10px',
            padding: '12px 18px',
            margin: '15px 20px 0 20px',
            color: '#ffffff',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '0.92rem', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  ⚠️ Passkey Bypass Claims ({activeBypassRequests.length} Active &bull; 15m Auto-Expire)
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                {classEmergencyPin && (
                  <span style={{ background: 'rgba(255, 255, 255, 0.1)', padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem', color: '#c7d2fe' }}>
                    🔑 Teacher Aisle PIN: <strong style={{ color: '#ffffff', letterSpacing: '1px' }}>{classEmergencyPin}</strong>
                  </span>
                )}
                <button
                  type="button"
                  onClick={handleDismissAllBypasses}
                  className="dismiss-all-bypass-btn"
                  title="Dismiss all pending bypass claims"
                  style={{
                    background: 'rgba(239, 68, 68, 0.25)',
                    border: '1px solid rgba(239, 68, 68, 0.5)',
                    color: '#fca5a5',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.15s ease',
                  }}
                >
                  ✕ Dismiss All
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {activeBypassRequests.map((req) => {
                const expiry = req.expiresAtMillis || 0;
                const remainingSec = Math.max(0, Math.floor((expiry - bypassTickerTime) / 1000));
                const remainingMin = Math.floor(remainingSec / 60);
                const secPart = remainingSec % 60;
                const timeBadgeText = `${remainingMin}m ${secPart < 10 ? '0' : ''}${secPart}s left`;
                const isUrgent = remainingMin < 3;

                return (
                  <div key={req.id} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(15, 23, 42, 0.65)',
                    borderRadius: '8px',
                    padding: '8px 14px',
                    flexWrap: 'wrap',
                    gap: '10px',
                    border: isUrgent ? '1px solid rgba(245, 158, 11, 0.45)' : '1px solid transparent',
                  }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <strong style={{ color: '#38bdf8', fontSize: '0.9rem' }}>{req.studentEmail}</strong>
                        <span style={{ color: '#94a3b8', fontSize: '0.82rem' }}>({req.deskNumber || 'Lab PC'})</span>
                        <span style={{
                          background: isUrgent ? 'rgba(239, 68, 68, 0.25)' : 'rgba(245, 158, 11, 0.2)',
                          color: isUrgent ? '#fca5a5' : '#fcd34d',
                          border: isUrgent ? '1px solid rgba(239, 68, 68, 0.45)' : '1px solid rgba(245, 158, 11, 0.4)',
                          padding: '1px 7px',
                          borderRadius: '12px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '3px',
                        }}>
                          ⏳ {timeBadgeText}
                        </span>
                      </div>
                      <div style={{ color: '#cbd5e1', fontSize: '0.8rem', marginTop: '2px' }}>
                        Reason: <em>{req.reason}</em>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleResolveBypass(req.id, req.studentUid, req.studentEmail, true)}
                        style={{
                          background: '#10b981',
                          color: '#ffffff',
                          border: 'none',
                          padding: '6px 14px',
                          borderRadius: '6px',
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        ✅ Grant 1-Class Session Bypass
                      </button>
                      <button
                        type="button"
                        onClick={() => handleResolveBypass(req.id, req.studentUid, req.studentEmail, false)}
                        style={{
                          background: '#ef4444',
                          color: '#ffffff',
                          border: 'none',
                          padding: '6px 12px',
                          borderRadius: '6px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        ❌ Deny
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDismissBypass(req.id)}
                        style={{
                          background: 'rgba(148, 163, 184, 0.15)',
                          color: '#cbd5e1',
                          border: '1px solid rgba(148, 163, 184, 0.3)',
                          padding: '6px 10px',
                          borderRadius: '6px',
                          fontSize: '0.82rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                        title="Dismiss this claim without granting or rejecting"
                      >
                        ✕ Dismiss
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className={`timeline-controls monitor-toolbar-card ${showControls ? 'has-sidebar' : ''}`}>
          <div className={`monitor-toolbar-main-row ${showControls ? 'has-sidebar' : ''}`}>
            {/* Left Segment: Controls Drawer Toggle, Lesson Picker, Compact Live / Review Status */}
            <div className="monitor-toolbar-group monitor-toolbar-left">
              {!showControls && (
                <button
                  type="button"
                  onClick={() => setShowControls(true)}
                  className="show-controls-btn"
                  title="Open controls drawer"
                  aria-label="Show Controls"
                >
                  <span>⚙️</span>
                  <span>Show Controls</span>
                </button>
              )}
              {lessons.length > 0 && (
                <select
                  value={selectedLesson}
                  onChange={handleLessonChange}
                  className="monitor-select monitor-lesson-select"
                  title="Select Lesson Schedule"
                >
                  {lessons.map(lesson => (
                    <option key={lesson.start.toISOString()} value={lesson.start.toISOString()}>
                      {`${lesson.start.toLocaleDateString()} (${lesson.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${lesson.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                    </option>
                  ))}
                </select>
              )}

              {/* Compact Live Status Box & Return-to-Live Action */}
              <div
                className="monitor-live-status-box"
                title={`Timezone: ${timezone ? timezone.replace(/_/g, ' ') : 'Local'} • ${reviewTime ? `Review Time: ${new Date(reviewTime).toLocaleString()}` : `Current Time: ${now.toLocaleString()}`}`}
              >
                <button
                  type="button"
                  onClick={() => setReviewTime(null)}
                  disabled={!reviewTime}
                  className={`monitor-go-live-btn ${reviewTime ? 'is-reviewing' : 'is-live'}`}
                  title={reviewTime ? 'Click to return to real-time live mode' : 'Currently in real-time live mode'}
                >
                  <span className={`live-dot ${reviewTime ? 'review' : 'pulse'}`}>●</span>
                  <span>{reviewTime ? 'Return Live' : 'Live'}</span>
                </button>
                <span className="monitor-live-clock">
                  {reviewTime
                    ? new Date(reviewTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    : now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
              </div>
            </div>

            {/* Center Segment: Recording Badges (Broadcast Studio launcher is in Class Hub header) */}
            <div className="monitor-toolbar-group monitor-toolbar-center">
              {/* Teacher Sovereign Lecture Recording Status Badges */}
              {lectureRecorder.isRecording && (
                <span
                  onClick={() => setShowBroadcastModal(true)}
                  className="monitor-record-pill recording"
                  title="Lecture is actively recording. Click to manage."
                >
                  🔴 REC ({lectureRecorder.durationFormatted})
                </span>
              )}
              {lectureRecorder.isPaused && (
                <span
                  onClick={() => setShowBroadcastModal(true)}
                  className="monitor-record-pill paused"
                  title="Lecture recording is paused. Click to resume."
                >
                  ⏸️ PAUSED ({lectureRecorder.durationFormatted})
                </span>
              )}
              {lectureRecorder.isUploading && (
                <span
                  className="monitor-record-pill uploading"
                  title="Lecture recording is uploading to Cloud Storage. Please keep browser open."
                >
                  📦 Saving {lectureRecorder.uploadProgress}%
                </span>
              )}
            </div>

            {/* Right Segment: Channel Selector, Student Filter, Nudge, Export */}
            <div className="monitor-toolbar-group monitor-toolbar-right">
              <select
                aria-label="Grid view channel"
                className="channel-select-compact"
                value={selectedChannel}
                onChange={(e) => setSelectedChannel(e.target.value)}
                title="Class View Channel"
              >
                <option value="both">🔲 Dual View</option>
                <option value="screen">🖥️ Screen</option>
                <option value="webcam">📷 Webcam</option>
              </select>

              <select
                aria-label="Filter students by status"
                className={`channel-select-compact problem-filter-select ${complianceSummary.problems > 0 && problemFilter !== 'all' ? 'has-active-filter' : ''}`}
                value={problemFilter}
                onChange={(e) => setProblemFilter(e.target.value)}
                title="Filter by student compliance issue"
              >
                <option value="all">👥 All Students ({complianceSummary.total})</option>
                <option value="problems">⚠️ Problems ({complianceSummary.problems})</option>
                <option value="no_cam">📷 Missing Cam ({complianceSummary.noCam})</option>
                <option value="no_mic">🎙️ Missing Mic ({complianceSummary.noMic})</option>
                <option value="no_screen">🖥️ Not Sharing ({complianceSummary.noScreen})</option>
                <option value="ai_alert">🚨 AI Alerts ({complianceSummary.aiAlert})</option>
              </select>

              <select
                aria-label="Auto-roll student rows"
                className={`channel-select-compact auto-roll-select ${autoRollSpeed !== 'off' ? 'has-active-roll' : ''}`}
                value={autoRollSpeed}
                onChange={handleAutoRollChange}
                title="Automatically roll rows when monitor view has multiple rows of students"
              >
                <option value="off">⏸️ Auto-Roll: Off</option>
                <option value="1row_5s">🔄 Roll 1 Row (5s)</option>
                <option value="1row_10s">🔄 Roll 1 Row (10s)</option>
                <option value="1row_15s">🔄 Roll 1 Row (15s)</option>
                <option value="1row_20s">🔄 Roll 1 Row (20s)</option>
                <option value="1row_30s">🔄 Roll 1 Row (30s)</option>
                <option value="2row_10s">🔄 Roll 2 Rows (10s)</option>
                <option value="2row_15s">🔄 Roll 2 Rows (15s)</option>
                <option value="2row_30s">🔄 Roll 2 Rows (30s)</option>
              </select>

              {problemFilter !== 'all' && filteredStudents.length > 0 && (
                <button
                  type="button"
                  className="compact-nudge-btn"
                  onClick={handleNudgeProblemStudents}
                  title={`Broadcast targeted reminder to ${filteredStudents.length} student(s)`}
                >
                  📢 Nudge ({filteredStudents.length})
                </button>
              )}

              {filteredStudents.length > 0 && (
                <button
                  type="button"
                  className="monitor-btn monitor-btn-secondary"
                  onClick={handleExportFilteredCsv}
                  title={`Export current ${filteredStudents.length} filtered results to Excel`}
                  aria-label="Export filter results to Excel"
                >
                  📥 Export Excel
                </button>
              )}
            </div>
          </div>

          {startTime && endTime && (
            <div className="monitor-slider-row">
              <TimelineSlider
                min={new Date(startTime).getTime()}
                max={new Date(endTime).getTime()}
                value={displayTime}
                onChange={handleTimelineChange}
                bufferedRanges={[]}
              />
            </div>
          )}
        </div>
        {isExamActive && (
          <div
            className="exam-security-banner"
            style={{
              margin: '0.5rem 1rem 0.75rem',
              background: '#fef2f2',
              border: '1px solid #f87171',
              borderRadius: '8px',
              padding: '0.65rem 1rem',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <span style={{ fontSize: '1.25rem' }}>🔒</span>
            <div>
              <strong style={{ color: '#991b1b', fontSize: '0.9rem' }}>
                PROCTORED EXAM MODE ACTIVE
              </strong>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#7f1d1d' }}>
                Assessment confidentiality safeguards are enforced. Screen recordings, audio transcripts, and irregularity evidence will be withheld from student records.
              </p>
            </div>
          </div>
        )}
        <div
          ref={studentsGridRef}
          className="students-grid-wrapper"
          onMouseEnter={() => setIsGridHovered(true)}
          onMouseLeave={() => setIsGridHovered(false)}
        >
          <StudentsGrid
            reviewTime={reviewTime}
            classList={classList}
            studentUidMap={studentUidMap}
            uidToEmailMap={uidToEmailMap}
            screenshots={screenshots}
            frameRate={frameRate}
            students={students}
            displayStudents={rolledStudents}
            problemFilter={problemFilter}
            now={now}
            isPaused={isPaused}
            selectedChannel={selectedChannel}
            handleStudentClick={handleStudentClick}
          />
        </div>
      </div>

      <Modal 
        show={showNotSharingModal} 
        onClose={() => setShowNotSharingModal(false)} 
        title={`Students Not Sharing Screen (${notSharingStudents.length})`}
      >
        {notSharingStudents.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', height: '100%', minHeight: 0 }}>
            {/* Toolbar for Search & Sort */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.6rem',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingBottom: '0.6rem',
              borderBottom: '1px solid var(--color-border, #e2e8f0)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: '1 1 200px' }}>
                <input
                  type="text"
                  placeholder="🔍 Search name, email, class..."
                  value={notSharingSearchQuery}
                  onChange={(e) => setNotSharingSearchQuery(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.45rem 0.65rem',
                    fontSize: '0.85rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border, #cbd5e1)',
                    outline: 'none',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-text-main, #1e293b)'
                  }}
                  aria-label="Search non-sharing students"
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-muted, #64748b)' }}>
                  Sort by:
                </label>
                <select
                  value={notSharingSortBy}
                  onChange={(e) => setNotSharingSortBy(e.target.value)}
                  style={{
                    padding: '0.42rem 0.65rem',
                    fontSize: '0.82rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border, #cbd5e1)',
                    backgroundColor: 'var(--color-surface, #ffffff)',
                    color: 'var(--color-text-main, #1e293b)',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                  aria-label="Sort non-sharing students by"
                >
                  <option value="name">Name</option>
                  <option value="email">Email / ID</option>
                  <option value="studentClass">Class / Programme</option>
                </select>

                <button
                  type="button"
                  onClick={() => setNotSharingSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                  style={{
                    padding: '0.42rem 0.65rem',
                    fontSize: '0.82rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border, #cbd5e1)',
                    backgroundColor: 'var(--color-bg-secondary, #f8fafc)',
                    color: 'var(--color-text-main, #334155)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontWeight: 600
                  }}
                  title={notSharingSortDirection === 'asc' ? 'Sort Ascending (A to Z)' : 'Sort Descending (Z to A)'}
                  aria-label="Toggle sort direction"
                >
                  {notSharingSortDirection === 'asc' ? '↑ Asc (A-Z)' : '↓ Desc (Z-A)'}
                </button>
              </div>
            </div>

            {/* Students List */}
            {sortedNotSharingStudents.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: '55vh', overflowY: 'auto', paddingRight: '4px' }}>
                {sortedNotSharingStudents.map(s => {
                  const hasDistinctName = s.displayName && s.email && s.displayName !== s.email;
                  return (
                    <div 
                      key={s.id} 
                      style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'space-between',
                        padding: '0.65rem 0.9rem',
                        backgroundColor: 'var(--color-bg-secondary, #f8fafc)',
                        borderRadius: '8px',
                        border: '1px solid var(--color-border, #e2e8f0)'
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--color-text-main, #1e293b)' }}>
                          {s.displayName || s.email || (s.id ? `Student (${s.id.slice(0, 8)})` : 'Unknown Student')}
                        </div>
                        {hasDistinctName && (
                          <div style={{ fontSize: '0.82rem', color: 'var(--color-text-muted, #64748b)' }}>
                            {s.email}
                          </div>
                        )}
                      </div>
                      {(s.studentClass || s.programme) && (
                        <span style={{ fontSize: '0.75rem', fontWeight: 500, padding: '3px 8px', borderRadius: '4px', backgroundColor: '#e2e8f0', color: '#475569' }}>
                          {[s.studentClass, s.programme].filter(Boolean).join(' • ')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ margin: 0, padding: '1rem 0', textAlign: 'center', color: 'var(--color-text-muted, #64748b)' }}>
                No non-sharing students match "{notSharingSearchQuery}".
              </p>
            )}
          </div>
        ) : <p style={{ margin: 0, padding: '0.5rem 0', color: 'var(--color-text-muted, #64748b)' }}>All students are sharing their screen.</p>}
      </Modal>

      {liveSelectedStudent && (
        <IndividualStudentView 
          student={liveSelectedStudent}
          screenshotData={screenshots[liveSelectedStudent.id]}
          screenshotUrl={selectedScreenshotUrl} 
          classId={classId}
          teacherUid={auth?.currentUser?.uid}
          selectedChannel={selectedChannel}
          problemFilter={problemFilter}
          captureMode={captureMode}
          onClose={() => setSelectedStudent(null)} 
        />
      )}


      <Modal
        show={showAnalysisResultsModal}
        onClose={() => setShowAnalysisResultsModal(false)}
        title="AI Analysis Results"
      >
        {isAnalyzing ? (
          <div style={{ textAlign: 'center', padding: '24px 0' }}>
            <p style={{ fontSize: '1.1em', fontWeight: '500', color: '#1976d2' }}>
              🤖 Gemini AI is analyzing the student screen(s)...
            </p>
            <p style={{ color: '#666', fontSize: '0.9em' }}>Please wait a moment.</p>
          </div>
        ) : (analysisResults && Object.keys(analysisResults).length > 0) ? (
          <ul style={{ padding: 0, margin: 0, maxHeight: '60vh', overflowY: 'auto' }}>
            {analysisResultItems}
          </ul>
        ) : (
          <p>No analysis results available.</p>
        )}
      </Modal>

      {/* Teacher Screen & Voice Broadcast Studio Modal */}
      <TeacherScreenBroadcastModal
        isOpen={showBroadcastModal}
        onClose={() => setShowBroadcastModal(false)}
        screenStream={broadcastScreenStream}
        lastFrameData={broadcastLastFrameData}
        isBroadcasting={isScreenBroadcasting}
        frameStats={frameStats}
        viewers={broadcastViewers}
        onStartBroadcast={handleStartSynchronizedBroadcast}
        onStopBroadcast={handleStopSynchronizedBroadcast}
        broadcastResolution={broadcastResolution}
        broadcastInterval={broadcastInterval}
        setBroadcastResolution={setBroadcastResolution}
        setBroadcastInterval={setBroadcastInterval}
        isSubtitlesEnabled={isSubtitleBroadcastEnabled}
        setIsSubtitlesEnabled={setIsSubtitleBroadcastEnabled}
        selectedMicDeviceId={selectedMicDeviceId}
        onSelectMicDeviceId={handleSelectMicDeviceId}
        teacherSubtitles={teacherSubtitles}
        courseContext={classSubjectDomain}
        subtitlePrompt={classSubtitlePrompt}
        user={user}
        onSelectSubtitlePrompt={handleSelectSubtitlePrompt}
        onSelectCourseContext={handleSelectCourseContext}
        lectureRecorder={lectureRecorder}
        defaultRecordOnStart={classDefaultLectureRecording}
        onOpenRecordings={() => setShowRecordingsModal(true)}
        classId={classId}
        className={className}
        activeLiveClass={activeLiveClass}
        onSwitchClass={onSwitchClass}
        isPublicBroadcast={isPublicBroadcast}
        publicPin={publicPin}
      />

      {/* Teacher Lecture Recordings & YouTube CC Modal */}
      {showRecordingsModal && (
        <Modal
          isOpen={showRecordingsModal}
          onClose={() => setShowRecordingsModal(false)}
          title="🎥 Class Lecture Recordings & Multilingual YouTube CC"
        >
          <LectureRecordingsView
            classId={classId}
            user={user}
            onBack={() => setShowRecordingsModal(false)}
          />
        </Modal>
      )}

      {/* Legacy Fallback Teacher Live Subtitle Control Modal */}
      {showSubtitleModal && (
        <TeacherSubtitleControlModal
          isOpen={showSubtitleModal}
          onClose={() => setShowSubtitleModal(false)}
          enabled={isSubtitleBroadcastEnabled}
          onToggleEnabled={() => setIsSubtitleBroadcastEnabled((prev) => !prev)}
          engineMode={teacherSubtitles.engineMode}
          onSelectEngineMode={teacherSubtitles.setEngineMode}
          speechLanguage={teacherSubtitles.speechLanguage}
          onSelectSpeechLanguage={teacherSubtitles.setSpeechLanguage}
          targetLanguages={teacherSubtitles.targetLanguages}
          onToggleTargetLanguage={(langCode) => {
            teacherSubtitles.setTargetLanguages((prev) =>
              prev.includes(langCode)
                ? (prev.length > 1 ? prev.filter((l) => l !== langCode) : prev)
                : [...prev, langCode]
            );
          }}
          isGemmaAvailable={teacherSubtitles.isGemmaAvailable}
          gemmaProgress={teacherSubtitles.gemmaProgress}
          latestTranscript={teacherSubtitles.latestTranscript}
          latestTranslations={teacherSubtitles.latestTranslations}
          status={teacherSubtitles.status}
          error={teacherSubtitles.error}
          selectedMicDeviceId={selectedMicDeviceId}
          onSelectMicDeviceId={handleSelectMicDeviceId}
          courseContext={classSubjectDomain}
          subtitlePrompt={classSubtitlePrompt}
          user={user}
          onSelectSubtitlePrompt={handleSelectSubtitlePrompt}
          onSelectCourseContext={handleSelectCourseContext}
        />
      )}

      {/* Live Bingo Presence Verification Modal */}
      {showBingoModal && (
        <Modal
          show={showBingoModal}
          onClose={() => setShowBingoModal(false)}
          title="🎯 Live Bingo Presence Verification & Results"
        >
          <BingoResultsView
            classId={classId}
            timezone={timezone}
            isModal={true}
            studentStatuses={studentStatuses}
            classList={classList}
            uidToEmailMap={uidToEmailMap}
            externalProfiles={studentProfiles}
          />
        </Modal>
      )}

      {/* Lecture Hall Dynamic Rotating QR Code Bingo Modal */}
      {showLectureQrModal && (
        <LectureQrBingoModal
          show={showLectureQrModal}
          onClose={() => setShowLectureQrModal(false)}
          classId={classId}
          className={className || classId}
          totalStudentsCount={classList?.length || 0}
          onViewResults={() => setShowBingoModal(true)}
        />
      )}

      {/* High-Visibility Lecture Recording Upload Progress Modal */}
      {lectureRecorder.isUploading && (
        <div
          data-testid="lecture-upload-modal"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2.25rem',
              maxWidth: '480px',
              width: '90%',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '0.75rem' }}>💾</div>
            <h3 style={{ margin: '0 0 0.5rem', color: '#0f172a', fontSize: '1.25rem', fontWeight: 700 }}>
              Uploading Lecture Recording to Cloud
            </h3>
            <p style={{ margin: '0 0 1.25rem', color: '#475569', fontSize: '0.92rem', lineHeight: 1.5 }}>
              Securing video and audio to Google Cloud Storage. <strong>Please do not close this browser tab or shut down your computer</strong> until upload completes.
            </p>
            <div
              style={{
                backgroundColor: '#e2e8f0',
                borderRadius: '9999px',
                height: '14px',
                overflow: 'hidden',
                marginBottom: '0.75rem',
              }}
            >
              <div
                style={{
                  backgroundColor: '#2563eb',
                  height: '100%',
                  width: `${lectureRecorder.uploadProgress}%`,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div style={{ fontSize: '1.15rem', fontWeight: 700, color: '#1d4ed8', marginBottom: '0.75rem' }}>
              {lectureRecorder.uploadProgress}%
            </div>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              ⚡ Automatic Gemini audio transcription and search indexing will begin automatically when upload finishes.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonitorView;
