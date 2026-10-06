import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, functions } from '../firebase-config';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import JSZip from 'jszip';
import { formatDuration } from '../hooks/useLectureRecorder';
import { useGoogleDrive } from '../hooks/useGoogleDrive';
import { extractGoogleDriveFileId, formatGoogleDriveEmbedUrl } from '../utils/googleDriveService';
import {
  SUBTITLE_LANGUAGES,
  getInitialSubtitleLang,
  getSubtitleLanguageLabel,
  applySubtitleTrack,
  getActiveSubtitleLang,
  determineDefaultPlayerMode,
  fixWebmPlaybackDuration,
  handleVideoEndedGuard,
} from '../utils/videoSubtitleUtils';
import { isRecordInLesson } from './StudentRecordsView';
import Modal from './Modal';
import AudioPromptSelector from './AudioPromptSelector';
import TranslationPromptSelector from './TranslationPromptSelector';
import { formatAiCost } from '../utils/formatters';
import './LectureRecordingsView.css';

export function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Extracts 11-character YouTube video ID from various URL formats or raw ID.
 * Supports youtu.be, youtube.com/watch, youtube.com/embed, youtube.com/live, etc.
 */
export function extractYouTubeVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|live\/))([a-zA-Z0-9_-]{11})/
  );
  return match ? match[1] : null;
}

const EMPTY_ARRAY = [];

