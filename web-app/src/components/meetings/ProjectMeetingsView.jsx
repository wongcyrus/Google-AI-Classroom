import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { db, storage, functions } from '../../firebase-config';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';
import { getSupportedAudioMimeType, injectWebmDuration, formatDuration } from '../../hooks/useLectureRecorder';
import { normalizeStudentEmail, getStudentProfile } from '../../utils/studentDisplayUtils';
import {
  exportProjectMeetingsMatrixExcel,
  generateMeetingMarkdownMinutes,
  buildGoogleSheetCsvExportUrl,
  parseProjectWeeklyLogCsv,
  resolveSemesterStartMondayFromClass,
  resolveTotalProjectWeeksFromClass,
  formatWeekDateRange,
  rehydrateWeeklyLogDataFromPersistedProfiles,
  buildStudentContributionProfiles,
  mergeIncrementalStudentProfiles,
  bootstrapProjectGroupsFromWeeklyLogs,
  exportStudentContributionProfilesExcel,
  toVtcStudentEmail,
  extractVtcStudentId,
} from '../../utils/projectGroupUtils';
import { formatAiCost } from '../../utils/formatters';
import ProjectGroupEditorModal from './ProjectGroupEditorModal';
import './meetings.css';

function parseTimestampToSecs(ts) {
  if (typeof ts === 'number') return Math.max(0, ts);
  if (!ts || typeof ts !== 'string') return 0;
  const clean = ts.replace(/[\[\]]/g, '').trim();
  const parts = clean.split(':').map((n) => parseFloat(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export default function ProjectMeetingsView({ classId, classInfo, user }) {
  const currentUserEmail = normalizeStudentEmail(user?.email || '');
  const currentUserName = user?.displayName || currentUserEmail.split('@')[0] || 'Supervisor';

  // Firestore collections state
  const [groups, setGroups] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [persistedProfiles, setPersistedProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filter & Navigation state
  const [supervisorFilter, setSupervisorFilter] = useState('all'); // 'mine' | 'all'
  const [subViewMode, setSubViewMode] = useState('studio'); // 'studio' | 'matrix'
  const [selectedMeetingId, setSelectedMeetingId] = useState(null);
  const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
  const [showGroupEditorModal, setShowGroupEditorModal] = useState(false);

  // Unified Recording Studio & Master Selection state (Single Source of Truth)
  const [studioGroupId, setStudioGroupId] = useState('');
  const [studioWeekNumber, setStudioWeekNumber] = useState(1);
  const [studioTitle, setStudioTitle] = useState('');
  const [presenterStudentUid, setPresenterStudentUid] = useState('');
  const [forceNewMeetingDoc, setForceNewMeetingDoc] = useState(false);
  const [recordingState, setRecordingState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'uploading'
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [studentPcCaptureStatus, setStudentPcCaptureStatus] = useState(null);
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

    return () => {
      unsubGroups();
      unsubMeetings();
      unsubProfiles();
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

  useEffect(() => {
    if (visibleGroups.length > 0 && (!studioGroupId || !visibleGroups.some((g) => g.id === studioGroupId))) {
      setStudioGroupId(visibleGroups[0].id);
    }
  }, [visibleGroups, studioGroupId]);

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

  // Statistics for Batch AI Analysis on the currently selected week
  const weekAiStats = useMemo(() => {
    const weekNum = Number(studioWeekNumber);
    const weekMeetings = meetings.filter((m) => Number(m.weekNumber) === weekNum);
    const withAudio = weekMeetings.filter(
      (m) => (Array.isArray(m.audioClips) && m.audioClips.length > 0) || Boolean(m.audioStoragePath)
    );
    const missing = withAudio.filter(
      (m) => !m.analyzedAt && !m.aiModelUsed && !m.rawDiarizedTranscript
    );
    const analyzed = withAudio.filter(
      (m) => Boolean(m.analyzedAt || m.aiModelUsed || m.rawDiarizedTranscript)
    );
    return {
      totalMeetings: weekMeetings.length,
      withAudioCount: withAudio.length,
      missingCount: missing.length,
      analyzedCount: analyzed.length,
      missingMeetings: missing,
      allAudioMeetings: withAudio,
    };
  }, [meetings, studioWeekNumber]);

  // Unified Group & Week selection handlers
  const handleSelectGroup = useCallback(
    (newGroupId) => {
      setStudioGroupId(newGroupId);
      setPresenterStudentUid('');
      // Find matching meeting for (newGroupId, studioWeekNumber)
      const exactMatch = meetings.find(
        (m) => m.groupId === newGroupId && Number(m.weekNumber) === Number(studioWeekNumber)
      );
      if (exactMatch) {
        setSelectedMeetingId(exactMatch.id);
        setActiveAudioClipIdx(0);
        setActiveScreenClipIdx(0);
      } else {
        // If no meeting for this week, see if there is any meeting for this group
        const groupMeetings = meetings.filter((m) => m.groupId === newGroupId);
        if (groupMeetings.length > 0) {
          const sorted = [...groupMeetings].sort(
            (a, b) => (Number(b.weekNumber) || 0) - (Number(a.weekNumber) || 0)
          );
          setSelectedMeetingId(sorted[0].id);
          setStudioWeekNumber(Number(sorted[0].weekNumber) || 1);
          setActiveAudioClipIdx(0);
          setActiveScreenClipIdx(0);
        } else {
          setSelectedMeetingId(null);
        }
      }
    },
    [meetings, studioWeekNumber]
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

  // Ensure selectedMeetingId is always synchronized with the active studioGroupId
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
    // If current selectedMeetingId belongs to studioGroupId, keep it
    if (selectedMeetingId && meetings.some((m) => m.id === selectedMeetingId && m.groupId === studioGroupId)) {
      return;
    }
    // Otherwise pick the latest meeting for this group if any exists
    const groupMeetings = meetings.filter((m) => m.groupId === studioGroupId);
    if (groupMeetings.length > 0) {
      const sorted = [...groupMeetings].sort(
        (a, b) => (Number(b.weekNumber) || 0) - (Number(a.weekNumber) || 0)
      );
      setSelectedMeetingId(sorted[0].id);
      setStudioWeekNumber(Number(sorted[0].weekNumber) || 1);
      setActiveAudioClipIdx(0);
      setActiveScreenClipIdx(0);
    } else {
      setSelectedMeetingId(null);
    }
  }, [studioGroupId, studioWeekNumber, meetings, selectedMeetingId]);

  const selectedMeeting = useMemo(
    () => meetings.find((m) => m.id === selectedMeetingId) || null,
    [meetings, selectedMeetingId]
  );

  // Listen to `activeMeetingCaptures/{presenterStudentUid}` when a presenter student PC is selected
  useEffect(() => {
    if (!classId || !presenterStudentUid) {
      setStudentPcCaptureStatus(null);
      return;
    }
    const ref = doc(db, `classes/${classId}/activeMeetingCaptures/${presenterStudentUid}`);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          setStudentPcCaptureStatus(snap.data());
        } else {
          setStudentPcCaptureStatus(null);
        }
      },
      () => {}
    );
    return () => unsub();
  }, [classId, presenterStudentUid]);

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

          const batch = writeBatch(db);
          batch.set(
            doc(db, `classes/${classId}`),
            {
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
            { merge: true }
          );

          if ((syncGroups || groups.length === 0) && mergedGroups.length > 0) {
            mergedGroups.forEach((grp) => {
              batch.set(
                doc(db, `classes/${classId}/projectGroups/${grp.id}`),
                {
                  name: grp.name || 'Group',
                  projectTopic: grp.projectTopic || '',
                  supervisorEmail: normalizeStudentEmail(grp.supervisorEmail || currentUserEmail),
                  supervisorName: grp.supervisorName || currentUserName,
                  supervisorUid: user?.uid || '',
                  members: Array.isArray(grp.members) ? grp.members : [],
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            });
          }

          if (ingestToFirestore && deltaProfiles.length > 0) {
            deltaProfiles.forEach((prof) => {
              const vtcEmail = toVtcStudentEmail(prof.email || prof.studentId || prof.key);
              if (!vtcEmail) return;
              batch.set(
                doc(db, `classes/${classId}/projectStudentProfiles/${vtcEmail}`),
                {
                  ...prof,
                  key: vtcEmail,
                  email: vtcEmail,
                  studentId: extractVtcStudentId(vtcEmail) || prof.studentId,
                  lastSyncedAt: new Date().toISOString(),
                  updatedAt: serverTimestamp(),
                },
                { merge: true }
              );
            });
          }

          await batch.commit().catch((err) => {
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

  // Auto-select latest week from log sheet on initial sync if studio is idle on Week 1
  const hasAutoSetWeekRef = useRef(false);
  useEffect(() => {
    if (
      !hasAutoSetWeekRef.current &&
      weeklyLogData.weeks.length > 0 &&
      recordingState === 'idle' &&
      studioWeekNumber === 1
    ) {
      hasAutoSetWeekRef.current = true;
      setStudioWeekNumber(weeklyLogData.weeks[weeklyLogData.weeks.length - 1]);
    }
  }, [weeklyLogData.weeks, recordingState, studioWeekNumber]);

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
    const batch = writeBatch(db);
    const keepIds = new Set(draftGroups.map((g) => g.id));

    // Delete removed groups
    groups.forEach((existingGrp) => {
      if (!keepIds.has(existingGrp.id)) {
        batch.delete(doc(db, `classes/${classId}/projectGroups/${existingGrp.id}`));
      }
    });

    // Upsert all draft groups
    draftGroups.forEach((grp) => {
      const grpRef = doc(db, `classes/${classId}/projectGroups/${grp.id}`);
      batch.set(
        grpRef,
        {
          name: grp.name || 'Group',
          projectTopic: grp.projectTopic || '',
          supervisorEmail: normalizeStudentEmail(grp.supervisorEmail || currentUserEmail),
          supervisorName: grp.supervisorName || currentUserName,
          supervisorUid: user?.uid || '',
          members: Array.isArray(grp.members) ? grp.members : [],
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
    showToastMessage(`Saved ${draftGroups.length} Project Group(s)!`);
  };

  // Signal Presenter Student's PC to start or stop local screen recording (supports both Firebase UID and @stu.vtc.edu.hk email)
  const signalStudentPcScreenCapture = useCallback(
    async ({ studentUid, status, meetingId, clipId, groupObj }) => {
      if (!classId || !studentUid) return;
      const member = (groupObj?.members || []).find(
        (m) => m.uid === studentUid || normalizeStudentEmail(m.email) === normalizeStudentEmail(studentUid)
      );
      const memberEmail = toVtcStudentEmail(member?.email || (String(studentUid).includes('@') ? studentUid : ''));
      const payload = {
        classId,
        groupId: groupObj?.id || studioGroupId || 'default',
        groupName: groupObj?.name || 'Project Group',
        meetingId,
        clipId,
        studentUid,
        studentEmail: memberEmail || member?.email || '',
        studentName: member?.name || memberEmail || 'Student',
        supervisorEmail: currentUserEmail,
        status,
        updatedAt: serverTimestamp(),
        ...(status === 'recording' ? { startedAt: new Date().toISOString() } : {}),
      };

      const targetKeys = [...new Set([studentUid, memberEmail].filter(Boolean))];
      await Promise.all(
        targetKeys.map((key) =>
          setDoc(doc(db, `classes/${classId}/activeMeetingCaptures/${key}`), payload, {
            merge: true,
          }).catch((err) => {
            console.warn('[ProjectMeetingsView] Could not signal student PC screen capture:', err);
          })
        )
      );
    },
    [classId, studioGroupId, currentUserEmail]
  );

  // Switch Presenter Student PC mid-recording!
  const handleChangePresenterStudent = async (newStudentUid) => {
    const prevUid = activePresenterUidRef.current;
    setPresenterStudentUid(newStudentUid);
    activePresenterUidRef.current = newStudentUid;

    if (recordingState === 'recording' && activeMeetingIdRef.current) {
      if (prevUid && prevUid !== newStudentUid) {
        await signalStudentPcScreenCapture({
          studentUid: prevUid,
          status: 'stopping',
          meetingId: activeMeetingIdRef.current,
          clipId: activeClipIdRef.current,
          groupObj: activeStudioGroup,
        });
      }
      if (newStudentUid) {
        const nextClipId = `clip_${Date.now()}`;
        await signalStudentPcScreenCapture({
          studentUid: newStudentUid,
          status: 'recording',
          meetingId: activeMeetingIdRef.current,
          clipId: nextClipId,
          groupObj: activeStudioGroup,
        });
      }
    }
  };

  // Start Voice Recording (on Teacher Mobile / Laptop) + Signal Student PC Screen Recording
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

      // If a Presenter Student PC is selected, signal their PC to start recording its screen!
      if (presenterStudentUid) {
        await signalStudentPcScreenCapture({
          studentUid: presenterStudentUid,
          status: 'recording',
          meetingId: targetMeetingId,
          clipId,
          groupObj: activeStudioGroup,
        });
      }

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

    // Signal Student PC to stop & upload its screen recording
    if (activePresenterUidRef.current && targetMeetingId) {
      await signalStudentPcScreenCapture({
        studentUid: activePresenterUidRef.current,
        status: 'stopping',
        meetingId: targetMeetingId,
        clipId,
        groupObj: activeStudioGroup,
      });
    }

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
      const grpCode = String(mtgObj?.groupName || activeStudioGroup?.name || '')
        .replace(/^group\s+/i, '')
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

      const callAnalyze = httpsCallable(functions, 'analyzeProjectMeeting', { timeout: 300000 });
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
    const weekMeetingsWithAudio = meetings.filter((m) => {
      const isWeek = Number(m.weekNumber) === weekNum;
      const hasAudio =
        (Array.isArray(m.audioClips) && m.audioClips.length > 0) || Boolean(m.audioStoragePath);
      return isWeek && hasAudio;
    });

    const targets =
      mode === 'missing_only'
        ? weekMeetingsWithAudio.filter(
            (m) => !m.analyzedAt && !m.aiModelUsed && !m.rawDiarizedTranscript
          )
        : weekMeetingsWithAudio;

    if (targets.length === 0) {
      showToastMessage(
        mode === 'missing_only'
          ? `All recorded groups in Week ${weekNum} have already been analyzed!`
          : `No recordings found in Week ${weekNum}.`
      );
      setShowBatchAiModal(false);
      return;
    }

    setShowBatchAiModal(false);
    cancelBatchAnalysisRef.current = false;
    setBatchAnalysisProgress({
      current: 0,
      total: targets.length,
      groupName: '',
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
    await updateDoc(meetingRef, {
      audioClips: remainingClips,
      audioStoragePath: remainingClips[0]?.storagePath || '',
      audioDownloadUrl: remainingClips[0]?.downloadUrl || '',
      recordingSegmentsCount: remainingClips.length,
      durationSeconds: newTotalDuration,
      updatedAt: serverTimestamp(),
    });

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

    await deleteDoc(doc(db, `classes/${classId}/projectMeetings/${meetingId}`));
    if (selectedMeetingId === meetingId) {
      setSelectedMeetingId(null);
    }
    showToastMessage(`🗑️ Deleted meeting session "${mtg.title}"`);
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
    const targetWeek = Number(selectedMeeting.weekNumber) || studioWeekNumber || 1;

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
    await updateDoc(sourceRef, {
      audioClips: remainingSourceClips,
      audioStoragePath: remainingSourceClips[0]?.storagePath || '',
      audioDownloadUrl: remainingSourceClips[0]?.downloadUrl || '',
      recordingSegmentsCount: remainingSourceClips.length,
      durationSeconds: sourceDuration,
      status: 'ready',
      updatedAt: serverTimestamp(),
    });

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

    await updateDoc(doc(db, `classes/${classId}/projectMeetings/${selectedMeeting.id}`), {
      groupId: targetGroup.id,
      groupName: targetGroup.name,
      projectTopic: targetGroup.projectTopic || '',
      sessionGroupId: `${classId}_${targetGroup.id}_wk${selectedMeeting.weekNumber || 1}`,
      supervisorEmail: targetGroup.supervisorEmail || selectedMeeting.supervisorEmail,
      supervisorName: targetGroup.supervisorName || selectedMeeting.supervisorName,
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

  // Group meetings by Project Group for the collapsible sidebar tree
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

    // Place the currently selected studioGroupId folder at the very top
    const list = [...map.values()];
    list.sort((a, b) => {
      if (a.group.id === studioGroupId) return -1;
      if (b.group.id === studioGroupId) return 1;
      return (a.group.name || '').localeCompare(b.group.name || '', undefined, { numeric: true });
    });

    return list;
  }, [visibleGroups, filteredMeetings, studioGroupId]);

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
            Parallel Multi-Supervisor Any-Period Recording • 📱 Mobile Voice + 💻 Student PC Screen • Gemini 3.5 Diarization
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
              🎙️ Meetings & Recorder
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
              📊 Weekly Matrix & Export
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

      {studioToast && <div className="project-meetings-toast">✅ {studioToast}</div>}
      {studioError && <div className="project-meetings-error-banner">⚠️ {studioError}</div>}
      {micSuspendedWarning && (
        <div className="project-meetings-mic-warning-banner">
          ⚠️ <strong>Microphone was paused by iOS / Device:</strong> Your screen was locked or another app was opened. Please keep your device unlocked and stay on this page to continue recording.
        </div>
      )}

      {/* Mobile-Responsive Dual-Device Recording Studio Card */}
      <div className="project-meeting-recorder-studio">
        <div className="studio-controls-row">
          <div className="studio-field">
            <label htmlFor="studio-group-select">📁 Project Group:</label>
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
              <button
                type="button"
                className="btn-batch-ai-trigger"
                onClick={() => setShowBatchAiModal(true)}
                title={`Batch Analyze recordings in Week ${studioWeekNumber} with Gemini`}
              >
                ⚡ Batch AI
              </button>
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
                return (
                  <option key={wk} value={wk}>
                    Week {wk}{rangeLabel ? ` (${rangeLabel})` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="studio-field">
            <label htmlFor="studio-presenter-select">💻 Presenter Student PC Screen:</label>
            <select
              id="studio-presenter-select"
              value={presenterStudentUid}
              onChange={(e) => handleChangePresenterStudent(e.target.value)}
            >
              <option value="">🎙️ Voice Only (No Student PC Screen)</option>
              {(activeStudioGroup?.members || []).map((m) => (
                <option key={m.uid || m.email} value={m.uid || m.email}>
                  💻 Record {m.name}&apos;s PC Screen ({m.email})
                </option>
              ))}
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

            {presenterStudentUid && studentPcCaptureStatus && (
              <span
                className={`pc-screen-status-pill ${studentPcCaptureStatus.studentPcState || 'idle'}`}
              >
                {studentPcCaptureStatus.studentPcState === 'recording_screen'
                  ? `🟢 ${studentPcCaptureStatus.studentName || 'Student'}'s PC Screen Recording Active`
                  : studentPcCaptureStatus.studentPcState === 'waiting_for_screen_share'
                  ? `🟡 Waiting for ${studentPcCaptureStatus.studentName || 'Student'} to Share PC Screen`
                  : studentPcCaptureStatus.studentPcState === 'uploading'
                  ? `☁️ Uploading ${studentPcCaptureStatus.studentName || 'Student'}'s PC Screen...`
                  : `💻 PC Screen Linked (${studentPcCaptureStatus.studentName || 'Student'})`}
              </span>
            )}
          </div>

          <div className="studio-record-buttons">
            {recordingState === 'idle' ? (
              <button
                type="button"
                className="btn-start-meeting-rec"
                onClick={handleStartRecording}
                disabled={!studioGroupId}
              >
                🔴 {existingTargetMeeting ? 'Record Next Clip in Meeting' : 'Start Meeting Recording'}
              </button>
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
                  className="btn-stop-meeting-rec"
                  onClick={() => handleStopAndSaveRecording(true)}
                >
                  ⏹️ Stop & Analyze with Gemini
                </button>
              </>
            )}
          </div>
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
                          <strong>👤 {card.name}</strong>
                          <span style={{ fontSize: '0.74rem', color: '#64748b', marginLeft: '6px' }}>
                            ({card.studentId || card.email})
                          </span>
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
              placeholder="🔎 Search student name, ID (e.g. 250105348), or supervisor..."
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
                            👤 {prof.name}
                          </strong>
                          <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            ID: {prof.studentId} • 📁 Group <strong>{prof.groupCode}</strong>
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
                        👤 {selectedStudentProfile.name} ({selectedStudentProfile.studentId})
                      </h3>
                      <div style={{ fontSize: '0.82rem', color: '#475569', marginTop: '4px', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                        <span>📁 Group: <strong>{selectedStudentProfile.groupName}</strong></span>
                        <span>📧 <code>{selectedStudentProfile.email}</code></span>
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
            <button
              type="button"
              className="btn-export-matrix-xlsx"
              onClick={() => exportProjectMeetingsMatrixExcel({ classId, groups: visibleGroups, meetings })}
              disabled={visibleGroups.length === 0}
            >
              📥 Export Full Matrix (.xlsx)
            </button>
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
                          {weeks.map((wk) => (
                            <th key={wk}>Week {wk}</th>
                          ))}
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
                                <strong>{member.name}</strong>
                                <div style={{ fontSize: '0.74rem', color: '#64748b' }}>{email}</div>
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
      ) : (
        <>
          {/* Live Batch Analysis Progress Banner */}
          {batchAnalysisProgress && (
            <div className="batch-analysis-progress-banner">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                <span style={{ fontSize: '1.2rem', animation: 'spin 1.5s linear infinite' }}>⏳</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#1e3a8a', marginBottom: '4px' }}>
                    ⚡ Batch Analyzing Week {studioWeekNumber} ({batchAnalysisProgress.mode === 'missing_only' ? 'Missing Only' : 'All Groups'}): [{batchAnalysisProgress.current} of {batchAnalysisProgress.total}] Group <strong>{batchAnalysisProgress.groupName}</strong>
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
              <button
                type="button"
                className="btn-cancel-batch-analysis"
                onClick={() => {
                  cancelBatchAnalysisRef.current = true;
                }}
              >
                ⏹️ Stop Batch
              </button>
            </div>
          )}

          <div className="project-meetings-workspace-grid">
            {/* Left Panel: Hierarchical Grouped Recordings Sidebar (By Project Group -> By Weekly Meeting) */}
            <div className={`meetings-grouped-sidebar ${mobileSidebarExpanded ? 'mobile-expanded' : 'mobile-collapsed'}`}>
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
                <span className="sidebar-title-badge" style={{ fontSize: '0.84rem', fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  📂 Meeting Sessions ({filteredMeetings.length})
                  <span className="mobile-sidebar-toggle-indicator" style={{ fontSize: '0.74rem', color: '#64748b' }}>
                    {mobileSidebarExpanded ? '▲' : '▼'}
                  </span>
                </span>
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
            ) : (
              <div className="grouped-folders-list">
                {meetingsGroupedByProjectGroup.map(({ group: grp, items }) => {
                  return (
                    <div key={grp.id} className="project-group-folder">
                      <div
                        className={`project-group-folder-header ${grp.id === studioGroupId ? 'active-group-header' : ''}`}
                      >
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b' }}>
                            📂 {grp.name}
                          </span>
                          {grp.supervisorEmail && (
                            <span style={{ display: 'block', fontSize: '0.72rem', color: '#64748b' }}>
                              👨‍🏫 {grp.supervisorEmail}
                            </span>
                          )}
                        </div>
                        <span className="folder-count-badge">{items.length} wk(s)</span>
                      </div>

                      <div className="project-group-folder-items">
                        {items.length === 0 ? (
                          <div className="empty-folder-note">
                            No recordings yet — select <strong>{grp.name}</strong> above to record.
                          </div>
                        ) : (
                          items.map((m) => {
                            const isSelected = m.id === selectedMeetingId;
                            const voiceClipCount = (m.audioClips || []).length || (m.audioStoragePath ? 1 : 0);
                            const screenClipCount = (m.screenClips || []).length;
                            const presentCount = (m.attendanceRecord || []).filter(
                              (a) => a.status === 'present' || a.status === 'late'
                            ).length;
                            const totalRoster = (m.attendanceRecord || []).length;

                            return (
                              <div
                                key={m.id}
                                className={`meeting-session-card ${isSelected ? 'active' : ''}`}
                                onClick={() => handleSelectMeeting(m)}
                              >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                  <strong style={{ fontSize: '0.86rem', color: '#0f172a' }}>
                                    Week {m.weekNumber || 1}: {m.title || 'Meeting'}
                                  </strong>
                                  <span className={`meeting-status-dot ${m.status || 'ready'}`}>
                                    {m.status === 'analyzing'
                                      ? '⏳ AI...'
                                      : m.status === 'recording'
                                      ? '🔴 REC'
                                      : m.keyInsights?.overallGroupProgress === 'at_risk' ||
                                        m.keyInsights?.overallGroupProgress === 'behind'
                                      ? '⚠️ At Risk'
                                      : m.analyzedAt || m.aiModelUsed || m.rawDiarizedTranscript
                                      ? '✨ Analyzed'
                                      : '🎙️ Recorded'}
                                  </span>
                                </div>

                                <div className="meeting-card-badges">
                                  {(m.supervisorName || m.supervisorEmail) && (
                                    <span title={m.supervisorEmail || ''}>
                                      👨‍🏫 {m.supervisorName || m.supervisorEmail.split('@')[0]}
                                    </span>
                                  )}
                                  <span>🎙️ {voiceClipCount} Voice Clip{voiceClipCount === 1 ? '' : 's'}</span>
                                  {screenClipCount > 0 && (
                                    <span>💻 {screenClipCount} PC Screen{screenClipCount === 1 ? '' : 's'}</span>
                                  )}
                                  <span>⏱️ {formatDuration(m.durationSeconds || 0)}</span>
                                  {totalRoster > 0 && (
                                    <span>
                                      👥 {presentCount}/{totalRoster} Present
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel: Selected Meeting Inspector (Dual-Stream Player + Attendance + Key Insights + Work Done Per Student) */}
          <div className="meeting-inspector-panel">
            {!selectedMeeting ? (
              <div className="empty-meetings-box">
                Select a meeting on the left or record a new group meeting above.
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
                      {selectedMeeting.analyzedAt ? (
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
                        : selectedMeeting.analyzedAt || selectedMeeting.aiModelUsed || selectedMeeting.rawDiarizedTranscript
                        ? '✨ Re-Run Gemini Analysis'
                        : '✨ Run Gemini Analysis'}
                    </button>

                    <button
                      type="button"
                      className="btn-copy-markdown-minutes"
                      onClick={() => {
                        const md = generateMeetingMarkdownMinutes(selectedMeeting);
                        navigator.clipboard?.writeText(md);
                        showToastMessage('📋 Copied Markdown Meeting Minutes to clipboard!');
                      }}
                    >
                      📋 Copy Minutes
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
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155' }}>💻 Student PC Screens:</span>
                        {selectedMeeting.screenClips.map((sc, idx) => (
                          <button
                            key={sc.clipId || idx}
                            type="button"
                            className={`clip-pill-btn screen-pill ${activeScreenClipIdx === idx ? 'active' : ''}`}
                            onClick={() => setActiveScreenClipIdx(idx)}
                          >
                            💻 {sc.label || sc.studentName || `Screen ${idx + 1}`}
                          </button>
                        ))}
                        <button
                          type="button"
                          className="btn-delete-clip-part"
                          title="Delete selected student PC screen clip"
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
                          🔗 Sync Screen + Voice
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

                {/* Notice banner if meeting has audio clips but has not yet been processed by Gemini */}
                {!selectedMeeting.analyzedAt && !selectedMeeting.rawDiarizedTranscript && (
                  <div style={{ padding: '10px 14px', background: '#fefce8', border: '1px solid #fef08a', borderRadius: '8px', color: '#854d0e', fontSize: '0.84rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    <span>
                      🎙️ <strong>Audio Recorded (Pending AI Analysis):</strong> Gemini has not processed this meeting yet. Click <strong>&quot;Run Gemini Analysis&quot;</strong> to diarize speakers, verify weekly logs, and attribute attendance.
                    </span>
                    <button
                      type="button"
                      className="btn-run-gemini-meeting"
                      style={{ padding: '6px 12px', fontSize: '0.8rem' }}
                      onClick={() => handleRunGeminiAnalysis(selectedMeeting.id)}
                      disabled={isAnalyzing || selectedMeeting.status === 'analyzing'}
                    >
                      {isAnalyzing || selectedMeeting.status === 'analyzing' ? '⏳ Analyzing...' : '✨ Run Gemini Analysis Now'}
                    </button>
                  </div>
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
                            <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>{att.name}</strong>
                            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{att.email}</div>
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
                      <div style={{ display: 'flex', gap: '6px' }}>
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
                              <strong>👤 {sc.name}</strong>
                              <span style={{ fontSize: '0.76rem', color: '#64748b', marginLeft: '6px' }}>
                                ({sc.email})
                              </span>
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
                                        showToastMessage(`📋 Copied weekly feedback for ${sc.name}!`);
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
                </div>
              </>
            )}
          </div>
        </div>
        </>
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
      />

      {/* Batch Gemini Analysis Modal for Selected Week */}
      {showBatchAiModal && (
        <div className="project-group-editor-modal-overlay" onClick={() => !batchAnalysisProgress && setShowBatchAiModal(false)}>
          <div className="project-group-editor-modal-card" style={{ maxWidth: '580px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                ⚡ Batch Gemini Analysis — Week {studioWeekNumber}
              </h3>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => !batchAnalysisProgress && setShowBatchAiModal(false)}
                disabled={Boolean(batchAnalysisProgress)}
              >
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <p style={{ margin: 0, fontSize: '0.88rem', color: '#475569' }}>
                Run Two-Stage Gemini Diarization, Attendance attribution, and Weekly Log verification across multiple project groups for <strong>Week {studioWeekNumber}</strong>.
              </p>

              {/* Status Breakdown Box */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#0f172a' }}>{weekAiStats.withAudioCount}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>🎙️ Total with Audio</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#d97706' }}>{weekAiStats.missingCount}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>🟡 Missing / Pending</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#16a34a' }}>{weekAiStats.analyzedCount}</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>✨ Already Analyzed</div>
                </div>
              </div>

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
                      ⚡ Mode 1: Run Missing Only ({weekAiStats.missingCount} groups)
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
                    disabled={weekAiStats.missingCount === 0 || isAnalyzing || Boolean(batchAnalysisProgress)}
                  >
                    {weekAiStats.missingCount === 0
                      ? '✅ All Groups in Week ' + studioWeekNumber + ' Already Analyzed'
                      : `⚡ Analyze ${weekAiStats.missingCount} Missing Group(s)`}
                  </button>
                </div>

                <div style={{ border: '1px solid #cbd5e1', background: '#f8fafc', borderRadius: '8px', padding: '12px 14px' }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', color: '#334155', marginBottom: '4px' }}>
                    🔄 Mode 2: Re-Run All ({weekAiStats.withAudioCount} groups)
                  </strong>
                  <p style={{ margin: '0 0 10px 0', fontSize: '0.8rem', color: '#64748b' }}>
                    Re-analyzes all recorded groups in Week {studioWeekNumber} from scratch. Useful if you updated student weekly logs or want to switch models.
                  </p>
                  <button
                    type="button"
                    className="btn-pause-meeting-rec"
                    style={{ width: '100%' }}
                    onClick={() => handleBatchAnalyzeWeek('all')}
                    disabled={weekAiStats.withAudioCount === 0 || isAnalyzing || Boolean(batchAnalysisProgress)}
                  >
                    🔄 Re-Analyze All {weekAiStats.withAudioCount} Group(s) in Week {studioWeekNumber}
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ padding: '12px 20px', display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e2e8f0' }}>
              <button
                type="button"
                className="btn-modal-cancel"
                onClick={() => setShowBatchAiModal(false)}
                disabled={Boolean(batchAnalysisProgress)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Student Record & Feedback Modal */}
      {editingStudentContrib && (
        <div
          className="student-edit-modal-backdrop"
          onClick={() => setEditingStudentUid(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-edit-modal-title"
        >
          <div
            className="student-edit-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="student-edit-modal-header">
              <div>
                <h3 id="student-edit-modal-title" style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  ✏️ Edit Student Contribution &amp; Feedback
                </h3>
                <div style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  <strong>👤 {editingStudentContrib.name}</strong> ({editingStudentContrib.email}) • {selectedMeeting?.groupName || 'Group'} — Week {selectedMeeting?.weekNumber || 1}
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
        </div>
      )}
    </div>
  );
}
