import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import NativeModalDialog from './NativeModalDialog';
import { useActiveClassroomSession } from '../../utils/clientSessionGuard';
import { db, storage, functions } from '../../firebase-config';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  arrayUnion,
  deleteField,
} from 'firebase/firestore';
import { commitBatchChunks } from '../../utils/firestoreBatchUtils';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { getSupportedAudioMimeType, injectWebmDuration, formatDuration } from '../../hooks/useLectureRecorder';
import {
  normalizeStudentEmail,
  getStudentProfile,
  maskStudentName,
  maskStudentEmail,
  maskStudentId,
  usePrivacyMode,
} from '../../utils/studentDisplayUtils';
import {
  exportProjectMeetingsMatrixExcel,
  generateMeetingMarkdownMinutes,
  buildGoogleSheetCsvExportUrl,
  parseProjectWeeklyLogCsv,
  resolveSemesterStartMondayFromClass,
  resolveTotalProjectWeeksFromClass,
  resolveCurrentProjectWeek,
  formatWeekDateRange,
  rehydrateWeeklyLogDataFromPersistedProfiles,
  buildStudentContributionProfiles,
  mergeIncrementalStudentProfiles,
  bootstrapProjectGroupsFromWeeklyLogs,
  exportStudentContributionProfilesExcel,
  computeSupervisorPerformanceAnalytics,
  exportSupervisorPerformanceExcel,
  formatConsultationDuration,
  toVtcStudentEmail,
  extractVtcStudentId,
} from '../../utils/projectGroupUtils';
import { formatAiCost } from '../../utils/formatters';
import ProjectGroupEditorModal from './ProjectGroupEditorModal';
import './meetings.css';

function parseTimestampToSecs(ts) {
  if (typeof ts === 'number') return Math.max(0, ts);
  if (!ts || typeof ts !== 'string') return 0;
  const clean = ts.replace(/\[|\]/g, '').trim();
  const parts = clean.split(':').map((n) => parseFloat(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/**
 * Compresses an image file or blob client-side to maximum dimension 1280px (JPEG 0.85)
 * to keep photo artifacts lightweight (~200-350 KB) and fast to upload without losing whiteboard/code clarity.
 */
export async function compressPhotoBlob(fileOrBlob, maxDimension = 1280, quality = 0.85) {
  return new Promise((resolve) => {
    if (
      typeof Image === 'undefined' ||
      typeof document === 'undefined' ||
      typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function'
    ) {
      resolve({ blob: fileOrBlob, width: 1280, height: 720 });
      return;
    }

    try {
      const img = new Image();
      let timer = null;

      const finishFallback = () => {
        if (timer) clearTimeout(timer);
        resolve({ blob: fileOrBlob, width: 1280, height: 720 });
      };

      // Safeguard against jsdom or blocked image decoders
      timer = setTimeout(finishFallback, 250);

      const objectUrl = URL.createObjectURL(fileOrBlob);

      img.onload = () => {
        if (timer) clearTimeout(timer);
        try {
          URL.revokeObjectURL(objectUrl);
          let { width, height } = img;
          if (!width || !height) {
            resolve({ blob: fileOrBlob, width: 1280, height: 720 });
            return;
          }
          if (width > maxDimension || height > maxDimension) {
            if (width >= height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext?.('2d');
          if (!ctx || typeof canvas.toBlob !== 'function') {
            resolve({ blob: fileOrBlob, width, height });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              resolve({ blob: blob || fileOrBlob, width, height });
            },
            'image/jpeg',
            quality
          );
        } catch {
          resolve({ blob: fileOrBlob, width: 1280, height: 720 });
        }
      };

      img.onerror = () => {
        if (timer) clearTimeout(timer);
        try { URL.revokeObjectURL(objectUrl); } catch {}
        resolve({ blob: fileOrBlob, width: 1280, height: 720 });
      };

      img.src = objectUrl;
    } catch {
      resolve({ blob: fileOrBlob, width: 1280, height: 720 });
    }
  });
}

/**
 * Detects supported video MIME type for MediaRecorder on mobile/desktop browsers
 */
function getSupportedVideoMimeType() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
    return '';
  }
  const candidates = [
    'video/mp4;codecs=avc1,mp4a',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

/**
 * Checks if an individual audio clip has valid content (not an empty 0-byte or 0-duration test stub).
 */
export function isAudioClipValid(clip) {
  if (!clip) return false;
  const dur = Number(clip.durationSeconds);
  const rawSize = clip.fileSize ?? clip.fileSizeBytes ?? clip.size;
  const size = rawSize !== undefined && rawSize !== null ? Number(rawSize) : undefined;

  // Definitively empty if size is explicitly 0
  if (size === 0) return false;
  // Definitively empty if short stub (<= 2s) with tiny size (<= 256 bytes)
  if (!isNaN(dur) && dur <= 2 && size !== undefined && !isNaN(size) && size <= 256) return false;
  // If duration is <= 2s and size is not specified (e.g. 1s failed test stub)
  if (!isNaN(dur) && dur <= 2 && size === undefined) return false;

  return Boolean(clip.storagePath || clip.downloadUrl);
}

/**
 * Checks if a meeting document has any valid audio recording.
 */
export function hasMeetingValidAudio(m) {
  if (!m) return false;
  const clips = Array.isArray(m.audioClips) ? m.audioClips : [];
  if (clips.length > 0) {
    return clips.some((c) => isAudioClipValid(c));
  }
  return Boolean(m.audioStoragePath);
}

/**
 * Total valid duration across all valid clips in a meeting (in seconds).
 */
export function getMeetingValidAudioDuration(m) {
  if (!m) return 0;
  const clips = Array.isArray(m.audioClips) ? m.audioClips : [];
  if (clips.length > 0) {
    return clips
      .filter((c) => isAudioClipValid(c))
      .reduce((sum, c) => sum + (Number(c.durationSeconds) || 0), 0);
  }
  return Number(m.durationSeconds) || 0;
}

/**
 * Count of valid audio parts in a meeting.
 */
export function getMeetingValidClipCount(m) {
  if (!m) return 0;
  const clips = Array.isArray(m.audioClips) ? m.audioClips : [];
  if (clips.length > 0) {
    const validCount = clips.filter((c) => isAudioClipValid(c)).length;
    return validCount;
  }
  return m.audioStoragePath ? 1 : 0;
}

/**
 * Determines if a project meeting has audio recordings that require AI analysis or re-analysis:
 * - Completely unanalyzed meetings with valid audio
 * - Meetings explicitly flagged with `needsReanalysis: true` (e.g. after moving/deleting clips)
 * - Meetings where previous analysis failed or produced "No intelligible speech detected" while valid audio clips exist
 */
export function isMeetingPendingAnalysis(m) {
  if (!m) return false;
  if (!hasMeetingValidAudio(m)) return false;
  const isUnanalyzed = !m.analyzedAt && !m.aiModelUsed && !m.rawDiarizedTranscript;
  const needsReanalysis = m.needsReanalysis === true;
  const hadNoSpeechError = Boolean(
    m.rawDiarizedTranscript?.includes('No intelligible speech detected') ||
    m.keyInsights?.executiveSummary?.includes('No intelligible speech was recorded')
  );
  const isFailed = m.status === 'analysis_failed';
  return isUnanalyzed || needsReanalysis || hadNoSpeechError || isFailed;
}

/**
 * Aggregates supervision meetings by Project Group for a given week.
 * Resolves multi-session and multi-part recording situations (e.g. Group A04 having
 * 3 parts analyzed plus 2 empty 0-byte test stubs), preventing duplicate group names
 * and erroneous re-analysis of empty recordings.
 */
export function computeWeekGroupAiStats(meetings, weekNumber, groups = []) {
  const weekNum = Number(weekNumber);
  const weekMeetings = (meetings || []).filter((m) => Number(m.weekNumber) === weekNum);

  // Group meetings by groupId (or fallback to groupName)
  const groupMap = new Map();

  // Populate from all known groups if available
  (groups || []).forEach((g) => {
    if (g && g.id) {
      groupMap.set(g.id, {
        groupId: g.id,
        groupName: g.name || g.groupName || g.id,
        supervisorEmail: g.supervisorEmail || '',
        meetings: [],
      });
    }
  });

  // Assign meetings to their groups
  weekMeetings.forEach((m) => {
    const gId = m.groupId || m.groupName || 'unassigned';
    if (!groupMap.has(gId)) {
      groupMap.set(gId, {
        groupId: gId,
        groupName: m.groupName || gId,
        supervisorEmail: m.supervisorEmail || '',
        meetings: [],
      });
    }
    groupMap.get(gId).meetings.push(m);
  });

  const analyzedGroups = [];
  const pendingGroups = [];
  const emptyOnlyGroups = [];
  const validSessions = [];
  const pendingSessions = [];
  let totalEmptySessionsCount = 0;

  groupMap.forEach((entry) => {
    const allM = entry.meetings;
    if (allM.length === 0) return; // Group had no meetings in this week

    // Separate valid meetings from empty/corrupted sessions
    const validM = allM.filter((m) => hasMeetingValidAudio(m));
    const emptyM = allM.filter((m) => !hasMeetingValidAudio(m));
    totalEmptySessionsCount += emptyM.length;

    if (validM.length === 0) {
      if (emptyM.length > 0) {
        emptyOnlyGroups.push({
          ...entry,
          emptySessionsCount: emptyM.length,
        });
      }
      return;
    }

    // Add to overall valid sessions list
    validSessions.push(...validM);

    // Check analysis status among valid meetings
    const analyzedM = validM.filter((m) => !isMeetingPendingAnalysis(m));
    const pendingM = validM.filter((m) => isMeetingPendingAnalysis(m));

    pendingSessions.push(...pendingM);

    // Calculate aggregated duration and clip counts
    const totalDurationSeconds = validM.reduce((sum, m) => sum + getMeetingValidAudioDuration(m), 0);
    const totalValidClips = validM.reduce((sum, m) => sum + (Array.isArray(m.audioClips) ? m.audioClips.length : 1), 0);

    const groupSummary = {
      ...entry,
      validMeetingsCount: validM.length,
      emptySessionsCount: emptyM.length,
      analyzedMeetingsCount: analyzedM.length,
      pendingMeetingsCount: pendingM.length,
      totalDurationSeconds,
      totalValidClips,
      primaryMeeting: analyzedM.length > 0
        ? [...analyzedM].sort((a, b) => getMeetingValidAudioDuration(b) - getMeetingValidAudioDuration(a))[0]
        : [...validM].sort((a, b) => getMeetingValidAudioDuration(b) - getMeetingValidAudioDuration(a))[0],
      isPartiallyAnalyzed: analyzedM.length > 0 && pendingM.length > 0,
      isFullyAnalyzed: validM.length > 0 && pendingM.length === 0,
      isPending: analyzedM.length === 0 && pendingM.length > 0,
    };

    if (groupSummary.isFullyAnalyzed) {
      analyzedGroups.push(groupSummary);
    } else {
      pendingGroups.push(groupSummary);
    }
  });

  // Sort groups alphabetically by name
  analyzedGroups.sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));
  pendingGroups.sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));
  emptyOnlyGroups.sort((a, b) => (a.groupName || '').localeCompare(b.groupName || ''));

  return {
    weekNumber: weekNum,
    totalMeetings: weekMeetings.length,
    recordedGroupsCount: analyzedGroups.length + pendingGroups.length,
    analyzedGroupsCount: analyzedGroups.length,
    pendingGroupsCount: pendingGroups.length,
    emptyOnlyGroupsCount: emptyOnlyGroups.length,
    validSessionsCount: validSessions.length,
    pendingSessionsCount: pendingSessions.length,
    emptySessionsCount: totalEmptySessionsCount,
    analyzedGroups,
    pendingGroups,
    emptyOnlyGroups,
    validSessions,
    pendingSessions,

    // Backward-compatible aliases:
    withAudioCount: analyzedGroups.length + pendingGroups.length,
    missingCount: pendingGroups.length,
    analyzedCount: analyzedGroups.length,
    missingMeetings: pendingSessions,
    analyzedMeetings: validSessions.filter((m) => !isMeetingPendingAnalysis(m)),
    allAudioMeetings: validSessions,
  };
}

/**
 * Separates a meeting's AI pipeline status from its student progress health badge
 * so `At Risk` never hides whether AI analysis actually succeeded.
 */
export function getMeetingPipelineAndHealth(m, isAnalyzingOverride = false) {
  if (!m) {
    return {
      pipelineKey: 'empty',
      pipelineLabel: '⚪ Empty',
      healthKey: null,
      healthLabel: null,
      hasValidAudio: false,
      isAnalyzed: false,
      isEmptyOrFailed: true,
    };
  }
  const hasValidAudio = hasMeetingValidAudio(m);
  const isAnalyzed = Boolean(m.analyzedAt || m.aiModelUsed || m.rawDiarizedTranscript);
  const isFailed = m.status === 'analysis_failed';
  const isRecording = m.status === 'recording' && !hasValidAudio;

  let pipelineKey = 'empty';
  let pipelineLabel = '⚪ Empty';
  if (isAnalyzingOverride || m.status === 'analyzing') {
    pipelineKey = 'analyzing';
    pipelineLabel = '⏳ Analyzing...';
  } else if (isRecording) {
    pipelineKey = 'recording';
    pipelineLabel = '🔴 Live / Empty';
  } else if (isFailed) {
    pipelineKey = 'failed';
    pipelineLabel = '❌ Failed';
  } else if (isAnalyzed) {
    pipelineKey = 'analyzed';
    pipelineLabel = '✨ Analyzed';
  } else if (hasValidAudio) {
    pipelineKey = 'recorded';
    pipelineLabel = '🎙️ Pending AI';
  }

  let healthKey = null;
  let healthLabel = null;
  if (isAnalyzed) {
    const progress = m.keyInsights?.overallGroupProgress;
    if (progress === 'at_risk' || progress === 'behind') {
      healthKey = 'at_risk';
      healthLabel = '⚠️ At Risk';
    }
  }

  return {
    pipelineKey,
    pipelineLabel,
    healthKey,
    healthLabel,
    hasValidAudio,
    isAnalyzed,
    isEmptyOrFailed: !hasValidAudio && !isAnalyzed,
  };
}

/**
 * Aggregates raw meeting documents for a single project group by weekNumber,
 * picking one Primary Session per week and grouping duplicate/failed/0s takes
 * under `extraTakes` so `wk(s)` reflects distinct supervision weeks rather than raw doc count.
 */
export function aggregateGroupWeekSessions(items = []) {
  const byWeek = new Map();
  (items || []).forEach((m) => {
    const wk = Number(m.weekNumber) || 1;
    if (!byWeek.has(wk)) byWeek.set(wk, []);
    byWeek.get(wk).push(m);
  });

  const scoreMeetingPriority = (m) => {
    const info = getMeetingPipelineAndHealth(m);
    const dur = getMeetingValidAudioDuration(m);
    const clips = getMeetingValidClipCount(m);
    let tier = 0;
    if (info.isAnalyzed && info.hasValidAudio) tier = 4;
    else if (info.hasValidAudio) tier = 3;
    else if (info.isAnalyzed) tier = 2;
    else if (m.status !== 'analysis_failed' && m.status !== 'recording') tier = 1;
    return tier * 1e7 + dur * 100 + clips;
  };

  const weekSlots = [...byWeek.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([weekNumber, docs]) => {
      const sorted = [...docs].sort((a, b) => scoreMeetingPriority(b) - scoreMeetingPriority(a));
      const primary = sorted[0];
      const extraTakes = sorted.slice(1);
      const validTakesCount = sorted.filter((d) => hasMeetingValidAudio(d)).length;
      const emptyOrFailedTakesCount = extraTakes.filter((d) => {
        const st = getMeetingPipelineAndHealth(d);
        return st.isEmptyOrFailed || st.pipelineKey === 'failed';
      }).length;
      return {
        weekNumber,
        primary,
        extraTakes,
        validTakesCount,
        emptyOrFailedTakesCount,
        hasAnyValidOrAnalyzed: sorted.some((d) => {
          const st = getMeetingPipelineAndHealth(d);
          return st.hasValidAudio || st.isAnalyzed;
        }),
      };
    });

  const activeWeeksCount = weekSlots.filter((w) => w.hasAnyValidOrAnalyzed).length;
  const distinctWeeksCount = activeWeeksCount > 0 ? activeWeeksCount : weekSlots.length;

  return {
    weekSlots,
    distinctWeeksCount,
    latestSlot: weekSlots[0] || null,
  };
}

