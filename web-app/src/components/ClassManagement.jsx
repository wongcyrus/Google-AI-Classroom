import { useState, useEffect, useRef } from 'react';
import VideoPromptSelector from './VideoPromptSelector';
import AudioPromptSelector from './AudioPromptSelector';
import ImagePromptSelector from './ImagePromptSelector';
import TranslationPromptSelector from './TranslationPromptSelector';
import ClassPromptField from './class-management/ClassPromptField';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc, collection, getDocs, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, auth, functions } from '../firebase-config';
import './ClassManagement.css';
import Modal from './Modal';
import CustomPropertiesManager from './CustomPropertiesManager';
import ScheduleManager from './ScheduleManager';
import ScheduleChangeModal from './ScheduleChangeModal';
import { generateLessons } from '../hooks/useClassSchedule';
import BatchStudentUploadModal from './BatchStudentUploadModal';
import EnrolledRosterModal from './EnrolledRosterModal';
import StudentBadge from './common/StudentBadge';
import {
  exportStudentRosterExcel,
  generateStudentRosterTemplateExcel,
  parseStudentRosterFile,
  normalizeStudentEmail,
  readTextFileWithEncoding,
} from '../utils/studentDisplayUtils';
import { exportToExcel, readExcelFile } from '../utils/exportUtils';
import useCloudPricing from '../hooks/useCloudPricing';
import { formatStorageCost } from '../utils/formatters';
import { SUBTITLE_LANGUAGES } from '../utils/videoSubtitleUtils';
import {
  DEFAULT_LECTURE_STT_PROMPT,
  DEFAULT_LECTURE_TRANSLATION_PROMPT,
} from '../constants/promptRegistry';
import {
  CLASS_TEMPLATES,
  DEFAULT_CLASS_TEMPLATE_ID,
  TEMPLATE_TAG_NAMES,
  getClassTemplate,
  getTemplateSettings,
} from '../constants/classTemplates';

const AVAILABLE_SUBTITLE_LANGUAGES = SUBTITLE_LANGUAGES.filter((l) => l.code !== 'original');

