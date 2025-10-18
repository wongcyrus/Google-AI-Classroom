import { useState, useEffect, useMemo } from 'react';
import { collection, query, where, getDocs, documentId, doc, writeBatch, getDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';

import usePaginatedQuery from '../hooks/useCollectionQuery';
import VideoAnalysisJobsTable from './VideoAnalysisJobsTable';
import AiJobsTable from './AiJobsTable';
import VideoPlayerModal from './VideoPlayerModal';


const VideoAnalysisJobs = ({ classId, startTime, endTime, filterField }) => {
  const [selectedAnalysisJob, setSelectedAnalysisJob] = useState(null);
  const [aiJobs, setAiJobs] = useState([]);
  const [aiJobsLoading, setAiJobsLoading] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [videoUrl, setVideoUrl] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);


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

    // To refresh, we must fetch the latest job data.
    // We do this on every selection to ensure data is fresh.
    setAiJobsLoading(true);
    if (!isSameJob) {
      setSelectedAnalysisJob(job); // Optimistic selection for better UX
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

  const handleDeleteAnalysisJob = async (jobId, aiJobIds) => {
    if (!window.confirm(`Are you sure you want to soft delete this analysis job (${jobId}) and its ${aiJobIds?.length || 0} sub-jobs?`)) {
      return;
    }

    try {
      const batch = writeBatch(db);

      const analysisJobRef = doc(db, 'videoAnalysisJobs', jobId);
      batch.update(analysisJobRef, { deleted: true });

      if (aiJobIds && aiJobIds.length > 0) {
        aiJobIds.forEach(id => {
          const aiJobRef = doc(db, 'aiJobs', id);
          batch.update(aiJobRef, { deleted: true });
        });
      }

      await batch.commit();

      alert('Job and sub-jobs marked as deleted.');

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
        const functions = getFunctions();
        const retryer = httpsCallable(functions, 'retryVideoAnalysisJob');
        
        const result = await retryer({ jobId: selectedAnalysisJob.id });

        alert(`Successfully started retry. Server response: ${result.data.result}`);
      
        refetch();

    } catch (error) {
        console.error("Error retrying job:", error);
        alert(`Failed to retry job: ${error.message}`);
    } finally {
        setRetryLoading(false);
    }
  };

  const handleExportAiJobs = () => {
    if (aiJobs.length === 0 || !selectedAnalysisJob) {
      alert("No AI jobs to export.");
      return;
    }

    const headers = ['Student', 'Status', 'Result', 'Error Details', 'Created At', 'Video Path'];
    
    const csvRows = aiJobs.map(job => {
      const student = job.studentEmail || '';
      const status = job.status || '';
      const result = (job.result && typeof job.result === 'object') ? JSON.stringify(job.result) : (job.result || '');
      const errorDetails = job.errorDetails || '';
      const createdAt = job.timestamp?.toDate().toLocaleString() || '';
      const videoPath = (job.mediaPaths && job.mediaPaths[0]) || '';

      const escape = (str) => `"${String(str).replace(/"/g, '""')}"`;

      return [
        escape(student),
        escape(status),
        escape(result),
        escape(errorDetails),
        escape(createdAt),
        escape(videoPath)
      ].join(',');
    });

    const csvContent = [headers.join(','), ...csvRows].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `analysis-${selectedAnalysisJob.id}.csv`);
    document.body.appendChild(link);
    
    link.click();
    
    document.body.removeChild(link);
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

  const hasFailedSubJobs = useMemo(() => aiJobs.some(j => j.status === 'failed'), [aiJobs]);


  return (
    <div className="view-container">
      <VideoPlayerModal show={showPlayer} onClose={() => setShowPlayer(false)} videoUrl={videoUrl} loading={playerLoading} />
      <div className="view-header">
        <h2>Video Analysis Jobs</h2>
      </div>
      
      <div className="actions-container" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div className="filter-column">


        </div>
      </div>

      <>
        {analysisJobsLoading ? (
          <p>Loading analysis jobs...</p>
        ) : videoAnalysisJobs.length === 0 ? (
          <p>No analysis jobs found for the selected criteria.</p>
        ) : (
          <>
            <VideoAnalysisJobsTable 
            jobs={videoAnalysisJobs} 
            selectedJob={selectedAnalysisJob} 
            onSelectJob={handleAnalysisJobSelect} 
            onDeleteJob={handleDeleteAnalysisJob} 
          />
          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem' }}>
            <button onClick={fetchPrevPage} disabled={page <= 1 || analysisJobsLoading}>
              Previous
            </button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={isLastPage || analysisJobsLoading}>
              Next
            </button>
          </div>
          </>
        )}

        {selectedAnalysisJob && (
          <div style={{ marginTop: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>AI Jobs for Analysis Job: {selectedAnalysisJob.id}</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={() => setSelectedAnalysisJob(null)}>Close</button>
                  {((
                    selectedAnalysisJob.status === 'partial_failure' || 
                    selectedAnalysisJob.status === 'failed'
                  ) || (
                    selectedAnalysisJob.status === 'processing' && hasFailedSubJobs
                  )) && (
                    <button onClick={handleRetryFailedJobs} disabled={retryLoading}>
                      {retryLoading ? 'Retrying...' : 'Retry Failed Jobs'}
                    </button>
                  )}
                  {aiJobs.length > 0 && (
                      <button onClick={handleExportAiJobs}>Export AI Jobs</button>
                  )}
                </div>
              </div>
              {aiJobsLoading ? (
                  <p>Loading AI jobs...</p>
              ) : aiJobs.length === 0 ? (
                  <p>No AI jobs found for this analysis job.</p>
              ) : (
                  <AiJobsTable aiJobs={aiJobs} onPlayVideo={handlePlayVideo} />
              )}
          </div>
        )}
      </>

    </div>
  );
};

export default VideoAnalysisJobs;