export default function ProjectMeetingsView({ classId, classInfo, user, isPrivacyMode: propPrivacyMode }) {
  const [hookPrivacyMode] = usePrivacyMode();
  const isPrivacyMode = propPrivacyMode !== undefined ? propPrivacyMode : hookPrivacyMode;
  const currentUserEmail = normalizeStudentEmail(user?.email || '');
  const currentUserName = user?.displayName || currentUserEmail.split('@')[0] || 'Supervisor';

  const formatStudentDisplayName = useCallback(
    (name, email) => {
      const raw = name || email || 'Student';
      return isPrivacyMode ? maskStudentName(raw) : raw;
    },
    [isPrivacyMode]
  );

  const formatStudentDisplayEmail = useCallback(
    (email) => {
      return isPrivacyMode ? maskStudentEmail(email) : (email || '');
    },
    [isPrivacyMode]
  );

  // Firestore collections state
  const [groups, setGroups] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [persistedProfiles, setPersistedProfiles] = useState([]);
  const [supervisorEvaluations, setSupervisorEvaluations] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter & Navigation state
  const [supervisorFilter, setSupervisorFilter] = useState('all'); // 'mine' | 'all'
  const [subViewMode, setSubViewMode] = useState(() => {
    try {
      if (typeof window !== 'undefined' && window.location?.search) {
        const sp = new URLSearchParams(window.location.search);
        const sv = sp.get('subview');
        if (sv && ['studio', 'profiles', 'matrix', 'supervisors'].includes(sv)) {
          return sv;
        }
      }
    } catch {
      // ignore
    }
    return 'studio';
  }); // 'studio' | 'profiles' | 'matrix' | 'supervisors'
  const [supervisorPerfWeekFilter, setSupervisorPerfWeekFilter] = useState('all');
  const [supervisorPerfAttributionMode, setSupervisorPerfAttributionMode] = useState('recording_supervisor'); // 'recording_supervisor' | 'assigned_supervisor'
  const [supervisorPerfSelectedEmail, setSupervisorPerfSelectedEmail] = useState('all');
  const [evaluatingSupervisorKey, setEvaluatingSupervisorKey] = useState('');
  const [isEvaluatingAllSupervisors, setIsEvaluatingAllSupervisors] = useState(false);
  const [inspectedSupervisorKey, setInspectedSupervisorKey] = useState('');
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
  const [showGroupEditorModal, setShowGroupEditorModal] = useState(false);
  const [showGroupPickerModal, setShowGroupPickerModal] = useState(false);
  const [groupPickerSearch, setGroupPickerSearch] = useState('');
  const [groupPickerStream, setGroupPickerStream] = useState('all'); // 'all' | 'mine' | 'unrecorded' | <prefix>
  const [sidebarScope, setSidebarScope] = useState('by_group'); // 'by_group' | 'this_week'
  const [expandedSidebarGroupIds, setExpandedSidebarGroupIds] = useState({});
  const [expandedExtraTakesKeys, setExpandedExtraTakesKeys] = useState({});

  // Unified Recording Studio & Master Selection state (Single Source of Truth)
  const [studioGroupId, setStudioGroupId] = useState('');
  const [studioWeekNumber, setStudioWeekNumber] = useState(1);
  const [studioTitle, setStudioTitle] = useState('');
  const [presenterStudentUid, setPresenterStudentUid] = useState('');
  const [forceNewMeetingDoc, setForceNewMeetingDoc] = useState(false);
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'uploading'
  useActiveClassroomSession(recordingState !== 'idle', 'project-meetings');
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studioError, setStudioError] = useState('');
  const [studioToast, setStudioToast] = useState('');
  const [micSuspendedWarning, setMicSuspendedWarning] = useState(false);

  // Player & Inspector state
  const [activeAudioClipIdx, setActiveAudioClipIdx] = useState(0);
  const [activeScreenClipIdx, setActiveScreenClipIdx] = useState(0);
  const [syncVideoWithAudio, setSyncVideoWithAudio] = useState(true);
  const [preferredAiModel, setPreferredAiModel] = useState('gemini-3.8-flash');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showBatchAiModal, setShowBatchAiModal] = useState(false);
  const [batchAnalysisProgress, setBatchAnalysisProgress] = useState(null);
  const cancelBatchAnalysisRef = useRef(false);
  const [showTranscriptDrawer, setShowTranscriptDrawer] = useState(false);
  const [editingStudentUid, setEditingStudentUid] = useState(null);
  const [editWorkDraft, setEditWorkDraft] = useState('');
  const [editActionDraft, setEditActionDraft] = useState('');
  const [editWeeklyFeedbackDraft, setEditWeeklyFeedbackDraft] = useState('');
  const [editLogQualityScoreDraft, setEditLogQualityScoreDraft] = useState('');
  const [editRealWorkScoreDraft, setEditRealWorkScoreDraft] = useState('');
  const [isEditingGroupFeedback, setIsEditingGroupFeedback] = useState(false);
  const [groupFeedbackDraft, setGroupFeedbackDraft] = useState('');

  // Email Report Modal state
  const [showEmailReportModal, setShowEmailReportModal] = useState(false);
  const [emailReportTargetMeeting, setEmailReportTargetMeeting] = useState(null);
  const [emailRecipientUids, setEmailRecipientUids] = useState([]);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailErrorMessage, setEmailErrorMessage] = useState('');
  const [emailSuccessMessage, setEmailSuccessMessage] = useState('');

  // Whole-Class Weekly Batch Email Reports Modal state
  const [showWeekBatchEmailModal, setShowWeekBatchEmailModal] = useState(false);
  const [batchEmailWeekNumber, setBatchEmailWeekNumber] = useState(1);
  const [batchEmailSelectedMeetingIds, setBatchEmailSelectedMeetingIds] = useState([]);
  const [batchEmailCustomNote, setBatchEmailCustomNote] = useState('');
  const [isBatchSendingEmails, setIsBatchSendingEmails] = useState(false);
  const [batchEmailProgress, setBatchEmailProgress] = useState({ current: 0, total: 0, groupName: '' });
  const [batchEmailResultsLog, setBatchEmailResultsLog] = useState([]);
  const [batchEmailErrorMessage, setBatchEmailErrorMessage] = useState('');
  const [batchEmailSuccessMessage, setBatchEmailSuccessMessage] = useState('');
  const [batchPreviewMeetingId, setBatchPreviewMeetingId] = useState(null);

  // Public Weekly Log Google Sheet (stored per-class in classes/{classId}.projectLogSheetUrl) & Student Contribution Profile state
  const [logSheetUrl, setLogSheetUrl] = useState(
    () => classInfo?.projectLogSheetUrl || ''
  );
  const [rawLogCsvText, setRawLogCsvText] = useState('');
  const [isSyncingLogSheet, setIsSyncingLogSheet] = useState(false);
  const [lastLogSyncAt, setLastLogSyncAt] = useState('');
  const [showStudioLogBriefing, setShowStudioLogBriefing] = useState(true);
  const [isPreparingLogQuestions, setIsPreparingLogQuestions] = useState(false);
  const [preMeetingAiAuditByGroupWeek, setPreMeetingAiAuditByGroupWeek] = useState({});

  // Sync logSheetUrl from classInfo.projectLogSheetUrl when classInfo loads
  useEffect(() => {
    if (classInfo?.projectLogSheetUrl && !logSheetUrl) {
      setLogSheetUrl(classInfo.projectLogSheetUrl);
    }
  }, [classInfo?.projectLogSheetUrl, logSheetUrl]);

  // Individual Student Contribution Profile filters & selection
  const [profileGroupFilter, setProfileGroupFilter] = useState('all');
  const [profileQualityFilter, setProfileQualityFilter] = useState('all'); // 'all' | 'suspected_ai_fake' | 'vague_useless' | 'inactive' | 'genuine'
  const [profileSearchQuery, setProfileSearchQuery] = useState('');
  const [selectedStudentProfileKey, setSelectedStudentProfileKey] = useState('');

  // Refs for MediaRecorder & Dual-Stream Player
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const recordingSecondsRef = useRef(0);
  const activeMeetingIdRef = useRef(null);
  const activeClipIdRef = useRef(null);
  const activePresenterUidRef = useRef('');
  const audioPlayerRef = useRef(null);
  const videoPlayerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Photo & 720p Mobile Video Capture state & refs
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [photoStudentUid, setPhotoStudentUid] = useState('');
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoLabelPreset, setPhotoLabelPreset] = useState('Whiteboard / Architecture');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [previewPhoto, setPreviewPhoto] = useState(null); // Photo object for Lightbox preview
  const photoInputRef = useRef(null);
  const photoGalleryInputRef = useRef(null);

  const [isVideoRecordingOpen, setIsVideoRecordingOpen] = useState(false);
  const [videoRecordingState, setVideoRecordingState] = useState('preview'); // 'preview' | 'recording' | 'uploading'
  const [videoRecordingSeconds, setVideoRecordingSeconds] = useState(0);
  const [videoCameraFacing, setVideoCameraFacing] = useState('environment'); // 'environment' | 'user'
  const [videoPresenterUid, setVideoPresenterUid] = useState('');
  const [videoLabelDraft, setVideoLabelDraft] = useState('');
  const [isVideoAutoSlicing, setIsVideoAutoSlicing] = useState(false);
  const videoRecorderRef = useRef(null);
  const videoStreamRef = useRef(null);
  const videoPreviewRef = useRef(null);
  const videoRecordedChunksRef = useRef([]);
  const videoTimerIntervalRef = useRef(null);
  const videoRecordingSecondsRef = useRef(0);

  // Keep mobile/desktop screen awake (Screen Wake Lock API) and guard against accidental reload during 20+ min meetings
  useEffect(() => {
    const isBusy =
      recordingState === 'recording' ||
      recordingState === 'paused' ||
      recordingState === 'uploading';

    if (!isBusy) {
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => {});
        wakeLockRef.current = null;
      }
      return undefined;
    }

    const requestWakeLock = async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.wakeLock?.request) {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
        }
      } catch {
        // Ignore if browser or battery saver blocks WakeLock
      }
    };

    requestWakeLock();

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };

    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = 'A project group meeting recording is currently in progress.';
      return e.returnValue;
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', handleBeforeUnload);
    }

    return () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('beforeunload', handleBeforeUnload);
      }
      if (wakeLockRef.current) {
        wakeLockRef.current.release?.().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [recordingState]);

  // Derive enrolled students & teachers from classInfo
  const studentProfiles = useMemo(() => classInfo?.studentProfiles || {}, [classInfo]);
  const enrolledStudents = useMemo(() => {
    const rawEmails = Array.isArray(classInfo?.studentEmails) ? classInfo.studentEmails : [];
    const studentsMap = classInfo?.students || {};
    const uidByEmail = {};
    Object.entries(studentsMap).forEach(([uid, sObj]) => {
      const em = normalizeStudentEmail(sObj?.email || '');
      if (em) uidByEmail[em] = uid;
    });

    return rawEmails.map((rawEm) => {
      const email = normalizeStudentEmail(rawEm);
      const profile = getStudentProfile(email, studentProfiles);
      return {
        uid: uidByEmail[email] || studentProfiles[email]?.uid || email,
        email,
        name: profile?.studentName || email.split('@')[0],
      };
    });
  }, [classInfo, studentProfiles]);

  const classTeachers = useMemo(() => {
    const set = new Set();
    if (classInfo?.teacherEmail) set.add(normalizeStudentEmail(classInfo.teacherEmail));
    if (classInfo?.ownerEmail) set.add(normalizeStudentEmail(classInfo.ownerEmail));
    (Array.isArray(classInfo?.teacherEmails) ? classInfo.teacherEmails : []).forEach((e) => {
      const clean = normalizeStudentEmail(e);
      if (clean) set.add(clean);
    });
    if (currentUserEmail) set.add(currentUserEmail);
    return [...set];
  }, [classInfo, currentUserEmail]);

  // Listen to projectGroups, projectMeetings, and persisted projectStudentProfiles in real time
  useEffect(() => {
    if (!classId) return;
    setLoading(true);

    const groupsRef = collection(db, `classes/${classId}/projectGroups`);
    const meetingsRef = collection(db, `classes/${classId}/projectMeetings`);
    const profilesRef = collection(db, `classes/${classId}/projectStudentProfiles`);
    const supEvalsRef = collection(db, `classes/${classId}/supervisorEvaluations`);

    const unsubGroups = onSnapshot(
      groupsRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
        setGroups(list);
      },
      (err) => console.error('[ProjectMeetingsView] Error loading projectGroups:', err)
    );

    const unsubMeetings = onSnapshot(
      meetingsRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        list.sort((a, b) => {
          const wkDiff = (Number(b.weekNumber) || 0) - (Number(a.weekNumber) || 0);
          if (wkDiff !== 0) return wkDiff;
          return new Date(b.meetingDate || 0).getTime() - new Date(a.meetingDate || 0).getTime();
        });
        setMeetings(list);
        setLoading(false);
      },
      (err) => {
        console.error('[ProjectMeetingsView] Error loading projectMeetings:', err);
        setLoading(false);
      }
    );

    const unsubProfiles = onSnapshot(
      profilesRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setPersistedProfiles(list);
      },
      (err) => console.error('[ProjectMeetingsView] Error loading projectStudentProfiles:', err)
    );

    const unsubSupEvals = onSnapshot(
      supEvalsRef,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setSupervisorEvaluations(list);
      },
      (err) => console.error('[ProjectMeetingsView] Error loading supervisorEvaluations:', err)
    );

    return () => {
      unsubGroups();
      unsubMeetings();
      unsubProfiles();
      unsubSupEvals();
    };
  }, [classId]);

  // Auto-select default studioGroupId when groups load
  const visibleGroups = useMemo(() => {
    if (supervisorFilter === 'mine' && currentUserEmail) {
      const mine = groups.filter((g) => {
        if (normalizeStudentEmail(g.supervisorEmail) === currentUserEmail) return true;
        if (
          Array.isArray(g.coSupervisorEmails) &&
          g.coSupervisorEmails.some((em) => normalizeStudentEmail(em) === currentUserEmail)
        ) {
          return true;
        }
        return meetings.some(
          (m) => m.groupId === g.id && normalizeStudentEmail(m.supervisorEmail) === currentUserEmail
        );
      });
      if (mine.length > 0) return mine;
    }
    return groups;
  }, [groups, meetings, supervisorFilter, currentUserEmail]);

  const groupStorageKey = useMemo(
    () => (classId ? `agy_studio_group_${classId}_${currentUserEmail || 'anon'}` : ''),
    [classId, currentUserEmail]
  );

  useEffect(() => {
    if (visibleGroups.length === 0) return;
    if (studioGroupId && visibleGroups.some((g) => g.id === studioGroupId)) {
      return;
    }
    let savedGroupId = '';
    try {
      if (groupStorageKey && typeof window !== 'undefined' && window.localStorage) {
        savedGroupId = window.localStorage.getItem(groupStorageKey) || '';
      }
    } catch {
      // Ignore storage errors
    }
    if (savedGroupId && visibleGroups.some((g) => g.id === savedGroupId)) {
      setStudioGroupId(savedGroupId);
    } else {
      setStudioGroupId(visibleGroups[0].id);
    }
  }, [visibleGroups, studioGroupId, groupStorageKey]);

  const activeStudioGroup = useMemo(
    () => groups.find((g) => g.id === studioGroupId) || null,
    [groups, studioGroupId]
  );

  // Check if a meeting document already exists for (studioGroupId, studioWeekNumber) recorded by the current supervisor
  // Co-supervisors recording in the same week automatically get a separate meeting document without overwriting the primary supervisor's recording
  const existingTargetMeeting = useMemo(() => {
    if (!studioGroupId || forceNewMeetingDoc) return null;
    return (
      meetings.find(
        (m) =>
          m.groupId === studioGroupId &&
          Number(m.weekNumber) === Number(studioWeekNumber) &&
          (!m.supervisorEmail ||
            !currentUserEmail ||
            normalizeStudentEmail(m.supervisorEmail) === currentUserEmail)
      ) || null
    );
  }, [meetings, studioGroupId, studioWeekNumber, forceNewMeetingDoc, currentUserEmail]);

  // Filter meetings for sidebar based on supervisor scope
  const filteredMeetings = useMemo(() => {
    const allowedGroupIds = new Set(visibleGroups.map((g) => g.id));
    return meetings.filter((m) => {
      if (supervisorFilter === 'mine' && groups.length > 0 && m.groupId && !allowedGroupIds.has(m.groupId)) {
        return false;
      }
      return true;
    });
  }, [meetings, visibleGroups, groups.length, supervisorFilter]);

  // Statistics for Batch AI Analysis on the currently selected week (aggregated by Project Group)
  const weekAiStats = useMemo(() => {
    return computeWeekGroupAiStats(meetings, studioWeekNumber, groups);
  }, [meetings, studioWeekNumber, groups]);

  // Quick Group Picker data with per-group recording status & stream prefix clustering for ~20+ groups on mobile
  const groupPickerData = useMemo(() => {
    const weekNum = Number(studioWeekNumber);
    const analyzedIds = new Set((weekAiStats.analyzedGroups || []).map((g) => g.groupId));
    const pendingIds = new Set((weekAiStats.pendingGroups || []).map((g) => g.groupId));

    const enriched = groups.map((g) => {
      const nameStr = String(g.name || g.id || '').trim();
      const prefixMatch = nameStr.replace(/^group\s+/i, '').match(/^([A-Za-z]+)\d+/);
      const streamPrefix = prefixMatch ? prefixMatch[1].toUpperCase() : '';
      const isMine = Boolean(
        currentUserEmail &&
        (normalizeStudentEmail(g.supervisorEmail) === currentUserEmail ||
          (Array.isArray(g.coSupervisorEmails) &&
            g.coSupervisorEmails.some((em) => normalizeStudentEmail(em) === currentUserEmail)))
      );
      const weekMeetings = meetings.filter(
        (m) => m.groupId === g.id && Number(m.weekNumber) === weekNum && hasMeetingValidAudio(m)
      );
      const isAnalyzed = analyzedIds.has(g.id);
      const isRecorded = isAnalyzed || pendingIds.has(g.id) || weekMeetings.length > 0;
      return {
        ...g,
        shortCode: nameStr.replace(/^group\s+/i, ''),
        streamPrefix,
        isMine,
        isAnalyzed,
        isRecorded,
        weekSessionsCount: weekMeetings.length,
      };
    });

    const streamCounts = {};
    enriched.forEach((g) => {
      if (g.streamPrefix) {
        streamCounts[g.streamPrefix] = (streamCounts[g.streamPrefix] || 0) + 1;
      }
    });
    const streamPrefixes = Object.keys(streamCounts).sort();
    const myCount = enriched.filter((g) => g.isMine).length;
    const unrecordedCount = enriched.filter((g) => !g.isRecorded).length;

    const searchLower = groupPickerSearch.trim().toLowerCase();
    const filtered = enriched.filter((g) => {
      if (groupPickerStream === 'mine' && !g.isMine) return false;
      if (groupPickerStream === 'unrecorded' && g.isRecorded) return false;
      if (
        groupPickerStream !== 'all' &&
        groupPickerStream !== 'mine' &&
        groupPickerStream !== 'unrecorded' &&
        g.streamPrefix !== groupPickerStream
      ) {
        return false;
      }
      if (searchLower) {
        const hay = `${g.name || ''} ${g.projectTopic || ''} ${g.supervisorName || ''} ${(g.members || []).map((m) => m.name || m.email).join(' ')}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }
      return true;
    });

    return {
      all: enriched,
      filtered,
      streamPrefixes,
      streamCounts,
      myCount,
      unrecordedCount,
    };
  }, [groups, meetings, studioWeekNumber, weekAiStats, currentUserEmail, groupPickerSearch, groupPickerStream]);

  // Unified Group & Week selection handlers
  const handleSelectGroup = useCallback(
    (newGroupId) => {
      setStudioGroupId(newGroupId);
      setPresenterStudentUid('');
      try {
        if (groupStorageKey && typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(groupStorageKey, newGroupId);
        }
      } catch {
        // Ignore storage errors
      }
      // Find matching meeting for (newGroupId, studioWeekNumber)
      const exactMatch = meetings.find(
        (m) => m.groupId === newGroupId && Number(m.weekNumber) === Number(studioWeekNumber)
      );
      if (exactMatch) {
        setSelectedMeetingId(exactMatch.id);
        setActiveAudioClipIdx(0);
        setActiveScreenClipIdx(0);
      } else {
        // Keep studioWeekNumber intact so the supervisor remains on the desired week to record new meetings!
        setSelectedMeetingId(null);
      }
    },
    [meetings, studioWeekNumber, groupStorageKey]
  );

  const handleSelectWeek = useCallback(
    (newWeekNum) => {
      setStudioWeekNumber(newWeekNum);
      const exactMatch = meetings.find(
        (m) => m.groupId === studioGroupId && Number(m.weekNumber) === Number(newWeekNum)
      );
      if (exactMatch) {
        setSelectedMeetingId(exactMatch.id);
        setActiveAudioClipIdx(0);
        setActiveScreenClipIdx(0);
      } else {
        setSelectedMeetingId(null);
      }
    },
    [meetings, studioGroupId]
  );

  const handleSelectMeeting = useCallback((m) => {
    if (!m) return;
    if (m.groupId) {
      setStudioGroupId(m.groupId);
      setPresenterStudentUid('');
    }
    if (m.weekNumber) {
      setStudioWeekNumber(Number(m.weekNumber) || 1);
    }
    setSelectedMeetingId(m.id);
    setActiveAudioClipIdx(0);
    setActiveScreenClipIdx(0);
    setMobileSidebarExpanded(false);
  }, []);

  // Ensure selectedMeetingId is always synchronized with the active studioGroupId and studioWeekNumber
  useEffect(() => {
    if (!studioGroupId) return;
    // Prefer meeting matching both current studioGroupId and studioWeekNumber
    const exactMatch = meetings.find(
      (m) => m.groupId === studioGroupId && Number(m.weekNumber) === Number(studioWeekNumber)
    );
    if (exactMatch) {
      if (selectedMeetingId !== exactMatch.id) {
        setSelectedMeetingId(exactMatch.id);
        setActiveAudioClipIdx(0);
        setActiveScreenClipIdx(0);
      }
      return;
    }
    // If no meeting exists for (studioGroupId, studioWeekNumber), clear selectedMeetingId
    // so the studio is clean and ready to record a new session for studioWeekNumber (never force week back)
    if (selectedMeetingId) {
      setSelectedMeetingId(null);
    }
  }, [studioGroupId, studioWeekNumber, meetings, selectedMeetingId]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedMeetingId) || null,
    [meetings, selectedMeetingId]
  );

  const showToastMessage = useCallback((msg) => {
    setStudioToast(msg);
    setTimeout(() => setStudioToast(''), 4000);
  }, []);

  const semesterStartMonday = useMemo(
    () => resolveSemesterStartMondayFromClass(classInfo),
    [classInfo]
  );

  const totalProjectWeeks = useMemo(
    () => resolveTotalProjectWeeksFromClass(classInfo, semesterStartMonday),
    [classInfo, semesterStartMonday]
  );

  const currentCalendarWeek = useMemo(() => {
    const hasSchedule = Boolean(
      classInfo?.schedule?.startDate ||
      classInfo?.projectLogSemesterStartMonday ||
      (Array.isArray(classInfo?.scheduleHistory) && classInfo.scheduleHistory.length > 0)
    );
    if (!hasSchedule) return null;
    return resolveCurrentProjectWeek(classInfo, semesterStartMonday, totalProjectWeeks);
  }, [classInfo, semesterStartMonday, totalProjectWeeks]);

  // Fetch, Parse & Incrementally Ingest Public Weekly Log Google Sheet (saved per-class in classes/{classId}.projectLogSheetUrl)
  const handleSyncWeeklyLogSheet = useCallback(
    async (customUrl = logSheetUrl, silent = false, options = {}) => {
      const {
        saveToClass = !silent,
        ingestToFirestore = !silent,
        syncGroups = false,
        forceFull = false,
      } = options;
      const targetUrl = String(customUrl || '').trim();
      if (!targetUrl) {
        if (!silent) {
          setStudioError('Please paste this class’s public Weekly Log Google Sheet URL first.');
        }
        return;
      }
      const csvExportUrl = buildGoogleSheetCsvExportUrl(targetUrl);
      if (!csvExportUrl) {
        if (!silent) {
          setStudioError('Invalid Google Sheet URL.');
        }
        return;
      }
      setIsSyncingLogSheet(true);
      if (!silent) setStudioError('');
      try {
        const res = await fetch(csvExportUrl);
        if (!res.ok) {
          throw new Error(`Google Sheet CSV fetch returned HTTP ${res.status}`);
        }
        const text = await res.text();
        setRawLogCsvText(text);
        const nowStr = new Date().toLocaleTimeString();
        setLastLogSyncAt(nowStr);

        const parsed = parseProjectWeeklyLogCsv(text, {
          enrolledStudents,
          existingGroups: groups,
          classInfo,
          semesterStartMonday,
        });

        // Persist URL to class and incrementally ingest weekly logs into student profiles in Firestore
        // Works even when there are 0 weekly meetings recorded!
        if (classId && (saveToClass || ingestToFirestore)) {
          const mergedGroups = bootstrapProjectGroupsFromWeeklyLogs({
            logData: parsed,
            existingGroups: groups,
            enrolledStudents,
            classTeachers,
            currentUserEmail,
            currentUserName,
          });
          const builtProfiles = buildStudentContributionProfiles({
            logData: parsed,
            groups: mergedGroups,
            meetings,
          });

          const {
            deltaProfiles,
            newLogEntriesCount,
            unchangedProfilesCount,
            isInitialBackfill,
          } = mergeIncrementalStudentProfiles({
            incomingProfiles: builtProfiles,
            existingProfiles: persistedProfiles,
            forceFull,
          });

          const lastEntryTimestamp =
            parsed.entries.length > 0 ? parsed.entries[parsed.entries.length - 1].timestamp || '' : '';
          const csvSignature = `${parsed.entries.length}__${lastEntryTimestamp}`;

          // Merge all discovered @stu.vtc.edu.hk emails and studentProfiles into the class roster
          const existingEmailsSet = new Set(
            (Array.isArray(classInfo?.studentEmails) ? classInfo.studentEmails : []).map((em) =>
              normalizeStudentEmail(em)
            )
          );
          const nextStudentProfilesMap = { ...(classInfo?.studentProfiles || {}) };
          builtProfiles.forEach((prof) => {
            const vtcEmail = toVtcStudentEmail(prof.email || prof.studentId);
            const stuId = extractVtcStudentId(vtcEmail);
            if (!vtcEmail) return;
            existingEmailsSet.add(vtcEmail);
            nextStudentProfilesMap[vtcEmail] = {
              ...(nextStudentProfilesMap[vtcEmail] || {}),
              email: vtcEmail,
              studentId: stuId,
              studentName:
                prof.name ||
                nextStudentProfilesMap[vtcEmail]?.studentName ||
                stuId,
              studentClass:
                prof.groupCode ||
                nextStudentProfilesMap[vtcEmail]?.studentClass ||
                '',
            };
          });

          const batchOps = [
            {
              type: 'set',
              ref: doc(db, `classes/${classId}`),
              data: {
                projectLogSheetUrl: targetUrl,
                projectLogLastSyncedAt: new Date().toISOString(),
                projectLogSummary: {
                  ...parsed.summary,
                  weeks: parsed.weeks,
                  groupCount: parsed.groupNames.length,
                  studentProfileCount: builtProfiles.length,
                  lastEntryTimestamp,
                  csvSignature,
                },
                studentEmails: [...existingEmailsSet].filter(Boolean),
                studentProfiles: nextStudentProfilesMap,
                updatedAt: serverTimestamp(),
              },
              options: { merge: true },
            },
          ];

          if ((syncGroups || groups.length === 0) && mergedGroups.length > 0) {
            mergedGroups.forEach((grp) => {
              batchOps.push({
                type: 'set',
                ref: doc(db, `classes/${classId}/projectGroups/${grp.id}`),
                data: {
                  name: grp.name || 'Group',
                  projectTopic: grp.projectTopic || '',
                  supervisorEmail: normalizeStudentEmail(grp.supervisorEmail || currentUserEmail),
                  supervisorName: grp.supervisorName || currentUserName,
                  supervisorUid: user?.uid || '',
                  members: Array.isArray(grp.members) ? grp.members : [],
                  updatedAt: serverTimestamp(),
                },
                options: { merge: true },
              });
            });
          }

          if (ingestToFirestore && deltaProfiles.length > 0) {
            deltaProfiles.forEach((prof) => {
              const vtcEmail = toVtcStudentEmail(prof.email || prof.studentId || prof.key);
              if (!vtcEmail) return;
              batchOps.push({
                type: 'set',
                ref: doc(db, `classes/${classId}/projectStudentProfiles/${vtcEmail}`),
                data: {
                  ...prof,
                  key: vtcEmail,
                  email: vtcEmail,
                  studentId: extractVtcStudentId(vtcEmail) || prof.studentId,
                  lastSyncedAt: new Date().toISOString(),
                  updatedAt: serverTimestamp(),
                },
                options: { merge: true },
              });
            });
          }

          await commitBatchChunks(db, batchOps).catch((err) => {
            console.warn('[ProjectMeetingsView] Could not persist ingested profiles to Firestore:', err);
          });

          if (!silent) {
            if (isInitialBackfill) {
              showToastMessage(
                `💾 Initial Backfill Complete: Saved Sheet URL & Ingested All ${parsed.summary.totalEntries} Historical Logs across ${deltaProfiles.length} Student Profiles!`
              );
            } else if (deltaProfiles.length > 0) {
              showToastMessage(
                `⚡ Incremental Sync: Ingested +${newLogEntriesCount} new log(s) across ${deltaProfiles.length} student(s) (${unchangedProfilesCount} unchanged skipped)!`
              );
            } else {
              showToastMessage(
                `✅ Up to Date: 0 new logs since last sync (${unchangedProfilesCount} student profiles unchanged, 0 profile writes)!`
              );
            }
          }
        } else if (!silent) {
          showToastMessage('🔄 Synced Weekly Log Sheet (Form Responses 2)!');
        }
      } catch (err) {
        if (!silent) {
          console.warn('[ProjectMeetingsView] Weekly log sheet sync error:', err);
          setStudioError(`Could not fetch public Weekly Log Sheet CSV: ${err.message}`);
        }
      } finally {
        setIsSyncingLogSheet(false);
      }
    },
    [
      logSheetUrl,
      enrolledStudents,
      groups,
      classId,
      classTeachers,
      currentUserEmail,
      currentUserName,
      meetings,
      persistedProfiles,
      user?.uid,
      showToastMessage,
      classInfo,
      semesterStartMonday,
    ]
  );

  const weeklyLogData = useMemo(() => {
    if (rawLogCsvText && rawLogCsvText.trim()) {
      return parseProjectWeeklyLogCsv(rawLogCsvText, {
        enrolledStudents,
        existingGroups: groups,
        classInfo,
        semesterStartMonday,
      });
    }
    if (persistedProfiles.length > 0) {
      return rehydrateWeeklyLogDataFromPersistedProfiles(persistedProfiles);
    }
    return parseProjectWeeklyLogCsv('', {
      enrolledStudents,
      existingGroups: groups,
      classInfo,
      semesterStartMonday,
    });
  }, [rawLogCsvText, persistedProfiles, enrolledStudents, groups, classInfo, semesterStartMonday]);

  // Available weeks breakdown for the Batch AI modal (aggregated by Project Group)
  const batchModalWeekOptions = useMemo(() => {
    const recordedWeeks = meetings.map((m) => Number(m.weekNumber) || 0);
    const logWeeks = (weeklyLogData?.weeks || []).map((w) => Number(w) || 0);
    const maxWeek = Math.max(totalProjectWeeks || 14, ...recordedWeeks, ...logWeeks, 14);
    const options = [];
    for (let wk = 1; wk <= maxWeek; wk++) {
      const stats = computeWeekGroupAiStats(meetings, wk, groups);
      options.push({
        week: wk,
        recordedGroupsCount: stats.recordedGroupsCount,
        pendingGroupsCount: stats.pendingGroupsCount,
        analyzedGroupsCount: stats.analyzedGroupsCount,
        validSessionsCount: stats.validSessionsCount,
        emptySessionsCount: stats.emptySessionsCount,
        totalWithAudio: stats.validSessionsCount,
        missingCount: stats.pendingGroupsCount,
        analyzedCount: stats.analyzedGroupsCount,
        rangeLabel: formatWeekDateRange(wk, semesterStartMonday),
      });
    }
    return options;
  }, [totalProjectWeeks, meetings, groups, weeklyLogData?.weeks, semesterStartMonday]);

  // Currently selected student contribution being edited in Modal
  const editingStudentContrib = useMemo(() => {
    if (!editingStudentUid || !selectedMeeting) return null;
    return (
      (selectedMeeting.studentContributions || []).find(
        (sc) => (sc.uid || sc.email) === editingStudentUid
      ) || null
    );
  }, [editingStudentUid, selectedMeeting]);

  const editingMatchingSheetLog = useMemo(() => {
    if (!editingStudentContrib || !selectedMeeting) return null;
    const mtgGrpCode = String(selectedMeeting.groupName || '')
      .replace(/^group\s+/i, '')
      .trim()
      .toUpperCase();
    const mtgGwKey = `${mtgGrpCode}__wk${selectedMeeting.weekNumber || 1}`;
    return (
      (weeklyLogData.byGroupAndWeek?.[mtgGwKey] || []).find(
        (l) =>
          normalizeStudentEmail(l.email) === normalizeStudentEmail(editingStudentContrib.email) ||
          l.studentId === String(editingStudentContrib.email || '').split('@')[0]
      ) || null
    );
  }, [editingStudentContrib, selectedMeeting, weeklyLogData]);

  const editingLogStatusClass = useMemo(() => {
    if (!editingStudentContrib) return 'inactive';
    const status =
      editingStudentContrib.logQualityAssessment && editingStudentContrib.logQualityAssessment !== 'not_submitted'
        ? editingStudentContrib.logQualityAssessment
        : editingMatchingSheetLog?.qualityStatus || 'not_submitted';
    if (
      status === 'suspected_ai_fake' ||
      status === 'suspected_ai_unverified' ||
      status === 'contradicted_in_meeting'
    ) {
      return 'suspected-ai';
    }
    if (status === 'vague_useless') return 'vague';
    if (status === 'genuine' || status === 'genuine_verified') return 'genuine';
    return 'inactive';
  }, [editingStudentContrib, editingMatchingSheetLog]);

  // Auto-select week on initial load:
  // 1. Prioritize the current calendar week of the ongoing semester (e.g. Week 11) so new recordings naturally default to this week
  // 2. Fall back to latest recorded week or latest weekly log week if outside active semester bounds
  const hasAutoSetWeekRef = useRef(false);
  useEffect(() => {
    if (hasAutoSetWeekRef.current || recordingState !== 'idle') {
      return;
    }

    // Default to the current real-world calendar week of the semester
    if (currentCalendarWeek && currentCalendarWeek >= 1 && currentCalendarWeek <= totalProjectWeeks) {
      hasAutoSetWeekRef.current = true;
      setStudioWeekNumber(currentCalendarWeek);
      return;
    }

    const weeksWithRecordings = meetings
      .filter((m) => (Array.isArray(m.audioClips) && m.audioClips.length > 0) || Boolean(m.audioStoragePath))
      .map((m) => Number(m.weekNumber))
      .filter((w) => w > 0);

    if (weeksWithRecordings.length > 0) {
      const latestRecordedWeek = Math.max(...weeksWithRecordings);
      hasAutoSetWeekRef.current = true;
      setStudioWeekNumber(latestRecordedWeek);
      return;
    }

    if (weeklyLogData.weeks && weeklyLogData.weeks.length > 0) {
      hasAutoSetWeekRef.current = true;
      setStudioWeekNumber(weeklyLogData.weeks[weeklyLogData.weeks.length - 1]);
    }
  }, [currentCalendarWeek, totalProjectWeeks, meetings, weeklyLogData.weeks, recordingState]);

  const studentContributionProfiles = useMemo(
    () =>
      buildStudentContributionProfiles({
        logData: weeklyLogData,
        groups,
        meetings,
      }),
    [weeklyLogData, groups, meetings]
  );

  const filteredStudentProfiles = useMemo(() => {
    const q = profileSearchQuery.trim().toLowerCase();
    return studentContributionProfiles.filter((p) => {
      if (
        supervisorFilter === 'mine' &&
        currentUserEmail &&
        groups.length > 0 &&
        p.supervisorEmail &&
        normalizeStudentEmail(p.supervisorEmail) !== currentUserEmail
      ) {
        return false;
      }
      if (
        profileGroupFilter !== 'all' &&
        p.groupId !== profileGroupFilter &&
        p.groupCode !== profileGroupFilter
      ) {
        return false;
      }
      if (profileQualityFilter === 'suspected_ai_fake' && p.suspectedAiLogsCount === 0) {
        return false;
      }
      if (profileQualityFilter === 'vague_useless' && p.vagueLogsCount === 0) {
        return false;
      }
      if (profileQualityFilter === 'inactive' && p.inactiveNoWeeks === 0 && p.missingWeeksCount < 2) {
        return false;
      }
      if (
        profileQualityFilter === 'genuine' &&
        (p.avgLogQualityScore < 7 || p.suspectedAiLogsCount > 0)
      ) {
        return false;
      }
      if (q) {
        const hay = `${p.name} ${p.studentId} ${p.email} ${p.groupName} ${p.supervisorName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    studentContributionProfiles,
    supervisorFilter,
    currentUserEmail,
    groups.length,
    profileGroupFilter,
    profileQualityFilter,
    profileSearchQuery,
  ]);

  useEffect(() => {
    if (
      filteredStudentProfiles.length > 0 &&
      (!selectedStudentProfileKey ||
        !filteredStudentProfiles.some((p) => p.key === selectedStudentProfileKey))
    ) {
      setSelectedStudentProfileKey(filteredStudentProfiles[0].key);
    }
  }, [filteredStudentProfiles, selectedStudentProfileKey]);

  const selectedStudentProfile = useMemo(
    () =>
      filteredStudentProfiles.find((p) => p.key === selectedStudentProfileKey) ||
      studentContributionProfiles.find((p) => p.key === selectedStudentProfileKey) ||
      null,
    [filteredStudentProfiles, studentContributionProfiles, selectedStudentProfileKey]
  );

  // Resolve the active Studio Group's weekly logs + prior history for `studioWeekNumber`
  const activeStudioGroupCode = useMemo(() => {
    const rawName = activeStudioGroup?.name || studioGroupId || '';
    return String(rawName)
      .replace(/^group\s+/i, '')
      .replace(/^grp_/i, '')
      .trim()
      .toUpperCase();
  }, [activeStudioGroup, studioGroupId]);

  const studioGroupAvailableWeeks = useMemo(() => {
    if (!activeStudioGroupCode) return weeklyLogData.weeks;
    const wkSet = new Set();
    (weeklyLogData.entries || []).forEach((e) => {
      if (String(e.groupId || '').toUpperCase() === activeStudioGroupCode) {
        wkSet.add(e.weekNumber);
      }
    });
    return [...wkSet].sort((a, b) => a - b);
  }, [weeklyLogData, activeStudioGroupCode]);

  const studioGroupWeekLogCards = useMemo(() => {
    if (!activeStudioGroup) return [];
    const gwKey = `${activeStudioGroupCode}__wk${studioWeekNumber}`;
    const sheetWeekLogs = weeklyLogData.byGroupAndWeek?.[gwKey] || [];
    const aiAuditKey = `${studioGroupId}__wk${studioWeekNumber}`;
    const aiAuditList =
      preMeetingAiAuditByGroupWeek[aiAuditKey] ||
      existingTargetMeeting?.preMeetingLogAudit ||
      [];

    // Merge group members with any additional students who logged under this group code
    const memberMap = new Map();
    (activeStudioGroup.members || []).forEach((m) => {
      const email = normalizeStudentEmail(m.email);
      const stuId = email.split('@')[0];
      memberMap.set(email || stuId, {
        uid: m.uid || email,
        email,
        studentId: stuId,
        name: m.name || stuId,
        role: m.role || 'Member',
      });
    });

    sheetWeekLogs.forEach((l) => {
      const email = normalizeStudentEmail(l.email);
      const key = email || l.studentId;
      if (!memberMap.has(key)) {
        memberMap.set(key, {
          uid: l.studentId || email,
          email,
          studentId: l.studentId,
          name: l.studentName || l.studentId,
          role: 'Member',
        });
      }
    });

    return [...memberMap.values()].map((stu) => {
      const logEntry =
        sheetWeekLogs.find(
          (l) =>
            normalizeStudentEmail(l.email) === stu.email ||
            (l.studentId && l.studentId === stu.studentId)
        ) || null;

      const allStuLogs = (weeklyLogData.entries || []).filter(
        (l) =>
          (normalizeStudentEmail(l.email) === stu.email ||
            (l.studentId && l.studentId === stu.studentId)) &&
          Number(l.weekNumber) < Number(studioWeekNumber)
      );

      const aiAudit =
        aiAuditList.find(
          (a) =>
            normalizeStudentEmail(a.email) === stu.email ||
            (a.studentId && a.studentId === stu.studentId) ||
            String(a.name || '').toLowerCase() === String(stu.name || '').toLowerCase()
        ) || null;

      const qualityStatus =
        aiAudit?.logQualityStatus ||
        logEntry?.qualityStatus ||
        'missing';
      const qualityScore =
        typeof aiAudit?.logQualityScore === 'number'
          ? aiAudit.logQualityScore
          : typeof logEntry?.qualityScore === 'number'
          ? logEntry.qualityScore
          : 0;
      const qualityReason =
        aiAudit?.logAuditSummary ||
        logEntry?.qualityReason ||
        'No weekly log submitted for this week in Form Responses 2.';
      const challengeQuestions =
        Array.isArray(aiAudit?.challengeQuestions) && aiAudit.challengeQuestions.length > 0
          ? aiAudit.challengeQuestions
          : Array.isArray(logEntry?.suggestedChallengeQuestions) && logEntry.suggestedChallengeQuestions.length > 0
          ? logEntry.suggestedChallengeQuestions
          : [
              `You did not submit a Week ${studioWeekNumber} log in Form Responses 2. What concrete work have you completed since last meeting, and can you show your code/commits now?`,
            ];

      return {
        ...stu,
        submitted: Boolean(logEntry),
        logEntry,
        priorHistory: allStuLogs,
        qualityStatus,
        qualityScore,
        qualityReason,
        challengeQuestions,
        isAiAudited: Boolean(aiAudit),
      };
    });
  }, [
    activeStudioGroup,
    activeStudioGroupCode,
    studioGroupId,
    studioWeekNumber,
    weeklyLogData,
    preMeetingAiAuditByGroupWeek,
    existingTargetMeeting,
  ]);

  // Save Project Groups from Modal
  const handleSaveProjectGroups = async (draftGroups) => {
    if (!classId) return;
    const ops = [];
    const keepIds = new Set(draftGroups.map((g) => g.id));

    // Delete removed groups
    groups.forEach((existingGrp) => {
      if (!keepIds.has(existingGrp.id)) {
        ops.push({
          type: 'delete',
          ref: doc(db, `classes/${classId}/projectGroups/${existingGrp.id}`),
        });
      }
    });

    // Upsert all draft groups
    draftGroups.forEach((grp) => {
      const grpRef = doc(db, `classes/${classId}/projectGroups/${grp.id}`);
      ops.push({
        type: 'set',
        ref: grpRef,
        data: {
          name: grp.name || 'Group',
          projectTopic: grp.projectTopic || '',
          supervisorEmail: normalizeStudentEmail(grp.supervisorEmail || currentUserEmail),
          supervisorName: grp.supervisorName || currentUserName,
          supervisorUid: user?.uid || '',
          members: Array.isArray(grp.members) ? grp.members : [],
          updatedAt: serverTimestamp(),
        },
        options: { merge: true },
      });
    });

    await commitBatchChunks(db, ops);
    showToastMessage(`Saved ${draftGroups.length} Project Group(s)!`);
  };

  // Change presenting member (attributes active speaker and marks attendance)
  const handleChangePresenterStudent = (newStudentUid) => {
    setPresenterStudentUid(newStudentUid);
    activePresenterUidRef.current = newStudentUid;
  };

  // Start Voice Recording (on Teacher Mobile / Laptop)
  const handleStartRecording = async () => {
    setStudioError('');
    if (!studioGroupId || !activeStudioGroup) {
      setStudioError('Please create and select a Project Group first.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      const mimeType = getSupportedAudioMimeType();
      const options = mimeType ? { mimeType, audioBitsPerSecond: 64000 } : {};
      const recorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      recordingSecondsRef.current = 0;
      setRecordingSeconds(0);

      // Resolve target meetingId (keep grouping for recordings in the same group + week!)
      const sessionGroupId = `${classId}_${studioGroupId}_wk${studioWeekNumber}`;
      const targetMeetingId = existingTargetMeeting
        ? existingTargetMeeting.id
        : `mtg_${studioGroupId}_wk${studioWeekNumber}_${Date.now()}`;
      const clipId = `clip_${Date.now()}`;
      activeMeetingIdRef.current = targetMeetingId;
      activeClipIdRef.current = clipId;
      activePresenterUidRef.current = presenterStudentUid;

      if (!existingTargetMeeting) {
        const defaultAttendance = (activeStudioGroup.members || []).map((m) => ({
          uid: m.uid || m.email,
          email: normalizeStudentEmail(m.email),
          name: m.name || m.email,
          role: m.role || 'Member',
          status: presenterStudentUid && (m.uid === presenterStudentUid || m.email === presenterStudentUid) ? 'present' : 'absent',
          detectedByAi: false,
          teacherVerified: Boolean(presenterStudentUid && (m.uid === presenterStudentUid || m.email === presenterStudentUid)),
          speakingContribution: 'none',
          evidence: '',
          firstHeardTimestamp: '',
        }));

        await setDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
          groupId: studioGroupId,
          groupName: activeStudioGroup.name,
          projectTopic: activeStudioGroup.projectTopic || '',
          sessionGroupId,
          weekNumber: Number(studioWeekNumber) || 1,
          title: studioTitle.trim() || `Week ${studioWeekNumber} Supervision Meeting`,
          meetingDate: new Date().toISOString(),
          supervisorUid: user?.uid || '',
          supervisorEmail: activeStudioGroup.supervisorEmail || currentUserEmail,
          supervisorName: activeStudioGroup.supervisorName || currentUserName,
          audioClips: [],
          screenClips: [],
          photos: [],
          voiceAnchors: [],
          recordingSegmentsCount: 0,
          durationSeconds: 0,
          status: 'recording',
          attendanceRecord: defaultAttendance,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
          status: 'recording',
          updatedAt: serverTimestamp(),
        });
      }

      setSelectedMeetingId(targetMeetingId);

      // Listen for OS/browser microphone stream mute events (e.g. iOS screen lock or backgrounding)
      try {
        const audioTrack = stream.getAudioTracks()?.[0];
        if (audioTrack) {
          audioTrack.onmute = () => {
            console.warn('[ProjectMeetingsView] Microphone track muted by OS (screen locked or tab backgrounded)');
            setMicSuspendedWarning(true);
          };
          audioTrack.onunmute = () => {
            console.info('[ProjectMeetingsView] Microphone track unmuted');
            setMicSuspendedWarning(false);
          };
        }
      } catch {}

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.start(3000);
      setRecordingState('recording');
      setMicSuspendedWarning(false);

      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);

        // Periodically flush chunks every 5s for Safari/WebKit timeslice reliability
        if (recordingSecondsRef.current % 5 === 0 && recorder.state === 'recording') {
          try {
            recorder.requestData();
          } catch {}
        }
      }, 1000);
    } catch (err) {
      console.error('[ProjectMeetingsView] Microphone access error:', err);
      setStudioError(`Could not access microphone: ${err.message}`);
    }
  };

  const handlePauseResumeRecording = () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    if (rec.state === 'recording') {
      rec.pause();
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      setRecordingState('paused');
    } else if (rec.state === 'paused') {
      rec.resume();
      timerIntervalRef.current = setInterval(() => {
        recordingSecondsRef.current += 1;
        setRecordingSeconds(recordingSecondsRef.current);
      }, 1000);
      setRecordingState('recording');
    }
  };

  // Stop Recording, Upload Mobile Voice Clip to Grouped Meeting, Signal Student PC to Stop & Upload, and Trigger Gemini
  const handleStopAndSaveRecording = async (autoTriggerAi = true) => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }

    const rec = mediaRecorderRef.current;
    if (!rec) return;

    const targetMeetingId = activeMeetingIdRef.current;
    const clipId = activeClipIdRef.current || `clip_${Date.now()}`;
    const durationSecs = Math.max(1, recordingSecondsRef.current);

    setRecordingState('uploading');
    setUploadProgress(0);
    setMicSuspendedWarning(false);

    await new Promise((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state !== 'inactive') {
        try {
          rec.requestData();
        } catch {}
        rec.stop();
      } else {
        resolve();
      }
    });

    try {
      rec.stream?.getTracks()?.forEach((t) => t.stop());
    } catch {}

    try {
      const actualMime = rec.mimeType || getSupportedAudioMimeType() || 'audio/webm';
      const isMp4 = actualMime.includes('mp4') || actualMime.includes('m4a');
      const ext = isMp4 ? 'm4a' : 'webm';
      let blob = new Blob(recordedChunksRef.current, { type: actualMime });

      // Guard against iOS lock-screen or background microphone suspension (e.g. <25KB after >15s)
      const totalBytes = blob.size;
      if (totalBytes === 0) {
        showToastMessage('⚠️ Recording was empty (0 bytes) and was discarded.');
        setRecordingState('idle');
        setUploadProgress(0);
        return;
      }
      const isTruncated = durationSecs > 15 && totalBytes < 25000;
      if (isTruncated && typeof window !== 'undefined' && typeof window.confirm === 'function') {
        console.warn(
          `[ProjectMeetingsView] Potential truncated recording: duration=${durationSecs}s, totalBytes=${totalBytes}`
        );
        const confirmSave = window.confirm(
          `⚠️ Incomplete Audio Recording Detected!\n\n` +
          `The recording timer ran for ${formatDuration(durationSecs)}, but only ~${(totalBytes / 1024).toFixed(1)} KB of audio was captured.\n` +
          `This happens on iOS Safari when the iPhone screen is locked, turns off, or another app is opened.\n\n` +
          `• Click OK to save what was captured (~1 second).\n` +
          `• Click Cancel to discard and re-record with your screen unlocked.`
        );
        if (!confirmSave) {
          setRecordingState('idle');
          setUploadProgress(0);
          return;
        }
      }

      // If truncated, inject realistic duration matching actual audio size (~8KB/sec) rather than misleading timer duration
      const effectiveDurationSecs = isTruncated
        ? Math.max(1, Math.min(durationSecs, Math.round(totalBytes / 8000)))
        : durationSecs;

      if (!isMp4) {
        blob = await injectWebmDuration(blob, effectiveDurationSecs * 1000);
      }

      const storagePath = `projectMeetings/${classId}/${studioGroupId}/${targetMeetingId}/voice_${clipId}.${ext}`;
      const fileRef = storageRef(storage, storagePath);

      const uploadTask = uploadBytesResumable(fileRef, blob, {
        contentType: isMp4 ? 'audio/mp4' : 'audio/webm',
      });

      await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snap) => {
            if (snap.totalBytes > 0) {
              setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
            }
          },
          (err) => reject(err),
          () => resolve()
        );
      });

      const downloadUrl = await getDownloadURL(fileRef);

      const currentMeetingDoc = meetings.find((m) => m.id === targetMeetingId);
      const prevClips = Array.isArray(currentMeetingDoc?.audioClips) ? currentMeetingDoc.audioClips : [];
      const partNumber = prevClips.length + 1;
      const presenterObj = (activeStudioGroup?.members || []).find(
        (m) => m.uid === activePresenterUidRef.current || m.email === activePresenterUidRef.current
      );

      const newClip = {
        clipId,
        label: presenterObj
          ? `Part ${partNumber} (${presenterObj.name})`
          : `Part ${partNumber}`,
        storagePath,
        downloadUrl,
        durationSeconds: effectiveDurationSecs,
        fileSize: blob.size,
        mimeType: isMp4 ? 'audio/mp4' : 'audio/webm',
        presenterStudentUid: presenterObj?.uid || '',
        presenterStudentName: presenterObj?.name || '',
        presenterStudentEmail: presenterObj?.email || '',
        recordedByEmail: currentUserEmail,
        recordedAt: new Date().toISOString(),
      };

      const updatedClips = [...prevClips, newClip];
      const totalDuration = updatedClips.reduce((sum, c) => sum + (Number(c.durationSeconds) || 0), 0);

      await updateDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
        audioStoragePath: updatedClips[0].storagePath,
        audioDownloadUrl: updatedClips[0].downloadUrl,
        audioClips: updatedClips,
        recordingSegmentsCount: updatedClips.length,
        durationSeconds: totalDuration,
        status: autoTriggerAi ? 'analyzing' : 'ready',
        updatedAt: serverTimestamp(),
      });

      setRecordingState('idle');
      setRecordingSeconds(0);
      showToastMessage(`Saved ${newClip.label} under ${activeStudioGroup?.name} (Week ${studioWeekNumber})!`);

      if (autoTriggerAi) {
        await handleRunGeminiAnalysis(targetMeetingId);
      }
    } catch (err) {
      console.error('[ProjectMeetingsView] Upload failed:', err);
      setStudioError(`Failed to upload voice clip: ${err.message}`);
      setRecordingState('idle');
    }
  };

  // Ensures a meeting document exists in Firestore for the active group & week (used by photo capture & video demos)
  const ensureTargetMeetingDoc = useCallback(
    async (initialStatus = 'ready') => {
      if (activeMeetingIdRef.current) {
        return activeMeetingIdRef.current;
      }
      if (existingTargetMeeting?.id) {
        activeMeetingIdRef.current = existingTargetMeeting.id;
        return existingTargetMeeting.id;
      }
      if (selectedMeeting?.id && selectedMeeting.groupId === studioGroupId) {
        activeMeetingIdRef.current = selectedMeeting.id;
        return selectedMeeting.id;
      }

      // Create new meeting doc
      const targetMeetingId = `mtg_${studioGroupId}_wk${studioWeekNumber}_${Date.now()}`;
      const sessionGroupId = `${classId}_${studioGroupId}_wk${studioWeekNumber}`;
      const defaultAttendance = (activeStudioGroup?.members || []).map((m) => ({
        uid: m.uid || m.email,
        email: normalizeStudentEmail(m.email),
        name: m.name || m.email,
        role: m.role || 'Member',
        status:
          presenterStudentUid && (m.uid === presenterStudentUid || m.email === presenterStudentUid)
            ? 'present'
            : 'absent',
        detectedByAi: false,
        teacherVerified: Boolean(
          presenterStudentUid && (m.uid === presenterStudentUid || m.email === presenterStudentUid)
        ),
        speakingContribution: 'none',
        evidence: '',
        firstHeardTimestamp: '',
      }));

      await setDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
        groupId: studioGroupId,
        groupName: activeStudioGroup?.name || 'Group',
        projectTopic: activeStudioGroup?.projectTopic || '',
        sessionGroupId,
        weekNumber: Number(studioWeekNumber) || 1,
        title: studioTitle.trim() || `Week ${studioWeekNumber} Supervision Meeting`,
        meetingDate: new Date().toISOString(),
        supervisorUid: user?.uid || '',
        supervisorEmail: activeStudioGroup?.supervisorEmail || currentUserEmail,
        supervisorName: activeStudioGroup?.supervisorName || currentUserName,
        audioClips: [],
        screenClips: [],
        photos: [],
        voiceAnchors: [],
        recordingSegmentsCount: 0,
        durationSeconds: 0,
        status: initialStatus,
        attendanceRecord: defaultAttendance,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      activeMeetingIdRef.current = targetMeetingId;
      setSelectedMeetingId(targetMeetingId);
      return targetMeetingId;
    },
    [
      activeStudioGroup,
      classId,
      currentUserEmail,
      currentUserName,
      existingTargetMeeting,
      presenterStudentUid,
      selectedMeeting,
      studioGroupId,
      studioTitle,
      studioWeekNumber,
      user?.uid,
    ]
  );

  // Open photo capture modal
  const handleOpenPhotoModal = () => {
    if (!studioGroupId && !selectedMeeting) {
      setStudioError('Please select a Project Group before taking or uploading meeting photos.');
      return;
    }
    setPhotoStudentUid(presenterStudentUid || '');
    setPhotoCaption('');
    setPhotoLabelPreset('Whiteboard / Architecture');
    setIsPhotoModalOpen(true);
  };

  // Upload and persist photo artifact
  const handleUploadPhoto = async (file) => {
    if (!file) return;
    const targetGroupId = studioGroupId || selectedMeeting?.groupId;
    if (!targetGroupId) {
      setStudioError('Please select a Project Group before uploading photos.');
      return;
    }

    setIsUploadingPhoto(true);
    setStudioError('');

    try {
      const { blob: compressedBlob, width, height } = await compressPhotoBlob(file, 1280, 0.85);
      const targetMeetingId = await ensureTargetMeetingDoc('ready');
      const photoId = `photo_${Date.now()}`;
      const storagePath = `projectMeetings/${classId}/${targetGroupId}/${targetMeetingId}/photos/${photoId}.jpg`;
      const fileRef = storageRef(storage, storagePath);

      const uploadTask = uploadBytesResumable(fileRef, compressedBlob, { contentType: 'image/jpeg' });
      await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', null, reject, resolve);
      });

      const downloadUrl = await getDownloadURL(fileRef);

      const activeGrp = activeStudioGroup || groups.find((g) => g.id === targetGroupId);
      const studentObj = (activeGrp?.members || []).find(
        (m) => m.uid === photoStudentUid || m.email === photoStudentUid
      );

      const computedLabel = photoLabelPreset
        ? `${photoLabelPreset}${studentObj ? ` (${studentObj.name})` : ''}`
        : (studentObj ? `Photo (${studentObj.name})` : 'Meeting Photo');

      const photoEntry = {
        photoId,
        label: computedLabel,
        caption: photoCaption.trim() || '',
        storagePath,
        downloadUrl,
        studentUid: studentObj?.uid || '',
        studentName: studentObj?.name || '',
        studentEmail: studentObj?.email || '',
        takenAt: new Date().toISOString(),
        fileSize: compressedBlob.size || file.size || 0,
        width,
        height,
        mimeType: 'image/jpeg',
      };

      await updateDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
        photos: arrayUnion(photoEntry),
        updatedAt: serverTimestamp(),
      });

      showToastMessage(`📸 Saved photo "${computedLabel}"!`);
      setIsPhotoModalOpen(false);
      setPhotoCaption('');
    } catch (err) {
      console.error('[ProjectMeetingsView] Photo upload error:', err);
      setStudioError(`Failed to save photo: ${err.message}`);
    } finally {
      setIsUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
      if (photoGalleryInputRef.current) photoGalleryInputRef.current.value = '';
    }
  };

  // Delete a specific meeting photo artifact
  const handleDeletePhoto = async (photoIdx) => {
    if (!selectedMeeting) return;
    const photos = Array.isArray(selectedMeeting.photos) ? selectedMeeting.photos : [];
    const photoToDelete = photos[photoIdx];
    if (!photoToDelete) return;

    const photoLabel = photoToDelete.label || `Photo ${photoIdx + 1}`;
    if (!window.confirm(`Delete photo "${photoLabel}"?`)) return;

    const remainingPhotos = photos.filter((_, i) => i !== photoIdx);
    if (photoToDelete.storagePath) {
      deleteObject(storageRef(storage, photoToDelete.storagePath)).catch((err) => {
        console.warn('[ProjectMeetingsView] Could not delete photo from storage:', err);
      });
    }

    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      photos: remainingPhotos,
      updatedAt: serverTimestamp(),
    });

    if (previewPhoto?.photoId === photoToDelete.photoId) {
      setPreviewPhoto(null);
    }

    showToastMessage(`🗑️ Deleted photo ${photoLabel}`);
  };

  // Camera stream handler for 720p Mobile Video Demo recording
  const startCameraStream = async (facing = videoCameraFacing) => {
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    const constraints = {
      video: {
        facingMode: { ideal: facing },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
      audio: { echoCancellation: true, noiseSuppression: true },
    };
    try {
      if (navigator?.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        videoStreamRef.current = stream;
        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
          videoPreviewRef.current.play?.().catch(() => {});
        }
      }
    } catch (err) {
      console.error('[ProjectMeetingsView] Camera stream error:', err);
      setStudioError(`Could not access camera for 720p recording: ${err.message}`);
    }
  };

  // Open 720p video demo recorder
  const handleOpenVideoRecorder = async () => {
    if (!studioGroupId && !selectedMeeting) {
      setStudioError('Please select a Project Group before recording demo video.');
      return;
    }
    setStudioError('');
    setVideoPresenterUid(presenterStudentUid || '');
    setVideoLabelDraft('');
    setVideoRecordingSeconds(0);
    setVideoRecordingState('preview');
    setIsVideoRecordingOpen(true);
    await startCameraStream(videoCameraFacing);
  };

  // Flip camera between environment (rear) and user (front)
  const handleFlipVideoCamera = async () => {
    const nextFacing = videoCameraFacing === 'environment' ? 'user' : 'environment';
    setVideoCameraFacing(nextFacing);
    await startCameraStream(nextFacing);
  };

  // Close 720p video demo recorder
  const handleCloseVideoRecorder = () => {
    if (videoTimerIntervalRef.current) {
      clearInterval(videoTimerIntervalRef.current);
      videoTimerIntervalRef.current = null;
    }
    if (videoRecorderRef.current && videoRecorderRef.current.state !== 'inactive') {
      try {
        videoRecorderRef.current.stop();
      } catch {}
    }
    if (videoStreamRef.current) {
      videoStreamRef.current.getTracks().forEach((t) => t.stop());
      videoStreamRef.current = null;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = null;
    }
    setIsVideoRecordingOpen(false);
    setVideoRecordingState('preview');
    setIsVideoAutoSlicing(false);
  };

  // Start 720p video demo recording (with seamless voice auto-slicing)
  const handleStart720pVideoRecording = async () => {
    setStudioError('');

    // Auto-slicing: if voice recording is currently active, slice voice Part 1 first
    const wasVoiceRecording = recordingState === 'recording' || recordingState === 'paused';
    if (wasVoiceRecording) {
      setIsVideoAutoSlicing(true);
      await handleStopAndSaveRecording(false);
    }

    try {
      const targetMeetingId = await ensureTargetMeetingDoc('recording');
      let stream = videoStreamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === 'ended')) {
        await startCameraStream(videoCameraFacing);
        stream = videoStreamRef.current;
      }
      if (!stream) {
        setStudioError('Cannot start video recording without camera stream.');
        return;
      }

      const mimeType = getSupportedVideoMimeType();
      const options = {
        videoBitsPerSecond: 1500000, // 720p default: ~1.5 Mbps
        ...(mimeType ? { mimeType } : {}),
      };

      const recorder = new MediaRecorder(stream, options);
      videoRecorderRef.current = recorder;
      videoRecordedChunksRef.current = [];
      videoRecordingSecondsRef.current = 0;
      setVideoRecordingSeconds(0);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          videoRecordedChunksRef.current.push(e.data);
        }
      };

      recorder.start(1000);
      setVideoRecordingState('recording');

      videoTimerIntervalRef.current = setInterval(() => {
        videoRecordingSecondsRef.current += 1;
        setVideoRecordingSeconds(videoRecordingSecondsRef.current);
      }, 1000);
    } catch (err) {
      console.error('[ProjectMeetingsView] Video record start error:', err);
      setStudioError(`Failed to start 720p demo recording: ${err.message}`);
    }
  };

  // Stop & save 720p demo video clip
  const handleStopAndSave720pVideo = async () => {
    const rec = videoRecorderRef.current;
    if (!rec) return;

    if (videoTimerIntervalRef.current) {
      clearInterval(videoTimerIntervalRef.current);
      videoTimerIntervalRef.current = null;
    }

    const durationSecs = Math.max(1, videoRecordingSecondsRef.current);
    const targetGroupId = studioGroupId || selectedMeeting?.groupId;
    const targetMeetingId = activeMeetingIdRef.current || (await ensureTargetMeetingDoc('recording'));
    const clipId = `demo_${Date.now()}`;

    setVideoRecordingState('uploading');
    setUploadProgress(0);

    await new Promise((resolve) => {
      rec.onstop = () => resolve();
      if (rec.state !== 'inactive') {
        try {
          rec.requestData();
        } catch {}
        rec.stop();
      } else {
        resolve();
      }
    });

    try {
      const actualMime = rec.mimeType || getSupportedVideoMimeType() || 'video/webm';
      const isMp4 = actualMime.includes('mp4');
      const ext = isMp4 ? 'mp4' : 'webm';
      let blob = new Blob(videoRecordedChunksRef.current, { type: actualMime });

      if (!isMp4) {
        blob = await injectWebmDuration(blob, durationSecs * 1000);
      }

      const storagePath = `projectMeetings/${classId}/${targetGroupId}/${targetMeetingId}/demo_${clipId}.${ext}`;
      const fileRef = storageRef(storage, storagePath);

      const uploadTask = uploadBytesResumable(fileRef, blob, {
        contentType: isMp4 ? 'video/mp4' : 'video/webm',
      });

      await new Promise((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snap) => {
            if (snap.totalBytes > 0) {
              setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
            }
          },
          reject,
          resolve
        );
      });

      const downloadUrl = await getDownloadURL(fileRef);

      const activeGrp = activeStudioGroup || groups.find((g) => g.id === targetGroupId);
      const presenterObj = (activeGrp?.members || []).find(
        (m) => m.uid === videoPresenterUid || m.email === videoPresenterUid
      );

      const computedLabel =
        videoLabelDraft.trim() ||
        (presenterObj ? `${presenterObj.name} Demo (720p)` : 'Mobile Demo Video (720p)');

      const demoEntry = {
        clipId,
        type: 'mobile_camera',
        resolution: '720p',
        label: computedLabel,
        storagePath,
        downloadUrl,
        durationSeconds: durationSecs,
        fileSize: blob.size,
        mimeType: blob.type || (isMp4 ? 'video/mp4' : 'video/webm'),
        studentUid: presenterObj?.uid || '',
        studentName: presenterObj?.name || '',
        studentEmail: presenterObj?.email || '',
        recordedByEmail: currentUserEmail,
        recordedAt: new Date().toISOString(),
      };

      await updateDoc(doc(db, `classes/${classId}/projectMeetings/${targetMeetingId}`), {
        screenClips: arrayUnion(demoEntry),
        updatedAt: serverTimestamp(),
      });

      handleCloseVideoRecorder();
      showToastMessage(`📹 Saved 720p Demo Video "${computedLabel}" (${formatDuration(durationSecs)})!`);

      // If video auto-sliced voice recording, automatically resume voice recording as Part 2!
      if (isVideoAutoSlicing) {
        setIsVideoAutoSlicing(false);
        await handleStartRecording();
      }
    } catch (err) {
      console.error('[ProjectMeetingsView] Video demo upload error:', err);
      setStudioError(`Failed to save 720p demo video: ${err.message}`);
      setVideoRecordingState('preview');
    }
  };

  // Sync / Bootstrap Project Groups directly from the Public Weekly Log Sheet
  const handleSyncGroupsFromLogSheet = async () => {
    if (!weeklyLogData || (weeklyLogData.entries || []).length === 0) {
      setStudioError('No weekly log entries loaded yet. Click "Sync Log Sheet" first.');
      return;
    }
    const mergedGroups = bootstrapProjectGroupsFromWeeklyLogs({
      logData: weeklyLogData,
      existingGroups: groups,
      enrolledStudents,
      classTeachers,
      currentUserEmail,
      currentUserName,
    });
    await handleSaveProjectGroups(mergedGroups);
    showToastMessage(`👥 Synced ${mergedGroups.length} Project Groups & Rosters from Weekly Log Sheet!`);
  };

  // Pre-Meeting: Generate Deep AI Challenge Questions for Fake / Vague Logs via Gemini
  const handlePrepareAiLogChallengeQuestions = async () => {
    if (!classId || !activeStudioGroup) return;
    if (studioGroupWeekLogCards.length === 0) {
      setStudioError('No group members or weekly logs found for this group.');
      return;
    }
    setIsPreparingLogQuestions(true);
    setStudioError('');
    try {
      const payloadLogs = studioGroupWeekLogCards.map((card) => ({
        studentId: card.studentId || '',
        email: card.email || '',
        studentName: card.name || '',
        submitted: card.submitted,
        isDoingSomething: card.logEntry ? card.logEntry.isDoingSomething : false,
        workDone: card.logEntry?.workDone || '',
        unfinished: card.logEntry?.unfinished || '',
        nextPlan: card.logEntry?.nextPlan || '',
        inactiveReason: card.logEntry?.inactiveReason || '',
        priorHistory: (card.priorHistory || []).slice(-3).map((p) => ({
          weekNumber: p.weekNumber,
          isDoingSomething: p.isDoingSomething,
          workDone: p.workDone,
          nextPlan: p.nextPlan,
          inactiveReason: p.inactiveReason,
        })),
      }));

      const callAnalyze = httpsCallable(functions, 'analyzeProjectMeeting', { timeout: 180000 });
      const res = await callAnalyze({
        classId,
        mode: 'prepare_log_questions',
        meetingId: existingTargetMeeting?.id || undefined,
        groupId: activeStudioGroup.id,
        groupName: activeStudioGroup.name,
        projectTopic: activeStudioGroup.projectTopic || '',
        weekNumber: studioWeekNumber,
        weeklyLogs: payloadLogs,
        preferredModel: preferredAiModel,
      });

      const auditResult = res?.data?.preMeetingLogAudit || [];
      if (auditResult.length > 0) {
        const key = `${studioGroupId}__wk${studioWeekNumber}`;
        setPreMeetingAiAuditByGroupWeek((prev) => ({
          ...prev,
          [key]: auditResult,
        }));
      }
      showToastMessage('🎯 AI Log Audit & Fake-Log Challenge Questions Ready!');
    } catch (err) {
      console.error('[ProjectMeetingsView] prepare_log_questions error:', err);
      setStudioError(`Could not generate AI log challenge questions: ${err.message}`);
    } finally {
      setIsPreparingLogQuestions(false);
    }
  };

  // Run Two-Stage Gemini Analysis (Stage 1: gemini-3.5-transcribe-preview Diarization + Stage 2: gemini-3.8-flash + Log Verification & Weekly Feedback)
  const handleRunGeminiAnalysis = async (targetId = selectedMeetingId) => {
    if (!classId || !targetId) return;
    setIsAnalyzing(true);
    setStudioError('');
    try {
      const mtgObj = meetings.find((m) => m.id === targetId) || selectedMeeting;
      const mtgWeek = Number(mtgObj?.weekNumber || studioWeekNumber || 1);
      const grpObj = groups.find((g) => g.id === mtgObj?.groupId);
      const rawGrpName = grpObj?.name || mtgObj?.groupName || mtgObj?.groupId || activeStudioGroup?.name || '';
      const grpCode = String(rawGrpName)
        .replace(/^group\s+/i, '')
        .replace(/^grp_/i, '')
        .trim()
        .toUpperCase();
      const gwKey = `${grpCode}__wk${mtgWeek}`;
      const weekLogsForMtg = (weeklyLogData.byGroupAndWeek?.[gwKey] || []).map((l) => {
        const priors = (weeklyLogData.entries || [])
          .filter(
            (e) =>
              (e.studentId === l.studentId || normalizeStudentEmail(e.email) === normalizeStudentEmail(l.email)) &&
              Number(e.weekNumber) < mtgWeek
          )
          .slice(-3)
          .map((p) => ({
            weekNumber: p.weekNumber,
            isDoingSomething: p.isDoingSomething,
            workDone: p.workDone,
            nextPlan: p.nextPlan,
            inactiveReason: p.inactiveReason,
          }));
        return {
          studentId: l.studentId,
          email: l.email,
          studentName: l.studentName,
          isDoingSomething: l.isDoingSomething,
          workDone: l.workDone,
          unfinished: l.unfinished,
          nextPlan: l.nextPlan,
          inactiveReason: l.inactiveReason,
          priorHistory: priors,
        };
      });

      const callAnalyze = httpsCallable(functions, 'analyzeProjectMeeting', { timeout: 540000 });
      await callAnalyze({
        classId,
        meetingId: targetId,
        preferredModel: preferredAiModel,
        weeklyLogs: weekLogsForMtg,
      });
      showToastMessage('✨ Gemini Diarization, Log Verification & Weekly Feedback Complete!');
    } catch (err) {
      console.error('[ProjectMeetingsView] analyzeProjectMeeting error:', err);
      setStudioError(`AI Analysis error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Batch Analyze All Groups in Selected Week (Mode 1: Missing Only | Mode 2: Re-Run All)
  const handleBatchAnalyzeWeek = async (mode = 'missing_only') => {
    const weekNum = Number(studioWeekNumber);
    const targets =
      mode === 'missing_only'
        ? (weekAiStats.pendingSessions || [])
        : (weekAiStats.validSessions || []);

    if (targets.length === 0) {
      showToastMessage(
        mode === 'missing_only'
          ? `All recorded groups in Week ${weekNum} have already been analyzed!`
          : `No valid recordings found in Week ${weekNum}.`
      );
      return;
    }

    cancelBatchAnalysisRef.current = false;
    setBatchAnalysisProgress({
      current: 0,
      total: targets.length,
      groupName: targets[0]?.groupName || targets[0]?.groupId || 'Starting...',
      meetingId: targets[0]?.id || null,
      weekNumber: weekNum,
      mode,
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < targets.length; i++) {
      if (cancelBatchAnalysisRef.current) {
        showToastMessage(`Batch analysis stopped after ${i} of ${targets.length} groups.`);
        break;
      }

      const mtg = targets[i];
      setBatchAnalysisProgress({
        current: i + 1,
        total: targets.length,
        groupName: mtg.groupName || mtg.groupId || `Meeting ${i + 1}`,
        meetingId: mtg.id,
        weekNumber: weekNum,
        mode,
      });

      try {
        await handleRunGeminiAnalysis(mtg.id);
        successCount++;
      } catch (err) {
        console.error(`[ProjectMeetingsView] Batch error on ${mtg.id}:`, err);
        failCount++;
      }
    }

    setBatchAnalysisProgress(null);
    setShowBatchAiModal(false);
    showToastMessage(
      `⚡ Batch Analysis Complete for Week ${weekNum}: ${successCount} analyzed${failCount > 0 ? `, ${failCount} failed` : ''}!`
    );
  };

  // Manual 1-Click Attendance Status Override
  const handleToggleAttendanceStatus = async (studentUidOrEmail, newStatus) => {
    if (!selectedMeeting) return;
    const updatedAttendance = (selectedMeeting.attendanceRecord || []).map((a) => {
      if (a.uid === studentUidOrEmail || a.email === studentUidOrEmail) {
        return {
          ...a,
          status: newStatus,
          teacherVerified: true,
        };
      }
      return a;
    });
    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      attendanceRecord: updatedAttendance,
      updatedAt: serverTimestamp(),
    });
  };

  // Delete a specific audio clip part (e.g. wrong or accidental recording)
  const handleDeleteAudioClip = async (clipIdx) => {
    if (!selectedMeeting) return;
    const clips = Array.isArray(selectedMeeting.audioClips) ? selectedMeeting.audioClips : [];
    const clipToDelete = clips[clipIdx];
    if (!clipToDelete) return;

    const clipLabel = clipToDelete.label || `Part ${clipIdx + 1}`;
    const confirmMsg = `Delete "${clipLabel}" (${formatDuration(clipToDelete.durationSeconds || 0)})?\nThis will remove this audio recording from the meeting session.`;
    if (!window.confirm(confirmMsg)) return;

    const remainingClips = clips.filter((_, i) => i !== clipIdx);
    const newTotalDuration = remainingClips.reduce(
      (sum, c) => sum + (Number(c.durationSeconds) || 0),
      0
    );

    if (clipToDelete.storagePath) {
      deleteObject(storageRef(storage, clipToDelete.storagePath)).catch((err) => {
        console.warn('[ProjectMeetingsView] Could not delete clip from storage:', err);
      });
    }

    const meetingRef = doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`);
    const deleteUpdates = {
      audioClips: remainingClips,
      audioStoragePath: remainingClips[0]?.storagePath || '',
      audioDownloadUrl: remainingClips[0]?.downloadUrl || '',
      recordingSegmentsCount: remainingClips.length,
      durationSeconds: newTotalDuration,
      status: 'ready',
      updatedAt: serverTimestamp(),
    };

    if (remainingClips.length === 0) {
      deleteUpdates.analyzedAt = deleteField();
      deleteUpdates.aiModelUsed = deleteField();
      deleteUpdates.aiCost = deleteField();
      deleteUpdates.rawDiarizedTranscript = deleteField();
      deleteUpdates.keyInsights = deleteField();
      deleteUpdates.studentContributions = deleteField();
      deleteUpdates.transcriptSegments = deleteField();
      deleteUpdates.summary = deleteField();
      deleteUpdates.needsReanalysis = deleteField();
    } else {
      deleteUpdates.needsReanalysis = true;
    }

    await updateDoc(meetingRef, deleteUpdates);

    setActiveAudioClipIdx((prev) => Math.max(0, Math.min(prev, remainingClips.length - 1)));
    showToastMessage(`🗑️ Deleted ${clipLabel}`);
  };

  // Delete a specific student PC screen clip
  const handleDeleteScreenClip = async (clipIdx) => {
    if (!selectedMeeting) return;
    const clips = Array.isArray(selectedMeeting.screenClips) ? selectedMeeting.screenClips : [];
    const clipToDelete = clips[clipIdx];
    if (!clipToDelete) return;

    const clipLabel = clipToDelete.label || clipToDelete.studentName || `Screen ${clipIdx + 1}`;
    if (!window.confirm(`Delete screen recording "${clipLabel}"?`)) return;

    const remainingClips = clips.filter((_, i) => i !== clipIdx);
    if (clipToDelete.storagePath) {
      deleteObject(storageRef(storage, clipToDelete.storagePath)).catch((err) => {
        console.warn('[ProjectMeetingsView] Could not delete screen clip from storage:', err);
      });
    }

    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      screenClips: remainingClips,
      updatedAt: serverTimestamp(),
    });

    setActiveScreenClipIdx((prev) => Math.max(0, Math.min(prev, remainingClips.length - 1)));
    showToastMessage(`🗑️ Deleted screen recording ${clipLabel}`);
  };

  // Permanently delete an entire meeting session
  const handleDeleteMeeting = async (meetingId) => {
    if (!meetingId) return;
    const mtg = meetings.find((m) => m.id === meetingId) || selectedMeeting;
    if (!mtg) return;

    const confirmMsg = `Are you sure you want to permanently delete this meeting session?\n\n"${mtg.groupName || 'Group'} — Week ${mtg.weekNumber || 1}: ${mtg.title}"\n\nAll recorded voice and screen clips for this session will be removed. This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    (mtg.audioClips || []).forEach((c) => {
      if (c.storagePath) {
        deleteObject(storageRef(storage, c.storagePath)).catch(() => {});
      }
    });
    (mtg.screenClips || []).forEach((c) => {
      if (c.storagePath) {
        deleteObject(storageRef(storage, c.storagePath)).catch(() => {});
      }
    });
    (mtg.photos || []).forEach((p) => {
      if (p.storagePath) {
        deleteObject(storageRef(storage, p.storagePath)).catch(() => {});
      }
    });

    await deleteDoc(doc(db, `classes/${classId}/projectMeetings/${meetingId}`));
    if (selectedMeetingId === meetingId) {
      setSelectedMeetingId(null);
    }
    showToastMessage(`🗑️ Deleted meeting session "${mtg.title}"`);
  };

  // Open Email Report Modal for a meeting
  const handleOpenEmailModal = (meeting) => {
    if (!meeting) return;
    setEmailReportTargetMeeting(meeting);
    const grp = groups.find((g) => g.id === meeting.groupId) || activeStudioGroup;
    const memberIds = (grp?.members || []).map((m) => m.uid || m.email);
    setEmailRecipientUids(memberIds);
    setEmailErrorMessage('');
    setEmailSuccessMessage('');
    setShowEmailReportModal(true);
  };

  // Toggle recipient in email modal
  const handleToggleEmailRecipient = (id) => {
    setEmailRecipientUids((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  // Send email via Cloud Function (nodemailer / noreply@vtc.edu.hk)
  const handleSendBackendEmail = async () => {
    if (!emailReportTargetMeeting) return;
    setIsSendingEmail(true);
    setEmailErrorMessage('');
    setEmailSuccessMessage('');
    try {
      const callEmail = httpsCallable(functions, 'emailProjectMeetingReport', { timeout: 120000 });
      const res = await callEmail({
        classId,
        meetingId: emailReportTargetMeeting.id,
        studentUids: emailRecipientUids,
        sendToAllTeammates: emailRecipientUids.length === 0,
        portalUrl: window.location.origin,
      });

      if (res.data?.success) {
        showToastMessage(`📧 Emailed report to ${res.data.count} student(s)!`);
        setEmailSuccessMessage(`Successfully sent email reports to ${res.data.count} student(s).`);
      } else {
        throw new Error(res.data?.errors?.[0]?.error || 'Failed to dispatch emails.');
      }
    } catch (err) {
      console.error('Email report error:', err);
      const msg = err.message || 'Failed to send email.';
      if (msg.includes('SMTP password is not configured') || err.code === 'failed-precondition') {
        setEmailErrorMessage(
          '⚠️ Backend SMTP password is not configured in Google Secret Manager (SMTP_PASSWORD) yet. You can launch your mail client below or configure it via Terraform.'
        );
      } else {
        setEmailErrorMessage(`Failed to send email: ${msg}`);
      }
    } finally {
      setIsSendingEmail(false);
    }
  };

  // Launch client-side mail draft (mailto:) pre-filled with minutes and recipients
  const handleOpenMailtoDraft = () => {
    if (!emailReportTargetMeeting) return;
    const grp = groups.find((g) => g.id === emailReportTargetMeeting.groupId) || activeStudioGroup;
    const members = grp?.members || [];
    const targetMembers = members.filter((m) => emailRecipientUids.includes(m.uid || m.email));
    const toEmails = (targetMembers.length > 0 ? targetMembers : members)
      .map((m) => m.email)
      .filter(Boolean)
      .join(';');

    const weekNum = emailReportTargetMeeting.weekNumber || 1;
    const groupName = grp?.name || 'Project Group';
    const topic = grp?.projectTopic || 'Capstone Project';
    const subject = `[Week ${weekNum}] Capstone Supervision Minutes & Feedback - ${groupName}`;

    const mdMinutes = generateMeetingMarkdownMinutes(emailReportTargetMeeting);
    const portalLink = `${window.location.origin}/student/records`;
    const bodyText = `Dear Teammates (${groupName}),\n\nHere are your official supervision meeting minutes and feedback for Week ${weekNum} (${topic}).\n\nView recordings, grades, and full records on the student portal:\n${portalLink}\n\n========================================\n\n${mdMinutes}`;

    const mailtoUrl = `mailto:${toEmails}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    window.open(mailtoUrl, '_blank');
    showToastMessage('📧 Opened email draft in your mail client!');
  };

  // Open Week Batch Email Reports Modal (Whole Class)
  const handleOpenWeekBatchEmailModal = (targetWeek) => {
    const wk = Number(targetWeek || studioWeekNumber || 1);
    setBatchEmailWeekNumber(wk);
    const weekMts = meetings.filter((m) => Number(m.weekNumber) === wk);
    const readyIds = weekMts
      .filter((m) => m.status === 'ready' || Boolean(m.analyzedAt || m.rawDiarizedTranscript || (Array.isArray(m.audioClips) && m.audioClips.length > 0)))
      .map((m) => m.id);
    setBatchEmailSelectedMeetingIds(readyIds.length > 0 ? readyIds : weekMts.map((m) => m.id));
    setBatchEmailCustomNote('');
    setBatchEmailResultsLog([]);
    setBatchEmailErrorMessage('');
    setBatchEmailSuccessMessage('');
    setShowWeekBatchEmailModal(true);
  };

  const handleToggleBatchEmailMeeting = (meetingId) => {
    setBatchEmailSelectedMeetingIds((prev) =>
      prev.includes(meetingId) ? prev.filter((id) => id !== meetingId) : [...prev, meetingId]
    );
  };

  const handleSelectAllBatchMeetings = (onlyAnalyzed = false) => {
    const weekMts = meetings.filter((m) => Number(m.weekNumber) === Number(batchEmailWeekNumber));
    if (onlyAnalyzed) {
      const readyIds = weekMts
        .filter((m) => m.status === 'ready' || Boolean(m.analyzedAt || m.rawDiarizedTranscript))
        .map((m) => m.id);
      setBatchEmailSelectedMeetingIds(readyIds);
    } else {
      setBatchEmailSelectedMeetingIds(weekMts.map((m) => m.id));
    }
  };

  const handleCopyWeekStudentEmails = () => {
    const weekMts = meetings.filter((m) => batchEmailSelectedMeetingIds.includes(m.id));
    const emails = new Set();
    weekMts.forEach((m) => {
      const grp = groups.find((g) => g.id === m.groupId);
      (grp?.members || []).forEach((mem) => {
        if (mem.email) emails.add(mem.email);
      });
      (m.attendanceRecord || []).forEach((att) => {
        if (att.email) emails.add(att.email);
      });
    });
    const list = [...emails].filter(Boolean);
    if (list.length === 0) {
      showToastMessage('⚠️ No student emails found for selected groups.');
      return;
    }
    navigator.clipboard?.writeText?.(list.join('; '));
    showToastMessage(`📋 Copied ${list.length} student email(s) for Week ${batchEmailWeekNumber} to clipboard!`);
  };

  const handleOpenWeekMailtoDraft = () => {
    const weekMts = meetings.filter((m) => batchEmailSelectedMeetingIds.includes(m.id));
    const emails = new Set();
    weekMts.forEach((m) => {
      const grp = groups.find((g) => g.id === m.groupId);
      (grp?.members || []).forEach((mem) => {
        if (mem.email) emails.add(mem.email);
      });
      (m.attendanceRecord || []).forEach((att) => {
        if (att.email) emails.add(att.email);
      });
    });
    const list = [...emails].filter(Boolean);
    if (list.length === 0) {
      showToastMessage('⚠️ No student emails found.');
      return;
    }
    const subject = `[Week ${batchEmailWeekNumber}] Supervision Meeting Reports & Feedback - Class Announcement`;
    const portalLink = `${window.location.origin}/student/records`;
    const bodyText = `Dear Project Students,\n\nYour official supervision meeting records, scores, and feedback for Week ${batchEmailWeekNumber} have been published.\n\n${batchEmailCustomNote ? `Supervisor Note:\n${batchEmailCustomNote}\n\n` : ''}Access your personalized recordings, meeting minutes, and grades at:\n${portalLink}\n\nBest regards,\nYour Project Supervisor`;
    const mailtoUrl = `mailto:${list.join(';')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyText)}`;
    window.open(mailtoUrl, '_blank');
    showToastMessage(`📧 Opened mail draft with ${list.length} student recipient(s)!`);
  };

  const handleSendWeekBatchEmails = async () => {
    const targetMeetings = meetings.filter((m) => batchEmailSelectedMeetingIds.includes(m.id));
    if (targetMeetings.length === 0) return;

    setIsBatchSendingEmails(true);
    setBatchEmailErrorMessage('');
    setBatchEmailSuccessMessage('');
    setBatchEmailResultsLog([]);
    setBatchEmailProgress({ current: 0, total: targetMeetings.length, groupName: '' });

    const callEmail = httpsCallable(functions, 'emailProjectMeetingReport', { timeout: 120000 });
    const results = [];
    let successCount = 0;
    let failCount = 0;
    let totalRecipients = 0;

    for (let i = 0; i < targetMeetings.length; i++) {
      const mtg = targetMeetings[i];
      const grp = groups.find((g) => g.id === mtg.groupId);
      const groupName = grp?.name || mtg.groupName || `Group #${i + 1}`;
      setBatchEmailProgress({ current: i + 1, total: targetMeetings.length, groupName });

      try {
        const res = await callEmail({
          classId,
          meetingId: mtg.id,
          sendToAllTeammates: true,
          portalUrl: window.location.origin,
          customNote: batchEmailCustomNote.trim(),
        });

        if (res.data?.success) {
          successCount++;
          const count = res.data.count || 0;
          totalRecipients += count;
          results.push({
            id: mtg.id,
            groupName,
            status: 'success',
            count,
            message: `Emailed ${count} student(s)`,
          });
        } else {
          failCount++;
          results.push({
            id: mtg.id,
            groupName,
            status: 'error',
            message: res.data?.errors?.[0]?.error || 'Failed to dispatch email',
          });
        }
      } catch (err) {
        failCount++;
        results.push({
          id: mtg.id,
          groupName,
          status: 'error',
          message: err.message || 'Dispatch failed',
        });
      }

      setBatchEmailResultsLog([...results]);
      if (i < targetMeetings.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    setIsBatchSendingEmails(false);
    if (failCount === 0) {
      const msg = `🎉 Successfully dispatched reports to ${successCount} group(s) (${totalRecipients} students) for Week ${batchEmailWeekNumber}!`;
      setBatchEmailSuccessMessage(msg);
      showToastMessage(msg);
    } else {
      setBatchEmailErrorMessage(
        `⚠️ Batch completed with errors: ${successCount} succeeded, ${failCount} failed. Please review the log.`
      );
    }
  };

  // Move a specific audio clip part to a different Project Group (e.g. accidentally recorded under the wrong group)
  const handleMoveAudioClipToGroup = async (clipIdx, targetGroupId) => {
    if (!selectedMeeting || !targetGroupId || targetGroupId === selectedMeeting.groupId) return;
    const targetGroup = groups.find((g) => g.id === targetGroupId);
    if (!targetGroup) return;

    const clips = Array.isArray(selectedMeeting.audioClips) ? selectedMeeting.audioClips : [];
    const clipToMove = clips[clipIdx];
    if (!clipToMove) return;

    const clipLabel = clipToMove.label || `Part ${clipIdx + 1}`;
    
    // Resolve the week number from the clip's actual recorded date (recordedAt / meetingDate),
    // falling back to selectedMeeting.weekNumber or studioWeekNumber
    const clipTimestamp = clipToMove.recordedAt || clipToMove.createdAt || selectedMeeting.meetingDate;
    let targetWeek = Number(selectedMeeting.weekNumber) || studioWeekNumber || 1;
    if (clipTimestamp) {
      const computedWeek = resolveCurrentProjectWeek(
        classInfo,
        semesterStartMonday,
        totalProjectWeeks,
        clipTimestamp
      );
      if (computedWeek && Number.isFinite(computedWeek) && computedWeek > 0) {
        targetWeek = computedWeek;
      }
    }

    const confirmMsg = `Move "${clipLabel}" (${formatDuration(clipToMove.durationSeconds || 0)}) from ${selectedMeeting.groupName} to Group ${targetGroup.name} (Week ${targetWeek})?`;
    if (!window.confirm(confirmMsg)) return;

    // 1. Remove clip from source meeting
    const remainingSourceClips = clips
      .filter((_, i) => i !== clipIdx)
      .map((c, i) => ({
        ...c,
        label: `Part ${i + 1}`,
      }));
    const sourceDuration = remainingSourceClips.reduce(
      (sum, c) => sum + (Number(c.durationSeconds) || 0),
      0
    );

    const sourceRef = doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`);
    const sourceUpdates = {
      audioClips: remainingSourceClips,
      audioStoragePath: remainingSourceClips[0]?.storagePath || '',
      audioDownloadUrl: remainingSourceClips[0]?.downloadUrl || '',
      recordingSegmentsCount: remainingSourceClips.length,
      durationSeconds: sourceDuration,
      status: 'ready',
      updatedAt: serverTimestamp(),
    };

    if (remainingSourceClips.length === 0) {
      sourceUpdates.analyzedAt = deleteField();
      sourceUpdates.aiModelUsed = deleteField();
      sourceUpdates.aiCost = deleteField();
      sourceUpdates.rawDiarizedTranscript = deleteField();
      sourceUpdates.keyInsights = deleteField();
      sourceUpdates.studentContributions = deleteField();
      sourceUpdates.transcriptSegments = deleteField();
      sourceUpdates.summary = deleteField();
      sourceUpdates.needsReanalysis = deleteField();
    } else {
      sourceUpdates.needsReanalysis = true;
    }

    await updateDoc(sourceRef, sourceUpdates);

    // 2. Add clip to target group's meeting (find existing meeting or create one)
    const existingTarget = meetings.find(
      (m) =>
        m.groupId === targetGroupId &&
        Number(m.weekNumber) === targetWeek &&
        m.id !== selectedMeeting.id
    );

    const movedClipObj = {
      ...clipToMove,
      label: `Part ${(existingTarget?.audioClips?.length || 0) + 1}`,
    };

    if (existingTarget) {
      const updatedTargetClips = [...(existingTarget.audioClips || []), movedClipObj];
      const targetDuration = updatedTargetClips.reduce(
        (sum, c) => sum + (Number(c.durationSeconds) || 0),
        0
      );
      const targetRef = doc(db, `classes/${classId}/projectMeetings/${existingTarget.id}`);
      await updateDoc(targetRef, {
        audioClips: updatedTargetClips,
        audioStoragePath: updatedTargetClips[0]?.storagePath || movedClipObj.storagePath,
        audioDownloadUrl: updatedTargetClips[0]?.downloadUrl || movedClipObj.downloadUrl,
        recordingSegmentsCount: updatedTargetClips.length,
        durationSeconds: targetDuration,
        status: 'ready',
        // Invalidate stale analysis results from before the clip was moved
        analyzedAt: deleteField(),
        aiModelUsed: deleteField(),
        aiCost: deleteField(),
        rawDiarizedTranscript: deleteField(),
        keyInsights: deleteField(),
        studentContributions: deleteField(),
        transcriptSegments: deleteField(),
        summary: deleteField(),
        needsReanalysis: true,
        updatedAt: serverTimestamp(),
      });
    } else {
      const newMeetingId = `mtg_${targetGroupId}_wk${targetWeek}_${Date.now()}`;
      const newMeetingDoc = {
        id: newMeetingId,
        classId,
        groupId: targetGroup.id,
        groupName: targetGroup.name,
        projectTopic: targetGroup.projectTopic || '',
        weekNumber: targetWeek,
        sessionGroupId: `${classId}_${targetGroupId}_wk${targetWeek}`,
        title: `Week ${targetWeek} Supervision Meeting`,
        meetingDate: clipToMove.recordedAt || new Date().toISOString(),
        supervisorUid: targetGroup.supervisorUid || user?.uid || '',
        supervisorEmail: targetGroup.supervisorEmail || currentUserEmail,
        supervisorName: targetGroup.supervisorName || currentUserName,
        audioClips: [movedClipObj],
        screenClips: [],
        photos: [],
        voiceAnchors: [],
        audioStoragePath: movedClipObj.storagePath || '',
        audioDownloadUrl: movedClipObj.downloadUrl || '',
        recordingSegmentsCount: 1,
        durationSeconds: Number(movedClipObj.durationSeconds) || 0,
        status: 'ready',
        attendanceRecord: (targetGroup.members || []).map((m) => ({
          uid: m.uid || m.email,
          email: normalizeStudentEmail(m.email),
          name: m.name,
          role: m.role || 'Member',
          status: 'present',
          speakingContribution: 'moderate',
        })),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(doc(db, `classes/${classId}/projectMeetings/${newMeetingId}`), newMeetingDoc);
    }

    setActiveAudioClipIdx(0);
    showToastMessage(`Moved ${clipLabel} to Group ${targetGroup.name}!`);
  };

  // Move an entire meeting session to a different Project Group
  const handleMoveMeetingToGroup = async (targetGroupId) => {
    if (!selectedMeeting || !targetGroupId || targetGroupId === selectedMeeting.groupId) return;
    const targetGroup = groups.find((g) => g.id === targetGroupId);
    if (!targetGroup) return;

    if (
      !window.confirm(
        `Move this entire meeting session to Group ${targetGroup.name} (${targetGroup.projectTopic || 'Project'})?`
      )
    )
      return;

    // Resolve the week number: if the meeting has a recorded meetingDate or clips with recordedAt,
    // verify the week number matches the recorded date rather than arbitrary week selection.
    let resolvedWeekNumber = Number(selectedMeeting.weekNumber) || 1;
    const meetingDateRef = selectedMeeting.meetingDate || (selectedMeeting.audioClips?.[0]?.recordedAt);
    if (meetingDateRef) {
      const computedWeek = resolveCurrentProjectWeek(
        classInfo,
        semesterStartMonday,
        totalProjectWeeks,
        meetingDateRef
      );
      if (computedWeek && Number.isFinite(computedWeek) && computedWeek > 0) {
        resolvedWeekNumber = computedWeek;
      }
    }

    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      groupId: targetGroup.id,
      groupName: targetGroup.name,
      projectTopic: targetGroup.projectTopic || '',
      weekNumber: resolvedWeekNumber,
      title: `Week ${resolvedWeekNumber} Supervision Meeting`,
      sessionGroupId: `${classId}_${targetGroup.id}_wk${resolvedWeekNumber}`,
      supervisorEmail: targetGroup.supervisorEmail || selectedMeeting.supervisorEmail,
      supervisorName: targetGroup.supervisorName || selectedMeeting.supervisorName,
      attendanceRecord: (targetGroup.members || []).map((m) => ({
        uid: m.uid || m.email,
        email: normalizeStudentEmail(m.email),
        name: m.name,
        role: m.role || 'Member',
        status: 'present',
        speakingContribution: 'moderate',
      })),
      analyzedAt: deleteField(),
      aiModelUsed: deleteField(),
      aiCost: deleteField(),
      rawDiarizedTranscript: deleteField(),
      keyInsights: deleteField(),
      studentContributions: deleteField(),
      transcriptSegments: deleteField(),
      summary: deleteField(),
      needsReanalysis: true,
      status: 'ready',
      updatedAt: serverTimestamp(),
    });
    setStudioGroupId(targetGroup.id);
    showToastMessage(`Moved meeting session to ${targetGroup.name}`);
  };

  // Save inline edited student work / action items / weekly feedback / log quality score
  const handleSaveStudentContributionEdit = async (studentUidOrEmail) => {
    if (!selectedMeeting) return;
    const workList = editWorkDraft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const actionList = editActionDraft
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedLogScore =
      editLogQualityScoreDraft !== '' && !Number.isNaN(Number(editLogQualityScoreDraft))
        ? Math.max(0, Math.min(10, Number(editLogQualityScoreDraft)))
        : undefined;
    const parsedRealScore =
      editRealWorkScoreDraft !== '' && !Number.isNaN(Number(editRealWorkScoreDraft))
        ? Math.max(0, Math.min(10, Number(editRealWorkScoreDraft)))
        : undefined;

    const updatedContribs = (selectedMeeting.studentContributions || []).map((sc) => {
      if (sc.uid === studentUidOrEmail || sc.email === studentUidOrEmail) {
        return {
          ...sc,
          workCompleted: workList,
          actionItemsNextWeek: actionList,
          weeklyFeedback: editWeeklyFeedbackDraft.trim(),
          ...(parsedLogScore !== undefined ? { logQualityScore: parsedLogScore } : {}),
          ...(parsedRealScore !== undefined ? { realWorkScore: parsedRealScore } : {}),
        };
      }
      return sc;
    });

    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      studentContributions: updatedContribs,
      updatedAt: serverTimestamp(),
    });
    setEditingStudentUid(null);
    showToastMessage('Updated student contribution & weekly feedback!');
  };

  // Save inline edited Weekly Group Feedback
  const handleSaveWeeklyGroupFeedback = async () => {
    if (!selectedMeeting) return;
    const updatedInsights = {
      ...(selectedMeeting.keyInsights || {}),
      weeklyGroupFeedback: groupFeedbackDraft.trim(),
    };
    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      keyInsights: updatedInsights,
      updatedAt: serverTimestamp(),
    });
    setIsEditingGroupFeedback(false);
    showToastMessage('Saved Weekly Group Feedback!');
  };

  // Seek both Audio and Video players to a timestamp (e.g. "02:15")
  const handleSeekToTimestamp = (tsString) => {
    const secs = parseTimestampToSecs(tsString);
    if (audioPlayerRef.current) {
      audioPlayerRef.current.currentTime = secs;
      audioPlayerRef.current.play?.().catch(() => {});
    }
    if (syncVideoWithAudio && videoPlayerRef.current) {
      videoPlayerRef.current.currentTime = secs;
      videoPlayerRef.current.play?.().catch(() => {});
    }
  };

  // Group meetings by Project Group and aggregate by distinct weekNumber for the sidebar
  const meetingsGroupedByProjectGroup = useMemo(() => {
    const map = new Map();
    visibleGroups.forEach((g) => {
      map.set(g.id, { group: g, items: [] });
    });

    filteredMeetings.forEach((m) => {
      const gId = m.groupId || 'unassigned';
      if (!map.has(gId)) {
        map.set(gId, {
          group: { id: gId, name: m.groupName || 'Unassigned Group', supervisorEmail: m.supervisorEmail || '' },
          items: [],
        });
      }
      map.get(gId).items.push(m);
    });

    // Aggregate raw documents into distinct week slots & place active studioGroupId at top
    const list = [...map.values()].map((entry) => {
      const agg = aggregateGroupWeekSessions(entry.items);
      return {
        ...entry,
        ...agg,
      };
    });

    list.sort((a, b) => {
      if (a.group.id === studioGroupId) return -1;
      if (b.group.id === studioGroupId) return 1;
      return (a.group.name || '').localeCompare(b.group.name || '', undefined, { numeric: true });
    });

    return list;
  }, [visibleGroups, filteredMeetings, studioGroupId]);

  const thisWeekSidebarRows = useMemo(() => {
    const wk = Number(studioWeekNumber) || 1;
    return meetingsGroupedByProjectGroup
      .map(({ group, weekSlots }) => {
        const slot = weekSlots.find((s) => Number(s.weekNumber) === wk) || null;
        return {
          group,
          slot,
          primary: slot?.primary || null,
          extraTakes: slot?.extraTakes || [],
        };
      })
      .sort((a, b) => {
        if (a.group.id === studioGroupId) return -1;
        if (b.group.id === studioGroupId) return 1;
        return (a.group.name || '').localeCompare(b.group.name || '', undefined, { numeric: true });
      });
  }, [meetingsGroupedByProjectGroup, studioWeekNumber, studioGroupId]);

  const activeAudioClip = useMemo(() => {
    if (!selectedMeeting) return null;
    const clips = Array.isArray(selectedMeeting.audioClips) ? selectedMeeting.audioClips : [];
    if (clips.length > 0) {
      return clips[Math.min(activeAudioClipIdx, clips.length - 1)] || clips[0];
    }
    if (selectedMeeting.audioDownloadUrl) {
      return {
        clipId: 'default',
        label: 'Part 1',
        downloadUrl: selectedMeeting.audioDownloadUrl,
        durationSeconds: selectedMeeting.durationSeconds || 0,
      };
    }
    return null;
  }, [selectedMeeting, activeAudioClipIdx]);

  const activeScreenClip = useMemo(() => {
    if (!selectedMeeting) return null;
    const sClips = Array.isArray(selectedMeeting.screenClips) ? selectedMeeting.screenClips : [];
    if (sClips.length > 0) {
      return sClips[Math.min(activeScreenClipIdx, sClips.length - 1)] || sClips[0];
    }
    return null;
  }, [selectedMeeting, activeScreenClipIdx]);

  const totalMeetingsAiCost = useMemo(() => {
    return meetings.reduce((sum, m) => sum + (Number(m.aiCost) || 0), 0);
  }, [meetings]);

  // Supervisor Performance & Group Consultation Time Analytics
  const supervisorPerformanceAnalytics = useMemo(() => {
    return computeSupervisorPerformanceAnalytics({
      groups: visibleGroups,
      meetings,
      supervisorEvaluations,
      weekFilter: supervisorPerfWeekFilter,
      attributionMode: supervisorPerfAttributionMode,
    });
  }, [
    visibleGroups,
    meetings,
    supervisorEvaluations,
    supervisorPerfWeekFilter,
    supervisorPerfAttributionMode,
  ]);

  const handleEvaluateSupervisorWithGemini = useCallback(
    async (sup) => {
      if (!classId || !sup) return;
      const targetKey = sup.key || sup.email || sup.name;
      setEvaluatingSupervisorKey(targetKey);
      setStudioError('');
      try {
        const callAnalyze = httpsCallable(functions, 'analyzeProjectMeeting', { timeout: 180000 });
        const res = await callAnalyze({
          classId,
          mode: 'evaluate_supervisor_performance',
          supervisorEmail: sup.email || '',
          supervisorName: sup.name || '',
          weekFilter: supervisorPerfWeekFilter,
          preferredModel: preferredAiModel,
        });
        const evalDoc = res?.data?.evaluation;
        if (evalDoc) {
          setSupervisorEvaluations((prev) => {
            const filtered = prev.filter(
              (item) =>
                item.supervisorKey !== evalDoc.supervisorKey &&
                normalizeStudentEmail(item.supervisorEmail) !==
                  normalizeStudentEmail(evalDoc.supervisorEmail)
            );
            return [...filtered, evalDoc];
          });
          setInspectedSupervisorKey(targetKey);
        }
        showToastMessage(
          `🎓 Gemini evaluated ${sup.name}: ${evalDoc?.overallScore ?? '—'}/10 (Instruction ${evalDoc?.instructionAndAdviceScore ?? '—'}/10 • Management ${evalDoc?.groupManagementScore ?? '—'}/10)`
        );
      } catch (err) {
        console.error('[ProjectMeetingsView] evaluate_supervisor_performance error:', err);
        setStudioError(`Could not evaluate ${sup.name}: ${err.message}`);
      } finally {
        setEvaluatingSupervisorKey('');
      }
    },
    [classId, supervisorPerfWeekFilter, preferredAiModel, showToastMessage]
  );

  const handleEvaluateAllSupervisorsWithGemini = useCallback(async () => {
    const list = (supervisorPerformanceAnalytics.supervisors || []).filter(
      (s) => s.sessionsCount > 0
    );
    if (!classId || list.length === 0) return;
    setIsEvaluatingAllSupervisors(true);
    setStudioError('');
    let doneCount = 0;
    try {
      const callAnalyze = httpsCallable(functions, 'analyzeProjectMeeting', { timeout: 180000 });
      for (const sup of list) {
        const targetKey = sup.key || sup.email || sup.name;
        setEvaluatingSupervisorKey(targetKey);
        const res = await callAnalyze({
          classId,
          mode: 'evaluate_supervisor_performance',
          supervisorEmail: sup.email || '',
          supervisorName: sup.name || '',
          weekFilter: supervisorPerfWeekFilter,
          preferredModel: preferredAiModel,
        });
        const evalDoc = res?.data?.evaluation;
        if (evalDoc) {
          doneCount += 1;
          setSupervisorEvaluations((prev) => {
            const filtered = prev.filter(
              (item) =>
                item.supervisorKey !== evalDoc.supervisorKey &&
                normalizeStudentEmail(item.supervisorEmail) !==
                  normalizeStudentEmail(evalDoc.supervisorEmail)
            );
            return [...filtered, evalDoc];
          });
        }
      }
      if (list[0]) {
        setInspectedSupervisorKey(list[0].key || list[0].email || list[0].name);
      }
      showToastMessage(`🎓 Gemini completed teacher evaluations for ${doneCount} supervisor(s)!`);
    } catch (err) {
      console.error('[ProjectMeetingsView] evaluate all supervisors error:', err);
      setStudioError(`Batch supervisor evaluation error: ${err.message}`);
    } finally {
      setEvaluatingSupervisorKey('');
      setIsEvaluatingAllSupervisors(false);
    }
  }, [
    classId,
    supervisorPerformanceAnalytics.supervisors,
    supervisorPerfWeekFilter,
    preferredAiModel,
    showToastMessage,
  ]);

  const filteredSupervisorGroupRows = useMemo(() => {
    const list = supervisorPerformanceAnalytics.groupRows || [];
    if (!supervisorPerfSelectedEmail || supervisorPerfSelectedEmail === 'all') {
      return list;
    }
    const targetEm = normalizeStudentEmail(supervisorPerfSelectedEmail);
    return list.filter((g) => {
      if (normalizeStudentEmail(g.supervisorEmail) === targetEm) return true;
      if ((g.coSupervisorEmails || []).includes(targetEm)) return true;
      return Object.values(g.weekCells || {}).some((c) =>
        (c?.recorderEmails || []).includes(targetEm)
      );
    });
  }, [supervisorPerformanceAnalytics, supervisorPerfSelectedEmail]);

  return (
    <div className="project-meetings-container">
      {/* Top Supervisor Filter & Module Toolbar */}
      <div className="project-meetings-top-bar">
        <div className="project-meetings-title-block">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>👥 Project Group Meetings & Supervision Studio</h2>
            {totalMeetingsAiCost > 0 && (
              <span
                style={{
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#4338ca',
                  background: '#e0e7ff',
                  border: '1px solid #c7d2fe',
                  padding: '2px 8px',
                  borderRadius: '12px',
                }}
                title="Total AI spend across all analyzed project supervision meetings in this class"
              >
                💰 Total Meetings AI Spend: {formatAiCost(totalMeetingsAiCost)}
              </span>
            )}
          </div>
          <span className="project-meetings-subtitle">
            Parallel Multi-Supervisor Any-Period Recording • 📱 Mobile Voice, 📹 720p Video Demo &amp; 📸 Photos • Gemini 3.5 Diarization
          </span>
        </div>

        <div className="project-meetings-top-actions">
          {/* Supervisor Scope Toggle */}
          <div className="supervisor-filter-pills" role="group" aria-label="Supervisor group scope">
            <button
              type="button"
              className={`sup-pill-btn ${supervisorFilter === 'mine' ? 'active' : ''}`}
              onClick={() => setSupervisorFilter('mine')}
              title="Show only Project Groups supervised by you"
            >
              👤 My Supervised Groups
            </button>
            <button
              type="button"
              className={`sup-pill-btn ${supervisorFilter === 'all' ? 'active' : ''}`}
              onClick={() => setSupervisorFilter('all')}
              title="Show all Project Groups across all supervisors in this class"
            >
              🌐 All Class Groups ({groups.length})
            </button>
          </div>

          {/* Sub-View Mode Switcher */}
          <div className="supervisor-filter-pills" role="group" aria-label="View mode">
            <button
              type="button"
              className={`sup-pill-btn ${subViewMode === 'studio' ? 'active' : ''}`}
              onClick={() => setSubViewMode('studio')}
            >
              🎙️ Meetings &amp; Recorder
            </button>
            <button
              type="button"
              className={`sup-pill-btn ${subViewMode === 'profiles' ? 'active' : ''}`}
              onClick={() => setSubViewMode('profiles')}
            >
              👤 Student Contribution Profiles ({studentContributionProfiles.length})
            </button>
            <button
              type="button"
              className={`sup-pill-btn ${subViewMode === 'matrix' ? 'active' : ''}`}
              onClick={() => setSubViewMode('matrix')}
            >
              📊 Weekly Matrix &amp; Export
            </button>
            <button
              type="button"
              className={`sup-pill-btn ${subViewMode === 'supervisors' ? 'active' : ''}`}
              onClick={() => setSubViewMode('supervisors')}
              title="Trace supervisor consultation duration, active speaking time, and group coverage across weeks"
            >
              👨‍🏫 Supervisor Performance ({supervisorPerformanceAnalytics.supervisors.length})
            </button>
          </div>

          <button
            type="button"
            className="btn-manage-groups-trigger"
            onClick={() => setShowGroupEditorModal(true)}
          >
            👥 Manage / Import Groups ({groups.length})
          </button>
        </div>
      </div>

      {/* Class-Scoped Public Weekly Log Google Sheet On-Demand Sync & Historical Log Ingestion Bar */}
      {subViewMode !== 'supervisors' && (
      <div className="weekly-log-sheet-sync-bar">
        <div className="log-sheet-url-group">
          <span className="log-sheet-badge">📗 Class Weekly Log Sheet (Form Responses 2):</span>
          <input
            type="url"
            aria-label="Public Weekly Log Google Sheet URL"
            className="log-sheet-url-input"
            value={logSheetUrl}
            onChange={(e) => setLogSheetUrl(e.target.value)}
            placeholder="Paste this class's Google Sheet URL (https://docs.google.com/spreadsheets/d/.../edit?gid=...)..."
          />
          <button
            type="button"
            className="btn-sync-log-sheet"
            onClick={() =>
              handleSyncWeeklyLogSheet(logSheetUrl, false, {
                saveToClass: true,
                ingestToFirestore: true,
                syncGroups: persistedProfiles.length === 0,
                forceFull: false,
              })
            }
            disabled={isSyncingLogSheet}
            title="On-Demand before class: 1st time backfills all historical logs (Week 1 -> Current); subsequent times incrementally ingests only newly submitted weekly logs & changed student profiles."
          >
            {isSyncingLogSheet
              ? '⏳ Syncing Logs...'
              : persistedProfiles.length === 0
              ? '💾 Save to Class & Backfill All Logs'
              : '⚡ Sync & Ingest New Logs (On-Demand)'}
          </button>
          {persistedProfiles.length > 0 && (
            <button
              type="button"
              className="btn-bootstrap-groups-sheet"
              onClick={() =>
                handleSyncWeeklyLogSheet(logSheetUrl, false, {
                  saveToClass: true,
                  ingestToFirestore: true,
                  syncGroups: true,
                  forceFull: true,
                })
              }
              disabled={isSyncingLogSheet}
              title="Force a full re-ingestion of all historical weekly logs across all students"
            >
              🔁 Full Re-Ingest All
            </button>
          )}
          {weeklyLogData.groupNames.length > 0 && (
            <button
              type="button"
              className="btn-bootstrap-groups-sheet"
              onClick={handleSyncGroupsFromLogSheet}
              title="Import or merge Project Groups and student rosters directly from the Weekly Log Sheet"
            >
              👥 Sync {weeklyLogData.groupNames.length} Groups from Sheet
            </button>
          )}
        </div>

        <div className="log-sheet-metrics-pills">
          {persistedProfiles.length > 0 && (
            <span
              className="log-metric-pill genuine"
              title="Student Contribution Profiles & historical logs are saved in this Class's Firestore collection; click Sync & Ingest New Logs on-demand before class to pull new rows."
            >
              📥 Saved in Class: <strong>{persistedProfiles.length}</strong> Profiles
            </span>
          )}
          <span className="log-metric-pill">
            📄 <strong>{weeklyLogData.summary.totalEntries}</strong> Logs (
            {weeklyLogData.weeks.length > 0
              ? `Weeks 1–${weeklyLogData.weeks[weeklyLogData.weeks.length - 1]}`
              : 'No weeks'}
            )
          </span>
          <span
            className="log-metric-pill genuine"
            onClick={() => {
              setProfileQualityFilter('genuine');
              setSubViewMode('profiles');
            }}
            style={{ cursor: 'pointer' }}
            title="Click to filter students with High-Quality Genuine Logs"
          >
            🟢 Genuine: <strong>{weeklyLogData.summary.genuineCount}</strong>
          </span>
          <span
            className="log-metric-pill vague"
            onClick={() => {
              setProfileQualityFilter('vague_useless');
              setSubViewMode('profiles');
            }}
            style={{ cursor: 'pointer' }}
            title="Click to inspect Vague / Useless logs (e.g. 'done', 'thinking')"
          >
            🔴 Vague/Useless: <strong>{weeklyLogData.summary.vagueCount}</strong>
          </span>
          <span
            className="log-metric-pill suspected-ai"
            onClick={() => {
              setProfileQualityFilter('suspected_ai_fake');
              setSubViewMode('profiles');
            }}
            style={{ cursor: 'pointer' }}
            title="Click to inspect Suspected AI / Fake logs & Challenge Questions"
          >
            🟠 Suspected AI/Fake: <strong>{weeklyLogData.summary.suspectedAiCount}</strong>
          </span>
          <span
            className="log-metric-pill inactive"
            onClick={() => {
              setProfileQualityFilter('inactive');
              setSubViewMode('profiles');
            }}
            style={{ cursor: 'pointer' }}
          >
            ⚪ Inactive (&quot;No&quot;): <strong>{weeklyLogData.summary.inactiveNoCount}</strong>
          </span>
          {(lastLogSyncAt || classInfo?.projectLogLastSyncedAt) && (
            <span style={{ fontSize: '0.73rem', color: '#64748b' }}>
              Synced{' '}
              {lastLogSyncAt ||
                new Date(classInfo.projectLogLastSyncedAt).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>
      )}

      {studioToast && <div className="project-meetings-toast">✅ {studioToast}</div>}
      {studioError && <div className="project-meetings-error-banner">⚠️ {studioError}</div>}
      {micSuspendedWarning && (
        <div className="project-meetings-mic-warning-banner">
          ⚠️ <strong>Microphone was paused by iOS / Device:</strong> Your screen was locked or another app was opened. Please keep your device unlocked and stay on this page to continue recording.
        </div>
      )}

      {/* Mobile-Responsive Dual-Device Recording Studio Card */}
      {subViewMode !== 'supervisors' && (
      <div className="project-meeting-recorder-studio">
        {/* High-Contrast Active Target Banner (Prominent on Mobile, prevents accidental recording to Group #1) */}
        <button
          type="button"
          className="mobile-active-group-banner"
          onClick={() => setShowGroupPickerModal(true)}
          disabled={recordingState !== 'idle'}
          title="Tap to switch Project Group using the quick grid picker"
        >
          <div className="mobile-active-group-info">
            <span className="mobile-active-group-eyebrow">🎯 TARGET GROUP (TAP TO SWITCH)</span>
            <strong className="mobile-active-group-name">
              📂 {activeStudioGroup?.name || 'Select Group'} — Week {studioWeekNumber}
            </strong>
            <span className="mobile-active-group-meta">
              {activeStudioGroup?.members?.length || 0} students
              {existingTargetMeeting
                ? ` • 🎙️ ${(existingTargetMeeting.audioClips || []).length} clip(s) recorded`
                : ' • 🟡 Not recorded yet'}
            </span>
          </div>
          <span className="mobile-active-group-switch-pill">🔄 Switch ({groups.length})</span>
        </button>

        <div className="studio-controls-row">
          <div className="studio-field">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="studio-group-select">📁 Project Group:</label>
              <button
                type="button"
                className="btn-open-group-picker-inline"
                onClick={() => setShowGroupPickerModal(true)}
                disabled={recordingState !== 'idle'}
                title="Open 4-column Quick Group Grid Picker"
              >
                ⊞ Quick Grid ({groups.length})
              </button>
            </div>
            <select
              id="studio-group-select"
              aria-label="📁 Project Group:"
              value={studioGroupId}
              onChange={(e) => handleSelectGroup(e.target.value)}
              disabled={recordingState !== 'idle'}
            >
              {visibleGroups.length === 0 ? (
                <option value="">-- No Groups Yet (Click Manage/Import Groups) --</option>
              ) : (
                visibleGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}: {g.projectTopic || 'Project'} ({g.members?.length || 0} students{g.supervisorName ? ` • 👨‍🏫 ${g.supervisorName}` : ''})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="studio-field studio-field-narrow">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label htmlFor="studio-week-select" title={`Week 1 Monday resolved from Class Schedule: ${semesterStartMonday}`}>
                📅 Week #:
              </label>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                {currentCalendarWeek && studioWeekNumber !== currentCalendarWeek && (
                  <button
                    type="button"
                    onClick={() => handleSelectWeek(currentCalendarWeek)}
                    title={`Jump to current calendar week (Week ${currentCalendarWeek})`}
                    style={{
                      background: '#eff6ff',
                      color: '#2563eb',
                      border: '1px solid #bfdbfe',
                      fontSize: '0.74rem',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    ⭐ Wk {currentCalendarWeek} (Now)
                  </button>
                )}
                <button
                  type="button"
                  className="btn-batch-ai-trigger"
                  onClick={() => setShowBatchAiModal(true)}
                  title={`Batch Analyze recordings in Week ${studioWeekNumber} with Gemini`}
                >
                  ⚡ Batch AI
                </button>
                <button
                  type="button"
                  className="btn-batch-email-trigger"
                  onClick={() => handleOpenWeekBatchEmailModal(studioWeekNumber)}
                  title={`Email Consultation Reports to All Groups in Week ${studioWeekNumber}`}
                  style={{
                    background: '#f0fdf4',
                    color: '#15803d',
                    border: '1px solid #86efac',
                    fontSize: '0.75rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '2px',
                  }}
                >
                  📧 Email Class
                </button>
              </div>
            </div>
            <select
              id="studio-week-select"
              aria-label="📅 Week #:"
              value={studioWeekNumber}
              onChange={(e) => handleSelectWeek(Number(e.target.value))}
              disabled={recordingState !== 'idle'}
            >
              {Array.from({ length: totalProjectWeeks }, (_, i) => i + 1).map((wk) => {
                const rangeLabel = formatWeekDateRange(wk, semesterStartMonday);
                const isCurrent = wk === currentCalendarWeek;
                return (
                  <option key={wk} value={wk}>
                    Week {wk}{rangeLabel ? ` (${rangeLabel})` : ''}{isCurrent ? ' ⭐ Current Week' : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="studio-field">
            <label htmlFor="studio-title-input">📝 Meeting Title / Agenda:</label>
            <input
              id="studio-title-input"
              type="text"
              value={studioTitle}
              onChange={(e) => setStudioTitle(e.target.value)}
              placeholder={`Week ${studioWeekNumber} Progress & Demo Review`}
              disabled={recordingState !== 'idle'}
            />
          </div>
        </div>

        {/* Recording Grouping Indicator + Live Student PC Screen Status + Action Buttons */}
        <div className="studio-action-strip">
          <div className="studio-grouping-badge-area">
            {existingTargetMeeting ? (
              <span className="grouping-active-pill" title="New clips recorded for this Group & Week are kept grouped inside the same meeting session">
                🔗 Grouping into <strong>{activeStudioGroup?.name} — Week {studioWeekNumber}</strong> (
                {(existingTargetMeeting.audioClips || []).length} clip(s) so far)
              </span>
            ) : (
              <span className="grouping-new-pill">
                🆕 Will create <strong>{activeStudioGroup?.name || 'Group'} — Week {studioWeekNumber}</strong> session group
              </span>
            )}
            <label style={{ fontSize: '0.78rem', color: '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={forceNewMeetingDoc}
                onChange={(e) => setForceNewMeetingDoc(e.target.checked)}
                disabled={recordingState !== 'idle'}
              />
              Separate meeting entry
            </label>
          </div>

          <div className="studio-record-buttons">
            {recordingState === 'idle' ? (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn-start-meeting-rec"
                  onClick={handleStartRecording}
                  disabled={!studioGroupId}
                >
                  🔴 {existingTargetMeeting
                    ? `Record Next Clip in Meeting — ${activeStudioGroup?.name || 'Group'} (Wk ${studioWeekNumber})`
                    : `Start Meeting Recording — ${activeStudioGroup?.name || 'Group'} (Wk ${studioWeekNumber})`}
                </button>
                <button
                  type="button"
                  className="btn-studio-snap-photo"
                  onClick={handleOpenPhotoModal}
                  disabled={!studioGroupId && !selectedMeeting}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: '#8b5cf6',
                    border: '1.5px solid #7c3aed',
                    color: '#ffffff',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: !studioGroupId && !selectedMeeting ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 4px rgba(139, 92, 246, 0.25)',
                  }}
                  title="Snap or upload whiteboard diagrams, circuit wiring, or laptop screen photos"
                >
                  📸 Snap Photo
                </button>
                <button
                  type="button"
                  className="btn-studio-rec-video"
                  onClick={handleOpenVideoRecorder}
                  disabled={!studioGroupId && !selectedMeeting}
                  style={{
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: '#0284c7',
                    border: '1.5px solid #0369a1',
                    color: '#ffffff',
                    fontSize: '0.88rem',
                    fontWeight: 700,
                    cursor: !studioGroupId && !selectedMeeting ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 4px rgba(2, 132, 199, 0.25)',
                  }}
                  title="Record a 1-3 minute mobile camera demo video in 720p HD"
                >
                  📹 Record Demo (720p)
                </button>
                {(existingTargetMeeting || selectedMeeting) && (
                  <button
                    type="button"
                    className="btn-studio-email-report"
                    onClick={() => handleOpenEmailModal(existingTargetMeeting || selectedMeeting)}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '8px',
                      background: '#2563eb',
                      border: '1.5px solid #1d4ed8',
                      color: '#ffffff',
                      fontSize: '0.88rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
                    }}
                    title="Email this meeting session's report, scores, and feedback to students"
                  >
                    📧 Email Meeting Report
                    {(existingTargetMeeting || selectedMeeting)?.emailDispatch?.sentAt && (
                      <span style={{ fontSize: '0.72rem', background: '#1e40af', color: '#ffffff', padding: '1px 6px', borderRadius: '4px' }}>
                        ✓ Sent
                      </span>
                    )}
                  </button>
                )}
              </div>
            ) : recordingState === 'uploading' ? (
              <div className="uploading-pill">
                ☁️ Saving Live Clip ({uploadProgress}%)...
              </div>
            ) : (
              <>
                <span className="live-rec-timer" title="Screen Wake Lock active — phone screen will stay awake during long meetings">
                  {recordingState === 'paused' ? '⏸️ PAUSED' : '🔴 REC'} {formatDuration(recordingSeconds)} 🔆
                </span>
                <button
                  type="button"
                  className="btn-pause-meeting-rec"
                  onClick={handlePauseResumeRecording}
                >
                  {recordingState === 'paused' ? '▶️ Resume' : '⏸️ Pause'}
                </button>
                <button
                  type="button"
                  className="btn-pause-meeting-rec"
                  onClick={() => handleStopAndSaveRecording(false)}
                  title="Save current voice & screen clip as a Part in this meeting so you can record the next student's turn separately"
                >
                  💾 Save Part
                </button>
                <button
                  type="button"
                  className="btn-studio-snap-photo-live"
                  onClick={handleOpenPhotoModal}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#8b5cf6',
                    border: '1px solid #7c3aed',
                    color: '#ffffff',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title="Snap a photo artifact right now without interrupting voice recording"
                >
                  📸 Snap Photo
                </button>
                <button
                  type="button"
                  className="btn-studio-rec-video-live"
                  onClick={handleOpenVideoRecorder}
                  style={{
                    padding: '8px 12px',
                    borderRadius: '8px',
                    background: '#0284c7',
                    border: '1px solid #0369a1',
                    color: '#ffffff',
                    fontSize: '0.84rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title="Film 720p demo video (auto-slices voice Part 1 -> Demo -> Part 2)"
                >
                  📹 Record Demo (720p)
                </button>
                <button
                  type="button"
                  className="btn-stop-meeting-rec"
                  onClick={() => handleStopAndSaveRecording(true)}
                >
                  ⏹️ Stop &amp; Analyze with Gemini
                </button>
              </>
            )}
          </div>

          {/* Artifacts Summary Pill Strip */}
          {(existingTargetMeeting || selectedMeeting) && (
            <div className="studio-artifacts-summary-strip" style={{ marginTop: '8px', display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '0.78rem', color: '#475569', fontWeight: 600 }}>Captured Artifacts:</span>
              <span style={{ fontSize: '0.76rem', background: '#f1f5f9', padding: '2px 8px', borderRadius: '12px', border: '1px solid #cbd5e1' }}>
                🎙️ {((existingTargetMeeting || selectedMeeting).audioClips || []).length || ((existingTargetMeeting || selectedMeeting).audioStoragePath ? 1 : 0)} Voice Part(s)
              </span>
              <span style={{ fontSize: '0.76rem', background: '#f0fdf4', padding: '2px 8px', borderRadius: '12px', border: '1px solid #bbf7d0', color: '#166534' }}>
                💻 {((existingTargetMeeting || selectedMeeting).screenClips || []).length} Demo/Screen Clip(s)
              </span>
              <span style={{ fontSize: '0.76rem', background: '#faf5ff', padding: '2px 8px', borderRadius: '12px', border: '1px solid #e9d5ff', color: '#6b21a8' }}>
                📸 {((existingTargetMeeting || selectedMeeting).photos || []).length} Photo(s)
              </span>
            </div>
          )}
        </div>

        {/* Hands-Free Attendance Self-Introduction Banner */}
        <div className="studio-intro-tip-banner" style={{ padding: '8px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '0.82rem', color: '#475569', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '1.05rem' }}>💡</span>
          <span>
            <strong>Hands-Free Attendance:</strong> Have each student introduce themselves briefly at the start of the meeting (e.g. &quot;Hi, I&apos;m Alex...&quot;) so Gemini automatically attributes their voice, attendance, and weekly work.
          </span>
        </div>

        <div className="ios-screen-lock-tip">
          📱 <strong>Mobile Tip:</strong> iOS Safari pauses microphone capture if your phone screen locks or you switch apps. Keep this page open and unlocked while recording.
        </div>

        {/* Pre-Meeting Weekly Log Review & AI Fake-Log Challenge Questions Briefing Panel */}
        {activeStudioGroup && studioGroupWeekLogCards.length > 0 && (
          <div className="studio-log-briefing-panel">
            <div className="studio-log-briefing-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-toggle-log-briefing"
                  onClick={() => setShowStudioLogBriefing((prev) => !prev)}
                >
                  {showStudioLogBriefing ? '🔽' : '▶️'} 📋 Pre-Meeting Log Audit &amp; Challenge Questions ({activeStudioGroup.name} — Week {studioWeekNumber})
                </button>
                {studioGroupAvailableWeeks.length > 0 && (
                  <div className="studio-log-week-chips">
                    <span style={{ fontSize: '0.74rem', color: '#475569' }}>Logged Weeks:</span>
                    {studioGroupAvailableWeeks.map((wk) => (
                      <button
                        key={wk}
                        type="button"
                        className={`log-week-chip ${Number(studioWeekNumber) === wk ? 'active' : ''}`}
                        onClick={() => handleSelectWeek(wk)}
                      >
                        Wk {wk}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-prepare-ai-questions"
                  onClick={handlePrepareAiLogChallengeQuestions}
                  disabled={isPreparingLogQuestions}
                  title="Use Gemini to audit this group's weekly logs and generate sharp technical questions to challenge suspected AI/fake or vague logs"
                >
                  {isPreparingLogQuestions
                    ? '⏳ Auditing Logs with Gemini...'
                    : '🎯 Generate AI Challenge Questions (Challenge Fake/Vague Logs)'}
                </button>
              </div>
            </div>

            {showStudioLogBriefing && (
              <div className="studio-log-cards-grid">
                {studioGroupWeekLogCards.map((card) => {
                  const statusClass =
                    card.qualityStatus === 'suspected_ai_fake' || card.qualityStatus === 'suspected_ai_unverified'
                      ? 'suspected-ai'
                      : card.qualityStatus === 'vague_useless'
                      ? 'vague'
                      : card.qualityStatus === 'genuine' || card.qualityStatus === 'genuine_verified'
                      ? 'genuine'
                      : 'inactive';
                  const statusBadgeText =
                    card.qualityStatus === 'suspected_ai_fake' || card.qualityStatus === 'suspected_ai_unverified'
                      ? `🟠 Suspected AI / Fake Log (${card.qualityScore}/10)`
                      : card.qualityStatus === 'vague_useless'
                      ? `🔴 Vague / Useless Log (${card.qualityScore}/10)`
                      : card.qualityStatus === 'genuine' || card.qualityStatus === 'genuine_verified'
                      ? `🟢 High-Quality Log (${card.qualityScore}/10)`
                      : card.submitted
                      ? `⚪ Inactive: "No" Work (${card.qualityScore}/10)`
                      : '⚠️ No Log Submitted';

                  const lastPrior =
                    card.priorHistory && card.priorHistory.length > 0
                      ? card.priorHistory[card.priorHistory.length - 1]
                      : null;

                  return (
                    <div key={card.email || card.studentId} className={`studio-log-member-card ${statusClass}`}>
                      <div className="studio-log-member-top">
                        <div>
                          <strong>👤 {formatStudentDisplayName(card.name, card.studentId || card.email)}</strong>
                        </div>
                        <span className={`log-quality-pill ${statusClass}`}>
                          {statusBadgeText}
                        </span>
                      </div>

                      {card.submitted && card.logEntry ? (
                        <div className="studio-log-body">
                          {card.logEntry.isDoingSomething ? (
                            <>
                              <div>
                                <strong>🛠️ Work Done &amp; Findings:</strong>{' '}
                                <span>{card.logEntry.workDone || '—'}</span>
                              </div>
                              {card.logEntry.unfinished && (
                                <div>
                                  <strong>⏳ Unfinished from Last Plan:</strong>{' '}
                                  <span>{card.logEntry.unfinished}</span>
                                </div>
                              )}
                              <div>
                                <strong>📅 Next Plan:</strong>{' '}
                                <span>{card.logEntry.nextPlan || '—'}</span>
                              </div>
                            </>
                          ) : (
                            <div>
                              <strong>⚪ Reported &quot;No&quot; Work This Week:</strong>{' '}
                              <span>{card.logEntry.inactiveReason || 'No reason given'}</span>
                            </div>
                          )}
                          {lastPrior && (
                            <div className="studio-log-prior-note">
                              ⏪ <strong>Prior Log (Wk {lastPrior.weekNumber}):</strong>{' '}
                              {lastPrior.isDoingSomething
                                ? `Done: "${lastPrior.workDone}" | Plan: "${lastPrior.nextPlan}"`
                                : `Inactive ("${lastPrior.inactiveReason || 'No'}")`}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="studio-log-body muted">
                          No weekly log entry found in Form Responses 2 for Week {studioWeekNumber}.
                        </div>
                      )}

                      <div className="studio-log-audit-reason">
                        🔍 <em>{card.qualityReason}</em>
                      </div>

                      <div className="studio-challenge-questions-box">
                        <strong>🎯 Challenge Questions to Ask in Meeting:</strong>
                        <ul>
                          {(card.challengeQuestions || []).map((q, qIdx) => (
                            <li key={qIdx}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* Live Batch Analysis Progress Banner (Persistent across Studio, Profiles & Matrix views) */}
      {batchAnalysisProgress && (
        <div className="batch-analysis-progress-banner" role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
            <span style={{ fontSize: '1.25rem' }}>⚡</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e3a8a', marginBottom: '4px' }}>
                Batch Analyzing Week {batchAnalysisProgress.weekNumber || studioWeekNumber} ({batchAnalysisProgress.mode === 'missing_only' ? 'Missing Only' : 'All Groups'}): [{batchAnalysisProgress.current} of {batchAnalysisProgress.total}] Group <strong>{batchAnalysisProgress.groupName}</strong>
              </div>
              <div style={{ width: '100%', height: '8px', background: '#bfdbfe', borderRadius: '4px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    background: '#2563eb',
                    transition: 'width 0.3s ease',
                    width: `${Math.round((batchAnalysisProgress.current / batchAnalysisProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn-cancel-batch-analysis"
              style={{ borderColor: '#93c5fd', color: '#1e40af', background: '#ffffff' }}
              onClick={() => setShowBatchAiModal(true)}
              title="Expand full Batch AI details modal"
            >
              🔍 Details
            </button>
            <button
              type="button"
              className="btn-cancel-batch-analysis"
              onClick={() => {
                cancelBatchAnalysisRef.current = true;
              }}
              title="Stop batch processing"
            >
              ⏹️ Stop Batch
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area: Student Contribution Profiles vs Cross-Week Matrix vs Studio Split View */}
      {subViewMode === 'profiles' ? (
        <div className="student-profiles-workspace">
          <div className="profiles-header-card">
            <div>
              <h3>👤 Individual Student Contribution &amp; Weekly Log Quality Profiles</h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Longitudinal tracking from <code>Form Responses 2</code> + recorded meetings: grades high-quality logs, flags vague (&quot;done&quot;) or suspected AI-generated logs, and prepares challenge questions &amp; weekly feedback.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-export-matrix-xlsx"
                onClick={() =>
                  exportStudentContributionProfilesExcel({
                    classId,
                    profiles: filteredStudentProfiles,
                    privacyMode: isPrivacyMode,
                  })
                }
                disabled={filteredStudentProfiles.length === 0}
              >
                📥 Export Student Profiles (.xlsx)
              </button>
            </div>
          </div>

          {/* Filter Strip for Student Profiles */}
          <div className="profiles-filter-bar">
            <select
              aria-label="Filter student profiles by group"
              value={profileGroupFilter}
              onChange={(e) => setProfileGroupFilter(e.target.value)}
            >
              <option value="all">📂 All Groups ({studentContributionProfiles.length} Students)</option>
              {weeklyLogData.groupNames.map((gCode) => (
                <option key={gCode} value={gCode}>
                  📁 Group {gCode}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter student profiles by log quality flag"
              value={profileQualityFilter}
              onChange={(e) => setProfileQualityFilter(e.target.value)}
            >
              <option value="all">🔍 All Log Quality States</option>
              <option value="suspected_ai_fake">🟠 Suspected AI / Fake Logs Only</option>
              <option value="vague_useless">🔴 Vague / Useless Logs (&quot;done&quot;, &quot;thinking&quot;)</option>
              <option value="inactive">⚪ High Inactive (&quot;No&quot;) / Missing Logs</option>
              <option value="genuine">🟢 High-Quality Authentic Logs (&ge;7/10)</option>
            </select>

            <input
              type="search"
              aria-label="Search student profile by name or student ID"
              placeholder="🔎 Search student name, group, or supervisor..."
              value={profileSearchQuery}
              onChange={(e) => setProfileSearchQuery(e.target.value)}
              style={{ flex: 1, minWidth: '220px' }}
            />
          </div>

          <div className="profiles-master-detail-grid">
            {/* Left Roster List of Student Profiles */}
            <div className="profiles-roster-list">
              {filteredStudentProfiles.length === 0 ? (
                <div className="empty-meetings-box">
                  No student profiles match the current filter.
                </div>
              ) : (
                filteredStudentProfiles.map((prof) => {
                  const isSelected = selectedStudentProfile?.key === prof.key;
                  return (
                    <div
                      key={prof.key}
                      className={`student-profile-list-card ${isSelected ? 'active' : ''}`}
                      onClick={() => setSelectedStudentProfileKey(prof.key)}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                        <div>
                          <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                            👤 {formatStudentDisplayName(prof.name, prof.email || prof.studentId)}
                          </strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            📁 Group <strong>{prof.groupCode}</strong>
                            {prof.supervisorName ? ` • 👨‍🏫 ${prof.supervisorName}` : ''}
                          </div>
                        </div>
                        <span
                          className={`log-score-badge ${
                            prof.avgLogQualityScore >= 7.5
                              ? 'good'
                              : prof.avgLogQualityScore >= 5
                              ? 'warn'
                              : 'low'
                          }`}
                        >
                          Log {prof.avgLogQualityScore}/10
                        </span>
                      </div>

                      <div className="profile-mini-metrics">
                        <span>📅 {prof.totalWeeksSubmitted} Wks Logged ({prof.activeYesWeeks} Yes / {prof.inactiveNoWeeks} No)</span>
                        <span>🟢 {prof.genuineLogsCount} Genuine</span>
                        {prof.vagueLogsCount > 0 && (
                          <span className="flag-text-red">🔴 {prof.vagueLogsCount} Vague</span>
                        )}
                        {prof.suspectedAiLogsCount > 0 && (
                          <span className="flag-text-orange">🟠 {prof.suspectedAiLogsCount} Suspected AI</span>
                        )}
                      </div>

                      {(prof.riskFlags || []).length > 0 && (
                        <div className="profile-risk-flags-row">
                          {prof.riskFlags.map((rf, i) => (
                            <span key={i} className="profile-risk-chip">
                              {rf}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Detail Dossier: Week 1 -> Week N Timeline, Log Quality Audit, Challenge Questions & Weekly Feedback */}
            <div className="profile-dossier-panel">
              {!selectedStudentProfile ? (
                <div className="empty-meetings-box">
                  Select a student on the left to inspect their longitudinal contribution &amp; weekly log audit dossier.
                </div>
              ) : (
                <>
                  <div className="dossier-header">
                    <div>
                      <h3 style={{ margin: 0 }}>
                        👤 {formatStudentDisplayName(selectedStudentProfile.name, selectedStudentProfile.email || selectedStudentProfile.studentId)}
                      </h3>
                      <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span>📁 Group: <strong>{selectedStudentProfile.groupName}</strong></span>
                        {selectedStudentProfile.supervisorName && (
                          <span>👨‍🏫 Supervisor: <strong>{selectedStudentProfile.supervisorName}</strong></span>
                        )}
                        <span>🏅 Log Quality Grade: <strong>{selectedStudentProfile.logQualityGrade}</strong></span>
                      </div>
                    </div>

                    <div className="dossier-kpi-boxes">
                      <div className="dossier-kpi-box">
                        <span className="kpi-num">{selectedStudentProfile.avgLogQualityScore}/10</span>
                        <span className="kpi-lbl">Avg Log Quality</span>
                      </div>
                      <div className="dossier-kpi-box">
                        <span className="kpi-num">
                          {selectedStudentProfile.activeYesWeeks}/{selectedStudentProfile.totalWeeksSubmitted}
                        </span>
                        <span className="kpi-lbl">Active (&quot;Yes&quot;) Logs</span>
                      </div>
                      <div className="dossier-kpi-box">
                        <span className="kpi-num">{selectedStudentProfile.vagueLogsCount}</span>
                        <span className="kpi-lbl">🔴 Vague Logs</span>
                      </div>
                      <div className="dossier-kpi-box">
                        <span className="kpi-num">{selectedStudentProfile.suspectedAiLogsCount}</span>
                        <span className="kpi-lbl">🟠 Suspected AI</span>
                      </div>
                    </div>
                  </div>

                  <div className="dossier-timeline-list">
                    {[...(selectedStudentProfile.weeklyTimeline || [])]
                      .reverse()
                      .map((wkItem) => {
                        const statusKey =
                          wkItem.logQualityStatus === 'suspected_ai_fake' ||
                          wkItem.logQualityStatus === 'suspected_ai_unverified'
                            ? 'suspected-ai'
                            : wkItem.logQualityStatus === 'vague_useless'
                            ? 'vague'
                            : wkItem.logQualityStatus === 'genuine' ||
                              wkItem.logQualityStatus === 'genuine_verified'
                            ? 'genuine'
                            : 'inactive';

                        return (
                          <div key={wkItem.weekNumber} className={`dossier-week-card ${statusKey}`}>
                            <div className="dossier-week-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                                <strong>
                                  📅 Week {wkItem.weekNumber}{' '}
                                  <span style={{ fontWeight: 400, fontSize: '0.76rem', color: '#64748b' }}>
                                    ({formatWeekDateRange(wkItem.weekNumber, semesterStartMonday)})
                                  </span>
                                </strong>
                                {wkItem.logEntry?.timestamp && (
                                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                                    Submitted: {wkItem.logEntry.timestamp}
                                  </span>
                                )}
                                {wkItem.attendanceStatus !== 'no_meeting' && (
                                  <span className={`att-cell-badge ${wkItem.attendanceStatus}`}>
                                    Meeting{wkItem.meetingsCount > 1 ? `s (${wkItem.meetingsCount})` : ''}:{' '}
                                    {wkItem.attendanceStatus.toUpperCase()}
                                    {wkItem.supervisorsLabel ? ` • ${wkItem.supervisorsLabel}` : ''}
                                  </span>
                                )}
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {wkItem.submitted ? (
                                  <span className={`log-quality-pill ${statusKey}`}>
                                    {statusKey === 'suspected-ai'
                                      ? `🟠 Suspected AI / Fake Log (${wkItem.logQualityScore ?? 4}/10)`
                                      : statusKey === 'vague'
                                      ? `🔴 Vague / Useless Log (${wkItem.logQualityScore ?? 2}/10)`
                                      : statusKey === 'genuine'
                                      ? `🟢 High-Quality Log (${wkItem.logQualityScore ?? 8}/10)`
                                      : `⚪ Inactive "No" (${wkItem.logQualityScore ?? 2}/10)`}
                                  </span>
                                ) : (
                                  <span className="log-quality-pill inactive">⚠️ No Log Submitted</span>
                                )}
                              </div>
                            </div>

                            {wkItem.submitted && wkItem.logEntry ? (
                              <div className="dossier-week-body">
                                {wkItem.logEntry.priorWeekPlan && (
                                  <div className="prior-plan-comparison">
                                    ⏪ <strong>Prior Week&apos;s Plan:</strong> &ldquo;{wkItem.logEntry.priorWeekPlan}&rdquo;
                                  </div>
                                )}
                                {wkItem.logEntry.isDoingSomething ? (
                                  <>
                                    <div>
                                      <strong>🛠️ Work Done &amp; Findings:</strong>{' '}
                                      {wkItem.logEntry.workDone || '—'}
                                    </div>
                                    {wkItem.logEntry.unfinished && (
                                      <div>
                                        <strong>⏳ Unfinished from Last Plan:</strong>{' '}
                                        {wkItem.logEntry.unfinished}
                                      </div>
                                    )}
                                    <div>
                                      <strong>📅 Next Plan:</strong>{' '}
                                      {wkItem.logEntry.nextPlan || '—'}
                                    </div>
                                  </>
                                ) : (
                                  <div>
                                    <strong>⚪ Marked &quot;No&quot; Work This Week:</strong>{' '}
                                    {wkItem.logEntry.inactiveReason || 'No description provided'}
                                  </div>
                                )}

                                <div className="studio-log-audit-reason" style={{ marginTop: '6px' }}>
                                  🔍 <strong>Log Quality Audit:</strong>{' '}
                                  {wkItem.aiContributionAssessment || wkItem.logEntry.qualityReason}
                                </div>

                                {(wkItem.challengeQuestions || []).length > 0 && (
                                  <div className="studio-challenge-questions-box" style={{ marginTop: '6px' }}>
                                    <strong>🎯 Challenge Questions (Verify Real Work vs. Fake/Vague Log):</strong>
                                    <ul>
                                      {wkItem.challengeQuestions.map((q, idx) => (
                                        <li key={idx}>{q}</li>
                                      ))}
                                    </ul>
                                  </div>
                                )}

                                {wkItem.weeklyFeedback && (
                                  <div className="weekly-feedback-banner" style={{ marginTop: '6px' }}>
                                    <strong>📝 Post-Meeting Weekly Feedback:</strong> {wkItem.weeklyFeedback}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                                Student did not submit a weekly log form for Week {wkItem.weekNumber}.
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : subViewMode === 'matrix' ? (
        <div className="project-meetings-matrix-card">
          <div className="matrix-header">
            <div>
              <h3>📊 Weekly Project Group Attendance &amp; Individual Contribution Matrix</h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Cross-week attendance rate, tasks completed, and next-week action items across all supervised groups.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-matrix-email-whole-class"
                onClick={() => handleOpenWeekBatchEmailModal(studioWeekNumber)}
                style={{
                  padding: '8px 14px',
                  borderRadius: '8px',
                  background: '#15803d',
                  color: '#ffffff',
                  border: '1.5px solid #166534',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 4px rgba(21, 128, 61, 0.2)',
                }}
                title={`Send supervision meeting reports to all project groups in Week ${studioWeekNumber}`}
              >
                📧 Email Whole Class Reports (Week {studioWeekNumber})
              </button>
              <button
                type="button"
                className="btn-export-matrix-xlsx"
                onClick={() => exportProjectMeetingsMatrixExcel({ classId, groups: visibleGroups, meetings, privacyMode: isPrivacyMode })}
                disabled={visibleGroups.length === 0}
              >
                📥 Export Full Matrix (.xlsx)
              </button>
            </div>
          </div>

          {visibleGroups.length === 0 ? (
            <div className="empty-meetings-box">No project groups configured yet.</div>
          ) : (
            visibleGroups.map((grp) => {
              const grpMeetings = meetings
                .filter((m) => m.groupId === grp.id)
                .sort((a, b) => (Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0));
              const weeks = [...new Set(grpMeetings.map((m) => Number(m.weekNumber) || 1))];

              return (
                <div key={grp.id} className="matrix-group-section">
                  <div className="matrix-group-title">
                    <strong>📁 {grp.name}</strong>
                    {grp.projectTopic && <span>• 📌 {grp.projectTopic}</span>}
                    {grp.supervisorEmail && <span>• 👨‍🏫 {grp.supervisorEmail}</span>}
                  </div>
                  <div className="matrix-table-wrapper">
                    <table className="project-meetings-matrix-table">
                      <thead>
                        <tr>
                          <th>Student</th>
                          <th>Role</th>
                          <th>Attendance Rate</th>
                          <th>Tasks Done</th>
                          {weeks.map((wk) => {
                            const wkMeeting = grpMeetings.find((m) => Number(m.weekNumber) === wk);
                            return (
                              <th key={wk}>
                                <div>Week {wk}</div>
                                {wkMeeting && (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEmailModal(wkMeeting)}
                                    title={`Email Week ${wk} report for ${grp.name}`}
                                    style={{
                                      marginTop: '4px',
                                      padding: '2px 8px',
                                      fontSize: '0.7rem',
                                      background: wkMeeting.emailDispatch?.sentAt ? '#dcfce7' : '#eff6ff',
                                      color: wkMeeting.emailDispatch?.sentAt ? '#15803d' : '#1d4ed8',
                                      border: '1px solid #bfdbfe',
                                      borderRadius: '4px',
                                      cursor: 'pointer',
                                      fontWeight: 600,
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '3px',
                                    }}
                                  >
                                    📧 {wkMeeting.emailDispatch?.sentAt ? 'Sent ✓' : 'Email'}
                                  </button>
                                )}
                              </th>
                            );
                          })}
                          <th>Latest Next-Week Action Items</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(grp.members || []).map((member) => {
                          const email = normalizeStudentEmail(member.email);
                          let attended = 0;
                          let totalTasks = 0;
                          let latestActions = [];

                          const weekCells = weeks.map((wk) => {
                            const weekMeetings = grpMeetings.filter((gm) => Number(gm.weekNumber) === wk);
                            let status = 'absent';
                            let doneCount = 0;
                            weekMeetings.forEach((m) => {
                              const att = (m?.attendanceRecord || []).find(
                                (a) => normalizeStudentEmail(a.email) === email || a.uid === member.uid
                              );
                              const contrib = (m?.studentContributions || []).find(
                                (c) => normalizeStudentEmail(c.email) === email || c.uid === member.uid
                              );
                              const s = att?.status || 'absent';
                              if (s === 'present') status = 'present';
                              else if (s === 'late' && status !== 'present') status = 'late';
                              doneCount += (contrib?.workCompleted || []).length;
                              if ((contrib?.actionItemsNextWeek || []).length > 0) {
                                latestActions = contrib.actionItemsNextWeek;
                              }
                            });
                            if (status === 'present' || status === 'late') attended++;
                            totalTasks += doneCount;
                            return {
                              wk,
                              status,
                              doneCount,
                              meetingsCount: weekMeetings.length,
                              meetingId: weekMeetings[0]?.id,
                            };
                          });

                          const rate = weeks.length > 0 ? Math.round((attended / weeks.length) * 100) : 0;

                          return (
                            <tr key={email}>
                              <td>
                                <strong title={formatStudentDisplayEmail(email)}>{formatStudentDisplayName(member.name, email)}</strong>
                              </td>
                              <td>{member.role || 'Member'}</td>
                              <td>
                                <span
                                  className={`rate-pill ${rate >= 80 ? 'good' : rate >= 50 ? 'warn' : 'low'}`}
                                >
                                  {rate}% ({attended}/{weeks.length})
                                </span>
                              </td>
                              <td>
                                <strong>{totalTasks}</strong> tasks
                              </td>
                              {weekCells.map((cell) => (
                                <td
                                  key={cell.wk}
                                  onClick={() => {
                                    if (cell.meetingId) {
                                      setSelectedMeetingId(cell.meetingId);
                                      setSubViewMode('studio');
                                    }
                                  }}
                                  style={{ cursor: cell.meetingId ? 'pointer' : 'default' }}
                                >
                                  <span className={`att-cell-badge ${cell.status}`}>
                                    {cell.status === 'present' ? '✅' : cell.status === 'late' ? '🕒' : '❌'}{' '}
                                    {cell.doneCount > 0 ? `${cell.doneCount} done` : cell.status}
                                  </span>
                                </td>
                              ))}
                              <td style={{ fontSize: '0.8rem', color: '#334155' }}>
                                {latestActions.length > 0 ? latestActions.join('; ') : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      ) : subViewMode === 'supervisors' ? (
        <div className="supervisor-performance-workspace" data-testid="supervisor-performance-view">
          <div className="supervisor-perf-header-card">
            <div>
              <h3>👨‍🏫 Supervisor Performance, Useful Instruction &amp; Group Management Analytics</h3>
              <p style={{ margin: '2px 0 0', fontSize: '0.84rem', color: '#64748b' }}>
                Tracks how long each supervisor consults with their assigned project groups and uses <strong>Gemini</strong> to evaluate whether each teacher provides concrete technical instruction/advice and actively manages student deliverables &amp; risks.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn-eval-all-supervisors-gemini"
                onClick={handleEvaluateAllSupervisorsWithGemini}
                disabled={
                  isEvaluatingAllSupervisors ||
                  Boolean(evaluatingSupervisorKey) ||
                  supervisorPerformanceAnalytics.supervisors.length === 0
                }
              >
                {isEvaluatingAllSupervisors
                  ? '⏳ Gemini Evaluating All Teachers...'
                  : '🤖 Evaluate All Teachers with Gemini'}
              </button>
              <button
                type="button"
                className="btn-export-matrix-xlsx"
                onClick={() =>
                  exportSupervisorPerformanceExcel({
                    classId,
                    analytics: supervisorPerformanceAnalytics,
                  })
                }
                disabled={supervisorPerformanceAnalytics.groupRows.length === 0}
              >
                📥 Export Supervisor Performance (.xlsx)
              </button>
            </div>
          </div>

          {/* Controls & Filter Strip */}
          <div className="supervisor-perf-filter-bar">
            <div className="sup-perf-filter-group">
              <label htmlFor="sup-perf-week-filter">📅 Week Scope:</label>
              <select
                id="sup-perf-week-filter"
                aria-label="Filter supervisor performance by week"
                value={supervisorPerfWeekFilter}
                onChange={(e) => setSupervisorPerfWeekFilter(e.target.value)}
              >
                <option value="all">
                  🌐 All Recorded Weeks (
                  {supervisorPerformanceAnalytics.allWeeks.length > 0
                    ? `Weeks ${supervisorPerformanceAnalytics.allWeeks[0]}–${supervisorPerformanceAnalytics.allWeeks[supervisorPerformanceAnalytics.allWeeks.length - 1]}`
                    : 'No weeks'}
                  )
                </option>
                {supervisorPerformanceAnalytics.allWeeks.map((wk) => (
                  <option key={wk} value={String(wk)}>
                    📅 Week {wk} Only
                  </option>
                ))}
              </select>
            </div>

            <div className="sup-perf-filter-group">
              <label htmlFor="sup-perf-attribution-mode">🎯 Time Attribution:</label>
              <select
                id="sup-perf-attribution-mode"
                aria-label="Supervisor time attribution mode"
                value={supervisorPerfAttributionMode}
                onChange={(e) => setSupervisorPerfAttributionMode(e.target.value)}
              >
                <option value="recording_supervisor">
                  🎙️ Actual Recording Supervisor (By Audio Clip Recorder)
                </option>
                <option value="assigned_supervisor">
                  📁 Assigned Primary Group Supervisor
                </option>
              </select>
            </div>

            <div className="sup-perf-filter-group">
              <label htmlFor="sup-perf-supervisor-select">👨‍🏫 Filter Matrix by Supervisor:</label>
              <select
                id="sup-perf-supervisor-select"
                aria-label="Filter group matrix by supervisor"
                value={supervisorPerfSelectedEmail}
                onChange={(e) => setSupervisorPerfSelectedEmail(e.target.value)}
              >
                <option value="all">
                  👥 All Supervisors ({supervisorPerformanceAnalytics.supervisors.length})
                </option>
                {supervisorPerformanceAnalytics.supervisors.map((s) => (
                  <option key={s.key} value={s.email || s.key}>
                    👨‍🏫 {s.name} ({formatConsultationDuration(s.totalConsultationSeconds, true)})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Top KPI Summary Cards */}
          <div className="supervisor-perf-kpi-grid">
            <div className="sup-perf-kpi-card">
              <span className="sup-kpi-eyebrow">👨‍🏫 Active Supervisors</span>
              <strong className="sup-kpi-value">
                {supervisorPerformanceAnalytics.summary.totalSupervisors}
              </strong>
              <span className="sup-kpi-sub">
                Across {supervisorPerformanceAnalytics.summary.totalGroups} project groups
              </span>
            </div>

            <div className="sup-perf-kpi-card">
              <span className="sup-kpi-eyebrow">⏱️ Total Consultation Time</span>
              <strong className="sup-kpi-value" style={{ color: '#1d4ed8' }}>
                {formatConsultationDuration(
                  supervisorPerformanceAnalytics.summary.totalConsultationSeconds,
                  true
                )}
              </strong>
              <span className="sup-kpi-sub">
                {Math.round(supervisorPerformanceAnalytics.summary.totalConsultationSeconds / 60)} total recorded minutes
              </span>
            </div>

            <div className="sup-perf-kpi-card">
              <span className="sup-kpi-eyebrow">📊 Avg Time / Group Meeting</span>
              <strong
                className="sup-kpi-value"
                style={{
                  color:
                    supervisorPerformanceAnalytics.summary.avgConsultationSecondsPerGroupWeek >= 900
                      ? '#15803d'
                      : supervisorPerformanceAnalytics.summary.avgConsultationSecondsPerGroupWeek >= 300
                      ? '#d97706'
                      : '#dc2626',
                }}
              >
                {formatConsultationDuration(
                  supervisorPerformanceAnalytics.summary.avgConsultationSecondsPerGroupWeek,
                  false
                )}
              </strong>
              <span className="sup-kpi-sub">
                Target: &ge;15m thorough (&lt;5m flagged short)
              </span>
            </div>

            <div className="sup-perf-kpi-card">
              <span className="sup-kpi-eyebrow">🗣️ Supervisor Speaking Time</span>
              <strong className="sup-kpi-value" style={{ color: '#7c3aed' }}>
                {formatConsultationDuration(
                  supervisorPerformanceAnalytics.summary.totalSupervisorSpeakingSeconds,
                  true
                )}
                {supervisorPerformanceAnalytics.summary.overallSupervisorTalkSharePct !== null && (
                  <span style={{ fontSize: '0.9rem', fontWeight: 700, marginLeft: '6px' }}>
                    ({supervisorPerformanceAnalytics.summary.overallSupervisorTalkSharePct}%)
                  </span>
                )}
              </strong>
              <span className="sup-kpi-sub">
                Students spoke:{' '}
                {formatConsultationDuration(
                  supervisorPerformanceAnalytics.summary.totalStudentSpeakingSeconds,
                  true
                )}
              </span>
            </div>

            <div className="sup-perf-kpi-card">
              <span className="sup-kpi-eyebrow">✅ Weekly Group Coverage</span>
              <strong
                className="sup-kpi-value"
                style={{
                  color:
                    supervisorPerformanceAnalytics.summary.overallGroupCoveragePct >= 85
                      ? '#15803d'
                      : supervisorPerformanceAnalytics.summary.overallGroupCoveragePct >= 60
                      ? '#d97706'
                      : '#dc2626',
                }}
              >
                {supervisorPerformanceAnalytics.summary.overallGroupCoveragePct}%
              </strong>
              <span className="sup-kpi-sub">
                {supervisorPerformanceAnalytics.summary.metGroupWeekSlots}/
                {supervisorPerformanceAnalytics.summary.totalGroupWeekSlots} group-weeks met
                {supervisorPerformanceAnalytics.summary.shortGroupWeekSlots > 0
                  ? ` • ⚠️ ${supervisorPerformanceAnalytics.summary.shortGroupWeekSlots} <5m`
                  : ''}
              </span>
            </div>
          </div>

          {/* Section 1: Supervisor Comparison Leaderboard Table & Talk-Share Bars */}
          <div className="supervisor-leaderboard-card">
            <div className="supervisor-section-header">
              <h4>1. 🏆 Supervisor Consultation Duration &amp; Speaking Time Comparison</h4>
              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                Click any supervisor row to filter the Group &times; Week matrix below
              </span>
            </div>

            {supervisorPerformanceAnalytics.supervisors.length === 0 ? (
              <div className="empty-meetings-box">
                No supervisor records or recorded meetings found yet.
              </div>
            ) : (
              <div className="matrix-table-wrapper">
                <table className="project-meetings-matrix-table supervisor-leaderboard-table">
                  <thead>
                    <tr>
                      <th>Supervisor</th>
                      <th>Groups (Met / Assigned)</th>
                      <th>Sessions &amp; Clips</th>
                      <th>Total Consultation Time</th>
                      <th>Avg / Group Session</th>
                      <th>Diarized Speaking Breakdown (👨‍🏫 Supervisor vs. 🧑‍🎓 Students)</th>
                      <th>🎓 Gemini Teacher Evaluation &amp; Advice Quality</th>
                      {supervisorPerformanceAnalytics.allWeeks.map((wk) => (
                        <th key={wk}>Week {wk}</th>
                      ))}
                      <th>AI &amp; Email Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {supervisorPerformanceAnalytics.supervisors.map((sup) => {
                      const isSelectedSup =
                        supervisorPerfSelectedEmail !== 'all' &&
                        normalizeStudentEmail(supervisorPerfSelectedEmail) ===
                          normalizeStudentEmail(sup.email || sup.key);
                      const avgMin = sup.avgConsultationSecondsPerSession / 60;
                      const avgBadgeClass =
                        avgMin >= 15 ? 'good' : avgMin >= 5 ? 'warn' : 'low';
                      const supShare = sup.supervisorTalkSharePct ?? 0;
                      const stuShare = sup.supervisorTalkSharePct !== null ? 100 - supShare : 0;
                      const gem = sup.geminiEvaluation || null;
                      const isEvaluatingThisSup =
                        evaluatingSupervisorKey === (sup.key || sup.email || sup.name);
                      const isInspectedSup =
                        inspectedSupervisorKey === (sup.key || sup.email || sup.name);

                      const styleBadge =
                        gem?.coachingStyle === 'active_technical_mentor'
                          ? { label: '🌟 Active Technical Mentor', cls: 'good' }
                          : gem?.coachingStyle === 'structured_project_manager'
                          ? { label: '✅ Structured Manager', cls: 'good' }
                          : gem?.coachingStyle === 'brief_check_in'
                          ? { label: '🟡 Brief Check-In', cls: 'warn' }
                          : gem?.coachingStyle === 'passive_or_roll_call_only'
                          ? { label: '🔴 Passive / Roll-Call Only', cls: 'low' }
                          : null;

                      return (
                        <tr
                          key={sup.key}
                          className={`supervisor-perf-row ${isSelectedSup ? 'active-row' : ''}`}
                          onClick={() =>
                            setSupervisorPerfSelectedEmail((prev) =>
                              normalizeStudentEmail(prev) ===
                              normalizeStudentEmail(sup.email || sup.key)
                                ? 'all'
                                : sup.email || sup.key
                            )
                          }
                          style={{ cursor: 'pointer' }}
                        >
                          <td>
                            <div style={{ fontWeight: 700, color: '#0f172a', fontSize: '0.9rem' }}>
                              👨‍🏫 {sup.name}
                            </div>
                          </td>

                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span
                                className={`rate-pill ${
                                  sup.coveragePct >= 85
                                    ? 'good'
                                    : sup.coveragePct >= 50
                                    ? 'warn'
                                    : 'low'
                                }`}
                              >
                                {sup.groupsMetCount} group{sup.groupsMetCount === 1 ? '' : 's'} ({sup.coveragePct}%)
                              </span>
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#475569', marginTop: '4px' }}>
                              <strong>Groups:</strong>{' '}
                              {sup.touchedGroupNames.length > 0
                                ? sup.touchedGroupNames.join(', ')
                                : sup.assignedGroupNames.join(', ') || '—'}
                            </div>
                            {sup.unmetAssignedGroupNames.length > 0 && (
                              <div style={{ fontSize: '0.71rem', color: '#dc2626', fontWeight: 600, marginTop: '2px' }}>
                                ⚠️ Unmet: {sup.unmetAssignedGroupNames.join(', ')}
                              </div>
                            )}
                          </td>

                          <td>
                            <strong>{sup.sessionsCount}</strong> sessions
                            <div style={{ fontSize: '0.73rem', color: '#64748b' }}>
                              🎙️ {sup.clipsCount} clip{sup.clipsCount === 1 ? '' : 's'}
                              {sup.shortSessionsCount > 0 && (
                                <span style={{ color: '#d97706', fontWeight: 600, marginLeft: '4px' }}>
                                  • ⚠️ {sup.shortSessionsCount} &lt;5m
                                </span>
                              )}
                            </div>
                          </td>

                          <td>
                            <strong style={{ fontSize: '0.96rem', color: '#1e3a8a' }}>
                              {formatConsultationDuration(sup.totalConsultationSeconds, false)}
                            </strong>
                            <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                              ({(sup.totalConsultationSeconds / 60).toFixed(1)} min total)
                            </div>
                          </td>

                          <td>
                            <span className={`rate-pill ${avgBadgeClass}`}>
                              {formatConsultationDuration(sup.avgConsultationSecondsPerSession, false)} / session
                            </span>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: '3px' }}>
                              {formatConsultationDuration(sup.avgConsultationSecondsPerGroup, true)} / group
                            </div>
                          </td>

                          <td style={{ minWidth: '230px' }}>
                            {sup.supervisorTalkSharePct !== null ? (
                              <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', marginBottom: '4px' }}>
                                  <span style={{ color: '#6d28d9', fontWeight: 700 }}>
                                    👨‍🏫 Sup: {formatConsultationDuration(sup.totalSupervisorSpeakingSeconds, false)} ({supShare}%)
                                  </span>
                                  <span style={{ color: '#0369a1', fontWeight: 600 }}>
                                    🧑‍🎓 Stu: {formatConsultationDuration(sup.totalStudentSpeakingSeconds, false)} ({stuShare}%)
                                  </span>
                                </div>
                                <div className="sup-talk-share-bar">
                                  <div
                                    className="sup-talk-share-fill-sup"
                                    style={{ width: `${supShare}%` }}
                                    title={`Supervisor spoke ${formatConsultationDuration(sup.totalSupervisorSpeakingSeconds, false)} (${supShare}%, ${sup.supervisorTurnsCount} turns)`}
                                  />
                                  <div
                                    className="sup-talk-share-fill-stu"
                                    style={{ width: `${stuShare}%` }}
                                    title={`Students spoke ${formatConsultationDuration(sup.totalStudentSpeakingSeconds, false)} (${stuShare}%, ${sup.studentTurnsCount} turns)`}
                                  />
                                </div>
                                <div style={{ fontSize: '0.69rem', color: '#64748b', marginTop: '3px' }}>
                                  {sup.supervisorTurnsCount} supervisor turns ({sup.substantiveSupervisorTurnsCount || 0} substantive) • {sup.studentTurnsCount} student turns
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                Pending AI diarization
                              </span>
                            )}
                          </td>

                          <td
                            style={{ minWidth: '280px' }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {gem ? (
                              <div className="sup-gemini-eval-cell">
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                  <span
                                    className={`rate-pill ${
                                      gem.overallScore >= 7.5
                                        ? 'good'
                                        : gem.overallScore >= 5.5
                                        ? 'warn'
                                        : 'low'
                                    }`}
                                  >
                                    ⭐ {gem.overallScore}/10
                                  </span>
                                  {styleBadge && (
                                    <span className={`rate-pill ${styleBadge.cls}`}>
                                      {styleBadge.label}
                                    </span>
                                  )}
                                </div>
                                <div style={{ fontSize: '0.73rem', color: '#1e293b', marginTop: '4px', fontWeight: 600 }}>
                                  💡 Instruction: <strong>{gem.instructionAndAdviceScore}/10</strong> • 📋 Management: <strong>{gem.groupManagementScore}/10</strong>
                                </div>
                                {gem.executiveVerdict && (
                                  <div
                                    style={{
                                      fontSize: '0.72rem',
                                      color: '#475569',
                                      marginTop: '3px',
                                      display: '-webkit-box',
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: 'vertical',
                                      overflow: 'hidden',
                                    }}
                                    title={gem.executiveVerdict}
                                  >
                                    {gem.executiveVerdict}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                                Not evaluated by Gemini yet
                              </div>
                            )}

                            <div style={{ fontSize: '0.71rem', color: '#475569', marginTop: '4px' }}>
                              💡 <strong>{sup.adviceItemsCount || 0}</strong> advice • 🎯 <strong>{sup.decisionsCount || 0}</strong> decisions • 📋 <strong>{sup.actionItemsAssignedCount || 0}</strong> tasks
                            </div>

                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                              <button
                                type="button"
                                className="btn-sup-eval-gemini"
                                onClick={() => handleEvaluateSupervisorWithGemini(sup)}
                                disabled={isEvaluatingThisSup || isEvaluatingAllSupervisors || sup.sessionsCount === 0}
                              >
                                {isEvaluatingThisSup
                                  ? '⏳ Evaluating...'
                                  : gem
                                  ? '🔄 Re-Evaluate'
                                  : '🤖 Evaluate with Gemini'}
                              </button>
                              <button
                                type="button"
                                className="btn-sup-view-dossier"
                                onClick={() =>
                                  setInspectedSupervisorKey((prev) =>
                                    prev === (sup.key || sup.email || sup.name)
                                      ? ''
                                      : sup.key || sup.email || sup.name
                                  )
                                }
                              >
                                {isInspectedSup ? '🔼 Hide Dossier' : '🔍 View Advice & Dossier'}
                              </button>
                            </div>
                          </td>

                          {supervisorPerformanceAnalytics.allWeeks.map((wk) => {
                            const b = (sup.weeklyBreakdown || []).find((x) => x.weekNumber === wk);
                            const sec = b?.consultationSeconds || 0;
                            return (
                              <td key={wk}>
                                {sec > 0 ? (
                                  <div>
                                    <strong style={{ color: sec >= 900 ? '#15803d' : sec >= 300 ? '#1e40af' : '#b45309' }}>
                                      {formatConsultationDuration(sec, true)}
                                    </strong>
                                    <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                      {b.groupsMetCount} grp ({b.groupsMetNames.join(', ')})
                                    </div>
                                    {b.supervisorSpeakingSeconds > 0 && (
                                      <div style={{ fontSize: '0.68rem', color: '#6d28d9', fontWeight: 600 }}>
                                        🗣️ Sup: {formatConsultationDuration(b.supervisorSpeakingSeconds, true)}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>— (0m)</span>
                                )}
                              </td>
                            );
                          })}

                          <td>
                            <div style={{ fontSize: '0.75rem', color: '#15803d', fontWeight: 600 }}>
                              ✨ {sup.analyzedSessionsCount}/{sup.sessionsCount} Analyzed
                            </div>
                            <div style={{ fontSize: '0.73rem', color: '#1d4ed8', marginTop: '2px' }}>
                              📧 {sup.emailedSessionsCount}/{sup.sessionsCount} Emailed
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Expandable Gemini Teacher Instruction, Advice & Group Management Dossier */}
            {(() => {
              const inspectedSup = (supervisorPerformanceAnalytics.supervisors || []).find(
                (s) => (s.key || s.email || s.name) === inspectedSupervisorKey
              );
              if (!inspectedSup) return null;
              const gem = inspectedSup.geminiEvaluation || null;
              const evidenceList = inspectedSup.meetingCoachingEvidence || [];

              return (
                <div
                  className="supervisor-gemini-dossier-panel"
                  data-testid="supervisor-gemini-dossier"
                >
                  <div className="sup-dossier-header">
                    <div>
                      <h5 style={{ margin: 0, fontSize: '0.96rem', color: '#0f172a' }}>
                        🎓 Teacher Instruction, Advice &amp; Group Management Dossier —{' '}
                        <span style={{ color: '#4338ca' }}>{inspectedSup.name}</span>
                      </h5>
                      <span style={{ fontSize: '0.77rem', color: '#64748b' }}>
                        {inspectedSup.sessionsCount} recorded sessions •{' '}
                        {formatConsultationDuration(inspectedSup.totalConsultationSeconds, false)}{' '}
                        consultation • 💡 {inspectedSup.adviceItemsCount || 0} extracted advice items •{' '}
                        🎯 {inspectedSup.decisionsCount || 0} decisions • 📋{' '}
                        {inspectedSup.actionItemsAssignedCount || 0} student tasks assigned
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-sup-eval-gemini"
                        onClick={() => handleEvaluateSupervisorWithGemini(inspectedSup)}
                        disabled={
                          Boolean(evaluatingSupervisorKey) ||
                          isEvaluatingAllSupervisors ||
                          inspectedSup.sessionsCount === 0
                        }
                      >
                        {evaluatingSupervisorKey ===
                        (inspectedSup.key || inspectedSup.email || inspectedSup.name)
                          ? '⏳ Gemini Evaluating...'
                          : gem
                          ? '🔄 Re-Run Gemini Evaluation'
                          : '🤖 Evaluate Teacher with Gemini'}
                      </button>
                      <button
                        type="button"
                        className="btn-edit-student-work"
                        onClick={() => setInspectedSupervisorKey('')}
                      >
                        ✕ Close Dossier
                      </button>
                    </div>
                  </div>

                  {gem ? (
                    <div className="sup-dossier-gemini-grid">
                      <div className="sup-dossier-score-strip">
                        <div className="sup-dossier-score-box">
                          <span className="sup-kpi-eyebrow">⭐ Overall Teacher Score</span>
                          <strong style={{ fontSize: '1.35rem', color: '#4338ca' }}>
                            {gem.overallScore}/10
                          </strong>
                        </div>
                        <div className="sup-dossier-score-box">
                          <span className="sup-kpi-eyebrow">💡 Useful Instruction &amp; Advice</span>
                          <strong style={{ fontSize: '1.35rem', color: '#0f766e' }}>
                            {gem.instructionAndAdviceScore}/10
                          </strong>
                        </div>
                        <div className="sup-dossier-score-box">
                          <span className="sup-kpi-eyebrow">📋 Project Group Management</span>
                          <strong style={{ fontSize: '1.35rem', color: '#1d4ed8' }}>
                            {gem.groupManagementScore}/10
                          </strong>
                        </div>
                        <div className="sup-dossier-verdict-box">
                          <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#334155', marginBottom: '4px' }}>
                            🤖 Gemini Executive Verdict ({gem.aiModelUsed || 'gemini-3.8-flash'})
                          </div>
                          <div style={{ fontSize: '0.83rem', color: '#0f172a', lineHeight: 1.45 }}>
                            {gem.executiveVerdict}
                          </div>
                        </div>
                      </div>

                      <div className="sup-dossier-columns">
                        <div className="sup-dossier-card">
                          <h6>✅ Key Coaching Strengths</h6>
                          {(gem.strengths || []).length > 0 ? (
                            <ul>
                              {gem.strengths.map((st, idx) => (
                                <li key={idx}>{st}</li>
                              ))}
                            </ul>
                          ) : (
                            <p style={{ fontSize: '0.78rem', color: '#64748b' }}>No specific strengths listed.</p>
                          )}
                        </div>

                        <div className="sup-dossier-card">
                          <h6>⚠️ Group Management Gaps &amp; Follow-Up Needed</h6>
                          {(gem.managementGaps || []).length > 0 ? (
                            <ul>
                              {gem.managementGaps.map((gap, idx) => (
                                <li key={idx}>{gap}</li>
                              ))}
                            </ul>
                          ) : (
                            <p style={{ fontSize: '0.78rem', color: '#15803d' }}>
                              No major management gaps identified.
                            </p>
                          )}
                        </div>
                      </div>

                      {(gem.usefulInstructionsEvidence || []).length > 0 && (
                        <div className="sup-dossier-card">
                          <h6>🎙️ Verified Useful Instructions &amp; Technical Advice (With Timestamps)</h6>
                          <div className="sup-evidence-pills-list">
                            {gem.usefulInstructionsEvidence.map((ev, idx) => (
                              <div key={idx} className="sup-evidence-quote-item">
                                <span className="rate-pill good" style={{ flexShrink: 0 }}>
                                  📁 Group {ev.groupName} • Wk {ev.weekNumber} [{ev.timestamp || '00:00'}]
                                </span>
                                <span style={{ fontSize: '0.8rem', color: '#1e293b' }}>
                                  {ev.quoteOrSummary}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {(gem.groupEvaluations || []).length > 0 && (
                        <div className="sup-dossier-card">
                          <h6>📁 Per-Group Instruction &amp; Management Assessment</h6>
                          <div className="sup-group-eval-grid">
                            {gem.groupEvaluations.map((ge, idx) => (
                              <div key={idx} className="sup-group-eval-item">
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                  <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                                    📁 Group {ge.groupName}
                                  </strong>
                                  <div style={{ display: 'flex', gap: '4px' }}>
                                    <span
                                      className={`rate-pill ${
                                        ge.instructionQuality === 'high'
                                          ? 'good'
                                          : ge.instructionQuality === 'moderate'
                                          ? 'warn'
                                          : 'low'
                                      }`}
                                    >
                                      Advice: {ge.instructionQuality}
                                    </span>
                                    <span
                                      className={`rate-pill ${
                                        ge.managementQuality === 'high'
                                          ? 'good'
                                          : ge.managementQuality === 'moderate'
                                          ? 'warn'
                                          : 'low'
                                      }`}
                                    >
                                      Mgmt: {ge.managementQuality}
                                    </span>
                                  </div>
                                </div>
                                <div style={{ fontSize: '0.77rem', color: '#334155', marginTop: '4px' }}>
                                  {ge.verdict}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="sup-dossier-empty-gemini">
                      Click <strong>🤖 Evaluate Teacher with Gemini</strong> above to score{' '}
                      <strong>{inspectedSup.name}</strong> on Technical Instruction &amp; Advice (/10) and
                      Group Management (/10) based on their recorded meeting transcripts below.
                    </div>
                  )}

                  {/* Raw Extracted Advice & Diarized Spoken Turns per Meeting */}
                  {evidenceList.length > 0 && (
                    <div className="sup-dossier-card" style={{ marginTop: '10px' }}>
                      <h6>
                        📋 Recorded Consultation Evidence by Group &amp; Week ({evidenceList.length}{' '}
                        Sessions)
                      </h6>
                      <div className="sup-raw-meetings-list">
                        {evidenceList.map((ev) => (
                          <div key={`${ev.meetingId}_${ev.weekNumber}`} className="sup-raw-meeting-item">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                              <div>
                                <strong style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                                  📁 Group {ev.groupName} — Week {ev.weekNumber}
                                </strong>
                                {ev.projectTopic && (
                                  <span style={{ fontSize: '0.75rem', color: '#64748b', marginLeft: '6px' }}>
                                    ({ev.projectTopic})
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center', fontSize: '0.74rem' }}>
                                <span className="rate-pill good">
                                  ⏱️ {formatConsultationDuration(ev.consultationSeconds, false)}
                                </span>
                                {ev.supervisorSpeakingSeconds > 0 && (
                                  <span style={{ color: '#6d28d9', fontWeight: 700 }}>
                                    🗣️ Sup Spoke: {formatConsultationDuration(ev.supervisorSpeakingSeconds, false)}
                                  </span>
                                )}
                                <span style={{ color: '#475569' }}>
                                  📋 {ev.actionItemsAssignedCount} student tasks
                                </span>
                                {ev.meetingId && (
                                  <button
                                    type="button"
                                    className="btn-edit-student-work"
                                    onClick={() => {
                                      setSelectedMeetingId(ev.meetingId);
                                      if (ev.groupId) setStudioGroupId(ev.groupId);
                                      setStudioWeekNumber(ev.weekNumber);
                                      setSubViewMode('studio');
                                    }}
                                  >
                                    🎧 Open in Studio
                                  </button>
                                )}
                              </div>
                            </div>

                            {ev.supervisorFeedback.length > 0 && (
                              <div style={{ fontSize: '0.78rem', color: '#1e293b', marginTop: '5px' }}>
                                <strong>💡 Extracted Advice:</strong> {ev.supervisorFeedback.join(' • ')}
                              </div>
                            )}

                            {ev.keyDecisions.length > 0 && (
                              <div style={{ fontSize: '0.76rem', color: '#334155', marginTop: '3px' }}>
                                <strong>🎯 Key Decisions:</strong> {ev.keyDecisions.join(' • ')}
                              </div>
                            )}

                            {ev.spokenAdviceTurns.length > 0 && (
                              <div className="sup-spoken-turns-preview">
                                {ev.spokenAdviceTurns.slice(0, 3).map((turn, tIdx) => (
                                  <div key={tIdx} className="sup-spoken-turn-line">
                                    <span className="sup-turn-time">[{turn.startTime}]</span>{' '}
                                    <span>&ldquo;{turn.text}&rdquo;</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Section 2: Group x Week Consultation Duration & Talk-Time Heatmap Matrix */}
          <div className="supervisor-leaderboard-card">
            <div className="supervisor-section-header">
              <div>
                <h4>
                  2. 📁 Group &times; Week Consultation Duration &amp; Supervisor Talk-Time Matrix (
                  {filteredSupervisorGroupRows.length} Groups)
                </h4>
                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>
                  🟢 &ge;15m Thorough • 🟡 5–14m Moderate • 🔴 &lt;5m Short • ⚪ 0m Not Recorded — Click any week cell to open the recording &amp; transcript in Studio
                </span>
              </div>
              {supervisorPerfSelectedEmail !== 'all' && (
                <button
                  type="button"
                  className="btn-edit-student-work"
                  onClick={() => setSupervisorPerfSelectedEmail('all')}
                >
                  ✕ Clear Supervisor Filter
                </button>
              )}
            </div>

            {filteredSupervisorGroupRows.length === 0 ? (
              <div className="empty-meetings-box">
                No groups match the selected supervisor filter.
              </div>
            ) : (
              <div className="matrix-table-wrapper">
                <table className="project-meetings-matrix-table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Assigned Supervisor</th>
                      <th>Weeks Met</th>
                      <th>Total Consultation Time</th>
                      <th>Avg / Met Week</th>
                      <th>👨‍🏫 Supervisor Speaking Time</th>
                      {supervisorPerformanceAnalytics.allWeeks.map((wk) => (
                        <th key={wk}>Week {wk}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSupervisorGroupRows.map((gRow) => {
                      const avgMin = gRow.avgConsultationSecondsPerMetWeek / 60;
                      const avgClass =
                        avgMin >= 15 ? 'good' : avgMin >= 5 ? 'warn' : 'low';

                      return (
                        <tr key={gRow.groupId}>
                          <td>
                            <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                              📁 {gRow.groupName}
                            </strong>
                            {gRow.projectTopic && (
                              <div style={{ fontSize: '0.73rem', color: '#64748b', maxWidth: '200px' }}>
                                {gRow.projectTopic}
                              </div>
                            )}
                          </td>

                          <td>
                            <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#1e293b' }}>
                              👨‍🏫 {gRow.supervisorName || gRow.canonicalSupervisorName}
                            </div>
                          </td>

                          <td>
                            <span
                              className={`rate-pill ${
                                gRow.coveragePct >= 80
                                  ? 'good'
                                  : gRow.coveragePct >= 50
                                  ? 'warn'
                                  : 'low'
                              }`}
                            >
                              {gRow.weeksMetCount}/{gRow.totalActiveWeeksCount} ({gRow.coveragePct}%)
                            </span>
                          </td>

                          <td>
                            <strong style={{ color: '#1e3a8a' }}>
                              {formatConsultationDuration(gRow.totalConsultationSeconds, false)}
                            </strong>
                          </td>

                          <td>
                            {gRow.weeksMetCount > 0 ? (
                              <span className={`rate-pill ${avgClass}`}>
                                {formatConsultationDuration(gRow.avgConsultationSecondsPerMetWeek, false)}
                              </span>
                            ) : (
                              <span style={{ color: '#94a3b8' }}>—</span>
                            )}
                          </td>

                          <td>
                            {gRow.supervisorTalkSharePct !== null ? (
                              <div>
                                <strong style={{ color: '#6d28d9' }}>
                                  {formatConsultationDuration(gRow.totalSupervisorSpeakingSeconds, false)}
                                </strong>{' '}
                                <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                                  ({gRow.supervisorTalkSharePct}% of talk)
                                </span>
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>
                            )}
                          </td>

                          {supervisorPerformanceAnalytics.allWeeks.map((wk) => {
                            const cell = gRow.weekCells?.[wk];
                            const sec = cell?.consultationSeconds || 0;
                            const status = cell?.durationStatus || 'none';

                            return (
                              <td
                                key={wk}
                                className={`sup-matrix-week-cell status-${status}`}
                                onClick={() => {
                                  if (cell?.primaryMeetingId) {
                                    setSelectedMeetingId(cell.primaryMeetingId);
                                    setStudioGroupId(gRow.groupId);
                                    setStudioWeekNumber(wk);
                                    setSubViewMode('studio');
                                  }
                                }}
                                style={{
                                  cursor: cell?.primaryMeetingId ? 'pointer' : 'default',
                                }}
                                title={
                                  cell?.primaryMeetingId
                                    ? `Click to inspect Group ${gRow.groupName} Week ${wk} recording & diarized transcript`
                                    : `No recording for Group ${gRow.groupName} in Week ${wk}`
                                }
                              >
                                {sec > 0 ? (
                                  <div className="sup-week-cell-content">
                                    <span className={`sup-dur-pill ${status}`}>
                                      {status === 'thorough'
                                        ? '🟢'
                                        : status === 'moderate'
                                        ? '🟡'
                                        : '🔴'}{' '}
                                      {formatConsultationDuration(sec, false)}
                                    </span>
                                    {cell.validClipsCount > 1 && (
                                      <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                                        ({cell.validClipsCount} parts)
                                      </span>
                                    )}
                                    {cell.hasDiarization && (
                                      <div style={{ fontSize: '0.7rem', color: '#6d28d9', fontWeight: 600 }}>
                                        🗣️ Sup: {formatConsultationDuration(cell.supervisorSpeakingSeconds, false)} ({cell.supervisorTalkSharePct}%)
                                      </div>
                                    )}
                                    {cell.recorderNames?.length > 0 && (
                                      <div style={{ fontSize: '0.68rem', color: '#475569' }}>
                                        🎙️ {cell.recorderNames.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <span className="sup-dur-pill none">⚪ 0m</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="project-meetings-workspace-grid">
            {/* Left Panel: Redesigned Week-Aggregated Sessions Sidebar */}
            <div className={`meetings-grouped-sidebar ${mobileSidebarExpanded ? 'mobile-expanded' : 'mobile-collapsed'}`}>
              <div className="sidebar-header-bar">
                <div
                  className="sidebar-group-filter-row"
                  onClick={() => {
                    if (typeof window !== 'undefined' && window.innerWidth <= 960) {
                      setMobileSidebarExpanded((prev) => !prev);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-label="Toggle meeting sessions list"
                >
                  <span className="sidebar-title-badge">
                    📂 Meeting Sessions
                    <span className="mobile-sidebar-toggle-indicator">
                      {mobileSidebarExpanded ? '▲' : '▼'}
                    </span>
                  </span>
                </div>

                <div className="sidebar-scope-toggle" role="tablist" aria-label="Sidebar view mode">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sidebarScope === 'by_group'}
                    className={`sidebar-scope-btn ${sidebarScope === 'by_group' ? 'active' : ''}`}
                    onClick={() => setSidebarScope('by_group')}
                  >
                    By Group
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={sidebarScope === 'this_week'}
                    className={`sidebar-scope-btn ${sidebarScope === 'this_week' ? 'active' : ''}`}
                    onClick={() => setSidebarScope('this_week')}
                  >
                    Wk {studioWeekNumber}
                  </button>
                </div>
              </div>

            {loading ? (
              <div className="empty-meetings-box">Loading project meetings...</div>
            ) : meetingsGroupedByProjectGroup.length === 0 ? (
              <div className="empty-meetings-box">
                <p>No Project Groups or Meetings yet.</p>
                <button
                  type="button"
                  className="btn-manage-groups-trigger"
                  onClick={() => setShowGroupEditorModal(true)}
                >
                  👥 Create / Import Project Groups
                </button>
              </div>
            ) : sidebarScope === 'this_week' ? (
              <div className="sidebar-this-week-list">
                <div className="sidebar-week-summary-bar">
                  <span>Week {studioWeekNumber} Overview</span>
                  <span>
                    ✨ {weekAiStats.analyzedGroupsCount} · 🎙️ {weekAiStats.pendingGroupsCount} · ⚪ {Math.max(0, thisWeekSidebarRows.length - weekAiStats.recordedGroupsCount)}
                  </span>
                </div>
                {thisWeekSidebarRows.map(({ group: grp, primary, extraTakes }) => {
                  const isActiveGroup = grp.id === studioGroupId;
                  if (!primary) {
                    return (
                      <div
                        key={grp.id}
                        className={`week-overview-row empty ${isActiveGroup ? 'active' : ''}`}
                        onClick={() => handleSelectGroup(grp.id)}
                      >
                        <div className="week-overview-row-main">
                          <span className="week-overview-group-name">{grp.name}</span>
                          <span className="sidebar-pipeline-badge empty">⚪ Not recorded</span>
                        </div>
                      </div>
                    );
                  }
                  const isThisMeetingAnalyzing =
                    primary.status === 'analyzing' ||
                    (isAnalyzing && selectedMeetingId === primary.id) ||
                    (batchAnalysisProgress && batchAnalysisProgress.meetingId === primary.id);
                  const st = getMeetingPipelineAndHealth(primary, isThisMeetingAnalyzing);
                  const clipCount = getMeetingValidClipCount(primary);
                  const dur = getMeetingValidAudioDuration(primary);
                  const presentCount = (primary.attendanceRecord || []).filter(
                    (a) => a.status === 'present' || a.status === 'late'
                  ).length;
                  const totalRoster = (primary.attendanceRecord || []).length;

                  return (
                    <div
                      key={grp.id}
                      className={`week-overview-row ${primary.id === selectedMeetingId || isActiveGroup ? 'active' : ''} ${isThisMeetingAnalyzing ? 'analyzing-active' : ''}`}
                      onClick={() => handleSelectMeeting(primary)}
                    >
                      <div className="week-overview-row-main">
                        <span className="week-overview-group-name">{grp.name}</span>
                        <div className="sidebar-badges-cluster">
                          <span className={`sidebar-pipeline-badge ${st.pipelineKey}`}>
                            {st.pipelineLabel}
                          </span>
                          {st.healthLabel && (
                            <span className="sidebar-health-badge at-risk">{st.healthLabel}</span>
                          )}
                        </div>
                      </div>
                      <div className="week-overview-row-meta">
                        <span>🎙️ {clipCount}</span>
                        <span>⏱️ {formatDuration(dur)}</span>
                        {totalRoster > 0 && <span>👥 {presentCount}/{totalRoster}</span>}
                        {extraTakes.length > 0 && (
                          <span className="extra-takes-count-hint">+{extraTakes.length} takes</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="grouped-folders-list">
                {meetingsGroupedByProjectGroup.map(({ group: grp, weekSlots, distinctWeeksCount, latestSlot }) => {
                  const isActiveGroup = grp.id === studioGroupId || selectedMeeting?.groupId === grp.id;
                  const defaultExpanded = isActiveGroup || meetingsGroupedByProjectGroup.length <= 4;
                  const isExpanded =
                    expandedSidebarGroupIds[grp.id] !== undefined
                      ? Boolean(expandedSidebarGroupIds[grp.id])
                      : defaultExpanded;
                  const latestStatus = latestSlot?.primary
                    ? getMeetingPipelineAndHealth(latestSlot.primary)
                    : null;

                  return (
                    <div key={grp.id} className={`project-group-folder ${isActiveGroup ? 'is-active-group' : ''}`}>
                      <button
                        type="button"
                        className={`project-group-folder-header ${isActiveGroup ? 'active-group-header' : ''}`}
                        onClick={() => {
                          setExpandedSidebarGroupIds((prev) => ({
                            ...prev,
                            [grp.id]: !isExpanded,
                          }));
                        }}
                        aria-expanded={isExpanded}
                      >
                        <div className="folder-header-left">
                          <span className="folder-chevron">{isExpanded ? '▼' : '▶'}</span>
                          <div>
                            <span className="folder-group-title">
                              📂 {grp.name}
                            </span>
                            {isExpanded && grp.supervisorEmail && (
                              <span className="folder-supervisor-sub">
                                👨‍🏫 {grp.supervisorEmail}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="folder-header-right">
                          {!isExpanded && latestSlot && latestStatus && (
                            <span className={`sidebar-pipeline-badge compact ${latestStatus.pipelineKey}`}>
                              Wk {latestSlot.weekNumber} {latestStatus.pipelineLabel.split(' ')[0]}
                              {latestStatus.healthLabel ? ' ⚠️' : ''}
                            </span>
                          )}
                          <span className="folder-count-badge">
                            {distinctWeeksCount} wk{distinctWeeksCount === 1 ? '' : 's'}
                          </span>
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="project-group-folder-items">
                          {weekSlots.length === 0 ? (
                            <div className="empty-folder-note">
                              No recordings yet — select <strong>{grp.name}</strong> above to record.
                            </div>
                          ) : (
                            weekSlots.map((slot) => {
                              const m = slot.primary;
                              const isSelected = m.id === selectedMeetingId;
                              const isThisMeetingAnalyzing =
                                m.status === 'analyzing' ||
                                (isAnalyzing && selectedMeetingId === m.id) ||
                                (batchAnalysisProgress && batchAnalysisProgress.meetingId === m.id);
                              const st = getMeetingPipelineAndHealth(m, isThisMeetingAnalyzing);
                              const voiceClipCount = getMeetingValidClipCount(m);
                              const validDuration = getMeetingValidAudioDuration(m);
                              const screenClipCount = (m.screenClips || []).length;
                              const presentCount = (m.attendanceRecord || []).filter(
                                (a) => a.status === 'present' || a.status === 'late'
                              ).length;
                              const totalRoster = (m.attendanceRecord || []).length;
                              const customTitle =
                                m.title &&
                                !/^week\s+\d+\s+supervision\s+meeting$/i.test(m.title.trim()) &&
                                !/^supervision\s+meeting$/i.test(m.title.trim())
                                  ? m.title.trim()
                                  : '';
                              const showDifferentSupervisor =
                                m.supervisorEmail &&
                                grp.supervisorEmail &&
                                normalizeStudentEmail(m.supervisorEmail) !== normalizeStudentEmail(grp.supervisorEmail);
                              const extraKey = `${grp.id}_wk${slot.weekNumber}`;
                              const isExtraExpanded = Boolean(expandedExtraTakesKeys[extraKey]);

                              return (
                                <div key={`${grp.id}-wk-${slot.weekNumber}`} className="week-slot-wrapper">
                                  <div
                                    className={`meeting-session-card ${isSelected ? 'active' : ''} ${isThisMeetingAnalyzing ? 'analyzing-active' : ''}`}
                                    onClick={() => handleSelectMeeting(m)}
                                  >
                                    <div className="session-card-top-row">
                                      <strong className="session-card-week-title">
                                        Week {slot.weekNumber}{customTitle ? `: ${customTitle}` : ''}
                                      </strong>
                                      <div className="sidebar-badges-cluster">
                                        <span className={`sidebar-pipeline-badge ${st.pipelineKey}`}>
                                          {st.pipelineLabel}
                                        </span>
                                        {st.healthLabel && (
                                          <span className="sidebar-health-badge at-risk">
                                            {st.healthLabel}
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    <div className="meeting-card-badges">
                                      <span>🎙️ {voiceClipCount} Clip{voiceClipCount === 1 ? '' : 's'}</span>
                                      {screenClipCount > 0 && (
                                        <span>💻 {screenClipCount}</span>
                                      )}
                                      <span>⏱️ {formatDuration(validDuration)}</span>
                                      {totalRoster > 0 && (
                                        <span>👥 {presentCount}/{totalRoster}</span>
                                      )}
                                      {showDifferentSupervisor && (
                                        <span title={m.supervisorEmail}>
                                          👨‍🏫 {m.supervisorName || m.supervisorEmail.split('@')[0]}
                                        </span>
                                      )}
                                    </div>

                                    {(st.hasValidAudio || st.isAnalyzed || slot.extraTakes.length > 0) && (
                                      <div className="session-card-footer-row">
                                        {slot.extraTakes.length > 0 ? (
                                          <button
                                            type="button"
                                            className="btn-toggle-extra-takes"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setExpandedExtraTakesKeys((prev) => ({
                                                ...prev,
                                                [extraKey]: !prev[extraKey],
                                              }));
                                            }}
                                          >
                                            {isExtraExpanded ? '▾' : '▸'} +{slot.extraTakes.length} other take{slot.extraTakes.length > 1 ? 's' : ''}
                                          </button>
                                        ) : (
                                          <span />
                                        )}

                                        {(st.hasValidAudio || st.isAnalyzed) && (
                                          <button
                                            type="button"
                                            className={`btn-card-email-report ${m.emailDispatch?.sentAt ? 'sent' : ''}`}
                                            aria-label="📧 Email Report"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleOpenEmailModal(m);
                                            }}
                                            title="Email meeting report to students"
                                          >
                                            📧 {m.emailDispatch?.sentAt ? 'Sent ✓' : 'Email Report'}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {isExtraExpanded && slot.extraTakes.length > 0 && (
                                    <div className="extra-takes-drawer">
                                      {slot.extraTakes.map((extra, idx) => {
                                        const extraSt = getMeetingPipelineAndHealth(extra);
                                        const extraDur = getMeetingValidAudioDuration(extra);
                                        const extraClips = getMeetingValidClipCount(extra);
                                        return (
                                          <button
                                            key={extra.id}
                                            type="button"
                                            className={`extra-take-row ${extra.id === selectedMeetingId ? 'active' : ''}`}
                                            onClick={() => handleSelectMeeting(extra)}
                                          >
                                            <span>Take #{idx + 2}</span>
                                            <span className={`sidebar-pipeline-badge compact ${extraSt.pipelineKey}`}>
                                              {extraSt.pipelineLabel}
                                            </span>
                                            <span>{extraClips}c · {formatDuration(extraDur)}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Selected Meeting Inspector (Dual-Stream Player + Attendance + Key Insights + Work Done Per Student) */}
          <div className="meeting-inspector-panel">
            {!selectedMeeting ? (
              <div className="empty-meetings-box" style={{ padding: '32px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>📂</div>
                <h4 style={{ margin: '0 0 8px 0', color: '#1e293b' }}>No Meeting Session Selected</h4>
                <p style={{ margin: '0 0 16px 0', color: '#64748b', fontSize: '0.88rem' }}>
                  Select a meeting session from the left sidebar to view the analysis dossier, attendance, scores, and email reports to students.
                </p>
                {filteredMeetings.length > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn-start-meeting-rec"
                      onClick={() => handleSelectMeeting(filteredMeetings[0])}
                      style={{ padding: '8px 16px', fontSize: '0.86rem' }}
                    >
                      👉 Open Latest Session: {filteredMeetings[0].groupName} — Week {filteredMeetings[0].weekNumber || 1}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="inspector-header">
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      <h3 style={{ margin: 0 }}>
                        {selectedMeeting.groupName} — Week {selectedMeeting.weekNumber || 1}: {selectedMeeting.title}
                      </h3>
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                      <span>📅 {selectedMeeting.meetingDate ? new Date(selectedMeeting.meetingDate).toLocaleString() : 'Recent'}</span>
                      <span>👨‍🏫 Supervisor: <strong>{selectedMeeting.supervisorEmail}</strong></span>
                      {selectedMeeting.status === 'analysis_failed' ? (
                        <span style={{ color: '#dc2626', fontWeight: 600 }}>❌ AI Analysis Failed</span>
                      ) : selectedMeeting.analyzedAt ? (
                        <span>✨ Analyzed: <strong>{new Date(selectedMeeting.analyzedAt.toDate?.() || selectedMeeting.analyzedAt).toLocaleTimeString()}</strong></span>
                      ) : selectedMeeting.rawDiarizedTranscript ? (
                        <span>✨ Analyzed</span>
                      ) : (
                        <span style={{ color: '#d97706', fontWeight: 600 }}>🎙️ Recorded (Pending AI Analysis)</span>
                      )}
                      {selectedMeeting.aiModelUsed && (
                        <span>🤖 Model: <strong>{selectedMeeting.aiModelUsed}</strong></span>
                      )}
                      {selectedMeeting.aiCost !== undefined && selectedMeeting.aiCost !== null && (
                        <span>💰 AI Cost: <strong>{formatAiCost(selectedMeeting.aiCost)}</strong></span>
                      )}
                    </div>

                    {selectedMeeting.status === 'analysis_failed' && (
                      <div style={{ width: '100%', background: '#fef2f2', border: '1.5px solid #fecaca', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
                        <span style={{ fontSize: '1.2rem' }}>⚠️</span>
                        <div>
                          <strong style={{ color: '#991b1b', fontSize: '0.88rem', display: 'block' }}>
                            AI Analysis Encountered an Error
                          </strong>
                          <span style={{ color: '#b91c1c', fontSize: '0.8rem' }}>
                            {selectedMeeting.analysisError || 'The previous analysis run failed. Click "Retry Gemini Analysis" below to run it again.'}
                          </span>
                        </div>
                      </div>
                    )}

                    {(isAnalyzing || selectedMeeting.status === 'analyzing') && (
                      <div style={{ width: '100%', background: '#fef3c7', border: '1.5px solid #fde68a', borderRadius: '8px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px', marginTop: '10px' }}>
                        <span style={{ fontSize: '1.3rem', animation: 'spin 1.5s linear infinite' }}>⏳</span>
                        <div>
                          <strong style={{ color: '#92400e', fontSize: '0.88rem', display: 'block' }}>
                            Gemini Diarization &amp; Log Analysis in Progress...
                          </strong>
                          <span style={{ color: '#b45309', fontSize: '0.8rem' }}>
                            Transcribing audio clips, attributing student speakers, verifying weekly logs &amp; grading contributions. Please wait ~60–90 seconds.
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <select
                      aria-label="Select Gemini reasoning model"
                      value={preferredAiModel}
                      onChange={(e) => setPreferredAiModel(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                    >
                      <option value="gemini-3.8-flash">⚡ Gemini 3.5 Transcribe + 3.8 Flash</option>
                      <option value="gemini-4-argon">🧠 Gemini 3.5 Transcribe + 4 Argon</option>
                      <option value="gemini-3.5-flash-lite">🪶 Gemini 3.5 Transcribe + 3.5 Flash-Lite</option>
                    </select>

                    <button
                      type="button"
                      className="btn-run-gemini-meeting"
                      onClick={() => handleRunGeminiAnalysis(selectedMeeting.id)}
                      disabled={isAnalyzing || selectedMeeting.status === 'analyzing'}
                    >
                      {isAnalyzing || selectedMeeting.status === 'analyzing'
                        ? '⏳ Analyzing Diarization & Insights...'
                        : selectedMeeting.status === 'analysis_failed'
                        ? '🔄 Retry Gemini Analysis'
                        : selectedMeeting.analyzedAt || selectedMeeting.aiModelUsed || selectedMeeting.rawDiarizedTranscript
                        ? '✨ Re-Run Gemini Analysis'
                        : '✨ Run Gemini Analysis'}
                    </button>

                    <button
                      type="button"
                      className="btn-copy-markdown-minutes"
                      onClick={() => {
                        const md = generateMeetingMarkdownMinutes(selectedMeeting, { privacyMode: isPrivacyMode });
                        navigator.clipboard?.writeText(md);
                        showToastMessage(isPrivacyMode ? '📋 Copied Privacy-Masked Meeting Minutes to clipboard!' : '📋 Copied Markdown Meeting Minutes to clipboard!');
                      }}
                    >
                      📋 Copy Minutes
                    </button>

                    <button
                      type="button"
                      className="btn-email-meeting-report"
                      onClick={() => handleOpenEmailModal(selectedMeeting)}
                      title="Email meeting minutes, attendance, scores and supervisor feedback to students"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '7px 14px',
                        borderRadius: '6px',
                        border: '1.5px solid #2563eb',
                        background: '#2563eb',
                        color: '#ffffff',
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        fontWeight: 700,
                        boxShadow: '0 1px 3px rgba(37, 99, 235, 0.3)',
                      }}
                    >
                      📧 Email Report
                      {selectedMeeting.emailDispatch?.sentAt && (
                        <span style={{ fontSize: '0.72rem', background: '#1e40af', color: '#ffffff', padding: '1px 6px', borderRadius: '4px' }}>
                          ✓ Sent
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      className="btn-delete-meeting-session"
                      onClick={() => handleDeleteMeeting(selectedMeeting.id)}
                      title="Permanently delete this entire meeting session"
                      style={{
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #fecaca',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        fontSize: '0.82rem',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      🗑️ Delete Session
                    </button>

                    {groups.length > 1 && (
                      <select
                        aria-label="Move entire session to another group"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) {
                            handleMoveMeetingToGroup(e.target.value);
                          }
                        }}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          background: '#f8fafc',
                          fontSize: '0.82rem',
                          cursor: 'pointer',
                        }}
                        title="Move this entire recording session to another Project Group"
                      >
                        <option value="" disabled>
                          ↪️ Move Session to Group...
                        </option>
                        {groups
                          .filter((g) => g.id !== selectedMeeting.groupId)
                          .map((g) => (
                            <option key={g.id} value={g.id}>
                              Move Session to {g.name}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                </div>

                {/* Synchronized Dual-Stream Player (📱 Teacher Mobile Voice + 💻 Student PC Screen Video) */}
                <div className="dual-stream-player-card">
                  <div className="clip-switcher-row">
                    <div className="clip-pills-group">
                      <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>📱 Mobile Voice Clips:</span>
                      {(selectedMeeting.audioClips || []).map((c, idx) => (
                        <button
                          key={c.clipId || idx}
                          type="button"
                          className={`clip-pill-btn ${activeAudioClipIdx === idx ? 'active' : ''}`}
                          onClick={() => setActiveAudioClipIdx(idx)}
                        >
                          🎙️ {c.label || `Part ${idx + 1}`} ({formatDuration(c.durationSeconds || 0)})
                        </button>
                      ))}
                      {(selectedMeeting.audioClips || []).length > 0 && (
                        <button
                          type="button"
                          className="btn-delete-clip-part"
                          title={`Delete ${activeAudioClip?.label || `Part ${activeAudioClipIdx + 1}`} (wrong recording)`}
                          onClick={() => handleDeleteAudioClip(activeAudioClipIdx)}
                          style={{
                            fontSize: '0.74rem',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            background: '#fff1f2',
                            color: '#be123c',
                            cursor: 'pointer',
                            fontWeight: 600,
                            marginLeft: '4px',
                          }}
                        >
                          🗑️ Delete {activeAudioClip?.label || `Part ${activeAudioClipIdx + 1}`}
                        </button>
                      )}

                      {(selectedMeeting.audioClips || []).length > 0 && groups.length > 1 && (
                        <select
                          aria-label="Move clip part to another group"
                          value=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleMoveAudioClipToGroup(activeAudioClipIdx, e.target.value);
                            }
                          }}
                          style={{
                            fontSize: '0.74rem',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #cbd5e1',
                            background: '#f8fafc',
                            cursor: 'pointer',
                            marginLeft: '4px',
                          }}
                          title={`Move ${activeAudioClip?.label || `Part ${activeAudioClipIdx + 1}`} to another Project Group`}
                        >
                          <option value="" disabled>
                            ↪️ Move {activeAudioClip?.label || `Part ${activeAudioClipIdx + 1}`} to...
                          </option>
                          {groups
                            .filter((g) => g.id !== selectedMeeting.groupId)
                            .map((g) => (
                              <option key={g.id} value={g.id}>
                                Move to {g.name} ({g.projectTopic || 'Project'})
                              </option>
                            ))}
                        </select>
                      )}
                    </div>

                    {(selectedMeeting.screenClips || []).length > 0 && (
                      <div className="clip-pills-group">
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>📹 720p Mobile Demo Videos:</span>
                        {selectedMeeting.screenClips.map((sc, idx) => (
                          <button
                            key={sc.clipId || idx}
                            type="button"
                            className={`clip-pill-btn screen-pill ${activeScreenClipIdx === idx ? 'active' : ''}`}
                            onClick={() => setActiveScreenClipIdx(idx)}
                          >
                            {sc.type === 'mobile_camera' ? '📹' : '💻'} {sc.label || sc.studentName || (sc.type === 'mobile_camera' ? `Demo ${idx + 1}` : `Screen ${idx + 1}`)}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn-delete-clip-part"
                          title="Delete selected screen or demo recording clip"
                          onClick={() => handleDeleteScreenClip(activeScreenClipIdx)}
                          style={{
                            fontSize: '0.74rem',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            border: '1px solid #fecaca',
                            background: '#fff1f2',
                            color: '#be123c',
                            cursor: 'pointer',
                            fontWeight: 600,
                            marginLeft: '4px',
                          }}
                        >
                          🗑️ Delete Screen
                        </button>
                        <label style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <input
                            type="checkbox"
                            checked={syncVideoWithAudio}
                            onChange={(e) => setSyncVideoWithAudio(e.target.checked)}
                          />
                          🔗 Sync Video + Voice
                        </label>
                      </div>
                    )}
                  </div>

                  {activeScreenClip?.downloadUrl && (
                    <div className="student-pc-video-wrapper">
                      <video
                        ref={videoPlayerRef}
                        src={activeScreenClip.downloadUrl}
                        controls
                        muted={syncVideoWithAudio}
                        width={960}
                        height={540}
                        preload="metadata"
                        style={{ width: '100%', maxHeight: '340px', borderRadius: '8px', background: '#0f172a' }}
                      />
                    </div>
                  )}

                  {activeAudioClip?.downloadUrl ? (
                    <audio
                      ref={audioPlayerRef}
                      src={activeAudioClip.downloadUrl}
                      controls
                      preload="metadata"
                      style={{ width: '100%', marginTop: '6px' }}
                      onPlay={() => {
                        if (syncVideoWithAudio && videoPlayerRef.current) {
                          videoPlayerRef.current.currentTime = audioPlayerRef.current?.currentTime || 0;
                          videoPlayerRef.current.play?.().catch(() => {});
                        }
                      }}
                      onPause={() => {
                        if (syncVideoWithAudio && videoPlayerRef.current) {
                          videoPlayerRef.current.pause?.();
                        }
                      }}
                      onSeeked={() => {
                        if (syncVideoWithAudio && videoPlayerRef.current && audioPlayerRef.current) {
                          videoPlayerRef.current.currentTime = audioPlayerRef.current.currentTime;
                        }
                      }}
                    />
                  ) : (
                    <div style={{ fontSize: '0.82rem', color: '#64748b' }}>No voice recording uploaded yet.</div>
                  )}
                </div>

                {/* Visual Artifacts & Photos Gallery */}
                <div className="inspector-photos-section" style={{ marginTop: '12px', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '1.1rem' }}>📸</span>
                      <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>
                        Meeting Photos &amp; Visual Evidence ({(selectedMeeting.photos || []).length})
                      </strong>
                    </div>
                    <button
                      type="button"
                      onClick={handleOpenPhotoModal}
                      style={{
                        padding: '5px 12px',
                        borderRadius: '6px',
                        background: '#f3e8ff',
                        border: '1px solid #d8b4fe',
                        color: '#6b21a8',
                        fontSize: '0.78rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ➕ Snap / Upload Photo
                    </button>
                  </div>

                  {(selectedMeeting.photos || []).length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
                      No photos captured yet for this meeting. Tap &quot;Snap / Upload Photo&quot; to attach whiteboard diagrams, IoT hardware, or screen photos for Gemini multimodal verification.
                    </p>
                  ) : (
                    <div className="photo-artifacts-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '10px' }}>
                      {(selectedMeeting.photos || []).map((p, pIdx) => (
                        <div
                          key={p.photoId || pIdx}
                          className="photo-artifact-card"
                          style={{
                            border: '1px solid #e2e8f0',
                            borderRadius: '8px',
                            overflow: 'hidden',
                            background: '#f8fafc',
                            display: 'flex',
                            flexDirection: 'column',
                          }}
                        >
                          <div
                            onClick={() => setPreviewPhoto(p)}
                            style={{
                              position: 'relative',
                              width: '100%',
                              height: '100px',
                              cursor: 'pointer',
                              background: '#0f172a',
                            }}
                            title="Click to Zoom / Lightbox"
                          >
                            <img
                              src={p.downloadUrl}
                              alt={p.label || `Photo ${pIdx + 1}`}
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              loading="lazy"
                            />
                            <span
                              style={{
                                position: 'absolute',
                                bottom: '4px',
                                right: '4px',
                                background: 'rgba(0,0,0,0.65)',
                                color: '#ffffff',
                                fontSize: '0.66rem',
                                padding: '1px 5px',
                                borderRadius: '4px',
                              }}
                            >
                              🔍 Zoom
                            </span>
                          </div>
                          <div style={{ padding: '6px', display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                            <span style={{ fontSize: '0.74rem', fontWeight: 700, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.label || `Photo ${pIdx + 1}`}
                            </span>
                            {p.studentName && (
                              <span style={{ fontSize: '0.68rem', color: '#2563eb', fontWeight: 600 }}>
                                👤 {p.studentName}
                              </span>
                            )}
                            {p.caption && (
                              <span style={{ fontSize: '0.68rem', color: '#64748b', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {p.caption}
                              </span>
                            )}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto', paddingTop: '4px' }}>
                              <span style={{ fontSize: '0.64rem', color: '#94a3b8' }}>
                                {p.takenAt ? new Date(p.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleDeletePhoto(pIdx)}
                                title="Delete this photo"
                                style={{
                                  background: 'none',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontSize: '0.72rem',
                                  padding: '1px',
                                  color: '#be123c',
                                }}
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Notice banner if meeting has audio clips but has not yet been processed by Gemini or needs re-analysis */}
                {hasMeetingValidAudio(selectedMeeting) ? (
                  isMeetingPendingAnalysis(selectedMeeting) && (
                    <div style={{ padding: '10px 14px', background: selectedMeeting.needsReanalysis ? '#fff7ed' : '#fefce8', border: `1px solid ${selectedMeeting.needsReanalysis ? '#fdba74' : '#fef08a'}`, borderRadius: '8px', color: selectedMeeting.needsReanalysis ? '#9a3412' : '#854d0e', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                      <span>
                        {selectedMeeting.needsReanalysis ? (
                          <>⚠️ <strong>Audio Recordings Modified (Re-analysis Recommended):</strong> Audio clips were moved or modified on this session. Click <strong>&quot;Run Gemini Analysis&quot;</strong> to re-analyze the current audio.</>
                        ) : selectedMeeting.rawDiarizedTranscript?.includes('No intelligible speech detected') || selectedMeeting.keyInsights?.executiveSummary?.includes('No intelligible speech was recorded') ? (
                          <>⚠️ <strong>Previous Analysis Found No Speech:</strong> Audio clips are attached to this meeting. Click <strong>&quot;Run Gemini Analysis&quot;</strong> to re-transcribe and diarize.</>
                        ) : (
                          <>🎙️ <strong>Audio Recorded (Pending AI Analysis):</strong> Gemini has not processed this meeting yet. Click <strong>&quot;Run Gemini Analysis&quot;</strong> to diarize speakers, verify weekly logs, and attribute attendance.</>
                        )}
                      </span>
                      <button
                        type="button"
                        className="btn-run-gemini-meeting"
                        style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                        onClick={() => handleRunGeminiAnalysis(selectedMeeting.id)}
                        disabled={isAnalyzing || selectedMeeting.status === 'analyzing'}
                      >
                        {isAnalyzing || selectedMeeting.status === 'analyzing'
                          ? '⏳ Analyzing...'
                          : selectedMeeting.status === 'analysis_failed'
                          ? '🔄 Retry Gemini Analysis Now'
                          : '✨ Run Gemini Analysis Now'}
                      </button>
                    </div>
                  )
                ) : (
                  ((Array.isArray(selectedMeeting?.audioClips) && selectedMeeting.audioClips.length > 0) || selectedMeeting?.audioStoragePath) && (
                    <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#991b1b', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                      <span>
                        ⚠️ <strong>Empty / Incomplete Recording (0s / 0 bytes):</strong> No valid audio was recorded in this session. Please record a new audio clip or delete this empty session.
                      </span>
                    </div>
                  )
                )}

                {/* Section 1: Attendance Record Strip with 1-Click Teacher Override */}
                <div className="inspector-section-card">
                  <div className="section-card-header">
                    <h4>1. 📋 Meeting Attendance Record (Extracted from Voice &amp; Screen + 1-Click Override)</h4>
                    <span style={{ fontSize: '0.8rem', color: '#475569' }}>
                      {(selectedMeeting.attendanceRecord || []).filter((a) => a.status === 'present' || a.status === 'late').length} /{' '}
                      {(selectedMeeting.attendanceRecord || []).length} Present
                    </span>
                  </div>

                  <div className="attendance-cards-grid">
                    {(selectedMeeting.attendanceRecord || []).map((att) => (
                      <div key={att.uid || att.email} className={`attendance-member-card ${att.status || 'absent'}`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                          <div>
                            <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{formatStudentDisplayName(att.name, att.email)}</strong>
                            {att.email && (
                              <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                                {formatStudentDisplayEmail(att.email)}
                              </div>
                            )}
                          </div>
                          <span className={`speaking-level-badge ${att.speakingContribution || 'none'}`}>
                            🗣️ {att.speakingContribution || 'none'}
                          </span>
                        </div>

                        {att.evidence && (
                          <div className="attendance-evidence-note">
                            {att.firstHeardTimestamp && (
                              <button
                                type="button"
                                className="btn-timestamp-seek"
                                onClick={() => handleSeekToTimestamp(att.firstHeardTimestamp)}
                              >
                                ▶ [{att.firstHeardTimestamp}]
                              </button>
                            )}{' '}
                            {att.evidence}
                          </div>
                        )}

                        <div className="attendance-override-btns">
                          {['present', 'late', 'absent'].map((st) => (
                            <button
                              key={st}
                              type="button"
                              className={`btn-att-toggle ${att.status === st ? `active-${st}` : ''}`}
                              onClick={() => handleToggleAttendanceStatus(att.uid || att.email, st)}
                            >
                              {st === 'present' ? '✅ Present' : st === 'late' ? '🕒 Late' : '❌ Absent'}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Section 2: Key Meeting Insights */}
                <div className="inspector-section-card">
                  <div className="section-card-header">
                    <h4>2. 💡 Key Meeting Insights &amp; Supervisor Feedback</h4>
                    <span className={`progress-status-pill ${selectedMeeting.keyInsights?.overallGroupProgress || 'on_track'}`}>
                      {(selectedMeeting.keyInsights?.overallGroupProgress || 'on_track').replace('_', ' ').toUpperCase()}
                    </span>
                  </div>

                  <p className="executive-summary-text">
                    {selectedMeeting.keyInsights?.executiveSummary ||
                      'Click "Re-Run Gemini Analysis" to extract executive summary, decisions, and blockers.'}
                  </p>

                  <div className="insights-three-col">
                    <div className="insight-col-box">
                      <h5>🎯 Key Decisions</h5>
                      <ul>
                        {(selectedMeeting.keyInsights?.keyDecisions || []).length === 0 ? (
                          <li className="muted-li">None extracted</li>
                        ) : (
                          selectedMeeting.keyInsights.keyDecisions.map((d, i) => <li key={i}>{d}</li>)
                        )}
                      </ul>
                    </div>

                    <div className="insight-col-box">
                      <h5>🚧 Blockers &amp; Risks</h5>
                      <ul>
                        {(selectedMeeting.keyInsights?.blockersAndRisks || []).length === 0 ? (
                          <li className="muted-li">No blockers flagged</li>
                        ) : (
                          selectedMeeting.keyInsights.blockersAndRisks.map((b, i) => <li key={i}>{b}</li>)
                        )}
                      </ul>
                    </div>

                    <div className="insight-col-box">
                      <h5>👨‍🏫 Supervisor Feedback</h5>
                      <ul>
                        {(selectedMeeting.keyInsights?.supervisorFeedback || []).length === 0 ? (
                          <li className="muted-li">None recorded</li>
                        ) : (
                          selectedMeeting.keyInsights.supervisorFeedback.map((f, i) => <li key={i}>{f}</li>)
                        )}
                      </ul>
                    </div>
                  </div>

                  {/* Post-Meeting Weekly Group Feedback Box */}
                  <div className="weekly-group-feedback-box">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <strong>📝 Post-Meeting Weekly Group Feedback (For Students):</strong>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn-edit-student-work"
                          onClick={() => handleOpenEmailModal(selectedMeeting)}
                          style={{
                            background: '#2563eb',
                            color: '#ffffff',
                            border: '1px solid #1d4ed8',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                          title="Email this feedback and report to group students"
                        >
                          📧 Email Report to Students
                        </button>
                        <button
                          type="button"
                          className="btn-edit-student-work"
                          onClick={() => {
                            if (isEditingGroupFeedback) {
                              setIsEditingGroupFeedback(false);
                            } else {
                              setGroupFeedbackDraft(
                                selectedMeeting.keyInsights?.weeklyGroupFeedback ||
                                  (selectedMeeting.keyInsights?.supervisorFeedback || []).join(' ')
                              );
                              setIsEditingGroupFeedback(true);
                            }
                          }}
                        >
                          {isEditingGroupFeedback ? 'Cancel' : '✏️ Edit Group Feedback'}
                        </button>
                        {(selectedMeeting.keyInsights?.weeklyGroupFeedback ||
                          (selectedMeeting.keyInsights?.supervisorFeedback || []).length > 0) && (
                          <button
                            type="button"
                            className="btn-edit-student-work"
                            onClick={() => {
                              const text =
                                selectedMeeting.keyInsights?.weeklyGroupFeedback ||
                                (selectedMeeting.keyInsights?.supervisorFeedback || []).join('\n');
                              navigator.clipboard?.writeText(text);
                              showToastMessage('📋 Copied Weekly Group Feedback!');
                            }}
                          >
                            📋 Copy
                          </button>
                        )}
                      </div>
                    </div>

                    {isEditingGroupFeedback ? (
                      <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <textarea
                          rows={3}
                          value={groupFeedbackDraft}
                          onChange={(e) => setGroupFeedbackDraft(e.target.value)}
                          placeholder="Write weekly feedback for the project group..."
                          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
                        />
                        <div>
                          <button
                            type="button"
                            className="btn-save-student-work"
                            onClick={handleSaveWeeklyGroupFeedback}
                          >
                            💾 Save Weekly Group Feedback
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p style={{ margin: '6px 0 0', fontSize: '0.84rem', color: '#1e293b' }}>
                        {selectedMeeting.keyInsights?.weeklyGroupFeedback ||
                          (selectedMeeting.keyInsights?.supervisorFeedback || []).join(' ') ||
                          'Run Gemini Analysis to generate weekly post-meeting group feedback.'}
                      </p>
                    )}
                  </div>
                </div>

                {/* Section 3: Work Done, Log Quality Audit & Weekly Feedback Per Student */}
                <div className="inspector-section-card">
                  <div className="section-card-header">
                    <h4>3. 🛠️ Work Done, Log Quality Grading &amp; Weekly Feedback Per Student</h4>
                    <button
                      type="button"
                      className="btn-toggle-transcript-drawer"
                      onClick={() => setShowTranscriptDrawer((prev) => !prev)}
                    >
                      {showTranscriptDrawer ? '🔼 Hide Diarized Transcript' : '📜 View Diarized Transcript'}
                    </button>
                  </div>

                  <div className="student-contributions-grid">
                    {(selectedMeeting.studentContributions || []).map((sc) => {
                      const isEditing = editingStudentUid === (sc.uid || sc.email);
                      const mtgGrpCode = String(selectedMeeting.groupName || '')
                        .replace(/^group\s+/i, '')
                        .trim()
                        .toUpperCase();
                      const mtgGwKey = `${mtgGrpCode}__wk${selectedMeeting.weekNumber || 1}`;
                      const matchingSheetLog = (weeklyLogData.byGroupAndWeek?.[mtgGwKey] || []).find(
                        (l) =>
                          normalizeStudentEmail(l.email) === normalizeStudentEmail(sc.email) ||
                          l.studentId === String(sc.email || '').split('@')[0]
                      );

                      const effectiveLogQualityStatus =
                        sc.logQualityAssessment && sc.logQualityAssessment !== 'not_submitted'
                          ? sc.logQualityAssessment
                          : matchingSheetLog?.qualityStatus || 'not_submitted';
                      const effectiveLogQualityScore =
                        typeof sc.logQualityScore === 'number'
                          ? sc.logQualityScore
                          : matchingSheetLog?.qualityScore ?? null;
                      const effectiveQuestions =
                        Array.isArray(sc.challengeQuestions) && sc.challengeQuestions.length > 0
                          ? sc.challengeQuestions
                          : matchingSheetLog?.suggestedChallengeQuestions || [];

                      const logStatusClass =
                        effectiveLogQualityStatus === 'suspected_ai_fake' ||
                        effectiveLogQualityStatus === 'suspected_ai_unverified' ||
                        effectiveLogQualityStatus === 'contradicted_in_meeting'
                          ? 'suspected-ai'
                          : effectiveLogQualityStatus === 'vague_useless'
                          ? 'vague'
                          : effectiveLogQualityStatus === 'genuine' ||
                            effectiveLogQualityStatus === 'genuine_verified'
                          ? 'genuine'
                          : 'inactive';

                      return (
                        <div key={sc.uid || sc.email} className="student-contribution-card">
                          <div className="student-contrib-header">
                            <div>
                              <strong>👤 {formatStudentDisplayName(sc.name, sc.email)}</strong>
                              {sc.email && (
                                <span style={{ marginLeft: '8px', fontSize: '0.76rem', color: '#64748b', fontWeight: 400 }}>
                                  ({formatStudentDisplayEmail(sc.email)})
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              className="btn-edit-student-work"
                              onClick={() => {
                                setEditingStudentUid(sc.uid || sc.email);
                                setEditWorkDraft((sc.workCompleted || []).join('\n'));
                                setEditActionDraft((sc.actionItemsNextWeek || []).join('\n'));
                                setEditWeeklyFeedbackDraft(sc.weeklyFeedback || '');
                                setEditLogQualityScoreDraft(
                                  effectiveLogQualityScore !== null && effectiveLogQualityScore !== undefined
                                    ? String(effectiveLogQualityScore)
                                    : ''
                                );
                                setEditRealWorkScoreDraft(
                                  sc.realWorkScore !== null && sc.realWorkScore !== undefined
                                    ? String(sc.realWorkScore)
                                    : ''
                                );
                              }}
                            >
                              ✏️ Edit
                            </button>
                          </div>

                          {/* Log Quality & Verified Real Work Grading Strip */}
                          <div className="student-grading-badges-row">
                            <span className={`log-quality-pill ${logStatusClass}`}>
                              {logStatusClass === 'suspected-ai'
                                ? `🟠 Suspected AI / Unverified Log${effectiveLogQualityScore !== null ? ` (${effectiveLogQualityScore}/10)` : ''}`
                                : logStatusClass === 'vague'
                                ? `🔴 Vague / Useless Log${effectiveLogQualityScore !== null ? ` (${effectiveLogQualityScore}/10)` : ''}`
                                : logStatusClass === 'genuine'
                                ? `🟢 High-Quality Log${effectiveLogQualityScore !== null ? ` (${effectiveLogQualityScore}/10)` : ''}`
                                : `⚪ Log: ${effectiveLogQualityStatus.replace(/_/g, ' ')}`}
                            </span>
                            {sc.realWorkScore !== null && sc.realWorkScore !== undefined && (
                              <span className="real-work-score-pill">
                                🛠️ Real Work: <strong>{sc.realWorkScore}/10</strong>
                              </span>
                            )}
                          </div>

                          {matchingSheetLog && (
                            <div className="submitted-log-reference-box">
                              <strong>📗 Submitted Week {selectedMeeting.weekNumber || 1} Log:</strong>{' '}
                              {matchingSheetLog.isDoingSomething
                                ? `Done: "${matchingSheetLog.workDone}" | Next: "${matchingSheetLog.nextPlan}"`
                                : `Reported "No" work (${matchingSheetLog.inactiveReason || 'no reason'})`}
                            </div>
                          )}


                              <div className="contrib-block">
                                <strong>✅ Work Completed Since Last Meeting:</strong>
                                <ul>
                                  {(sc.workCompleted || []).length === 0 ? (
                                    <li className="muted-li">No completed tasks reported</li>
                                  ) : (
                                    sc.workCompleted.map((w, i) => <li key={i}>{w}</li>)
                                  )}
                                </ul>
                              </div>

                              {(sc.currentChallenges || []).length > 0 && (
                                <div className="contrib-block">
                                  <strong>🚧 Current Challenges:</strong>
                                  <ul>
                                    {sc.currentChallenges.map((c, i) => (
                                      <li key={i}>{c}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              <div className="contrib-block">
                                <strong>🎯 Action Items for Next Week:</strong>
                                <ul>
                                  {(sc.actionItemsNextWeek || []).length === 0 ? (
                                    <li className="muted-li">No action items assigned</li>
                                  ) : (
                                    sc.actionItemsNextWeek.map((a, i) => <li key={i}>{a}</li>)
                                  )}
                                </ul>
                              </div>

                              {effectiveQuestions.length > 0 && (
                                <div className="studio-challenge-questions-box">
                                  <strong>🎯 Challenge / Verification Questions:</strong>
                                  <ul>
                                    {effectiveQuestions.map((q, qIdx) => (
                                      <li key={qIdx}>{q}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}

                              {sc.weeklyFeedback && (
                                <div className="weekly-feedback-banner">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                    <strong>📝 Weekly Student Feedback:</strong>
                                    <button
                                      type="button"
                                      className="btn-timestamp-seek"
                                      onClick={() => {
                                        navigator.clipboard?.writeText(sc.weeklyFeedback);
                                        showToastMessage(`📋 Copied weekly feedback for ${formatStudentDisplayName(sc.name, sc.email)}!`);
                                      }}
                                    >
                                      📋 Copy
                                    </button>
                                  </div>
                                  <div style={{ marginTop: '4px' }}>{sc.weeklyFeedback}</div>
                                </div>
                              )}

                              <div className="ai-contrib-assessment">
                                🤖 <em>{sc.aiContributionAssessment}</em>
                              </div>

                              {(sc.timestamps || []).length > 0 && (
                                <div className="contrib-timestamps-row">
                                  <span>🎧 Jump to turn:</span>
                                  {sc.timestamps.map((ts, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      className="btn-timestamp-seek"
                                      onClick={() => handleSeekToTimestamp(ts)}
                                    >
                                      ▶ [{ts}]
                                    </button>
                                  ))}
                                </div>
                              )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Collapsible Speaker-Diarized Transcript Drawer */}
                  {showTranscriptDrawer && (
                    <div className="diarized-transcript-drawer">
                      <h5>📜 Speaker-Diarized Meeting Transcript</h5>
                      {(selectedMeeting.transcriptSegments || []).length > 0 ? (
                        <div className="transcript-segments-list">
                          {selectedMeeting.transcriptSegments.map((seg, idx) => (
                            <div key={idx} className="transcript-turn-row">
                              <button
                                type="button"
                                className="btn-timestamp-seek"
                                onClick={() => handleSeekToTimestamp(seg.startTime)}
                              >
                                [{seg.startTime}]
                              </button>
                              <strong className="transcript-speaker-name">{seg.speaker}:</strong>
                              <span>{seg.text}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <pre className="raw-diarized-pre">
                          {selectedMeeting.rawDiarizedTranscript || 'No diarized transcript available yet.'}
                        </pre>
                      )}
                    </div>
                  )}

                  {/* Persistent Bottom Dispatch Banner */}
                  <div
                    className="inspector-bottom-dispatch-bar"
                    style={{
                      marginTop: '24px',
                      padding: '16px 20px',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%)',
                      border: '1.5px solid #bfdbfe',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      gap: '14px',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 800, fontSize: '0.98rem', color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        📧 Send Consultation Report &amp; Feedback to Students
                        {selectedMeeting.emailDispatch?.sentAt && (
                          <span style={{ fontSize: '0.74rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                            ✓ Last dispatched {new Date(selectedMeeting.emailDispatch.sentAt).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '3px' }}>
                        Dispatches formatted HTML report with verified attendance, Real Work score, Log Quality score, challenge questions, verified tasks, and supervisor feedback.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        className="btn-bottom-email-report"
                        onClick={() => handleOpenEmailModal(selectedMeeting)}
                        style={{
                          padding: '10px 18px',
                          borderRadius: '8px',
                          background: '#2563eb',
                          color: '#ffffff',
                          border: 'none',
                          fontWeight: 700,
                          fontSize: '0.88rem',
                          cursor: 'pointer',
                          boxShadow: '0 2px 4px rgba(37, 99, 235, 0.25)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        🚀 Email Report to Students
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const md = generateMeetingMarkdownMinutes(selectedMeeting, { privacyMode: isPrivacyMode });
                          navigator.clipboard?.writeText(md);
                          showToastMessage(isPrivacyMode ? '📋 Copied Privacy-Masked Meeting Minutes to clipboard!' : '📋 Copied Markdown Meeting Minutes to clipboard!');
                        }}
                        style={{
                          padding: '10px 14px',
                          borderRadius: '8px',
                          background: '#ffffff',
                          color: '#334155',
                          border: '1px solid #cbd5e1',
                          fontWeight: 600,
                          fontSize: '0.84rem',
                          cursor: 'pointer',
                        }}
                      >
                        📝 Copy Markdown (.md)
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Manage & Batch Import Project Groups Modal */}
      <ProjectGroupEditorModal
        isOpen={showGroupEditorModal}
        onClose={() => setShowGroupEditorModal(false)}
        classId={classId}
        existingGroups={groups}
        enrolledStudents={enrolledStudents}
        studentProfiles={studentProfiles}
        classTeachers={classTeachers}
        currentUserEmail={currentUserEmail}
        currentUserName={currentUserName}
        onSaveGroups={handleSaveProjectGroups}
        isPrivacyMode={isPrivacyMode}
      />

      {/* Batch Gemini Analysis Modal for Selected Week */}
      <NativeModalDialog
        open={showBatchAiModal}
        onClose={() => { if (!batchAnalysisProgress) setShowBatchAiModal(false); }}
        canDismiss={!batchAnalysisProgress}
        ariaLabelledBy="batch-ai-modal-title"
        className="batch-ai-modal-card"
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit' }}>
            <div className="batch-ai-modal-header">
              <h3 id="batch-ai-modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚡ Batch Gemini Analysis — Week {studioWeekNumber}
              </h3>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowBatchAiModal(false)}
                title="Close modal (batch job will continue in background if running)"
              >
                ✕
              </button>
            </div>

            {batchAnalysisProgress ? (
              <div className="batch-ai-modal-body" style={{ textAlign: 'center', padding: '24px 20px', gap: '18px' }}>
                <div>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: '1.15rem', color: '#1e3a8a' }}>
                    Batch Gemini Analysis in Progress (Week {batchAnalysisProgress.weekNumber || studioWeekNumber})
                  </h4>
                  <p style={{ margin: 0, fontSize: '0.9rem', color: '#475569' }}>
                    Mode: <strong>{batchAnalysisProgress.mode === 'missing_only' ? 'Missing Only' : 'All Groups'}</strong> • Processing [<strong>{batchAnalysisProgress.current}</strong> of <strong>{batchAnalysisProgress.total}</strong>]: Group <strong>{batchAnalysisProgress.groupName}</strong>
                  </p>
                </div>

                {/* Live Progress bar */}
                <div style={{ width: '100%', height: '12px', background: '#e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      background: 'linear-gradient(90deg, #3b82f6, #1d4ed8)',
                      transition: 'width 0.4s ease',
                      width: `${Math.max(5, Math.round((batchAnalysisProgress.current / batchAnalysisProgress.total) * 100))}%`,
                    }}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#64748b' }}>
                  <span>🎙️ Audio Transcription &amp; Diarization • Log Quality Grading</span>
                  <span>{Math.round((batchAnalysisProgress.current / batchAnalysisProgress.total) * 100)}% Complete</span>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 14px', fontSize: '0.82rem', color: '#475569', textAlign: 'left', lineHeight: 1.5 }}>
                  💡 <strong>Autonomous Job:</strong> Each meeting takes ~60–90 seconds to transcribe audio, diarize student speakers, verify student Google Form weekly logs, and grade contributions. You can minimize this modal or leave it open; the job runs reliably in the background.
                </div>
              </div>
            ) : (
              <div className="batch-ai-modal-body">
                <p style={{ margin: 0, fontSize: '0.88rem', color: '#475569' }}>
                  Run Two-Stage Gemini Diarization, Attendance attribution, and Weekly Log verification across multiple project groups for <strong>Week {studioWeekNumber}</strong>.
                </p>

                {/* Week Selector directly inside Modal */}
                <div>
                  <label htmlFor="batch-modal-week-select" style={{ display: 'block', fontSize: '0.84rem', fontWeight: 700, color: '#1e293b', marginBottom: '6px' }}>
                    📅 Select Supervision Week:
                  </label>
                  <select
                    id="batch-modal-week-select"
                    value={studioWeekNumber}
                    onChange={(e) => handleSelectWeek(Number(e.target.value))}
                    style={{ width: '100%', padding: '9px 12px', borderRadius: '8px', border: '1.5px solid #cbd5e1', fontSize: '0.9rem', fontWeight: 600, background: '#f8fafc', color: '#0f172a' }}
                  >
                    {batchModalWeekOptions.map((opt) => (
                      <option key={opt.week} value={opt.week}>
                        Week {opt.week}{opt.rangeLabel ? ` (${opt.rangeLabel})` : ''} — {opt.recordedGroupsCount > 0 ? `🎙️ ${opt.recordedGroupsCount} group${opt.recordedGroupsCount === 1 ? '' : 's'} (${opt.pendingGroupsCount > 0 ? `${opt.pendingGroupsCount} pending, ` : ''}${opt.analyzedGroupsCount} analyzed)` : 'No recordings'}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Status Breakdown Box */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>{weekAiStats.recordedGroupsCount}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>🎙️ Groups Recorded</div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>({weekAiStats.validSessionsCount} session{weekAiStats.validSessionsCount === 1 ? '' : 's'})</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#d97706' }}>{weekAiStats.pendingGroupsCount}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>🟡 Missing / Pending</div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>({weekAiStats.pendingSessionsCount} session{weekAiStats.pendingSessionsCount === 1 ? '' : 's'})</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a' }}>{weekAiStats.analyzedGroupsCount}</div>
                    <div style={{ fontSize: '0.75rem', color: '#64748b' }}>✨ Fully Analyzed</div>
                    <div style={{ fontSize: '0.68rem', color: '#16a34a', fontWeight: 600 }}>{weekAiStats.pendingGroupsCount === 0 && weekAiStats.recordedGroupsCount > 0 ? 'All Complete!' : ''}</div>
                  </div>
                </div>

                {/* Empty / 0-byte sessions notice if any */}
                {weekAiStats.emptySessionsCount > 0 && (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '7px 12px', fontSize: '0.76rem', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>ℹ️</span>
                    <span>
                      <strong>{weekAiStats.emptySessionsCount} empty session stub{weekAiStats.emptySessionsCount === 1 ? '' : 's'}</strong> (0 bytes or ≤ 2s) excluded to prevent AI errors.
                    </span>
                  </div>
                )}

                {/* Group Details in Selected Week */}
                {weekAiStats.pendingGroups?.length > 0 && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '10px 12px', fontSize: '0.82rem' }}>
                    <strong style={{ color: '#92400e', display: 'block', marginBottom: '6px' }}>
                      🟡 Groups Pending AI Analysis in Week {studioWeekNumber} ({weekAiStats.pendingGroups.length}):
                    </strong>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {weekAiStats.pendingGroups.map((g) => (
                        <span
                          key={g.groupId}
                          style={{
                            background: '#fef3c7',
                            border: '1px solid #fcd34d',
                            color: '#78350f',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>{g.groupName || g.groupId}</span>
                          <span style={{ fontSize: '0.7rem', color: '#92400e', fontWeight: 500 }}>
                            ({g.totalValidClips > 1 ? `${g.totalValidClips} parts` : '1 part'}
                            {g.totalDurationSeconds > 0 ? ` · ${formatDuration(g.totalDurationSeconds)}` : ''}
                            {g.isPartiallyAnalyzed ? ' · partial' : ''})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {weekAiStats.analyzedGroups?.length > 0 && (
                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px', fontSize: '0.82rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <strong style={{ color: '#166534' }}>
                        ✨ Already Analyzed Groups in Week {studioWeekNumber} ({weekAiStats.analyzedGroups.length}):
                      </strong>
                      {weekAiStats.pendingGroupsCount === 0 && (
                        <span style={{ fontSize: '0.7rem', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', padding: '1px 6px', borderRadius: '10px', fontWeight: 700 }}>
                          ✅ All Done
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {weekAiStats.analyzedGroups.map((g) => (
                        <span
                          key={g.groupId}
                          style={{
                            background: '#dcfce7',
                            border: '1px solid #86efac',
                            color: '#14532d',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            fontWeight: 600,
                            fontSize: '0.78rem',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          <span>{g.groupName || g.groupId}</span>
                          <span style={{ fontSize: '0.7rem', color: '#166534', fontWeight: 500 }}>
                            ({g.totalValidClips > 1 ? `${g.totalValidClips} parts` : '1 part'}
                            {g.totalDurationSeconds > 0 ? ` · ${formatDuration(g.totalDurationSeconds)}` : ''}
                            {g.validMeetingsCount > 1 ? ` · ${g.validMeetingsCount} sessions` : ''})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Model Selection */}
                <div>
                  <label htmlFor="batch-model-select" style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                    🤖 Select Gemini Model:
                  </label>
                  <select
                    id="batch-model-select"
                    value={preferredAiModel}
                    onChange={(e) => setPreferredAiModel(e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                  >
                    <option value="gemini-3.8-flash">⚡ Gemini 3.5 Transcribe + 3.8 Flash (Recommended — Fast &amp; Accurate)</option>
                    <option value="gemini-4-argon">🧠 Gemini 3.5 Transcribe + 4 Argon (Deep Reasoning &amp; Complex Logs)</option>
                    <option value="gemini-3.5-flash-lite">🪶 Gemini 3.5 Transcribe + 3.5 Flash-Lite (Low Cost)</option>
                  </select>
                </div>

                {/* Mode 1 & Mode 2 Options */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ border: '1.5px solid #fed7aa', background: '#fffbeb', borderRadius: '8px', padding: '12px 14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '0.92rem', color: '#9a3412' }}>
                        ⚡ Mode 1: Run Missing Only ({weekAiStats.pendingGroupsCount} group{weekAiStats.pendingGroupsCount === 1 ? '' : 's'})
                      </strong>
                      <span style={{ fontSize: '0.72rem', background: '#f97316', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontWeight: 700 }}>
                        Recommended
                      </span>
                    </div>
                    <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', color: '#7c2d12' }}>
                      Only analyzes groups in Week {studioWeekNumber} that have audio recordings but have not been analyzed yet. Skips already-analyzed groups to save time.
                    </p>
                    <button
                      type="button"
                      className="btn-start-meeting-rec"
                      style={{ width: '100%', background: '#f97316', borderColor: '#ea580c' }}
                      onClick={() => handleBatchAnalyzeWeek('missing_only')}
                      disabled={weekAiStats.pendingGroupsCount === 0 || isAnalyzing || Boolean(batchAnalysisProgress)}
                    >
                      {weekAiStats.recordedGroupsCount === 0
                        ? `⚠️ No Recordings in Week ${studioWeekNumber}`
                        : weekAiStats.pendingGroupsCount === 0
                        ? `✅ All ${weekAiStats.analyzedGroupsCount} Groups in Week ${studioWeekNumber} Already Analyzed`
                        : `⚡ Analyze ${weekAiStats.pendingGroupsCount} Missing Group(s) (${weekAiStats.pendingSessionsCount} session${weekAiStats.pendingSessionsCount === 1 ? '' : 's'})`}
                    </button>
                  </div>

                  <div style={{ border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: '8px', padding: '12px 14px' }}>
                    <strong style={{ display: 'block', fontSize: '0.92rem', color: '#334155', marginBottom: '4px' }}>
                      🔄 Mode 2: Re-Run All ({weekAiStats.recordedGroupsCount} group{weekAiStats.recordedGroupsCount === 1 ? '' : 's'})
                    </strong>
                    <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', color: '#64748b' }}>
                      Re-analyzes all recorded groups in Week {studioWeekNumber} from scratch. Useful if you updated student weekly logs or want to switch models.
                    </p>
                    <button
                      type="button"
                      className="btn-pause-meeting-rec"
                      style={{ width: '100%' }}
                      onClick={() => handleBatchAnalyzeWeek('all')}
                      disabled={weekAiStats.recordedGroupsCount === 0 || isAnalyzing || Boolean(batchAnalysisProgress)}
                    >
                      {weekAiStats.recordedGroupsCount === 0
                        ? `⚠️ No Recordings in Week ${studioWeekNumber}`
                        : `🔄 Re-Analyze All ${weekAiStats.recordedGroupsCount} Group(s) in Week ${studioWeekNumber} (${weekAiStats.validSessionsCount} session${weekAiStats.validSessionsCount === 1 ? '' : 's'})`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="batch-ai-modal-footer" style={{ display: 'flex', justifyContent: batchAnalysisProgress ? 'space-between' : 'flex-end', alignItems: 'center' }}>
              {batchAnalysisProgress ? (
                <>
                  <button
                    type="button"
                    className="btn-cancel-batch-analysis"
                    style={{ padding: '8px 16px', fontSize: '0.86rem' }}
                    onClick={() => {
                      cancelBatchAnalysisRef.current = true;
                    }}
                  >
                    ⏹️ Stop Batch Job
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    style={{ padding: '8px 16px', fontSize: '0.86rem' }}
                    onClick={() => setShowBatchAiModal(false)}
                  >
                    Run in Background (Minimize)
                  </button>
                </>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setShowBatchAiModal(false);
                      handleOpenWeekBatchEmailModal(studioWeekNumber);
                    }}
                    style={{
                      background: '#f0fdf4',
                      color: '#15803d',
                      border: '1px solid #86efac',
                      borderRadius: '6px',
                      padding: '8px 14px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    📧 Email Reports to Whole Class (Week {studioWeekNumber})
                  </button>
                  <button
                    type="button"
                    className="btn-modal-cancel"
                    onClick={() => setShowBatchAiModal(false)}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
        </div>
      </NativeModalDialog>

      {/* Edit Student Record & Feedback Modal */}
      <NativeModalDialog
        open={Boolean(editingStudentContrib)}
        onClose={() => setEditingStudentUid(null)}
        ariaLabelledBy="student-edit-modal-title"
        className="student-edit-modal-card"
      >
        {editingStudentContrib && (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit' }}>
            <div className="student-edit-modal-header">
              <div>
                <h3 id="student-edit-modal-title" style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ✏️ Edit Student Contribution &amp; Feedback
                </h3>
                <div style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  <strong>👤 {editingStudentContrib.name || editingStudentContrib.email}</strong> • {selectedMeeting?.groupName || 'Group'} — Week {selectedMeeting?.weekNumber || 1}
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setEditingStudentUid(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="student-edit-modal-body">
              {/* Reference box: Google Form Submitted Log + AI Quality Status */}
              {editingMatchingSheetLog && (
                <div className="student-edit-ref-box">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                    <span style={{ fontWeight: 700 }}>📗 Submitted Week {selectedMeeting?.weekNumber || 1} Google Form Log:</span>
                    <span className={`log-quality-pill ${editingLogStatusClass}`}>
                      {editingLogStatusClass === 'suspected-ai'
                        ? '🟠 Suspected AI / Unverified Log'
                        : editingLogStatusClass === 'vague'
                        ? '🔴 Vague / Useless Log'
                        : editingLogStatusClass === 'genuine'
                        ? '🟢 High-Quality Log'
                        : '⚪ Submitted'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.82rem', color: '#1e293b', marginTop: '6px' }}>
                    {editingMatchingSheetLog.isDoingSomething ? (
                      <>
                        <div><strong>Done:</strong> "{editingMatchingSheetLog.workDone}"</div>
                        <div style={{ marginTop: '2px' }}><strong>Next:</strong> "{editingMatchingSheetLog.nextPlan}"</div>
                      </>
                    ) : (
                      <div>Reported "No" work ({editingMatchingSheetLog.inactiveReason || 'no reason'})</div>
                    )}
                  </div>
                  {Array.isArray(editingMatchingSheetLog.suggestedChallengeQuestions) && editingMatchingSheetLog.suggestedChallengeQuestions.length > 0 && (
                    <div style={{ marginTop: '6px', fontSize: '0.8rem', color: '#581c87', background: '#faf5ff', padding: '6px 10px', borderRadius: '6px' }}>
                      <strong>🎯 AI Suggested Challenge Questions:</strong>
                      <ul style={{ margin: '2px 0 0', paddingLeft: '18px' }}>
                        {editingMatchingSheetLog.suggestedChallengeQuestions.map((q, idx) => (
                          <li key={idx}>{q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Two Grading Scores */}
              <div className="student-edit-scores-grid">
                <div className="student-edit-field">
                  <label htmlFor="edit-log-quality-score">📗 Log Quality Score (/10):</label>
                  <input
                    id="edit-log-quality-score"
                    aria-label="📗 Log Quality Score (/10):"
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={editLogQualityScoreDraft}
                    onChange={(e) => setEditLogQualityScoreDraft(e.target.value)}
                    placeholder="e.g. 8.5"
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Evaluates completeness, technical detail, and genuineness of weekly log.
                  </span>
                </div>

                <div className="student-edit-field">
                  <label htmlFor="edit-real-work-score">🛠️ Real Work Score (/10):</label>
                  <input
                    id="edit-real-work-score"
                    aria-label="🛠️ Real Work Score (/10):"
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={editRealWorkScoreDraft}
                    onChange={(e) => setEditRealWorkScoreDraft(e.target.value)}
                    placeholder="e.g. 9.0"
                  />
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                    Evaluates verified technical output and code demonstrated in meeting.
                  </span>
                </div>
              </div>

              {/* Textareas */}
              <div className="student-edit-field">
                <label htmlFor="edit-work-completed">✅ Work Completed Since Last Meeting (1 item per line):</label>
                <textarea
                  id="edit-work-completed"
                  rows={4}
                  value={editWorkDraft}
                  onChange={(e) => setEditWorkDraft(e.target.value)}
                  placeholder="Implemented user authentication&#10;Added Firestore integration"
                />
              </div>

              <div className="student-edit-field">
                <label htmlFor="edit-action-items">🎯 Action Items for Next Week (1 item per line):</label>
                <textarea
                  id="edit-action-items"
                  rows={4}
                  value={editActionDraft}
                  onChange={(e) => setEditActionDraft(e.target.value)}
                  placeholder="Write unit tests for authentication&#10;Connect live camera API"
                />
              </div>

              <div className="student-edit-field">
                <label htmlFor="edit-weekly-feedback">💬 Constructive Weekly Feedback for Student:</label>
                <textarea
                  id="edit-weekly-feedback"
                  rows={4}
                  value={editWeeklyFeedbackDraft}
                  onChange={(e) => setEditWeeklyFeedbackDraft(e.target.value)}
                  placeholder="Constructive weekly feedback on technical progress and log quality..."
                />
              </div>
            </div>

            <div className="student-edit-modal-footer">
              <button
                type="button"
                className="btn-cancel-edit"
                onClick={() => setEditingStudentUid(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-save-student-work"
                onClick={() => handleSaveStudentContributionEdit(editingStudentUid)}
              >
                💾 Save Student Record &amp; Feedback
              </button>
            </div>
          </div>
        )}
      </NativeModalDialog>

      {/* Email Report Modal */}
      <NativeModalDialog
        open={Boolean(showEmailReportModal && emailReportTargetMeeting)}
        onClose={() => { if (!isSendingEmail) setShowEmailReportModal(false); }}
        canDismiss={!isSendingEmail}
        ariaLabelledBy="email-report-modal-title"
        className="student-edit-modal-card"
        style={{ maxWidth: '580px' }}
      >
        {showEmailReportModal && emailReportTargetMeeting && (
          <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit' }}>
            <div className="student-edit-modal-header">
              <div>
                <h3
                  id="email-report-modal-title"
                  style={{
                    margin: 0,
                    fontSize: '1.15rem',
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  📧 Email Supervision Minutes &amp; Feedback
                </h3>
                <div style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  <strong>Week {emailReportTargetMeeting.weekNumber || 1}:</strong> {emailReportTargetMeeting.title || 'Supervision Meeting'} • {groups.find((g) => g.id === emailReportTargetMeeting.groupId)?.name || 'Project Group'}
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => !isSendingEmail && setShowEmailReportModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="student-edit-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.88rem' }}>
                <p style={{ margin: '0 0 6px', color: '#334155' }}>
                  Each student will receive a formatted email with their <strong>attendance status</strong>, <strong>supervisor scores</strong>, <strong>personalized feedback quote</strong>, <strong>challenge questions</strong>, and <strong>next week action items</strong>.
                </p>
                {emailReportTargetMeeting.emailDispatch?.lastEmailedAt && (
                  <div style={{ marginTop: '8px', padding: '6px 10px', background: '#dcfce7', color: '#15803d', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                    ✓ Previously emailed: {new Date(emailReportTargetMeeting.emailDispatch.lastEmailedAt).toLocaleDateString()} to {emailReportTargetMeeting.emailDispatch.recipients?.join(', ')}
                  </div>
                )}
              </div>

              {/* Recipient Selection */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <label style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', margin: 0 }}>
                    Select Recipients ({emailRecipientUids.length}):
                  </label>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const grp = groups.find((g) => g.id === emailReportTargetMeeting.groupId) || activeStudioGroup;
                        const allIds = (grp?.members || []).map((m) => m.uid || m.email);
                        setEmailRecipientUids(allIds);
                      }}
                      disabled={isSendingEmail}
                      style={{
                        padding: '2px 8px',
                        fontSize: '0.75rem',
                        background: '#f1f5f9',
                        color: '#0f172a',
                        border: '1px solid #cbd5e1',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      ☑️ Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setEmailRecipientUids([])}
                      disabled={isSendingEmail}
                      style={{
                        padding: '2px 8px',
                        fontSize: '0.75rem',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: '1px solid #fecaca',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      ✕ Deselect All
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                  {(groups.find((g) => g.id === emailReportTargetMeeting.groupId)?.members || []).map((m) => {
                    const id = m.uid || m.email;
                    const isChecked = emailRecipientUids.includes(id);
                    return (
                      <label key={id} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', cursor: 'pointer', color: '#1e293b' }}>
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleEmailRecipient(id)}
                          disabled={isSendingEmail}
                        />
                        <span>
                          <strong>{formatStudentDisplayName(m.name, m.email)}</strong>{' '}
                          <span style={{ color: '#64748b', fontSize: '0.8rem' }}>({formatStudentDisplayEmail(m.email)})</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Status messages */}
              {emailErrorMessage && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', lineHeight: 1.4 }}>
                  {emailErrorMessage}
                </div>
              )}

              {emailSuccessMessage && (
                <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
                  {emailSuccessMessage}
                </div>
              )}

              {/* Fallback & Copy Bar */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={handleOpenMailtoDraft}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Open a pre-filled draft in your desktop Outlook / Gmail client"
                >
                  📨 Open in Mail Client (Outlook / Mailto)
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const md = generateMeetingMarkdownMinutes(emailReportTargetMeeting);
                    navigator.clipboard?.writeText(md);
                    showToastMessage('📋 Copied Markdown minutes to clipboard!');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  📋 Copy Text
                </button>
              </div>
            </div>

            <div className="student-edit-modal-footer">
              <button
                type="button"
                className="btn-cancel-edit"
                onClick={() => setShowEmailReportModal(false)}
                disabled={isSendingEmail}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-save-student-work"
                onClick={handleSendBackendEmail}
                disabled={isSendingEmail || emailRecipientUids.length === 0}
                style={{
                  background: isSendingEmail ? '#94a3b8' : '#2563eb',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isSendingEmail ? '⏳ Sending Email Report...' : '🚀 Send Email Report (SMTP)'}
              </button>
            </div>
          </div>
        )}
      </NativeModalDialog>

      {/* Whole-Class Weekly Meeting Reports Batch Email Modal */}
      <NativeModalDialog
        open={showWeekBatchEmailModal}
        onClose={() => { if (!isBatchSendingEmails) setShowWeekBatchEmailModal(false); }}
        canDismiss={!isBatchSendingEmails}
        ariaLabelledBy="batch-email-modal-title"
        className="student-edit-modal-card"
        style={{ maxWidth: '680px', maxHeight: '90vh' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit' }}>
            <div className="student-edit-modal-header">
              <div>
                <h3
                  id="batch-email-modal-title"
                  style={{
                    margin: 0,
                    fontSize: '1.2rem',
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                >
                  📧 Email Weekly Reports to Whole Class (Week {batchEmailWeekNumber})
                </h3>
                <div style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  Dispatch consultation minutes, attendance, supervisor scores, and personalized feedback to all project groups for Week {batchEmailWeekNumber}.
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => !isBatchSendingEmails && setShowWeekBatchEmailModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div
              className="student-edit-modal-body"
              style={{ display: 'flex', flexDirection: 'column', gap: '14px', overflowY: 'auto' }}
            >
              {/* Target Week Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <label htmlFor="batch-email-week-select" style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b' }}>
                  📅 Select Academic Week:
                </label>
                <select
                  id="batch-email-week-select"
                  value={batchEmailWeekNumber}
                  onChange={(e) => handleOpenWeekBatchEmailModal(Number(e.target.value))}
                  disabled={isBatchSendingEmails}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.88rem',
                    fontWeight: 600,
                  }}
                >
                  {Array.from({ length: totalProjectWeeks }, (_, i) => i + 1).map((wk) => (
                    <option key={wk} value={wk}>
                      Week {wk}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: '0.82rem', color: '#64748b' }}>
                  ({meetings.filter((m) => Number(m.weekNumber) === Number(batchEmailWeekNumber)).length} session(s) recorded in this week)
                </span>
              </div>

              {/* Group Selection Controls & Summary */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap', gap: '8px' }}>
                  <label style={{ fontWeight: 700, fontSize: '0.88rem', color: '#0f172a', margin: 0 }}>
                    Select Groups to Email ({batchEmailSelectedMeetingIds.length} of {meetings.filter((m) => Number(m.weekNumber) === Number(batchEmailWeekNumber)).length} selected):
                  </label>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => handleSelectAllBatchMeetings(false)}
                      disabled={isBatchSendingEmails}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.8rem',
                        background: '#f1f5f9',
                        color: '#0f172a',
                        border: '1.5px solid #cbd5e1',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ☑️ Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectAllBatchMeetings(true)}
                      disabled={isBatchSendingEmails}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.8rem',
                        background: '#f0fdf4',
                        color: '#15803d',
                        border: '1.5px solid #86efac',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ✓ Only Analyzed
                    </button>
                    <button
                      type="button"
                      onClick={() => setBatchEmailSelectedMeetingIds([])}
                      disabled={isBatchSendingEmails}
                      style={{
                        padding: '3px 10px',
                        fontSize: '0.8rem',
                        background: '#fef2f2',
                        color: '#b91c1c',
                        border: '1.5px solid #fecaca',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ✕ Deselect All
                    </button>
                  </div>
                </div>

                {/* Groups Checklist */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    padding: '8px',
                    background: '#ffffff',
                  }}
                >
                  {meetings.filter((m) => Number(m.weekNumber) === Number(batchEmailWeekNumber)).length === 0 ? (
                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                      No meeting sessions found for Week {batchEmailWeekNumber}. Please record or add meetings first.
                    </div>
                  ) : (
                    meetings
                      .filter((m) => Number(m.weekNumber) === Number(batchEmailWeekNumber))
                      .map((mtg) => {
                        const grp = groups.find((g) => g.id === mtg.groupId);
                        const isChecked = batchEmailSelectedMeetingIds.includes(mtg.id);
                        const isAnalyzed = mtg.status === 'ready' || Boolean(mtg.analyzedAt || mtg.rawDiarizedTranscript);
                        const memberCount = (grp?.members || []).length || (mtg.attendanceRecord || []).length || 0;

                        return (
                          <div
                            key={mtg.id}
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              padding: '8px 10px',
                              borderRadius: '6px',
                              background: isChecked ? '#f0fdf4' : '#f8fafc',
                              border: isChecked ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                            }}
                          >
                            <label
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                cursor: 'pointer',
                                margin: 0,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => handleToggleBatchEmailMeeting(mtg.id)}
                                  disabled={isBatchSendingEmails}
                                />
                                <div>
                                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#0f172a' }}>
                                    {grp?.name || mtg.groupName || 'Project Group'}
                                    {grp?.projectTopic && (
                                      <span style={{ fontWeight: 400, color: '#64748b', marginLeft: '6px' }}>
                                        ({grp.projectTopic})
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                    👥 {memberCount} member(s)
                                    {mtg.emailDispatch?.lastEmailedAt && (
                                      <span style={{ marginLeft: '8px', color: '#15803d', fontWeight: 600 }}>
                                        ✓ Emailed {new Date(mtg.emailDispatch.lastEmailedAt).toLocaleDateString()}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setBatchPreviewMeetingId((prev) => (prev === mtg.id ? null : mtg.id));
                                  }}
                                  style={{
                                    padding: '2px 8px',
                                    fontSize: '0.72rem',
                                    background: batchPreviewMeetingId === mtg.id ? '#2563eb' : '#eff6ff',
                                    color: batchPreviewMeetingId === mtg.id ? '#ffffff' : '#1d4ed8',
                                    border: '1px solid #bfdbfe',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '2px',
                                  }}
                                  title="View and preview this meeting session's report & feedback"
                                >
                                  👁️ {batchPreviewMeetingId === mtg.id ? 'Hide' : 'View'}
                                </button>
                                {isAnalyzed ? (
                                  <span style={{ fontSize: '0.72rem', background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                    ✓ Analyzed
                                  </span>
                                ) : (
                                  <span style={{ fontSize: '0.72rem', background: '#fef3c7', color: '#b45309', padding: '2px 8px', borderRadius: '4px', fontWeight: 600 }}>
                                    ⚠️ Unanalyzed
                                  </span>
                                )}
                              </div>
                            </label>

                            {/* Inline Report Preview */}
                            {batchPreviewMeetingId === mtg.id && (
                              <div
                                style={{
                                  marginTop: '8px',
                                  padding: '10px 12px',
                                  background: '#ffffff',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '6px',
                                  fontSize: '0.8rem',
                                  color: '#1e293b',
                                  cursor: 'default',
                                }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', borderBottom: '1px solid #f1f5f9', paddingBottom: '4px' }}>
                                  <strong>📋 Report Preview: {mtg.title || 'Supervision Meeting'}</strong>
                                  <span style={{ color: '#64748b' }}>📅 {mtg.meetingDate ? new Date(mtg.meetingDate).toLocaleDateString() : 'Recent'}</span>
                                </div>

                                {mtg.summary && (
                                  <div style={{ marginBottom: '6px', color: '#334155' }}>
                                    <strong>Summary:</strong> {mtg.summary}
                                  </div>
                                )}

                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '6px' }}>
                                  <div style={{ fontWeight: 700, color: '#475569', fontSize: '0.76rem' }}>👥 Students &amp; Evaluations:</div>
                                  {(mtg.attendanceRecord || (grp?.members || [])).map((att) => {
                                    const studentUid = att.uid || att.email;
                                    const contrib = (mtg.studentContributions || {})[studentUid] || {};
                                    return (
                                      <div key={studentUid} style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: '4px 8px', borderRadius: '4px', fontSize: '0.78rem' }}>
                                        <span><strong>{formatStudentDisplayName(att.name, att.email)}</strong> ({att.status || 'present'})</span>
                                        <span>
                                          Real Work: <strong>{contrib.realWorkScore ?? '-'}</strong>/10 • Log Quality: <strong>{contrib.logQualityScore ?? '-'}</strong>/10
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>

                                {mtg.groupSupervisorFeedback && (
                                  <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '6px 8px', borderRadius: '4px', color: '#166534', marginTop: '4px' }}>
                                    <strong>👨‍🏫 Group Feedback:</strong> {mtg.groupSupervisorFeedback}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                  )}
                </div>

                {visibleGroups.filter((g) => !meetings.some((m) => m.groupId === g.id && Number(m.weekNumber) === Number(batchEmailWeekNumber))).length > 0 && (
                  <div style={{ fontSize: '0.78rem', color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '6px 10px', marginTop: '6px' }}>
                    ℹ️ <strong>Unrecorded Groups:</strong> {visibleGroups.filter((g) => !meetings.some((m) => m.groupId === g.id && Number(m.weekNumber) === Number(batchEmailWeekNumber))).length} group(s) have no session for Week {batchEmailWeekNumber} yet ({visibleGroups.filter((g) => !meetings.some((m) => m.groupId === g.id && Number(m.weekNumber) === Number(batchEmailWeekNumber))).map((g) => g.name).join(', ')}). Only recorded sessions can be dispatched.
                  </div>
                )}
              </div>

              {/* Optional Overarching Supervisor Note */}
              <div>
                <label htmlFor="batch-email-note" style={{ display: 'block', fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', marginBottom: '4px' }}>
                  👨‍🏫 Overarching Supervisor Note for Week {batchEmailWeekNumber} (Optional):
                </label>
                <textarea
                  id="batch-email-note"
                  rows={2}
                  value={batchEmailCustomNote}
                  onChange={(e) => setBatchEmailCustomNote(e.target.value)}
                  placeholder="e.g. Great progress in this sprint review. Reminder: Milestone 2 presentation slides are due next Tuesday by 23:59..."
                  disabled={isBatchSendingEmails}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                  }}
                />
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '2px' }}>
                  This note will be prominently highlighted in green at the top of every student's meeting email.
                </div>
              </div>

              {/* Live Progress Bar during dispatch */}
              {isBatchSendingEmails && (
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', fontWeight: 700, color: '#1d4ed8', marginBottom: '6px' }}>
                    <span>Sending Reports [{batchEmailProgress.current} of {batchEmailProgress.total}]...</span>
                    <span>{batchEmailProgress.groupName}</span>
                  </div>
                  <div style={{ width: '100%', height: '8px', background: '#dbeafe', borderRadius: '4px', overflow: 'hidden' }}>
                    <div
                      style={{
                        height: '100%',
                        background: '#2563eb',
                        transition: 'width 0.3s ease',
                        width: `${batchEmailProgress.total ? (batchEmailProgress.current / batchEmailProgress.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Real-time Dispatch Results Log */}
              {batchEmailResultsLog.length > 0 && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '8px 12px', background: '#f8fafc', maxHeight: '140px', overflowY: 'auto' }}>
                  <div style={{ fontWeight: 700, fontSize: '0.8rem', color: '#475569', marginBottom: '4px' }}>
                    📋 Dispatch Log ({batchEmailResultsLog.length} processed):
                  </div>
                  {batchEmailResultsLog.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      style={{
                        fontSize: '0.8rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '2px 0',
                        color: item.status === 'success' ? '#15803d' : '#b91c1c',
                      }}
                    >
                      <span><strong>{item.groupName}:</strong> {item.message}</span>
                      <span>{item.status === 'success' ? '✓' : '❌'}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Status alerts */}
              {batchEmailErrorMessage && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem' }}>
                  {batchEmailErrorMessage}
                </div>
              )}

              {batchEmailSuccessMessage && (
                <div style={{ background: '#dcfce7', border: '1px solid #bbf7d0', color: '#15803d', padding: '10px 12px', borderRadius: '8px', fontSize: '0.85rem', fontWeight: 600 }}>
                  {batchEmailSuccessMessage}
                </div>
              )}

              {/* Client Fallback & Copy Bar */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
                <button
                  type="button"
                  onClick={handleOpenWeekMailtoDraft}
                  disabled={isBatchSendingEmails || batchEmailSelectedMeetingIds.length === 0}
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Open mailto draft pre-populated with all student emails for selected groups"
                >
                  📨 Open Whole-Class Draft (Mail Client)
                </button>

                <button
                  type="button"
                  onClick={handleCopyWeekStudentEmails}
                  disabled={isBatchSendingEmails || batchEmailSelectedMeetingIds.length === 0}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#2563eb',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  📋 Copy All Student Emails (Week {batchEmailWeekNumber})
                </button>
              </div>
            </div>

            <div className="student-edit-modal-footer">
              <button
                type="button"
                className="btn-cancel-edit"
                onClick={() => setShowWeekBatchEmailModal(false)}
                disabled={isBatchSendingEmails}
              >
                Close
              </button>
              <button
                type="button"
                className="btn-send-week-batch-emails"
                onClick={handleSendWeekBatchEmails}
                disabled={isBatchSendingEmails || batchEmailSelectedMeetingIds.length === 0}
                style={{
                  background: isBatchSendingEmails ? '#94a3b8' : '#15803d',
                  border: '1px solid #166534',
                  color: '#ffffff',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  fontWeight: 700,
                  fontSize: '0.88rem',
                  cursor: isBatchSendingEmails || batchEmailSelectedMeetingIds.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {isBatchSendingEmails
                  ? `⏳ Sending [${batchEmailProgress.current}/${batchEmailProgress.total}]...`
                  : `🚀 Send Reports to Selected (${batchEmailSelectedMeetingIds.length} Groups)`}
              </button>
            </div>
        </div>
      </NativeModalDialog>

      {/* Photo Lightbox Modal */}
      <NativeModalDialog
        open={Boolean(previewPhoto)}
        onClose={() => setPreviewPhoto(null)}
        ariaLabel={previewPhoto?.label || 'Meeting Photo Preview'}
        className="photo-lightbox-modal"
        style={{
          maxWidth: '920px',
          width: '95%',
          background: '#0f172a',
          color: '#ffffff',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
        }}
      >
        {previewPhoto && (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
              <div>
                <strong style={{ fontSize: '0.98rem' }}>{previewPhoto.label || 'Meeting Photo'}</strong>
                {previewPhoto.studentName && (
                  <span style={{ marginLeft: '8px', fontSize: '0.78rem', color: '#93c5fd', background: '#1e3a8a', padding: '2px 8px', borderRadius: '4px' }}>
                    👤 {previewPhoto.studentName}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPreviewPhoto(null)}
                aria-label="Close photo preview"
                style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ padding: '12px', display: 'flex', justifyContent: 'center', alignItems: 'center', background: '#020617', maxHeight: '70vh', overflow: 'hidden' }}>
              <img
                src={previewPhoto.downloadUrl}
                alt={previewPhoto.label || 'Preview'}
                style={{ maxWidth: '100%', maxHeight: '68vh', objectFit: 'contain', borderRadius: '6px' }}
              />
            </div>
            {(previewPhoto.caption || previewPhoto.takenAt) && (
              <div style={{ padding: '10px 16px', background: '#1e293b', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <span style={{ fontSize: '0.84rem', color: '#e2e8f0' }}>
                  {previewPhoto.caption ? `📝 ${previewPhoto.caption}` : 'No caption'}
                </span>
                <span style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                  📅 {previewPhoto.takenAt ? new Date(previewPhoto.takenAt).toLocaleString() : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </NativeModalDialog>

      {/* Photo Capture & Upload Modal */}
      <NativeModalDialog
        open={isPhotoModalOpen}
        onClose={() => { if (!isUploadingPhoto) setIsPhotoModalOpen(false); }}
        canDismiss={!isUploadingPhoto}
        ariaLabel="Snap Meeting Photo"
        className="modal-card"
        style={{ maxWidth: '480px', width: '92%', borderRadius: '12px', padding: '20px' }}
      >
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              📸 Snap Meeting Photo / Artifact
            </h3>
            <button
              type="button"
              onClick={() => !isUploadingPhoto && setIsPhotoModalOpen(false)}
              disabled={isUploadingPhoto}
              aria-label="Close photo capture modal"
              style={{ background: 'none', border: 'none', fontSize: '1.1rem', cursor: 'pointer', color: '#64748b' }}
            >
              ✕
            </button>
          </div>

            <p style={{ margin: '0 0 12px 0', fontSize: '0.82rem', color: '#64748b' }}>
              Take or upload a photo of whiteboards, hardware wiring, or code. Gemini will inspect it alongside the consultation transcript to verify student contributions.
            </p>

            {/* Member Attribution Selector */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Attributed Student Member:
              </label>
              <select
                value={photoStudentUid}
                onChange={(e) => setPhotoStudentUid(e.target.value)}
                disabled={isUploadingPhoto}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
              >
                <option value="">👥 Whole Group / General Evidence</option>
                {(activeStudioGroup?.members || []).map((m) => (
                  <option key={m.uid || m.email} value={m.uid || m.email}>
                    👤 {formatStudentDisplayName(m.name, m.email)}
                  </option>
                ))}
              </select>
            </div>

            {/* Preset Label Chips */}
            <div style={{ marginBottom: '12px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                Artifact Category:
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {[
                  'Whiteboard / Architecture',
                  'IoT / Hardware Wiring',
                  'Laptop Code / Terminal',
                  'UI / Mobile Screen',
                  'Project Poster / Chart',
                ].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setPhotoLabelPreset(preset)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: photoLabelPreset === preset ? '1.5px solid #7c3aed' : '1px solid #cbd5e1',
                      background: photoLabelPreset === preset ? '#f3e8ff' : '#f8fafc',
                      color: photoLabelPreset === preset ? '#6b21a8' : '#334155',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Optional Caption */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '4px' }}>
                Optional Caption / Note:
              </label>
              <input
                type="text"
                placeholder="e.g. Drafted database ERD with 5 collections..."
                value={photoCaption}
                onChange={(e) => setPhotoCaption(e.target.value)}
                disabled={isUploadingPhoto}
                style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.84rem' }}
              />
            </div>

            {/* Action Buttons */}
            {isUploadingPhoto ? (
              <div style={{ textAlign: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px', color: '#2563eb', fontWeight: 600, fontSize: '0.88rem' }}>
                ☁️ Compressing (1280px) &amp; Uploading Photo...
              </div>
            ) : (
              <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                <button
                  type="button"
                  className="btn-camera-snap-modal"
                  onClick={() => photoInputRef.current?.click()}
                  style={{
                    padding: '10px 16px',
                    borderRadius: '8px',
                    background: '#8b5cf6',
                    border: '1.5px solid #7c3aed',
                    color: '#ffffff',
                    fontSize: '0.92rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 2px 4px rgba(139, 92, 246, 0.3)',
                  }}
                >
                  📸 Open Camera &amp; Snap Photo
                </button>
                <button
                  type="button"
                  className="btn-gallery-upload-modal"
                  onClick={() => photoGalleryInputRef.current?.click()}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '8px',
                    background: '#f1f5f9',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                    fontSize: '0.84rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  🖼️ Upload from Photo Gallery / Files
                </button>
              </div>
            )}
        </div>
      </NativeModalDialog>

      {/* 720p Mobile Video Demo Recording Viewfinder Modal */}
      <NativeModalDialog
        open={isVideoRecordingOpen}
        onClose={() => { if (videoRecordingState !== 'uploading') handleCloseVideoRecorder(); }}
        canDismiss={videoRecordingState !== 'uploading'}
        ariaLabel="Mobile Demo Video Recorder"
        className="video-recorder-drawer"
        style={{
          maxWidth: '680px',
          width: '95%',
          background: '#0f172a',
          color: '#ffffff',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#1e293b', borderBottom: '1px solid #334155' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.1rem' }}>📹</span>
                <strong style={{ fontSize: '0.94rem' }}>Mobile Demo Video (720p)</strong>
                <span style={{ fontSize: '0.72rem', background: '#15803d', color: '#ffffff', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                  720p @ 24/30 FPS
                </span>
              </div>
              <button
                type="button"
                onClick={handleCloseVideoRecorder}
                disabled={videoRecordingState === 'uploading'}
                style={{ background: 'none', border: 'none', color: '#cbd5e1', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {/* Presenter Selector & Title Input (Visible before recording) */}
            {videoRecordingState === 'preview' && (
              <div style={{ padding: '10px 16px', background: '#1e293b', borderBottom: '1px solid #334155', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: '#94a3b8', marginBottom: '3px' }}>
                    Presenter / Demonstrator:
                  </label>
                  <select
                    value={videoPresenterUid}
                    onChange={(e) => setVideoPresenterUid(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', background: '#334155', color: '#ffffff', border: '1px solid #475569', fontSize: '0.8rem' }}
                  >
                    <option value="">👥 Whole Group</option>
                    {(activeStudioGroup?.members || []).map((m) => (
                      <option key={m.uid || m.email} value={m.uid || m.email}>
                        👤 {formatStudentDisplayName(m.name, m.email)}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <label style={{ display: 'block', fontSize: '0.74rem', color: '#94a3b8', marginBottom: '3px' }}>
                    Demo Topic / Title:
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. IoT Sensor Breadboard Demo"
                    value={videoLabelDraft}
                    onChange={(e) => setVideoLabelDraft(e.target.value)}
                    style={{ width: '100%', padding: '5px 8px', borderRadius: '6px', background: '#334155', color: '#ffffff', border: '1px solid #475569', fontSize: '0.8rem' }}
                  />
                </div>
              </div>
            )}

            {/* Viewfinder Video Stream Container */}
            <div style={{ position: 'relative', width: '100%', background: '#020617', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '320px', maxHeight: '55vh', overflow: 'hidden' }}>
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', maxHeight: '55vh', objectFit: 'contain' }}
              />

              {/* Viewfinder Overlays */}
              <div style={{ position: 'absolute', top: '10px', left: '10px', display: 'flex', gap: '6px', alignItems: 'center' }}>
                {videoRecordingState === 'recording' ? (
                  <span style={{ background: '#dc2626', color: '#ffffff', fontSize: '0.78rem', fontWeight: 800, padding: '3px 8px', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '4px', boxShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
                    🔴 REC {formatDuration(videoRecordingSeconds)}
                  </span>
                ) : (
                  <span style={{ background: 'rgba(0,0,0,0.6)', color: '#cbd5e1', fontSize: '0.74rem', padding: '2px 6px', borderRadius: '4px' }}>
                    📷 720p Viewfinder ({videoCameraFacing === 'environment' ? 'Rear' : 'Front'})
                  </span>
                )}
              </div>

              <div style={{ position: 'absolute', top: '10px', right: '10px' }}>
                <button
                  type="button"
                  onClick={handleFlipVideoCamera}
                  disabled={videoRecordingState === 'uploading'}
                  style={{
                    background: 'rgba(15, 23, 42, 0.75)',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    color: '#ffffff',
                    padding: '4px 10px',
                    borderRadius: '6px',
                    fontSize: '0.76rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title="Switch between rear and front cameras"
                >
                  🔄 Flip Camera
                </button>
              </div>

              {videoRecordingState === 'uploading' && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(15, 23, 42, 0.85)', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.5rem' }}>☁️</span>
                  <span style={{ fontSize: '0.94rem', fontWeight: 700, color: '#ffffff' }}>
                    Uploading 720p Demo Video ({uploadProgress}%)...
                  </span>
                  <span style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                    Optimized 1.5 Mbps bitrate (~11 MB/min)
                  </span>
                </div>
              )}
            </div>

            {/* Footer Recording Controls */}
            <div style={{ padding: '12px 16px', background: '#1e293b', borderTop: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                {videoRecordingState === 'recording'
                  ? '💡 Speak naturally — audio dialogue is transcribed into meeting minutes.'
                  : '💡 Standard 720p HD keeps upload fast (~11 MB/min) and saves phone battery.'}
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                {videoRecordingState === 'preview' && (
                  <button
                    type="button"
                    className="btn-start-720p-video-rec"
                    onClick={handleStart720pVideoRecording}
                    style={{
                      background: '#dc2626',
                      border: '1.5px solid #b91c1c',
                      color: '#ffffff',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 6px rgba(220, 38, 38, 0.4)',
                    }}
                  >
                    🔴 Start 720p Recording
                  </button>
                )}

                {videoRecordingState === 'recording' && (
                  <button
                    type="button"
                    className="btn-stop-720p-video-rec"
                    onClick={handleStopAndSave720pVideo}
                    style={{
                      background: '#15803d',
                      border: '1.5px solid #166534',
                      color: '#ffffff',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 2px 6px rgba(21, 128, 61, 0.4)',
                    }}
                  >
                    ⏹️ Finish &amp; Save Demo Video
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleCloseVideoRecorder}
                  disabled={videoRecordingState === 'uploading'}
                  style={{
                    background: '#334155',
                    border: '1px solid #475569',
                    color: '#cbd5e1',
                    padding: '8px 14px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
        </div>
      </NativeModalDialog>

      {/* Mobile-First Quick Group Picker Modal / Bottom Sheet */}
      <NativeModalDialog
        open={showGroupPickerModal}
        onClose={() => setShowGroupPickerModal(false)}
        ariaLabel="Select Project Group"
        className="group-picker-modal-sheet"
      >
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'inherit', overflow: 'hidden' }}>
            <div className="group-picker-modal-header">
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#0f172a' }}>
                  📁 Select Project Group (Week {studioWeekNumber})
                </h3>
                <span style={{ fontSize: '0.76rem', color: '#64748b' }}>
                  Tap any group card below to set it as your active recording target.
                </span>
              </div>
              <button
                type="button"
                className="btn-close-group-picker"
                onClick={() => setShowGroupPickerModal(false)}
                aria-label="Close group picker"
              >
                ✕
              </button>
            </div>

            {/* Search Input */}
            <div style={{ padding: '0 16px 8px' }}>
              <input
                type="text"
                className="group-picker-search-input"
                placeholder="🔍 Search group code, project topic, or student..."
                value={groupPickerSearch}
                onChange={(e) => setGroupPickerSearch(e.target.value)}
              />
            </div>

            {/* Filter Chips: All | Mine | Stream Prefixes (A, E, L...) | Unrecorded */}
            <div className="group-picker-filter-chips">
              <button
                type="button"
                className={`group-picker-chip ${groupPickerStream === 'all' ? 'active' : ''}`}
                onClick={() => setGroupPickerStream('all')}
              >
                All ({groupPickerData.all.length})
              </button>
              {groupPickerData.myCount > 0 && (
                <button
                  type="button"
                  className={`group-picker-chip ${groupPickerStream === 'mine' ? 'active' : ''}`}
                  onClick={() => setGroupPickerStream('mine')}
                >
                  👨‍🏫 Mine ({groupPickerData.myCount})
                </button>
              )}
              {groupPickerData.streamPrefixes.length > 1 &&
                groupPickerData.streamPrefixes.map((prefix) => (
                  <button
                    key={prefix}
                    type="button"
                    className={`group-picker-chip ${groupPickerStream === prefix ? 'active' : ''}`}
                    onClick={() => setGroupPickerStream(prefix)}
                  >
                    Stream {prefix} ({groupPickerData.streamCounts[prefix]})
                  </button>
                ))}
              <button
                type="button"
                className={`group-picker-chip ${groupPickerStream === 'unrecorded' ? 'active' : ''}`}
                onClick={() => setGroupPickerStream('unrecorded')}
              >
                🟡 Unrecorded ({groupPickerData.unrecordedCount})
              </button>
            </div>

            {/* 4-Column Compact Touch Grid */}
            <div className="group-picker-grid-container">
              {groupPickerData.filtered.length === 0 ? (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '24px', color: '#64748b', fontSize: '0.88rem' }}>
                  No groups match your filter.
                </div>
              ) : (
                groupPickerData.filtered.map((g) => {
                  const isActive = g.id === studioGroupId;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`group-picker-grid-item ${isActive ? 'active' : ''} ${g.isAnalyzed ? 'analyzed' : g.isRecorded ? 'recorded' : 'unrecorded'}`}
                      onClick={() => {
                        handleSelectGroup(g.id);
                        setShowGroupPickerModal(false);
                        setGroupPickerSearch('');
                      }}
                    >
                      <div className="group-picker-item-top">
                        <strong className="group-picker-item-code">
                          {isActive ? `✓ ${g.shortCode}` : g.shortCode}
                        </strong>
                        <span
                          className="group-picker-item-status"
                          title={g.isAnalyzed ? 'Analyzed' : g.isRecorded ? 'Recorded (Pending AI)' : 'Not recorded yet'}
                        >
                          {g.isAnalyzed ? '✨' : g.isRecorded ? '🎙️' : '🟡'}
                        </span>
                      </div>
                      <span className="group-picker-item-meta">
                        {g.members?.length || 0} stu
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="group-picker-legend">
              <span>✨ Analyzed</span>
              <span>🎙️ Recorded</span>
              <span>🟡 Pending</span>
              <span>✓ Active Target</span>
            </div>
        </div>
      </NativeModalDialog>

      {/* Hidden File Inputs for Photo Capture */}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={photoInputRef}
        data-testid="photo-camera-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadPhoto(file);
        }}
      />
      <input
        type="file"
        accept="image/*"
        ref={photoGalleryInputRef}
        data-testid="photo-gallery-input"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleUploadPhoto(file);
        }}
      />
    </div>
  );
}
