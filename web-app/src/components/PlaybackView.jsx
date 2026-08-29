
import { useState, useEffect, useRef, useMemo } from 'react';
import { doc, getDoc, collection, query, where, orderBy, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase-config';
import './SharedViews.css';
import TimelineSlider from './TimelineSlider';

const PlaybackView = ({ sessionData, onBack, classId, startTime, endTime }) => {
  const [screenshots, setScreenshots] = useState([]);
  const [channelFilter, setChannelFilter] = useState('all'); // 'all' | 'screen' | 'webcam'
  const [loading, setLoading] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [notification, setNotification] = useState(null);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1); // images per second
  const [screenshotImageUrls, setScreenshotImageUrls] = useState({});
  const [isFetchingUrls, setIsFetchingUrls] = useState(false);
  const urlsFetched = useRef(new Set());

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
        channel: channelFilter,
        startTime: new Date(sessionData.start),
        endTime: new Date(sessionData.end),
        status: 'pending',
        createdAt: serverTimestamp(),
        expireAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      setActiveJobId(jobId);
      setNotification({ type: 'info', message: `Video job created (ID: ${jobId}). Waiting for processing to start...` });

    } catch (error) {
      console.error('Error creating video job:', error);
      setNotification({ type: 'error', message: `Error: ${error.message}` });
    }
  };

  const displayedScreenshots = useMemo(() => {
    if (channelFilter === 'all') return screenshots;
    return screenshots.filter(s => (s.channel || 'screen') === channelFilter);
  }, [screenshots, channelFilter]);

  const currentScreenshot = displayedScreenshots[currentIndex];
  const currentTimestamp = currentScreenshot?.timestamp?.toDate ? currentScreenshot.timestamp.toDate().toLocaleString() : '';
  const currentImageUrl = currentScreenshot?.imagePath ? screenshotImageUrls[currentScreenshot.imagePath] : null;

  const bufferedRanges = useMemo(() => {
    if (displayedScreenshots.length === 0) return [];

    const ranges = [];
    let inRange = false;
    let start = 0;

    for (let i = 0; i < displayedScreenshots.length; i++) {
      const screenshot = displayedScreenshots[i];
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
      ranges.push({ start, end: displayedScreenshots.length - 1 });
    }

    return ranges;
  }, [displayedScreenshots, screenshotImageUrls]);

  return (
    <div className="view-container playback-player">
        <div className="view-header">
          <h3>Playback for: {sessionData.studentEmail}</h3>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px', flexWrap: 'wrap' }}>
          <button onClick={onBack}>Back to Selection</button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Channel:</label>
            <select 
              value={channelFilter} 
              onChange={(e) => {
                setChannelFilter(e.target.value);
                setCurrentIndex(0);
              }}
              style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
            >
              <option value="all">All Channels</option>
              <option value="screen">🖥️ Screen Only</option>
              <option value="webcam">📷 Webcam Only</option>
            </select>
          </div>
          <button onClick={handleCombineToVideo} disabled={activeJobId || displayedScreenshots.length === 0}>
            {activeJobId ? 'Processing...' : `Combine to Video (${channelFilter.toUpperCase()})`}
          </button>
        </div>
        
        {notification && (
          <div className={`notification notification-${notification.type}`}>
            <p>{notification.message}</p>
            {notification.type === 'success' && notification.url && (
              <a href={notification.url} target="_blank" rel="noopener noreferrer">Download Video</a>
            )}
          </div>
        )}

        <div className="player-controls">
            <button onClick={() => setCurrentIndex(0)} disabled={displayedScreenshots.length === 0}>First</button>
            <button onClick={() => setCurrentIndex(prev => Math.max(0, prev - 1))} disabled={displayedScreenshots.length === 0}>Prev</button>
            <button className="play-pause" onClick={() => setIsPlaying(!isPlaying)} disabled={displayedScreenshots.length === 0}>
                {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button onClick={() => setCurrentIndex(prev => Math.min(displayedScreenshots.length - 1, prev + 1))} disabled={displayedScreenshots.length === 0}>Next</button>
            <button onClick={() => setCurrentIndex(displayedScreenshots.length - 1)} disabled={displayedScreenshots.length === 0}>Last</button>
        </div>
        <div className="timeline-controls">
            <TimelineSlider
                min={0}
                max={displayedScreenshots.length > 0 ? displayedScreenshots.length - 1 : 0}
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
        <div className="player-main" style={{ position: 'relative' }}>
            {currentScreenshot?.channel && (
              <div style={{
                position: 'absolute',
                top: 10,
                left: 10,
                background: 'rgba(15, 23, 42, 0.75)',
                color: '#fff',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                zIndex: 5
              }}>
                {currentScreenshot.channel === 'screen' ? '🖥️ Screen' : '📷 Webcam'}
              </div>
            )}
            {loading ? (
                <p>Loading session...</p>
            ) : displayedScreenshots.length > 0 ? (
                <img src={currentImageUrl} alt={`Screenshot for ${sessionData.studentEmail}`} />
            ) : (
                <p>No screenshots found for the selected channel and time range.</p>
            )}
        </div>
        <div className="player-info">
            <span>{currentTimestamp || 'N/A'}</span>
            <span>Frame: {displayedScreenshots.length > 0 ? currentIndex + 1 : 0} / {displayedScreenshots.length}</span>
        </div>
    </div>
  );
};

export default PlaybackView;
