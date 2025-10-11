import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db, storage } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { collection, query, where, orderBy, limit, getDocs, startAfter, endBefore, limitToLast } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

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
  const [irregularities, setIrregularities] = useState([]);
  const [mediaUrls, setMediaUrls] = useState({});

  const lastDocRef = useRef(null);
  const firstDocRef = useRef(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [isLastPage, setIsLastPage] = useState(false);

  const [showMediaPlayer, setShowMediaPlayer] = useState(false);
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState('');

  const openMediaPlayer = (url, type) => {
    setMediaUrl(url);
    setMediaType(type);
    setShowMediaPlayer(true);
  };

  const PAGE_SIZE = 10;

  const fetchIrregularities = useCallback(async (direction = 'first', newPage = 1) => {
    if (!classId) return;
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    q = query(q, where('classId', '==', classId));
    if (startTime) q = query(q, where('timestamp', '>=', new Date(startTime)));
    if (endTime) q = query(q, where('timestamp', '<=', new Date(endTime)));

    if (direction === 'first') {
      setIsLastPage(false);
    }

    switch (direction) {
      case 'next':
        q = query(q, startAfter(lastDocRef.current), limit(PAGE_SIZE));
        break;
      case 'prev':
        q = query(q, endBefore(firstDocRef.current), limitToLast(PAGE_SIZE));
        break;
      default: // first
        q = query(q, limit(PAGE_SIZE));
        break;
    }

    try {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        setPage(newPage);
        setIsLastPage(snapshot.docs.length < PAGE_SIZE);
        const irregularitiesData = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
        if (direction === 'prev') {
          irregularitiesData.reverse();
        }
        setIrregularities(irregularitiesData);
        firstDocRef.current = snapshot.docs[0];
        lastDocRef.current = snapshot.docs[snapshot.docs.length - 1];

        const urls = {};
        for (const item of irregularitiesData) {
          const mediaPath = item.imageUrl || item.videoUrl;
          let mediaType = 'image';
          if (mediaPath) {
            if (mediaPath.includes('videos/') || mediaPath.endsWith('.mp4') || mediaPath.endsWith('.webm') || mediaPath.endsWith('.ogv')) {
              mediaType = 'video';
            }
            try {
              const storageRef = ref(storage, mediaPath);
              const url = await getDownloadURL(storageRef);
              urls[item.id] = { url, type: mediaType };
            } catch (error) {
              console.error("Error getting download URL:", error);
            }
          }
        }
        setMediaUrls(prev => ({ ...prev, ...urls }));
      } else {
        setIrregularities([]);
        if (direction === 'next') setIsLastPage(true);
        if (direction === 'first') setPage(1);
      }
    } catch (error) {
      console.error("Error fetching irregularities:", error);
    }
    setLoading(false);
  }, [classId, startTime, endTime]);

  useEffect(() => {
    if (startTime && endTime) {
      fetchIrregularities('first', 1);
    }
  }, [startTime, endTime, fetchIrregularities]);

  const handleNext = () => {
    if (!isLastPage) {
      fetchIrregularities('next', page + 1);
    }
  };

  const handlePrev = () => {
    if (page > 1) {
      fetchIrregularities('prev', page - 1);
    }
  };

  const fetchAllIrregularities = async () => {
    if (!classId) return [];
    setLoading(true);
    const irregularitiesCollectionRef = collection(db, 'irregularities');
    let q = query(irregularitiesCollectionRef, orderBy('timestamp', 'desc'));

    q = query(q, where('classId', '==', classId));
    if (startTime) q = query(q, where('timestamp', '>=', new Date(startTime)));
    if (endTime) q = query(q, where('timestamp', '<=', new Date(endTime)));

    try {
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        return snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id }));
      }
      return [];
    } catch (error) {
      console.error("Error fetching all irregularities:", error);
      return [];
    } finally {
      setLoading(false);
    }
  };

  const exportToCSV = async () => {
    const allIrregularities = await fetchAllIrregularities();
    if (allIrregularities.length === 0) {
      alert("No data to export.");
      return;
    }

    const headers = ['Email', 'Title', 'Message', 'Media Path', 'Timestamp'];
    const rows = allIrregularities.map(item =>
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
    link.setAttribute('download', 'irregularities.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="container">
      <h2 className="header">Irregularities for Class: {classId}</h2>
      <div className="controls">
        <button onClick={exportToCSV} className="button">Export to CSV</button>
      </div>

      {loading ? <p>Loading...</p> : (
        <>
          <table className="table">
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
          <div className="pagination">
            <button onClick={handlePrev} disabled={page <= 1} className="button">Previous</button>
            <span>Page {page}</span>
            <button onClick={handleNext} disabled={isLastPage} className="button">Next</button>
          </div>
        </>
      )}
      {showMediaPlayer && <MediaPlayer url={mediaUrl} type={mediaType} onClose={() => setShowMediaPlayer(false)} />}
    </div>
  );
};

export default IrregularitiesView;