const ClassManagement = ({ user, embeddedClassId }) => {
  const { storageRatePerGibMonth } = useCloudPricing();
  const [classId, setClassId] = useState(embeddedClassId || '');
  const [className, setClassName] = useState('');
  const [studentEmails, setStudentEmails] = useState('');
  const [studentProfiles, setStudentProfiles] = useState({});
  const [studentDirectory, setStudentDirectory] = useState({});
  const [showBatchUploadModal, setShowBatchUploadModal] = useState(false);
  const [showRosterPreview, setShowRosterPreview] = useState(true);
  const [showEnlargedRosterModal, setShowEnlargedRosterModal] = useState(false);
  const [inlineRosterSearch, setInlineRosterSearch] = useState('');
  const [inlinePasskeyFilter, setInlinePasskeyFilter] = useState('all');
  const [inlineCohortFilter, setInlineCohortFilter] = useState('all');
  const [inlineSortColumn, setInlineSortColumn] = useState('displayName');
  const [inlineSortDirection, setInlineSortDirection] = useState('asc');
  const [studentsMap, setStudentsMap] = useState({});
  const [registeredPasskeysMap, setRegisteredPasskeysMap] = useState({});
  const [resettingPasskeys, setResettingPasskeys] = useState({});
  const [passkeyResetSuccess, setPasskeyResetSuccess] = useState('');
  const [studentBypassesMap, setStudentBypassesMap] = useState({});
  const [grantingBypass, setGrantingBypass] = useState({});
  const [bypassSuccessMsg, setBypassSuccessMsg] = useState('');
  const bypassTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (bypassTimeoutRef.current) clearTimeout(bypassTimeoutRef.current);
    };
  }, []);
  const [passwordWhitelistSet, setPasswordWhitelistSet] = useState(new Set());
  const [togglingExemption, setTogglingExemption] = useState({});
  const [exemptionSuccessMsg, setExemptionSuccessMsg] = useState('');
  const [teacherEmails, setTeacherEmails] = useState('');
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState(embeddedClassId || null);
  const [classTags, setClassTags] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [allKnownTags, setAllKnownTags] = useState([]);

  // Class settings state
  const [storageLimit, setStorageLimit] = useState('5'); // In GB
  const [retentionDays, setRetentionDays] = useState('30'); // In Days (Screenshots)
  const [videoRetentionDays, setVideoRetentionDays] = useState('90'); // In Days (Videos)
  const [scheduleStartDate, setScheduleStartDate] = useState('');
  const [scheduleEndDate, setScheduleEndDate] = useState('');
  const [timeZone, setTimeZone] = useState('Asia/Hong_Kong');
  const [classSchedules, setClassSchedules] = useState([]);
  const [initialSchedule, setInitialSchedule] = useState(null);
  const [scheduleHistory, setScheduleHistory] = useState([]);
  const [pastCompletedLessons, setPastCompletedLessons] = useState([]);
  const [showScheduleChangeModal, setShowScheduleChangeModal] = useState(false);
  const [pendingSavePayload, setPendingSavePayload] = useState(null);

  const [ipRestrictions, setIpRestrictions] = useState('');
  const [automaticCapture, setAutomaticCapture] = useState(true);
  const [automaticCombine, setAutomaticCombine] = useState(true);
  const [captureMode, setCaptureMode] = useState('dual');
  const [aiModel, setAiModel] = useState('gemini-3.5-flash-lite');
  const [requireFullScreenOnly, setRequireFullScreenOnly] = useState(true);
  const [aiMonitoringMode, setAiMonitoringMode] = useState('hybrid');
  const [voiceAiMode, setVoiceAiMode] = useState('hybrid');
  const [faceDebounceSeconds, setFaceDebounceSeconds] = useState(3);
  const [bingoRetryDelayMinutes, setBingoRetryDelayMinutes] = useState(3);
  const [bingoTimeLimitSeconds, setBingoTimeLimitSeconds] = useState(30);
  const [autoBingoEnabled, setAutoBingoEnabled] = useState(false);
  const [autoBingoIntervalMinutes, setAutoBingoIntervalMinutes] = useState(5);
  const [autoBingoMode, setAutoBingoMode] = useState('question_bank');
  const [bingoScoringRule, setBingoScoringRule] = useState({
    enabled: true,
    baseCorrectPoints: 100,
    speedBonusMaxPoints: 50,
    rankBonus: { 1: 50, 2: 30, 3: 20 },
  });
  const [enableClientAi, setEnableClientAi] = useState(true);
  const [gazeSensitivity, setGazeSensitivity] = useState('standard');
  const [customYawAngle, setCustomYawAngle] = useState(25);
  const [customPitchDownAngle, setCustomPitchDownAngle] = useState(-22);
  const [customPitchUpAngle, setCustomPitchUpAngle] = useState(26);
  const [enableCloudFallback, setEnableCloudFallback] = useState(false);
  const [cloudFallbackRate, setCloudFallbackRate] = useState(3);
  
  // Audio Monitoring settings
  const [enableAudioCapture, setEnableAudioCapture] = useState(false);
  const [audioCaptureMode, setAudioCaptureMode] = useState('mandatory');
  const [audioSegmentDuration, setAudioSegmentDuration] = useState(30);
  const [audioSilenceSuppression, setAudioSilenceSuppression] = useState(true);
  const [enableSegmentTranscription, setEnableSegmentTranscription] = useState(false);
  const [enableCombinedLongAudio, setEnableCombinedLongAudio] = useState(false);
  const [audioMovingWindowDuration, setAudioMovingWindowDuration] = useState(30);
  const [audioMovingWindowStride, setAudioMovingWindowStride] = useState(15);
  
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [afterClassVideoPrompt, setAfterClassVideoPrompt] = useState(null);

  // Image & Bingo AI prompt states
  const [liveImagePrompt, setLiveImagePrompt] = useState(null);
  const [bingoPrompt, setBingoPrompt] = useState(null);
  const [showImagePromptModal, setShowImagePromptModal] = useState(false);
  const [imagePromptModalType, setImagePromptModalType] = useState('live_image'); // 'live_image' | 'bingo'
  const [modalImagePrompt, setModalImagePrompt] = useState(null);
  const [modalImagePromptText, setModalImagePromptText] = useState('');
  
  // Audio & Voice AI prompt states
  const [liveAudioPrompt, setLiveAudioPrompt] = useState(null);
  const [sessionAudioPrompt, setSessionAudioPrompt] = useState(null);
  const [gemmaIntentPrompt, setGemmaIntentPrompt] = useState(null);
  const [subtitlePrompt, setSubtitlePrompt] = useState(null);
  const [subjectDomain, setSubjectDomain] = useState('Computer Science & Software Development');
  const [customSubjectDomain, setCustomSubjectDomain] = useState('');
  const [sessionAudioIntervalMinutes, setSessionAudioIntervalMinutes] = useState(0); // 0 = Full session

  const [showAudioPromptModal, setShowAudioPromptModal] = useState(false);
  const [audioPromptModalType, setAudioPromptModalType] = useState('live_audio'); // 'live_audio' | 'session_audio' | 'gemma_intent' | 'subtitle'
  const [modalAudioPrompt, setModalAudioPrompt] = useState(null);
  const [modalAudioPromptText, setModalAudioPromptText] = useState('');

  // Temp state for modal editing
  const [modalPrompt, setModalPrompt] = useState(null);
  const [modalPromptText, setModalPromptText] = useState('');
  const [saving, setSaving] = useState(false);
  const [loadingAllStudents, setLoadingAllStudents] = useState(false);

  // Student Screen Recording Access & Exam Integrity Settings
  const [examPeriods, setExamPeriods] = useState([]);
  const [newExamName, setNewExamName] = useState('');
  const [newExamStart, setNewExamStart] = useState('');
  const [newExamEnd, setNewExamEnd] = useState('');
  const [examPeriodError, setExamPeriodError] = useState('');
  const [studentRecordingsPolicy, setStudentRecordingsPolicy] = useState('always_enabled');
  const [studentRecordingsReleaseDate, setStudentRecordingsReleaseDate] = useState('');
  const [defaultLectureRecording, setDefaultLectureRecording] = useState(true);
  const [allowShareTeacherRecordings, setAllowShareTeacherRecordings] = useState(false);
  const [teacherRecordingsPolicy, setTeacherRecordingsPolicy] = useState('private');
  const [consolidateLessonVideo, setConsolidateLessonVideo] = useState(true);
  const [lectureAiModel, setLectureAiModel] = useState('gemini-3.8-flash');
  const [isLectureSubtitlesEnabled, setIsLectureSubtitlesEnabled] = useState(true);
  const [lectureRecordingPrompt, setLectureRecordingPrompt] = useState(DEFAULT_LECTURE_STT_PROMPT);
  const [lectureSttPrompt, setLectureSttPrompt] = useState(DEFAULT_LECTURE_STT_PROMPT);
  const [lectureTranslationPrompt, setLectureTranslationPrompt] = useState(DEFAULT_LECTURE_TRANSLATION_PROMPT);
  const [showTranslationPromptModal, setShowTranslationPromptModal] = useState(false);
  const [modalTranslationPrompt, setModalTranslationPrompt] = useState(null);
  const [modalTranslationPromptText, setModalTranslationPromptText] = useState('');
  const [lectureTargetLanguages, setLectureTargetLanguages] = useState(['en', 'zh-Hant', 'zh-Hans']);

  // Concept Template State
  const [selectedTemplate, setSelectedTemplate] = useState(DEFAULT_CLASS_TEMPLATE_ID);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(Boolean(embeddedClassId));

  const handleSelectTemplate = (templateId) => {
    setSelectedTemplate(templateId);
    const settings = getTemplateSettings(templateId);

    // Auto-sync template tag for dashboard filtering
    const templateTag = getClassTemplate(templateId)?.tag || getClassTemplate(templateId)?.name;
    if (templateTag) {
      setClassTags((prevTags) => {
        const otherTags = prevTags.filter((t) => !TEMPLATE_TAG_NAMES.includes(t));
        return [templateTag, ...otherTags];
      });
    }

    // Screen & Proctoring
    setAutomaticCapture(settings.automaticCapture);
    setCaptureMode(settings.captureMode);
    setAutomaticCombine(settings.automaticCombine);
    setRequireFullScreenOnly(settings.requireFullScreenOnly);
    setAiMonitoringMode(settings.aiMonitoringMode);
    setEnableClientAi(settings.enableClientAi);
    setEnableCloudFallback(settings.enableCloudFallback);
    setGazeSensitivity(settings.gazeSensitivity);
    setFaceDebounceSeconds(settings.faceDebounceSeconds);

    // Audio Monitoring
    setEnableAudioCapture(settings.enableAudioCapture);

    // Lecture Studio & Broadcast
    setDefaultLectureRecording(settings.defaultLectureRecording);
    setIsLectureSubtitlesEnabled(settings.isLectureSubtitlesEnabled);
    setTeacherRecordingsPolicy(settings.teacherRecordingsPolicy);
    setAllowShareTeacherRecordings(settings.allowShareTeacherRecordings);
    setConsolidateLessonVideo(settings.consolidateLessonVideo);
    setLectureAiModel(settings.lectureAiModel);

    // Bingo Presence
    setAutoBingoEnabled(settings.autoBingoEnabled);
    setAutoBingoIntervalMinutes(settings.autoBingoIntervalMinutes);
    setAutoBingoMode(settings.autoBingoMode);

    // Student Recordings Policy
    setStudentRecordingsPolicy(settings.studentRecordingsPolicy);
  };

  useEffect(() => {
    if (embeddedClassId) {
      setSelectedClass(embeddedClassId);
      setClassId(embeddedClassId);
    }
  }, [embeddedClassId]);

  // Load institutional student directory for seamless cross-class profile propagation
  useEffect(() => {
    let isMounted = true;
    const fetchDirectory = async () => {
      try {
        const dirMap = {};
        // 1. Query central studentDirectory collection
        const dirSnap = await getDocs(collection(db, 'studentDirectory'));
        if (dirSnap && typeof dirSnap.forEach === 'function') {
          dirSnap.forEach((d) => {
            const data = d.data() || {};
            const email = (data.email || d.id || '').trim().toLowerCase();
            if (email && email.includes('@')) {
              dirMap[email] = {
                studentName: data.studentName || '',
                nickname: data.nickname || '',
                programme: data.programme || '',
                studentClass: data.studentClass || '',
              };
            }
          });
        }

        // 2. Cross-class aggregation: scan accessible classes to merge student profile information & known tags
        try {
          const classesSnap = await getDocs(collection(db, 'classes'));
          const knownTagsSet = new Set();
          classesSnap.forEach((d) => {
            const cData = d.data() || {};
            if (Array.isArray(cData.tags)) {
              cData.tags.forEach((t) => {
                if (typeof t === 'string' && t.trim()) knownTagsSet.add(t.trim());
              });
            }
            if (cData.studentProfiles && typeof cData.studentProfiles === 'object') {
              for (const [rawE, prof] of Object.entries(cData.studentProfiles)) {
                const normE = rawE.trim().toLowerCase();
                if (normE && prof && typeof prof === 'object') {
                  const curr = dirMap[normE] || {};
                  dirMap[normE] = {
                    studentName: curr.studentName || prof.studentName || '',
                    nickname: curr.nickname || prof.nickname || '',
                    programme: curr.programme || prof.programme || '',
                    studentClass: curr.studentClass || prof.studentClass || '',
                  };
                }
              }
            }
          });
          if (isMounted) {
            setAllKnownTags([...knownTagsSet].sort());
          }
        } catch (classErr) {
          console.warn('Could not scan classes for student profiles & tags:', classErr);
        }

        if (isMounted) {
          setStudentDirectory(dirMap);
        }
      } catch (err) {
        console.warn('Could not load studentDirectory (teacher may have limited direct read):', err);
      }
    };
    fetchDirectory();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!user || embeddedClassId) return;

    const userProfileRef = doc(db, "teacherProfiles", user.uid);
    const unsubscribe = onSnapshot(userProfileRef, (profileSnap) => {
      if (profileSnap.exists()) {
        const profileData = profileSnap.data();
        const classIds = profileData.classes || [];
        const classesData = classIds.map(id => ({ id }));
        setClasses(classesData);
      } else {
        setClasses([]);
      }
    });

    return () => unsubscribe();
  }, [user, embeddedClassId]);

  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      collection(db, 'studentPasskeys'),
      (snapshot) => {
        const map = {};
        if (snapshot && typeof snapshot.forEach === 'function') {
          snapshot.forEach((d) => {
            const data = (typeof d?.data === 'function' ? d.data() : d?.data) || {};
            const email = (data.studentEmail || data.email || '').toLowerCase();
            const uid = data.studentUid || data.uid || d?.id;
            if (email) map[email] = { id: d?.id, ...data };
            if (uid) map[uid] = { id: d?.id, ...data };
          });
        } else if (Array.isArray(snapshot?.docs)) {
          snapshot.docs.forEach((d) => {
            const data = (typeof d?.data === 'function' ? d.data() : d?.data) || {};
            const email = (data.studentEmail || data.email || '').toLowerCase();
            const uid = data.studentUid || data.uid || d?.id;
            if (email) map[email] = { id: d?.id, ...data };
            if (uid) map[uid] = { id: d?.id, ...data };
          });
        }
        setRegisteredPasskeysMap(map);
      },
      (err) => {
        console.warn('[ClassManagement] Notice fetching studentPasskeys:', err);
      }
    );
    return () => unsub();
  }, [user]);

  // Real-time listener for system_config/loginPolicy (Password Whitelist / Passkey Exemption)
  useEffect(() => {
    if (!user) return;
    const unsub = onSnapshot(
      doc(db, 'system_config', 'loginPolicy'),
      (snapshot) => {
        if (snapshot && typeof snapshot.exists === 'function' && snapshot.exists()) {
          const data = snapshot.data() || {};
          const list = Array.isArray(data.passwordWhitelist) ? data.passwordWhitelist : [];
          const normalized = list.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : '')).filter(Boolean);
          setPasswordWhitelistSet(new Set(normalized));
        } else {
          setPasswordWhitelistSet(new Set());
        }
      },
      (err) => {
        console.warn('[ClassManagement] Notice fetching loginPolicy:', err);
      }
    );
    return () => unsub();
  }, [user]);

  // Real-time listener for classes/{activeId}/studentProperties (Passkey emergency bypasses)
  useEffect(() => {
    const activeId = embeddedClassId || selectedClass;
    if (!activeId) {
      setStudentBypassesMap({});
      return;
    }

    const unsub = onSnapshot(
      collection(db, 'classes', activeId, 'studentProperties'),
      (snapshot) => {
        const map = {};
        if (snapshot && snapshot.docs) {
          snapshot.docs.forEach((d) => {
            const data = (typeof d?.data === 'function' ? d.data() : d?.data) || {};
            const bypass = data.passkeyBypass;
            if (bypass && bypass.active) {
              const now = Date.now();
              const expires = bypass.expiresAtMillis || (bypass.expiresAt ? new Date(bypass.expiresAt).getTime() : 0);
              if (now < expires) {
                map[d.id] = bypass;
                if (data.studentEmail) {
                  map[data.studentEmail.toLowerCase()] = bypass;
                }
                if (data.email) {
                  map[data.email.toLowerCase()] = bypass;
                }
              }
            }
          });
        }
        setStudentBypassesMap(map);
      },
      (err) => {
        console.warn('[ClassManagement] Notice fetching studentProperties bypasses:', err);
      }
    );

    return () => unsub();
  }, [embeddedClassId, selectedClass]);

  useEffect(() => {
    const fetchClassDetails = async () => {
      const activeId = embeddedClassId || selectedClass;
      if (activeId) {
        const classRef = doc(db, 'classes', activeId);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists()) {
          const classData = classSnap.data();
          setClassId(activeId);
          setClassName(classData.name || '');
          setClassTags(Array.isArray(classData.tags) ? classData.tags : []);
          setTagInput('');
          setRetentionDays((classData.retentionDays || 30).toString());
          setVideoRetentionDays((classData.videoRetentionDays || 90).toString());
          if (classData.storageQuota) {
            setStorageLimit((classData.storageQuota / (1024 * 1024 * 1024)).toString());
          } else {
            setStorageLimit('5');
          }
          const history = Array.isArray(classData.scheduleHistory) ? classData.scheduleHistory : [];
          setScheduleHistory(history);
          if (classData.schedule) {
            setInitialSchedule(classData.schedule);
            setScheduleStartDate(classData.schedule.startDate || '');
            setScheduleEndDate(classData.schedule.endDate || '');
            setTimeZone(classData.schedule.timeZone || 'Asia/Hong_Kong');
            setClassSchedules(classData.schedule.timeSlots || []);

            try {
              const allLessons = generateLessons(
                classData.schedule,
                classData.schedule.timeZone || 'Asia/Hong_Kong',
                classData.customLessonTitles || {},
                history
              );
              const now = new Date();
              const past = allLessons.filter((l) => new Date(l.end) < now);
              setPastCompletedLessons(past);
            } catch (err) {
              console.warn('Error generating past lessons in ClassManagement:', err);
              setPastCompletedLessons([]);
            }
          } else {
            setInitialSchedule(null);
            setScheduleStartDate('');
            setScheduleEndDate('');
            setTimeZone('Asia/Hong_Kong');
            setClassSchedules([]);
            setPastCompletedLessons([]);
          }
          if (classData.teacherEmails) {
            setTeacherEmails(classData.teacherEmails.join('\n'));
          } else {
            setTeacherEmails('');
          }
          if (classData.studentEmails) {
            setStudentEmails(classData.studentEmails.join('\n'));
          } else {
            setStudentEmails('');
          }
          setStudentsMap(classData.students || {});
          setStudentProfiles(classData.studentProfiles || {});
          if (classData.ipRestrictions) {
            setIpRestrictions(classData.ipRestrictions.join('\n'));
          } else {
            setIpRestrictions('');
          }
          setAutomaticCapture(classData.automaticCapture || false);
          setAutomaticCombine(classData.automaticCombine || false);
          setCaptureMode(classData.captureMode || 'dual');
          setAiModel(classData.aiModel || 'gemini-3.5-flash-lite');
          setRequireFullScreenOnly(classData.requireFullScreenOnly !== false);
          setFaceDebounceSeconds(classData.faceDebounceSeconds || 3);
          setBingoRetryDelayMinutes(classData.bingoRetryDelayMinutes !== undefined ? classData.bingoRetryDelayMinutes : 3);
          setBingoTimeLimitSeconds(classData.bingoTimeLimitSeconds !== undefined ? classData.bingoTimeLimitSeconds : 30);
          setAutoBingoEnabled(Boolean(classData.autoBingoEnabled));
          setAutoBingoIntervalMinutes(classData.autoBingoIntervalMinutes !== undefined ? classData.autoBingoIntervalMinutes : 5);
          setAutoBingoMode(classData.autoBingoMode || 'question_bank');
          setBingoScoringRule(classData.bingoScoringRule || {
            enabled: true,
            baseCorrectPoints: 100,
            speedBonusMaxPoints: 50,
            rankBonus: { 1: 50, 2: 30, 3: 20 },
          });
          
          let derivedMode = classData.aiMonitoringMode;
          if (!derivedMode) {
            if (classData.enableClientAi === false && !classData.enableCloudFallback) derivedMode = 'disabled';
            else if (classData.enableClientAi === false && classData.enableCloudFallback) derivedMode = 'cloud_only';
            else if (classData.enableClientAi !== false && !classData.enableCloudFallback) derivedMode = 'client_only';
            else derivedMode = 'hybrid';
          }
          setAiMonitoringMode(derivedMode);
          setVoiceAiMode(classData.voiceAiMode || derivedMode);
          setEnableClientAi(derivedMode === 'hybrid' || derivedMode === 'client_only');
          setEnableCloudFallback(derivedMode === 'hybrid' || derivedMode === 'cloud_only');

          setGazeSensitivity(classData.gazeSensitivity || 'standard');
          setCustomYawAngle(classData.customYawAngle !== undefined ? classData.customYawAngle : 25);
          setCustomPitchDownAngle(classData.customPitchDownAngle !== undefined ? classData.customPitchDownAngle : -22);
          setCustomPitchUpAngle(classData.customPitchUpAngle !== undefined ? classData.customPitchUpAngle : 26);
          setCloudFallbackRate(classData.cloudFallbackRate || 3);
          setAfterClassVideoPrompt(classData.afterClassVideoPrompt || null);
          setLiveImagePrompt(classData.liveImagePrompt || null);
          setBingoPrompt(classData.bingoPrompt || null);
          setLiveAudioPrompt(classData.liveAudioPrompt || null);
          setSessionAudioPrompt(classData.sessionAudioPrompt || null);
          setGemmaIntentPrompt(classData.gemmaIntentPrompt || null);
          setSubtitlePrompt(classData.subtitlePrompt || null);
          setSubjectDomain(classData.subjectDomain || 'Computer Science & Software Development');
          setCustomSubjectDomain(classData.customSubjectDomain || '');
          setSessionAudioIntervalMinutes(classData.sessionAudioIntervalMinutes || 0);
          setEnableAudioCapture(classData.enableAudioCapture || false);
          setAudioCaptureMode(classData.audioCaptureMode || 'mandatory');
          setAudioSegmentDuration(classData.audioSegmentDuration || 30);
          setAudioSilenceSuppression(classData.audioSilenceSuppression !== false);
          setEnableSegmentTranscription(classData.enableSegmentTranscription || false);
          setEnableCombinedLongAudio(classData.enableCombinedLongAudio || false);
          setAudioMovingWindowDuration(classData.audioMovingWindowDuration || 30);
          setAudioMovingWindowStride(classData.audioMovingWindowStride || 15);
          setExamPeriods(classData.examPeriods || []);
          setNewExamName('');
          setNewExamStart('');
          setNewExamEnd('');
          setExamPeriodError('');
          setStudentRecordingsPolicy(classData.studentRecordingsPolicy || 'always_enabled');
          setStudentRecordingsReleaseDate(classData.studentRecordingsReleaseDate || '');
          setDefaultLectureRecording(classData.defaultLectureRecording !== undefined ? Boolean(classData.defaultLectureRecording) : true);
          const tPolicy = classData.teacherRecordingsPolicy || (classData.allowShareTeacherRecordings ? 'selective' : 'private');
          setTeacherRecordingsPolicy(tPolicy);
          setAllowShareTeacherRecordings(tPolicy !== 'private');
          setConsolidateLessonVideo(classData.consolidateLessonVideo !== false);
          setLectureAiModel(classData.lectureAiModel || 'gemini-3.8-flash');
          setIsLectureSubtitlesEnabled(classData.isLectureSubtitlesEnabled !== false);
          const loadedSttPrompt = classData.lectureSttPrompt || classData.lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT;
          const loadedTransPrompt = classData.lectureTranslationPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT;
          setLectureSttPrompt(loadedSttPrompt);
          setLectureRecordingPrompt(loadedSttPrompt);
          setLectureTranslationPrompt(loadedTransPrompt);
          const targetLangs = Array.isArray(classData.lectureTargetLanguages) && classData.lectureTargetLanguages.length > 0
            ? classData.lectureTargetLanguages
            : ['en', 'zh-Hant', 'zh-Hans'];
          setLectureTargetLanguages(targetLangs);

          let template = classData.classType;
          if (!template) {
            if (classData.requireFullScreenOnly === true && classData.automaticCapture !== false) {
              template = 'lecture_in_lab';
            } else if (classData.automaticCapture === false) {
              template = 'lecture';
            } else {
              template = 'lab';
            }
          }
          setSelectedTemplate(template);
          setShowAdvancedSettings(true);
        } else {
          if (!embeddedClassId) {
            alert(`Could not find data for class: ${activeId}.`);
            setSelectedClass(null);
          }
        }
      } else {
        // Reset form if no class is selected
        setClassId('');
        setClassName('');
        setClassTags([]);
        setTagInput('');
        setStorageLimit('5');
        setRetentionDays('30');
        setVideoRetentionDays('90');
        setScheduleStartDate('');
        setScheduleEndDate('');
        setTimeZone('Asia/Hong_Kong');
        setClassSchedules([]);
        setInitialSchedule(null);
        setScheduleHistory([]);
        setPastCompletedLessons([]);
        setTeacherEmails('');
        setStudentEmails('');
        setStudentProfiles({});
        setIpRestrictions('');
        setAutomaticCapture(true);
        setAutomaticCombine(true);
        setCaptureMode('dual');
        setRequireFullScreenOnly(true);
        setFaceDebounceSeconds(3);
        setEnableCloudFallback(false);
        setEnableAudioCapture(false);
        setAudioCaptureMode('mandatory');
        setAudioSegmentDuration(30);
        setAudioSilenceSuppression(true);
        setCloudFallbackRate(3);
        setAfterClassVideoPrompt(null);
        setLiveImagePrompt(null);
        setBingoPrompt(null);
        setLiveAudioPrompt(null);
        setSessionAudioPrompt(null);
        setGemmaIntentPrompt(null);
        setSubtitlePrompt(null);
        setSubjectDomain('Computer Science & Software Development');
        setCustomSubjectDomain('');
        setSessionAudioIntervalMinutes(0);
        setExamPeriods([]);
        setNewExamName('');
        setNewExamStart('');
        setNewExamEnd('');
        setExamPeriodError('');
        setStudentRecordingsPolicy('always_enabled');
        setStudentRecordingsReleaseDate('');
        setDefaultLectureRecording(true);
        setAllowShareTeacherRecordings(false);
        setTeacherRecordingsPolicy('private');
        setConsolidateLessonVideo(true);
        setLectureAiModel('gemini-3.8-flash');
        setIsLectureSubtitlesEnabled(true);
        setLectureSttPrompt(DEFAULT_LECTURE_STT_PROMPT);
        setLectureRecordingPrompt(DEFAULT_LECTURE_STT_PROMPT);
        setLectureTranslationPrompt(DEFAULT_LECTURE_TRANSLATION_PROMPT);
        setLectureTargetLanguages(['en', 'zh-Hant', 'zh-Hans']);
        setBingoTimeLimitSeconds(30);
        setAutoBingoEnabled(false);
        setAutoBingoIntervalMinutes(5);
        setAutoBingoMode('question_bank');
        setBingoScoringRule({
          enabled: true,
          baseCorrectPoints: 100,
          speedBonusMaxPoints: 50,
          rankBonus: { 1: 50, 2: 30, 3: 20 },
        });
        setSelectedTemplate(DEFAULT_CLASS_TEMPLATE_ID);
        setShowAdvancedSettings(false);
      }
    };
    fetchClassDetails();
  }, [selectedClass, embeddedClassId]);

  const validateClassId = (id) => {
    if (!id || id.trim().length === 0) {
      return 'Class ID cannot be empty.';
    }
    if (id.trim().length < 3) {
      return 'Class ID must be at least 3 characters long.';
    }
    if (id.length > 100) {
      return 'Class ID is too long.';
    }
    if (id.includes('/')) {
      return 'Class ID cannot contain slashes.';
    }
    return null;
  };

  const handleAddExamPeriod = () => {
    setExamPeriodError('');
    if (!newExamStart || !newExamEnd) {
      setExamPeriodError('Please select both a start date/time and end date/time for the exam period.');
      return;
    }
    const startMs = new Date(newExamStart).getTime();
    const endMs = new Date(newExamEnd).getTime();
    if (isNaN(startMs) || isNaN(endMs)) {
      setExamPeriodError('Invalid start or end date/time format.');
      return;
    }
    if (startMs >= endMs) {
      setExamPeriodError('Start date/time must be strictly before end date/time.');
      return;
    }

    const newPeriod = {
      id: `ep_${Date.now()}`,
      name: newExamName.trim() || 'Exam / Test Session',
      startDate: newExamStart,
      endDate: newExamEnd,
    };

    setExamPeriods([...examPeriods, newPeriod]);
    setNewExamName('');
    setNewExamStart('');
    setNewExamEnd('');
  };

  const handleRemoveExamPeriod = (periodId) => {
    setExamPeriods(examPeriods.filter((p) => p.id !== periodId));
  };

  const handleDownloadRosterTemplate = async () => {
    try {
      await generateStudentRosterTemplateExcel();
    } catch (err) {
      console.error('Failed to download Excel template:', err);
      alert('Failed to generate Excel template: ' + err.message);
    }
  };

  const handleImportEmailsFromFile = async (event, type = 'students') => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      let cleanUnique = [];
      let importedProfiles = {};

      if (type === 'students') {
        const lowerName = (file.name || '').toLowerCase();
        if (!lowerName.endsWith('.xlsx') && !lowerName.endsWith('.xls')) {
          alert('Please upload an Excel spreadsheet (.xlsx or .xls). CSV files are not supported.');
          return;
        }
        const parsed = await parseStudentRosterFile(file);
        if (parsed.emailList && parsed.emailList.length > 0) {
          cleanUnique = parsed.emailList;
          importedProfiles = parsed.profilesMap || {};
        }
      } else {
        const lowerName = (file.name || '').toLowerCase();
        if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
          const rows = await readExcelFile(file);
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const allText = JSON.stringify(rows);
          const matchedEmails = allText.match(emailRegex) || [];
          cleanUnique = [...new Set(matchedEmails.map(e => e.trim().toLowerCase()))];
        } else {
          const content = await readTextFileWithEncoding(file);
          const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
          const matchedEmails = content.match(emailRegex) || [];
          cleanUnique = [...new Set(matchedEmails.map(email => email.trim().toLowerCase()))];
        }
      }

      if (cleanUnique.length === 0) {
        alert('No valid email addresses found in the uploaded file.');
        return;
      }

      if (type === 'students') {
        const existing = studentEmails.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const merged = [...new Set([...existing, ...cleanUnique])];
        setStudentEmails(merged.join('\n'));

        // If spreadsheet contained profile metadata (names, Chinese nicknames, etc.), persist into state
        const profileCount = Object.keys(importedProfiles).length;
        if (profileCount > 0) {
          setStudentProfiles(prev => ({ ...prev, ...importedProfiles }));
          setStudentDirectory(prev => ({ ...prev, ...importedProfiles }));
        }

        const msg = profileCount > 0
          ? `Successfully imported ${cleanUnique.length} student(s) (${profileCount} with names/nicknames)!`
          : `Successfully imported ${cleanUnique.length} student email(s)!`;
        alert(msg);
      } else {
        const existing = teacherEmails.replace(/\n/g, ' ').split(/[, ]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
        const merged = [...new Set([...existing, ...cleanUnique])];
        setTeacherEmails(merged.join('\n'));
        alert(`Successfully imported ${cleanUnique.length} teacher email(s)!`);
      }
    } catch (err) {
      console.error('Failed to import emails from file:', err);
      alert('Failed to read selected file: ' + err.message);
    }
    event.target.value = '';
  };

  const handleExportEmailsToExcel = async (type = 'students') => {
    const emails = type === 'students'
      ? studentEmails.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean)
      : teacherEmails.replace(/\n/g, ' ').split(/[, ]+/).map(s => s.trim().toLowerCase()).filter(Boolean);

    if (emails.length === 0) {
      alert(`No ${type} emails to export.`);
      return;
    }

    const activeExportId = (embeddedClassId || selectedClass || classId || 'class').trim();
    if (type === 'students') {
      const exportProfiles = {};
      emails.forEach(email => {
        const lowerEmail = email.toLowerCase();
        const p1 = studentDirectory[email] || studentDirectory[lowerEmail] || {};
        const p2 = studentProfiles[email] || studentProfiles[lowerEmail] || {};
        exportProfiles[email] = {
          studentName: p2.studentName || p1.studentName || '',
          nickname: p2.nickname || p1.nickname || '',
          programme: p2.programme || p1.programme || '',
          studentClass: p2.studentClass || p1.studentClass || '',
        };
      });
      await exportStudentRosterExcel(emails, exportProfiles, activeExportId);
      return;
    }

    const headers = ['TeacherEmail', 'ClassID'];
    const rows = emails.map(email => [email, activeExportId]);
    await exportToExcel(headers, rows, `${activeExportId.toLowerCase()}_${type}_roster.xlsx`);
  };

  const handleInputAllStudents = async () => {
    setLoadingAllStudents(true);
    setError(null);
    try {
      let fetchedEmails = [];
      let fetchedProfiles = {};

      // 1. Try callable Cloud Function first (has access to adminAuth listUsers and Firestore)
      try {
        const getAllStudentsFn = httpsCallable(functions, 'getAllSystemStudentEmails');
        const result = await getAllStudentsFn();
        if (result?.data?.studentEmails && Array.isArray(result.data.studentEmails)) {
          fetchedEmails = result.data.studentEmails;
        }
        if (result?.data?.studentProfiles && typeof result.data.studentProfiles === 'object') {
          fetchedProfiles = result.data.studentProfiles;
        }
      } catch (fnErr) {
        console.warn('getAllSystemStudentEmails callable failed, falling back to direct Firestore query:', fnErr);
        // 2. Client-side fallback: query studentDirectory and classes collections
        const emailSet = new Set();
        try {
          const dirSnap = await getDocs(collection(db, 'studentDirectory'));
          if (dirSnap && typeof dirSnap.forEach === 'function') {
            dirSnap.forEach((d) => {
              const dData = d.data() || {};
              const em = (dData.email || d.id || '').trim().toLowerCase();
              if (em && em.includes('@')) {
                emailSet.add(em);
                fetchedProfiles[em] = {
                  studentName: dData.studentName || '',
                  nickname: dData.nickname || '',
                  programme: dData.programme || '',
                  studentClass: dData.studentClass || '',
                };
              }
            });
          }
        } catch {}

        const classesRef = collection(db, 'classes');
        const classesSnap = await getDocs(classesRef);
        classesSnap.forEach((d) => {
          const data = d.data();
          if (Array.isArray(data.studentEmails)) {
            data.studentEmails.forEach((e) => {
              if (typeof e === 'string' && e.includes('@')) {
                emailSet.add(e.trim().toLowerCase());
              }
            });
          }
          if (data.students && typeof data.students === 'object') {
            Object.values(data.students).forEach((e) => {
              if (typeof e === 'string' && e.includes('@')) {
                emailSet.add(e.trim().toLowerCase());
              }
            });
          }
          if (data.studentProfiles && typeof data.studentProfiles === 'object') {
            for (const [rawE, prof] of Object.entries(data.studentProfiles)) {
              const normE = rawE.trim().toLowerCase();
              if (normE && prof && typeof prof === 'object') {
                emailSet.add(normE);
                if (!fetchedProfiles[normE] || !fetchedProfiles[normE].studentName) {
                  fetchedProfiles[normE] = prof;
                }
              }
            }
          }
        });
        fetchedEmails = Array.from(emailSet);
      }

      const cleanFetched = [...new Set(fetchedEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))];

      if (cleanFetched.length === 0) {
        alert('No students found in the system yet.');
        return;
      }

      // Merge with existing emails in the textarea
      const existing = studentEmails.split(/[\n,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
      const merged = [...new Set([...existing, ...cleanFetched])];
      setStudentEmails(merged.join('\n'));

      // Populate known profiles from directory
      if (Object.keys(fetchedProfiles).length > 0) {
        setStudentDirectory(prev => ({ ...prev, ...fetchedProfiles }));
        setStudentProfiles(prev => ({ ...fetchedProfiles, ...prev }));
      }

      const newlyAddedCount = merged.length - existing.length;
      if (newlyAddedCount > 0) {
        alert(`Successfully populated ${newlyAddedCount} new student email(s) from the system (${merged.length} total enrolled)!`);
      } else {
        alert(`All ${cleanFetched.length} system student(s) are already included in the roster (${merged.length} total).`);
      }
    } catch (err) {
      console.error('Error fetching all students:', err);
      alert(`Failed to load system students: ${err.message || 'Unknown error'}`);
    } finally {
      setLoadingAllStudents(false);
    }
  };

  const handleResetStudentPasskey = async (email, studentName) => {
    const studentUid = Object.keys(studentsMap).find(u => (studentsMap[u] || '').toLowerCase() === email.toLowerCase());
    const targetLabel = studentName ? `${studentName} (${email})` : email;
    if (!window.confirm(`Reset Mobile Passkey for ${targetLabel}?\n\nThis will unlink their old phone so they can scan the pairing QR code on their PC to register their new phone.`)) {
      return;
    }

    setResettingPasskeys(prev => ({ ...prev, [email]: true }));
    try {
      const resetFn = httpsCallable(functions, 'resetStudentPasskey');
      await resetFn({
        studentUid: studentUid || null,
        studentEmail: email,
        classId: selectedClass || embeddedClassId || null,
        reason: 'Teacher reset in Class Management for phone replacement',
      });
      setPasskeyResetSuccess(`Passkey for ${targetLabel} has been reset successfully. Student can now pair their new phone.`);
      setTimeout(() => setPasskeyResetSuccess(''), 6000);
    } catch (err) {
      console.error('Failed to reset student passkey:', err);
      alert(`Failed to reset passkey: ${err.message || 'Unknown error'}`);
    } finally {
      setResettingPasskeys(prev => ({ ...prev, [email]: false }));
    }
  };

  const handleGrantStudentBypass = async (email, studentName) => {
    const studentUid = Object.keys(studentsMap).find(u => (studentsMap[u] || '').toLowerCase() === email.toLowerCase());
    const targetLabel = studentName ? `${studentName} (${email})` : email;
    const targetClass = selectedClass || embeddedClassId || classId;

    if (!targetClass) {
      alert('Please select a class before granting emergency bypass.');
      return;
    }

    const durationInput = window.prompt(
      `Grant Emergency Passkey Bypass for ${targetLabel}?\n\nEnter bypass duration in minutes (default 180 = 3 hours):`,
      '180'
    );

    if (durationInput === null) return; // User cancelled prompt
    const durationMin = parseInt(durationInput, 10);
    if (isNaN(durationMin) || durationMin <= 0) {
      alert('Please enter a valid positive number of minutes.');
      return;
    }

    setGrantingBypass(prev => ({ ...prev, [email]: true }));
    try {
      const approveFn = httpsCallable(functions, 'approveTeacherPasskeyBypass');
      await approveFn({
        classId: targetClass,
        studentUid: studentUid || null,
        studentEmail: email,
        teacherUid: auth.currentUser?.uid || null,
        teacherEmail: auth.currentUser?.email || 'teacher',
        bypassDurationMinutes: durationMin,
        approved: true,
      });

      setBypassSuccessMsg(`Emergency bypass granted for ${targetLabel} (${durationMin} min).`);
      if (bypassTimeoutRef.current) clearTimeout(bypassTimeoutRef.current);
      bypassTimeoutRef.current = setTimeout(() => {
        if (typeof window !== 'undefined') {
          setBypassSuccessMsg('');
        }
      }, 6000);
    } catch (err) {
      console.error('Failed to grant emergency bypass:', err);
      alert(`Failed to grant bypass: ${err.message || 'Unknown error'}`);
    } finally {
      setGrantingBypass(prev => ({ ...prev, [email]: false }));
    }
  };

  const handleToggleStudentExemption = async (email, studentName, isCurrentlyExempt) => {
    const studentUid = Object.keys(studentsMap).find(u => (studentsMap[u] || '').toLowerCase() === email.toLowerCase());
    const targetLabel = studentName ? `${studentName} (${email})` : email;

    let confirmMsg = '';
    if (!isCurrentlyExempt) {
      confirmMsg =
        `⚠️ UNCOMMON CASE CONFIRMATION ⚠️\n\n` +
        `Permanently exempt ${targetLabel} from mobile passkey authentication?\n\n` +
        `This permits the student to sign in on Desktop computers using only their password, completely bypassing mobile phone hardware passkey verification.\n\n` +
        `⚠️ Caution: This should ONLY be used for uncommon cases where a student's phone hardware physically cannot use Credential Manager (e.g. Huawei phones without Google Play Services or incompatible devices).\n\n` +
        `Are you sure you want to grant permanent passkey exemption?`;
    } else {
      confirmMsg =
        `Revoke permanent passkey exemption for ${targetLabel}?\n\n` +
        `The student will once again be required to authenticate with a personal mobile passkey on desktop computers.`;
    }

    if (!window.confirm(confirmMsg)) {
      return;
    }

    setTogglingExemption(prev => ({ ...prev, [email]: true }));
    try {
      const toggleFn = httpsCallable(functions, 'toggleStudentPasskeyExemption');
      await toggleFn({
        studentEmail: email,
        studentUid: studentUid || null,
        classId: selectedClass || embeddedClassId || null,
        exempt: !isCurrentlyExempt,
        reason: !isCurrentlyExempt
          ? 'Phone incompatible with Credential Manager (Teacher Exception)'
          : 'Revoked by Teacher',
      });

      const actionText = !isCurrentlyExempt ? 'Permanent passkey exemption granted' : 'Permanent passkey exemption revoked';
      setExemptionSuccessMsg(`${actionText} for ${targetLabel}.`);
      setTimeout(() => setExemptionSuccessMsg(''), 6000);
    } catch (err) {
      console.error('Failed to toggle student passkey exemption:', err);
      alert(`Failed to update passkey exemption: ${err.message || 'Unknown error'}`);
    } finally {
      setTogglingExemption(prev => ({ ...prev, [email]: false }));
    }
  };

  const handleAddTag = (tagToAdd) => {
    const raw = tagToAdd || tagInput;
    if (!raw || typeof raw !== 'string') return;
    const clean = raw.trim().replace(/^#+/, '');
    if (!clean) return;
    if (!classTags.includes(clean)) {
      setClassTags([...classTags, clean]);
    }
    setTagInput('');
  };

  const handleRemoveTag = (tagToRemove) => {
    setClassTags(classTags.filter((t) => t !== tagToRemove));
  };

  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const executeClassSave = async (payload, activeSchedule, historyToSave) => {
    const {
      targetClassId,
      classRef,
      teacherEmailList,
      studentEmailList,
      resolvedStudentProfiles,
      storageQuotaBytes,
      retentionDaysNum,
      videoRetentionDaysNum,
      ipList,
    } = payload;

    const updatedTeachers = [auth.currentUser.email, ...teacherEmailList];
    const uniqueTeachers = [...new Set(updatedTeachers.map((e) => e.trim().toLowerCase()).filter(Boolean))];

    const updateData = {
      classType: selectedTemplate || DEFAULT_CLASS_TEMPLATE_ID,
      name: className.trim() || targetClassId,
      tags: classTags,
      storageQuota: storageQuotaBytes,
      retentionDays: retentionDaysNum,
      videoRetentionDays: videoRetentionDaysNum,
      schedule: activeSchedule,
      scheduleHistory: historyToSave,
      studentEmails: studentEmailList,
      studentProfiles: resolvedStudentProfiles,
      teacherEmails: uniqueTeachers,
      ipRestrictions: ipList,
      automaticCapture: automaticCapture,
      automaticCombine: automaticCombine,
      captureMode: captureMode || 'dual',
      aiModel: aiModel || 'gemini-3.5-flash-lite',
      requireFullScreenOnly: requireFullScreenOnly !== false,
      faceDebounceSeconds: parseInt(faceDebounceSeconds, 10) || 3,
      bingoRetryDelayMinutes: parseInt(bingoRetryDelayMinutes, 10) || 3,
      bingoTimeLimitSeconds: parseInt(bingoTimeLimitSeconds, 10) || 30,
      autoBingoEnabled: Boolean(autoBingoEnabled),
      autoBingoIntervalMinutes: parseInt(autoBingoIntervalMinutes, 10) || 5,
      autoBingoMode: autoBingoMode || 'question_bank',
      bingoScoringRule: bingoScoringRule || null,
      aiMonitoringMode: aiMonitoringMode || 'hybrid',
      voiceAiMode: voiceAiMode || 'hybrid',
      enableClientAi: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only',
      gazeSensitivity: gazeSensitivity || 'standard',
      customYawAngle: parseInt(customYawAngle, 10) || 25,
      customPitchDownAngle: parseInt(customPitchDownAngle, 10) || -22,
      customPitchUpAngle: parseInt(customPitchUpAngle, 10) || 26,
      enableCloudFallback: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only',
      cloudFallbackRate: parseInt(cloudFallbackRate, 10) || 3,
      afterClassVideoPrompt: afterClassVideoPrompt || null,
      liveImagePrompt: liveImagePrompt || null,
      bingoPrompt: bingoPrompt || null,
      liveAudioPrompt: liveAudioPrompt || null,
      sessionAudioPrompt: sessionAudioPrompt || null,
      gemmaIntentPrompt: gemmaIntentPrompt || null,
      subtitlePrompt: subtitlePrompt || null,
      subjectDomain:
        subjectDomain === 'custom'
          ? customSubjectDomain.trim() || 'General Studies & Interdisciplinary'
          : subjectDomain || 'Computer Science & Software Development',
      customSubjectDomain: customSubjectDomain || '',
      sessionAudioIntervalMinutes: parseInt(sessionAudioIntervalMinutes, 10) || 0,
      enableAudioCapture: enableAudioCapture || false,
      audioCaptureMode: audioCaptureMode || 'mandatory',
      audioSegmentDuration: parseInt(audioSegmentDuration, 10) || 30,
      audioSilenceSuppression: audioSilenceSuppression !== false,
      enableSegmentTranscription: enableSegmentTranscription || false,
      enableCombinedLongAudio: enableCombinedLongAudio || false,
      audioMovingWindowDuration: parseInt(audioMovingWindowDuration, 10) || 30,
      audioMovingWindowStride: parseInt(audioMovingWindowStride, 10) || 15,
      examPeriods: examPeriods || [],
      studentRecordingsPolicy: studentRecordingsPolicy || 'always_enabled',
      studentRecordingsReleaseDate: studentRecordingsReleaseDate || '',
      defaultLectureRecording: defaultLectureRecording !== false,
      teacherRecordingsPolicy: teacherRecordingsPolicy || (allowShareTeacherRecordings ? 'selective' : 'private'),
      allowShareTeacherRecordings: teacherRecordingsPolicy ? teacherRecordingsPolicy !== 'private' : Boolean(allowShareTeacherRecordings),
      consolidateLessonVideo: consolidateLessonVideo !== false,
      lectureAiModel: lectureAiModel || 'gemini-3.8-flash',
      isLectureSubtitlesEnabled: isLectureSubtitlesEnabled !== false,
      lectureSttPrompt: lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT,
      lectureRecordingPrompt: lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT,
      lectureTranslationPrompt: lectureTranslationPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT,
      lectureTargetLanguages: Array.isArray(lectureTargetLanguages) && lectureTargetLanguages.length > 0 ? lectureTargetLanguages : ['en', 'zh-Hant', 'zh-Hans'],
    };

    await updateDoc(classRef, updateData);
    setStudentEmails(studentEmailList.join('\n'));
    setSuccessMessage('Class settings successfully updated!');

    setInitialSchedule(activeSchedule);
    setScheduleHistory(historyToSave);
    setScheduleStartDate(activeSchedule.startDate);
    setScheduleEndDate(activeSchedule.endDate);
    setClassSchedules(activeSchedule.timeSlots || []);
    setTimeZone(activeSchedule.timeZone || 'Asia/Hong_Kong');

    try {
      const refreshedLessons = generateLessons(
        activeSchedule,
        activeSchedule.timeZone || 'Asia/Hong_Kong',
        {},
        historyToSave
      );
      const now = new Date();
      setPastCompletedLessons(refreshedLessons.filter((l) => new Date(l.end) < now));
    } catch (e) {
      console.warn('Error recalculating past lessons:', e);
    }

    // Sync all profiles to institutional studentDirectory
    try {
      const dirBatch = writeBatch(db);
      let dirCount = 0;
      for (const [normEmail, prof] of Object.entries(resolvedStudentProfiles)) {
        if (!normEmail || !prof || typeof prof !== 'object') continue;
        if (!prof.studentName && !prof.nickname && !prof.programme && !prof.studentClass) continue;
        const dirRef = doc(db, 'studentDirectory', normEmail);
        dirBatch.set(
          dirRef,
          {
            email: normEmail,
            studentName: prof.studentName || '',
            nickname: prof.nickname || '',
            programme: prof.programme || '',
            studentClass: prof.studentClass || '',
            lastUpdatedByClass: targetClassId,
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        dirCount++;
      }
      if (dirCount > 0) {
        await dirBatch.commit();
        setStudentDirectory((prev) => ({ ...prev, ...resolvedStudentProfiles }));
      }
    } catch (dirErr) {
      console.warn('Direct studentDirectory batch sync skipped (backend trigger handles sync):', dirErr);
    }
    setStudentProfiles(resolvedStudentProfiles);
    setPendingSavePayload(null);
  };

  const handleConfirmScheduleChange = async ({ action }) => {
    setShowScheduleChangeModal(false);
    if (!pendingSavePayload) return;

    setSaving(true);
    try {
      let finalActiveSchedule = {
        startDate: scheduleStartDate,
        endDate: scheduleEndDate,
        timeZone: timeZone,
        timeSlots: classSchedules,
      };
      let finalScheduleHistory = [...(scheduleHistory || [])];

      if (action === 'archive_and_apply') {
        const tz = timeZone || 'Asia/Hong_Kong';
        const now = new Date();
        const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(yesterday);

        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);

        const latestPastLesson = pastCompletedLessons[0];
        const latestPastDateStr = latestPastLesson?.start
          ? new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(latestPastLesson.start))
          : null;

        let archiveEndDate = yesterdayStr;
        let newStartDate = todayStr;

        if (latestPastDateStr && latestPastDateStr >= todayStr) {
          archiveEndDate = todayStr;
          newStartDate = tomorrowStr;
        }

        if (scheduleStartDate && scheduleStartDate > newStartDate) {
          newStartDate = scheduleStartDate;
          const dBefore = new Date(newStartDate + 'T00:00:00Z');
          dBefore.setUTCDate(dBefore.getUTCDate() - 1);
          archiveEndDate = dBefore.toISOString().split('T')[0];
        }

        if (archiveEndDate < (initialSchedule?.startDate || archiveEndDate)) {
          archiveEndDate = initialSchedule.startDate;
        }

        const archivedSegment = {
          startDate: initialSchedule?.startDate || archiveEndDate,
          endDate: archiveEndDate,
          timeZone: initialSchedule?.timeZone || tz,
          timeSlots: initialSchedule?.timeSlots || [],
          archivedAt: new Date().toISOString(),
        };

        finalScheduleHistory.push(archivedSegment);
        finalActiveSchedule = {
          ...finalActiveSchedule,
          startDate: newStartDate,
        };
      }

      await executeClassSave(pendingSavePayload, finalActiveSchedule, finalScheduleHistory);
    } catch (err) {
      console.error('Error saving schedule change:', err);
      setError('Failed to update class schedule: ' + (err.message || 'Unknown error'));
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateClass = async () => {
    const activeClassId = (embeddedClassId || selectedClass || '').trim();
    const targetClassId = activeClassId || (classId || '').trim();
    const validationError = validateClassId(targetClassId);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (scheduleStartDate && scheduleEndDate && scheduleEndDate < scheduleStartDate) {
      setError('Schedule end date cannot be before the start date.');
      return;
    }

    if (!scheduleStartDate || !scheduleEndDate || classSchedules.length === 0) {
      setError('Schedule information is required. Please provide a start date, end date, and at least one time slot.');
      return;
    }
    
    if (!auth.currentUser) {
      setError('You must be logged in to manage classes.');
      return;
    }

    setError(null);
    setSuccessMessage('');
    setSaving(true);

    const classRef = doc(db, 'classes', targetClassId);
    const classSnap = await getDoc(classRef);
    const studentEmailList = [...new Set(
      studentEmails
        .split(/[\n,]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
    )];
    
    const teacherEmailList = teacherEmails
      .replace(/\n/g, ' ')
      .split(/[, ]+/)
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);

    const storageQuotaBytes = parseInt(storageLimit) * 1024 * 1024 * 1024;
    const retentionDaysNum = parseInt(retentionDays, 10) > 0 ? parseInt(retentionDays, 10) : 30;
    const videoRetentionDaysNum = parseInt(videoRetentionDays, 10) > 0 ? parseInt(videoRetentionDays, 10) : 90;
    const ipList = ipRestrictions.split('\n').map(ip => ip.trim()).filter(Boolean);

    // Cross-class student profile propagation: merge with directory profiles for all enrolled students
    const resolvedStudentProfiles = { ...studentProfiles };
    studentEmailList.forEach((email) => {
      const explicit = resolvedStudentProfiles[email] || {};
      const fromDir = studentDirectory[email] || {};
      if (fromDir.studentName || fromDir.nickname || fromDir.programme || fromDir.studentClass) {
        resolvedStudentProfiles[email] = {
          studentName: explicit.studentName || fromDir.studentName || '',
          nickname: explicit.nickname || fromDir.nickname || '',
          programme: explicit.programme || fromDir.programme || '',
          studentClass: explicit.studentClass || fromDir.studentClass || '',
          updatedAt: explicit.updatedAt || fromDir.updatedAt || new Date().toISOString(),
        };
      }
    });

    try {
      const payload = {
        targetClassId,
        classRef,
        teacherEmailList,
        studentEmailList,
        resolvedStudentProfiles,
        storageQuotaBytes,
        retentionDaysNum,
        videoRetentionDaysNum,
        ipList,
      };

      if (classSnap.exists()) {
        const scheduleChanged = initialSchedule && (
          initialSchedule.startDate !== scheduleStartDate ||
          initialSchedule.endDate !== scheduleEndDate ||
          initialSchedule.timeZone !== timeZone ||
          JSON.stringify(initialSchedule.timeSlots || []) !== JSON.stringify(classSchedules || [])
        );

        if (scheduleChanged && pastCompletedLessons.length > 0) {
          setPendingSavePayload(payload);
          setSaving(false);
          setShowScheduleChangeModal(true);
          return;
        }

        const activeSchedule = {
          startDate: scheduleStartDate,
          endDate: scheduleEndDate,
          timeZone: timeZone,
          timeSlots: classSchedules,
        };
        await executeClassSave(payload, activeSchedule, scheduleHistory || []);
      } else {
        const initialTeachers = [auth.currentUser.email, ...teacherEmailList];
        const uniqueTeachers = [...new Set(initialTeachers.map(e => e.trim().toLowerCase()).filter(Boolean))];

        const newSchedule = {
          startDate: scheduleStartDate,
          endDate: scheduleEndDate,
          timeZone: timeZone,
          timeSlots: classSchedules,
        };

        await setDoc(classRef, {
          classType: selectedTemplate || DEFAULT_CLASS_TEMPLATE_ID,
          name: className.trim() || targetClassId,
          tags: classTags,
          teacherEmails: uniqueTeachers,
          studentEmails: studentEmailList,
          studentProfiles: resolvedStudentProfiles,
          storageQuota: storageQuotaBytes,
          retentionDays: retentionDaysNum,
          videoRetentionDays: videoRetentionDaysNum,
          schedule: newSchedule,
          scheduleHistory: [],
          storageUsage: 0,
          ipRestrictions: ipList,
          automaticCapture: automaticCapture,
          automaticCombine: automaticCombine,
          captureMode: captureMode || 'dual',
          aiModel: aiModel || 'gemini-3.5-flash-lite',
          requireFullScreenOnly: requireFullScreenOnly !== false,
          faceDebounceSeconds: parseInt(faceDebounceSeconds, 10) || 3,
          bingoRetryDelayMinutes: parseInt(bingoRetryDelayMinutes, 10) || 3,
          bingoTimeLimitSeconds: parseInt(bingoTimeLimitSeconds, 10) || 30,
          autoBingoEnabled: Boolean(autoBingoEnabled),
          autoBingoIntervalMinutes: parseInt(autoBingoIntervalMinutes, 10) || 5,
          autoBingoMode: autoBingoMode || 'question_bank',
          bingoScoringRule: bingoScoringRule || null,
          aiMonitoringMode: aiMonitoringMode || 'hybrid',
          voiceAiMode: voiceAiMode || 'hybrid',
          enableClientAi: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only',
          gazeSensitivity: gazeSensitivity || 'standard',
          customYawAngle: parseInt(customYawAngle, 10) || 25,
          customPitchDownAngle: parseInt(customPitchDownAngle, 10) || -22,
          customPitchUpAngle: parseInt(customPitchUpAngle, 10) || 26,
          enableCloudFallback: aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only',
          cloudFallbackRate: parseInt(cloudFallbackRate, 10) || 3,
          afterClassVideoPrompt: afterClassVideoPrompt || null,
          liveImagePrompt: liveImagePrompt || null,
          bingoPrompt: bingoPrompt || null,
          liveAudioPrompt: liveAudioPrompt || null,
          sessionAudioPrompt: sessionAudioPrompt || null,
          gemmaIntentPrompt: gemmaIntentPrompt || null,
          subtitlePrompt: subtitlePrompt || null,
          subjectDomain: subjectDomain === 'custom' ? (customSubjectDomain.trim() || 'General Studies & Interdisciplinary') : (subjectDomain || 'Computer Science & Software Development'),
          customSubjectDomain: customSubjectDomain || '',
          sessionAudioIntervalMinutes: parseInt(sessionAudioIntervalMinutes, 10) || 0,
          enableAudioCapture: enableAudioCapture || false,
          audioCaptureMode: audioCaptureMode || 'mandatory',
          audioSegmentDuration: parseInt(audioSegmentDuration, 10) || 30,
          audioSilenceSuppression: audioSilenceSuppression !== false,
          enableSegmentTranscription: enableSegmentTranscription || false,
          enableCombinedLongAudio: enableCombinedLongAudio || false,
          audioMovingWindowDuration: parseInt(audioMovingWindowDuration, 10) || 30,
          audioMovingWindowStride: parseInt(audioMovingWindowStride, 10) || 15,
          examPeriods: examPeriods || [],
          studentRecordingsPolicy: studentRecordingsPolicy || 'always_enabled',
          studentRecordingsReleaseDate: studentRecordingsReleaseDate || '',
          defaultLectureRecording: defaultLectureRecording !== false,
          teacherRecordingsPolicy: teacherRecordingsPolicy || (allowShareTeacherRecordings ? 'selective' : 'private'),
          allowShareTeacherRecordings: teacherRecordingsPolicy ? teacherRecordingsPolicy !== 'private' : Boolean(allowShareTeacherRecordings),
          consolidateLessonVideo: consolidateLessonVideo !== false,
          lectureAiModel: lectureAiModel || 'gemini-3.8-flash',
          isLectureSubtitlesEnabled: isLectureSubtitlesEnabled !== false,
          lectureSttPrompt: lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT,
          lectureRecordingPrompt: lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT,
          lectureTranslationPrompt: lectureTranslationPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT,
          lectureTargetLanguages: Array.isArray(lectureTargetLanguages) && lectureTargetLanguages.length > 0 ? lectureTargetLanguages : ['en', 'zh-Hant', 'zh-Hans'],
          aiQuota: 50,
          aiUsedQuota: 0,
        });

        setSuccessMessage('Class successfully created!');
        setInitialSchedule(newSchedule);
        setScheduleHistory([]);
        setPastCompletedLessons([]);
        if (!embeddedClassId) {
          setClasses(prev => [...prev, { id: targetClassId }]);
          setSelectedClass(targetClassId);
        }

        // Sync all profiles to institutional studentDirectory
        try {
          const dirBatch = writeBatch(db);
          let dirCount = 0;
          for (const [normEmail, prof] of Object.entries(resolvedStudentProfiles)) {
            if (!normEmail || !prof || typeof prof !== 'object') continue;
            if (!prof.studentName && !prof.nickname && !prof.programme && !prof.studentClass) continue;
            const dirRef = doc(db, 'studentDirectory', normEmail);
            dirBatch.set(dirRef, {
              email: normEmail,
              studentName: prof.studentName || '',
              nickname: prof.nickname || '',
              programme: prof.programme || '',
              studentClass: prof.studentClass || '',
              lastUpdatedByClass: targetClassId,
              updatedAt: new Date().toISOString(),
            }, { merge: true });
            dirCount++;
          }
          if (dirCount > 0) {
            await dirBatch.commit();
            setStudentDirectory(prev => ({ ...prev, ...resolvedStudentProfiles }));
          }
        } catch (dirErr) {
          console.warn('Direct studentDirectory batch sync skipped (backend trigger handles sync):', dirErr);
        }
        setStudentProfiles(resolvedStudentProfiles);
      }
    } catch (err) {
      console.error('Error updating or creating class:', err);
      setError(err.message || 'Failed to save class.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClass = async () => {
    const activeId = embeddedClassId || selectedClass;
    if (!activeId) {
      alert('Please select a class to delete.');
      return;
    }

    if (window.confirm(`Are you sure you want to delete class "${activeId}"? This action cannot be undone.`)) {
      try {
        const classRef = doc(db, 'classes', activeId);
        await deleteDoc(classRef);
        alert('Class deleted successfully.');
        if (!embeddedClassId) {
          setSelectedClass(null);
        }
      } catch (err) {
        console.error('Error deleting class:', err);
        alert('Error deleting class: ' + err.message);
      }
    }
  };

  const handleOpenPromptModal = () => {
    setModalPrompt(afterClassVideoPrompt);
    setModalPromptText(afterClassVideoPrompt ? (afterClassVideoPrompt.promptText || '') : '');
    setShowPromptModal(true);
  };

  const handleSetPrompt = () => {
    if (modalPrompt) {
      const chosenText = modalPromptText || modalPrompt.promptText || '';
      const isModified = modalPrompt.promptText ? (modalPrompt.promptText !== chosenText) : false;
      const promptId = modalPrompt.id || modalPrompt.originalId || null;
      const finalPrompt = {
        ...modalPrompt,
        promptText: chosenText,
        name: isModified && modalPrompt.name ? `${modalPrompt.name} (Customized)` : (modalPrompt.name || 'Custom Prompt'),
        originalId: promptId,
        id: promptId,
      };
      setAfterClassVideoPrompt(finalPrompt);
    } else if (modalPromptText.trim()) {
      setAfterClassVideoPrompt({
        name: 'Custom Prompt',
        promptText: modalPromptText,
        category: 'videos',
      });
    } else {
      setAfterClassVideoPrompt(null);
    }
    setShowPromptModal(false);
  };

  const handleOpenAudioPromptModal = (type) => {
    setAudioPromptModalType(type);
    let target = null;
    if (type === 'live_audio') target = liveAudioPrompt;
    else if (type === 'session_audio') target = sessionAudioPrompt;
    else if (type === 'gemma_intent') target = gemmaIntentPrompt;
    else if (type === 'subtitle') target = subtitlePrompt;
    else if (type === 'lecture_recording') target = lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT;

    setModalAudioPrompt(target);
    setModalAudioPromptText(target ? (target.promptText || '') : '');
    setShowAudioPromptModal(true);
  };

  const handleSetAudioPrompt = () => {
    let finalPrompt = null;
    if (modalAudioPrompt) {
      const chosenText = modalAudioPromptText || modalAudioPrompt.promptText || '';
      const isModified = modalAudioPrompt.promptText ? (modalAudioPrompt.promptText !== chosenText) : false;
      const promptId = modalAudioPrompt.id || modalAudioPrompt.originalId || null;
      finalPrompt = {
        ...modalAudioPrompt,
        promptText: chosenText,
        name: isModified && modalAudioPrompt.name ? `${modalAudioPrompt.name} (Customized)` : (modalAudioPrompt.name || (audioPromptModalType === 'subtitle' ? 'Custom Subtitle Prompt' : audioPromptModalType === 'lecture_recording' ? 'Custom STT Prompt' : 'Custom Voice Prompt')),
        originalId: promptId,
        id: promptId,
      };
    } else if (modalAudioPromptText.trim()) {
      finalPrompt = {
        name: audioPromptModalType === 'subtitle' ? 'Custom Subtitle Prompt' : audioPromptModalType === 'lecture_recording' ? 'Custom STT Prompt' : 'Custom Voice Prompt',
        promptText: modalAudioPromptText,
        category: audioPromptModalType === 'subtitle' ? 'translations' : 'audios',
      };
    }

    if (audioPromptModalType === 'live_audio') {
      setLiveAudioPrompt(finalPrompt);
    } else if (audioPromptModalType === 'session_audio') {
      setSessionAudioPrompt(finalPrompt);
    } else if (audioPromptModalType === 'gemma_intent') {
      setGemmaIntentPrompt(finalPrompt);
    } else if (audioPromptModalType === 'subtitle') {
      setSubtitlePrompt(finalPrompt);
    } else if (audioPromptModalType === 'lecture_recording') {
      const promptToSet = finalPrompt || DEFAULT_LECTURE_STT_PROMPT;
      setLectureSttPrompt(promptToSet);
      setLectureRecordingPrompt(promptToSet);
    }
    setShowAudioPromptModal(false);
  };

  const handleOpenTranslationPromptModal = () => {
    const target = lectureTranslationPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT;
    setModalTranslationPrompt(target);
    setModalTranslationPromptText(target ? (target.promptText || '') : '');
    setShowTranslationPromptModal(true);
  };

  const handleSetTranslationPrompt = () => {
    let finalPrompt = null;
    if (modalTranslationPrompt) {
      const chosenText = modalTranslationPromptText || modalTranslationPrompt.promptText || '';
      const isModified = modalTranslationPrompt.promptText ? (modalTranslationPrompt.promptText !== chosenText) : false;
      const promptId = modalTranslationPrompt.id || modalTranslationPrompt.originalId || null;
      finalPrompt = {
        ...modalTranslationPrompt,
        promptText: chosenText,
        name: isModified && modalTranslationPrompt.name ? `${modalTranslationPrompt.name} (Customized)` : (modalTranslationPrompt.name || 'Custom Translation Prompt'),
        originalId: promptId,
        id: promptId,
        category: 'translations',
      };
    } else if (modalTranslationPromptText.trim()) {
      finalPrompt = {
        name: 'Custom Translation Prompt',
        promptText: modalTranslationPromptText,
        category: 'translations',
      };
    }

    setLectureTranslationPrompt(finalPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT);
    setShowTranslationPromptModal(false);
  };

  const handleOpenImagePromptModal = (type = 'live_image') => {
    setImagePromptModalType(type);
    const target = type === 'bingo' ? bingoPrompt : liveImagePrompt;
    setModalImagePrompt(target);
    setModalImagePromptText(target ? (target.promptText || '') : '');
    setShowImagePromptModal(true);
  };

  const handleSetImagePrompt = () => {
    let finalPrompt = null;
    const isBingo = imagePromptModalType === 'bingo';
    if (modalImagePrompt) {
      const chosenText = modalImagePromptText || modalImagePrompt.promptText || '';
      const isModified = modalImagePrompt.promptText ? (modalImagePrompt.promptText !== chosenText) : false;
      const promptId = modalImagePrompt.id || modalImagePrompt.originalId || null;
      finalPrompt = {
        ...modalImagePrompt,
        promptText: chosenText,
        name: isModified && modalImagePrompt.name ? `${modalImagePrompt.name} (Customized)` : (modalImagePrompt.name || (isBingo ? 'Custom Bingo Prompt' : 'Custom Image Prompt')),
        originalId: promptId,
        id: promptId,
      };
    } else if (modalImagePromptText.trim()) {
      finalPrompt = {
        name: isBingo ? 'Custom Bingo Prompt' : 'Custom Image Prompt',
        promptText: modalImagePromptText,
        category: 'images',
      };
    }

    if (isBingo) {
      setBingoPrompt(finalPrompt);
    } else {
      setLiveImagePrompt(finalPrompt);
    }
    setShowImagePromptModal(false);
  };

  return (
    <div className="class-management-container">
      {/* Video Prompt Modal */}
      <Modal show={showPromptModal} onClose={() => setShowPromptModal(false)} title="Select After-Class Video Prompt">
        <VideoPromptSelector
          user={user}
          selectedPrompt={modalPrompt}
          onSelectPrompt={(p) => {
            setModalPrompt(p);
            setModalPromptText(p ? p.promptText : '');
          }}
          promptText={modalPromptText}
          onTextChange={setModalPromptText}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button type="button" className="secondary-btn" onClick={() => { setAfterClassVideoPrompt(null); setShowPromptModal(false); }}>
            Clear Prompt
          </button>
          <button type="button" onClick={handleSetPrompt}>
            Save Prompt Selection
          </button>
        </div>
      </Modal>

      {/* Audio & Voice AI Prompt Modal */}
      <Modal
        show={showAudioPromptModal}
        onClose={() => setShowAudioPromptModal(false)}
        title={
          audioPromptModalType === 'live_audio'
            ? 'Select Live Audio Invigilation Prompt'
            : audioPromptModalType === 'session_audio'
              ? 'Select Discussion / Session Audio Summary Prompt'
              : audioPromptModalType === 'subtitle'
                ? 'Select Live Subtitles & Translation Prompt'
                : audioPromptModalType === 'lecture_recording'
                  ? 'Select Lecture Audio Speech-to-Text & Chapters Prompt'
                  : 'Select On-Device Gemma Voice Intent Prompt'
        }
      >
        <AudioPromptSelector
          user={user}
          selectedPrompt={modalAudioPrompt}
          onSelectPrompt={(p) => {
            setModalAudioPrompt(p);
            setModalAudioPromptText(p ? p.promptText : '');
          }}
          promptText={modalAudioPromptText}
          onTextChange={setModalAudioPromptText}
          applyToFilter={
            audioPromptModalType === 'live_audio'
              ? 'Live Audio Invigilation'
              : audioPromptModalType === 'session_audio'
                ? 'Session Audio Summary'
                : audioPromptModalType === 'subtitle'
                  ? 'Live Subtitles & Translation'
                  : audioPromptModalType === 'lecture_recording'
                    ? 'Lecture STT & Chapters'
                    : 'On-Device Gemma Voice Intent'
          }
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              if (audioPromptModalType === 'live_audio') setLiveAudioPrompt(null);
              else if (audioPromptModalType === 'session_audio') setSessionAudioPrompt(null);
              else if (audioPromptModalType === 'gemma_intent') setGemmaIntentPrompt(null);
              else if (audioPromptModalType === 'subtitle') setSubtitlePrompt(null);
              else if (audioPromptModalType === 'lecture_recording') {
                setLectureSttPrompt(DEFAULT_LECTURE_STT_PROMPT);
                setLectureRecordingPrompt(DEFAULT_LECTURE_STT_PROMPT);
              }
              setShowAudioPromptModal(false);
            }}
          >
            {audioPromptModalType === 'lecture_recording' ? 'Reset to Default' : 'Clear Prompt'}
          </button>
          <button type="button" onClick={handleSetAudioPrompt}>
            Save Prompt Selection
          </button>
        </div>
      </Modal>

      {/* Lecture Subtitle Translation Prompt Modal */}
      <Modal
        show={showTranslationPromptModal}
        onClose={() => setShowTranslationPromptModal(false)}
        title="Select Lecture Subtitle Translation Prompt"
      >
        <TranslationPromptSelector
          user={user}
          selectedPrompt={modalTranslationPrompt}
          onSelectPrompt={(p) => {
            setModalTranslationPrompt(p);
            setModalTranslationPromptText(p ? p.promptText : '');
          }}
          promptText={modalTranslationPromptText}
          onTextChange={setModalTranslationPromptText}
          applyToFilter="Lecture Subtitle Translation"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setLectureTranslationPrompt(DEFAULT_LECTURE_TRANSLATION_PROMPT);
              setShowTranslationPromptModal(false);
            }}
          >
            Reset to Default
          </button>
          <button type="button" onClick={handleSetTranslationPrompt}>
            Save Prompt Selection
          </button>
        </div>
      </Modal>

      {/* Image & Bingo AI Prompt Modal */}
      <Modal
        show={showImagePromptModal}
        onClose={() => setShowImagePromptModal(false)}
        title={imagePromptModalType === 'bingo' ? 'Select Bingo Active Presence AI Prompt' : 'Select Live Image & Screen Invigilation Prompt'}
      >
        <ImagePromptSelector
          user={user}
          applyToFilter={imagePromptModalType === 'bingo' ? 'Classroom Bingo Questions' : 'Per Image'}
          selectedPrompt={modalImagePrompt}
          onSelectPrompt={(p) => {
            setModalImagePrompt(p);
            setModalImagePromptText(p ? p.promptText : '');
          }}
          promptText={modalImagePromptText}
          onTextChange={setModalImagePromptText}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              if (imagePromptModalType === 'bingo') setBingoPrompt(null);
              else setLiveImagePrompt(null);
              setShowImagePromptModal(false);
            }}
          >
            Clear Prompt
          </button>
          <button type="button" onClick={handleSetImagePrompt}>
            Save Prompt Selection
          </button>
        </div>
      </Modal>

      {!embeddedClassId && (
        <div className="class-management-header">
          <div>
            <h2>Class Management & Configuration</h2>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)', fontSize: '0.95rem' }}>
              {selectedClass ? `Configure Class: ${selectedClass}` : 'Create a New Class'}
            </p>
          </div>
        </div>
      )}

      {/* Class Selector for standalone mode */}
      {!embeddedClassId && (
        <div className="class-selector-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label htmlFor="select-class-to-manage" style={{ fontWeight: 600 }}>Select a Class to Edit or Configure:</label>
              <select
                id="select-class-to-manage"
                onChange={(e) => setSelectedClass(e.target.value)}
                value={selectedClass || ''}
              >
                <option value="">-- Create a New Class --</option>
                {classes.map(c => (
                  <option key={c.id} value={c.id}>{c.id}</option>
                ))}
              </select>
            </div>
            {selectedClass && (
              <a href={`/class/${selectedClass}`} className="open-workspace-btn" style={{ textDecoration: 'none' }}>
                Open Class Workspace →
              </a>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-message">⚠️ {error}</div>}
      {successMessage && <div className="success-message">✓ {successMessage}</div>}

      {/* Concept Template Selector */}
      <div className="template-selector-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>🎯</span> Select Class Concept Template
            </h3>
            <p style={{ margin: '0.25rem 0 0 0', color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
              Choose a pedagogical template to automatically preset recommended screen capture, anti-distraction, recording studio, and proctoring settings.
            </p>
          </div>
          {selectedTemplate && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.35rem 0.75rem' }}
              onClick={() => handleSelectTemplate(selectedTemplate)}
              title="Reset all settings below to the defaults for this template"
            >
              🔄 Re-apply Presets
            </button>
          )}
        </div>

        <div className="template-grid">
          {Object.values(CLASS_TEMPLATES).map((tmpl) => {
            const isSelected = selectedTemplate === tmpl.id;
            return (
              <div
                key={tmpl.id}
                role="button"
                tabIndex={0}
                className={`template-card ${isSelected ? 'active' : ''}`}
                onClick={() => handleSelectTemplate(tmpl.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleSelectTemplate(tmpl.id);
                  }
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ fontSize: '1.75rem' }}>{tmpl.icon}</span>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span className="template-badge">{tmpl.badge}</span>
                      <span style={{ fontSize: '0.72rem', background: '#e0e7ff', color: '#3730a3', padding: '2px 7px', borderRadius: '4px', fontWeight: 600 }}>
                        #{tmpl.tag || tmpl.name}
                      </span>
                    </div>
                  </div>
                  <h4 style={{ margin: '0.25rem 0 0.5rem 0', fontSize: '1.1rem', color: isSelected ? 'var(--color-primary)' : 'inherit' }}>
                    {tmpl.name}
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-muted)', lineHeight: '1.4' }}>
                    {tmpl.description}
                  </p>
                </div>

                <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border, #cbd5e1)' }}>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.8rem', color: 'var(--color-text-secondary, #475569)' }}>
                    {tmpl.highlights.map((h, i) => (
                      <li key={i} style={{ marginBottom: '0.2rem' }}>{h}</li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 1: Basic Information & Storage */}
      <div className="settings-section-card">
        <h3>📋 1. Basic Information & Storage Quota</h3>
        
        <div className="form-row-2col">
          <div className="form-group">
            <label>Class ID / Course Code <span style={{ color: '#ef4444' }}>*</span></label>
            <input
              type="text"
              placeholder="e.g. it114115-2026-s1"
              value={classId}
              onChange={(e) => setClassId(e.target.value.toLowerCase())}
              disabled={!!selectedClass || !!embeddedClassId}
            />
            <p className="input-hint">Unique identifier, lowercase.</p>
          </div>

          <div className="form-group">
            <label>Class Display Name</label>
            <input
              type="text"
              placeholder="e.g. Cloud Architecture Lab"
              value={className}
              onChange={(e) => setClassName(e.target.value)}
            />
          </div>
        </div>

        {/* Class Tags Editor */}
        <div className="form-group" style={{ marginTop: '0.75rem', marginBottom: '1.25rem' }}>
          <label htmlFor="class-tags-input">Class Tags (Categories & Cohort Labels)</label>
          <div className="class-tags-editor">
            {classTags.length > 0 && (
              <div className="class-tags-chips-list">
                {classTags.map((t) => (
                  <span key={t} className="class-tag-chip">
                    <span>#{t}</span>
                    <button
                      type="button"
                      className="remove-tag-chip-btn"
                      onClick={() => handleRemoveTag(t)}
                      title={`Remove tag #${t}`}
                      aria-label={`Remove tag #${t}`}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Quick Template Filter Tags */}
            <div className="template-tags-presets-row" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.65rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary, #475569)' }}>
                🏷️ Template Filter Tag:
              </span>
              {Object.values(CLASS_TEMPLATES).map((tmpl) => {
                const tagValue = tmpl.tag || tmpl.name;
                const isTagApplied = classTags.includes(tagValue);
                return (
                  <button
                    key={tmpl.id}
                    type="button"
                    className={`suggestion-tag-pill ${isTagApplied ? 'active-template-tag' : ''}`}
                    style={isTagApplied ? { backgroundColor: 'var(--color-primary, #6366f1)', color: '#ffffff', borderColor: 'var(--color-primary, #6366f1)', fontWeight: 600 } : {}}
                    onClick={() => {
                      if (isTagApplied) {
                        handleRemoveTag(tagValue);
                      } else {
                        const otherTemplateTags = Object.values(CLASS_TEMPLATES).map(t => t.tag || t.name);
                        setClassTags(prev => [tagValue, ...prev.filter(t => !otherTemplateTags.includes(t))]);
                      }
                    }}
                    title={`Click to ${isTagApplied ? 'remove' : 'apply'} #${tagValue} tag for Teacher Dashboard filtering`}
                  >
                    {isTagApplied ? `✓ #${tagValue}` : `+ #${tagValue}`}
                  </button>
                );
              })}
            </div>

            <div className="tag-input-row">
              <input
                id="class-tags-input"
                type="text"
                placeholder="Type tag (e.g. HD-IT, Year 1, Lab 302) and press Enter..."
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagInputKeyDown}
              />
              <button
                type="button"
                className="add-tag-btn"
                onClick={() => handleAddTag()}
                disabled={!tagInput.trim()}
              >
                + Add Tag
              </button>
            </div>
            {allKnownTags.filter(t => !classTags.includes(t)).length > 0 && (
              <div className="tag-suggestions-row">
                <span className="suggestions-label">Suggestions from other classes:</span>
                {allKnownTags
                  .filter((t) => !classTags.includes(t))
                  .slice(0, 10)
                  .map((sug) => (
                    <button
                      key={sug}
                      type="button"
                      className="suggestion-tag-pill"
                      onClick={() => handleAddTag(sug)}
                      title={`Add tag #${sug}`}
                    >
                      + #{sug}
                    </button>
                  ))}
              </div>
            )}
          </div>
          <p className="input-hint">Tags allow you to filter and categorize classes on your Teacher Dashboard and quick switcher.</p>
        </div>

        <div className="form-row" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
          <div className="form-group">
            <label>Storage Limit Allotment</label>
            <select value={storageLimit} onChange={(e) => setStorageLimit(e.target.value)}>
              <option value="5">5 GB (Standard - ~{formatStorageCost(5 * 1024 * 1024 * 1024, storageRatePerGibMonth)}/mo)</option>
              <option value="10">10 GB (Extended - ~{formatStorageCost(10 * 1024 * 1024 * 1024, storageRatePerGibMonth)}/mo)</option>
              <option value="20">20 GB (Large Course - ~{formatStorageCost(20 * 1024 * 1024 * 1024, storageRatePerGibMonth)}/mo)</option>
            </select>
            <p className="input-hint">Maximum storage cap for this class.</p>
          </div>

          <div className="form-group">
            <label>Screenshot Retention (Days)</label>
            <select value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)}>
              <option value="7">7 Days (Short Workshop)</option>
              <option value="14">14 Days (Standard)</option>
              <option value="30">30 Days (1 Month)</option>
              <option value="60">60 Days (2 Months)</option>
              <option value="90">90 Days (1 Semester)</option>
              <option value="180">180 Days (Half Year)</option>
              <option value="365">365 Days (1 Year)</option>
            </select>
            <p className="input-hint">Raw screen capture frames older than this are recycled.</p>
          </div>

          <div className="form-group">
            <label>Video Retention (Days)</label>
            <select value={videoRetentionDays} onChange={(e) => setVideoRetentionDays(e.target.value)}>
              <option value="14">14 Days (2 Weeks)</option>
              <option value="30">30 Days (1 Month)</option>
              <option value="60">60 Days (2 Months)</option>
              <option value="90">90 Days (1 Semester)</option>
              <option value="180">180 Days (Half Year)</option>
              <option value="365">365 Days (1 Year)</option>
              <option value="730">730 Days (2 Years)</option>
            </select>
            <p className="input-hint">Compiled lesson playback videos (.mp4) retention period.</p>
          </div>
        </div>
      </div>

      {/* Section 2: Timetable & Schedule */}
      <div className="settings-section-card">
        <h3>📅 2. Class Timetable & Schedule</h3>
        <ScheduleManager 
          scheduleStartDate={scheduleStartDate} 
          setScheduleStartDate={setScheduleStartDate} 
          scheduleEndDate={scheduleEndDate} 
          setScheduleEndDate={setScheduleEndDate} 
          timeZone={timeZone} 
          setTimeZone={setTimeZone} 
          classSchedules={classSchedules} 
          setClassSchedules={setClassSchedules} 
          pastLessonsCount={pastCompletedLessons.length}
        />
      </div>

      {/* Section 3: Student Roster & Properties */}
      <div className="settings-section-card">
        <h3>👥 3. Student Roster</h3>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={{ margin: 0 }}>Student Email Addresses</label>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-primary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', fontWeight: 600 }}
                onClick={() => setShowBatchUploadModal(true)}
                title="Batch upload or paste student names, nicknames, programmes, and cohort classes"
              >
                👥 Batch Upload Roster
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={handleInputAllStudents}
                disabled={loadingAllStudents}
                title="Add all registered students to this class roster"
              >
                {loadingAllStudents ? '⏳ Loading Students...' : '🎓 Add All Students'}
              </button>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={handleDownloadRosterTemplate}
                title="Download standard Excel (.xlsx) roster template with English headers and example data"
              >
                📄 Download Excel Template
              </button>
              <label className="btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                📥 Import (Excel)
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImportEmailsFromFile(e, 'students')}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => handleExportEmailsToExcel('students')}
              >
                📤 Export Excel
              </button>
            </div>
          </div>
          <textarea
            placeholder="Enter student emails (one per line or comma separated)..."
            value={studentEmails}
            onChange={(e) => setStudentEmails(e.target.value)}
            rows="5"
          />
          <p className="input-hint">Students with these emails will gain access to this class. Entering emails automatically reuses names and Chinese nicknames from other classes and the institutional directory. Use "📄 Download Template" or "👥 Batch Upload Roster" to provide or update full profile metadata.</p>

          {/* Roster Profiles Overview */}
          {(() => {
            const emailList = [...new Set(studentEmails.split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
            if (emailList.length === 0) return null;

            const resolvedProfilesMap = {};
            let dirEnrichedCount = 0;
            let fullProfileCount = 0;
            const cohortSet = new Set();

            emailList.forEach(email => {
              const explicitProf = studentProfiles[email] || {};
              const dirProf = studentDirectory[email] || {};
              const hasDirInfo = Boolean(dirProf.studentName || dirProf.nickname || dirProf.programme || dirProf.studentClass);
              const isEnrichedFromDir = hasDirInfo && (!explicitProf.studentName || !explicitProf.nickname || !explicitProf.programme || !explicitProf.studentClass);
              const effectiveProf = {
                studentName: explicitProf.studentName || dirProf.studentName || '',
                nickname: explicitProf.nickname || dirProf.nickname || '',
                programme: explicitProf.programme || dirProf.programme || '',
                studentClass: explicitProf.studentClass || dirProf.studentClass || '',
                uid: explicitProf.uid || dirProf.uid || '',
              };
              resolvedProfilesMap[email] = {
                ...effectiveProf,
                _fromDirectory: Boolean(isEnrichedFromDir),
              };
              if (effectiveProf.studentName || effectiveProf.nickname) {
                fullProfileCount++;
              }
              if (isEnrichedFromDir) {
                dirEnrichedCount++;
              }
              if (effectiveProf.studentClass && effectiveProf.studentClass.trim()) {
                cohortSet.add(effectiveProf.studentClass.trim());
              }
            });

            const uniqueCohortsList = Array.from(cohortSet).sort();

            const registeredPasskeyCount = emailList.filter(email => {
              const norm = (email || '').toLowerCase();
              const prof = resolvedProfilesMap[email] || {};
              return Boolean(registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid]));
            }).length;

            // Compute inline filtered and sorted student list
            const inlineFilteredList = emailList.filter(email => {
              const norm = (email || '').toLowerCase();
              const prof = resolvedProfilesMap[email] || {};
              const studentName = (prof.studentName || '').toLowerCase();
              const nickname = (prof.nickname || '').toLowerCase();
              const studentClass = (prof.studentClass || '').toLowerCase();
              const programme = (prof.programme || '').toLowerCase();
              const isPasskeyLinked = Boolean(registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid]));

              if (inlineRosterSearch.trim()) {
                const q = inlineRosterSearch.trim().toLowerCase();
                const match = norm.includes(q) || studentName.includes(q) || nickname.includes(q) || studentClass.includes(q) || programme.includes(q);
                if (!match) return false;
              }

              if (inlinePasskeyFilter === 'linked' && !isPasskeyLinked) return false;
              if (inlinePasskeyFilter === 'unlinked' && isPasskeyLinked) return false;

              if (inlineCohortFilter !== 'all' && (prof.studentClass || '').trim() !== inlineCohortFilter) return false;

              return true;
            });

            inlineFilteredList.sort((a, b) => {
              const profA = resolvedProfilesMap[a] || {};
              const profB = resolvedProfilesMap[b] || {};
              const normA = (a || '').toLowerCase();
              const normB = (b || '').toLowerCase();

              let valA = '';
              let valB = '';

              switch (inlineSortColumn) {
                case 'email':
                  valA = normA;
                  valB = normB;
                  break;
                case 'studentName':
                  valA = (profA.studentName || '').toLowerCase();
                  valB = (profB.studentName || '').toLowerCase();
                  break;
                case 'studentClass':
                  valA = (profA.studentClass || '').toLowerCase();
                  valB = (profB.studentClass || '').toLowerCase();
                  break;
                case 'programme':
                  valA = (profA.programme || '').toLowerCase();
                  valB = (profB.programme || '').toLowerCase();
                  break;
                case 'passkey': {
                  const passA = (registeredPasskeysMap[normA] || (profA.uid && registeredPasskeysMap[profA.uid])) ? 1 : 0;
                  const passB = (registeredPasskeysMap[normB] || (profB.uid && registeredPasskeysMap[profB.uid])) ? 1 : 0;
                  return inlineSortDirection === 'asc' ? passB - passA : passA - passB;
                }
                case 'displayName':
                default:
                  valA = (profA.nickname || profA.studentName || normA).toLowerCase();
                  valB = (profB.nickname || profB.studentName || normB).toLowerCase();
                  break;
              }

              const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
              return inlineSortDirection === 'asc' ? cmp : -cmp;
            });

            const handleInlineSort = (col) => {
              if (inlineSortColumn === col) {
                setInlineSortDirection(prev => (prev === 'asc' ? 'desc' : 'asc'));
              } else {
                setInlineSortColumn(col);
                setInlineSortDirection('asc');
              }
            };

            const hasInlineFilterActive = Boolean(inlineRosterSearch.trim() || inlinePasskeyFilter !== 'all' || inlineCohortFilter !== 'all');

            return (
              <div style={{ marginTop: '0.9rem', backgroundColor: 'var(--color-bg-secondary, #f8fafc)', border: '1px solid var(--color-border, #e2e8f0)', borderRadius: '8px', padding: '0.75rem 1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main, #334155)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <span>📋 Enrolled Roster Details ({emailList.length} students):</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 500, padding: '0.1rem 0.45rem', borderRadius: '9999px', backgroundColor: fullProfileCount > 0 ? '#dcfce7' : '#f1f5f9', color: fullProfileCount > 0 ? '#166534' : '#64748b' }}>
                      {fullProfileCount}/{emailList.length} with profile metadata
                    </span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: registeredPasskeyCount === emailList.length && emailList.length > 0 ? '#dcfce7' : '#fef3c7', color: registeredPasskeyCount === emailList.length && emailList.length > 0 ? '#166534' : '#92400e' }}>
                      📱 {registeredPasskeyCount}/{emailList.length} Passkeys Linked
                    </span>
                    {dirEnrichedCount > 0 && (
                      <span style={{ fontSize: '0.75rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: '9999px', backgroundColor: '#e0e7ff', color: '#3730a3' }}>
                        ✨ {dirEnrichedCount} auto-filled from other classes
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem', backgroundColor: '#eef2ff', borderColor: '#c7d2fe', color: '#4338ca', fontWeight: 600 }}
                      onClick={() => setShowEnlargedRosterModal(true)}
                      data-testid="btn-enlarge-roster"
                      title="Open full-screen enlargeable roster view with advanced filters and sorting"
                    >
                      ⛶ Enlarge View
                    </button>
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                      onClick={() => setShowRosterPreview(prev => !prev)}
                    >
                      {showRosterPreview ? 'Hide Table ▲' : 'Show Table ▼'}
                    </button>
                  </div>
                </div>

                {showRosterPreview && (
                  <div style={{ border: '1px solid var(--color-border, #cbd5e1)', borderRadius: '6px', overflow: 'hidden', backgroundColor: 'var(--color-surface, #ffffff)' }}>
                    {/* Inline Filter Toolbar */}
                    <div style={{ padding: '0.4rem 0.6rem', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.78rem' }}>
                      <input
                        type="text"
                        placeholder="🔍 Filter name, email, cohort..."
                        value={inlineRosterSearch}
                        onChange={e => setInlineRosterSearch(e.target.value)}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '4px', minWidth: '160px', flex: '1 1 160px' }}
                        data-testid="inline-roster-search"
                      />
                      <select
                        value={inlinePasskeyFilter}
                        onChange={e => setInlinePasskeyFilter(e.target.value)}
                        style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                        data-testid="inline-filter-passkey"
                      >
                        <option value="all">All Passkeys</option>
                        <option value="linked">📱 Linked Only</option>
                        <option value="unlinked">⏳ Not Registered</option>
                      </select>
                      {uniqueCohortsList.length > 0 && (
                        <select
                          value={inlineCohortFilter}
                          onChange={e => setInlineCohortFilter(e.target.value)}
                          style={{ padding: '0.25rem 0.45rem', fontSize: '0.78rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
                          data-testid="inline-filter-cohort"
                        >
                          <option value="all">All Cohorts</option>
                          {uniqueCohortsList.map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                        </select>
                      )}
                      {hasInlineFilterActive && (
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={() => {
                            setInlineRosterSearch('');
                            setInlinePasskeyFilter('all');
                            setInlineCohortFilter('all');
                          }}
                          style={{ fontSize: '0.72rem', padding: '0.2rem 0.4rem' }}
                        >
                          ✕ Reset
                        </button>
                      )}
                      <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: '0.75rem' }}>
                        Showing {inlineFilteredList.length}/{emailList.length}
                      </span>
                    </div>

                    {passkeyResetSuccess && (
                      <div style={{ backgroundColor: '#ecfdf5', color: '#065f46', borderBottom: '1px solid #a7f3d0', padding: '0.4rem 0.8rem', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>✅ {passkeyResetSuccess}</span>
                        <button type="button" onClick={() => setPasskeyResetSuccess('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                      </div>
                    )}
                    {bypassSuccessMsg && (
                      <div style={{ backgroundColor: '#eff6ff', color: '#1e40af', borderBottom: '1px solid #bfdbfe', padding: '0.4rem 0.8rem', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>⚡ {bypassSuccessMsg}</span>
                        <button type="button" onClick={() => setBypassSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#1e40af' }}>✕</button>
                      </div>
                    )}
                    {exemptionSuccessMsg && (
                      <div style={{ backgroundColor: '#f0fdf4', color: '#166534', borderBottom: '1px solid #bbf7d0', padding: '0.4rem 0.8rem', fontSize: '0.78rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>🛡️ {exemptionSuccessMsg}</span>
                        <button type="button" onClick={() => setExemptionSuccessMsg('')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, color: '#166534' }}>✕</button>
                      </div>
                    )}
                    <div style={{ maxHeight: '240px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                        <thead style={{ position: 'sticky', top: 0, backgroundColor: 'var(--color-surface, #ffffff)', borderBottom: '1px solid var(--color-border, #cbd5e1)', zIndex: 2 }}>
                          <tr>
                            <th
                              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('displayName')}
                              title="Sort by Student Display Name"
                            >
                              <span>Student Display Name</span> {inlineSortColumn === 'displayName' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                            <th
                              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('email')}
                              title="Sort by Email"
                            >
                              <span>Email</span> {inlineSortColumn === 'email' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                            <th
                              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('studentName')}
                              title="Sort by Full Legal Name"
                            >
                              <span>Student Name</span> {inlineSortColumn === 'studentName' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                            <th
                              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('studentClass')}
                              title="Sort by Class / Cohort"
                            >
                              <span>Class / Cohort</span> {inlineSortColumn === 'studentClass' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                            <th
                              style={{ padding: '0.4rem 0.6rem', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('programme')}
                              title="Sort by Programme"
                            >
                              <span>Programme</span> {inlineSortColumn === 'programme' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                            <th
                              style={{ padding: '0.4rem 0.6rem', textAlign: 'center', cursor: 'pointer', userSelect: 'none' }}
                              onClick={() => handleInlineSort('passkey')}
                              title="Sort by Phone Passkey"
                            >
                              <span>Phone Passkey</span> {inlineSortColumn === 'passkey' ? (inlineSortDirection === 'asc' ? '▲' : '▼') : '⇅'}
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {inlineFilteredList.length === 0 ? (
                            <tr>
                              <td colSpan="6" style={{ padding: '1.5rem', textAlign: 'center', color: '#64748b' }}>
                                No students match your filter criteria.
                              </td>
                            </tr>
                          ) : (
                            inlineFilteredList.map((email, idx) => {
                              const prof = resolvedProfilesMap[email] || {};
                              const resolvedStudentName = prof.studentName || '';
                              const norm = (email || '').toLowerCase();
                              const passkey = registeredPasskeysMap[norm] || (prof.uid && registeredPasskeysMap[prof.uid]);
                              const studentUid = Object.keys(studentsMap).find(u => (studentsMap[u] || '').toLowerCase() === norm);
                              const activeBypass = studentBypassesMap[norm] || (prof.uid && studentBypassesMap[prof.uid]) || (studentUid && studentBypassesMap[studentUid]);
                              const isBypassActive = Boolean(
                                activeBypass && activeBypass.active && (activeBypass.expiresAtMillis > Date.now() || (activeBypass.expiresAt && new Date(activeBypass.expiresAt).getTime() > Date.now()))
                              );
                              const isExempt = passwordWhitelistSet.has(norm) || (prof.uid && passwordWhitelistSet.has(prof.uid)) || (studentUid && passwordWhitelistSet.has(studentUid));

                              return (
                                <tr key={`${email}-${idx}`} style={{ borderBottom: '1px solid var(--color-border, #f1f5f9)' }}>
                                  <td style={{ padding: '0.35rem 0.6rem' }}>
                                    <StudentBadge student={{ email, ...prof }} showCohort={false} size="sm" />
                                  </td>
                                  <td style={{ padding: '0.35rem 0.6rem', fontFamily: 'monospace' }}>{email}</td>
                                  <td style={{ padding: '0.35rem 0.6rem' }}>
                                    {resolvedStudentName ? (
                                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
                                        <span>{resolvedStudentName}</span>
                                        {prof._fromDirectory && (
                                          <span
                                            title="Auto-filled from institutional student directory (provided by another class)"
                                            style={{ fontSize: '0.68rem', fontWeight: 600, padding: '0.05rem 0.35rem', borderRadius: '4px', backgroundColor: '#e0e7ff', color: '#4338ca' }}
                                          >
                                            ✨ Directory
                                          </span>
                                        )}
                                      </span>
                                    ) : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
                                  </td>
                                  <td style={{ padding: '0.35rem 0.6rem' }}>
                                    {prof.studentClass ? (
                                      <span style={{ display: 'inline-block', padding: '0.1rem 0.4rem', fontSize: '0.72rem', fontWeight: 700, borderRadius: '9999px', backgroundColor: 'rgba(99, 102, 241, 0.12)', color: 'var(--color-primary, #6366f1)', border: '1px solid rgba(99, 102, 241, 0.25)' }}>
                                        {prof.studentClass}
                                      </span>
                                    ) : <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
                                  </td>
                                  <td style={{ padding: '0.35rem 0.6rem', color: '#475569' }}>
                                    {prof.programme || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}
                                  </td>
                                  <td style={{ padding: '0.35rem 0.6rem', textAlign: 'center' }}>
                                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                      {passkey ? (
                                        <span
                                          style={{
                                            fontSize: '0.72rem',
                                            fontWeight: 700,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '9999px',
                                            backgroundColor: '#dcfce7',
                                            color: '#15803d',
                                            border: '1px solid #bbf7d0',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title={`Registered on ${passkey.deviceModel || 'Mobile Device'}`}
                                        >
                                          📱 Linked
                                        </span>
                                      ) : (
                                        <span
                                          style={{
                                            fontSize: '0.72rem',
                                            fontWeight: 600,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '9999px',
                                            backgroundColor: '#fef3c7',
                                            color: '#b45309',
                                            border: '1px solid #fde68a',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title="Student has not registered a passkey on their mobile device yet"
                                        >
                                          ⏳ Not Registered
                                        </span>
                                      )}

                                      {isBypassActive && (
                                        <span
                                          style={{
                                            fontSize: '0.72rem',
                                            fontWeight: 600,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '9999px',
                                            backgroundColor: '#eff6ff',
                                            color: '#1d4ed8',
                                            border: '1px solid #bfdbfe',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title={`Emergency bypass active until ${new Date(activeBypass.expiresAtMillis || activeBypass.expiresAt).toLocaleTimeString()}`}
                                        >
                                          ⚡ Bypass Active
                                        </span>
                                      )}

                                      {isExempt && (
                                        <span
                                          style={{
                                            fontSize: '0.72rem',
                                            fontWeight: 600,
                                            padding: '0.12rem 0.45rem',
                                            borderRadius: '9999px',
                                            backgroundColor: '#dcfce7',
                                            color: '#166534',
                                            border: '1px solid #bbf7d0',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                          }}
                                          title="Student is permanently exempt from mandatory passkey (system_config/loginPolicy)"
                                          data-testid={`badge-roster-exempt-${email.replace(/[@.]/g, '_')}`}
                                        >
                                          🛡️ Passkey Exempt
                                        </span>
                                      )}

                                      {passkey && (
                                        <button
                                          type="button"
                                          className="btn-secondary btn-sm"
                                          style={{
                                            fontSize: '0.72rem',
                                            padding: '0.15rem 0.45rem',
                                            color: '#b91c1c',
                                            borderColor: '#fca5a5',
                                            background: '#fff',
                                            cursor: 'pointer',
                                          }}
                                          onClick={() => handleResetStudentPasskey(email, resolvedStudentName)}
                                          disabled={Boolean(resettingPasskeys[email])}
                                          data-testid={`btn-roster-reset-passkey-${email.replace(/[@.]/g, '_')}`}
                                          title="Unlink phone passkey if student replaced their device"
                                        >
                                          {resettingPasskeys[email] ? 'Resetting...' : '🔄 Reset'}
                                        </button>
                                      )}

                                      <button
                                        type="button"
                                        className="btn-secondary btn-sm"
                                        style={{
                                          fontSize: '0.72rem',
                                          padding: '0.15rem 0.45rem',
                                          color: '#0369a1',
                                          borderColor: '#bae6fd',
                                          background: '#f0f9ff',
                                          cursor: 'pointer',
                                        }}
                                        onClick={() => handleGrantStudentBypass(email, resolvedStudentName)}
                                        disabled={Boolean(grantingBypass[email])}
                                        data-testid={`btn-roster-bypass-${email.replace(/[@.]/g, '_')}`}
                                        title="Grant temporary emergency passkey bypass for this class"
                                      >
                                        {grantingBypass[email] ? 'Granting...' : '⚡ Temp Bypass'}
                                      </button>

                                      <button
                                        type="button"
                                        className="btn-secondary btn-sm"
                                        style={{
                                          fontSize: '0.72rem',
                                          padding: '0.15rem 0.45rem',
                                          color: isExempt ? '#15803d' : '#854d0e',
                                          borderColor: isExempt ? '#86efac' : '#fde047',
                                          background: isExempt ? '#f0fdf4' : '#fefce8',
                                          cursor: 'pointer',
                                        }}
                                        onClick={() => handleToggleStudentExemption(email, resolvedStudentName, isExempt)}
                                        disabled={Boolean(togglingExemption[email])}
                                        data-testid={`btn-roster-exempt-${email.replace(/[@.]/g, '_')}`}
                                        title={
                                          isExempt
                                            ? 'Student is permanently exempt from passkey. Click to revoke exemption.'
                                            : 'Permanently exempt student from passkey requirement (uncommon case for incompatible phones)'
                                        }
                                      >
                                        {togglingExemption[email]
                                          ? 'Saving...'
                                          : isExempt
                                          ? '🛡️ Exempt (Perm)'
                                          : '🛡️ Exempt'}
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Enlargable Roster Modal Dialog */}
                <EnrolledRosterModal
                  show={showEnlargedRosterModal}
                  onClose={() => setShowEnlargedRosterModal(false)}
                  className={className}
                  classId={selectedClass || classId || embeddedClassId}
                  emailList={emailList}
                  resolvedProfilesMap={resolvedProfilesMap}
                  registeredPasskeysMap={registeredPasskeysMap}
                  resettingPasskeys={resettingPasskeys}
                  onResetPasskey={handleResetStudentPasskey}
                  passkeyResetSuccess={passkeyResetSuccess}
                  onClearPasskeyResetSuccess={() => setPasskeyResetSuccess('')}
                  studentBypassesMap={studentBypassesMap}
                  grantingBypass={grantingBypass}
                  onGrantBypass={handleGrantStudentBypass}
                  bypassSuccessMsg={bypassSuccessMsg}
                  onClearBypassSuccess={() => setBypassSuccessMsg('')}
                  passwordWhitelistSet={passwordWhitelistSet}
                  togglingExemption={togglingExemption}
                  onToggleExemption={handleToggleStudentExemption}
                  exemptionSuccessMsg={exemptionSuccessMsg}
                  onClearExemptionSuccess={() => setExemptionSuccessMsg('')}
                />
              </div>
            );
          })()}
        </div>

        {(selectedClass || embeddedClassId) ? (
          <div style={{ marginTop: '1.25rem' }}>
            <CustomPropertiesManager selectedClass={embeddedClassId || selectedClass} studentEmails={studentEmails} />
          </div>
        ) : (
          <div style={{ marginTop: '1.25rem', padding: '0.9rem 1.25rem', backgroundColor: 'var(--color-bg-secondary, #f8fafc)', border: '1px dashed var(--color-border, #cbd5e1)', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <span style={{ fontSize: '1.2rem' }}>ℹ️</span>
            <div>
              <p style={{ margin: 0, fontWeight: 600, fontSize: '0.88rem', color: 'var(--color-text-main, #334155)' }}>
                Custom Student Properties & Excel Upload
              </p>
              <p style={{ margin: '0.15rem 0 0 0', fontSize: '0.8rem', color: 'var(--color-text-muted, #64748b)' }}>
                Custom class-wide properties and student Excel upload controls become available after creating and selecting this class.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Section 4: Teaching Team */}
      <div className="settings-section-card">
        <h3>👨‍🏫 4. Teaching Team (Co-Instructors)</h3>
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <label style={{ margin: 0 }}>Co-Teacher Email Addresses</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <label className="btn-secondary" style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', cursor: 'pointer', margin: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                📥 Import (Excel)
                <input
                  type="file"
                  accept=".xlsx,.xls,.txt"
                  style={{ display: 'none' }}
                  onChange={(e) => handleImportEmailsFromFile(e, 'teachers')}
                />
              </label>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: '0.25rem 0.65rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}
                onClick={() => handleExportEmailsToExcel('teachers')}
              >
                📤 Export Excel
              </button>
            </div>
          </div>
          <textarea
            placeholder="Enter co-teacher emails (one per line or space separated)..."
            value={teacherEmails}
            onChange={(e) => setTeacherEmails(e.target.value)}
            rows="3"
          />
          <p className="input-hint">Your email is automatically included as a lead instructor.</p>
        </div>
      </div>

      {/* Advanced Settings Accordion Toggle */}
      <button
        type="button"
        className="advanced-accordion-toggle"
        onClick={() => setShowAdvancedSettings((prev) => !prev)}
        aria-expanded={showAdvancedSettings}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span>⚙️</span>
          <span>Advanced Configuration &amp; Parameter Overrides (Sections 5 – 10)</span>
          <span style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--color-text-muted)' }}>
            — {showAdvancedSettings ? 'Configuring custom overrides' : `Pre-configured by "${getClassTemplate(selectedTemplate).name}" template`}
          </span>
        </span>
        <span style={{ fontSize: '1.1rem', transform: showAdvancedSettings ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease-in-out' }}>
          ▼
        </span>
      </button>

      {/* Advanced Settings Container (Sections 5 - 10) */}
      <div
        className="advanced-settings-container"
        style={{ display: showAdvancedSettings ? 'block' : 'none' }}
      >
        {/* Section 5: Automation & AI Video Prompts */}
        <div className="settings-section-card">
        <h3>🤖 5. Automation & AI Prompts</h3>
        <div className="form-group">
          <label>Default Capture Mode</label>
          <select value={captureMode} onChange={(e) => setCaptureMode(e.target.value)}>
            <option value="dual">Dual Channel (Screen + Webcam)</option>
            <option value="screen">Screen Only</option>
            <option value="webcam">Webcam Only</option>
          </select>
          <p className="input-hint">Configure which visual streams students in this class stream to the instructor.</p>
        </div>

        <div className="form-group">
          <label>Preferred Gemini AI Model</label>
          <select value={aiModel} onChange={(e) => setAiModel(e.target.value)}>
            <option value="gemini-3.8-flash">✨ Gemini 3.8 Flash (High Accuracy & Multimodal Reasoning — $0.75 / $3.75 per 1M)</option>
            <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash-Lite (Fastest & Ultra-Low Cost — $0.30 / $2.50 per 1M)</option>
          </select>
          <p className="input-hint">Default Gemini model used for live invigilation and video analyses for this class.</p>
        </div>

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={requireFullScreenOnly}
              onChange={(e) => setRequireFullScreenOnly(e.target.checked)}
            />
            <span>Require Entire Screen (Forbid Single Window or Tab Sharing)</span>
          </label>
          <p className="input-hint">Ensures test and exam integrity by rejecting single application windows or browser tabs and forcing students to share their entire desktop.</p>
        </div>

        <div className="form-group">
          <label>AI Face & Gaze Monitoring Mode</label>
          <select 
            value={aiMonitoringMode} 
            onChange={(e) => {
              const newMode = e.target.value;
              setAiMonitoringMode(newMode);
              setEnableClientAi(newMode === 'hybrid' || newMode === 'client_only');
              setEnableCloudFallback(newMode === 'hybrid' || newMode === 'cloud_only');
            }}
          >
            <option value="hybrid">⚡ Client-side, then fallback to Cloud (Recommended — On-device MediaPipe, fallback to Cloud Gemini)</option>
            <option value="cloud_only">☁️ Just Cloud (Periodic Cloud Gemini Vision frame inspections)</option>
            <option value="client_only">💻 Just Client-side (100% Free on-device MediaPipe, zero Cloud quota)</option>
            <option value="disabled">🚫 Disable it (Turn off all face/gaze AI monitoring)</option>
          </select>
          <p className="input-hint">
            {aiMonitoringMode === 'hybrid' && 'Runs real-time face presence and gaze tracking on student machines for free, automatically falling back to Cloud Gemini AI if a student device cannot run local AI.'}
            {aiMonitoringMode === 'cloud_only' && 'Webcam frames are analyzed periodically using Cloud Gemini Vision. Client-side MediaPipe is deactivated.'}
            {aiMonitoringMode === 'client_only' && 'Runs real-time face presence and gaze tracking exclusively on student machines. No cloud vision AI calls or quotas are consumed.'}
            {aiMonitoringMode === 'disabled' && 'Face & Gaze AI monitoring is completely deactivated for this class.'}
          </p>
        </div>

        {(aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'client_only') && (
          <>
            <div className="form-group">
              <label>Gaze & Head Orientation Sensitivity</label>
              <select 
                value={gazeSensitivity} 
                onChange={(e) => setGazeSensitivity(e.target.value)}
              >
                <option value="relaxed">🟢 Relaxed / Low Sensitivity (High Tolerance — Yaw ±28°, Pitch -26°/+30°)</option>
                <option value="standard">🟡 Standard / Balanced Default (Yaw ±22°, Pitch -20°/+26°)</option>
                <option value="strict">🔴 Strict / High Sensitivity (Yaw ±16°, Pitch -16°/+22°)</option>
                <option value="custom">⚙️ Custom Manual Angles (Specify exact Yaw & Pitch degrees)</option>
              </select>
              <p className="input-hint">Controls how strictly head rotation and eye deviation off-screen trigger an incident. Use "Relaxed" if students are writing on paper desks or multi-screen setups.</p>
            </div>

            {gazeSensitivity === 'custom' && (
              <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#1e293b' }}>📐 Custom Angle Limits</h4>
                
                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Horizontal Yaw Angle Limit (Turn Left / Right)</span>
                    <strong>±{customYawAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="10" 
                    max="50" 
                    value={customYawAngle} 
                    onChange={(e) => setCustomYawAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head turns more than {customYawAngle}° left or right.</p>
                </div>

                <div className="form-group" style={{ marginBottom: '12px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pitch Down Angle Limit (Looking Down)</span>
                    <strong>{customPitchDownAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="-45" 
                    max="-10" 
                    value={customPitchDownAngle} 
                    onChange={(e) => setCustomPitchDownAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head tilts below {customPitchDownAngle}° (e.g. looking down at lap or phones).</p>
                </div>

                <div className="form-group" style={{ marginBottom: '4px' }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span>Pitch Up Angle Limit (Looking Up)</span>
                    <strong>+{customPitchUpAngle}°</strong>
                  </label>
                  <input 
                    type="range" 
                    min="10" 
                    max="45" 
                    value={customPitchUpAngle} 
                    onChange={(e) => setCustomPitchUpAngle(parseInt(e.target.value, 10))}
                    style={{ width: '100%' }}
                  />
                  <p className="input-hint">Flags student when head tilts above +{customPitchUpAngle}° (looking up away from screen).</p>
                </div>
              </div>
            )}
          </>
        )}

        {aiMonitoringMode !== 'disabled' && (
          <div className="form-group">
            <label>AI Gaze & Absence Debounce Gate</label>
            <select 
              value={faceDebounceSeconds} 
              onChange={(e) => setFaceDebounceSeconds(parseInt(e.target.value, 10))}
            >
              <option value={2}>⏱️ 2s (Strict — Rapid Flagging)</option>
              <option value={3}>⏱️ 3s (Standard — Default Balanced)</option>
              <option value={5}>⏱️ 5s (Relaxed — Tolerates Brief Glances)</option>
              <option value={8}>⏱️ 8s (Very Relaxed)</option>
              <option value={10}>⏱️ 10s (High Tolerance)</option>
            </select>
            <p className="input-hint">Duration a student must continuously look away or step away from camera before registering an irregularity.</p>
          </div>
        )}

        <div className="form-group">
          <label htmlFor="bingo-retry-delay-config">🎯 Bingo Active Presence Retry Grace Delay</label>
          <select 
            id="bingo-retry-delay-config"
            value={bingoRetryDelayMinutes} 
            onChange={(e) => setBingoRetryDelayMinutes(parseInt(e.target.value, 10))}
          >
            <option value={1}>⚡ 1 Minute (Strict — Fast Verification)</option>
            <option value={2}>⏱️ 2 Minutes (Accelerated)</option>
            <option value={3}>🎯 3 Minutes (Standard Default)</option>
            <option value={5}>☕ 5 Minutes (Relaxed Lecture)</option>
            <option value={10}>🛋️ 10 Minutes (Extended Grace)</option>
          </select>
          <p className="input-hint">Delay before Google Cloud Tasks automatically dispatches a Strike 2 follow-up verification after a student misses Strike 1.</p>
        </div>

        <div className="form-group">
          <label htmlFor="bingo-time-limit-config">⏳ Student Bingo Answer Time Limit</label>
          <select 
            id="bingo-time-limit-config"
            value={bingoTimeLimitSeconds} 
            onChange={(e) => setBingoTimeLimitSeconds(parseInt(e.target.value, 10))}
          >
            <option value={15}>⚡ 15 Seconds (Rapid Attention Check)</option>
            <option value={30}>⏱️ 30 Seconds (Default Presence Check)</option>
            <option value={45}>🎯 45 Seconds (Standard Quiz)</option>
            <option value={60}>📝 60 Seconds (1 Minute / Standard Quiz)</option>
            <option value={90}>💻 90 Seconds (1.5 Minutes / Code Analysis)</option>
            <option value={120}>🧠 120 Seconds (2 Minutes / Complex Problem)</option>
          </select>
          <p className="input-hint">The countdown duration students have to read and submit their Bingo response before the timer expires and records a strike.</p>
        </div>

        <div className="form-group">
          <label htmlFor="auto-bingo-enabled-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
            <input 
              id="auto-bingo-enabled-checkbox"
              type="checkbox"
              checked={autoBingoEnabled}
              onChange={(e) => setAutoBingoEnabled(e.target.checked)}
            />
            <span>🔄 Enable Automated Periodic Bingo Verification</span>
          </label>
          <p className="input-hint">When active, the serverless scheduler automatically dispatches Bingo challenges to students periodically during class capture.</p>
        </div>

        {autoBingoEnabled && (
          <>
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <label htmlFor="auto-bingo-interval-slider">⏱️ Auto-Bingo Periodic Interval</label>
                <span className="badge" style={{ fontWeight: 600 }}>
                  {autoBingoIntervalMinutes} {autoBingoIntervalMinutes === 5 ? 'Minutes (Minimum)' : 'Minutes'}
                </span>
              </div>
              <input 
                id="auto-bingo-interval-slider"
                type="range"
                min={5}
                max={30}
                step={1}
                value={autoBingoIntervalMinutes} 
                onChange={(e) => setAutoBingoIntervalMinutes(parseInt(e.target.value, 10))}
                style={{ width: '100%', cursor: 'pointer' }}
                aria-label="Auto-Bingo Periodic Interval"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#64748b' }}>
                <span>5 mins (Min / Default)</span>
                <span>10 mins</span>
                <span>20 mins</span>
                <span>30 mins</span>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="auto-bingo-mode-config">📚 Auto-Bingo Question Generation Mode</label>
              <select 
                id="auto-bingo-mode-config"
                value={autoBingoMode} 
                onChange={(e) => setAutoBingoMode(e.target.value)}
              >
                <option value="question_bank">📚 Question Bank ($0.00 / Zero AI Tokens)</option>
                <option value="teacher_screen">📺 Teacher Screen (1 AI call for whole lecture)</option>
                <option value="student_screen">💻 Student Screens (AI anti-decoy check)</option>
              </select>
            </div>


            <ClassPromptField
              containerStyle={{ marginTop: '10px' }}
              label="🎯 Bingo Active Presence AI Prompt"
              prompt={bingoPrompt}
              onOpenModal={() => handleOpenImagePromptModal('bingo')}
              onReset={() => setBingoPrompt(null)}
              selectButtonText="Select Bingo Question Prompt"
              hint="Custom prompt guiding question generation from lesson material, teacher screen, or student screen."
            />
          </>
        )}

        {/* Bingo Speed & Ranking Scoring Rules Panel */}
        <div className="form-group" style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '1rem' }} data-testid="bingo-scoring-rules-panel">
          <label style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b' }}>
            🏆 Bingo Speed & Ranking Scoring Rules
          </label>
          <p className="input-hint" style={{ margin: '0 0 12px 0' }}>
            Configure how points are awarded for active presence checks based on answer correctness, answering speed, and class ranking.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px' }}>
            <div>
              <label htmlFor="bingo-base-points" style={{ fontSize: '0.8rem', color: '#475569' }}>Base Correct Pts</label>
              <input
                type="number"
                id="bingo-base-points"
                min="0"
                max="1000"
                value={bingoScoringRule.baseCorrectPoints ?? 100}
                onChange={(e) => setBingoScoringRule(prev => ({ ...prev, baseCorrectPoints: parseInt(e.target.value, 10) || 0 }))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label htmlFor="bingo-speed-points" style={{ fontSize: '0.8rem', color: '#475569' }}>Max Speed Bonus</label>
              <input
                type="number"
                id="bingo-speed-points"
                min="0"
                max="500"
                value={bingoScoringRule.speedBonusMaxPoints ?? 50}
                onChange={(e) => setBingoScoringRule(prev => ({ ...prev, speedBonusMaxPoints: parseInt(e.target.value, 10) || 0 }))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label htmlFor="bingo-rank1-points" style={{ fontSize: '0.8rem', color: '#475569' }}>🥇 1st Place Bonus</label>
              <input
                type="number"
                id="bingo-rank1-points"
                min="0"
                max="500"
                value={bingoScoringRule.rankBonus?.[1] ?? 50}
                onChange={(e) => setBingoScoringRule(prev => ({ ...prev, rankBonus: { ...(prev.rankBonus || {}), 1: parseInt(e.target.value, 10) || 0 } }))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label htmlFor="bingo-rank2-points" style={{ fontSize: '0.8rem', color: '#475569' }}>🥈 2nd Place Bonus</label>
              <input
                type="number"
                id="bingo-rank2-points"
                min="0"
                max="500"
                value={bingoScoringRule.rankBonus?.[2] ?? 30}
                onChange={(e) => setBingoScoringRule(prev => ({ ...prev, rankBonus: { ...(prev.rankBonus || {}), 2: parseInt(e.target.value, 10) || 0 } }))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
            <div>
              <label htmlFor="bingo-rank3-points" style={{ fontSize: '0.8rem', color: '#475569' }}>🥉 3rd Place Bonus</label>
              <input
                type="number"
                id="bingo-rank3-points"
                min="0"
                max="500"
                value={bingoScoringRule.rankBonus?.[3] ?? 20}
                onChange={(e) => setBingoScoringRule(prev => ({ ...prev, rankBonus: { ...(prev.rankBonus || {}), 3: parseInt(e.target.value, 10) || 0 } }))}
                style={{ width: '100%', padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
              />
            </div>
          </div>
        </div>


        {(aiMonitoringMode === 'hybrid' || aiMonitoringMode === 'cloud_only') && (
          <div className="form-group">
            <label>{aiMonitoringMode === 'cloud_only' ? 'Cloud AI Analysis Interval' : 'Cloud Fallback Analysis Interval'}</label>
            <select 
              value={cloudFallbackRate} 
              onChange={(e) => setCloudFallbackRate(parseInt(e.target.value, 10))}
            >
              <option value={1}>⚡ Every 1 round (~5s) — Maximum Responsiveness</option>
              <option value={2}>⚡ Every 2 rounds (~10s) — Balanced</option>
              <option value={3}>⚡ Every 3 rounds (~15s) — Default Recommended</option>
              <option value={5}>⚡ Every 5 rounds (~25s) — Quota Saver</option>
              <option value={10}>⚡ Every 10 rounds (~50s) — Low Quota Consumption</option>
            </select>
            <p className="input-hint">
              {aiMonitoringMode === 'cloud_only'
                ? 'Interval between Cloud Gemini multimodal video frame inspections.'
                : 'Analysis frequency for students whose client devices cannot run MediaPipe locally and require cloud Gemini verification.'}
            </p>
          </div>
        )}

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={automaticCapture}
              onChange={(e) => setAutomaticCapture(e.target.checked)}
            />
            <span>Automatic Live Capture</span>
          </label>
          <p className="input-hint">Starts capturing student screens 5 minutes before lesson starts and ends 5 minutes after.</p>
        </div>

        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={automaticCombine}
              onChange={(e) => setAutomaticCombine(e.target.checked)}
            />
            <span>Automatic Video Compilation (Student Screens)</span>
          </label>
          <p className="input-hint">
            Generates an invigilation video recording for each student when the class concludes.
            (Teacher lecture recordings are always automatically combined across all classes without needing any settings.)
          </p>
        </div>

        <ClassPromptField
          label="📸 AI Image &amp; Screen Invigilation Prompt"
          prompt={liveImagePrompt}
          onOpenModal={() => handleOpenImagePromptModal('live_image')}
          onReset={() => setLiveImagePrompt(null)}
          selectButtonText="Select Image Invigilation Prompt"
          hint="Prompt steering Cloud Gemini visual verification (e.g. face presence, gaze orientation, or suspicious screen activity)."
        />

        <ClassPromptField
          label="After-Class Video Analysis Prompt"
          prompt={afterClassVideoPrompt}
          onOpenModal={handleOpenPromptModal}
          onReset={() => setAfterClassVideoPrompt(null)}
          selectButtonText="Select Video AI Prompt"
          resetButtonText="Remove"
        />

        <ClassPromptField
          label="🤖 On-Device Gemma Voice Intent Prompt (LiteRT-LM Gemma 4 E2B)"
          prompt={gemmaIntentPrompt}
          onOpenModal={() => handleOpenAudioPromptModal('gemma_intent')}
          onReset={() => setGemmaIntentPrompt(null)}
          selectButtonText="Select Gemma Intent Prompt"
          hint="Custom system prompt and taxonomy rules evaluated locally on student machines in real time."
        />
      </div>

      {/* Section 6: Exam & Test Periods (Restricted from Students) */}
      <div className="settings-section-card">
        <h3>📝 6. Exam & Test Periods (Restricted from Students)</h3>
        <p className="input-hint" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Define dates and time windows for exams or tests. The system will compile all MP4 recordings for instructor invigilation and auditing, but will <strong>NEVER share recordings from these periods with students</strong> to protect assessment questions.
        </p>

        {examPeriodError && (
          <div className="error-message" style={{ marginBottom: '1rem', color: '#dc2626', fontWeight: 600 }}>
            {examPeriodError}
          </div>
        )}

        {/* Existing exam periods list */}
        <div className="form-group">
          <label>Configured Exam / Test Periods ({examPeriods.length})</label>
          {examPeriods.length === 0 ? (
            <p style={{ fontStyle: 'italic', color: '#64748b', fontSize: '0.875rem' }}>
              No exam periods defined. Regular class recordings will follow standard sharing.
            </p>
          ) : (
            <div className="schedules-list" style={{ marginTop: '0.5rem' }}>
              {examPeriods.map((period) => (
                <div
                  key={period.id}
                  className="schedule-item"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff1f2', border: '1px solid #fecdd3', padding: '10px 14px', borderRadius: '6px', marginBottom: '8px' }}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: '#9f1239', fontSize: '0.9rem' }}>
                      🔒 {period.name}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#4b5563', marginTop: '2px' }}>
                      {new Date(period.startDate).toLocaleString()} — {new Date(period.endDate).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveExamPeriod(period.id)}
                    aria-label={`Remove exam period ${period.name}`}
                    style={{ background: '#be123c', color: 'white', border: 'none', padding: '5px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600 }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Exam Period Form */}
        <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '1rem' }}>
          <h4 style={{ margin: '0 0 10px 0', fontSize: '0.9rem', color: '#1e293b' }}>➕ Add Exam / Test Window</h4>
          <div className="form-group" style={{ marginBottom: '10px' }}>
            <label htmlFor="exam-period-name-input">Exam / Assessment Name (Optional)</label>
            <input
              id="exam-period-name-input"
              type="text"
              placeholder="e.g. Midterm Examination, Final Practical"
              value={newExamName}
              onChange={(e) => setNewExamName(e.target.value)}
              aria-label="Exam Assessment Name"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '10px' }}>
            <div className="form-group">
              <label htmlFor="exam-period-start-input">Exam Start Date & Time</label>
              <input
                id="exam-period-start-input"
                type="datetime-local"
                value={newExamStart}
                onChange={(e) => setNewExamStart(e.target.value)}
                aria-label="Exam Period Start Date and Time"
              />
            </div>
            <div className="form-group">
              <label htmlFor="exam-period-end-input">Exam End Date & Time</label>
              <input
                id="exam-period-end-input"
                type="datetime-local"
                value={newExamEnd}
                onChange={(e) => setNewExamEnd(e.target.value)}
                aria-label="Exam Period End Date and Time"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={handleAddExamPeriod}
            className="action-button primary"
            style={{ padding: '6px 14px', fontSize: '0.85rem' }}
          >
            Add Exam Period
          </button>
        </div>
      </div>

      {/* Section 7: Audio & Microphone Monitoring */}
      <div className="settings-section-card">
        <h3>🎙️ 7. Audio & Microphone Monitoring</h3>
        <div className="form-group">
          <label className="checkbox-toggle-label">
            <input
              type="checkbox"
              checked={enableAudioCapture}
              onChange={(e) => setEnableAudioCapture(e.target.checked)}
            />
            <span>Enable Audio Segment Recording for this Class</span>
          </label>
          <p className="input-hint">Continuously captures and saves microphone audio chunks from connected students for acoustic invigilation.</p>
        </div>

        {enableAudioCapture && (
          <>
            <div className="form-group">
              <label>Microphone Requirement</label>
              <select value={audioCaptureMode} onChange={(e) => setAudioCaptureMode(e.target.value)}>
                <option value="mandatory">🔒 Mandatory (Students must verify and activate microphone to participate)</option>
                <option value="optional">🔓 Optional (Students can choose to enable or keep microphone muted)</option>
              </select>
              <p className="input-hint">Mandatory mode prompts student with pre-flight microphone & Speech-to-Text verification before taking the test.</p>
            </div>

            <div className="form-group">
              <label className="checkbox-toggle-label">
                <input
                  type="checkbox"
                  checked={audioSilenceSuppression}
                  onChange={(e) => setAudioSilenceSuppression(e.target.checked)}
                />
                <span>Silence Suppression (Skip uploading silent segments)</span>
              </label>
              <p className="input-hint">Automatically discards quiet chunks where no talking is detected, saving up to 80% of storage quota and network bandwidth.</p>
            </div>

            {/* Mode 1: Moving Window Real-Time Transcription */}
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>
                ⚡ Mode 1: Moving Window Real-Time Transcription (gemini-3.5-transcribe)
              </h4>
              <div className="form-group">
                <label className="checkbox-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableSegmentTranscription}
                    onChange={(e) => setEnableSegmentTranscription(e.target.checked)}
                  />
                  <span>Enable Moving Window Real-Time Transcription & Multi-Speaker Alerts</span>
                </label>
                <p className="input-hint">
                  Transcribes audio in rolling moving windows (50% overlap), stitching sentences seamlessly with Gemini and flagging unauthorized collaboration in real time.
                </p>
              </div>

              {enableSegmentTranscription && (
                <>
                  <div className="form-row-2col" style={{ marginTop: '10px' }}>
                    <div className="form-group">
                      <label htmlFor="audio-moving-window-duration">Window Duration</label>
                      <select
                        id="audio-moving-window-duration"
                        value={audioMovingWindowDuration}
                        onChange={(e) => setAudioMovingWindowDuration(parseInt(e.target.value, 10))}
                      >
                        <option value={20}>⏱️ 20 Seconds</option>
                        <option value={30}>⏱️ 30 Seconds (Recommended Standard)</option>
                        <option value={45}>⏱️ 45 Seconds (Wider Context)</option>
                      </select>
                      <p className="input-hint">Audio chunk length analyzed by Gemini.</p>
                    </div>

                    <div className="form-group">
                      <label>Sliding Stride (Overlap)</label>
                      <select
                        value={audioMovingWindowStride}
                        onChange={(e) => setAudioMovingWindowStride(parseInt(e.target.value, 10))}
                      >
                        <option value={10}>⚡ 10s Stride (Rapid rolling updates)</option>
                        <option value={15}>⚡ 15s Stride (50% Overlap — Balanced)</option>
                        <option value={20}>⚡ 20s Stride</option>
                      </select>
                      <p className="input-hint">Interval between rolling transcript updates.</p>
                    </div>
                  </div>

                  <ClassPromptField
                    containerStyle={{ marginTop: '10px' }}
                    label="Live Audio Invigilation AI Prompt"
                    prompt={liveAudioPrompt}
                    onOpenModal={() => handleOpenAudioPromptModal('live_audio')}
                    onReset={() => setLiveAudioPrompt(null)}
                    selectButtonText="Select Live Invigilation Prompt"
                  />
                </>
              )}
            </div>

            {/* Mode 2: Full Session Combined Long Audio Diarization */}
            <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginTop: '12px' }}>
              <h4 style={{ margin: '0 0 8px 0', fontSize: '14px', color: '#1e293b' }}>
                📜 Mode 2: Session & Discussion Long Audio Audit (gemini-3.5-transcribe)
              </h4>
              <div className="form-group">
                <label className="checkbox-toggle-label">
                  <input
                    type="checkbox"
                    checked={enableCombinedLongAudio}
                    onChange={(e) => setEnableCombinedLongAudio(e.target.checked)}
                  />
                  <span>Enable Session & Discussion Audio Analysis & Diarization</span>
                </label>
                <p className="input-hint">
                  Analyzes continuous audio for multi-speaker attribution, discussion summaries, and holistic integrity audits.
                </p>
              </div>

              {enableCombinedLongAudio && (
                <>
                  <div className="form-group" style={{ marginTop: '10px' }}>
                    <label>Discussion / Session Audio Analysis Interval</label>
                    <select
                      value={sessionAudioIntervalMinutes}
                      onChange={(e) => setSessionAudioIntervalMinutes(parseInt(e.target.value, 10))}
                    >
                      <option value={0}>🎓 Full Session (Complete session audio at class conclusion)</option>
                      <option value={5}>⏱️ Every 5 Minutes (Short discussion checkpoints)</option>
                      <option value={10}>⏱️ Every 10 Minutes (Standard group discussion interval)</option>
                      <option value={15}>⏱️ Every 15 Minutes (Extended seminar interval)</option>
                      <option value={30}>⏱️ Every 30 Minutes (Lecture block interval)</option>
                    </select>
                    <p className="input-hint">
                      How frequently long continuous audio segments are summarized and audited.
                    </p>
                  </div>

                  <ClassPromptField
                    containerStyle={{ marginTop: '10px' }}
                    label="Discussion / Session Audio AI Prompt"
                    prompt={sessionAudioPrompt}
                    onOpenModal={() => handleOpenAudioPromptModal('session_audio')}
                    onReset={() => setSessionAudioPrompt(null)}
                    selectButtonText="Select Discussion / Session AI Prompt"
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Section 8: Live Subtitles, Translation & Subject Domain */}
      <div className="settings-section-card">
        <h3>🌐 8. Live Subtitles, Translation & Subject Domain</h3>
        <p className="input-hint" style={{ marginTop: 0, marginBottom: '1rem' }}>
          Configure the subject domain context and custom speech-to-text / translation rules for this classroom. Ensures AI models (Gemini Live, LiteRT Whisper &amp; Gemma) recognize discipline-specific terminology rather than assuming Computer Science/IT.
        </p>

        <div className="form-group">
          <label htmlFor="class-subject-domain-select">Course Subject / Discipline Domain</label>
          <select
            id="class-subject-domain-select"
            value={subjectDomain}
            onChange={(e) => setSubjectDomain(e.target.value)}
          >
            <option value="Computer Science &amp; Software Development">💻 Computer Science &amp; Software Development</option>
            <option value="Business, Finance &amp; Accounting">💼 Business, Finance &amp; Accounting</option>
            <option value="Design, Media &amp; Visual Arts">🎨 Design, Media &amp; Visual Arts</option>
            <option value="Healthcare, Nursing &amp; Medical Sciences">🏥 Healthcare, Nursing &amp; Medical Sciences</option>
            <option value="Engineering &amp; Construction">⚙️ Engineering &amp; Construction</option>
            <option value="Hospitality, Culinary &amp; Tourism">🍳 Hospitality, Culinary &amp; Tourism</option>
            <option value="Languages, Humanities &amp; Social Sciences">📚 Languages, Humanities &amp; Social Sciences</option>
            <option value="General Studies &amp; Interdisciplinary">🎓 General Studies &amp; Interdisciplinary</option>
            <option value="custom">✏️ Custom Subject Domain...</option>
          </select>
          <p className="input-hint">The subject context guides terminology preservation during lecture transcription and multilingual translation.</p>
        </div>

        {subjectDomain === 'custom' && (
          <div className="form-group" style={{ marginTop: '10px' }}>
            <label htmlFor="custom-subject-domain-input">Custom Subject Domain Description</label>
            <input
              id="custom-subject-domain-input"
              type="text"
              placeholder="e.g. Aeronautical Engineering, Fashion Merchandising, Biotechnology"
              value={customSubjectDomain}
              onChange={(e) => setCustomSubjectDomain(e.target.value)}
            />
          </div>
        )}

        <ClassPromptField
          containerStyle={{ marginTop: '1rem' }}
          label="Live Subtitle &amp; Speech Translation AI Prompt"
          prompt={subtitlePrompt}
          onOpenModal={() => handleOpenAudioPromptModal('subtitle')}
          onReset={() => setSubtitlePrompt(null)}
          selectButtonText="Select Subtitle Translation Prompt"
        />

      </div>

      {/* Section 9: Whole-Lecture Recording Studio: Subtitles (CC), AI Models & Archives */}
      <div className="settings-section-card" style={{ borderLeft: '4px solid #3b82f6' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
          <h3 style={{ margin: 0 }}>🎬 9. Whole-Lecture Recording Studio: Subtitles (CC), AI Models &amp; Archives</h3>
          <span style={{ fontSize: '0.78rem', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>
            Session Recordings &amp; Multilingual CC
          </span>
        </div>
        <p className="input-hint" style={{ marginTop: '0.5rem', marginBottom: '1.25rem' }}>
          Configure automated Gemini speech-to-text, Cantonese-English code switching, technical jargon prompts, multilingual CC translations, and student playback permissions for recorded classroom sessions.
        </p>

        {/* 1. Automated AI Subtitles Toggle */}
        <div className="form-group" style={{ padding: '14px 16px', background: isLectureSubtitlesEnabled ? '#f0fdf4' : '#f8fafc', borderRadius: '8px', border: isLectureSubtitlesEnabled ? '1.5px solid #86efac' : '1px solid #e2e8f0' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', margin: 0 }}>
            <input
              type="checkbox"
              checked={isLectureSubtitlesEnabled}
              onChange={(e) => setIsLectureSubtitlesEnabled(e.target.checked)}
              style={{ width: '20px', height: '20px', accentColor: '#16a34a' }}
            />
            <span style={{ fontSize: '0.95rem', color: isLectureSubtitlesEnabled ? '#15803d' : '#475569' }}>
              💬 Automated AI Transcription &amp; Multilingual Subtitles (CC)
            </span>
            <span style={{ marginLeft: 'auto', fontSize: '0.8rem', fontWeight: 700, color: isLectureSubtitlesEnabled ? '#16a34a' : '#94a3b8' }}>
              {isLectureSubtitlesEnabled ? 'ENABLED' : 'DISABLED'}
            </span>
          </label>
          <p className="input-hint" style={{ marginTop: '6px', marginBottom: 0, color: isLectureSubtitlesEnabled ? '#166534' : '#64748b' }}>
            {isLectureSubtitlesEnabled
              ? 'When lectures finish recording, Gemini automatically synthesizes timestamped subtitles and multilingual CC files (.vtt / .srt).'
              : 'Automated AI processing is skipped when recordings finish to conserve Gemini token quota and costs. You can still generate CC manually on-demand anytime from Lecture Recordings View.'}
          </p>
        </div>

        {/* 2. Paired AI Prompts Pipeline (Required in Pair) */}
        <div style={{
          marginTop: '1.25rem',
          padding: '16px',
          background: '#f8fafc',
          border: '1.5px solid #cbd5e1',
          borderRadius: '8px',
          opacity: isLectureSubtitlesEnabled ? 1 : 0.75,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.96rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>🔗</span> 2. Paired AI Prompts Pipeline
                <span style={{ fontSize: '0.75rem', background: '#dbeafe', color: '#1e40af', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
                  2 Prompts Required in Pair
                </span>
              </div>
              <p className="input-hint" style={{ marginTop: '2px', marginBottom: 0 }}>
                Subtitle synthesis executes in two distinct stages: Stage 1 performs speech recognition &amp; chapters; Stage 2 translates sentence cues into selected languages one by one.
              </p>
            </div>
          </div>

          {(() => {
            const activeStt = lectureSttPrompt || lectureRecordingPrompt || DEFAULT_LECTURE_STT_PROMPT;
            const isCustomStt = Boolean(
              activeStt && (
                activeStt.id !== DEFAULT_LECTURE_STT_PROMPT.id ||
                (activeStt.promptText && activeStt.promptText.trim() !== DEFAULT_LECTURE_STT_PROMPT.promptText.trim())
              )
            );

            const activeTrans = lectureTranslationPrompt || DEFAULT_LECTURE_TRANSLATION_PROMPT;
            const isCustomTrans = Boolean(
              activeTrans && (
                activeTrans.id !== DEFAULT_LECTURE_TRANSLATION_PROMPT.id ||
                (activeTrans.promptText && activeTrans.promptText.trim() !== DEFAULT_LECTURE_TRANSLATION_PROMPT.promptText.trim())
              )
            );

            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '14px' }}>
                {/* Stage 1: Speech-to-Text & Milestone Chapters */}
                <ClassPromptField
                  cardStyle
                  label="🎙️ Stage 1: Speech-to-Text (STT) &amp; Chapters"
                  labelColor="#1e40af"
                  prompt={activeStt}
                  badgeText={isCustomStt ? 'Customized STT Active' : 'Default STT Active'}
                  badgeBg={isCustomStt ? '#dbeafe' : '#e0f2fe'}
                  badgeColor={isCustomStt ? '#1e40af' : '#0369a1'}
                  hint="Instruct Gemini on verbatim audio speech recognition, Cantonese-English code switching, technical keywords, and YouTube milestone chapter rules."
                  onOpenModal={() => handleOpenAudioPromptModal('lecture_recording')}
                  onReset={isCustomStt ? () => {
                    setLectureSttPrompt(DEFAULT_LECTURE_STT_PROMPT);
                    setLectureRecordingPrompt(DEFAULT_LECTURE_STT_PROMPT);
                  } : null}
                  selectButtonText="🔍 Select STT Prompt from Library"
                  selectButtonStyle={{ border: '1.5px solid #3b82f6', color: '#1d4ed8' }}
                  resetButtonText="Reset to Default System Prompt"
                  previewLength={180}
                />

                {/* Stage 2: Multilingual Subtitle Translation */}
                <ClassPromptField
                  cardStyle
                  label="🌐 Stage 2: Multilingual Subtitle Translation"
                  labelColor="#15803d"
                  prompt={activeTrans}
                  badgeText={isCustomTrans ? 'Customized Translation Active' : 'Default Translation Active'}
                  badgeBg={isCustomTrans ? '#dcfce7' : '#ecfdf5'}
                  badgeColor={isCustomTrans ? '#166534' : '#047857'}
                  hint="Instruct Gemini on language-by-language subtitle translation, Cantonese-to-書面語 conversion, and domain terminology preservation."
                  onOpenModal={handleOpenTranslationPromptModal}
                  onReset={isCustomTrans ? () => setLectureTranslationPrompt(DEFAULT_LECTURE_TRANSLATION_PROMPT) : null}
                  selectButtonText="🌐 Select Translation Prompt from Library"
                  selectButtonStyle={{ border: '1.5px solid #16a34a', color: '#15803d' }}
                  resetButtonText="Reset to Default System Prompt"
                  previewLength={180}
                />
              </div>
            );
          })()}
        </div>

        {/* 3. Subtitle Translation Target Languages */}
        <div className="form-group" style={{ marginTop: '1.25rem', opacity: isLectureSubtitlesEnabled ? 1 : 0.75 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '6px' }}>
            <label style={{ fontWeight: 600, fontSize: '0.92rem', color: '#1e293b', margin: 0 }}>
              Subtitle Translation Target Languages ({lectureTargetLanguages.length} selected)
            </label>
            <div style={{ display: 'flex', gap: '8px', fontSize: '0.78rem' }}>
              <button
                type="button"
                className="btn-link"
                onClick={() => setLectureTargetLanguages(['en', 'zh-Hant', 'zh-Hans'])}
                style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontWeight: 600 }}
              >
                Standard 3 (EN / 繁 / 简)
              </button>
              <span style={{ color: '#cbd5e1' }}>|</span>
              <button
                type="button"
                className="btn-link"
                onClick={() => setLectureTargetLanguages(AVAILABLE_SUBTITLE_LANGUAGES.map((l) => l.code))}
                style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0, fontWeight: 600 }}
              >
                Select All ({AVAILABLE_SUBTITLE_LANGUAGES.length})
              </button>
            </div>
          </div>
          <p className="input-hint" style={{ marginTop: 0 }}>
            Select which languages Gemini will synthesize into WebVTT and YouTube SRT subtitle files.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
            {AVAILABLE_SUBTITLE_LANGUAGES.map((lang) => {
              const isChecked = lectureTargetLanguages.includes(lang.code);
              return (
                <label
                  key={lang.code}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: isChecked ? '1.5px solid #3b82f6' : '1px solid #cbd5e1',
                    backgroundColor: isChecked ? '#eff6ff' : '#ffffff',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontWeight: isChecked ? 600 : 400,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => {
                      if (isChecked) {
                        if (lectureTargetLanguages.length > 1) {
                          setLectureTargetLanguages(lectureTargetLanguages.filter((c) => c !== lang.code));
                        }
                      } else {
                        setLectureTargetLanguages([...lectureTargetLanguages, lang.code]);
                      }
                    }}
                    style={{ accentColor: '#3b82f6' }}
                  />
                  <span>{lang.icon} {lang.label} ({lang.code})</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* 4. Gemini AI Model for Lecture Audio */}
        <div className="form-group" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🤖</span>
            <span>Lecture Transcription &amp; Subtitle AI Model</span>
          </label>
          <p className="input-hint">
            Select the Gemini model used to generate multilingual subtitles (.vtt &amp; .srt) and YouTube chapters from your audio.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginTop: '8px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: lectureAiModel === 'gemini-3.8-flash' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: lectureAiModel === 'gemini-3.8-flash' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="lectureAiModel"
                value="gemini-3.8-flash"
                checked={lectureAiModel === 'gemini-3.8-flash'}
                onChange={() => setLectureAiModel('gemini-3.8-flash')}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  ✨ Gemini 3.8 Flash (Recommended)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Highest accuracy for technical CS terminology &amp; Cantonese/English code-switching with robust timestamps.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: lectureAiModel === 'gemini-3.5-flash-lite' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: lectureAiModel === 'gemini-3.5-flash-lite' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="lectureAiModel"
                value="gemini-3.5-flash-lite"
                checked={lectureAiModel === 'gemini-3.5-flash-lite'}
                onChange={() => setLectureAiModel('gemini-3.5-flash-lite')}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  🚀 Gemini 3.5 Flash-Lite (Economical)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Ultra-low cost high-throughput multimodal processing with solid speech recognition accuracy.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* 5. Broadcast Recording Default */}
        <div className="form-group" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🎥</span>
            <span>Teacher Screen Broadcast &amp; Lecture Recording Default</span>
          </label>
          <p className="input-hint">
            Configure whether teacher screen broadcasts automatically record HD video and voice for YouTube/CC archival by default, or stream live-only to students without saving.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginTop: '8px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: defaultLectureRecording ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: defaultLectureRecording ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="defaultLectureRecording"
                checked={defaultLectureRecording === true}
                onChange={() => setDefaultLectureRecording(true)}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  🎥 Record &amp; Stream by Default (Recommended)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Broadcasting automatically records HD video and pure voice to Cloud Storage so lectures are never accidentally forgotten.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: !defaultLectureRecording ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: !defaultLectureRecording ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="defaultLectureRecording"
                checked={defaultLectureRecording === false}
                onChange={() => setDefaultLectureRecording(false)}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  📡 Live Stream Only by Default
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Broadcasting streams live to student screens in real-time. Zero storage files are saved unless manually checked.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* 6. Student Access Policy */}
        <div className="form-group" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>📢</span>
            <span>Student Access to Teacher Lecture Recordings (Case 1)</span>
          </label>
          <p className="input-hint">
            Class-level access gate. Choose whether students have zero access (Private), access only to specifically approved recordings (Selective), or immediate access to every recorded lecture (Always Share).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginTop: '8px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: teacherRecordingsPolicy === 'private' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: teacherRecordingsPolicy === 'private' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="teacherRecordingsPolicy"
                value="private"
                checked={teacherRecordingsPolicy === 'private'}
                onChange={() => {
                  setTeacherRecordingsPolicy('private');
                  setAllowShareTeacherRecordings(false);
                }}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  🔒 Private to Instructor (Default Deny - Recommended)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Students cannot view or query teacher recordings. Protects internal teaching materials and recordings.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: teacherRecordingsPolicy === 'selective' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: teacherRecordingsPolicy === 'selective' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="teacherRecordingsPolicy"
                value="selective"
                checked={teacherRecordingsPolicy === 'selective'}
                onChange={() => {
                  setTeacherRecordingsPolicy('selective');
                  setAllowShareTeacherRecordings(true);
                }}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  👥 Allow Selective Sharing (Click &amp; Share)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Enables student access in "My Records". You still manually choose which specific recordings to share from the Lecture Studio.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: teacherRecordingsPolicy === 'always_shared' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: teacherRecordingsPolicy === 'always_shared' ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="teacherRecordingsPolicy"
                value="always_shared"
                checked={teacherRecordingsPolicy === 'always_shared'}
                onChange={() => {
                  setTeacherRecordingsPolicy('always_shared');
                  setAllowShareTeacherRecordings(true);
                }}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  🌐 Always Share with Class (Automatic / Public to Students)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Automatically shares all lecture recordings with enrolled students. No manual per-video approval needed in the video view UI.
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* 7. Lesson Video Consolidation */}
        <div className="form-group" style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: '1px solid #e2e8f0' }}>
          <label style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span>🎞️</span>
            <span>Lesson Video Consolidation (One Video per Lesson Slot)</span>
          </label>
          <p className="input-hint">
            Controls how recording clips and rolling chunks during a scheduled lesson are compiled into finalized videos.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '10px', marginTop: '8px' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: consolidateLessonVideo ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: consolidateLessonVideo ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="consolidateLessonVideo"
                checked={consolidateLessonVideo === true}
                onChange={() => setConsolidateLessonVideo(true)}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  🎞️ 1 Video per Lesson Slot (Recommended - Default)
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Automatically combines all recordings and segments captured during the same lesson slot into a single unified video. Even if the stream disconnects or restarts, students and teachers see one continuous lecture.
                </div>
              </div>
            </label>

            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                padding: '12px',
                borderRadius: '8px',
                border: !consolidateLessonVideo ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                backgroundColor: !consolidateLessonVideo ? '#eff6ff' : '#ffffff',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="consolidateLessonVideo"
                checked={consolidateLessonVideo === false}
                onChange={() => setConsolidateLessonVideo(false)}
                style={{ marginTop: '3px', accentColor: '#3b82f6' }}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.88rem', color: '#1e293b' }}>
                  ✂️ Separate Videos per Broadcast
                </div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '2px' }}>
                  Creates separate video archives whenever the teacher stops and restarts broadcasting.
                </div>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Section 10: Security & Access Restrictions */}
      <div className="settings-section-card">
        <h3>🔒 10. Security &amp; IP Restrictions</h3>
        <div className="form-group">
          <label>Allowed Classroom IP Addresses</label>
          <textarea
            placeholder="e.g. 202.125.10.0/24 (one per line)..."
            value={ipRestrictions}
            onChange={(e) => setIpRestrictions(e.target.value)}
            rows="3"
          />
          <p className="input-hint">Optional. If set, students can only log in from these approved IP addresses during scheduled hours.</p>
        </div>
      </div>
      </div>

      {/* Save Actions Bar */}
      <div className="settings-actions-bar">
        <div>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            Make sure to save your changes before leaving this page.
          </span>
        </div>
        <button className="save-settings-btn" onClick={handleUpdateClass} disabled={saving}>
          {saving ? 'Saving Changes...' : (selectedClass || embeddedClassId ? 'Save Class Settings' : 'Create Class')}
        </button>
      </div>

      {/* Danger Zone */}
      {(selectedClass || embeddedClassId) && (
        <div className="danger-zone-card">
          <h3>⚠️ Danger Zone</h3>
          <p>Deleting this class permanently removes its configuration. Associated storage archives can still be managed in Data Management.</p>
          <button className="danger-btn" onClick={handleDeleteClass}>
            Delete This Class
          </button>
        </div>
      )}

      {/* Batch Student Roster Upload Modal */}
      <BatchStudentUploadModal
        isOpen={showBatchUploadModal}
        onClose={() => setShowBatchUploadModal(false)}
        onApply={({ studentEmails: newEmails, studentProfiles: newProfiles, addedCount }) => {
          setStudentEmails(newEmails.join('\n'));
          setStudentProfiles(newProfiles);
          setStudentDirectory(prev => ({ ...prev, ...newProfiles }));
          setSuccessMessage(`Successfully applied ${addedCount} student(s) to roster! Click Save Class Settings to save changes.`);
        }}
        existingEmails={studentEmails}
        existingProfiles={{ ...studentDirectory, ...studentProfiles }}
        classId={selectedClass || classId}
      />

      {/* Class Timetable Safeguard Modal */}
      <ScheduleChangeModal
        show={showScheduleChangeModal}
        onClose={() => {
          setShowScheduleChangeModal(false);
          setSaving(false);
          setPendingSavePayload(null);
        }}
        onConfirm={handleConfirmScheduleChange}
        pastLessons={pastCompletedLessons}
        existingSchedule={initialSchedule || {}}
        newSchedule={{
          startDate: scheduleStartDate,
          endDate: scheduleEndDate,
          timeZone: timeZone,
          timeSlots: classSchedules,
        }}
      />
    </div>
  );
};

export default ClassManagement;
