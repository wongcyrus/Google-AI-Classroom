import { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit, startAfter, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';
import Modal from './Modal';
import VideoPromptSelector from './VideoPromptSelector';

import usePaginatedQuery from '../hooks/useCollectionQuery';

const PAGE_SIZE = 10;

const formatDuration = (seconds) => {
  if (!seconds) return 'N/A';
  return new Date(seconds * 1000).toISOString().substr(11, 8);
};

const formatSize = (bytes) => {
  if (!bytes) return 'N/A';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const VideoLibrary = ({ user, classId, startTime, endTime, lessons, selectedLesson, handleLessonChange }) => {
  const [selectedVideos, setSelectedVideos] = useState(new Map());
  const [isZipping, setIsZipping] = useState(false);
  const [isRequestingAnalysis, setIsRequestingAnalysis] = useState(false);
  const [filterField, setFilterField] = useState('startTime');
  const [showPlayer, setShowPlayer] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [playerLoading, setPlayerLoading] = useState(false);
  const [showPromptModal, setShowPromptModal] = useState(false);
  const [selectedPrompt, setSelectedPrompt] = useState(null);
  const [editablePromptText, setEditablePromptText] = useState('');

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
    extraClauses: [{ field: 'status', op: '==', value: 'completed' }]
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

  const handleDownloadSelected = async () => {
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

  const handleDownloadAll = async () => {
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
          status: 'pending',
          createdAt: serverTimestamp(),
          startTime: new Date(startTime),
          endTime: new Date(endTime),
          deleted: false,
      });

      alert(`Your analysis request for ${videos.length} videos has been submitted. You can find the results in the Data Management view once it is ready.`);
      setSelectedVideos(new Map());

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
          status: 'pending',
          createdAt: serverTimestamp(),
          deleted: false,
      });

      alert(`Your analysis request for all videos in the selected range has been submitted. You can find the results in the Data Management view once it is ready.`);

    } catch (error) {
      console.error('Error creating analysis job for all videos:', error);
      alert(`Error submitting analysis request: ${error.message}`);
    } finally {
      setIsRequestingAnalysis(false);
    }
  };

  const handleDownload = async (video) => {
    console.log("Attempting to download:", video);
    if (!video.videoPath) {
      alert("This video does not have a storage path.");
      return;
    }
    try {
      const storage = getStorage();
      const videoRef = ref(storage, video.videoPath);
      const downloadUrl = await getDownloadURL(videoRef);

      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}.`);
      }
      const blob = await response.blob();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;

      const formattedStartTime = video.startTime.toDate().toISOString()
        .replace(/:/g, '-')
        .replace(/\..+/, '')
        .replace('T', '_');
      const safeEmail = video.studentEmail.replace(/[@.]/g, '_');
      const filename = `${video.classId}_${safeEmail}_${formattedStartTime}.mp4`;

      a.download = filename;
      document.body.appendChild(a);
      a.click();

      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading video:', error);
      alert(`Failed to download video. ${error.message}`);
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
      </Modal>

      <div className="view-header">
        <h2>Video Library</h2>
      </div>
      


      <>
        <div className="other-controls-column" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '20px' }}>
          <select value={filterField} onChange={(e) => setFilterField(e.target.value)}>
            <option value="createdAt">Filter by Creation Time</option>
            <option value="startTime">Filter by Start Time</option>
          </select>
          <button onClick={handleDownloadSelected} disabled={selectedVideos.size === 0 || isZipping}>
            {isZipping ? 'Submitting...' : `Request ${selectedVideos.size} Selected as ZIP`}
          </button>
          <button onClick={handleDownloadAll} disabled={isZipping}>
            {isZipping ? 'Submitting...' : 'Request All as ZIP'}
          </button>
          <button onClick={() => setShowPromptModal(true)}>Select Video Prompt</button>
          {editablePromptText.trim() && (
            <>
              <button onClick={handleRequestAnalysis} disabled={selectedVideos.size === 0 || isRequestingAnalysis}>
                {isRequestingAnalysis ? 'Requesting...' : 'Request Analysis'}
              </button>
              <button onClick={handleRequestAllAnalysis} disabled={isRequestingAnalysis}>
                {isRequestingAnalysis ? 'Requesting...' : 'Request All Analysis'}
              </button>
            </>
          )}
        </div>

        {loading ? (
          <p>Loading videos...</p>
        ) : videos.length === 0 ? (
          <p>No videos found for the selected criteria.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th><input type="checkbox" onChange={(e) => {
                    const newSelection = new Map();
                    if (e.target.checked) {
                      videos.forEach(v => newSelection.set(v.id, v));
                    }
                    setSelectedVideos(newSelection);
                  }} /></th>
                  <th>Play</th>
                  <th>Student</th>
                  <th>Start Time</th>
                  <th>End Time</th>
                  <th>Duration</th>
                  <th>Size</th>
                  <th>Created At</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {videos.map(video => (
                  <tr key={video.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedVideos.has(video.id)}
                        onChange={() => handleSelectVideo(video)}
                      />
                    </td>
                    <td>
                      <button onClick={() => handlePlayVideo(video)} style={{background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.5rem', padding: 0, lineHeight: 1}}>
                        ▶️
                      </button>
                    </td>
                    <td>{video.studentEmail}</td>
                    <td>{video.startTime?.toDate().toLocaleString() || 'N/A'}</td>
                    <td>{video.endTime?.toDate().toLocaleString() || 'N/A'}</td>
                    <td>{formatDuration(video.duration)}</td>
                    <td>{formatSize(video.size)}</td>
                    <td>{video.createdAt?.toDate().toLocaleString() || 'N/A'}</td>
                    <td>
                      {video.videoPath ? (
                        <button onClick={() => handleDownload(video)}>
                          Download
                        </button>
                      ) : (
                        <span>Path Not Found</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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