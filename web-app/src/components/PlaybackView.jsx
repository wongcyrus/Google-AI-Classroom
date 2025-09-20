import { useState, useEffect, useRef } from 'react';
import { doc, getDoc, collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase-config';
import './PlaybackView.css';

const PlaybackView = ({ classId }) => {
  console.log('PlaybackView rendered for class:', classId);
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState('');
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 2);
    return d;
  });
  const [endTime, setEndTime] = useState(new Date());
  
  const [sessionData, setSessionData] = useState(null);
  const [screenshots, setScreenshots] = useState([]);
  const [loading, setLoading] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // images per second

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
      console.log('Starting to fetch screenshots with session data:', sessionData);
      setLoading(true);
      setScreenshots([]);
      setCurrentIndex(0);

      try {
        const screenshotsRef = collection(db, 'screenshots');
        const q = query(
          screenshotsRef,
          where("classId", "==", classId),
          where("email", "==", sessionData.student),
          where("timestamp", ">=", sessionData.start),
          where("timestamp", "<=", sessionData.end),
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

        console.log('Generating download URLs for all screenshots...');
        const urls = await Promise.all(
          screenshotDocs.map(doc => getDownloadURL(ref(storage, doc.imagePath)))
        );
        console.log('Successfully generated all download URLs.');

        const populatedScreenshots = screenshotDocs.map((doc, i) => ({
          ...doc,
          url: urls[i],
        }));

        setScreenshots(populatedScreenshots);
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
    setSessionData({ student: selectedStudent.trim().toLowerCase(), start: startTime, end: endTime });
  };

  const currentTimestamp = screenshots[currentIndex]?.timestamp.toDate().toLocaleString();

  if (sessionData) {
    return (
        <div className="playback-player">
            <h3>Playback for: {sessionData.student}</h3>
            <button onClick={() => setSessionData(null)}>Back to Selection</button>
            <div className="player-main">
                {loading ? (
                    <p>Loading session...</p>
                ) : screenshots.length > 0 ? (
                    <img src={screenshots[currentIndex]?.url} alt={`Screenshot for ${sessionData.student}`} />
                ) : (
                    <p>No screenshots found for the selected student and time range.</p>
                )}
            </div>
            <div className="player-info">
                <span>{currentTimestamp || 'N/A'}</span>
                <span>Frame: {currentIndex + 1} / {screenshots.length}</span>
            </div>
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
                <input
                    type="range"
                    min="0"
                    max={screenshots.length > 0 ? screenshots.length - 1 : 0}
                    value={currentIndex}
                    onChange={e => setCurrentIndex(Number(e.target.value))}
                    className="timeline-slider"
                    disabled={screenshots.length === 0}
                />
                <label>Speed: </label>
                <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))}>
                    <option value="0.5">0.5x</option>
                    <option value="1">1x</option>
                    <option value="2">2x</option>
                    <option value="4">4x</option>
                </select>
            </div>
        </div>
    )
  }

  return (
    <div className="playback-selection">
      <h2>Session Playback</h2>
      <p>Select a student and a time range to begin.</p>
      <div className="filters">
        <label htmlFor="student-select">Student: </label>
        <select id="student-select" value={selectedStudent} onChange={e => setSelectedStudent(e.target.value)}>
            <option value="" disabled>Select a student</option>
            {students.map(email => (
                <option key={email} value={email}>{email}</option>
            ))}
        </select>

        <label htmlFor="start-time" style={{ marginLeft: '20px' }}>From: </label>
        <input
            type="datetime-local"
            id="start-time"
            value={(() => {
                const d = new Date(startTime);
                const year = d.getFullYear();
                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                const day = d.getDate().toString().padStart(2, '0');
                const hours = d.getHours().toString().padStart(2, '0');
                const minutes = d.getMinutes().toString().padStart(2, '0');
                return `${year}-${month}-${day}T${hours}:${minutes}`;
            })()}
            onChange={e => setStartTime(new Date(e.target.value))}
        />

        <label htmlFor="end-time" style={{ marginLeft: '10px' }}>To: </label>
        <input
            type="datetime-local"
            id="end-time"
            value={(() => {
                const d = new Date(endTime);
                const year = d.getFullYear();
                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                const day = d.getDate().toString().padStart(2, '0');
                const hours = d.getHours().toString().padStart(2, '0');
                const minutes = d.getMinutes().toString().padStart(2, '0');
                return `${year}-${month}-${day}T${hours}:${minutes}`;
            })()}
            onChange={e => setEndTime(new Date(e.target.value))}
        />

        <button onClick={handleStartPlayback} style={{ marginLeft: '20px' }}>Load Session</button>
      </div>
    </div>
  );
};

export default PlaybackView;