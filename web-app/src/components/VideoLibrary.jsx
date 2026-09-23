import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, orderBy, getDocs, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';
import Modal from './Modal';
import VideoPromptSelector from './VideoPromptSelector';

import usePaginatedQuery from '../hooks/useCollectionQuery';

import VideoTable from './VideoTable';
import VideoPlayerModal from './VideoPlayerModal';
import { exportToExcel } from '../utils/exportUtils';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';
import { useGoogleDrive } from '../hooks/useGoogleDrive';
import DriveBackupProgressModal from './DriveBackupProgressModal';

export const getSafeVideoFilename = (video, fallbackClassId) => {
  let timeStr = '';
  if (video?.startTime?.toDate && typeof video.startTime.toDate === 'function') {
    try {
      timeStr = video.startTime.toDate().toISOString();
    } catch {
      timeStr = 'unknown_time';
    }
  } else if (video?.startTime instanceof Date) {
    timeStr = video.startTime.toISOString();
  } else if (video?.startTime) {
    const d = new Date(video.startTime);
    timeStr = isNaN(d.getTime()) ? 'unknown_time' : d.toISOString();
  } else {
    timeStr = 'unknown_time';
  }

  const formattedStartTime = timeStr
    .replace(/:/g, '-')
    .replace(/\..+/, '')
    .replace('T', '_');
  const rawEmail = video?.studentEmail || video?.studentUid || 'student';
  const safeEmail = String(rawEmail).replace(/[@.]/g, '_');
  const safeClassId = String(video?.classId || fallbackClassId || 'class');

  return `${safeClassId}_${safeEmail}_${formattedStartTime}.mp4`;
};

