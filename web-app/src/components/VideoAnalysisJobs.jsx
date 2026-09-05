import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, documentId, doc, writeBatch, getDoc, addDoc, setDoc, serverTimestamp, orderBy } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db, functions } from '../firebase-config';
import './SharedViews.css';

import usePaginatedQuery from '../hooks/useCollectionQuery';
import VideoAnalysisJobsTable from './VideoAnalysisJobsTable';
import AiJobsTable from './AiJobsTable';
import VideoPlayerModal from './VideoPlayerModal';
import Modal from './Modal';
import JobResultModal from './JobResultModal';
import PromptViewModal from './PromptViewModal';
import { exportToCsv, exportToJson } from '../utils/exportUtils';

const VideoAnalysisJobs = ({ classId, startTime, endTime, filterField, user }) => {
  const [selectedAnalysisJob, setSelectedAnalysisJob] = useState(null);
  const [viewingPromptJob, setViewingPromptJob] = useState(null);
  const [aiJobs, setAiJobs] = useState([]);
  const [aiJobsLoading, setAiJobsLoading] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);

  // Level 2 detail view states
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [inspectingJob, setInspectingJob] = useState(null);
  const [studentFilter, setStudentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Task Prompt Synthesis state
  const [showTaskPromptModal, setShowTaskPromptModal] = useState(false);
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [synthesisStage, setSynthesisStage] = useState(0);
  const [generatedPromptText, setGeneratedPromptText] = useState('');
  const [taskPromptName, setTaskPromptName] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [rerunScope, setRerunScope] = useState('job_videos');
  const [isLaunchingJob, setIsLaunchingJob] = useState(false);
  const [promptSummaryCount, setPromptSummaryCount] = useState(0);

  const extraClauses = useMemo(() => [{ field: 'deleted', op: '==', value: false }], []);

  const { 
    data: videoAnalysisJobs, 
    loading: analysisJobsLoading, 
    refetch,
    fetchNextPage,
    fetchPrevPage,
    isLastPage,
    page
  } = usePaginatedQuery('videoAnalysisJobs', {
    classId,
    startTime,
    endTime,
    filterField,
    orderByField: filterField,
    extraClauses,
  });

  // Reset selection when the main job list changes
  useEffect(() => {
    setSelectedAnalysisJob(null);
    setAiJobs([]);
  }, [videoAnalysisJobs]);

  const fetchAiJobs = async (aiJobIds) => {
    setAiJobsLoading(true);
    setAiJobs([]);
    try {
      if (!aiJobIds || aiJobIds.length === 0) {
        setAiJobs([]);
        return;
      }

      const aiJobsRef = collection(db, 'aiJobs');
      const allJobs = [];
      
      for (let i = 0; i < aiJobIds.length; i += 30) {
        const batchIds = aiJobIds.slice(i, i + 30);
        const q = query(aiJobsRef, where(documentId(), 'in', batchIds));
        const querySnapshot = await getDocs(q);
        querySnapshot.forEach(doc => {
          const jobData = doc.data();
          if (jobData.deleted !== true) {
            allJobs.push({ id: doc.id, ...jobData });
          }
        });
      }

      allJobs.sort((a, b) => b.timestamp.toDate() - a.timestamp.toDate());
      setAiJobs(allJobs);

    } catch (error) {
      console.error("Error fetching AI jobs:", error);
      alert("Failed to fetch AI jobs for the selected analysis job.");
    } finally {
      setAiJobsLoading(false);
    }
  };

  const handleAnalysisJobSelect = (job) => {
    const isSameJob = selectedAnalysisJob && selectedAnalysisJob.id === job.id;

    setAiJobsLoading(true);
    if (!isSameJob) {
      setSelectedAnalysisJob(job);
    }

    const jobRef = doc(db, 'videoAnalysisJobs', job.id);
    getDoc(jobRef).then(docSnap => {
      if (docSnap.exists()) {
        const freshJob = { id: docSnap.id, ...docSnap.data() };
        setSelectedAnalysisJob(freshJob);
        if (freshJob.aiJobIds && freshJob.aiJobIds.length > 0) {
          fetchAiJobs(freshJob.aiJobIds);
        } else {
          setAiJobs([]);
          setAiJobsLoading(false);
        }
      } else {
        alert('Job not found, it may have been deleted.');
        setSelectedAnalysisJob(null);
        setAiJobs([]);
        setAiJobsLoading(false);
      }
    }).catch(error => {
      console.error("Error fetching job:", error);
      alert('Failed to fetch job details.');
      setAiJobsLoading(false);
    });
  };

  const navigateToJob = (job) => {
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        handleAnalysisJobSelect(job);
      });
    } else {
      handleAnalysisJobSelect(job);
    }
  };

  const navigateBack = () => {
    if (typeof document !== 'undefined' && document.startViewTransition) {
      document.startViewTransition(() => {
        setSelectedAnalysisJob(null);
        setAiJobs([]);
      });
    } else {
      setSelectedAnalysisJob(null);
      setAiJobs([]);
    }
  };

  const handleDeleteAnalysisJob = async (jobId, aiJobIds) => {
    if (!window.confirm(`Are you sure you want to soft delete this analysis job (${jobId}) and its ${aiJobIds?.length || 0} sub-jobs?`)) {
      return;
    }

    try {
      const batch = writeBatch(db);

      const analysisJobRef = doc(db, 'videoAnalysisJobs', jobId);
      batch.update(analysisJobRef, { deleted: true });

      if (aiJobIds && aiJobIds.length > 0) {
        for (let i = 0; i < aiJobIds.length; i += 500) {
          const chunk = aiJobIds.slice(i, i + 500);
          chunk.forEach(aiJobId => {
            const aiJobRef = doc(db, 'aiJobs', aiJobId);
            batch.update(aiJobRef, { deleted: true });
          });
        }
      }

      await batch.commit();

      alert(`Successfully deleted analysis job ${jobId} and marked ${aiJobIds?.length || 0} AI sub-jobs as deleted.`);

      refetch();
      if (selectedAnalysisJob?.id === jobId) {
        setSelectedAnalysisJob(null);
        setAiJobs([]);
      }
    } catch (error) {
      console.error("Error deleting analysis job:", error);
      alert(`An error occurred while deleting the job: ${error.message}`);
    }
  };

  const handleRetryFailedJobs = async () => {
    if (!selectedAnalysisJob) return;

    if (!window.confirm(`This will attempt to retry any failed videos for job ${selectedAnalysisJob.id}. The job status will be updated. Continue?`)) {
      return;
    }

    setRetryLoading(true);

    try {
      const retryer = httpsCallable(functions, 'retryVideoAnalysisJob');
      const result = await retryer({ jobId: selectedAnalysisJob.id });

      alert(`Successfully started retry. Server response: ${result.data.result}`);
      refetch();
      handleAnalysisJobSelect(selectedAnalysisJob);
    } catch (error) {
      console.error("Error retrying job:", error);
      alert(`Failed to retry job: ${error.message}`);
    } finally {
      setRetryLoading(false);
    }
  };

  const handleExportJobsDirectoryCsv = () => {
    if (!videoAnalysisJobs || videoAnalysisJobs.length === 0) {
      alert("No analysis jobs to export.");
      return;
    }

    const headers = [
      'Job ID',
      'Model',
      'Status',
      'Videos Count',
      'Created At',
      'Filter Field',
      'Filter Start',
      'Filter End',
      'Prompt'
    ];

    const rows = videoAnalysisJobs.map(job => [
      job.id,
      job.model || job.modelUsed || 'gemini-3.5-flash-lite',
      job.status || 'unknown',
      job.videos?.length || job.aiJobIds?.length || 0,
      job.createdAt?.toDate ? job.createdAt.toDate().toISOString() : (job.createdAt || 'N/A'),
      job.filterField || 'N/A',
      job.startTime?.toDate ? job.startTime.toDate().toISOString() : (job.startTime || 'N/A'),
      job.endTime?.toDate ? job.endTime.toDate().toISOString() : (job.endTime || 'N/A'),
      job.prompt || ''
    ]);

    const dateSuffix = new Date().toISOString().slice(0, 10);
    const filename = `Class_${classId}_Video_Analysis_Jobs_Page_${page}_${dateSuffix}.csv`;
    exportToCsv(headers, rows, filename);
  };

  const handleExportAiJobs = (customList = null) => {
    const listToExport = customList || aiJobs;
    if (listToExport.length === 0 || !selectedAnalysisJob) {
      alert("No AI jobs to export.");
      return;
    }

    const headers = [
      'AI Job ID',
      'Batch Job ID',
      'Student Email',
      'Student UID',
      'Model',
      'Status',
      'Cost (USD)',
      'Created At',
      'Result Findings',
      'Error Details',
      'Video Path'
    ];
    
    const rows = listToExport.map(job => {
      const studentEmail = job.studentEmail || '';
      const studentUid = job.studentUid || '';
      const model = job.modelUsed || selectedAnalysisJob.modelUsed || selectedAnalysisJob.model || 'gemini-3.5-flash-lite';
      const status = job.status || '';
      const costStr = job.cost != null ? Number(job.cost).toFixed(4) : '0.0000';
      const result = (job.result && typeof job.result === 'object') ? JSON.stringify(job.result) : (job.result || '');
      const errorDetails = job.errorDetails || '';
      const createdAt = job.timestamp?.toDate ? job.timestamp.toDate().toISOString() : (job.timestamp || 'N/A');
      const videoPath = (job.mediaPaths && job.mediaPaths[0]) || job.videoPath || '';

      return [
        job.id,
        selectedAnalysisJob.id,
        studentEmail,
        studentUid,
        model,
        status,
        costStr,
        createdAt,
        result,
        errorDetails,
        videoPath
      ];
    });

    const isFiltered = listToExport.length !== aiJobs.length;
    const filename = isFiltered 
      ? `Class_${classId}_Job_${selectedAnalysisJob.id}_Filtered_Findings.csv`
      : `Class_${classId}_Job_${selectedAnalysisJob.id}_Findings.csv`;
    exportToCsv(headers, rows, filename);
  };

  const handleExportAiJobsJson = () => {
    if (aiJobs.length === 0 || !selectedAnalysisJob) {
      alert("No AI jobs to export.");
      return;
    }

    const payload = {
      batchJobId: selectedAnalysisJob.id,
      classId,
      model: selectedAnalysisJob.model || selectedAnalysisJob.modelUsed || 'gemini-3.5-flash-lite',
      prompt: selectedAnalysisJob.prompt || '',
      exportedAt: new Date().toISOString(),
      studentAnalyses: aiJobs.map(j => ({
        id: j.id,
        studentEmail: j.studentEmail,
        studentUid: j.studentUid,
        status: j.status,
        model: j.modelUsed || selectedAnalysisJob.model || 'gemini-3.5-flash-lite',
        cost: j.cost,
        timestamp: j.timestamp?.toDate ? j.timestamp.toDate().toISOString() : j.timestamp,
        result: j.result,
        errorDetails: j.errorDetails,
        videoPath: (j.mediaPaths && j.mediaPaths[0]) || j.videoPath || null
      }))
    };

    const filename = `Class_${classId}_Job_${selectedAnalysisJob.id}_Batch.json`;
    exportToJson(payload, filename);
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
      setShowPlayer(false);
    } finally {
      setPlayerLoading(false);
    }
  };

  const handleCopyJobPrompt = async () => {
    if (!selectedAnalysisJob?.prompt) return;
    try {
      await navigator.clipboard.writeText(selectedAnalysisJob.prompt);
      setCopiedPrompt(true);
      setTimeout(() => setCopiedPrompt(false), 2000);
    } catch (err) {
      console.warn('Copy prompt failed', err);
    }
  };

  const handleOpenGeneratePromptModal = async () => {
    if (!selectedAnalysisJob) return;

    setGeneratingPrompt(true);
    setSynthesisStage(1); // Stage 1: Aggregating observations

    const stage2Timer = setTimeout(() => {
      setSynthesisStage(2); // Stage 2: Gemini 3.8 Flash Synthesizing
    }, 2200);

    const stage3Timer = setTimeout(() => {
      setSynthesisStage(3); // Stage 3: Formatting & Rubrics
    }, 8500);

    try {
      const studentSummaries = [];
      for (const job of aiJobs) {
        if (job.status === 'completed' && job.result) {
          const res = typeof job.result === 'object' ? JSON.stringify(job.result) : String(job.result);
          studentSummaries.push({
            studentEmail: job.studentEmail || 'unknown',
            summary: res
          });
        }
      }

      const promptCaller = httpsCallable(functions, 'generateLabTaskPrompt');
      const response = await promptCaller({
        classId: selectedAnalysisJob.classId,
        jobId: selectedAnalysisJob.id,
        studentSummaries
      });

      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);
      setSynthesisStage(4); // Stage 4: Done

      const { generatedPrompt, promptName, summaryCount } = response.data;
      setGeneratedPromptText(generatedPrompt || '');
      setTaskPromptName(promptName || `Lab Tasks - ${selectedAnalysisJob.classId}`);
      setPromptSummaryCount(summaryCount || studentSummaries.length);

      setTimeout(() => {
        setGeneratingPrompt(false);
        setSynthesisStage(0);
        setShowTaskPromptModal(true);
      }, 450);
    } catch (error) {
      clearTimeout(stage2Timer);
      clearTimeout(stage3Timer);
      setGeneratingPrompt(false);
      setSynthesisStage(0);
      console.error('Error synthesizing lab task prompt:', error);
      alert(`Failed to generate lab task prompt: ${error.message}`);
    }
  };

  const cleanVideoPath = (raw) => {
    if (!raw) return '';
    let p = raw;
    if (p.startsWith('gs://')) {
      const parts = p.replace('gs://', '').split('/');
      parts.shift();
      p = parts.join('/');
    } else if (p.startsWith('https://storage.googleapis.com/')) {
      const after = decodeURIComponent(p.replace('https://storage.googleapis.com/', ''));
      const parts = after.split('/');
      parts.shift();
      p = parts.join('/');
    }
    if (p.startsWith('/')) p = p.substring(1);
    return p;
  };

  const handleLaunchJobWithPrompt = async () => {
    if (!generatedPromptText.trim()) {
      alert('Prompt cannot be empty.');
      return;
    }

    setIsLaunchingJob(true);
    try {
      if (saveToLibrary && taskPromptName.trim()) {
        await addDoc(collection(db, 'prompts'), {
          title: taskPromptName.trim(),
          text: generatedPromptText,
          description: `Auto-synthesized from analysis job ${selectedAnalysisJob.id}`,
          classId: selectedAnalysisJob.classId,
          type: 'lab_task',
          isSystem: false,
          createdBy: user?.uid || selectedAnalysisJob.requester,
          creatorEmail: user?.email || '',
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      }

      let targetVideos = [];
      if (rerunScope === 'job_videos') {
        if (selectedAnalysisJob.videos && selectedAnalysisJob.videos.length > 0) {
          targetVideos = selectedAnalysisJob.videos.map(v => {
            const path = cleanVideoPath(v.videoPath || v.path);
            return {
              ...v,
              videoPath: path,
              path: path
            };
          }).filter(v => v.videoPath);
        } else if (aiJobs.length > 0) {
          targetVideos = aiJobs.map(j => {
            const raw = (j.mediaPaths && j.mediaPaths[0]) || j.videoPath || j.path;
            const path = cleanVideoPath(raw);
            return {
              videoPath: path,
              path: path,
              classId: j.classId || selectedAnalysisJob.classId,
              studentUid: j.studentUid,
              studentEmail: j.studentEmail,
              startTime: j.startTime,
            };
          }).filter(v => v.videoPath);
        }
      } else {
        if (selectedAnalysisJob.startTime && selectedAnalysisJob.endTime) {
          const videoRef = collection(db, 'videoJobs');
          const vQuery = query(
            videoRef,
            where('classId', '==', selectedAnalysisJob.classId),
            where('startTime', '>=', selectedAnalysisJob.startTime),
            where('startTime', '<=', selectedAnalysisJob.endTime)
          );
          const videoSnap = await getDocs(vQuery);
          targetVideos = videoSnap.docs.map(doc => {
            const v = doc.data();
            const path = cleanVideoPath(v.videoPath || v.path);
            return {
              videoPath: path,
              path: path,
              classId: v.classId || selectedAnalysisJob.classId,
              studentUid: v.studentUid,
              studentEmail: v.studentEmail,
              startTime: v.startTime,
            };
          }).filter(v => v.videoPath);
        }
      }

      if (targetVideos.length === 0) {
        alert('No videos found to analyze.');
        setIsLaunchingJob(false);
        return;
      }

      const newJobRef = doc(collection(db, 'videoAnalysisJobs'));
      const effectiveFilterField = filterField || selectedAnalysisJob.filterField || 'startTime';
      await setDoc(newJobRef, {
        jobId: newJobRef.id,
        classId: selectedAnalysisJob.classId,
        requester: user?.uid || selectedAnalysisJob.requester,
        videos: targetVideos,
        status: 'pending',
        createdAt: serverTimestamp(),
        startTime: selectedAnalysisJob.startTime,
        endTime: selectedAnalysisJob.endTime,
        filterField: effectiveFilterField,
        deleted: false,
        prompt: generatedPromptText,
        model: selectedModel,
      });

      alert(`Successfully launched new analysis job (${targetVideos.length} videos) with your lab task prompt!`);
      setShowTaskPromptModal(false);
      refetch();
    } catch (error) {
      console.error('Error launching analysis job:', error);
      alert(`Failed to launch analysis job: ${error.message}`);
    } finally {
      setIsLaunchingJob(false);
    }
  };

  const hasFailedSubJobs = useMemo(() => aiJobs.some(j => j.status === 'failed'), [aiJobs]);
  const failedVideosCount = useMemo(() => {
    if (selectedAnalysisJob?.failedVideos && selectedAnalysisJob.failedVideos.length > 0) {
      return selectedAnalysisJob.failedVideos.length;
    }
    return aiJobs.filter(j => j.status === 'failed').length;
  }, [selectedAnalysisJob, aiJobs]);

  const filteredAiJobs = useMemo(() => {
    return aiJobs.filter(job => {
      const matchesStudent = !studentFilter || 
        (job.studentEmail && job.studentEmail.toLowerCase().includes(studentFilter.toLowerCase()));
      const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
      return matchesStudent && matchesStatus;
    });
  }, [aiJobs, studentFilter, statusFilter]);

  return (
    <div className="view-container">
      <VideoPlayerModal show={showPlayer} onClose={() => setShowPlayer(false)} videoUrl={videoUrl} loading={playerLoading} />
      <JobResultModal show={Boolean(inspectingJob)} onClose={() => setInspectingJob(null)} job={inspectingJob} />
      <PromptViewModal show={Boolean(viewingPromptJob)} onClose={() => setViewingPromptJob(null)} job={viewingPromptJob} />
      
      {/* Synthesize Lab Task Prompt Modal */}
      <Modal
        show={showTaskPromptModal}
        onClose={() => {
          if (!isLaunchingJob) setShowTaskPromptModal(false);
        }}
        title="✨ AI-Generated Lab Task Prompt"
      >
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '12px' }}>
          <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--color-text-muted, #64748b)' }}>
            Gemini synthesized this prompt from {promptSummaryCount} student video summaries in this lab. Review and edit the tasks or rubrics below before launching.
          </p>
          
          <div style={{ flex: 1, minHeight: '220px', display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px', color: 'var(--color-text-main, #334155)' }}>
              Task Prompt (Editable Markdown):
            </label>
            <textarea
              value={generatedPromptText}
              onChange={(e) => setGeneratedPromptText(e.target.value)}
              placeholder="Generated prompt will appear here..."
              style={{
                width: '100%',
                flex: 1,
                minHeight: '220px',
                fontFamily: 'monospace',
                fontSize: '0.85rem',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--color-border, #cbd5e1)',
                boxSizing: 'border-box',
                resize: 'vertical',
                lineHeight: '1.45',
              }}
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', background: 'var(--color-surface-subtle, #f8fafc)', padding: '12px', borderRadius: '8px', border: '1px solid var(--color-border, #e2e8f0)' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-main, #334155)' }}>
                Target Videos:
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="rerunScope"
                    value="job_videos"
                    checked={rerunScope === 'job_videos'}
                    onChange={(e) => setRerunScope(e.target.value)}
                  />
                  <span>This Job's Videos ({selectedAnalysisJob?.videos?.length || selectedAnalysisJob?.aiJobIds?.length || 0})</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="rerunScope"
                    value="all_videos"
                    checked={rerunScope === 'all_videos'}
                    onChange={(e) => setRerunScope(e.target.value)}
                  />
                  <span>All Videos in Class Time Window</span>
                </label>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-main, #334155)' }}>
                Model:
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border, #cbd5e1)',
                  fontSize: '0.85rem',
                  background: '#fff'
                }}
              >
                <option value="gemini-3.8-flash">gemini-3.8-flash (Standard Multimodal)</option>
                <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite (Cost-Optimized)</option>
                <option value="gemini-3.7-flash">gemini-3.7-flash (Advanced Reasoning)</option>
              </select>

              <div style={{ marginTop: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={saveToLibrary}
                    onChange={(e) => setSaveToLibrary(e.target.checked)}
                  />
                  <span>Save as reusable prompt template</span>
                </label>
                {saveToLibrary && (
                  <input
                    type="text"
                    value={taskPromptName}
                    onChange={(e) => setTaskPromptName(e.target.value)}
                    placeholder="Template Title"
                    style={{
                      width: '100%',
                      marginTop: '6px',
                      padding: '6px 10px',
                      borderRadius: '6px',
                      border: '1px solid var(--color-border, #cbd5e1)',
                      fontSize: '0.82rem',
                      boxSizing: 'border-box'
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
            <button
              onClick={() => setShowTaskPromptModal(false)}
              disabled={isLaunchingJob}
              style={{ padding: '8px 16px' }}
            >
              Cancel
            </button>
            <button
              onClick={handleLaunchJobWithPrompt}
              disabled={isLaunchingJob || !generatedPromptText.trim()}
              style={{
                backgroundColor: '#4f46e5',
                color: '#fff',
                fontWeight: 600,
                padding: '8px 18px',
                borderRadius: '6px',
                border: 'none',
                cursor: isLaunchingJob ? 'not-allowed' : 'pointer',
              }}
            >
              {isLaunchingJob ? 'Launching Analysis...' : '🚀 Launch Analysis Job'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ========================================================
          LEVEL 1: VIDEO ANALYSIS JOBS DIRECTORY
          ======================================================== */}
      {!selectedAnalysisJob ? (
        <>
          <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <h2>Video Analysis Jobs</h2>
              {!analysisJobsLoading && videoAnalysisJobs.length > 0 && (
                <span style={{ fontSize: '0.82rem', padding: '3px 10px', borderRadius: '9999px', background: '#e2e8f0', color: '#475569', fontWeight: 600 }}>
                  Page {page} ({videoAnalysisJobs.length} jobs)
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={handleExportJobsDirectoryCsv}
                disabled={analysisJobsLoading || videoAnalysisJobs.length === 0}
                style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}
              >
                📥 Export Jobs Log (CSV)
              </button>
              <button 
                onClick={() => refetch()} 
                disabled={analysisJobsLoading}
                style={{ padding: '6px 14px', borderRadius: '6px', border: '1px solid #cbd5e1', background: '#ffffff', color: '#0f172a', cursor: 'pointer', fontWeight: 600 }}
              >
                🔄 Refresh
              </button>
            </div>
          </div>

          {analysisJobsLoading ? (
            <p>Loading analysis jobs...</p>
          ) : videoAnalysisJobs.length === 0 ? (
            <p>No analysis jobs found for the selected criteria.</p>
          ) : (
            <>
              <VideoAnalysisJobsTable 
                jobs={videoAnalysisJobs} 
                selectedJob={selectedAnalysisJob} 
                onSelectJob={navigateToJob} 
                onDeleteJob={handleDeleteAnalysisJob} 
                onViewPrompt={(job) => setViewingPromptJob(job)}
              />
              <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
                <button onClick={fetchPrevPage} disabled={page <= 1 || analysisJobsLoading}>
                  Previous
                </button>
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>Page {page}</span>
                <button onClick={fetchNextPage} disabled={isLastPage || analysisJobsLoading}>
                  Next
                </button>
              </div>
            </>
          )}
        </>
      ) : (
        /* ========================================================
           LEVEL 2: SELECTED JOB DEEP-DIVE DASHBOARD
           ======================================================== */
        <div>
          {/* Level 2 Breadcrumb & Back Bar */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            alignItems: 'center', 
            marginBottom: '16px', 
            paddingBottom: '12px', 
            borderBottom: '1px solid #e2e8f0' 
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                onClick={navigateBack}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  color: '#1e293b'
                }}
              >
                ← Back to Video Analysis Jobs
              </button>
              <span style={{ color: '#94a3b8' }}>/</span>
              <span style={{ fontSize: '0.95rem', fontWeight: 600, color: '#475569' }}>
                Job: <span style={{ fontFamily: 'monospace', color: '#2563eb' }}>{selectedAnalysisJob.id}</span>
              </span>
            </div>
            <div>
              <button 
                onClick={navigateBack} 
                style={{ 
                  padding: '6px 14px', 
                  borderRadius: '6px', 
                  border: '1px solid #cbd5e1', 
                  background: '#ffffff', 
                  color: '#0f172a',
                  cursor: 'pointer',
                  fontWeight: 600 
                }}
              >
                Close
              </button>
            </div>
          </div>

          {/* Job Overview Hero Card */}
          <div style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: '10px',
            padding: '16px 20px',
            marginBottom: '18px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '14px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <h3 style={{ margin: 0, fontSize: '1.15rem', color: '#0f172a' }}>Job Overview</h3>
                  <span style={{
                    padding: '2px 10px',
                    borderRadius: '9999px',
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    backgroundColor: selectedAnalysisJob.status === 'completed' ? '#dcfce7' : selectedAnalysisJob.status === 'failed' ? '#fee2e2' : selectedAnalysisJob.status === 'partial_failure' ? '#fef3c7' : '#e0f2fe',
                    color: selectedAnalysisJob.status === 'completed' ? '#166534' : selectedAnalysisJob.status === 'failed' ? '#991b1b' : selectedAnalysisJob.status === 'partial_failure' ? '#92400e' : '#0369a1',
                  }}>
                    {selectedAnalysisJob.status}
                  </span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', fontSize: '0.85rem', color: '#64748b' }}>
                  <span><strong>Model:</strong> {selectedAnalysisJob.modelUsed || selectedAnalysisJob.model || 'gemini-3.5-flash-lite'}</span>
                  <span><strong>Class:</strong> {selectedAnalysisJob.classId}</span>
                  <span><strong>Created:</strong> {selectedAnalysisJob.createdAt?.toDate().toLocaleString() || 'N/A'}</span>
                  <span><strong>Videos:</strong> {selectedAnalysisJob.videos?.length || selectedAnalysisJob.aiJobIds?.length || aiJobs.length || 0} total</span>
                  {failedVideosCount > 0 && (
                    <span style={{ color: '#dc2626', fontWeight: 600 }}>({failedVideosCount} failed)</span>
                  )}
                </div>
              </div>

              {/* Action Toolbar */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                {((selectedAnalysisJob.status === 'partial_failure' || selectedAnalysisJob.status === 'failed') ||
                  (selectedAnalysisJob.status === 'processing' && hasFailedSubJobs) ||
                  failedVideosCount > 0) && (
                  <button
                    onClick={handleRetryFailedJobs}
                    disabled={retryLoading}
                    style={{
                      backgroundColor: '#dc2626',
                      color: '#fff',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: '6px',
                      padding: '7px 14px',
                      cursor: retryLoading ? 'wait' : 'pointer'
                    }}
                  >
                    {retryLoading ? 'Retrying...' : `Retry Failed Jobs (${failedVideosCount})`}
                  </button>
                )}

                {(selectedAnalysisJob.status === 'completed' || aiJobs.some(j => j.status === 'completed')) && (
                  <button
                    onClick={handleOpenGeneratePromptModal}
                    disabled={generatingPrompt}
                    style={{
                      backgroundColor: '#4f46e5',
                      color: '#fff',
                      fontWeight: 600,
                      border: 'none',
                      borderRadius: '6px',
                      padding: '7px 16px',
                      cursor: generatingPrompt ? 'wait' : 'pointer',
                    }}
                  >
                    {generatingPrompt ? '✨ Synthesizing Tasks...' : '✨ Generate Lab Task Prompt'}
                  </button>
                )}

                {aiJobs.length > 0 && (
                  <>
                    <button
                      onClick={() => handleExportAiJobs()}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      📥 Export Findings (CSV)
                    </button>
                    <button
                      onClick={handleExportAiJobsJson}
                      style={{
                        padding: '7px 14px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#0f172a',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      📦 Export Batch (JSON)
                    </button>
                  </>
                )}

                <button
                  onClick={() => handleDeleteAnalysisJob(selectedAnalysisJob.id, selectedAnalysisJob.aiJobIds)}
                  style={{
                    padding: '7px 12px',
                    borderRadius: '6px',
                    border: '1px solid #fecaca',
                    background: '#fee2e2',
                    color: '#991b1b',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  Delete Job
                </button>
              </div>
            </div>
          </div>

          {/* Multi-Stage Animated Prompt Synthesis Stepper */}
          {generatingPrompt && (
            <div style={{
              background: 'linear-gradient(135deg, #f0fdf4 0%, #eef2ff 100%)',
              border: '1px solid #c7d2fe',
              borderRadius: '10px',
              padding: '16px 20px',
              marginBottom: '20px',
              boxShadow: '0 4px 12px rgba(99, 102, 241, 0.08)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem', animation: 'spin 2s linear infinite' }}>✨</span>
                  <strong style={{ color: '#1e1b4b', fontSize: '0.98rem' }}>
                    Synthesizing Lab Tasks & Rubric from Classroom Observations...
                  </strong>
                </div>
                <span style={{
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: '#4f46e5',
                  background: '#e0e7ff',
                  padding: '2px 10px',
                  borderRadius: '12px'
                }}>
                  Stage {Math.min(3, Math.max(1, synthesisStage))} of 3
                </span>
              </div>

              {/* Progress Bar */}
              <div style={{ width: '100%', height: '6px', background: '#e2e8f0', borderRadius: '3px', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={{
                  width: synthesisStage === 1 ? '30%' : synthesisStage === 2 ? '70%' : synthesisStage === 3 ? '92%' : '100%',
                  height: '100%',
                  background: 'linear-gradient(90deg, #4f46e5 0%, #10b981 100%)',
                  transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
                }} />
              </div>

              {/* 3 Step Indicators */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: synthesisStage >= 1 ? '#ffffff' : 'rgba(255,255,255,0.5)',
                  border: synthesisStage === 1 ? '1px solid #6366f1' : '1px solid #e2e8f0',
                  opacity: synthesisStage >= 1 ? 1 : 0.6
                }}>
                  <span>{synthesisStage > 1 ? '✅' : '📂'}</span>
                  <div style={{ fontSize: '0.82rem', lineHeight: '1.2' }}>
                    <div style={{ fontWeight: 600, color: synthesisStage >= 1 ? '#1e293b' : '#64748b' }}>
                      1. Observations
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {synthesisStage === 1 ? 'Aggregating summaries...' : 'Aggregated'}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: synthesisStage >= 2 ? '#ffffff' : 'rgba(255,255,255,0.5)',
                  border: synthesisStage === 2 ? '1px solid #6366f1' : '1px solid #e2e8f0',
                  opacity: synthesisStage >= 2 ? 1 : 0.6
                }}>
                  <span>{synthesisStage > 2 ? '✅' : synthesisStage === 2 ? '🧠' : '⏳'}</span>
                  <div style={{ fontSize: '0.82rem', lineHeight: '1.2' }}>
                    <div style={{ fontWeight: 600, color: synthesisStage >= 2 ? '#1e293b' : '#64748b' }}>
                      2. Gemini 3.8 Flash
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {synthesisStage === 2 ? 'Synthesizing tasks...' : synthesisStage > 2 ? 'Synthesized' : 'Waiting...'}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: synthesisStage >= 3 ? '#ffffff' : 'rgba(255,255,255,0.5)',
                  border: synthesisStage === 3 ? '1px solid #6366f1' : '1px solid #e2e8f0',
                  opacity: synthesisStage >= 3 ? 1 : 0.6
                }}>
                  <span>{synthesisStage >= 4 ? '🎉' : synthesisStage === 3 ? '📐' : '⏳'}</span>
                  <div style={{ fontSize: '0.82rem', lineHeight: '1.2' }}>
                    <div style={{ fontWeight: 600, color: synthesisStage >= 3 ? '#1e293b' : '#64748b' }}>
                      3. Rubric & Constraints
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      {synthesisStage === 3 ? 'Validating markdown...' : synthesisStage >= 4 ? 'Complete' : 'Waiting...'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Collapsible Prompt Card */}
          {selectedAnalysisJob.prompt && (
            <div style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '12px 16px',
              marginBottom: '18px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.88rem', color: '#334155' }}>
                    📝 Task Rubric / Prompt Used
                  </span>
                  <button
                    onClick={() => setPromptExpanded(!promptExpanded)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      cursor: 'pointer',
                      fontSize: '0.82rem',
                      textDecoration: 'underline'
                    }}
                  >
                    {promptExpanded ? 'Collapse' : 'Expand full prompt'}
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setViewingPromptJob(selectedAnalysisJob)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.78rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    🔍 Full Modal
                  </button>
                  <button
                    onClick={handleCopyJobPrompt}
                    style={{
                      padding: '3px 8px',
                      fontSize: '0.78rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 600,
                      cursor: 'pointer'
                    }}
                  >
                    {copiedPrompt ? '✓ Copied' : '📋 Copy Prompt'}
                  </button>
                </div>
              </div>
              {promptExpanded ? (
                <pre style={{
                  marginTop: '10px',
                  marginBottom: 0,
                  padding: '12px',
                  background: '#ffffff',
                  borderRadius: '6px',
                  border: '1px solid #e2e8f0',
                  fontSize: '0.82rem',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '260px',
                  overflowY: 'auto'
                }}>
                  {selectedAnalysisJob.prompt}
                </pre>
              ) : (
                <p style={{
                  margin: '6px 0 0 0',
                  fontSize: '0.84rem',
                  color: '#64748b',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {selectedAnalysisJob.prompt.split('\n')[0] || selectedAnalysisJob.prompt.substring(0, 90)}
                </p>
              )}
            </div>
          )}

          {/* Sub-Jobs Section */}
          <div style={{ marginTop: '10px' }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center', 
              marginBottom: '12px', 
              flexWrap: 'wrap', 
              gap: '10px' 
            }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#1e293b' }}>
                AI Jobs for Analysis Job: {selectedAnalysisJob.id}
              </h3>
              
              {/* Search & Filter Controls */}
              {aiJobs.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="text"
                    placeholder="Filter by student email..."
                    value={studentFilter}
                    onChange={(e) => setStudentFilter(e.target.value)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                      minWidth: '210px'
                    }}
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.82rem',
                      background: '#ffffff',
                      color: '#0f172a'
                    }}
                  >
                    <option value="all">All Statuses ({aiJobs.length})</option>
                    <option value="completed">Completed ({aiJobs.filter(j => j.status === 'completed').length})</option>
                    <option value="failed">Failed ({aiJobs.filter(j => j.status === 'failed').length})</option>
                    <option value="processing">Processing ({aiJobs.filter(j => j.status === 'processing' || j.status === 'running').length})</option>
                  </select>
                  <button
                    onClick={() => handleExportAiJobs(filteredAiJobs)}
                    disabled={filteredAiJobs.length === 0}
                    title="Export currently filtered AI jobs as CSV"
                    style={{
                      padding: '5px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      cursor: 'pointer',
                      fontWeight: 600,
                      fontSize: '0.82rem',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    📥 Export CSV ({filteredAiJobs.length})
                  </button>
                </div>
              )}
            </div>

            {aiJobsLoading ? (
              <p>Loading AI jobs...</p>
            ) : filteredAiJobs.length === 0 ? (
              <p>{aiJobs.length === 0 ? 'No AI jobs found for this analysis job.' : 'No AI jobs match the filter.'}</p>
            ) : (
              <AiJobsTable
                aiJobs={filteredAiJobs}
                onPlayVideo={handlePlayVideo}
                onInspectResult={(job) => setInspectingJob(job)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoAnalysisJobs;