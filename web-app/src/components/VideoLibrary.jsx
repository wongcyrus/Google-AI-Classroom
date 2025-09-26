import { useState, useEffect } from 'react';
import { useParams, useOutletContext } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit, startAfter, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

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

const VideoLibrary = () => {
  const { classId } = useParams();
  const { user } = useOutletContext();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState(new Map());
  const [isZipping, setIsZipping] = useState(false);
  const [filterField, setFilterField] = useState('createdAt');

  const {
    lessons,
    selectedLesson,
    startTime,
    endTime,
    setStartTime,
    setEndTime,
    handleLessonChange,
  } = useClassSchedule(classId);

  const [lastVisible, setLastVisible] = useState(null);
  const [isLastPage, setIsLastPage] = useState(true);

  const handleSearch = () => {
    if (!startTime || !endTime) {
      alert('Please select a start and end time.');
      return;
    }
    fetchPage(null); // Fetch first page
  };

  const handleNext = () => {
    if (!isLastPage) {
      fetchPage(lastVisible);
    }
  };

  const fetchPage = async (cursor) => {
    setLoading(true);
    try {
      const videoJobsRef = collection(db, 'videoJobs');
      const queryConstraints = [
        where('status', '==', 'completed'),
        where('classId', '==', classId),
        where(filterField, '>=', new Date(startTime)),
        where(filterField, '<=', new Date(endTime)),
        orderBy(filterField, 'desc'),
        limit(PAGE_SIZE)
      ];

      if (cursor) {
        queryConstraints.push(startAfter(cursor));
      }

      const q = query(videoJobsRef, ...queryConstraints);
      const querySnapshot = await getDocs(q);
      const videoList = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setVideos(videoList);

      if (querySnapshot.docs.length < PAGE_SIZE) {
        setIsLastPage(true);
      } else {
        setIsLastPage(false);
      }

      const newLastVisible = querySnapshot.docs[querySnapshot.docs.length - 1];
      setLastVisible(newLastVisible);

    } catch (error) {
      console.error("Error fetching videos:", error);
      alert("Failed to fetch videos. It's possible the database index is still building.");
    }
    setLoading(false);
  };

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
        student: v.student,
        startTime: v.startTime
    }));

    try {
        const jobCollectionRef = collection(db, 'zipJobs');
        const newDocRef = doc(jobCollectionRef);
        
        await setDoc(newDocRef, {
            jobId: newDocRef.id,
            classId: classId,
            requester: user.email,
            videos: videosToZip,
            status: 'pending',
            createdAt: serverTimestamp(),
        });

        alert(`Your ZIP request for ${videosToZip.length} videos has been submitted. You can find the download in the Data Management view once it is ready.`);
        setSelectedVideos(new Map());

    } catch (error) {
        console.error('Error creating zip job:', error);
        alert(`Error submitting ZIP request: ${error.message}`);
    }

    setIsZipping(false);
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
      const safeEmail = video.student.replace(/[@.]/g, '_');
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

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Video Library</h2>
      </div>
      <div className="actions-container">
        <DateRangeFilter 
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          onSearch={handleSearch}
          loading={loading || isZipping}
          lessons={lessons}
          selectedLesson={selectedLesson}
          onLessonChange={handleLessonChange}
        />
        <select value={filterField} onChange={(e) => setFilterField(e.target.value)}>
          <option value="createdAt">Filter by Creation Time</option>
          <option value="startTime">Filter by Start Time</option>
        </select>
        <button onClick={handleDownloadSelected} disabled={selectedVideos.size === 0 || isZipping}>
          {isZipping ? 'Submitting Job...' : `Request ${selectedVideos.size} Selected as ZIP`}
        </button>
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
                  <td>{video.student}</td>
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
      <div className="pagination-controls">
        <button disabled>Previous</button> {/* Previous not implemented */}
        <button onClick={handleNext} disabled={isLastPage || loading}>
          Next
        </button>
      </div>
    </div>
  );
};

export default VideoLibrary;