import React, { useState, useEffect, useMemo, useRef } from 'react';
import { db, functions } from '../firebase-config';
import { collection, query, orderBy, onSnapshot, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import JSZip from 'jszip';
import { formatDuration } from '../hooks/useLectureRecorder';
import { useGoogleDrive } from '../hooks/useGoogleDrive';
import { extractGoogleDriveFileId, formatGoogleDriveEmbedUrl } from '../utils/googleDriveService';
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

export default function LectureRecordingsView({ classId, user, onBack = null }) {
  const [recordings, setRecordings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedRecordingId, setSelectedRecordingId] = useState(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const [isRetryingSubtitles, setIsRetryingSubtitles] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeFeedback, setMergeFeedback] = useState('');
  const [selectedIdsToMerge, setSelectedIdsToMerge] = useState([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);

  // Phase 1 YouTube & Dual Player state
  const [activePlayerMode, setActivePlayerMode] = useState('cloud'); // 'youtube' | 'drive' | 'cloud'
  const [youtubeUrlInput, setYoutubeUrlInput] = useState('');
  const [isEditingYouTube, setIsEditingYouTube] = useState(false);
  const [isSavingYouTube, setIsSavingYouTube] = useState(false);
  const [isDownloadingVideo, setIsDownloadingVideo] = useState(false);
  const [downloadFeedback, setDownloadFeedback] = useState('');

  // Google Drive integration hook & state
  const {
    clientId: gdriveClientId,
    setCustomClientId: setGdriveClientId,
    isConnected: isGdriveConnected,
    connectedUser: gdriveUser,
    isConnecting: isGdriveConnecting,
    isUploading: isGdriveUploading,
    uploadProgress: gdriveUploadProgress,
    error: gdriveError,
    successMessage: gdriveSuccess,
    connect: connectGdrive,
    disconnect: disconnectGdrive,
    uploadRecording: uploadToGdrive,
    linkManualDrive,
    unlinkRecording: unlinkGdrive,
    clearFeedback: clearGdriveFeedback,
  } = useGoogleDrive();

  const [manualDriveUrlInput, setManualDriveUrlInput] = useState('');
  const [isConfiguringClientId, setIsConfiguringClientId] = useState(false);
  const [customClientIdInput, setCustomClientIdInput] = useState(gdriveClientId || '');

  const videoRef = useRef(null);

  // Chromium WebM seek/duration fix
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      // Chromium WebM fix: MediaRecorder WebM files stream without container duration headers.
      // If browser reports Infinity, NaN, or 0, seek to end to read true length, then reset.
      if (!isFinite(video.duration) || video.duration === 0) {
        const onSeeked = () => {
          video.currentTime = 0;
          video.removeEventListener('seeked', onSeeked);
        };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = 1e101;
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [selectedRecordingId]);

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

        // Select the newest recording by default if none selected
        if (!selectedRecordingId && validDocs.length > 0) {
          setSelectedRecordingId(validDocs[0].id);
        }
      },
      (err) => {
        console.error('[LectureRecordingsView] Snapshot error:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [classId]);

  // Group unmerged recordings by sessionGroupId or calendar date
  const unmergedGroups = useMemo(() => {
    const groups = {};
    recordings.forEach((rec) => {
      const dateKey = rec.startedAt?.toDate
        ? rec.startedAt.toDate().toLocaleDateString()
        : (rec.startedAt ? new Date(rec.startedAt).toLocaleDateString() : 'recent');
      const groupId = rec.sessionGroupId || `date_${dateKey}`;
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
        const unmergedClips = grp.items.filter((r) => !r.isCombined && !r.mergedIntoSessionId);
        return !hasCombined && unmergedClips.length >= 2;
      })
      .map((grp) => {
        const unmergedClips = grp.items.filter((r) => !r.isCombined && !r.mergedIntoSessionId);
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

  const handleMergeClips = async (sessionGroupId, clipIds) => {
    if (!classId || !clipIds || clipIds.length < 2) return;

    setIsMerging(true);
    setMergeFeedback('Concatenating video clips with ffmpeg...');

    try {
      const callMerge = httpsCallable(functions, 'mergeLectureRecordings');
      const result = await callMerge({
        classId,
        sessionGroupId: sessionGroupId.startsWith('date_') ? null : sessionGroupId,
        recordingIds: clipIds,
      });

      if (result.data?.success && result.data?.combinedSessionId) {
        setMergeFeedback('Merge complete! Triggering AI subtitle transcription...');
        setSelectedRecordingId(result.data.combinedSessionId);

        // Auto-trigger Gemini subtitle and chapter generation
        try {
          const callSubtitles = httpsCallable(functions, 'processLectureSubtitles');
          await callSubtitles({
            classId,
            sessionId: result.data.combinedSessionId,
            storagePath: result.data.storagePath,
            title: result.data.title,
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
      if (selectedRecording.youtubeVideoId) {
        setActivePlayerMode('youtube');
      } else if (selectedRecording.driveFileId) {
        setActivePlayerMode('drive');
      } else {
        setActivePlayerMode('cloud');
      }
    }
  }, [
    selectedRecording?.id,
    selectedRecording?.youtubeVideoId,
    selectedRecording?.youtubeUrl,
    selectedRecording?.driveFileId,
    selectedRecording?.driveWebViewLink,
  ]);

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

  // Trigger offline Gemini subtitle generation
  const handleTriggerSubtitles = async () => {
    if (!selectedRecording) return;
    setIsRetryingSubtitles(true);
    try {
      const callSubtitles = httpsCallable(functions, 'processLectureSubtitles');
      await callSubtitles({
        classId,
        sessionId: selectedRecording.id,
        storagePath: selectedRecording.storagePath,
        title: selectedRecording.title,
        topic: selectedRecording.topic,
      });
    } catch (err) {
      console.error('[LectureRecordingsView] Subtitle generation failed:', err);
      alert(`Failed to trigger subtitle generation: ${err.message}`);
    } finally {
      setIsRetryingSubtitles(false);
    }
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

  const getStatusBadge = (status) => {
    switch (status) {
      case 'ready':
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '1rem', color: '#4a5568' }}>
                Past Lectures ({recordings.length})
              </h3>
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
                <span>Selected: {selectedIdsToMerge.length} clips</span>
                <button
                  className="btn-merge-action btn-sm"
                  disabled={selectedIdsToMerge.length < 2 || isMerging}
                  onClick={() => handleMergeClips('custom', selectedIdsToMerge)}
                >
                  {isMerging ? 'Merging...' : `Merge Selected (${selectedIdsToMerge.length})`}
                </button>
              </div>
            )}

            {recordings.map((rec) => {
              const isSelected = rec.id === selectedRecordingId;
              const dateStr = rec.startedAt?.toDate
                ? rec.startedAt.toDate().toLocaleString()
                : rec.startedAt
                ? new Date(rec.startedAt).toLocaleString()
                : 'Recent';

              const isChecked = selectedIdsToMerge.includes(rec.id);

              return (
                <div
                  key={rec.id}
                  className={`recording-card ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    if (isSelectionMode) {
                      if (isChecked) {
                        setSelectedIdsToMerge(selectedIdsToMerge.filter((id) => id !== rec.id));
                      } else {
                        setSelectedIdsToMerge([...selectedIdsToMerge, rec.id]);
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
                        onChange={() => {}}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <div style={{ flex: 1 }}>
                      <div className="recording-card-title">{rec.title || 'Classroom Lecture'}</div>
                      <div className="recording-card-meta">
                        <span>📅 {dateStr}</span>
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
                        </span>
                        {rec.topic && <span>📌 Topic: {rec.topic}</span>}
                        {rec.isFragment && rec.mergedIntoSessionId && (
                          <span style={{ fontSize: '0.75rem', color: '#718096', fontStyle: 'italic' }}>
                            (Merged into master lecture)
                          </span>
                        )}
                      </div>
                      {getStatusBadge(rec.status)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Detailed Player & YouTube Studio Export Panel */}
          {selectedRecording && (
            <div className="recording-detail-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#2d3748' }}>
                  {selectedRecording.title || 'Lecture Recording'}
                </h3>
                <button
                  className="btn-delete-recording"
                  onClick={() => handleDeleteRecording(selectedRecording.id)}
                  disabled={isDeleting}
                  title="Permanently delete recording, video, audio & subtitle files"
                >
                  {isDeleting ? '🗑️ Deleting...' : '🗑️ Delete Recording'}
                </button>
              </div>

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
              </div>

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
                      className={`player-mode-tab ${activePlayerMode === 'drive' ? 'active' : ''}`}
                      onClick={() => setActivePlayerMode('drive')}
                    >
                      📁 Google Drive Stream
                    </button>
                  )}
                  <button
                    className={`player-mode-tab ${activePlayerMode === 'cloud' ? 'active' : ''}`}
                    onClick={() => setActivePlayerMode('cloud')}
                  >
                    🎞️ Cloud Storage HTML5 Player (Multilingual CC)
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
              ) : selectedRecording.videoUrl ? (
                <div className="lecture-video-player-box">
                  <video
                    ref={videoRef}
                    key={selectedRecording.videoUrl}
                    controls
                    playsInline
                    crossOrigin="anonymous"
                  >
                    <source
                      src={selectedRecording.videoUrl}
                      type={selectedRecording.mimeType || 'video/webm'}
                    />
                    {/* Multilingual Closed Caption Tracks */}
                    {selectedRecording.vttUrls?.en && (
                      <track
                        kind="subtitles"
                        src={selectedRecording.vttUrls.en}
                        srcLang="en"
                        label="English"
                        default
                      />
                    )}
                    {selectedRecording.vttUrls?.['zh-Hant'] && (
                      <track
                        kind="subtitles"
                        src={selectedRecording.vttUrls['zh-Hant']}
                        srcLang="zh-Hant"
                        label="Traditional Chinese (繁體中文)"
                      />
                    )}
                    {selectedRecording.vttUrls?.['zh-Hans'] && (
                      <track
                        kind="subtitles"
                        src={selectedRecording.vttUrls['zh-Hans']}
                        srcLang="zh-Hans"
                        label="Simplified Chinese (简体中文)"
                      />
                    )}
                    {selectedRecording.vttUrls?.ja && (
                      <track
                        kind="subtitles"
                        src={selectedRecording.vttUrls.ja}
                        srcLang="ja"
                        label="Japanese (日本語)"
                      />
                    )}
                    {selectedRecording.vttUrls?.original && (
                      <track
                        kind="subtitles"
                        src={selectedRecording.vttUrls.original}
                        srcLang="original"
                        label="Original (Cantonese/English)"
                      />
                    )}
                    Your browser does not support HTML5 video playback.
                  </video>
                </div>
              ) : (
                <div className="empty-state">Video upload in progress or unavailable.</div>
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
                    ) : (
                      <span className="badge-pill-clip" style={{ fontSize: '0.82rem', padding: '4px 10px' }}>
                        ⏳ Ready for Drive Upload
                      </span>
                    )}
                  </div>

                  {/* Google Account Connection Status Bar */}
                  <div className="gdrive-status-bar">
                    {isGdriveConnected ? (
                      <div className="gdrive-connected-info">
                        <span>🟢 Connected: <strong>{gdriveUser?.email}</strong></span>
                        <button className="btn-disconnect-drive" onClick={disconnectGdrive}>
                          Disconnect
                        </button>
                      </div>
                    ) : (
                      <div className="gdrive-connect-prompt">
                        <span style={{ fontSize: '0.88rem', color: '#4a5568' }}>
                          Connect your personal (@gmail.com) or school Workspace account for direct cloud archiving.
                        </span>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <button
                            className="btn-connect-drive"
                            onClick={() => connectGdrive()}
                            disabled={isGdriveConnecting}
                          >
                            {isGdriveConnecting ? '⏳ Connecting...' : '📁 Connect Google Drive'}
                          </button>
                          <button
                            className="btn-settings-drive"
                            onClick={() => setIsConfiguringClientId(!isConfiguringClientId)}
                            title="Configure Google OAuth 2.0 Web Client ID"
                          >
                            ⚙️ {gdriveClientId ? 'OAuth Configured' : 'Configure Client ID'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Client ID Configuration Accordion */}
                  {isConfiguringClientId && (
                    <div className="gdrive-config-box">
                      <p style={{ margin: '0 0 8px 0', fontSize: '0.82rem', color: '#4a5568' }}>
                        Google OAuth 2.0 Web Client ID (from Google Cloud Console):
                      </p>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          className="gdrive-client-id-input"
                          placeholder="e.g. 123456789-abcdef.apps.googleusercontent.com"
                          value={customClientIdInput}
                          onChange={(e) => setCustomClientIdInput(e.target.value)}
                        />
                        <button
                          className="btn-save-client-id"
                          onClick={() => {
                            setGdriveClientId(customClientIdInput);
                            setIsConfiguringClientId(false);
                          }}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  )}

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
                      ) : (
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                          <button
                            className="btn-upload-drive"
                            onClick={() => uploadToGdrive({ recording: selectedRecording, classId })}
                            disabled={!isGdriveConnected || isGdriveUploading}
                          >
                            {isGdriveConnected ? '☁️ Upload Video to Google Drive' : '🔒 Connect Google Drive to Upload'}
                          </button>

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
                  {selectedRecording.status !== 'ready' && (
                    <button
                      className="btn-secondary"
                      onClick={handleTriggerSubtitles}
                      disabled={isRetryingSubtitles}
                    >
                      {isRetryingSubtitles ? '🤖 Invoking Gemini...' : '🔄 Generate / Retry Subtitles'}
                    </button>
                  )}

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
    </div>
  );
}
