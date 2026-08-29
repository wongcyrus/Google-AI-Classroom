import React, { useState, useEffect } from 'react';
import { storage } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';

const DualMediaPlayer = ({ data, onClose }) => {
  if (!data) return null;
  const { screenUrl, webcamUrl, videoUrl, singleUrl, title, message, studentEmail, timestamp } = data;

  return (
    <div className="media-player-modal" onClick={onClose}>
      <div className="media-player-content dual-evidence-modal" onClick={(e) => e.stopPropagation()}>
        <div className="dual-modal-header">
          <h3>🚨 Irregularity Evidence: {title || 'Incident Snapshot'}</h3>
          <span className="close" onClick={onClose}>&times;</span>
        </div>
        <p className="dual-modal-message">
          <strong>{studentEmail}</strong> &bull; {timestamp}
          {message ? ` — ${message}` : ''}
        </p>

        {screenUrl && webcamUrl ? (
          <div className="dual-evidence-grid">
            <div className="evidence-panel">
              <span className="evidence-label">🖥️ Screen Capture</span>
              <img src={screenUrl} alt="Screen Evidence" />
            </div>
            <div className="evidence-panel">
              <span className="evidence-label">📷 Webcam Capture</span>
              <img src={webcamUrl} alt="Webcam Evidence" />
            </div>
          </div>
        ) : videoUrl ? (
          <video controls autoPlay style={{ maxWidth: '100%', maxHeight: '70vh' }}>
            <source src={videoUrl} type="video/mp4" />
            Your browser does not support the video tag.
          </video>
        ) : (
          <img src={screenUrl || webcamUrl || singleUrl} alt="Incident Evidence" style={{ maxWidth: '100%', maxHeight: '70vh' }} />
        )}
      </div>
    </div>
  );
};

