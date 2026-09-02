import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';

import { db, storage, auth } from '../firebase-config';
import { collection, query, where, onSnapshot, orderBy, limit, doc, updateDoc, addDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';


import Modal from './Modal';

import ControlsPanel from './monitor/ControlsPanel';
import StudentsGrid from './monitor/StudentsGrid';
import TimelineSlider from './TimelineSlider';
import IndividualStudentView from './IndividualStudentView';

import { usePrompts } from '../hooks/usePrompts';

import { useAnalysis } from '../hooks/useAnalysis';
import {
  getComplianceSummary,
  filterStudentsByCompliance,
  getNudgeMessageForFilter,
  exportComplianceResultsToCsv,
} from '../utils/studentCompliance';

const MonitorView = ({ classId, lessons, selectedLesson, startTime, endTime, handleLessonChange: originalHandleLessonChange, timezone }) => {
  const { prompts, filteredPrompts, promptFilter, setPromptFilter } = usePrompts();
  const { isAnalyzing, analysisResults, runPerImageAnalysis, runAllImagesAnalysis } = useAnalysis(classId);
  const [showAnalysisResultsModal, setShowAnalysisResultsModal] = useState(false);
  const [classList, setClassList] = useState([]);
  const [studentStatuses, setStudentStatuses] = useState([]);
  const [screenshots, setScreenshots] = useState({});
  const [selectedChannel, setSelectedChannel] = useState('both');
  const [problemFilter, setProblemFilter] = useState('all');
  const [message, setMessage] = useState('');

  const [frameRate, setFrameRate] = useState(15);
  const [maxImageSize, setMaxImageSize] = useState(0.1 * 1024 * 1024);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showNotSharingModal, setShowNotSharingModal] = useState(false);
  const [now, setNow] = useState(new Date());
  const [showControls, setShowControls] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);


  const [reviewTime, setReviewTime] = useState(null);
  const [timelineScrubTime, setTimelineScrubTime] = useState(null);
  const timelineDebounceTimer = useRef(null);

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

  // Voice AI States
  const [voiceAiMode, setVoiceAiMode] = useState('hybrid');
  const [speechLanguage, setSpeechLanguage] = useState('zh-HK');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [vadSensitivity, setVadSensitivity] = useState(15);
  const [voiceAiCloudFallbackRate, setVoiceAiCloudFallbackRate] = useState(3);

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

      if (settings.selectedAiModel) {
        payload.aiModel = settings.selectedAiModel;
        setSelectedAiModel(settings.selectedAiModel);
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
        console.log('[MonitorView] DEBUG: Raw class data:', JSON.stringify(data, null, 2));

        const studentUids = data.students ? Object.keys(data.students) : [];
        setClassList(studentUids);

        const newMap = new Map();
        if (data.students && typeof data.students === 'object' && !Array.isArray(data.students)) {
            Object.entries(data.students).forEach(([uid, email]) => {
                newMap.set(uid, email);
            });
        }
        
        setUidToEmailMap(newMap);
        console.log('[MonitorView] DEBUG: uidToEmailMap populated:', newMap);

        if (data.aiModel) {
          setSelectedAiModel(data.aiModel);
        }

        setFrameRate(prevRate => {
          const newRate = data.frameRate || 15;
          return newRate === prevRate ? prevRate : newRate;
        });
        setMaxImageSize(prevSize => {
          const newSize = data.maxImageSize || 0.1 * 1024 * 1024;
          return newSize === prevSize ? prevSize : newSize;
        });
        setIsCapturing(data.isCapturing || false);
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
        setStorageQuota(data.storageQuota || 0);
        setAiQuota(data.aiQuota || 0);
        setAiUsedQuota(data.aiUsedQuota || 0);
      } else {
        setClassList([]);
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
    });

    return () => {
      unsubscribeClass();
      unsubscribeStorage();
      unsubscribeStatus();
      unsubscribeAiMeta();
    }
  }, [classId]);

  useEffect(() => {
    if (!reviewTime || classList.length === 0) return;

    const fetchScreenshotsForReview = async () => {
      const newScreenshots = {};
      const reviewTimeDate = new Date(reviewTime);

      for (const studentUid of classList) {
        if (!studentUid) continue;

        // Fetch latest screenshot up to reviewTime
        const screenshotsQuery = query(
          collection(db, 'screenshots'),
          where('classId', '==', classId),
          where('studentUid', '==', studentUid),
          where('timestamp', '<=', reviewTimeDate),
          orderBy('timestamp', 'desc'),
          limit(6)
        );

        const snapshot = await getDocs(screenshotsQuery);
        if (!snapshot.empty) {
          let screenItem = null;
          let webcamItem = null;

          for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const channel = data.channel || 'screen';
            if (channel === 'screen' && !screenItem) {
              try {
                const url = await getDownloadURL(ref(storage, data.imagePath));
                screenItem = { url, timestamp: data.timestamp, imagePath: data.imagePath, channel: 'screen' };
              } catch (e) {
                console.error("Error getting screen review URL:", e);
              }
            } else if (channel === 'webcam' && !webcamItem) {
              try {
                const url = await getDownloadURL(ref(storage, data.imagePath));
                webcamItem = { url, timestamp: data.timestamp, imagePath: data.imagePath, channel: 'webcam' };
              } catch (e) {
                console.error("Error getting webcam review URL:", e);
              }
            }
            if (screenItem && webcamItem) break;
          }

          const primaryItem = screenItem || webcamItem;
          if (primaryItem) {
            newScreenshots[studentUid] = {
              screen: screenItem,
              webcam: webcamItem,
              url: primaryItem.url,
              timestamp: primaryItem.timestamp,
              imagePath: primaryItem.imagePath
            };
          }
        }
      }
      setScreenshots(newScreenshots);
    };

    fetchScreenshotsForReview();
  }, [reviewTime, classList, classId]);

  const students = useMemo(() => {
    const currentNow = now.getTime();
    const staleThresholdMs = Math.max(frameRate * 3, 30) * 1000;

    const getTs = (obj) => {
      if (!obj?.timestamp) return 0;
      if (typeof obj.timestamp.toMillis === 'function') return obj.timestamp.toMillis();
      if (obj.timestamp.seconds) return obj.timestamp.seconds * 1000;
      if (obj.timestamp instanceof Date) return obj.timestamp.getTime();
      if (typeof obj.timestamp === 'number') return obj.timestamp;
      return 0;
    };

    return classList.map(uid => {
      const status = studentStatuses.find(s => s.id === uid);
      const email = uidToEmailMap.get(uid) || (status ? status.email : '');
      const statusTs = getTs(status);
      const isStatusFresh = reviewTime
        ? true
        : (statusTs > 0 && (currentNow - statusTs) <= staleThresholdMs);

      const isActuallySharing = Boolean(status && status.isSharing && isStatusFresh);

      return {
        id: uid,
        email: email,
        name: status ? status.name : email,
        isSharing: isActuallySharing,
        isWebcamSharing: isActuallySharing && Boolean(status.isWebcamSharing || (status.activeStreams && status.activeStreams.includes('webcam'))),
        isAudioSharing: isActuallySharing && Boolean(status.isAudioSharing || (status.activeStreams && status.activeStreams.includes('audio')) || status.isAudioRecording),
        audioStatus: isActuallySharing ? status?.audioStatus : null,
        audioLevel: isActuallySharing ? (status?.audioLevel || 0) : 0,
        audioError: status ? status.audioError : null,
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
  }, [classList, studentStatuses, uidToEmailMap, now, frameRate, reviewTime]);

  useEffect(() => {
    if (reviewTime || students.length === 0 || pausedRef.current) return;

    let isCancelled = false;

    const resolveAllStatuses = async () => {
      const updates = {};
      const analysisQueue = [];
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

      for (const status of studentStatuses) {
        const studentUid = status.id;
        if (!studentUid) continue;

        const statusTs = getTs(status);
        const isFresh = statusTs > 0 && (currentNow - statusTs) <= staleThresholdMs;
        const isActivelySharing = Boolean(status.isSharing && isFresh);

        // In live mode, only resolve and display screenshots for actively sharing students with fresh heartbeats
        if (!isActivelySharing) continue;

        const screenPath = status.latestScreenPath || status.latestImagePath;
        const webcamPath = status.latestWebcamPath;
        if (!screenPath && !webcamPath) continue;

        let resolvedScreenUrl = screenPath ? urlCacheRef.current.get(screenPath) : null;
        let resolvedWebcamUrl = webcamPath ? urlCacheRef.current.get(webcamPath) : null;

        if (screenPath && !resolvedScreenUrl) {
          try {
            resolvedScreenUrl = await getDownloadURL(ref(storage, screenPath));
            urlCacheRef.current.set(screenPath, resolvedScreenUrl);
          } catch (error) {
            console.error(`Error getting download URL for screen ${screenPath}: `, error);
          }
        }

        if (webcamPath && !resolvedWebcamUrl) {
          try {
            resolvedWebcamUrl = await getDownloadURL(ref(storage, webcamPath));
            urlCacheRef.current.set(webcamPath, resolvedWebcamUrl);
          } catch (error) {
            console.error(`Error getting download URL for webcam ${webcamPath}: `, error);
          }
        }

        const primaryUrl = resolvedScreenUrl || resolvedWebcamUrl;
        const primaryPath = screenPath || webcamPath;

        updates[studentUid] = {
          screen: resolvedScreenUrl ? {
            url: resolvedScreenUrl,
            timestamp: status.timestamp,
            imagePath: screenPath
          } : null,
          webcam: resolvedWebcamUrl ? {
            url: resolvedWebcamUrl,
            timestamp: status.timestamp,
            imagePath: webcamPath
          } : null,
          url: primaryUrl,
          timestamp: status.timestamp,
          imagePath: primaryPath
        };

        if (isPerImageAnalysisRunning && primaryUrl && primaryPath) {
          const lastAnalysis = lastAnalyzedPathMapRef.current.get(studentUid);
          const minIntervalMs = (Number(samplingRate) || 5) * (Number(frameRate) || 15) * 1000;
          const isSameImage = lastAnalysis && lastAnalysis.imagePath === primaryPath;
          const isCoolingDown = lastAnalysis && (currentNow - lastAnalysis.timestamp) < minIntervalMs;
          const isInFlight = activeAnalysisInFlightRef.current.has(studentUid);

          // Deduplication Guard: Never analyze the exact same screenshot twice, enforce cooldown & prevent overlapping calls
          if (!isSameImage && !isCoolingDown && !isInFlight) {
            analysisQueue.push({ studentUid, status, targetUrl: primaryUrl, targetPath: primaryPath });
          }
        }
      }

      if (!isCancelled) {
        // Set screenshots to only include actively sharing students
        setScreenshots(updates);

        for (const item of analysisQueue) {
          const studentEmail = uidToEmailMap.get(item.studentUid) || item.status.email;
          lastAnalyzedPathMapRef.current.set(item.studentUid, { imagePath: item.targetPath, timestamp: Date.now() });
          activeAnalysisInFlightRef.current.add(item.studentUid);

          runPerImageAnalysis({ [item.studentUid]: { url: item.targetUrl, email: studentEmail } }, editablePromptText, selectedAiModel)
            .catch(err => {
              console.error(`[MonitorView] Error during per-image analysis for ${studentEmail}:`, err);
            })
            .finally(() => {
              activeAnalysisInFlightRef.current.delete(item.studentUid);
            });
        }
      }
    };

    resolveAllStatuses();

    return () => {
      isCancelled = true;
    };
  }, [studentStatuses, reviewTime, isPaused, isPerImageAnalysisRunning, samplingRate, runPerImageAnalysis, editablePromptText, selectedAiModel, uidToEmailMap, students.length, frameRate]);

  useEffect(() => {
    if (!isAllImagesAnalysisRunning) {
      lastAllImagesRunTimeRef.current = 0;
      return;
    }

    if (!editablePromptText || !editablePromptText.trim()) {
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
        runAllImagesAnalysis(screenshotsToAnalyze, editablePromptText, selectedAiModel);
      }
    };

    // Run initially once on toggle on
    if (lastAllImagesRunTimeRef.current === 0) {
      performAllImagesAnalysis();
    }

    const intervalId = setInterval(performAllImagesAnalysis, 1000);

    return () => clearInterval(intervalId);
  }, [isAllImagesAnalysisRunning, samplingRate, frameRate, runAllImagesAnalysis, students, editablePromptText, selectedAiModel]);

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

  const handleDownloadAttendance = () => {
    const uidToStatusMap = new Map(studentStatuses.map(status => [status.id, status]));

    const attendanceData = classList.map(uid => {
      const email = uidToEmailMap.get(uid) || '';
      const status = uidToStatusMap.get(uid);
      const isSharing = status ? status.isSharing || false : false;
      return { email, isSharing };
    });

    const header = ['Email', 'Sharing Screen'];
    const rows = attendanceData.map(s => [
      `"${s.email.replace(/"/g, '""')}"`, // Corrected escaping for double quotes within a double-quoted string
      s.isSharing
    ].join(','));

    const csvContent = 'data:text/csv;charset=utf-8,' + [header.join(','), ...rows].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const now = new Date();
    const timeString = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}_${now.getHours()}-${now.getMinutes()}-${now.getSeconds()}`;
    link.setAttribute("download", `${classId}_${timeString}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
    } catch (error) {
      console.error("Error toggling capture:", error);
      setIsCapturing(!newIsCapturing); // Revert on error
      alert("Failed to update capture status. Please try again.");
    }
  }, [classId, isCapturing]);

  const handleStudentClick = (student) => {
    setSelectedStudent(student);
  };

  const sharingStudentUids = useMemo(() => new Set(
    studentStatuses
      .filter(status => status.isSharing)
      .map(status => status.id)
  ), [studentStatuses]);

  const notSharingStudents = useMemo(() => classList
    .filter(uid => !sharingStudentUids.has(uid))
    .map(uid => {
      const email = uidToEmailMap.get(uid) || '';
      return { id: uid, email: email };
    }), [classList, sharingStudentUids, uidToEmailMap]);

  const selectedScreenshotUrl = selectedStudent && screenshots[selectedStudent.id] ? screenshots[selectedStudent.id].url : null;

  const classComplianceSettings = useMemo(() => ({
    captureMode: selectedChannel === 'both' ? 'dual' : selectedChannel,
    enableAudioCapture: enableAudioCapture,
    isCapturing: isCapturing,
  }), [selectedChannel, enableAudioCapture, isCapturing]);

  const complianceSummary = useMemo(() => {
    return getComplianceSummary(students, classComplianceSettings, screenshots);
  }, [students, classComplianceSettings, screenshots]);

  const filteredStudents = useMemo(() => {
    return filterStudentsByCompliance(students, problemFilter, classComplianceSettings, screenshots);
  }, [students, problemFilter, classComplianceSettings, screenshots]);

  const handleNudgeProblemStudents = async () => {
    const count = filteredStudents.length;
    if (count === 0) return;
    const nudgeMsg = getNudgeMessageForFilter(problemFilter);
    const confirmed = window.confirm(`📢 Send invigilation reminder to ${count} filtered student(s)?\n\n"${nudgeMsg}"`);
    if (confirmed) {
      await handleSendMessage(nudgeMsg);
    }
  };

  const handleExportFilteredCsv = () => {
    if (filteredStudents.length === 0) {
      alert('No students in the current filter to export.');
      return;
    }
    exportComplianceResultsToCsv(filteredStudents, problemFilter, classComplianceSettings, screenshots, classId);
  };

  const handleRunAnalysis = async () => {
    if (!editablePromptText.trim()) {
        alert('Please select or enter a prompt.');
        return;
    }

    const screenshotsToAnalyze = {};
    if (reviewTime) {
      for (const studentId in screenshots) {
        const student = students.find(s => s.id === studentId);
        if (student && screenshots[studentId]) {
          screenshotsToAnalyze[studentId] = {
            url: screenshots[studentId].url,
            email: student.email,
            imagePath: screenshots[studentId].imagePath
          };
        }
      }
    } else {
      for (const student of students) {
          if (student.isSharing && screenshots[student.id]) {
            screenshotsToAnalyze[student.id] = {
              url: screenshots[student.id].url,
              email: student.email,
              imagePath: screenshots[student.id].imagePath
            };
          }
      }
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
    await runPerImageAnalysis(screenshotsToAnalyze, editablePromptText, selectedAiModel);
  };

  const handleRunAllImagesAnalysis = async () => {
    if (!editablePromptText.trim()) {
        alert('Please select or enter a prompt.');
        return;
    }

    const screenshotsToAnalyze = {};
    if (reviewTime) {
      for (const studentId in screenshots) {
        const student = students.find(s => s.id === studentId);
        if (student && screenshots[studentId]) {
          screenshotsToAnalyze[studentId] = {
            url: screenshots[studentId].url,
            email: student.email,
            imagePath: screenshots[studentId].imagePath
          };
        }
      }
    } else {
      for (const student of students) {
          if (student.isSharing && screenshots[student.id]) {
            screenshotsToAnalyze[student.id] = {
              url: screenshots[student.id].url,
              email: student.email,
              imagePath: screenshots[student.id].imagePath
            };
          }
      }
    }

    setShowPromptModal(false);
    setShowAnalysisResultsModal(true);
    await runAllImagesAnalysis(screenshotsToAnalyze, editablePromptText, selectedAiModel);
  };

  const displayTime = timelineScrubTime ?? (reviewTime ? new Date(reviewTime).getTime() : now.getTime());

  const analysisResultItems = useMemo(() => 
    Object.entries(analysisResults || {}).map(([studentId, result]) => {
      const studentObj = students.find(s => s.id === studentId);
      const email = studentObj?.email || uidToEmailMap.get(studentId) || studentId;
      
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
          <strong style={{ display: 'block', marginBottom: '6px', color: '#1976d2', fontSize: '1.05em' }}>
            {email}
          </strong>
          <div style={{ color: isError ? '#d32f2f' : '#2c3e50', whiteSpace: 'pre-wrap', lineHeight: '1.6', background: isError ? '#ffebee' : '#f8f9fa', padding: '10px 14px', borderRadius: '6px' }}>
            {textContent}
          </div>
        </li>
      );
    }), [analysisResults, uidToEmailMap, students]);

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

  return (
    <div className="monitor-view" style={{ display: 'flex', flexDirection: 'row' }}>
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
        selectedChannel={selectedChannel}
        setSelectedChannel={setSelectedChannel}
        isCapturing={isCapturing}
        toggleCapture={toggleCapture}
        isPaused={isPaused}
        setIsPaused={setIsPaused}
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
      />}

      <div className="monitor-main-content" style={{ flexGrow: 1 }}>
        <div className="timeline-controls" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              {!showControls && <button onClick={() => setShowControls(true)} className="show-controls-btn">Show Controls</button>}
              <select value={selectedLesson} onChange={handleLessonChange}>
                {lessons.map(lesson => (
                  <option key={lesson.start.toISOString()} value={lesson.start.toISOString()}>
                    {`${lesson.start.toLocaleDateString()} (${lesson.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${lesson.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`}
                  </option>
                ))}
              </select>
              <button onClick={() => setReviewTime(null)} disabled={!reviewTime}>Go Live</button>
              {timezone && timezone !== 'UTC' && <span style={{ fontStyle: 'italic', color: '#555' }}>Timezone: {timezone.replace(/_/g, ' ')}</span>}
              <span>
                {reviewTime ? `Review: ${new Date(reviewTime).toLocaleString()}` : `Live: ${now.toLocaleString()}`}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {/* Compact Grid View Channel Selector */}
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

              {/* Ultra-Compact Problem Students Filter Dropdown */}
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

              {/* Inline Zero-Space Targeted Nudge Button */}
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

              {/* Quick Export Filter Results to CSV */}
              {filteredStudents.length > 0 && (
                <button
                  type="button"
                  className="compact-nudge-btn"
                  style={{ background: 'var(--color-bg-subtle, #f8fafc)', color: 'var(--color-text-main, #0f172a)', border: '1px solid var(--color-border, #cbd5e1)' }}
                  onClick={handleExportFilteredCsv}
                  title={`Export current ${filteredStudents.length} filtered results to CSV`}
                  aria-label="Export filter results to CSV"
                >
                  📥 Export CSV
                </button>
              )}
            </div>
          </div>
          {startTime && endTime && (
            <TimelineSlider
              min={new Date(startTime).getTime()}
              max={new Date(endTime).getTime()}
              value={displayTime}
              onChange={handleTimelineChange}
              bufferedRanges={[]}
            />
          )}
        </div>
        <StudentsGrid
          reviewTime={reviewTime}
          classList={classList}
          studentUidMap={studentUidMap}
          uidToEmailMap={uidToEmailMap}
          screenshots={screenshots}
          frameRate={frameRate}
          students={students}
          displayStudents={reviewTime ? undefined : filteredStudents}
          problemFilter={problemFilter}
          now={now}
          isPaused={isPaused}
          selectedChannel={selectedChannel}
          handleStudentClick={handleStudentClick}
        />
      </div>

      <Modal show={showNotSharingModal} onClose={() => setShowNotSharingModal(false)} title="Students Not Sharing Screen">
        {notSharingStudents.length > 0 ? (
          <ul style={{ listStyleType: 'none', padding: 0 }}>{notSharingStudents.map(s => <li key={s.id} style={{ padding: '5px 0' }}>{s.email}</li>)}</ul>
        ) : <p>All students are sharing their screen.</p>}
      </Modal>

      {selectedStudent && (
        <IndividualStudentView 
          student={selectedStudent} 
          screenshotData={screenshots[selectedStudent.id]} 
          screenshotUrl={selectedScreenshotUrl} 
          classId={classId}
          teacherUid={auth?.currentUser?.uid}
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
    </div>
  );
};

export default MonitorView;