export default function LectureRecordingsView({
  classId,
  user,
  onBack = null,
  className = '',
  lessons = EMPTY_ARRAY,
  selectedLesson = '',
  timezone = 'UTC',
}) {
  const [recordings, setRecordings] = useState(EMPTY_ARRAY);
  const [loading, setLoading] = useState(true);
  const [selectedRecordingId, setSelectedRecordingId] = useState(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [isRetryingSubtitles, setIsRetryingSubtitles] = useState(false);
  const [showRegenModal, setShowRegenModal] = useState(false);
  const [regenPrompt, setRegenPrompt] = useState(null);
  const [regenPromptText, setRegenPromptText] = useState('');
  const [regenSttPrompt, setRegenSttPrompt] = useState(null);
  const [regenSttPromptText, setRegenSttPromptText] = useState('');
  const [regenTransPrompt, setRegenTransPrompt] = useState(null);
  const [regenTransPromptText, setRegenTransPromptText] = useState('');
  const [regenLanguages, setRegenLanguages] = useState(['en', 'zh-Hant', 'zh-Hans']);
  const [regenModel, setRegenModel] = useState('gemini-3.8-flash');
  const [copyFeedback, setCopyFeedback] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeFeedback, setMergeFeedback] = useState('');
  const [selectedIdsToMerge, setSelectedIdsToMerge] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileFeedback, setReconcileFeedback] = useState('');
  const hasAutoReconciledRef = useRef(false);

  // Phase 1 YouTube & Dual Player state
  const [activePlayerMode, setActivePlayerMode] = useState('cloud'); // 'youtube' | 'drive' | 'cloud'
  const [selectedSubtitleLang, setSelectedSubtitleLang] = useState('en');
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [isEditingYouTube, setIsEditingYouTube] = useState(false);
  const [isSavingYouTube, setIsSavingYouTube] = useState(false);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState('');

  // Student Sharing (Dual-Tier: Class-level gate & recording-level toggle)
  const [classInfo, setClassInfo] = useState(null);
  const [isClassSharingToggling, setIsClassSharingToggling] = useState(false);
  const [isSharingToggling, setIsSharingToggling] = useState(false);
  const [shareFeedback, setShareFeedback] = useState('');
  const [selectedLessonFilter, setSelectedLessonFilter] = useState(selectedLesson || 'all');

  // Google Drive integration hook & state
  const {
    clientId: gdriveClientId,
    isConfigured: isGdriveConfigured,
    isConnected: isGdriveConnected,
    connectedUser: gdriveUser,
    baseFolderName,
    setBaseFolderName,
    isConnecting: isGdriveConnecting,
    isUploading: isGdriveUploading,
    uploadProgress: gdriveUploadProgress,
    error: gdriveError,
    successMessage: gdriveSuccess,
    connect: connectGdrive,
    disconnect: disconnectGdrive,
    uploadRecording: uploadToGdrive,
    uploadSubtitlesOnly: uploadSubtitlesToGdrive,
    linkManualDrive,
    unlinkRecording: unlinkGdrive,
    clearFeedback: clearGdriveFeedback,
  } = useGoogleDrive();

  const [manualDriveUrlInput, setManualDriveUrlInput] = useState('');
  const [isEditingBaseFolder, setIsEditingBaseFolder] = useState(false);
  const [baseFolderDraft, setBaseFolderDraft] = useState('');

  const videoRef = useRef(null);

  // Permanently delete a lecture recording and all associated storage files
  const handleDeleteRecording = async (recordingId) => {
    if (!classId || !recordingId) return;

    const recToDelete = recordings.find((r) => r.id === recordingId);
    const recTitle = recToDelete?.title || 'this lecture recording';

    const confirmed = window.confirm(
      `Are you sure you want to delete "${recTitle}"?\n\nThis will permanently remove the HD video, microphone audio track, and all multilingual subtitle tracks (.vtt/.srt) from Cloud Storage. This action cannot be undone.`
    );
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await deleteDoc(doc(db, 'classes', classId, 'lectureRecordings', recordingId));
      if (selectedRecordingId === recordingId) {
        const remaining = recordings.filter((r) => r.id !== recordingId);
        setSelectedRecordingId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to delete recording:', err);
      alert(`Failed to delete recording: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  };

  // Automatically inspect and restore recordings whose uploads or status updates were interrupted
  const handleAutoReconcile = async () => {
    if (!classId) return;
    setIsReconciling(true);
    setReconcileFeedback('');
    try {
      const reconcileFn = httpsCallable(functions, 'reconcileLectureRecordings');
      const res = await reconcileFn({ classId });
      if (res.data?.reconciledCount > 0) {
        setReconcileFeedback(`Successfully restored ${res.data.reconciledCount} recording(s) from Cloud Storage!`);
      } else {
        setReconcileFeedback('Cloud Storage check complete. No unlinked media found.');
      }
    } catch (err) {
      console.warn('[LectureRecordingsView] Auto-reconcile notice:', err);
      setReconcileFeedback(`Recovery notice: ${err.message}`);
    } finally {
      setIsReconciling(false);
    }
  };

  // Subscribe to parent class document to watch allowShareTeacherRecordings
  useEffect(() => {
    if (!classId) {
      setClassInfo(null);
      return;
    }
    const classDocRef = doc(db, 'classes', classId);
    const unsub = onSnapshot(classDocRef, (snap) => {
      if (snap.exists()) {
        setClassInfo(snap.data());
      }
    });
    return () => unsub();
  }, [classId]);

  const classPolicy = classInfo?.teacherRecordingsPolicy || (classInfo?.allowShareTeacherRecordings ? 'selective' : 'private');

  // Handle updating class-level student sharing policy on the class document
  const handleSetClassPolicy = async (targetPolicy) => {
    if (!classId) return;
    setIsClassSharingToggling(true);
    setShareFeedback('');
    try {
      const isAllowed = targetPolicy !== 'private';
      await updateDoc(doc(db, 'classes', classId), {
        teacherRecordingsPolicy: targetPolicy,
        allowShareTeacherRecordings: isAllowed,
      });
      if (targetPolicy === 'always_shared') {
        setShareFeedback('Automatic sharing enabled! All recorded lectures are now visible to enrolled students.');
      } else if (targetPolicy === 'selective') {
        setShareFeedback('Selective sharing enabled! Enrolled students can view lectures marked as "Shared".');
      } else {
        setShareFeedback('Class sharing disabled (Private). All lectures are now hidden from students.');
      }
      setTimeout(() => setShareFeedback(''), 5000);
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to update class sharing policy:', err);
      setShareFeedback(`Failed to update class policy: ${err.message}`);
    } finally {
      setIsClassSharingToggling(false);
    }
  };

  // Handle toggling class-level student sharing permission on the class document
  const handleToggleClassSharing = async () => {
    const nextPolicy = classPolicy === 'private' ? 'selective' : 'private';
    await handleSetClassPolicy(nextPolicy);
  };

  // Synchronize lesson filter if selectedLesson prop updates
  useEffect(() => {
    if (selectedLesson && selectedLesson !== 'all') {
      setSelectedLessonFilter(selectedLesson);
    }
  }, [selectedLesson]);

  // Handle toggling manual share with students for a specific recording
  const handleToggleShareWithStudents = async (recordingId, currentSharedState) => {
    if (!classId || !recordingId) return;
    setIsSharingToggling(true);
    setShareFeedback('');
    try {
      const recDocRef = doc(db, 'classes', classId, 'lectureRecordings', recordingId);
      const newSharedState = !currentSharedState;
      await updateDoc(recDocRef, {
        isSharedWithStudents: newSharedState,
        sharedAt: newSharedState ? new Date().toISOString() : null,
      });

      // If enabling student access on a recording and class-level policy is private/unset,
      // auto-promote class policy to 'selective' so enrolled students can immediately access it!
      if (newSharedState && classPolicy === 'private') {
        try {
          await updateDoc(doc(db, 'classes', classId), {
            teacherRecordingsPolicy: 'selective',
            allowShareTeacherRecordings: true,
          });
          setClassInfo((prev) => ({
            ...prev,
            teacherRecordingsPolicy: 'selective',
            allowShareTeacherRecordings: true,
          }));
        } catch (classErr) {
          console.warn('[LectureRecordingsView] Could not auto-promote class policy to selective:', classErr);
        }
      }

      setShareFeedback(newSharedState ? 'Lecture shared with students! (Selective class sharing enabled)' : 'Student access revoked.');
      setTimeout(() => setShareFeedback(''), 4000);
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to toggle sharing:', err);
      setShareFeedback(`Failed to update sharing: ${err.message}`);
    } finally {
      setIsSharingToggling(false);
    }
  };

  // Subscribe to lectureRecordings subcollection in real time
  useEffect(() => {
    if (!classId) {
      setRecordings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const recordingsRef = collection(db, 'classes', classId, 'lectureRecordings');
    const q = query(recordingsRef, orderBy('startedAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Filter out discarded drafts unless explicitly debugging
        const validDocs = docs.filter((d) => d.status !== 'discarded');
        setRecordings(validDocs);
        setLoading(false);

        // Auto-reconcile once if any recording is older than 2 mins and unfinalized
        const hasOrphaned = validDocs.some((d) => {
          const startMs = d.startedAt?.toDate?.()?.getTime() || (d.startedAt ? new Date(d.startedAt).getTime() : 0);
          return (
            (d.status === 'recording' || d.status === 'uploading' || !d.videoUrl) &&
            startMs > 0 &&
            Date.now() - startMs > 2 * 60 * 1000
          );
        });

        if (hasOrphaned && !hasAutoReconciledRef.current) {
          hasAutoReconciledRef.current = true;
          handleAutoReconcile();
        }
      },
      (err) => {
        console.error('[LectureRecordingsView] Snapshot error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [classId]);

  // Filter recordings by lesson when a specific lesson is selected
  const filteredRecordings = useMemo(() => {
    if (selectedLessonFilter === 'all' || !lessons || lessons.length === 0) {
      return recordings;
    }
    const lesson = lessons.find((l) => (l.id || l.lessonId) === selectedLessonFilter);
    if (!lesson) return recordings;
    return recordings.filter((r) => isRecordInLesson(r, lesson));
  }, [recordings, selectedLessonFilter, lessons]);

  // Automatically select the newest recording in filtered list if none selected or removed
  useEffect(() => {
    if (filteredRecordings.length > 0) {
      if (!selectedRecordingId || !filteredRecordings.some((r) => r.id === selectedRecordingId)) {
        setSelectedRecordingId(filteredRecordings[0].id);
      }
    } else {
      setSelectedRecordingId(null);
    }
  }, [filteredRecordings, selectedRecordingId]);

  // Group unmerged recordings by schedule slot or calendar date
  const unmergedGroups = useMemo(() => {
    const groups = {};
    recordings.forEach((rec) => {
      const dateKey = rec.startedAt?.toDate
        ? rec.startedAt.toDate().toLocaleDateString()
        : (rec.startedAt ? new Date(rec.startedAt).toLocaleDateString() : 'recent');
      const rawGroupId = rec.sessionGroupId || '';
      // If sessionGroupId starts with 'bcast_', group by date so separate broadcast restarts on the same day can be merged together
      const groupId = rawGroupId.startsWith('bcast_') ? `date_${dateKey}` : (rawGroupId || `date_${dateKey}`);
      if (!groups[groupId]) {
        groups[groupId] = {
          groupId,
          dateKey,
          items: [],
        };
      }
      groups[groupId].items.push(rec);
    });

    return Object.values(groups)
      .filter((grp) => {
        const hasCombined = grp.items.some((r) => r.isCombined);
        const unmergedClips = grp.items.filter(
          (r) =>
            !r.isCombined &&
            !r.mergedIntoSessionId &&
            (r.storagePath || r.videoUrl) &&
            r.status !== 'recording' &&
            r.status !== 'discarded'
        );
        return !hasCombined && unmergedClips.length >= 2;
      })
      .map((grp) => {
        const unmergedClips = grp.items.filter(
          (r) =>
            !r.isCombined &&
            !r.mergedIntoSessionId &&
            (r.storagePath || r.videoUrl) &&
            r.status !== 'recording' &&
            r.status !== 'discarded'
        );
        const totalSecs = unmergedClips.reduce((sum, r) => sum + (r.durationSeconds || 0), 0);
        return {
          groupId: grp.groupId,
          clips: unmergedClips,
          count: unmergedClips.length,
          totalDuration: totalSecs,
          dateLabel: grp.dateKey,
        };
      });
  }, [recordings]);

  const toggleSelectForMerge = (recId, explicitVal) => {
    setSelectedIdsToMerge((prev) => {
      const exists = prev.includes(recId);
      const shouldInclude = explicitVal !== undefined ? explicitVal : !exists;
      if (shouldInclude && !exists) {
        return [...prev, recId];
      }
      if (!shouldInclude && exists) {
        return prev.filter((id) => id !== recId);
      }
      return prev;
    });
  };

  const handleMergeClips = async (sessionGroupId, clipIds) => {
    if (!classId || !clipIds || clipIds.length < 2) return;

    setIsMerging(true);
    setMergeFeedback('Concatenating video clips with ffmpeg...');

    try {
      const callMerge = httpsCallable(functions, 'mergeLectureRecordings');
      const sanitizedGroupId = (!sessionGroupId || sessionGroupId === 'custom' || sessionGroupId.startsWith('date_'))
        ? null
        : sessionGroupId;
      const result = await callMerge({
        classId,
        sessionGroupId: sanitizedGroupId,
        recordingIds: clipIds,
      });

      if (result.data?.success && result.data?.combinedSessionId) {
        setMergeFeedback('Merge complete! Triggering AI subtitle transcription...');
        setSelectedRecordingId(result.data.combinedSessionId);

        // Auto-trigger Gemini subtitle and chapter generation
        try {
          const callSubtitles = httpsCallable(functions, 'processLectureSubtitles', { timeout: 600000 });
          callSubtitles({
            classId,
            sessionId: result.data.combinedSessionId,
            storagePath: result.data.storagePath,
            title: result.data.title,
            targetLanguages: result.data.targetLanguages || selectedRecording?.targetLanguages,
          }).catch((subErr) => {
            console.warn('[LectureRecordingsView] Subtitle auto-trigger notice:', subErr);
          });
        } catch (subErr) {
          console.warn('[LectureRecordingsView] Subtitle auto-trigger notice:', subErr);
        }

        setTimeout(() => {
          setMergeFeedback('');
          setIsSelectionMode(false);
          setSelectedIdsToMerge([]);
        }, 3000);
      } else {
        alert(result.data?.message || 'Could not merge recordings.');
        setMergeFeedback('');
      }
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to merge recordings:', err);
      alert(`Failed to merge recordings: ${err.message}`);
      setMergeFeedback('');
    } finally {
      setIsMerging(false);
    }
  };

  const selectedRecording = useMemo(() => {
    return recordings.find((r) => r.id === selectedRecordingId) || null;
  }, [recordings, selectedRecordingId]);

  // Sync YouTube and Google Drive inputs and player mode when selected recording changes
  useEffect(() => {
    if (selectedRecording) {
      setYoutubeUrlInput(selectedRecording.youtubeUrl || '');
      setIsEditingYouTube(false);
      setManualDriveUrlInput(selectedRecording.driveWebViewLink || selectedRecording.driveFileId || '');
      setActivePlayerMode(determineDefaultPlayerMode(selectedRecording));
      setSelectedSubtitleLang(getInitialSubtitleLang(selectedRecording.vttUrls));
    }
  }, [
    selectedRecording?.id,
    selectedRecording?.youtubeVideoId,
    selectedRecording?.youtubeUrl,
    selectedRecording?.driveFileId,
    selectedRecording?.driveWebViewLink,
    selectedRecording?.vttUrls,
  ]);

  const handleSelectSubtitleLang = (lang) => {
    setSelectedSubtitleLang(lang);
    if (videoRef.current) {
      applySubtitleTrack(videoRef.current, lang);
    }
  };

  const handleSelectSubtitleLangFromDrive = (lang) => {
    setActivePlayerMode('cloud');
    setSelectedSubtitleLang(lang);
    setTimeout(() => {
      if (videoRef.current) {
        applySubtitleTrack(videoRef.current, lang);
      }
    }, 100);
  };

  useEffect(() => {
    if (activePlayerMode === 'cloud' && videoRef.current) {
      applySubtitleTrack(videoRef.current, selectedSubtitleLang);
    }
  }, [activePlayerMode, selectedSubtitleLang, selectedRecording?.id]);

  useEffect(() => {
    if (activePlayerMode === 'cloud' && videoRef.current && selectedRecording?.durationSeconds) {
      fixWebmPlaybackDuration(videoRef.current, selectedRecording.durationSeconds);
    }
  }, [activePlayerMode, selectedRecording?.id, selectedRecording?.durationSeconds]);

  // Synchronize native player textTracks state (e.g. built-in CC menu in fullscreen) with toolbar
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !video.textTracks) return;

    const handleTracksChange = () => {
      const activeLang = getActiveSubtitleLang(video);
      setSelectedSubtitleLang((prev) => (prev !== activeLang ? activeLang : prev));
    };

    if (typeof video.textTracks.addEventListener === 'function') {
      video.textTracks.addEventListener('change', handleTracksChange);
      return () => {
        video.textTracks.removeEventListener('change', handleTracksChange);
      };
    } else if ('onchange' in video.textTracks) {
      video.textTracks.onchange = handleTracksChange;
      return () => {
        video.textTracks.onchange = null;
      };
    }
  }, [videoRef.current, selectedRecording?.id]);

  // Handle saving/updating the linked YouTube URL
  const handleSaveYouTubeLink = async () => {
    if (!selectedRecording || !classId) return;
    const trimmed = youtubeUrlInput.trim();
    if (!trimmed) {
      alert('Please enter a YouTube video URL or Video ID');
      return;
    }
    const videoId = extractYouTubeVideoId(trimmed);
    if (!videoId) {
      alert('Invalid YouTube URL or ID. Examples of valid formats:\n• https://youtu.be/dQw4w9WgXcQ\n• https://www.youtube.com/watch?v=dQw4w9WgXcQ\n• dQw4w9WgXcQ');
      return;
    }

    setIsSavingYouTube(true);
    try {
      const recDocRef = doc(db, 'classes', classId, 'lectureRecordings', selectedRecording.id);
      const standardUrl = `https://www.youtube.com/watch?v=${videoId}`;
      await updateDoc(recDocRef, {
        youtubeUrl: standardUrl,
        youtubeVideoId: videoId,
        youtubeLinkedAt: new Date().toISOString(),
      });
      setIsEditingYouTube(false);
      setActivePlayerMode('youtube');
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to save YouTube link:', err);
      alert(`Failed to save YouTube link: ${err.message}`);
    } finally {
      setIsSavingYouTube(false);
    }
  };

  // Handle unlinking YouTube URL from the recording
  const handleUnlinkYouTube = async () => {
    if (!selectedRecording || !classId) return;
    const confirmed = window.confirm('Are you sure you want to unlink the YouTube video from this recording?');
    if (!confirmed) return;

    setIsSavingYouTube(true);
    try {
      const recDocRef = doc(db, 'classes', classId, 'lectureRecordings', selectedRecording.id);
      await updateDoc(recDocRef, {
        youtubeUrl: null,
        youtubeVideoId: null,
        youtubeLinkedAt: null,
      });
      setYoutubeUrlInput('');
      setIsEditingYouTube(false);
      setActivePlayerMode('cloud');
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to unlink YouTube:', err);
      alert(`Failed to unlink YouTube: ${err.message}`);
    } finally {
      setIsSavingYouTube(false);
    }
  };

  // Asynchronous clean video downloader with progress feedback
  const handleDownloadVideoFile = async () => {
    if (!selectedRecording?.videoUrl) return;
    setIsDownloadingVideo(true);
    setDownloadFeedback('Downloading video file...');
    try {
      const ext = selectedRecording.mimeType?.includes('mp4') ? 'mp4' : 'webm';
      const safeTitle = (selectedRecording.title || 'lecture')
        .replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_')
        .substring(0, 45);
      const filename = `${classId}_${safeTitle}_${selectedRecording.id}.${ext}`;

      const response = await fetch(selectedRecording.videoUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
      setDownloadFeedback('Video downloaded!');
      setTimeout(() => setDownloadFeedback(''), 3000);
    } catch (err) {
      console.warn('[LectureRecordingsView] Direct blob download failed, falling back to new window:', err);
      window.open(selectedRecording.videoUrl, '_blank');
      setDownloadFeedback('');
    } finally {
      setIsDownloadingVideo(false);
    }
  };

  // Handle single-click clipboard copying
  const handleCopyText = (text, label) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopyFeedback(label);
    setTimeout(() => setCopyFeedback(''), 2500);
  };

  // Open modal to configure prompt, languages, and model for subtitle generation
  const handleOpenRegenModal = (rec = selectedRecording) => {
    if (!rec) return;
    const initialStt = rec.lectureSttPrompt || rec.lectureRecordingPrompt || classInfo?.lectureSttPrompt || classInfo?.lectureRecordingPrompt || null;
    const initialSttText = rec.customSttPrompt || rec.customPrompt || initialStt?.promptText || '';
    setRegenSttPrompt(initialStt);
    setRegenSttPromptText(initialSttText);
    setRegenPrompt(initialStt);
    setRegenPromptText(initialSttText);

    const initialTrans = rec.lectureTranslationPrompt || classInfo?.lectureTranslationPrompt || null;
    const initialTransText = rec.customTranslationPrompt || initialTrans?.promptText || '';
    setRegenTransPrompt(initialTrans);
    setRegenTransPromptText(initialTransText);

    const initialLangs = (Array.isArray(rec.targetLanguages) && rec.targetLanguages.length > 0)
      ? rec.targetLanguages
      : (Array.isArray(classInfo?.lectureTargetLanguages) && classInfo?.lectureTargetLanguages.length > 0)
        ? classInfo?.lectureTargetLanguages
        : ['en', 'zh-Hant', 'zh-Hans'];
    setRegenLanguages(initialLangs);

    const candidateModel = rec.aiModelUsed || classInfo?.lectureAiModel || 'gemini-3.8-flash';
    const initialModel = (candidateModel && !candidateModel.includes('2.5')) ? candidateModel : 'gemini-3.8-flash';
    setRegenModel(initialModel);
    setShowRegenModal(true);
  };

  const handleExecuteRegenSubtitles = async () => {
    if (!selectedRecording) return;
    setIsRetryingSubtitles(true);
    setShowRegenModal(false);
    try {
      const callSubtitles = httpsCallable(functions, 'processLectureSubtitles', { timeout: 600000 });
      const effectiveStt = regenSttPrompt || regenPrompt;
      const effectiveSttText = (regenSttPromptText || regenPromptText || '').trim();
      const effectiveTrans = regenTransPrompt;
      const effectiveTransText = (regenTransPromptText || '').trim();

      await callSubtitles({
        classId,
        sessionId: selectedRecording.id,
        storagePath: selectedRecording.storagePath,
        title: selectedRecording.title,
        topic: selectedRecording.topic,
        isManualTrigger: true,
        sttPromptId: effectiveStt?.id || null,
        customSttPrompt: effectiveSttText || undefined,
        translationPromptId: effectiveTrans?.id || null,
        customTranslationPrompt: effectiveTransText || undefined,
        // Legacy parameter fallbacks
        promptId: effectiveStt?.id || null,
        customPrompt: effectiveSttText || undefined,
        targetLanguages: regenLanguages,
        preferredModel: regenModel,
      });
    } catch (err) {
      console.error('[LectureRecordingsView] Subtitle generation failed:', err);
      if (err.code === 'functions/deadline-exceeded' || err.message?.includes('deadline-exceeded')) {
        console.info('[LectureRecordingsView] Subtitle request exceeded client connection window; generation is proceeding in background.');
      } else {
        alert(`Failed to trigger subtitle generation: ${err.message}`);
      }
    } finally {
      setIsRetryingSubtitles(false);
    }
  };

  const handleTriggerSubtitles = () => {
    handleOpenRegenModal(selectedRecording);
  };

  // Download complete YouTube Package (.zip)
  const handleDownloadYouTubePackage = async () => {
    if (!selectedRecording) return;
    setIsExportingZip(true);
    setExportProgress('Preparing package...');

    try {
      const zip = new JSZip();
      const folderName = `${classId}_Lecture_${selectedRecording.id}`;
      const pkgFolder = zip.folder(folderName);

      // 1. YouTube Metadata File (Title, description, timestamps)
      const ytTitle = selectedRecording.youtubeMetadata?.title || `${classId} - ${selectedRecording.title}`;
      const ytDesc = selectedRecording.youtubeMetadata?.description || 'Classroom Lecture Recording';
      const metadataContent = `YOUTUBE UPLOAD METADATA\n=======================\n\nTITLE:\n${ytTitle}\n\nDESCRIPTION & CHAPTER TIMESTAMPS:\n${ytDesc}\n`;
      pkgFolder.file('youtube_metadata.txt', metadataContent);

      // 2. Fetch and package SubRip (.srt) tracks
      setExportProgress('Fetching subtitle tracks (.srt)...');
      if (selectedRecording.srtUrls) {
        for (const [lang, url] of Object.entries(selectedRecording.srtUrls)) {
          try {
            const res = await fetch(url);
            if (res.ok) {
              const srtText = await res.text();
              pkgFolder.file(`subtitles_${lang}.srt`, srtText);
            }
          } catch (fetchErr) {
            console.warn(`[LectureRecordingsView] Could not fetch SRT for ${lang}:`, fetchErr);
          }
        }
      }

      // 3. Include Instructions & Direct Video Download Link
      const ext = selectedRecording.mimeType?.includes('mp4') ? 'mp4' : 'webm';
      const instructions = `HOW TO UPLOAD TO YOUTUBE CREATOR STUDIO:
1. Open YouTube Studio (https://studio.youtube.com).
2. Click 'Create' -> 'Upload videos' and upload your clean video (${selectedRecording.videoUrl}).
3. Copy and paste the Title & Description from 'youtube_metadata.txt'.
4. In the 'Subtitles' section:
   - Click 'Add' subtitle track.
   - Select 'Upload file' -> 'With timing'.
   - Drag in 'subtitles_en.srt' (English), 'subtitles_zh-Hant.srt' (Traditional Chinese), etc.
5. Set Visibility to 'Unlisted' so only your students can access the link.`;

      pkgFolder.file('README_YOUTUBE_INSTRUCTIONS.txt', instructions);

      setExportProgress('Zipping files...');
      const zipBlob = await zip.generateAsync({ type: 'blob' });

      // Trigger browser download
      const downloadUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `${folderName}_YouTube_Package.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('[LectureRecordingsView] Failed to generate YouTube zip:', err);
      alert(`Failed to export YouTube package: ${err.message}`);
    } finally {
      setIsExportingZip(false);
      setExportProgress('');
    }
  };

  const getStatusBadge = (status, rec) => {
    const startedMs = rec?.startedAt?.toDate
      ? rec.startedAt.toDate().getTime()
      : rec?.startedAt
      ? new Date(rec.startedAt).getTime()
      : 0;
    const isStaleRecording = status === 'recording' && startedMs && (Date.now() - startedMs > 2 * 3600 * 1000);

    if (isStaleRecording && !rec?.videoUrl) {
      return <span className="recording-status-badge status-failed">⚠️ Incomplete / Interrupted</span>;
    }

    if (rec?.hasMissingSegment) {
      if (status === 'ready') {
        return <span className="recording-status-badge status-warning" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>⚠️ Combined (Gap Remarked)</span>;
      }
      return <span className="recording-status-badge status-warning" style={{ background: '#fef3c7', color: '#92400e', borderColor: '#fde68a' }}>⚠️ Rest Preserved</span>;
    }

    switch (status) {
      case 'ready':
        if (rec.subtitlesDisabled && (!rec.vttUrls || Object.keys(rec.vttUrls).length === 0)) {
          return <span className="recording-status-badge status-warning" style={{ background: '#f1f5f9', color: '#475569', borderColor: '#cbd5e1' }}>⏸️ Video Ready (CC Skipped)</span>;
        }
        return <span className="recording-status-badge status-ready">✅ Ready (Multi-CC)</span>;
      case 'generating_subtitles':
      case 'processing_subtitles':
        return <span className="recording-status-badge status-processing">🤖 Gemini Transcribing...</span>;
      case 'recording':
        return <span className="recording-status-badge status-recording">🔴 Live Recording</span>;
      case 'subtitles_failed':
        return <span className="recording-status-badge status-failed">⚠️ CC Needs Retry</span>;
      default:
        return <span className="recording-status-badge status-failed">{status || 'Processing'}</span>;
    }
  };

  return (
    <div className="lecture-recordings-container">
      <div className="lecture-recordings-header">
        <h2>🎥 Lecture Recordings & YouTube CC ({classId})</h2>
        {onBack && (
          <button className="btn-secondary" onClick={onBack}>
            ← Back to Classroom
          </button>
        )}
      </div>

      {/* Tier 1: Class-Level Student Sharing Master Switch */}
      {classInfo && (
        <div
          className={`class-sharing-control-bar ${classPolicy !== 'private' ? 'is-enabled' : 'is-disabled'}`}
          style={{
            marginBottom: '16px',
            padding: '12px 18px',
            borderRadius: '8px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '12px',
            background: classPolicy === 'always_shared' ? '#eff6ff' : classPolicy === 'selective' ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${classPolicy === 'always_shared' ? '#93c5fd' : classPolicy === 'selective' ? '#86efac' : '#fde68a'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.4rem' }}>
              {classPolicy === 'always_shared' ? '🌐' : classPolicy === 'selective' ? '👥' : '🔒'}
            </span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem', color: classPolicy === 'always_shared' ? '#1d4ed8' : classPolicy === 'selective' ? '#166534' : '#92400e' }}>
                {classPolicy === 'always_shared'
                  ? 'Class Student Access: Always Shared (Automatic)'
                  : classPolicy === 'selective'
                  ? 'Class-Level Student Sharing: Enabled (Selective)'
                  : 'Class-Level Student Sharing: Disabled (Default Deny)'}
              </div>
              <div style={{ fontSize: '0.82rem', color: classPolicy === 'always_shared' ? '#2563eb' : classPolicy === 'selective' ? '#15803d' : '#b45309', marginTop: '2px' }}>
                {classPolicy === 'always_shared'
                  ? 'All recordings in this class are automatically visible to enrolled students without needing manual per-video sharing.'
                  : classPolicy === 'selective'
                  ? 'Enrolled students can access the Teacher Lectures tab and view any recordings marked as "👥 Shared".'
                  : 'All recordings in this class are currently kept private to instructors. Students cannot view any lectures until class sharing is enabled.'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {classPolicy === 'always_shared' && (
              <button
                type="button"
                onClick={() => handleSetClassPolicy('selective')}
                disabled={isClassSharingToggling}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                }}
              >
                👥 Switch to Selective
              </button>
            )}

            {classPolicy === 'selective' && (
              <button
                type="button"
                onClick={() => handleSetClassPolicy('always_shared')}
                disabled={isClassSharingToggling}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  border: 'none',
                  background: '#3b82f6',
                  color: '#ffffff',
                }}
              >
                🌐 Always Share All
              </button>
            )}

            {classPolicy === 'private' && (
              <button
                type="button"
                onClick={() => handleSetClassPolicy('always_shared')}
                disabled={isClassSharingToggling}
                style={{
                  padding: '8px 14px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#334155',
                }}
              >
                🌐 Always Share All
              </button>
            )}

            <button
              type="button"
              className="btn-toggle-class-sharing"
              onClick={handleToggleClassSharing}
              disabled={isClassSharingToggling}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                fontWeight: 600,
                fontSize: '0.85rem',
                cursor: 'pointer',
                border: 'none',
                background: classPolicy !== 'private' ? '#fee2e2' : '#2563eb',
                color: classPolicy !== 'private' ? '#991b1b' : '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isClassSharingToggling
                ? '⏳ Updating...'
                : classPolicy !== 'private'
                ? '🔒 Revoke Class Student Access'
                : '📢 Enable Student Access for Class'}
            </button>
          </div>
        </div>
      )}

      {unmergedGroups.length > 0 && (
        <div className="unmerged-groups-container">
          {unmergedGroups.map((grp) => (
            <div key={grp.groupId} className="merge-alert-banner">
              <div className="merge-alert-info">
                <span className="merge-alert-icon">💡</span>
                <div>
                  <div className="merge-alert-heading">
                    {grp.count} separate recording clips detected from {grp.dateLabel}
                  </div>
                  <div className="merge-alert-subtext">
                    Total lecture duration: {formatDuration(grp.totalDuration)}. Would you like to merge them into a single continuous full lecture?
                  </div>
                </div>
              </div>
              <button
                className="btn-merge-action"
                onClick={() => handleMergeClips(grp.groupId, grp.clips.map((c) => c.id))}
                disabled={isMerging}
              >
                {isMerging ? '⏳ Merging clips with ffmpeg...' : '🔗 Merge into Full Lecture'}
              </button>
            </div>
          ))}
        </div>
      )}

      {mergeFeedback && (
        <div className="merge-feedback-banner">
          <span>⚙️ {mergeFeedback}</span>
        </div>
      )}

      {loading ? (
        <div className="empty-state">
          <p>Loading lecture recordings...</p>
        </div>
      ) : recordings.length === 0 ? (
        <div className="empty-state">
          <p>No lecture recordings found for class <strong>{classId}</strong>.</p>
          <p style={{ fontSize: '0.9rem', color: '#718096' }}>
            Start screen sharing and turn on <strong>"Record Lecture for YouTube"</strong> to create a recording.
          </p>
        </div>
      ) : (
        <div className="lecture-recordings-grid">
          {/* Recordings List */}
          <div className="recordings-list-panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', color: '#4a5568' }}>
                  Past Lectures ({filteredRecordings.length}{recordings.length !== filteredRecordings.length ? ` of ${recordings.length}` : ''})
                </h3>
                {lessons && lessons.length > 0 && (
                  <select
                    id="teacher-lesson-filter-select"
                    aria-label="Filter recordings by lesson:"
                    value={selectedLessonFilter}
                    onChange={(e) => setSelectedLessonFilter(e.target.value)}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                      color: '#334155',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    <option value="all">🌐 All Lessons ({recordings.length})</option>
                    {lessons.map((l) => {
                      const lCount = recordings.filter((r) => isRecordInLesson(r, l)).length;
                      const dateStr = l.start instanceof Date
                        ? l.start.toLocaleDateString()
                        : (l.startTime ? new Date(l.startTime).toLocaleDateString() : l.title || l.id);
                      return (
                        <option key={l.id || l.lessonId} value={l.id || l.lessonId}>
                          📅 {l.title || dateStr} ({lCount})
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
              <button
                className="btn-toggle-merge"
                onClick={() => {
                  setIsSelectionMode(!isSelectionMode);
                  setSelectedIdsToMerge([]);
                }}
              >
                {isSelectionMode ? 'Cancel Selection' : '🔗 Custom Merge'}
              </button>
            </div>

            {isSelectionMode && (
              <div className="merge-selection-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span>Selected: <strong>{selectedIdsToMerge.length}</strong> clip{selectedIdsToMerge.length === 1 ? '' : 's'}</span>
                  <button
                    type="button"
                    className="btn-select-all-toggle"
                    onClick={() => {
                      const mergeableClips = filteredRecordings.filter(
                        (r) => !r.isCombined && (r.storagePath || r.videoUrl) && r.status !== 'recording' && r.status !== 'discarded'
                      );
                      const mergeableIds = mergeableClips.map((r) => r.id);
                      if (selectedIdsToMerge.length === mergeableIds.length && mergeableIds.length > 0) {
                        setSelectedIdsToMerge([]);
                      } else {
                        setSelectedIdsToMerge(mergeableIds);
                      }
                    }}
                  >
                    {selectedIdsToMerge.length > 0 &&
                     selectedIdsToMerge.length === filteredRecordings.filter(
                       (r) => !r.isCombined && (r.storagePath || r.videoUrl) && r.status !== 'recording' && r.status !== 'discarded'
                     ).length
                      ? '✕ Deselect All'
                      : '✓ Select All Mergeable'}
                  </button>
                </div>
                <button
                  className="btn-merge-action btn-sm"
                  disabled={selectedIdsToMerge.length < 2 || isMerging}
                  onClick={() => handleMergeClips('custom', selectedIdsToMerge)}
                  title={selectedIdsToMerge.length < 2 ? 'Select at least 2 clips to merge' : 'Merge selected clips with ffmpeg'}
                >
                  {isMerging ? '⏳ Merging...' : `🔗 Merge Selected (${selectedIdsToMerge.length})`}
                </button>
              </div>
            )}

            {filteredRecordings.length === 0 ? (
              <div style={{ padding: '24px 12px', textAlign: 'center', color: '#64748b' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>🔍</div>
                <p style={{ margin: 0, fontSize: '0.9rem' }}>No recordings found for this lesson.</p>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ marginTop: '12px', fontSize: '0.8rem' }}
                  onClick={() => setSelectedLessonFilter('all')}
                >
                  🌐 Show All Lessons ({recordings.length})
                </button>
              </div>
            ) : (
              filteredRecordings.map((rec) => {
                const isSelected = rec.id === selectedRecordingId;
                const matchedLesson = (lessons || []).find((l) => isRecordInLesson(rec, l));
                const dateStr = rec.startedAt?.toDate
                  ? rec.startedAt.toDate().toLocaleString()
                  : rec.startedAt
                  ? new Date(rec.startedAt).toLocaleString()
                  : 'Recent';

                const isChecked = selectedIdsToMerge.includes(rec.id);
                const isMergeable = !rec.isCombined && (rec.storagePath || rec.videoUrl) && rec.status !== 'recording' && rec.status !== 'discarded';

                return (
                  <div
                    key={rec.id}
                    className={`recording-card ${isSelected ? 'active' : ''} ${isChecked ? 'selected-for-merge' : ''} ${isSelectionMode && !isMergeable ? 'disabled-merge' : ''}`}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === ' ' || e.key === 'Enter') {
                        e.preventDefault();
                        if (isSelectionMode) {
                          if (isMergeable) {
                            toggleSelectForMerge(rec.id, !isChecked);
                          }
                        } else {
                          setSelectedRecordingId(rec.id);
                        }
                      }
                    }}
                    onClick={() => {
                      if (isSelectionMode) {
                        if (isMergeable) {
                          toggleSelectForMerge(rec.id, !isChecked);
                        }
                      } else {
                        setSelectedRecordingId(rec.id);
                      }
                    }}
                  >
                    <div className="recording-card-select">
                      {isSelectionMode && (
                        <input
                          type="checkbox"
                          className="recording-checkbox"
                          checked={isChecked}
                          disabled={!isMergeable}
                          title={rec.isCombined ? 'Already a combined full lecture' : (!rec.storagePath && !rec.videoUrl) ? 'Recording media not available' : 'Select clip to merge'}
                          aria-label={`Select ${rec.title || 'recording'} for merge`}
                          onClick={(e) => {
                            e.stopPropagation();
                          }}
                          onChange={(e) => {
                            e.stopPropagation();
                            if (isMergeable) {
                              toggleSelectForMerge(rec.id, e.target.checked);
                            }
                          }}
                        />
                      )}
                      <div style={{ flex: 1 }}>
                        <div className="recording-card-title">{rec.title || 'Classroom Lecture'}</div>
                        <div className="recording-card-meta">
                          <span>📅 {dateStr}</span>
                          {matchedLesson && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background: '#f1f5f9',
                                border: '1px solid #e2e8f0',
                                fontSize: '0.75rem',
                                color: '#475569',
                                fontWeight: 600,
                              }}
                              title={`Associated with lesson ${matchedLesson.title || 'schedule slot'}`}
                            >
                              📅 {matchedLesson.title || 'Lesson'}
                            </span>
                          )}
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <span>⏱️ {formatDuration(rec.durationSeconds || 0)}</span>
                            {rec.fileSize ? <span>• 📦 {formatFileSize(rec.fileSize)}</span> : null}
                            {rec.isCombined ? (
                              <span className="badge-pill-combined">🌟 Combined Full Lecture</span>
                            ) : rec.isFragment ? (
                              <span className="badge-pill-fragment">✂️ Part {rec.fragmentIndex || 1}</span>
                            ) : rec.durationSeconds >= 600 ? (
                              <span className="badge-pill-full">🌟 Full Lecture</span>
                            ) : (
                              <span className="badge-pill-clip">✂️ Clip</span>
                            )}
                            {rec.youtubeVideoId && (
                              <span className="badge-pill-youtube">📺 YouTube</span>
                            )}
                            {rec.driveFileId && (
                              <span className="badge-pill-drive">📁 Drive</span>
                            )}
                            {rec.aiModelUsed && (
                              <span className="badge-pill-clip" style={{ background: '#f1f5f9', color: '#475569', fontSize: '0.72rem' }}>
                                🤖 {rec.aiModelUsed}
                              </span>
                            )}
                            {rec.aiCost !== undefined && rec.aiCost !== null && (
                              <span
                                className="badge-pill-clip"
                                style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', fontSize: '0.72rem', fontWeight: 600 }}
                                title={`AI Subtitle Processing Cost: $${Number(rec.aiCost).toFixed(4)} USD`}
                              >
                                💰 {formatAiCost(rec.aiCost)}
                              </span>
                            )}
                            {classPolicy === 'always_shared' || rec.isSharedWithStudents ? (
                              <span className="badge-pill-shared" title="Enrolled students can view this video">
                                👥 Shared
                              </span>
                            ) : (
                              <span className="badge-pill-private" title="Private to instructor">
                                🔒 Private
                              </span>
                            )}
                          </span>
                          {rec.topic && <span>📌 Topic: {rec.topic}</span>}
                          {rec.isFragment && rec.mergedIntoSessionId && (
                            <span style={{ fontSize: '0.75rem', color: '#718096', fontStyle: 'italic' }}>
                              (Merged into master lecture)
                            </span>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px', marginTop: '4px' }}>
                          {getStatusBadge(rec.status, rec)}
                          {(rec.subtitlesDisabled || rec.status === 'subtitles_failed' || (!rec.vttUrls && rec.status === 'ready')) && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleOpenRegenModal(rec);
                              }}
                              style={{
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                color: '#1d4ed8',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Generate subtitles and CC with Gemini"
                            >
                              🔄 CC
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Detailed Player & YouTube Studio Export Panel */}
          {selectedRecording && (
            <div className="recording-detail-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#2d3748' }}>
                  {selectedRecording.title || 'Lecture Recording'}
                </h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => handleOpenRegenModal(selectedRecording)}
                    disabled={isRetryingSubtitles}
                    title="Configure AI model, target languages, and custom prompt to synthesize CC subtitles on demand"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontWeight: 600, padding: '7px 14px' }}
                  >
                    <span>🔄</span>
                    <span>{isRetryingSubtitles ? 'Invoking Gemini...' : 'Re-generate Subtitles & CC'}</span>
                  </button>
                  <button
                    type="button"
                    className={`btn-share-recording ${selectedRecording.isSharedWithStudents ? 'is-shared' : ''}`}
                    onClick={() => handleToggleShareWithStudents(selectedRecording.id, selectedRecording.isSharedWithStudents)}
                    disabled={isSharingToggling}
                    title={selectedRecording.isSharedWithStudents ? 'Click to revoke student access for this lecture' : 'Click to share this lecture with enrolled students'}
                  >
                    {isSharingToggling ? '⏳ Updating...' : selectedRecording.isSharedWithStudents ? '👥 Shared with Students' : '📢 Share with Students'}
                  </button>
                  <button
                    className="btn-delete-recording"
                    onClick={() => handleDeleteRecording(selectedRecording.id)}
                    disabled={isDeleting}
                    title="Permanently delete recording, video, audio & subtitle files"
                  >
                    {isDeleting ? '🗑️ Deleting...' : '🗑️ Delete Recording'}
                  </button>
                </div>
                <div style={{ width: '100%', fontSize: '0.8rem', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  {selectedRecording.aiCost !== undefined && selectedRecording.aiCost !== null && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: '4px',
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#166534',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                      }}
                      title="Gemini AI transcription, chaptering & translation cost for this lecture recording"
                    >
                      💰 AI Processing Cost: {formatAiCost(selectedRecording.aiCost)}
                      {selectedRecording.aiModelUsed && ` (${selectedRecording.aiModelUsed})`}
                    </span>
                  )}
                  {classPolicy === 'always_shared' ? (
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>
                      🌐 Automatically shared with enrolled students (Class Policy: Always Share)
                    </span>
                  ) : classPolicy === 'private' && selectedRecording.isSharedWithStudents ? (
                    <span style={{ color: '#b45309', fontWeight: 600 }}>
                      ⚠️ Marked as shared, but Class Sharing is currently set to Private (Default Deny). Students cannot view it until class sharing is enabled.
                    </span>
                  ) : selectedRecording.isSharedWithStudents ? (
                    <span style={{ color: '#16a34a', fontWeight: 600 }}>
                      ✓ Shared with enrolled students for {(lessons || []).find((l) => isRecordInLesson(selectedRecording, l))?.title || selectedRecording.lessonTitle || selectedRecording.title || 'this lesson'}
                    </span>
                  ) : (
                    <span style={{ color: '#64748b' }}>
                      🔒 Kept private to instructor (not visible to students)
                    </span>
                  )}
                </div>
              </div>

              {shareFeedback && (
                <div className="share-feedback-toast" style={{ marginBottom: '12px', padding: '8px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: 600, background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0' }}>
                  ✅ {shareFeedback}
                </div>
              )}

              {classInfo && classPolicy === 'private' && (
                <div className="class-sharing-warning-banner" style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '0.85rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                    <span>
                      <strong>Class Sharing Disabled:</strong> Enrolled students cannot access shared lecture recordings until class sharing is enabled.
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleClassSharing}
                    disabled={isClassSharingToggling}
                    style={{ padding: '4px 10px', fontSize: '0.8rem', fontWeight: 600, background: '#d97706', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
                  >
                    {isClassSharingToggling ? 'Updating...' : 'Enable for Class'}
                  </button>
                </div>
              )}

              {/* Verified Duration & Session Info Banner */}
              <div className="lecture-duration-banner">
                <span className="duration-pill">
                  ⏱️ Verified Length: <strong>{formatDuration(selectedRecording.durationSeconds || 0)}</strong>
                </span>
                {selectedRecording.fileSize && (
                  <span className="filesize-pill">
                    📦 Video Size: <strong>{formatFileSize(selectedRecording.fileSize)}</strong>
                  </span>
                )}
                {selectedRecording.durationSeconds >= 600 ? (
                  <span className="badge-pill-full">🌟 Full Lecture Session</span>
                ) : (
                  <span className="badge-pill-clip">✂️ Short Recording Clip</span>
                )}
                {selectedRecording.aiModelUsed && (
                  <span className="filesize-pill" style={{ background: '#f8fafc', color: '#334155' }}>
                    🤖 AI Model: <strong>{selectedRecording.aiModelUsed}</strong>
                  </span>
                )}
              </div>

              {/* On-Demand Subtitles Notice Banner (when CC skipped by class policy or not yet generated) */}
              {(!selectedRecording.vttUrls || Object.keys(selectedRecording.vttUrls).length === 0 || selectedRecording.subtitlesDisabled) && selectedRecording.status !== 'recording' && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '12px',
                    padding: '12px 16px',
                    backgroundColor: '#eff6ff',
                    border: '1.5px solid #bfdbfe',
                    borderRadius: '8px',
                    marginBottom: '16px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '1.5rem', lineHeight: 1 }}>💬</span>
                    <div>
                      <strong style={{ display: 'block', color: '#1e40af', fontSize: '0.92rem' }}>
                        {selectedRecording.subtitlesDisabled
                          ? 'Automated Subtitles Were Skipped for this Lecture'
                          : selectedRecording.status === 'subtitles_failed'
                          ? 'Subtitle Generation Needs Retry'
                          : 'No Multilingual CC Subtitles Generated Yet'}
                      </strong>
                      <span style={{ fontSize: '0.8rem', color: '#3b82f6' }}>
                        {selectedRecording.subtitlesDisabled
                          ? 'Automated AI processing was turned off for this class to save quota. You can synthesize CC on demand.'
                          : 'Generate timestamped transcripts, YouTube chapters, and multilingual subtitles with Gemini AI.'}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenRegenModal(selectedRecording)}
                    disabled={isRetryingSubtitles}
                    style={{
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      cursor: isRetryingSubtitles ? 'not-allowed' : 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    }}
                  >
                    <span>🚀</span>
                    <span>{isRetryingSubtitles ? 'Invoking Gemini...' : 'Generate CC On-Demand (Select Prompt & Model)'}</span>
                  </button>
                </div>
              )}

              {/* Multi-Player Switcher (when YouTube or Google Drive is linked) */}
              {(selectedRecording.youtubeVideoId || selectedRecording.driveFileId) && (
                <div className="player-mode-switcher">
                  {selectedRecording.youtubeVideoId && (
                    <button
                      className={`player-mode-tab ${activePlayerMode === 'youtube' ? 'active' : ''}`}
                      onClick={() => setActivePlayerMode('youtube')}
                    >
                      📺 YouTube Stream (Fast & Adaptive)
                    </button>
                  )}
                  {selectedRecording.driveFileId && (
                    <button
                      type="button"
                      className={`player-mode-tab ${activePlayerMode === 'drive' ? 'active' : ''}`}
                      onClick={() => setActivePlayerMode('drive')}
                    >
                      📁 Google Drive Stream (⚠️ No CC)
                    </button>
                  )}
                  <button
                    type="button"
                    className={`player-mode-tab ${activePlayerMode === 'cloud' ? 'active' : ''}`}
                    onClick={() => setActivePlayerMode('cloud')}
                  >
                    🎞️ Cloud Storage HTML5 Player (💬 Multilingual CC)
                  </button>
                  {selectedRecording.youtubeUrl && (
                    <a
                      href={selectedRecording.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-open-youtube-external"
                    >
                      ▶️ Open on YouTube ↗
                    </a>
                  )}
                  {(selectedRecording.driveWebViewLink || selectedRecording.driveFileId) && (
                    <a
                      href={selectedRecording.driveWebViewLink || `https://drive.google.com/file/d/${selectedRecording.driveFileId}/view`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn-open-drive-external"
                    >
                      📂 Open in Drive ↗
                    </a>
                  )}
                </div>
              )}

              {/* Recording Interruption & Gap Notice */}
              {selectedRecording.hasMissingSegment && selectedRecording.interruptionRemarks && (
                <div
                  className="recording-interruption-notice-box"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                    padding: '12px 16px',
                    backgroundColor: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: '8px',
                    color: '#92400e',
                    fontSize: '0.9rem',
                    marginBottom: '16px',
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>⚠️</span>
                  <div>
                    <strong style={{ display: 'block', marginBottom: '2px', color: '#78350f' }}>
                      Lecture Interruption & Crash Recovery Notice
                    </strong>
                    <span>{selectedRecording.interruptionRemarks}</span>
                  </div>
                </div>
              )}

              {/* Player Area: YouTube Embed, Google Drive Embed, or Native HTML5 Video */}
              {activePlayerMode === 'youtube' && selectedRecording.youtubeVideoId ? (
                <div className="lecture-youtube-player-box">
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${selectedRecording.youtubeVideoId}?rel=0`}
                    title={selectedRecording.title || 'Classroom Lecture Video'}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    className="lecture-youtube-iframe"
                  />
                </div>
              ) : activePlayerMode === 'drive' && (selectedRecording.driveEmbedUrl || selectedRecording.driveFileId) ? (
                <div>
                  <div className="lecture-drive-player-box">
                    <iframe
                      src={selectedRecording.driveEmbedUrl || `https://drive.google.com/file/d/${selectedRecording.driveFileId}/preview`}
                      title={selectedRecording.title || 'Google Drive Classroom Video'}
                      frameBorder="0"
                      allow="autoplay; encrypted-media"
                      allowFullScreen
                      className="lecture-drive-iframe"
                    />
                  </div>
                  {selectedRecording.vttUrls && Object.keys(selectedRecording.vttUrls).length > 0 && (
                    <div className="drive-no-cc-banner" data-testid="drive-no-cc-banner">
                      <div className="drive-no-cc-banner-header">
                        <span style={{ fontSize: '1.25rem', lineHeight: 1 }}>⚠️</span>
                        <div>
                          <strong>Google Drive Preview does not support external CC subtitles.</strong>
                          <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#475569' }}>
                            Subtitles ({Object.keys(selectedRecording.vttUrls).map((k) => getSubtitleLanguageLabel(k)).join(', ')}) are available in the <strong>Cloud Storage HTML5 Player</strong>.
                            Click any language below to watch with subtitles:
                          </p>
                        </div>
                      </div>
                      <div className="subtitle-lang-buttons">
                        {Object.keys(selectedRecording.vttUrls).map((langKey) => {
                          const langConfig = SUBTITLE_LANGUAGES.find((l) => l.code === langKey);
                          const label = langConfig ? `${langConfig.icon} ${langConfig.label}` : langKey.toUpperCase();
                          return (
                            <button
                              key={langKey}
                              type="button"
                              className="btn-sub-lang"
                              onClick={() => handleSelectSubtitleLangFromDrive(langKey)}
                              title={`Switch to Cloud Player with ${label} Subtitles`}
                            >
                              {label} (Cloud Player)
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className="action-btn-sm action-btn-primary"
                          style={{ fontWeight: 600, padding: '6px 12px' }}
                          onClick={() => setActivePlayerMode('cloud')}
                        >
                          🎞️ Switch to Cloud Player
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedRecording.videoUrl ? (
                <div>
                  <div className="lecture-video-player-box">
                    <video
                      ref={videoRef}
                      key={selectedRecording.videoUrl}
                      controls
                      playsInline
                      crossOrigin="anonymous"
                      onLoadedMetadata={(e) => {
                        const vid = e.currentTarget;
                        fixWebmPlaybackDuration(vid, selectedRecording?.durationSeconds, (v) => {
                          applySubtitleTrack(v, selectedSubtitleLang);
                        });
                      }}
                      onEnded={(e) => handleVideoEndedGuard(e, selectedRecording?.durationSeconds)}
                    >
                      <source
                        src={selectedRecording.videoUrl}
                        type={selectedRecording.mimeType || 'video/webm'}
                      />
                      {/* Multilingual Closed Caption Tracks (dynamic) */}
                      {selectedRecording.vttUrls &&
                        Object.entries(selectedRecording.vttUrls).map(([langKey, url]) => {
                          const langConfig = SUBTITLE_LANGUAGES.find((l) => l.code === langKey);
                          const label = langConfig ? `${langConfig.icon} ${langConfig.label}` : langKey.toUpperCase();
                          const bcp47 = langConfig?.bcp47 || langKey;
                          return (
                            <track
                              key={langKey}
                              kind="subtitles"
                              src={url}
                              srcLang={bcp47}
                              label={label}
                              default={selectedSubtitleLang === langKey}
                            />
                          );
                        })}
                      Your browser does not support HTML5 video playback.
                    </video>
                  </div>

                  {/* Subtitle / CC Language Selector Toolbar */}
                  {selectedRecording.vttUrls && Object.keys(selectedRecording.vttUrls).length > 0 && (
                    <div className="subtitle-language-toolbar" data-testid="subtitle-language-toolbar" role="region" aria-label="Subtitle Language Selector">
                      <div className="subtitle-toolbar-header">
                        <span className="subtitle-toolbar-title">
                          💬 <strong>Subtitles / CC Language:</strong>
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span className="subtitle-toolbar-badge">
                            Active: {getSubtitleLanguageLabel(selectedSubtitleLang)}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleOpenRegenModal(selectedRecording)}
                            disabled={isRetryingSubtitles}
                            title="Regenerate subtitles with different prompt, languages, or AI model"
                            style={{
                              background: '#eff6ff',
                              border: '1px solid #bfdbfe',
                              color: '#1d4ed8',
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <span>🔄</span>
                            <span>{isRetryingSubtitles ? 'Generating...' : 'Re-generate CC'}</span>
                          </button>
                        </div>
                      </div>
                      <div className="subtitle-lang-buttons">
                        {Object.keys(selectedRecording.vttUrls).map((langKey) => {
                          const langConfig = SUBTITLE_LANGUAGES.find((l) => l.code === langKey);
                          const label = langConfig ? `${langConfig.icon} ${langConfig.label}` : langKey.toUpperCase();
                          const isActive = selectedSubtitleLang === langKey;
                          return (
                            <button
                              key={langKey}
                              type="button"
                              className={`btn-sub-lang ${isActive ? 'active' : ''}`}
                              onClick={() => handleSelectSubtitleLang(langKey)}
                              title={`Switch to ${label} Subtitles`}
                              aria-pressed={isActive}
                            >
                              {label}
                            </button>
                          );
                        })}
                        <button
                          type="button"
                          className={`btn-sub-lang btn-sub-lang-off ${selectedSubtitleLang === 'off' ? 'active' : ''}`}
                          onClick={() => handleSelectSubtitleLang('off')}
                          title="Turn Subtitles Off"
                          aria-pressed={selectedSubtitleLang === 'off'}
                        >
                          🚫 Off (關閉)
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-state" style={{ padding: '2rem 1.5rem', textAlign: 'center', background: '#f8fafc', borderRadius: '8px', border: '1px dashed #cbd5e1' }}>
                  {selectedRecording.status === 'recording' || !selectedRecording.videoUrl ? (
                    <div>
                      <div style={{ fontSize: '1.8rem', marginBottom: '8px' }}>⚠️</div>
                      <h4 style={{ margin: '0 0 6px', color: '#b91c1c', fontSize: '1.05rem' }}>Unfinalized / Processing Recording Session</h4>
                      <p style={{ color: '#64748b', fontSize: '0.88rem', maxWidth: '520px', margin: '0 auto 16px', lineHeight: 1.5 }}>
                        This recording is waiting for final video synchronization or was interrupted while uploading. If media files exist in Cloud Storage, click below to automatically recover them.
                      </p>
                      {reconcileFeedback && (
                        <div style={{ color: '#15803d', fontWeight: 600, fontSize: '0.88rem', marginBottom: '14px' }}>
                          ✅ {reconcileFeedback}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                          className="btn-secondary"
                          onClick={handleAutoReconcile}
                          disabled={isReconciling}
                          style={{ margin: '0', background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe', fontWeight: 600 }}
                        >
                          {isReconciling ? '⏳ Checking Cloud Storage...' : '🔄 Auto-Recover from Cloud Storage'}
                        </button>
                        <button
                          className="btn-delete-recording"
                          onClick={() => handleDeleteRecording(selectedRecording.id)}
                          disabled={isDeleting}
                          style={{ margin: '0' }}
                        >
                          {isDeleting ? '🗑️ Removing...' : '🗑️ Remove Incomplete Entry'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>Video upload in progress or unavailable.</div>
                  )}
                </div>
              )}

              {/* YouTube Studio Export & Link Management Section (Phase 1) */}
              <div className="youtube-export-section">
                <div className="youtube-export-title" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  <span>📺 YouTube Studio & Publishing (Phase 1)</span>
                  {selectedRecording.youtubeVideoId ? (
                    <span className="badge-pill-youtube" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                      ✅ Published to YouTube: {selectedRecording.youtubeVideoId}
                    </span>
                  ) : (
                    <span className="badge-pill-clip" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                      ⏳ Ready for YouTube Upload
                    </span>
                  )}
                </div>

                {/* 3-Step Guided Workflow */}
                <div className="youtube-workflow-steps">
                  {/* Step 1: Download Media & Subtitles */}
                  <div className="youtube-step-card">
                    <div className="youtube-step-header">
                      <span className="youtube-step-number">1</span>
                      <strong>Download Video & Subtitles</strong>
                    </div>
                    <p className="youtube-step-desc">
                      Download the clean high-definition video and multilingual <code>.srt</code> caption tracks generated by Gemini.
                    </p>
                    <div className="youtube-step-actions">
                      <button
                        className="btn-youtube-export"
                        onClick={handleDownloadYouTubePackage}
                        disabled={isExportingZip || !selectedRecording.videoUrl}
                      >
                        {isExportingZip ? `📦 ${exportProgress}` : '📥 Download YouTube Package (.zip)'}
                      </button>

                      {selectedRecording.videoUrl && (
                        <button
                          className="btn-secondary"
                          onClick={handleDownloadVideoFile}
                          disabled={isDownloadingVideo}
                        >
                          {isDownloadingVideo ? '⏳ Downloading...' : '💾 Direct Video Download'}
                        </button>
                      )}
                      {downloadFeedback && (
                        <span style={{ fontSize: '0.8rem', color: '#2f855a', fontWeight: 600 }}>
                          ✅ {downloadFeedback}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Step 2: Upload to YouTube Studio */}
                  <div className="youtube-step-card">
                    <div className="youtube-step-header">
                      <span className="youtube-step-number">2</span>
                      <strong>Upload to YouTube Studio & Paste Metadata</strong>
                    </div>
                    <p className="youtube-step-desc">
                      Open YouTube Studio in any Google account (personal or Workspace), drag your video, and copy the formatted Title and Description with clickable chapters.
                    </p>
                    <div style={{ marginBottom: '10px' }}>
                      <a
                        href="https://studio.youtube.com/channel/upload"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-open-studio"
                      >
                        🚀 Open YouTube Studio Upload ↗
                      </a>
                    </div>

                    {/* Metadata Preview Box */}
                    {selectedRecording.youtubeMetadata && (
                      <div className="youtube-metadata-accordion">
                        <div style={{ marginTop: '10px', fontWeight: 600, fontSize: '0.85rem' }}>
                          YouTube Title:
                          <button
                            className="copy-button"
                            onClick={() => handleCopyText(selectedRecording.youtubeMetadata.title, 'Title copied!')}
                          >
                            📋 Copy Title
                          </button>
                        </div>
                        <div className="youtube-metadata-box">
                          {selectedRecording.youtubeMetadata.title}
                        </div>

                        <div style={{ marginTop: '10px', fontWeight: 600, fontSize: '0.85rem' }}>
                          Description & Chapters:
                          <button
                            className="copy-button"
                            onClick={() =>
                              handleCopyText(selectedRecording.youtubeMetadata.description, 'Description copied!')
                            }
                          >
                            📋 Copy Description
                          </button>
                        </div>
                        <div className="youtube-metadata-box">
                          {selectedRecording.youtubeMetadata.description}
                        </div>
                        {copyFeedback && (
                          <span style={{ fontSize: '0.8rem', color: '#2f855a', fontWeight: 600 }}>
                            ✅ {copyFeedback}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Step 3: Link YouTube URL */}
                  <div className="youtube-step-card">
                    <div className="youtube-step-header">
                      <span className="youtube-step-number">3</span>
                      <strong>Link YouTube Video to Classroom</strong>
                    </div>
                    <p className="youtube-step-desc">
                      Paste the published YouTube URL or Video ID below. Students can then watch the high-speed YouTube stream directly in this classroom.
                    </p>

                    <div className="youtube-link-box">
                      <div className="youtube-link-input-group">
                        <input
                          type="text"
                          className="youtube-link-input"
                          placeholder="e.g. https://youtu.be/dQw4w9WgXcQ or https://www.youtube.com/watch?v=..."
                          value={youtubeUrlInput}
                          onChange={(e) => {
                            setYoutubeUrlInput(e.target.value);
                            setIsEditingYouTube(true);
                          }}
                        />
                        <button
                          className="btn-save-youtube"
                          onClick={handleSaveYouTubeLink}
                          disabled={isSavingYouTube || !youtubeUrlInput.trim()}
                        >
                          {isSavingYouTube ? 'Saving...' : selectedRecording.youtubeVideoId ? 'Update Link' : '🔗 Save YouTube Link'}
                        </button>

                        {selectedRecording.youtubeVideoId && (
                          <button
                            className="btn-unlink-youtube"
                            onClick={handleUnlinkYouTube}
                            disabled={isSavingYouTube}
                            title="Unlink YouTube video from this recording"
                          >
                            Unlink
                          </button>
                        )}
                      </div>

                      {selectedRecording.youtubeUrl && (
                        <div style={{ marginTop: '8px', fontSize: '0.85rem', color: '#2b6cb0' }}>
                          Current URL: <a href={selectedRecording.youtubeUrl} target="_blank" rel="noopener noreferrer">{selectedRecording.youtubeUrl}</a>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Google Drive Integration Section */}
                <div className="gdrive-export-section">
                  <div className="gdrive-export-title" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span>📁 Google Drive Integration (Personal or Workspace)</span>
                    {selectedRecording.driveFileId ? (
                      <span className="badge-pill-drive" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                        ✅ Linked to Drive: {selectedRecording.driveFileId}
                      </span>
                    ) : isGdriveConfigured ? (
                      <span className="badge-pill-clip" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                        ⏳ Ready for Drive Upload
                      </span>
                    ) : (
                      <span className="badge-pill-clip" style={{ fontSize: '0.82rem', padding: '4px 10px', opacity: 0.65 }}>
                        🔒 Cloud Upload Disabled
                      </span>
                    )}
                  </div>

                  {/* Google Account Connection Status Bar */}
                  <div className="gdrive-status-bar">
                    {isGdriveConnected ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                        <div className="gdrive-connected-info">
                          <span>🟢 Connected: <strong>{gdriveUser?.email}</strong></span>
                          <button className="btn-disconnect-drive" onClick={disconnectGdrive}>
                            Disconnect
                          </button>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: '8px',
                            padding: '8px 12px',
                            backgroundColor: '#f8fafc',
                            border: '1px solid #e2e8f0',
                            borderRadius: '6px',
                            fontSize: '0.82rem',
                          }}
                        >
                          <div>
                            <span style={{ color: '#64748b' }}>📁 Destination Folder: </span>
                            <strong style={{ color: '#1e293b' }}>
                              {baseFolderName} / {classId || 'Class'} / {selectedRecording?.lessonTitle || selectedRecording?.title || 'General'} / Teacher Lectures
                            </strong>
                          </div>
                          {!isEditingBaseFolder ? (
                            <button
                              type="button"
                              onClick={() => {
                                setBaseFolderDraft(baseFolderName);
                                setIsEditingBaseFolder(true);
                              }}
                              style={{
                                background: '#ffffff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '4px',
                                padding: '2px 8px',
                                fontSize: '0.78rem',
                                color: '#334155',
                                cursor: 'pointer',
                              }}
                            >
                              ✏️ Edit Base Folder
                            </button>
                          ) : (
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                              <input
                                type="text"
                                value={baseFolderDraft}
                                onChange={(e) => setBaseFolderDraft(e.target.value)}
                                placeholder="e.g. Classroom Archives or IT114115"
                                style={{
                                  padding: '3px 8px',
                                  fontSize: '0.8rem',
                                  borderRadius: '4px',
                                  border: '1px solid #94a3b8',
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (baseFolderDraft.trim()) {
                                    setBaseFolderName(baseFolderDraft.trim());
                                  }
                                  setIsEditingBaseFolder(false);
                                }}
                                style={{
                                  background: '#2563eb',
                                  color: '#fff',
                                  border: 'none',
                                  borderRadius: '4px',
                                  padding: '3px 8px',
                                  fontSize: '0.78rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsEditingBaseFolder(false)}
                                style={{
                                  background: '#f1f5f9',
                                  color: '#475569',
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '4px',
                                  padding: '3px 8px',
                                  fontSize: '0.78rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : !isGdriveConfigured ? (
                      <div className="gdrive-connect-prompt unconfigured" style={{ flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#c53030', fontWeight: 600 }}>
                          <span>🔒 Google Drive direct cloud upload is disabled (not configured for this system).</span>
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '0.84rem', color: '#4a5568', lineHeight: 1.5 }}>
                          ⚠️ <strong>Warning:</strong> The configuration key <code>VITE_GOOGLE_CLIENT_ID</code> is not configured. Direct browser-to-drive streaming requires a Google OAuth 2.0 Web Client ID.
                        </div>
                        <details className="gdrive-instructions-details" style={{ marginTop: '10px', width: '100%' }}>
                          <summary className="gdrive-instructions-summary" style={{ cursor: 'pointer', fontWeight: 600, color: '#2b6cb0', fontSize: '0.85rem' }}>
                            📖 How to set VITE_GOOGLE_CLIENT_ID (Step-by-Step Instructions)
                          </summary>
                          <div className="gdrive-instructions-body" style={{ marginTop: '8px', padding: '12px 16px', background: '#f7fafc', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '0.83rem', color: '#2d3748', lineHeight: 1.6 }}>
                            <ol style={{ paddingLeft: '20px', margin: '4px 0 10px 0' }}>
                              <li>
                                <strong>Open Google Cloud Console:</strong> Navigate to <em>APIs & Services &gt; Credentials</em> in your GCP project.
                              </li>
                              <li>
                                <strong>Create Credentials:</strong> Click <em>+ Create Credentials &gt; OAuth client ID</em> and choose <strong>Web application</strong>.
                              </li>
                              <li>
                                <strong>Add Authorized JavaScript Origins:</strong> Add this site origin:
                                <div style={{ margin: '4px 0' }}>
                                  <code style={{ background: '#edf2f7', padding: '2px 6px', borderRadius: '4px' }}>
                                    {typeof window !== 'undefined' ? window.location.origin : 'https://it114115-2627.web.app'}
                                  </code>
                                </div>
                              </li>
                              <li>
                                <strong>Check Scopes:</strong> Under <em>OAuth consent screen</em>, ensure <code>https://www.googleapis.com/auth/drive.file</code> is added.
                              </li>
                              <li>
                                <strong>Set Configuration Key:</strong> Open <code>web-app/.env.prod</code> (for production) or <code>web-app/.env.dev</code> (for dev) and set:
                                <pre style={{ background: '#edf2f7', padding: '6px 10px', borderRadius: '4px', margin: '6px 0', overflowX: 'auto', fontSize: '0.8rem' }}>
VITE_GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
                                </pre>
                              </li>
                              <li>
                                <strong>Deploy:</strong> Re-deploy using <code>./deploy.sh prod</code> or <code>./deploy.sh dev</code>.
                              </li>
                            </ol>
                            <div style={{ background: '#ebf8ff', border: '1px solid #bee3f8', borderRadius: '4px', padding: '8px 12px', color: '#2b6cb0', fontSize: '0.8rem' }}>
                              💡 <strong>Note:</strong> You can still link existing Google Drive videos right now without OAuth using <strong>Step B (Link Existing Google Drive Video)</strong> below!
                            </div>
                          </div>
                        </details>
                      </div>
                    ) : (
                      <div className="gdrive-connect-prompt">
                        <span style={{ fontSize: '0.88rem', color: '#4a5568' }}>
                          Connect your personal (@gmail.com) or school Workspace account for direct cloud archiving.
                        </span>
                        <button
                          className="btn-connect-drive"
                          onClick={() => connectGdrive()}
                          disabled={isGdriveConnecting}
                        >
                          {isGdriveConnecting ? '⏳ Connecting...' : '📁 Connect Google Drive'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Feedback alerts */}
                  {gdriveError && (
                    <div className="gdrive-alert error">
                      <span>⚠️ {gdriveError}</span>
                      <button onClick={clearGdriveFeedback} className="btn-close-alert">✕</button>
                    </div>
                  )}
                  {gdriveSuccess && (
                    <div className="gdrive-alert success">
                      <span>🎉 {gdriveSuccess}</span>
                      <button onClick={clearGdriveFeedback} className="btn-close-alert">✕</button>
                    </div>
                  )}

                  {/* Google Drive Actions (Direct Resumable Upload & Manual Link) */}
                  <div className="gdrive-action-grid">
                    <div className="gdrive-step-card">
                      <div className="youtube-step-header">
                        <span className="youtube-step-number" style={{ background: '#38a169' }}>A</span>
                        <strong>1-Click Direct Cloud Upload</strong>
                      </div>
                      <p className="youtube-step-desc">
                        Directly stream the HD WebM recording from Cloud Storage into your Google Drive with automatic link sharing.
                      </p>

                      {isGdriveUploading ? (
                        <div className="gdrive-upload-progress-box">
                          <div className="gdrive-progress-info">
                            <span>Uploading to Google Drive...</span>
                            <strong>{gdriveUploadProgress}%</strong>
                          </div>
                          <div className="gdrive-progress-track">
                            <div
                              className="gdrive-progress-fill"
                              style={{ width: `${gdriveUploadProgress}%` }}
                            />
                          </div>
                        </div>
                      ) : !isGdriveConfigured ? (
                        <div style={{ fontSize: '0.85rem', color: '#718096', padding: '6px 0' }}>
                          🔒 Direct cloud upload is disabled (no Google OAuth client configured). See the instructions above to configure <code>VITE_GOOGLE_CLIENT_ID</code>, or link an existing video in Step B below.
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            {(() => {
                              const hasSubtitles = selectedRecording.vttUrls && Object.keys(selectedRecording.vttUrls).length > 0;
                              const hasDriveSubtitles = selectedRecording.driveSubtitleFiles && Object.keys(selectedRecording.driveSubtitleFiles).length > 0;
                              const isAlreadyInDrive = Boolean(selectedRecording.driveFileId);

                              let label = '☁️ Upload Video & Subtitles to Drive';
                              let action = () => uploadToGdrive({
                                recording: selectedRecording,
                                classId,
                                className: classId,
                                lessonName: selectedRecording.lessonTitle || selectedRecording.title || 'General Recordings',
                                baseFolder: baseFolderName,
                              });

                              if (!isGdriveConnected) {
                                label = isGdriveConnecting ? '⏳ Connecting Google Drive...' : '📁 Connect Google Drive to Upload';
                                action = () => connectGdrive();
                              } else if (isAlreadyInDrive && hasSubtitles && !hasDriveSubtitles) {
                                label = '💬 Sync Subtitles to Drive (1 Click)';
                                action = () => uploadSubtitlesToGdrive({
                                  recording: selectedRecording,
                                  classId,
                                  className: classId,
                                  lessonName: selectedRecording.lessonTitle || selectedRecording.title || 'General Recordings',
                                  baseFolder: baseFolderName,
                                });
                              } else if (isAlreadyInDrive) {
                                label = '🔄 Re-upload Video & Subtitles to Drive';
                              } else if (hasSubtitles) {
                                label = '☁️ Upload Video & Subtitles to Drive (1 Click)';
                              } else {
                                label = '☁️ Upload Video to Drive';
                              }

                              return (
                                <button
                                  className="btn-upload-drive"
                                  onClick={action}
                                  disabled={isGdriveConnecting || isGdriveUploading}
                                >
                                  {label}
                                </button>
                              );
                            })()}

                            {selectedRecording.driveWebViewLink && (
                              <a
                                href={selectedRecording.driveWebViewLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn-open-drive"
                              >
                                📂 View in Google Drive ↗
                              </a>
                            )}
                          </div>

                          {selectedRecording.driveFolderPath && (
                            <div style={{ fontSize: '0.8rem', color: '#4a5568' }}>
                              📁 Stored in: <code>{selectedRecording.driveFolderPath}</code>
                            </div>
                          )}

                          {selectedRecording.driveSubtitleFiles && Object.keys(selectedRecording.driveSubtitleFiles).length > 0 && (
                            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#ebf8ff', borderRadius: '6px', fontSize: '0.8rem', color: '#2b6cb0', border: '1px solid #bee3f8' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px', flexWrap: 'wrap', gap: '4px' }}>
                                <span style={{ fontWeight: 600 }}>💬 Multilingual Subtitle Files in Drive:</span>
                                <button
                                  type="button"
                                  style={{ background: 'none', border: 'none', color: '#2b6cb0', fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
                                  onClick={isGdriveConnected ? () => uploadSubtitlesToGdrive({
                                    recording: selectedRecording,
                                    classId,
                                    className: classId,
                                    lessonName: selectedRecording.lessonTitle || selectedRecording.title || 'General Recordings',
                                    baseFolder: baseFolderName,
                                  }) : () => connectGdrive()}
                                  disabled={isGdriveConnecting || isGdriveUploading}
                                  title="Re-upload or refresh subtitle tracks in this Drive folder"
                                >
                                  🔄 Re-sync Subtitles
                                </button>
                              </div>
                              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {Object.entries(selectedRecording.driveSubtitleFiles).map(([lang, fileObj]) => (
                                  <a
                                    key={lang}
                                    href={fileObj.webViewLink}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ color: '#2b6cb0', textDecoration: 'underline' }}
                                  >
                                    📄 {lang.toUpperCase()} (.vtt) ↗
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="gdrive-step-card">
                      <div className="youtube-step-header">
                        <span className="youtube-step-number" style={{ background: '#3182ce' }}>B</span>
                        <strong>Link Existing Google Drive Video</strong>
                      </div>
                      <p className="youtube-step-desc">
                        Already have the video in Google Drive? Paste its sharing URL or 20+ character File ID below.
                      </p>

                      <div className="gdrive-link-input-group">
                        <input
                          type="text"
                          className="gdrive-link-input"
                          placeholder="e.g. https://drive.google.com/file/d/1BxiMVs0X.../view"
                          value={manualDriveUrlInput}
                          onChange={(e) => setManualDriveUrlInput(e.target.value)}
                        />
                        <button
                          className="btn-save-drive-link"
                          onClick={() => linkManualDrive({
                            recordingId: selectedRecording.id,
                            classId,
                            driveUrlOrId: manualDriveUrlInput,
                          })}
                          disabled={!manualDriveUrlInput.trim()}
                        >
                          {selectedRecording.driveFileId ? 'Update Link' : '🔗 Link Drive'}
                        </button>
                        {selectedRecording.driveFileId && (
                          <button
                            className="btn-unlink-drive"
                            onClick={() => unlinkGdrive({ recordingId: selectedRecording.id, classId })}
                          >
                            Unlink
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Additional Recording Actions */}
                <div className="recording-footer-actions">
                  <button
                    className="btn-secondary"
                    onClick={() => handleOpenRegenModal(selectedRecording)}
                    disabled={isRetryingSubtitles}
                  >
                    {isRetryingSubtitles
                      ? '🤖 Invoking Gemini...'
                      : selectedRecording.status === 'ready'
                      ? '🔄 Re-generate Subtitles & CC'
                      : '🔄 Generate / Retry Subtitles'}
                  </button>

                  <button
                    className="btn-delete-recording"
                    onClick={() => handleDeleteRecording(selectedRecording.id)}
                    disabled={isDeleting}
                    style={{ marginLeft: 'auto' }}
                  >
                    {isDeleting ? '🗑️ Deleting...' : '🗑️ Delete Recording'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* On-Demand Multilingual CC & Subtitles Regeneration Modal */}
      <Modal
        show={showRegenModal}
        onClose={() => setShowRegenModal(false)}
        title="🔄 Re-generate Multilingual Subtitles & CC"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', height: '100%', overflowY: 'auto', paddingRight: '4px' }}>
          {selectedRecording && (
            <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '0.85rem' }}>
              <div><strong>Lecture:</strong> {selectedRecording.title || 'Untitled Session'}</div>
              <div style={{ display: 'flex', gap: '15px', color: '#64748b', marginTop: '4px' }}>
                <span>⏱️ {formatDuration(selectedRecording.durationSeconds)}</span>
                <span>📦 {formatFileSize(selectedRecording.fileSize)}</span>
                <span>Status: {selectedRecording.status}</span>
                {selectedRecording.aiModelUsed && <span>🤖 Prior Model: {selectedRecording.aiModelUsed}</span>}
                {selectedRecording.aiCost !== undefined && selectedRecording.aiCost !== null && (
                  <span>💰 Prior Cost: {formatAiCost(selectedRecording.aiCost)}</span>
                )}
              </div>
            </div>
          )}

          {/* AI Model Selection */}
          <div>
            <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b', display: 'block', marginBottom: '6px' }}>
              1. Select Gemini AI Model
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '8px' }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: regenModel === 'gemini-3.8-flash' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                  background: regenModel === 'gemini-3.8-flash' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                <input
                  type="radio"
                  name="regenModel"
                  value="gemini-3.8-flash"
                  checked={regenModel === 'gemini-3.8-flash'}
                  onChange={() => setRegenModel('gemini-3.8-flash')}
                  style={{ accentColor: '#3b82f6' }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>✨ Gemini 3.8 Flash</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Recommended (CS terms &amp; code-switching)</div>
                </div>
              </label>

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  border: regenModel === 'gemini-3.5-flash-lite' ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                  background: regenModel === 'gemini-3.5-flash-lite' ? '#eff6ff' : '#ffffff',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                }}
              >
                <input
                  type="radio"
                  name="regenModel"
                  value="gemini-3.5-flash-lite"
                  checked={regenModel === 'gemini-3.5-flash-lite'}
                  onChange={() => setRegenModel('gemini-3.5-flash-lite')}
                  style={{ accentColor: '#3b82f6' }}
                />
                <div>
                  <div style={{ fontWeight: 600 }}>🚀 Gemini 3.5 Flash-Lite</div>
                  <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Economical &amp; Fast Multimodal Output</div>
                </div>
              </label>
            </div>
          </div>

          {/* Target Languages */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                2. Target Subtitle &amp; CC Languages ({regenLanguages.length} selected)
              </label>
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setRegenLanguages(['en', 'zh-Hant', 'zh-Hans'])}
                  style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0 }}
                >
                  Standard 3
                </button>
                <span>|</span>
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setRegenLanguages(SUBTITLE_LANGUAGES.filter((l) => l.code !== 'original').map((l) => l.code))}
                  style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer', padding: 0 }}
                >
                  Select All
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
              {SUBTITLE_LANGUAGES.filter((l) => l.code !== 'original').map((lang) => {
                const isChecked = regenLanguages.includes(lang.code);
                return (
                  <label
                    key={lang.code}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: isChecked ? '1.5px solid #3b82f6' : '1px solid #cbd5e1',
                      background: isChecked ? '#eff6ff' : '#ffffff',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        if (isChecked) {
                          if (regenLanguages.length > 1) {
                            setRegenLanguages(regenLanguages.filter((c) => c !== lang.code));
                          }
                        } else {
                          setRegenLanguages([...regenLanguages, lang.code]);
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

          {/* 3. Audio Speech-to-Text & Milestone Chapters AI Prompt */}
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '260px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                3. Speech-to-Text &amp; Milestone Chapters Prompt
              </label>
              <button
                type="button"
                onClick={() => {
                  const defaultStt = classInfo?.lectureSttPrompt || classInfo?.lectureRecordingPrompt || null;
                  setRegenSttPrompt(defaultStt);
                  setRegenSttPromptText(defaultStt?.promptText || '');
                  setRegenPrompt(defaultStt);
                  setRegenPromptText(defaultStt?.promptText || '');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Reset to Class Default
              </button>
            </div>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.78rem', color: '#64748b' }}>
              Verbatim speech recognition, technical terminology retention, Cantonese-English code switching, and YouTube milestone chapter rules.
            </p>
            <div style={{ flexGrow: 1, minHeight: '200px' }}>
              <AudioPromptSelector
                user={user}
                applyToFilter="Lecture STT & Chapters"
                selectedPrompt={regenSttPrompt || regenPrompt}
                onSelectPrompt={(p) => {
                  setRegenSttPrompt(p);
                  setRegenSttPromptText(p ? p.promptText : '');
                  setRegenPrompt(p);
                  setRegenPromptText(p ? p.promptText : '');
                }}
                promptText={regenSttPromptText !== undefined ? regenSttPromptText : regenPromptText}
                onTextChange={(val) => {
                  setRegenSttPromptText(val);
                  setRegenPromptText(val);
                }}
              />
            </div>
          </div>

          {/* 4. Multilingual Subtitle Translation Prompt */}
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minHeight: '260px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontWeight: 600, fontSize: '0.9rem', color: '#1e293b' }}>
                4. Multilingual Subtitle Translation Prompt
              </label>
              <button
                type="button"
                onClick={() => {
                  const defaultTrans = classInfo?.lectureTranslationPrompt || null;
                  setRegenTransPrompt(defaultTrans);
                  setRegenTransPromptText(defaultTrans?.promptText || '');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                  padding: 0,
                }}
              >
                Reset to Class Default
              </button>
            </div>
            <p style={{ margin: '0 0 8px 0', fontSize: '0.78rem', color: '#64748b' }}>
              Language-by-language translation rules, Cantonese-to-書面語 normalization, and CS technical keyword preservation.
            </p>
            <div style={{ flexGrow: 1, minHeight: '200px' }}>
              <TranslationPromptSelector
                user={user}
                applyToFilter="Lecture Subtitle Translation"
                selectedPrompt={regenTransPrompt}
                onSelectPrompt={(p) => {
                  setRegenTransPrompt(p);
                  setRegenTransPromptText(p ? p.promptText : '');
                }}
                promptText={regenTransPromptText}
                onTextChange={setRegenTransPromptText}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setShowRegenModal(false)}
            disabled={isRetryingSubtitles}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteRegenSubtitles}
            disabled={isRetryingSubtitles || regenLanguages.length === 0}
            style={{
              backgroundColor: '#3b82f6',
              color: '#ffffff',
              border: 'none',
              padding: '0.5rem 1.25rem',
              borderRadius: '6px',
              fontWeight: 600,
              cursor: isRetryingSubtitles || regenLanguages.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {isRetryingSubtitles ? '🤖 Processing...' : '🚀 Start AI Generation'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
