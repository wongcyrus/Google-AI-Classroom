import { useState, useEffect, useRef, useMemo } from 'react';
import { doc, getDoc, collection, query, where, orderBy, getDocs, setDoc, serverTimestamp, onSnapshot, deleteDoc } from 'firebase/firestore';
import { ref, getDownloadURL, deleteObject } from 'firebase/storage';
import { db, storage } from '../firebase-config';
import './SharedViews.css';
import TimelineSlider from './TimelineSlider';

import usePaginatedQuery from '../hooks/useCollectionQuery';

const PlaybackView = ({ classId, selectedLesson, startTime, endTime }) => {
  console.log('PlaybackView rendered for class:', classId);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');

  const [sessionData, setSessionData] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [lastBatchJobInfo, setLastBatchJobInfo] = useState(null);
  const [statusFilter, setStatusFilter] = useState([]);
  const [selectedJobs, setSelectedJobs] = useState(new Set());
  const [errorModalJob, setErrorModalJob] = useState(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // images per second
  const [screenshotImageUrls, setScreenshotImageUrls] = useState({});
  const [isFetchingUrls, setIsFetchingUrls] = useState(false);
  const urlsFetched = useRef(new Set());

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

  // Effect to pre-fetch screenshot URLs in a buffer
  useEffect(() => {
    if (screenshots.length === 0 || isFetchingUrls) return;

    const preFetchUrls = async () => {
      setIsFetchingUrls(true);
      const BUFFER = 5; // How many images to pre-fetch
      const start = currentIndex;
      const end = Math.min(screenshots.length, start + BUFFER);

      const urlsToFetch = [];
      for (let i = start; i < end; i++) {
        const screenshot = screenshots[i];
        if (screenshot && !urlsFetched.current.has(screenshot.imagePath)) {
          urlsToFetch.push(screenshot);
        }
      }

      if (urlsToFetch.length === 0) {
        setIsFetchingUrls(false);
        return;
      }

      const newUrls = {};
      for (const screenshot of urlsToFetch) {
        try {
          const url = await getDownloadURL(ref(storage, screenshot.imagePath));
          newUrls[screenshot.imagePath] = url;
          urlsFetched.current.add(screenshot.imagePath);
        } catch (error) {
          console.error(`Failed to pre-fetch URL for ${screenshot.imagePath}:`, error);
        }
      }

      setScreenshotImageUrls(prev => ({ ...prev, ...newUrls }));
      setIsFetchingUrls(false);
    };

    preFetchUrls();
  }, [currentIndex, screenshots, isFetchingUrls]);

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

  // Fetch screenshots when a session is loaded
  useEffect(() => {
    if (!sessionData) return;

    const fetchScreenshots = async () => {
      console.log('Starting to fetch screenshot metadata:', sessionData);
      setLoading(true);
      setScreenshots([]);
      setCurrentIndex(0);
      setScreenshotImageUrls({});
      urlsFetched.current.clear();

      try {
        const screenshotsRef = collection(db, 'screenshots');
        const q = query(
          screenshotsRef,
          where("classId", "==", classId),
          where("studentUid", "==", sessionData.studentUid),
          where("timestamp", ">=", new Date(sessionData.start)),
          where("timestamp", "<=", new Date(sessionData.end)),
          where("deleted", "==", false),
          orderBy("timestamp", "asc")
        );
        console.log('Executing query to fetch screenshot documents...');
        const querySnapshot = await getDocs(q);
        const screenshotDocs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        console.log(`Found ${screenshotDocs.length} screenshot documents.`);

        if (screenshotDocs.length === 0) {
          setLoading(false);
          return;
        }

        setScreenshots(screenshotDocs);
      } catch (error) {
        console.error("Error fetching screenshots:", error);
        alert("Failed to fetch session data. Check the console for errors. It's possible the database index is still building.");
      }
      setLoading(false);
    };

    fetchScreenshots();
  }, [sessionData, classId]);

  // Playback timer logic
  useEffect(() => {
    if (isPlaying && screenshots.length > 0) {
      const timer = setTimeout(() => {
        setCurrentIndex(prev => (prev === screenshots.length - 1 ? 0 : prev + 1));
      }, 1000 / playbackSpeed);
      return () => clearTimeout(timer);
    }
  }, [isPlaying, currentIndex, screenshots, playbackSpeed]);

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
    setScreenshotImageUrls({});
    urlsFetched.current.clear();
    setSessionData({ studentUid: selectedStudent, studentEmail: studentInfo.email, start: startTime, end: endTime });
  };

  // Poll for video job status
  useEffect(() => {
    if (!activeJobId) return;

    const intervalId = setInterval(async () => {
      try {
        const jobDocRef = doc(db, 'videoJobs', activeJobId);
        const jobDocSnap = await getDoc(jobDocRef);

        if (jobDocSnap.exists()) {
          const jobData = jobDocSnap.data();
          switch (jobData.status) {
            case 'completed':
              setNotification({ 
                type: 'success', 
                message: `Video created successfully!`,
                url: jobData.videoUrl 
              });
              setActiveJobId(null);
              clearInterval(intervalId);
              break;
            case 'failed':
              setNotification({ 
                type: 'error', 
                message: `Video creation failed: ${jobData.error || 'Unknown error'}` 
              });
              setActiveJobId(null);
              clearInterval(intervalId);
              break;
            case 'processing':
              setNotification({ type: 'info', message: 'Video is processing...' });
              break;
            case 'pending':
            default:
              setNotification({ type: 'info', message: 'Video job is pending...' });
              break;
          }
        } else {
          setNotification({ type: 'error', message: 'Video job details not found.' });
          setActiveJobId(null);
          clearInterval(intervalId);
        }
      } catch (error) {
        console.error("Error polling for job status:", error);
        setNotification({ type: 'error', message: 'Error checking video job status.' });
        setActiveJobId(null);
        clearInterval(intervalId);
      }
    }, 10000); // Poll every 10 seconds

    return () => clearInterval(intervalId); // Cleanup on unmount
  }, [activeJobId]);

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

  const handleCombineToVideo = async () => {
    if (!sessionData) return;

    setNotification({ type: 'info', message: 'Initiating video creation job...' });

    try {
      const q = query(
          collection(db, 'videoJobs'),
          where('classId', '==', classId),
          where('studentUid', '==', sessionData.studentUid),
          where('startTime', '==', new Date(startTime)),
          where('endTime', '==', new Date(endTime)),
          where('status', 'in', ['pending', 'processing', 'completed'])
      );
      const existingJobs = await getDocs(q);
      if (!existingJobs.empty) {
          setNotification({ type: 'warning', message: 'A similar video job already exists.' });
          return;
      }

      const jobCollectionRef = collection(db, 'videoJobs');
      const newDocRef = doc(jobCollectionRef);
      const jobId = newDocRef.id;

      await setDoc(newDocRef, {
        jobId: jobId,
        classId: classId,
        studentUid: sessionData.studentUid,
        studentEmail: sessionData.studentEmail,
        startTime: new Date(sessionData.start),
        endTime: new Date(sessionData.end),
        status: 'pending',
        createdAt: serverTimestamp(),
      });

      setActiveJobId(jobId);
      setNotification({ type: 'info', message: `Video job created (ID: ${jobId}). Waiting for processing to start...` });

    } catch (error) {
      console.error('Error creating video job:', error);
      setNotification({ type: 'error', message: `Error: ${error.message}` });
    }
  };

  const handleCombineAllToVideo = async () => {
    if (!selectedLesson) {
        alert('Please select a lesson.');
        return;
    }
    if (students.length === 0) {
        alert('No students in this class.');
        return;
    }

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
    }
  };

  const currentTimestamp = screenshots[currentIndex]?.timestamp.toDate().toLocaleString();
  const currentImageUrl = screenshots[currentIndex]?.imagePath ? screenshotImageUrls[screenshots[currentIndex].imagePath] : null;

  const bufferedRanges = useMemo(() => {
    if (screenshots.length === 0) return [];

    const ranges = [];
    let inRange = false;
    let start = 0;

    for (let i = 0; i < screenshots.length; i++) {
      const screenshot = screenshots[i];
      const hasUrl = screenshot && screenshotImageUrls[screenshot.imagePath];

      if (hasUrl && !inRange) {
        inRange = true;
        start = i;
      } else if (!hasUrl && inRange) {
        inRange = false;
        ranges.push({ start, end: i - 1 });
      }
    }

    if (inRange) {
      ranges.push({ start, end: screenshots.length - 1 });
    }

    return ranges;
  }, [screenshots, screenshotImageUrls]);


  if (sessionData) {
    return (
        <div className="view-container playback-player">
            <div className="view-header">
              <h3>Playback for: {sessionData.student}</h3>
            </div>
            <button onClick={() => setSessionData(null)}>Back to Selection</button>
            <button onClick={handleCombineToVideo} disabled={activeJobId || screenshots.length === 0}>
              {activeJobId ? 'Processing...' : 'Combine to Video'}
            </button>
            
            {notification && (
              <div className={`notification notification-${notification.type}`}>
                <p>{notification.message}</p>
                {notification.type === 'success' && notification.url && (
                  <a href={notification.url} target="_blank" rel="noopener noreferrer">Download Video</a>
                )}
              </div>
            )}

            <div className="player-controls">
                <button onClick={() => setCurrentIndex(0)} disabled={screenshots.length === 0}>First</button>
                <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={screenshots.length === 0}>Prev</button>
                <button className="play-pause" onClick={() => setIsPlaying(!isPlaying)} disabled={screenshots.length === 0}>
                    {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button onClick={() => setCurrentIndex(prev => Math.min(screenshots.length - 1, prev + 1))} disabled={screenshots.length === 0}>Next</button>
                <button onClick={() => setCurrentIndex(screenshots.length - 1)} disabled={screenshots.length === 0}>Last</button>
            </div>
            <div className="timeline-controls">
                <TimelineSlider
                    min={0}
                    max={screenshots.length > 0 ? screenshots.length - 1 : 0}
                    value={currentIndex}
                    onChange={e => setCurrentIndex(Number(e.target.value))}
                    bufferedRanges={bufferedRanges}
                />
                <label>Speed: </label>
                <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))}>
                    <option value="0.5">0.5x</option>
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="4">4x</option>
                </select>
            </div>
            <div className="player-main">
                {loading ? (
                    <p>Loading session...</p>
                ) : screenshots.length > 0 ? (
                    <img src={currentImageUrl} alt={`Screenshot for ${sessionData.student}`} />
                ) : (
                    <p>No screenshots found for the selected student and time range.</p>
                )}
            </div>
            <div className="player-info">
                <span>{currentTimestamp || 'N/A'}</span>
                <span>Frame: {currentIndex + 1} / {screenshots.length}</span>
            </div>
        </div>
    )
  }

  return (
    <div className="view-container playback-selection">
      <div className="view-header">
        <h2>Session Playback</h2>
        <p>Select a student and a time range to begin.</p>
      </div>
      <div className="actions-container" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
            <label htmlFor="student-select">Student: </label>
            <select id="student-select" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
                <option value="" disabled>Select a student</option>
                {students.map(student => (
                    <option key={student.uid} value={student.uid}>{student.email}</option>
                ))}
            </select>
            <button onClick={handleStartPlayback} disabled={loading || !selectedStudent}>Load Student</button>

        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span>Status:</span>
              {['pending', 'processing', 'completed', 'failed'].map(status => (
                <label key={status} style={{ textTransform: 'capitalize' }}>
                  <input
                    type="checkbox"
                    checked={statusFilter.includes(status)}
                    onChange={() => handleStatusFilterChange(status)}
                  />
                  {status}
                </label>
              ))}
            </div>
            <button onClick={handleCombineAllToVideo} disabled={loading || !selectedLesson}>Combine All Students' Videos</button>
            <button onClick={handleDeleteSelectedJobs} disabled={selectedJobs.size === 0}>
              Delete Selected ({selectedJobs.size})
            </button>
        </div>
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

export default PlaybackView;