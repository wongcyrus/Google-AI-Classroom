import React, { useState, useEffect } from 'react';
import { storage } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';

const MediaPlayer = ({ url, type, onClose }) => {
  if (!url) return null;
  return (
    <div className="media-player-modal" onClick={onClose}>
      <div className="media-player-content" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>&times;</span>
        {type === 'image' ? (
          <img src={url} alt="Media" />
        ) : (
          <video controls autoPlay>
            <source src={url} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        )}
      </div>
    </div>
  );
};

const IrregularitiesView = ({ startTime, endTime }) => {
  const { classId } = useParams();
  const [mediaUrls, setMediaUrls] = useState({});
  const [showMediaPlayer, setShowMediaPlayer] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');

  const { 
    data: irregularities, 
    loading, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage 
  } = usePaginatedQuery('irregularities', { classId, startTime, endTime });

  useEffect(() => {
    const fetchMediaUrls = async () => {
      const urls = {};
      for (const item of irregularities) {
        const mediaPath = item.imageUrl || item.videoUrl;
        if (mediaPath && !mediaUrls[item.id]) { // Fetch only if not already fetched
          let type = 'image';
          if (mediaPath.includes('videos/') || mediaPath.endsWith('.mp4') || mediaPath.endsWith('.webm') || mediaPath.endsWith('.ogv')) {
            type = 'video';
          }
          try {
            const storageRef = ref(storage, mediaPath);
            const url = await getDownloadURL(storageRef);
            urls[item.id] = { url, type };
          } catch (error) {
            console.error("Error getting download URL:", error);
          }
        }
      }
      if (Object.keys(urls).length > 0) {
        setMediaUrls(prev => ({ ...prev, ...urls }));
      }
    };

    if (irregularities.length > 0) {
      fetchMediaUrls();
    }
  }, [irregularities, mediaUrls]);

  const openMediaPlayer = (url, type) => {
    setMediaUrl(url);
    setMediaType(type);
    setShowMediaPlayer(true);
  };

  const exportToCSV = async () => {
    if (irregularities.length === 0) {
      alert("No data to export.");
      return;
    }

    // Note: This only exports the current page. A full export would require a separate function.
    const headers = ['Email', 'Title', 'Message', 'Media Path', 'Timestamp'];
    const rows = irregularities.map(item =>
      [
        item.email,
        item.title,
        item.message,
        item.imageUrl || item.videoUrl,
        item.timestamp.toDate().toLocaleString(),
      ]
        .map(value => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'irregularities_page_' + page + '.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <h2>Irregularities for Class: {classId}</h2>
      </div>
      <div className="actions-container">
        <button onClick={exportToCSV}>Export to CSV</button>
      </div>

      {loading ? <p>Loading...</p> : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Media</th>
                </tr>
              </thead>
              <tbody>
                {irregularities.map(item => (
                  <tr key={item.id}>
                    <td>{item.email}</td>
                    <td>{item.timestamp.toDate().toLocaleString()}</td>
                    <td>{item.title}</td>
                    <td>{item.message}</td>
                    <td>
                      {mediaUrls[item.id] && (
                        <div
                          className="media-thumbnail"
                          onClick={() => openMediaPlayer(mediaUrls[item.id].url, mediaUrls[item.id].type)}
                        >
                          {mediaUrls[item.id].type === 'image' ? (
                            <img src={mediaUrls[item.id].url} alt="irregularity" />
                          ) : (
                            <div className="play-icon-container">
                              <svg className="play-icon" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                              </svg>
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-controls">
            <button onClick={fetchPrevPage} disabled={page <= 1}>Previous</button>
            <span>Page {page}</span>
            <button onClick={fetchNextPage} disabled={isLastPage}>Next</button>
          </div>
        </>
      )}
      {showMediaPlayer && <MediaPlayer url={mediaUrl} type={mediaType} onClose={() => setShowMediaPlayer(false)} />}
    </div>
  );
};

export default IrregularitiesView;