const IrregularitiesView = ({ startTime, endTime }) => {
  const { classId } = useParams();
  const [mediaUrls, setMediaUrls] = useState({});
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  const { 
    data: irregularities, 
    loading, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage,
    refetch 
  } = usePaginatedQuery('irregularities', { classId, startTime, endTime });

  useEffect(() => {
    const resolveUrl = async (pathOrUrl) => {
      if (!pathOrUrl) return null;
      if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) {
        return pathOrUrl;
      }
      try {
        const storageRef = ref(storage, pathOrUrl);
        return await getDownloadURL(storageRef);
      } catch (err) {
        console.debug("Could not resolve media url:", pathOrUrl, err);
        return null;
      }
    };

    const fetchMediaUrls = async () => {
      const urls = {};
      for (const item of irregularities) {
        if (!mediaUrls[item.id]) {
          const screenUrl = await resolveUrl(item.screenUrl || (!item.webcamUrl ? item.imageUrl : null));
          const webcamUrl = await resolveUrl(item.webcamUrl);
          const videoUrl = await resolveUrl(item.videoUrl);

          urls[item.id] = {
            screenUrl,
            webcamUrl,
            videoUrl,
            singleUrl: screenUrl || webcamUrl || videoUrl,
            hasDual: !!(screenUrl && webcamUrl)
          };
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

  const handleOpenEvidence = (item) => {
    const media = mediaUrls[item.id] || {};
    const itemTime = item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : (item.startedAt?.toDate ? item.startedAt.toDate().toLocaleString() : String(item.timestamp || item.startedAt || ''));
    setSelectedEvidence({
      screenUrl: media.screenUrl,
      webcamUrl: media.webcamUrl,
      videoUrl: media.videoUrl,
      singleUrl: media.singleUrl,
      title: item.title || item.type || 'Incident',
      message: item.message || item.details || '',
      studentEmail: item.email || item.studentEmail || 'Unknown Student',
      timestamp: itemTime,
    });
  };

  const exportToCSV = async () => {
    if (irregularities.length === 0) {
      alert("No data to export.");
      return;
    }

    const headers = ['Email', 'Title', 'Message', 'Screen Path', 'Webcam Path', 'Timestamp'];
    const rows = irregularities.map(item =>
      [
        item.email || item.studentEmail || '',
        item.title || item.type || 'Irregularity',
        item.message || item.details || '',
        item.screenUrl || item.imageUrl || '',
        item.webcamUrl || '',
        item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : (item.startedAt?.toDate ? item.startedAt.toDate().toLocaleString() : String(item.timestamp || item.startedAt || '')),
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
        <h2>🚨 Irregularities for Class: {classId}</h2>
      </div>
      <div className="actions-container" style={{ display: 'flex', gap: '10px' }}>
        <button onClick={() => refetch && refetch()} style={{ background: '#0284c7', color: '#fff' }}>🔄 Refresh</button>
        <button onClick={exportToCSV}>Export to CSV</button>
      </div>

      {loading ? <p>Loading irregularities...</p> : (
        <>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Timestamp</th>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Duration / Status</th>
                  <th>Evidence Snapshots</th>
                </tr>
              </thead>
              <tbody>
                {irregularities.map(item => {
                  const media = mediaUrls[item.id];
                  const timeFormatted = item.timestamp?.toDate 
                    ? item.timestamp.toDate().toLocaleString() 
                    : (item.startedAt?.toDate ? item.startedAt.toDate().toLocaleString() : String(item.timestamp || item.startedAt || ''));

                  return (
                    <tr key={item.id}>
                      <td>{item.email || item.studentEmail || 'Unknown'}</td>
                      <td>{timeFormatted}</td>
                      <td>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '4px',
                          fontSize: '0.85em',
                          fontWeight: 600,
                          background: item.type === 'non_fullscreen_screen_share_attempt' || item.type === 'no_face' || item.type === 'multiple_faces'
                            ? '#fee2e2' 
                            : item.type === 'looking_away' || item.type === 'gaze_deviation' 
                            ? '#fef3c7'
                            : '#f1f5f9',
                          color: item.type === 'non_fullscreen_screen_share_attempt' || item.type === 'no_face' || item.type === 'multiple_faces'
                            ? '#b91c1c' 
                            : item.type === 'looking_away' || item.type === 'gaze_deviation'
                            ? '#b45309'
                            : '#334155',
                        }}>
                          {item.title || item.type || 'Irregularity'}
                        </span>
                      </td>
                      <td>{item.message || item.details || ''}</td>
                      <td>
                        {item.durationSeconds ? (
                          <span style={{ fontSize: '0.85rem', color: '#10b981', fontWeight: 600 }}>
                            ✅ Resolved ({item.durationSeconds}s)
                          </span>
                        ) : item.status === 'active' ? (
                          <span style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 600 }}>
                            🔴 Active
                          </span>
                        ) : (
                          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                            {item.status || 'Logged'}
                          </span>
                        )}
                      </td>
                      <td>
                        {media && (
                          <div className="dual-thumbnail-container" onClick={() => handleOpenEvidence(item)}>
                            {media.hasDual ? (
                              <>
                                <div className="media-thumbnail" style={{ position: 'relative' }} title="Screen snapshot">
                                  <img src={media.screenUrl} alt="screen evidence" />
                                  <span className="thumbnail-badge">🖥️ Screen</span>
                                </div>
                                <div className="media-thumbnail" style={{ position: 'relative' }} title="Webcam snapshot">
                                  <img src={media.webcamUrl} alt="webcam evidence" />
                                  <span className="thumbnail-badge">📷 Webcam</span>
                                </div>
                              </>
                            ) : media.videoUrl ? (
                              <div className="media-thumbnail">
                                <div className="play-icon-container">
                                  <svg className="play-icon" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                  </svg>
                                </div>
                              </div>
                            ) : media.singleUrl ? (
                              <div className="media-thumbnail" title="Click to view evidence">
                                <img src={media.singleUrl} alt="evidence" />
                              </div>
                            ) : (
                              <span style={{ color: '#94a3b8', fontSize: '0.8rem' }}>No media</span>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
      {selectedEvidence && <DualMediaPlayer data={selectedEvidence} onClose={() => setSelectedEvidence(null)} />}
    </div>
  );
};

export default IrregularitiesView;