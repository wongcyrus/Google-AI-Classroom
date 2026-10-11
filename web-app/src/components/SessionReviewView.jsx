import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot, deleteDoc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { db, storage, functions } from '../firebase-config';
import { ref, deleteObject, getDownloadURL } from 'firebase/storage';
import { httpsCallable } from 'firebase/functions';

import usePaginatedQuery from '../hooks/useCollectionQuery';
import VideoPlayerModal from './VideoPlayerModal';
import { exportToExcel } from '../utils/exportUtils';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';

const SessionReviewView = ({ classId, startTime, endTime }) => {
  console.log('SessionReviewView rendered for class:', classId);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  const [notification, setNotification] = useState(null);
  const [statusFilter, setStatusFilter] = useState([]);
  const [selectedJobs, setSelectedJobs] = useState(new Set());
  const [errorModalJob, setErrorModalJob] = useState(null);

  const [selectedVideoJob, setSelectedVideoJob] = useState(null);
  const [showVideoModal, setShowVideoModal] = useState(false);
  const [videoPlaybackUrl, setVideoPlaybackUrl] = useState('');
  const [videoLoading, setVideoLoading] = useState(false);

  const { data: videoJobsFromHook } = usePaginatedQuery('videoJobs', {
    classId,
    startTime,
    endTime,
    filterField: 'startTime',
    orderByField: 'startTime',
  });

  const filteredVideoJobs = useMemo(() => {
    if (!videoJobsFromHook) return [];
    // Create a shallow copy before sorting to avoid mutating the original array
    const jobs = [...videoJobsFromHook];

    if (statusFilter.length > 0) {
      return jobs
        .filter(job => statusFilter.includes(job.status))
        .sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
    }
    
    // Perform sort on the copied array
    jobs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
    return jobs;
  }, [videoJobsFromHook, statusFilter]);



  useEffect(() => {
    if (!classId) {
      console.log('SessionReviewView: No classId provided.');
      return;
    }
    console.log(`SessionReviewView: Setting up student listener for classId: ${classId}`);

    const classRef = doc(db, 'classes', classId);
    const unsubscribe = onSnapshot(classRef, (classSnap) => {
      console.log('SessionReviewView: Class snapshot received.');
      if (classSnap.exists()) {
        const classData = classSnap.data();
        const studentsMap = classData.students || {}; // This is the map {uid: email}
        const profilesMap = classData.studentProfiles || {};
        
        const studentList = Object.entries(studentsMap).map(([uid, email]) => {
          const prof = getStudentProfile(email, profilesMap);
          const displayName = getStudentDisplayName(email, profilesMap);
          return {
            uid: uid,
            email: email,
            displayName: displayName,
            studentClass: prof.studentClass,
            programme: prof.programme,
          };
        });

        studentList.sort((a, b) => a.displayName.localeCompare(b.displayName));
        setStudents(studentList);

      } else {
        console.log(`SessionReviewView: Class document with id ${classId} does not exist!`);
        setStudents([]);
      }
    }, (error) => {
      console.error(`SessionReviewView: Error listening to class document ${classId}:`, error);
      setStudents([]);
    });

    return () => {
      console.log(`SessionReviewView: Unsubscribing from student listener for classId: ${classId}`);
      unsubscribe();
    };
  }, [classId]);







  const handleStatusFilterChange = (status) => {
    setStatusFilter(prev => {
      if (prev.includes(status)) {
        return prev.filter(s => s !== status);
      } else {
        return [...prev, status];
      }
    });
  };

  const handleSelectJob = (jobId) => {
    setSelectedJobs(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(jobId)) {
        newSelection.delete(jobId);
      } else {
        newSelection.add(jobId);
      }
      return newSelection;
    });
  };

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      const allJobIds = new Set(filteredVideoJobs.map(job => job.id));
      setSelectedJobs(allJobIds);
    } else {
      setSelectedJobs(new Set());
    }
  };

  const deleteJob = async (jobId) => {
    const jobDocRef = doc(db, 'videoJobs', jobId);
    const jobDocSnap = await getDoc(jobDocRef);

    if (jobDocSnap.exists()) {
      const jobData = jobDocSnap.data();
      if (jobData.videoPath) {
        const storageRef = ref(storage, jobData.videoPath);
        await deleteObject(storageRef);
      }
    }
    await deleteDoc(jobDocRef);
  };

  const handleDeleteSelectedJobs = async () => {
    if (selectedJobs.size === 0) return;
    if (!window.confirm(`Are you sure you want to delete ${selectedJobs.size} selected jobs? This will also delete their associated video files.`)) {
      return;
    }

    setNotification({ type: 'info', message: `Deleting ${selectedJobs.size} jobs...` });
    const errors = [];
    for (const jobId of selectedJobs) {
      try {
        await deleteJob(jobId);
      } catch (error) {
        console.error(`Failed to delete job ${jobId}`, error);
        errors.push(jobId);
      }
    }

    setSelectedJobs(new Set());
    if (errors.length > 0) {
      setNotification({ type: 'error', message: `Failed to delete ${errors.length} jobs. See console for details.` });
    } else {
      setNotification({ type: 'success', message: `Successfully deleted ${selectedJobs.size} jobs.` });
    }
  };

  const handleExportVideoJobsExcel = async () => {
    if (!filteredVideoJobs || filteredVideoJobs.length === 0) {
      alert("No video jobs to export.");
      return;
    }
    const headers = [
      'Job ID',
      'Student Name',
      'Student Email',
      'Class / Cohort',
      'Programme',
      'Student UID',
      'Start Time',
      'End Time',
      'Created At',
      'Status',
      'Error Details'
    ];
    const rows = filteredVideoJobs.map(job => {
      const student = students.find(s => s.uid === job.studentUid || s.email === job.studentEmail || s.email === job.email);
      const studentEmail = job.studentEmail || job.email || job.userEmail || student?.email || (job.studentUid?.includes('@') ? job.studentUid : '');
      const studentUid = job.studentUid || job.uid || student?.uid || 'N/A';
      const studentName = student?.displayName || job.displayName || job.studentName || job.name || (studentEmail || 'All Students');
      const studentClass = student?.studentClass || student?.cohort || job.studentClass || job.cohort || '';
      const programme = student?.programme || job.programme || '';

      return [
        job.id,
        studentName,
        studentEmail || 'All Students',
        studentClass,
        programme,
        studentUid,
        job.startTime?.toDate ? job.startTime.toDate().toISOString() : (job.startTime || 'N/A'),
        job.endTime?.toDate ? job.endTime.toDate().toISOString() : (job.endTime || 'N/A'),
        job.createdAt?.toDate ? job.createdAt.toDate().toISOString() : (job.createdAt || 'N/A'),
        job.status || 'unknown',
        job.error || job.errorDetails || ''
      ];
    });
    const dateSuffix = new Date().toISOString().slice(0, 10);
    const filename = `Class_${classId}_Video_Jobs_${dateSuffix}.xlsx`;
    await exportToExcel(headers, rows, filename);
  };

  const handlePlayVideo = async (job) => {
    if (!job) return;
    setSelectedVideoJob(job);
    setShowVideoModal(true);
    setVideoLoading(true);
    setVideoPlaybackUrl('');

    try {
      let url = job.videoUrl || '';
      if (!url) {
        try {
          const getStudentVideoPlaybackUrl = httpsCallable(functions, 'getStudentVideoPlaybackUrl');
          const res = await getStudentVideoPlaybackUrl({ jobId: job.id || job.jobId });
          if (res?.data?.url) {
            url = res.data.url;
          }
        } catch (callErr) {
          console.warn('Callable function getStudentVideoPlaybackUrl failed, trying storage fallback:', callErr);
        }
      }

      if (!url && job.videoPath) {
        const videoRef = ref(storage, job.videoPath);
        url = await getDownloadURL(videoRef);
      }

      if (url) {
        setVideoPlaybackUrl(url);
      } else {
        setNotification({ type: 'error', message: 'Video file could not be accessed or is still compiling.' });
      }
    } catch (err) {
      console.error('Error resolving video playback URL:', err);
      setNotification({ type: 'error', message: `Failed to load video: ${err.message}` });
    } finally {
      setVideoLoading(false);
    }
  };

  const selectedStudentCompletedJob = useMemo(() => {
    if (!selectedStudent || !filteredVideoJobs) return null;
    const studentInfo = students.find(s => s.uid === selectedStudent);
    const studentEmail = studentInfo?.email;
    return filteredVideoJobs.find(job => 
      (job.studentUid === selectedStudent || (studentEmail && (job.studentEmail === studentEmail || job.email === studentEmail))) &&
      job.status === 'completed'
    ) || null;
  }, [selectedStudent, filteredVideoJobs, students]);

  const handleStartPlayback = () => {
    if (!selectedStudent) {
      alert('Please select a student.');
      return;
    }
    const studentInfo = students.find(s => s.uid === selectedStudent);
    if (!studentInfo) {
      alert('Could not find student details.');
      return;
    }
    const targetEmail = studentInfo.email;
    const completedJob = filteredVideoJobs.find(job => 
      (job.studentUid === selectedStudent || (targetEmail && (job.studentEmail === targetEmail || job.email === targetEmail))) &&
      job.status === 'completed'
    );
    if (completedJob) {
      handlePlayVideo(completedJob);
    } else {
      setNotification({
        type: 'info',
        message: `No completed compiled video found for ${targetEmail || selectedStudent} in this time range.`
      });
    }
  };

  return (
    <div className="view-container playback-selection">
      <div className="view-header">
        <h2>Session Review &amp; Video Playback</h2>
        <p>Select a student to stream their compiled lesson video recording or monitor compilation jobs.</p>
      </div>
      <div className="actions-container" style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
        <label htmlFor="student-select">Student: </label>
        <input
          type="text"
          placeholder="Search student..."
          value={studentSearch}
          onChange={(e) => setStudentSearch(e.target.value)}
          style={{ marginRight: '10px' }}
        />
        <select id="student-select" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
            <option value="" disabled>Select a student</option>
            {students
              .filter(student => (
                student.email.toLowerCase().includes(studentSearch.toLowerCase()) ||
                (student.displayName && student.displayName.toLowerCase().includes(studentSearch.toLowerCase())) ||
                (student.studentClass && student.studentClass.toLowerCase().includes(studentSearch.toLowerCase()))
              ))
              .map(student => (
                <option key={student.uid} value={student.uid}>
                  {student.displayName && student.displayName !== student.email
                    ? `${student.displayName} (${student.email})${student.studentClass ? ` - [${student.studentClass}]` : ''}`
                    : `${student.email}${student.studentClass ? ` - [${student.studentClass}]` : ''}`}
                </option>
            ))}
        </select>
        <button
          onClick={handleStartPlayback}
          disabled={!selectedStudent}
          aria-label="Play Student Video"
          style={{
            backgroundColor: selectedStudentCompletedJob ? '#2563eb' : undefined,
            color: selectedStudentCompletedJob ? '#ffffff' : undefined,
            fontWeight: 600
          }}
          title={selectedStudentCompletedJob ? "Play the student's compiled MP4 video" : "Load and play student video"}
        >
          ▶️ Play Student Video
        </button>

        <span style={{ borderLeft: '1px solid #ccc', height: '24px' }}></span>

        <span>Status:</span>
        {['pending', 'processing', 'completed', 'failed'].map(status => (
            <label key={status} style={{ textTransform: 'capitalize', fontWeight: 'normal' }}>
                <input
                    type="checkbox"
                    checked={statusFilter.includes(status)}
                    onChange={() => handleStatusFilterChange(status)}
                />
                {status}
            </label>
        ))}

        <span style={{ borderLeft: '1px solid #ccc', height: '24px' }}></span>

        <button onClick={handleDeleteSelectedJobs} disabled={selectedJobs.size === 0}>
          Delete Selected ({selectedJobs.size})
        </button>
      </div>
      {notification && (
        <div className={`notification notification-${notification.type}`} style={{ position: 'relative', paddingRight: '40px' }}>
          <p>{notification.message}</p>
          <button onClick={() => setNotification(null)} style={{
            position: 'absolute', top: '50%', right: '15px', transform: 'translateY(-50%)',
            background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer',
            lineHeight: 1, padding: 0
          }}>
            &times;
          </button>
        </div>
      )}
      <div className="jobs-table">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3 style={{ margin: 0 }}>Video Jobs</h3>
            <button
              onClick={handleExportVideoJobsExcel}
              disabled={filteredVideoJobs.length === 0}
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
              📥 Export Video Jobs (Excel)
            </button>
          </div>
          <table>
              <thead>
                  <tr>
                      <th><input type="checkbox" onChange={handleSelectAll} /></th>
                      <th>Job ID</th>
                      <th>Student</th>
                      <th>Start Time</th>
                      <th>End Time</th>
                      <th>Created At</th>
                      <th>Status</th>
                      <th>Action</th>
                  </tr>
              </thead>
              <tbody>
                  {filteredVideoJobs.map(job => (
                      <tr key={job.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedJobs.has(job.id)}
                              onChange={() => handleSelectJob(job.id)}
                            />
                          </td>
                          <td>{job.id}</td>
                          <td>{job.studentEmail || 'All Students'}</td>
                          <td>{job.startTime?.toDate ? job.startTime.toDate().toLocaleString() : (job.startTime?.toLocaleString ? job.startTime.toLocaleString() : 'N/A')}</td>
                          <td>{job.endTime?.toDate ? job.endTime.toDate().toLocaleString() : (job.endTime?.toLocaleString ? job.endTime.toLocaleString() : 'N/A')}</td>
                          <td>{job.createdAt?.toDate ? job.createdAt.toDate().toLocaleString() : (job.createdAt?.toLocaleString ? job.createdAt.toLocaleString() : '')}</td>
                          <td>
                            {job.status === 'failed' ? (
                              <a 
                                href="#" 
                                onClick={(e) => { 
                                  e.preventDefault(); 
                                  setErrorModalJob(job);
                                }} 
                                style={{ color: 'red', textDecoration: 'underline', cursor: 'pointer' }}
                              >
                                {job.status}
                              </a>
                            ) : (
                              job.status
                            )}
                          </td>
                          <td>
                            {job.status === 'completed' && (
                              <button
                                onClick={() => handlePlayVideo(job)}
                                style={{
                                  padding: '4px 8px',
                                  borderRadius: '4px',
                                  backgroundColor: '#2563eb',
                                  color: '#ffffff',
                                  border: 'none',
                                  cursor: 'pointer',
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px'
                                }}
                                title="Play student video recording"
                              >
                                ▶️ Play Video
                              </button>
                            )}
                          </td>
                      </tr>
                  ))}
              </tbody>
          </table>
      </div>
      {errorModalJob && (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1001
        }}>
            <div style={{
                backgroundColor: 'white', padding: '20px', borderRadius: '8px',
                width: '80%', maxWidth: '800px', maxHeight: '90vh', overflowY: 'auto', position: 'relative'
            }}>
                <button onClick={() => setErrorModalJob(null)} style={{
                    position: 'absolute', top: '15px', right: '15px', background: 'none',
                    border: 'none', cursor: 'pointer', padding: 0, lineHeight: 0
                }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M18 6L6 18" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M6 6L18 18" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                </button>
                <h4>Job Failure Details (Job ID: {errorModalJob.id})</h4>
                
                <h5 style={{ marginTop: '20px' }}>Error Message</h5>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f5f5f5', padding: '10px', borderRadius: '5px' }}>
                    {errorModalJob.error || 'N/A'}
                </pre>

                <h5 style={{ marginTop: '20px' }}>ffmpeg Log / Details</h5>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f5f5f5', padding: '10px', borderRadius: '5px' }}>
                    {errorModalJob.ffmpegError || 'N/A'}
                </pre>

                <h5 style={{ marginTop: '20px' }}>Stack Trace</h5>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', background: '#f5f5f5', padding: '10px', borderRadius: '5px' }}>
                    {errorModalJob.errorStack || 'N/A'}
                </pre>
            </div>
        </div>
      )}
      <VideoPlayerModal
        show={showVideoModal}
        onClose={() => setShowVideoModal(false)}
        videoUrl={videoPlaybackUrl}
        loading={videoLoading}
        video={selectedVideoJob}
      />
    </div>
  );
};

export default SessionReviewView;