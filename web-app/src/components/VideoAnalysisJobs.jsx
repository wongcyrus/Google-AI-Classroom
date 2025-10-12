import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit, startAfter, documentId, doc, writeBatch } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

import usePaginatedQuery from '../hooks/useCollectionQuery';

const VideoAnalysisJobs = ({ classId, startTime, endTime }) => {
  const [selectedAnalysisJob, setSelectedAnalysisJob] = useState(null);
  const [aiJobs, setAiJobs] = useState([]);
  const [aiJobsLoading, setAiJobsLoading] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [playerLoading, setPlayerLoading] = useState(false);
  const [filterField, setFilterField] = useState('startTime');

  const { 
    data: videoAnalysisJobs, 
    loading: analysisJobsLoading, 
    isLastPage, 
    fetchNextPage 
  } = usePaginatedQuery('videoAnalysisJobs', {
    classId,
    startTime,
    endTime,
    filterField,
    orderByField: filterField,
    extraClauses: [{ field: 'deleted', op: '==', value: false }]
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
    if (selectedAnalysisJob && selectedAnalysisJob.id === job.id) {
        setSelectedAnalysisJob(null); // Toggle off if clicking the same job
        setAiJobs([]);
    } else {
        setSelectedAnalysisJob(job);
        if (job.aiJobIds && job.aiJobIds.length > 0) {
            fetchAiJobs(job.aiJobIds);
        } else {
            setAiJobs([]);
        }
    }
  };

  const handleDeleteAnalysisJob = async (jobId, aiJobIds) => {
    if (!window.confirm(`Are you sure you want to soft delete this analysis job (${jobId}) and its ${aiJobIds?.length || 0} sub-jobs?`)) {
      return;
    }

    setAnalysisJobsLoading(true);

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

      setVideoAnalysisJobs(prevJobs => prevJobs.filter(job => job.id !== jobId));
      if (selectedAnalysisJob?.id === jobId) {
        setSelectedAnalysisJob(null);
        setAiJobs([]);
      }
    } catch (error) {
      console.error("Error deleting analysis job:", error);
      alert(`An error occurred while deleting the job: ${error.message}`);
    } finally {
      setAnalysisJobsLoading(false);
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

  const VideoPlayerModal = () => (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
      backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex',
      justifyContent: 'center', alignItems: 'center', zIndex: 1050
    }} onClick={() => setShowPlayer(false)}>
      <div style={{
        position: 'relative', padding: '20px', background: 'white',
        borderRadius: '8px', maxWidth: '90vw', maxHeight: '90vh'
      }} onClick={e => e.stopPropagation()}>
        <button onClick={() => setShowPlayer(false)} style={{
          position: 'absolute', top: '10px', right: '10px',
          background: 'transparent', border: 'none', fontSize: '1.5rem', cursor: 'pointer'
        }}>
          &times;
        </button>
        {playerLoading ? (
          <p>Loading video...</p>
        ) : (
          <video controls autoPlay src={videoUrl} style={{ maxWidth: '100%', maxHeight: '80vh' }}>
            Your browser does not support the video tag.
          </video>
        )}
      </div>
    </div>
  );

  return (
    <div className="view-container">
      {showPlayer && <VideoPlayerModal />}
      <div className="view-header">
        <h2>Video Analysis Jobs</h2>
      </div>
      
      <div className="actions-container" style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
        <div className="filter-column">

          <div style={{ marginTop: '10px' }}>
            <label htmlFor="filter-field-select" style={{ marginRight: '10px' }}>Filter and Sort by: </label>
            <select 
              id="filter-field-select"
              value={filterField} 
              onChange={(e) => setFilterField(e.target.value)}
            >
              <option value="startTime">Lesson Start Time</option>
              <option value="createdAt">Job Creation Time</option>
            </select>
          </div>
        </div>
      </div>

      <>
        {analysisJobsLoading ? (
          <p>Loading analysis jobs...</p>
        ) : videoAnalysisJobs.length === 0 ? (
          <p>No analysis jobs found for the selected criteria.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Requester</th>
                  <th>Created At</th>
                  <th>Status</th>
                  <th>Prompt</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {videoAnalysisJobs.map(job => (
                  <tr key={job.id} onClick={() => handleAnalysisJobSelect(job)} style={{ cursor: 'pointer', backgroundColor: selectedAnalysisJob?.id === job.id ? '#eef' : 'transparent' }}>
                    <td>{job.requester}</td>
                    <td>{job.createdAt?.toDate().toLocaleString() || 'N/A'}</td>
                    <td>{job.status}</td>
                    <td style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{job.prompt}</td>
                    <td>
                      <button onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAnalysisJob(job.id, job.aiJobIds);
                      }}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selectedAnalysisJob && (
          <div style={{ marginTop: '30px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3>AI Jobs for Analysis Job: {selectedAnalysisJob.id}</h3>
                {aiJobs.length > 0 && (
                    <button onClick={handleExportAiJobs}>Export AI Jobs</button>
                )}
              </div>
              {aiJobsLoading ? (
                  <p>Loading AI jobs...</p>
              ) : aiJobs.length === 0 ? (
                  <p>No AI jobs found for this analysis job.</p>
              ) : (
                  <div className="table-container">
                      <table>
                          <thead>
                              <tr>
                                  <th>Play</th>
                                  <th>Student</th>
                                  <th>Status</th>
                                  <th>Result</th>
                                  <th>Created At</th>
                              </tr>
                          </thead>
                          <tbody>
                              {aiJobs.map(job => (
                                  <tr key={job.id}>
                                      <td>
                                          <button onClick={() => handlePlayVideo({ videoPath: job.mediaPaths && job.mediaPaths[0] })} style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}>
                                              ▶️
                                          </button>
                                      </td>
                                      <td>{job.studentEmail}</td>
                                      <td>{job.status}</td>
                                      <td>
                                          {job.status === 'failed' ? (
                                              <pre style={{ color: 'red', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{job.errorDetails}</pre>
                                          ) : (
                                              <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{typeof job.result === 'object' ? JSON.stringify(job.result, null, 2) : job.result}</pre>
                                          )}
                                      </td>
                                      <td>{job.timestamp?.toDate().toLocaleString() || 'N/A'}</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              )}
          </div>
        )}
      </>

      <div className="pagination-controls">
        <button disabled>Previous</button> {/* Previous not implemented */}
        <button onClick={fetchNextPage} disabled={isLastPage || analysisJobsLoading}>
          Next
        </button>
      </div>
    </div>
  );
};

export default VideoAnalysisJobs;