const VideoLibrary = ({ user, classId, startTime, endTime, filterField }) => {
  const [selectedVideos, setSelectedVideos] = useState(new Map());
  const [isZipping, setIsZipping] = useState(false);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [downloadingVideos, setDownloadingVideos] = useState(new Set());

  const [showPlayer, setShowPlayer] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [playerLoading, setPlayerLoading] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [editablePromptText, setEditablePromptText] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-3.5-flash-lite');
  const [studentProfiles, setStudentProfiles] = useState({});

  // Google Drive integration
  const {
    isConfigured: isGdriveConfigured,
    isConnected: isGdriveConnected,
    connectedUser: gdriveUser,
    isConnecting: isGdriveConnecting,
    baseFolderName,
    setBaseFolderName,
    connect: connectGdrive,
    disconnect: disconnectGdrive,
    backupStudentVideosToDrive,
  } = useGoogleDrive();

  const [showBackupModal, setShowBackupModal] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupAbortController, setBackupAbortController] = useState(null);
  const [batchTotal, setBatchTotal] = useState(0);
  const [batchCompleted, setBatchCompleted] = useState(0);
  const [batchFailed, setBatchFailed] = useState(0);
  const [currentBackupVideo, setCurrentBackupVideo] = useState(null);
  const [currentFilePercentage, setCurrentFilePercentage] = useState(0);
  const [videoStatuses, setVideoStatuses] = useState([]);
  const [isEditingBaseFolder, setIsEditingBaseFolder] = useState(false);
  const [baseFolderDraft, setBaseFolderDraft] = useState('');

  useEffect(() => {
    if (!classId || !db) return;
    const fetchClassProfiles = async () => {
      try {
        const snap = await getDoc(doc(db, 'classes', classId));
        if (snap && snap.exists && snap.exists()) {
          setStudentProfiles(snap.data().studentProfiles || {});
        }
      } catch (err) {
        console.debug('Could not load student profiles in VideoLibrary:', err);
      }
    };
    fetchClassProfiles();
  }, [classId]);

  const extraClauses = useMemo(() => [{ field: 'status', op: '==', value: 'completed' }], []);

  const { 
    data: videos, 
    loading, 
    isLastPage, 
    fetchNextPage 
  } = usePaginatedQuery('videoJobs', {
    classId,
    startTime,
    endTime,
    filterField,
    orderByField: filterField,
    extraClauses,
  });

  const handleSelectVideo = (video) => {
    setSelectedVideos(prev => {
      const newSelection = new Map(prev);
      if (newSelection.has(video.id)) {
        newSelection.delete(video.id);
      } else {
        newSelection.set(video.id, video);
      }
      return newSelection;
    });
  };

  const handleRequestZipForSelected = async () => {
    if (selectedVideos.size === 0) return;

    setIsZipping(true);
    const videosToZip = Array.from(selectedVideos.values()).map(v => ({
        path: v.videoPath,
        classId: v.classId,
        studentUid: v.studentUid,
        studentEmail: v.studentEmail,
        startTime: v.startTime
    }));

    try {
        const jobCollectionRef = collection(db, 'zipJobs');
        const newDocRef = doc(jobCollectionRef);
        
        await setDoc(newDocRef, {
            jobId: newDocRef.id,
            classId: classId,
            requester: user.uid,
            videos: videosToZip,
            status: 'pending',
            createdAt: serverTimestamp(),
            expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days retention for ZIP exports
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            prompt: editablePromptText,
        });

        alert(`Your ZIP request for ${videosToZip.length} videos has been submitted. You can find the download in the Data Management view once it is ready.`);
        setSelectedVideos(new Map());

    } catch (error) {
        console.error('Error creating zip job:', error);
        alert(`Error submitting ZIP request: ${error.message}`);
    }

    setIsZipping(false);
  };

  const handleRequestZipForAll = async () => {
    if (!startTime || !endTime) {
        alert("Please select a start and end time to define the range for the zip file.");
        return;
    }
    if (!window.confirm(`This will find ALL completed videos for this class within the selected date range and submit a single ZIP job. This may include videos not currently visible on the page. Do you want to continue?`)) {
        return;
    }

    setIsZipping(true);
    try {
        const videoJobsRef = collection(db, 'videoJobs');
        const q = query(videoJobsRef,
            where('status', '==', 'completed'),
            where('classId', '==', classId),
            where(filterField, '>=', new Date(startTime)),
            where(filterField, '<=', new Date(endTime)),
            orderBy(filterField, 'desc')
        );

        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            alert("No completed videos were found for the selected criteria.");
            setIsZipping(false);
            return;
        }

        const videosToZip = querySnapshot.docs.map(doc => {
            const v = doc.data();
            return {
                path: v.videoPath,
                classId: v.classId,
                studentUid: v.studentUid,
                studentEmail: v.studentEmail,
                startTime: v.startTime
            };
        });

        const jobCollectionRef = collection(db, 'zipJobs');
        const newDocRef = doc(jobCollectionRef);
        
        await setDoc(newDocRef, {
            jobId: newDocRef.id,
            classId: classId,
            requester: user.uid,
            videos: videosToZip,
            status: 'pending',
            createdAt: serverTimestamp(),
            expireAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days retention for ZIP exports
            startTime: new Date(startTime),
            endTime: new Date(endTime),
            prompt: editablePromptText,
        });

        alert(`Your ZIP request for ${videosToZip.length} videos has been submitted. You can find the download in the Data Management view once it is ready.`);
        setSelectedVideos(new Map());

    } catch (error) {
        console.error('Error creating zip job for all videos:', error);
        alert(`Error submitting ZIP request: ${error.message}`);
    }

    setIsZipping(false);
  };

  const handleRequestAnalysis = async () => {
    if (!editablePromptText.trim() || selectedVideos.size === 0) {
      alert('Please select a prompt and at least one video to analyze.');
      return;
    }

    setIsRequestingAnalysis(true);
    try {
      const videos = Array.from(selectedVideos.values()).map(v => ({
        studentUid: v.studentUid,
        studentEmail: v.studentEmail,
        videoPath: v.videoPath,
      }));

      const jobCollectionRef = collection(db, 'videoAnalysisJobs');
      const newDocRef = doc(jobCollectionRef);
      
      await setDoc(newDocRef, {
          jobId: newDocRef.id,
          classId: classId,
          requester: user.uid,
          videos: videos,
          prompt: editablePromptText,
          model: selectedModel,
          status: 'pending',
          createdAt: serverTimestamp(),
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          deleted: false,
      });

      alert(`Your analysis request for ${videos.length} videos has been submitted. You can find the results in the Data Management view once it is ready.`);
      setSelectedVideos(new Map());
      setShowPromptModal(false);

    } catch (error) {
      console.error('Error creating analysis job:', error);
      alert(`Error submitting analysis request: ${error.message}`);
    } finally {
      setIsRequestingAnalysis(false);
    }
  };

  const handleRequestAllAnalysis = async () => {
    if (!editablePromptText.trim()) {
      alert('Please select a prompt.');
      return;
    }
    if (!window.confirm(`This will find ALL completed videos for this class within the selected date range and submit a single analysis job. Do you want to continue?`)) {
        return;
    }

    setIsRequestingAnalysis(true);
    try {
      const jobCollectionRef = collection(db, 'videoAnalysisJobs');
      const newDocRef = doc(jobCollectionRef);
      
      await setDoc(newDocRef, {
          jobId: newDocRef.id,
          classId: classId,
          requester: user.uid,
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          filterField: filterField,
          prompt: editablePromptText,
          model: selectedModel,
          status: 'pending',
          createdAt: serverTimestamp(),
          deleted: false,
      });

      alert(`Your analysis request for all videos in the selected range has been submitted. You can find the results in the Data Management view once it is ready.`);
      setShowPromptModal(false);

    } catch (error) {
      console.error('Error creating analysis job for all videos:', error);
      alert(`Error submitting analysis request: ${error.message}`);
    } finally {
      setIsRequestingAnalysis(false);
    }
  };

  const handleDownload = async (video) => {
    if (!video || !video.videoPath) {
      alert("This video does not have a storage path.");
      return;
    }

    setDownloadingVideos(prev => new Set(prev).add(video.id));
    const filename = getSafeVideoFilename(video, classId);

    try {
      const storage = getStorage();
      const videoRef = ref(storage, video.videoPath);
      const downloadUrl = await getDownloadURL(videoRef);

      // Attempt 1: Fetch as blob to force explicit filename save
      let downloadedViaBlob = false;
      try {
        const response = await fetch(downloadUrl);
        if (response.ok) {
          const blob = await response.blob();
          const blobUrl = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.style.display = 'none';
          a.href = blobUrl;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          // Delay revoking URL so browser has adequate time to stream blob to disk
          setTimeout(() => {
            window.URL.revokeObjectURL(blobUrl);
            if (a.parentNode) {
              a.parentNode.removeChild(a);
            }
          }, 10000);
          downloadedViaBlob = true;
        }
      } catch (blobErr) {
        console.warn('Direct blob fetch failed, falling back to direct download link:', blobErr);
      }

      // Attempt 2: Direct browser download link fallback
      if (!downloadedViaBlob) {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = downloadUrl;
        a.download = filename;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          if (a.parentNode) {
            a.parentNode.removeChild(a);
          }
        }, 2000);
      }
    } catch (error) {
      console.error('Error downloading video:', error);
      alert(`Failed to download video. ${error.message}`);
    } finally {
      setDownloadingVideos(prev => {
        const next = new Set(prev);
        next.delete(video.id);
        return next;
      });
    }
  };

  const handlePlayVideo = async (video) => {
    if (!video.videoPath) {
      alert("This video does not have a storage path.");
      return;
    }
    setPlayerLoading(true);
    setShowPlayer(true);
    try {
      const storage = getStorage();
      const videoRef = ref(storage, video.videoPath);
      const downloadUrl = await getDownloadURL(videoRef);
      setVideoUrl(downloadUrl);
    } catch (error) {
      console.error('Error getting video URL for playback:', error);
      alert(`Failed to get video for playback. ${error.message}`);
      setShowPlayer(false); // Close modal on error
    } finally {
      setPlayerLoading(false);
    }
  };



  const startBatchBackup = async (videosList) => {
    const controller = new AbortController();
    setBackupAbortController(controller);
    setBatchTotal(videosList.length);
    setBatchCompleted(0);
    setBatchFailed(0);
    setCurrentBackupVideo(null);
    setCurrentFilePercentage(0);
    setVideoStatuses(videosList.map(v => ({
      id: v.id,
      studentEmail: v.studentEmail || v.studentUid,
      status: 'pending',
      percentage: 0,
      webViewLink: null,
      error: null,
    })));
    setShowBackupModal(true);
    setIsBackingUp(true);

    try {
      await backupStudentVideosToDrive({
        videos: videosList,
        classId,
        className: classId,
        baseFolder: baseFolderName,
        abortSignal: controller.signal,
        onBatchProgress: ({ index, total, currentVideo, percentage, status, error }) => {
          setCurrentBackupVideo(currentVideo);
          setCurrentFilePercentage(percentage);
          setVideoStatuses(prev => {
            return prev.map(item => {
              if (item.id === currentVideo?.id) {
                return {
                  ...item,
                  status,
                  percentage,
                  error: error || item.error,
                  webViewLink: currentVideo?.driveWebViewLink || item.webViewLink,
                };
              }
              return item;
            });
          });
          if (status === 'success') {
            setBatchCompleted(c => c + 1);
          } else if (status === 'error') {
            setBatchFailed(f => f + 1);
          }
        },
      });
    } catch (err) {
      console.error('[VideoLibrary] Batch backup error:', err);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleBackupSelectedToDrive = async () => {
    if (selectedVideos.size === 0) return;
    if (!isGdriveConnected) {
      const ok = await connectGdrive();
      if (!ok) return;
    }
    const list = Array.from(selectedVideos.values());
    startBatchBackup(list);
  };

  const handleBackupAllToDrive = async () => {
    if (!startTime || !endTime) {
      alert("Please select a start and end time to define the range for Google Drive backup.");
      return;
    }
    if (!window.confirm(`This will find ALL completed videos for this class within the selected date range and back them up directly to your Google Drive folder:\n\n${baseFolderName} / ${classId || 'Class'} / [Lesson] / Students / [studentEmail]\n\nContinue?`)) {
      return;
    }

    if (!isGdriveConnected) {
      const ok = await connectGdrive();
      if (!ok) return;
    }

    try {
      const videoJobsRef = collection(db, 'videoJobs');
      const q = query(videoJobsRef,
        where('status', '==', 'completed'),
        where('classId', '==', classId),
        where(filterField, '>=', new Date(startTime)),
        where(filterField, '<=', new Date(endTime)),
        orderBy(filterField, 'desc')
      );
      const snapshot = await getDocs(q);
      const allVideos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      if (allVideos.length === 0) {
        alert("No videos found to backup in the selected range.");
        return;
      }

      startBatchBackup(allVideos);
    } catch (err) {
      console.error("Error fetching all videos for Drive backup:", err);
      alert(`Error querying videos: ${err.message}`);
    }
  };

  const handleCancelBackup = () => {
    if (backupAbortController) {
      backupAbortController.abort();
    }
    setIsBackingUp(false);
  };

  const handleExportManifestExcel = async () => {
    if (!videos || videos.length === 0) {
      alert("No videos available to export.");
      return;
    }
    const headers = [
      'Video ID',
      'Student Name',
      'Student Email',
      'Cohort',
      'Programme',
      'Student UID',
      'Class ID',
      'Start Time',
      'End Time',
      'Status',
      'Storage Path',
      'Google Drive Link',
      'Google Drive Path',
    ];
    const rows = videos.map(v => {
      const email = v.studentEmail || '';
      const prof = getStudentProfile(email, studentProfiles);
      const displayName = getStudentDisplayName(email, studentProfiles);
      return [
        v.id,
        displayName,
        email || 'N/A',
        prof.studentClass || '',
        prof.programme || '',
        v.studentUid || 'N/A',
        v.classId || classId,
        v.startTime?.toDate ? v.startTime.toDate().toISOString() : (v.startTime || 'N/A'),
        v.endTime?.toDate ? v.endTime.toDate().toISOString() : (v.endTime || 'N/A'),
        v.status || 'completed',
        v.videoPath || 'N/A',
        v.driveWebViewLink || 'N/A',
        v.driveFolderPath || 'N/A',
      ];
    });
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const filename = `Class_${classId}_Video_Manifest_${dateSuffix}.xlsx`;
    await exportToExcel(headers, rows, filename);
  };

  return (
    <div className="view-container">
      <VideoPlayerModal show={showPlayer} onClose={() => setShowPlayer(false)} videoUrl={videoUrl} loading={playerLoading} />
      <Modal
          show={showPromptModal}
          onClose={() => {
            setShowPromptModal(false);
          }}
          title="Select Video Prompt"
      >
          <VideoPromptSelector 
            user={user}
            selectedPrompt={selectedPrompt}
            onSelectPrompt={(p) => {
              setSelectedPrompt(p);
              setEditablePromptText(p ? p.promptText : '');
            }}
            promptText={editablePromptText}
            onTextChange={setEditablePromptText}
          />
          <div style={{ marginTop: '12px', marginBottom: '8px' }}>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-main, #334155)', marginBottom: '4px' }}>
              Select Gemini Model:
            </label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              style={{ width: '100%', padding: '7px 10px', borderRadius: '6px', border: '1px solid var(--color-border, #cbd5e1)', fontSize: '0.88rem' }}
            >
              <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash-Lite ($0.30 / $2.50 per 1M tokens)</option>
              <option value="gemini-3.7-flash">🧠 Gemini 3.7 Flash ($0.75 / $3.75 per 1M tokens)</option>
              <option value="gemini-3.8-flash">⚡ Gemini 3.8 Flash ($0.75 / $3.75 per 1M tokens)</option>
              <option value="gemini-3.7-pro">🔬 Gemini 3.7 Pro ($3.00 / $15.00 per 1M tokens)</option>
            </select>
          </div>

          <div style={{ marginTop: '14px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
              <button onClick={handleRequestAnalysis} disabled={selectedVideos.size === 0 || isRequestingAnalysis || !editablePromptText.trim()}>
                {isRequestingAnalysis ? 'Requesting...' : `Request Analysis for Selected ${selectedVideos.size > 0 ? `(${selectedVideos.size})` : ''}`}
              </button>
              <button onClick={handleRequestAllAnalysis} disabled={isRequestingAnalysis || !editablePromptText.trim()}>
                {isRequestingAnalysis ? 'Requesting...' : 'Request Analysis for the whole class'}
              </button>
          </div>
      </Modal>

      <DriveBackupProgressModal
        show={showBackupModal}
        onClose={() => setShowBackupModal(false)}
        onCancel={handleCancelBackup}
        isProcessing={isBackingUp}
        totalVideos={batchTotal}
        completedCount={batchCompleted}
        failedCount={batchFailed}
        currentVideo={currentBackupVideo}
        currentPercentage={currentFilePercentage}
        baseFolderName={baseFolderName}
        videoStatuses={videoStatuses}
      />

      <div className="view-header">
        <h2>Video Library</h2>
      </div>

      {/* Google Drive Status & Target Folder Settings Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
          padding: '10px 16px',
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          marginBottom: '16px',
          fontSize: '0.85rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          {isGdriveConnected ? (
            <span style={{ color: '#16a34a', fontWeight: 600 }}>🟢 Drive: {gdriveUser?.email}</span>
          ) : (
            <button
              onClick={() => connectGdrive()}
              disabled={isGdriveConnecting}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                backgroundColor: '#ffffff',
                cursor: 'pointer',
                fontSize: '0.82rem',
                fontWeight: 600,
              }}
            >
              {isGdriveConnecting ? '⏳ Connecting...' : '📁 Connect Google Drive'}
            </button>
          )}

          <div style={{ color: '#475569' }}>
            <span>📁 Base Folder: </span>
            <strong style={{ color: '#0f172a' }}>{baseFolderName}</strong>
            <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}> / {classId || 'Class'} / [Lesson] / Students / [studentEmail]</span>
          </div>
        </div>

        <div>
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
                padding: '3px 8px',
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

      <>
        <div className="other-controls-column" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px' }}>
          <button onClick={handleRequestZipForSelected} disabled={selectedVideos.size === 0 || isZipping}>
            {isZipping ? 'Submitting...' : `Request Selected as ZIP ${selectedVideos.size > 0 ? `(${selectedVideos.size})` : ''}`}
          </button>
          <button onClick={handleRequestZipForAll} disabled={isZipping}>
            {isZipping ? 'Submitting...' : 'Request All as ZIP'}
          </button>
          <button
            onClick={handleBackupSelectedToDrive}
            disabled={selectedVideos.size === 0 || isBackingUp}
            style={{
              backgroundColor: '#2563eb',
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            ☁️ Backup Selected to Drive {selectedVideos.size > 0 ? `(${selectedVideos.size})` : ''}
          </button>
          <button
            onClick={handleBackupAllToDrive}
            disabled={isBackingUp || loading}
            style={{
              backgroundColor: '#1d4ed8',
              color: '#ffffff',
              fontWeight: 600,
            }}
          >
            ☁️ Backup All Class Videos to Drive
          </button>
          <button onClick={() => setShowPromptModal(true)}>Select Video Prompt</button>
          <button onClick={handleExportManifestExcel} disabled={loading || videos.length === 0}>
            📥 Export Video Manifest (Excel)
          </button>
        </div>

        {loading ? (
          <p>Loading videos...</p>
        ) : videos.length === 0 ? (
          <p>No videos found for the selected criteria.</p>
        ) : (
          <VideoTable 
            videos={videos} 
            selectedVideos={selectedVideos} 
            onSelectVideo={handleSelectVideo} 
            onPlayVideo={handlePlayVideo} 
            onDownloadVideo={handleDownload} 
            downloadingVideos={downloadingVideos}
            studentProfiles={studentProfiles}
            onSelectAll={(e) => {
              const newSelection = new Map();
              if (e.target.checked) {
                videos.forEach(v => newSelection.set(v.id, v));
              }
              setSelectedVideos(newSelection);
            }}
          />
        )}
      </>

      <div className="pagination-controls">
        <button disabled>Previous</button> {/* Previous not implemented in hook yet */}
        <button onClick={fetchNextPage} disabled={isLastPage || loading}>
          Next
        </button>
      </div>
    </div>
  );
};

export default VideoLibrary;