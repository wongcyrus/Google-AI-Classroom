import { useState, useEffect, useRef, useMemo } from 'react';
import { doc, getDoc, collection, query, where, orderBy, getDocs, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { useParams } from 'react-router-dom';
import { db, storage } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import TimelineSlider from './TimelineSlider';
import { useClassSchedule } from '../hooks/useClassSchedule';

const PlaybackView = ({ user }) => {
  const { classId } = useParams();
  console.log('PlaybackView rendered for class:', classId);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  
  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
  } = useClassSchedule(classId);

  const [sessionData, setSessionData] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [notification, setNotification] = useState(null);
  const [videoJobs, setVideoJobs] = useState([]);
  const [lastBatchJobInfo, setLastBatchJobInfo] = useState(null);
  const [filteredVideoJobs, setFilteredVideoJobs] = useState([]);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // images per second
  const [screenshotImageUrls, setScreenshotImageUrls] = useState({});
  const [isFetchingUrls, setIsFetchingUrls] = useState(false);
  const urlsFetched = useRef(new Set());

  useEffect(() => {
    if (!classId) return;
    const q = query(collection(db, 'videoJobs'), where('classId', '==', classId));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const jobs = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        jobs.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
        setVideoJobs(jobs);
    });
    return unsubscribe;
  }, [classId]);

  useEffect(() => {
    if (!selectedLesson) {
      setFilteredVideoJobs(videoJobs);
      return;
    }
    const lessonStartTime = new Date(startTime).getTime();
    const lessonEndTime = new Date(endTime).getTime();

    const filtered = videoJobs.filter(job => {
      if (!job.startTime) return false;
      const jobStartTime = job.startTime.toMillis();
      return jobStartTime >= lessonStartTime && jobStartTime < lessonEndTime;
    });
    setFilteredVideoJobs(filtered);
  }, [videoJobs, selectedLesson, startTime, endTime]);

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

  // Fetch students for the class
  useEffect(() => {
    const fetchStudents = async () => {
      if (!classId) return;
      console.log('Fetching students for class:', classId);
      const classRef = doc(db, 'classes', classId);
      const classSnap = await getDoc(classRef);
      if (classSnap.exists()) {
        const studentList = classSnap.data().students || [];
        setStudents(studentList.map(s => s.trim()));
      } else {
        console.error('Class document not found!');
      }
    };
    fetchStudents();
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
          where("email", "==", sessionData.student),
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
    console.log(`Loading session for ${selectedStudent}`);
    setScreenshotImageUrls({});
    urlsFetched.current.clear();
    setSessionData({ student: selectedStudent.trim().toLowerCase(), start: startTime, end: endTime });
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

  const handleCombineToVideo = async () => {
    if (!sessionData) return;

    setNotification({ type: 'info', message: 'Initiating video creation job...' });

    try {
      const q = query(
          collection(db, 'videoJobs'),
          where('classId', '==', classId),
          where('student', '==', sessionData.student),
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
        student: sessionData.student,
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

        for (const studentEmail of students) {
            const student = studentEmail.trim().toLowerCase();
            const q = query(
                collection(db, 'videoJobs'),
                where('classId', '==', classId),
                where('student', '==', student),
                where('startTime', '==', new Date(startTime)),
                where('endTime', '==', new Date(endTime)),
                where('status', 'in', ['pending', 'processing', 'completed'])
            );
            const existingJobs = await getDocs(q);
            if (!existingJobs.empty) {
                console.log(`Job already exists for ${student} in this time range.`);
                skippedJobs.push(student);
                continue;
            }

            const jobCollectionRef = collection(db, 'videoJobs');
            const newDocRef = doc(jobCollectionRef);
            const jobId = newDocRef.id;

            await setDoc(newDocRef, {
                jobId: jobId,
                classId: classId,
                student: student,
                startTime: new Date(startTime),
                endTime: new Date(endTime),
                status: 'pending',
                createdAt: serverTimestamp(),
            });
            createdJobs.push(student);
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
      const hasUrl = screenshot && urlsFetched.current.has(screenshot.imagePath);

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
      <div className="actions-container">
        <label htmlFor="student-select">Student: </label>
        <select id="student-select" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
            <option value="" disabled>Select a student</option>
            {students.map(email => (
                <option key={email} value={email}>{email}</option>
            ))}
        </select>
        <DateRangeFilter 
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          loading={loading}
          lessons={lessons}
          selectedLesson={selectedLesson}
          onLessonChange={handleLessonChange}
        />
        <button onClick={handleStartPlayback} disabled={loading || !selectedStudent}>Load Session</button>
        <button onClick={handleCombineAllToVideo} disabled={loading || !selectedLesson}>Combine All Students' Videos</button>
      </div>
      {notification && (
        <div className={`notification notification-${notification.type}`}>
          <p>{notification.message}</p>
        </div>
      )}
      {lastBatchJobInfo && (
        <div className="batch-job-info">
            <h4>Last Batch Job Summary</h4>
            {lastBatchJobInfo.created.length > 0 && (
                <div>
                    <p>New jobs created for:</p>
                    <ul>
                        {lastBatchJobInfo.created.map(student => <li key={student}>{student}</li>)}
                    </ul>
                </div>
            )}
            {lastBatchJobInfo.skipped.length > 0 && (
                <div>
                    <p>Jobs already existed for (skipped):</p>
                    <ul>
                        {lastBatchJobInfo.skipped.map(student => <li key={student}>{student}</li>)}
                    </ul>
                </div>
            )}
        </div>
      )}
      <div className="jobs-table">
          <h3>Video Jobs</h3>
          <table>
              <thead>
                  <tr>
                      <th>Job ID</th>
                      <th>Student</th>
                      <th>Created At</th>
                      <th>Status</th>
                  </tr>
              </thead>
              <tbody>
                  {videoJobs.map(job => (
                      <tr key={job.id}>
                          <td>{job.id}</td>
                          <td>{job.student || 'All Students'}</td>
                          <td>{job.createdAt?.toDate().toLocaleString()}</td>
                          <td>{job.status}</td>
                      </tr>
                  ))}
              </tbody>
          </table>
      </div>
    </div>
  );
};

export default PlaybackView;