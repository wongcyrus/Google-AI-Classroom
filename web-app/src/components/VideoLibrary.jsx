import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, getDocs, limit, startAfter } from 'firebase/firestore';
import { db } from '../firebase-config';
import './VideoLibrary.css';

const PAGE_SIZE = 10;

const VideoLibrary = () => {
  const { classId } = useParams();
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState(new Set());
  const [isZipping, setIsZipping] = useState(false);
  
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1); // 24 hours ago
    return d.toISOString().substring(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    return new Date().toISOString().substring(0, 16);
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
    console.log('Querying for videos with:', { 
      classId, 
      status: 'completed', 
      startTime: new Date(startTime), 
      endTime: new Date(endTime) 
    });
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
        alert('Some selected videos are missing a storage path and cannot be zipped. These may be older videos created before this feature was added.');
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
      // Trigger download
      window.location.href = result.zipUrl;

    } catch (error) {
      console.error('Error creating zip file:', error);
      alert(`Error: ${error.message}`);
    }
    setIsZipping(false);
  };

  return (
    <div className="video-library">
      <div className="video-library-filters">
        <label>From: <input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
        <label>To: <input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} /></label>
        <button onClick={handleSearch} disabled={loading || isZipping}>Search</button>
      </div>

      <div className="video-library-controls">
        <button onClick={handleDownloadSelected} disabled={selectedVideos.size === 0 || isZipping}>
          {isZipping ? 'Zipping...' : `Download ${selectedVideos.size} Selected as ZIP`}
        </button>
      </div>

      {loading ? (
        <p>Loading videos...</p>
      ) : videos.length === 0 ? (
        <p>No videos found for the selected criteria. Please try a different time range or click Search.</p>
      ) : (
        <table className="videos-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" disabled />
              </th>
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
                  <a href={video.videoUrl} target="_blank" rel="noopener noreferrer" download>
                    Download
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
