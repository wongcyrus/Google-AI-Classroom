import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot, deleteDoc, getDoc, collection, query, where, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage } from '../firebase-config';
import { ref, deleteObject } from 'firebase/storage';

import usePaginatedQuery from '../hooks/useCollectionQuery';

import PlaybackView from './PlaybackView';

const SessionReviewView = ({ classId, startTime, endTime }) => {
  console.log('SessionReviewView rendered for class:', classId);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [studentSearch, setStudentSearch] = useState('');

  const [sessionData, setSessionData] = useState(null);
  const [notification, setNotification] = useState(null);
  const [lastBatchJobInfo, setLastBatchJobInfo] = useState(null);
  const [statusFilter, setStatusFilter] = useState([]);
  const [selectedJobs, setSelectedJobs] = useState(new Set());
  const [errorModalJob, setErrorModalJob] = useState(null);
  const [loading, setLoading] = useState(false);



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
      console.log('PlaybackView: No classId provided.');
      return;
    }
    console.log(`PlaybackView: Setting up student listener for classId: ${classId}`);

    const classRef = doc(db, 'classes', classId);
    const unsubscribe = onSnapshot(classRef, (classSnap) => {
      console.log('PlaybackView: Class snapshot received.');
      if (classSnap.exists()) {
        const classData = classSnap.data();
        console.log('PlaybackView: Class document data:', classData);
        
        const studentsMap = classData.students || {}; // This is the new map {uid: email}
        
        const studentList = Object.entries(studentsMap).map(([uid, email]) => ({
          uid: uid,
          email: email,
        }));

        console.log('PlaybackView: Correctly processed student list:', studentList);
        studentList.sort((a, b) => a.email.localeCompare(b.email));
        setStudents(studentList);

      } else {
        console.log(`PlaybackView: Class document with id ${classId} does not exist!`);
        setStudents([]);
      }
    }, (error) => {
      console.error(`PlaybackView: Error listening to class document ${classId}:`, error);
      setStudents([]);
    });

    return () => {
      console.log(`PlaybackView: Unsubscribing from student listener for classId: ${classId}`);
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

  const handleCombineAllToVideo = async () => {
    if (students.length === 0) {
        alert('No students in this class.');
        return;
    }

    setLoading(true);

    setNotification({ type: 'info', message: `Checking for existing jobs and initiating video creation for ${students.length} students...` });
    setLastBatchJobInfo(null);

    try {
        const createdJobs = [];
        const skippedJobs = [];

        for (const student of students) {
            const q = query(
                collection(db, 'videoJobs'),
                where('classId', '==', classId),
                where('studentUid', '==', student.uid),
                where('startTime', '==', new Date(startTime)),
                where('endTime', '==', new Date(endTime)),
                where('status', 'in', ['pending', 'processing', 'completed'])
            );
            const existingJobs = await getDocs(q);
            if (!existingJobs.empty) {
                console.log(`Job already exists for ${student.email} in this time range.`);
                skippedJobs.push(student.email);
                continue;
            }

            const jobCollectionRef = collection(db, 'videoJobs');
            const newDocRef = doc(jobCollectionRef);
            const jobId = newDocRef.id;

            await setDoc(newDocRef, {
                jobId: jobId,
                classId: classId,
                studentUid: student.uid,
                studentEmail: student.email,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                status: 'pending',
                createdAt: serverTimestamp(),
            });
            createdJobs.push(student.email);
        }

        setLastBatchJobInfo({ created: createdJobs, skipped: skippedJobs });
        setNotification({ type: 'success', message: `Batch job summary: ${createdJobs.length} new jobs created, ${skippedJobs.length} jobs already existed.` });

    } catch (error) {
        console.error('Error creating video jobs for all students:', error);
        setNotification({ type: 'error', message: `Error: ${error.message}` });
    } finally {
        setLoading(false);
    }
  };


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
    console.log(`Loading session for ${studentInfo.email}`);
    setSessionData({ studentUid: selectedStudent, studentEmail: studentInfo.email, start: startTime, end: endTime });
  };

  if (sessionData) {
    return <PlaybackView sessionData={sessionData} onBack={() => setSessionData(null)} classId={classId} startTime={startTime} endTime={endTime} />;
  }

  return (
    <div className="view-container playback-selection">
      <div className="view-header">
        <h2>Session Playback</h2>
        <p>Select a student and a time range to begin.</p>
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
              .filter(student => student.email.toLowerCase().includes(studentSearch.toLowerCase()))
              .map(student => (
                <option key={student.uid} value={student.uid}>{student.email}</option>
            ))}
        </select>
        <button onClick={handleStartPlayback} disabled={!selectedStudent}>Load Student</button>

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

        <button onClick={handleCombineAllToVideo} disabled={loading}>Combine All Students' Videos</button>
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
      {lastBatchJobInfo && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
            justifyContent: 'center', alignItems: 'center', zIndex: 1000
          }}
          onClick={() => setLastBatchJobInfo(null)}
        >
          <div
            style={{
              backgroundColor: 'white', padding: '20px', borderRadius: '8px',
              width: '600px', maxHeight: '90vh', overflowY: 'auto', position: 'relative'
            }}
            onClick={e => e.stopPropagation()}
          >
            <button onClick={() => {
                console.log('Closing modal');
                setLastBatchJobInfo(null);
              }} style={{
              position: 'absolute', top: '15px', right: '15px', background: 'none',
              border: 'none', cursor: 'pointer', zIndex: 1001, padding: 0, lineHeight: 0
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M6 6L18 18" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            <h4>Last Batch Job Summary</h4>
            {lastBatchJobInfo.created.length > 0 && (
                <div>
                    <p>New jobs created for ({lastBatchJobInfo.created.length}):</p>
                    <ul style={{ columns: 2, listStyle: 'none', padding: 0 }}>
                        {lastBatchJobInfo.created.map(student => <li key={student}>{student}</li>)}
                    </ul>
                </div>
            )}
            {lastBatchJobInfo.skipped.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                    <p>Jobs already existed for ({lastBatchJobInfo.skipped.length}) - Skipped:</p>
                    <ul style={{ columns: 2, listStyle: 'none', padding: 0 }}>
                        {lastBatchJobInfo.skipped.map(student => <li key={student}>{student}</li>)}
                    </ul>
                </div>
            )}
          </div>
        </div>
      )}
      <div className="jobs-table">
          <h3>Video Jobs</h3>
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
                          <td>{job.startTime?.toDate().toLocaleString() || 'N/A'}</td>
                          <td>{job.endTime?.toDate().toLocaleString() || 'N/A'}</td>
                          <td>{job.createdAt?.toDate().toLocaleString()}</td>
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
    </div>
  );
};

export default SessionReviewView;