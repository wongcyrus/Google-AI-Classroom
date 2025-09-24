import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';

const PAGE_SIZE = 10;

const VideoLibrary = () => {
  const { classId } = useParams();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [isZipping, setIsZipping] = useState(false);
  
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0); // Start of today
    return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
  });

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
        where('createdAt', '>=', new Date(startTime)),
        where('createdAt', '<=', new Date(endTime)),
        orderBy('createdAt', 'desc'),
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

  const handleSelectVideo = (videoId) => {
    setSelectedVideos(prev => {
      const newSelection = new Set(prev);
      if (newSelection.has(videoId)) {
        newSelection.delete(videoId);
      } else {
        newSelection.add(videoId);
      }
      return newSelection;
    });
  };

  const handleDownloadSelected = async () => {
    if (selectedVideos.size === 0) return;

    setIsZipping(true);
    try {
      const selectedVideoObjects = videos.filter(v => selectedVideos.has(v.id));
      const videoPaths = selectedVideoObjects.map(v => v.videoPath).filter(Boolean);

      if (videoPaths.length !== selectedVideos.size) {
        alert('Some selected videos are missing a storage path and cannot be zipped.');
        setIsZipping(false);
        return;
      }

      const region = 'us-central1'; // Or your function's region
      const projectId = import.meta.env.VITE_PROJECT_ID;
      const url = `https://${region}-${projectId}.cloudfunctions.net/zipVideos`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoPaths }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Failed to create zip file: ${errorData}`);
      }

      const result = await response.json();
      window.location.href = result.zipUrl;

    } catch (error) {
      console.error('Error creating zip file:', error);
      alert(`Error: ${error.message}`);
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

      // Fetch the video as a blob. This is important to bypass potential
      // cross-origin issues with the download attribute.
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Network response was not ok, status: ${response.status}.`);
      }
      const blob = await response.blob();

      // Create a temporary link to trigger the download
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;

      // Create a meaningful filename from class, email, and time
      const formattedStartTime = video.startTime.toDate().toISOString()
        .replace(/:/g, '-') // Replace colons
        .replace(/\..+/, '') // Remove milliseconds
        .replace('T', '_'); // Replace T with underscore
      const safeEmail = video.student.replace(/[@.]/g, '_');
      const filename = `${video.classId}_${safeEmail}_${formattedStartTime}.mp4`;

      a.download = filename;
      document.body.appendChild(a);
      a.click();

      // Clean up
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
        />
        <button onClick={handleDownloadSelected} disabled={selectedVideos.size === 0 || isZipping}>
          {isZipping ? 'Zipping...' : `Download ${selectedVideos.size} Selected as ZIP`}
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
                  const newSelection = new Set();
                  if (e.target.checked) {
                    videos.forEach(v => newSelection.add(v.id));
                  }
                  setSelectedVideos(newSelection);
                }} /></th>
                <th>Student</th>
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
                      onChange={() => handleSelectVideo(video.id)}
                    />
                  </td>
                  <td>{video.student}</td>
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