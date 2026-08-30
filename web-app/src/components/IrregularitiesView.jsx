import React, { useState, useEffect, useMemo } from 'react';
import { storage, auth } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';
import IncidentDossierExportModal from './IncidentDossierExportModal';
import AudioTranscriptModal from './AudioTranscriptModal';

const DualMediaPlayer = ({ data, onClose, onOpenTranscriptModal }) => {
  if (!data) return null;
  const { screenUrl, webcamUrl, videoUrl, audioUrl, transcriptSnippet, transcriptSegments, singleUrl, title, message, studentEmail, timestamp } = data;

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

        {transcriptSnippet && (
          <div style={{ background: '#f1f5f9', padding: '10px 14px', borderRadius: '6px', marginBottom: '12px', borderLeft: '4px solid #ef4444', fontSize: '0.9rem', fontStyle: 'italic', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <strong>💬 Transcript Evidence:</strong> "{transcriptSnippet}"
            </div>
            {onOpenTranscriptModal && (
              <button
                type="button"
                onClick={onOpenTranscriptModal}
                style={{ background: '#2563eb', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: '4px', fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}
              >
                🎙️ Diarization Timeline & Seek
              </button>
            )}
          </div>
        )}

        {audioUrl && (
          <div style={{ marginBottom: '12px', background: '#f8fafc', padding: '10px 12px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>
                🔊 Incident Audio Recording:
              </label>
              {onOpenTranscriptModal && !transcriptSnippet && (
                <button
                  type="button"
                  onClick={onOpenTranscriptModal}
                  style={{ background: '#0284c7', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: '4px', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  🎙️ Open Transcript Player
                </button>
              )}
            </div>
            <audio controls src={audioUrl} style={{ width: '100%' }}>
              Your browser does not support audio playback.
            </audio>
          </div>
        )}

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
          (screenUrl || webcamUrl || singleUrl) && (
            <img src={screenUrl || webcamUrl || singleUrl} alt="Incident Evidence" style={{ maxWidth: '100%', maxHeight: '70vh' }} />
          )
        )}
      </div>
    </div>
  );
};

const IrregularitiesView = ({ startTime, endTime }) => {
  const { classId } = useParams();
  const [mediaUrls, setMediaUrls] = useState({});
  const [selectedEvidence, setSelectedEvidence] = useState(null);
  const [activeAudioModalData, setActiveAudioModalData] = useState(null);

  // Period / Session Filter State
  const [periodPreset, setPeriodPreset] = useState(startTime ? 'custom' : 'all'); // 'all' | 'today' | '24h' | '7d' | 'custom'
  const [customStart, setCustomStart] = useState(startTime ? new Date(startTime).toISOString().slice(0, 16) : '');
  const [customEnd, setCustomEnd] = useState(endTime ? new Date(endTime).toISOString().slice(0, 16) : '');
  const [appliedCustomStart, setAppliedCustomStart] = useState(startTime || null);
  const [appliedCustomEnd, setAppliedCustomEnd] = useState(endTime || null);

  const effectiveTimeRange = useMemo(() => {
    const now = new Date();
    if (periodPreset === 'today') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      return { start, end: now, label: 'Today (Since Midnight)' };
    }
    if (periodPreset === '24h') {
      const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return { start, end: now, label: 'Past 24 Hours' };
    }
    if (periodPreset === '7d') {
      const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return { start, end: now, label: 'Past 7 Days' };
    }
    if (periodPreset === 'custom') {
      const start = appliedCustomStart ? new Date(appliedCustomStart) : (startTime ? new Date(startTime) : null);
      const end = appliedCustomEnd ? new Date(appliedCustomEnd) : (endTime ? new Date(endTime) : null);
      const label = start && end 
        ? `${start.toLocaleDateString()} ${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - ${end.toLocaleDateString()} ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`
        : 'Custom Period Filter';
      return { start, end, label };
    }
    return {
      start: startTime ? new Date(startTime) : null,
      end: endTime ? new Date(endTime) : null,
      label: 'All Recorded Sessions',
    };
  }, [periodPreset, appliedCustomStart, appliedCustomEnd, startTime, endTime]);

  const { 
    data: irregularities, 
    loading, 
    page, 
    isLastPage, 
    fetchNextPage, 
    fetchPrevPage,
    refetch 
  } = usePaginatedQuery('irregularities', { 
    classId, 
    startTime: effectiveTimeRange.start, 
    endTime: effectiveTimeRange.end 
  });

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
          const audioUrl = await resolveUrl(item.audioPath || item.audioUrl);

          urls[item.id] = {
            screenUrl,
            webcamUrl,
            videoUrl,
            audioUrl,
            singleUrl: screenUrl || webcamUrl || videoUrl || audioUrl,
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
      id: item.id,
      studentUid: item.studentUid || item.uid,
      studentEmail: item.email || item.studentEmail || 'Unknown Student',
      screenUrl: media.screenUrl,
      webcamUrl: media.webcamUrl,
      videoUrl: media.videoUrl,
      audioUrl: media.audioUrl,
      transcriptSnippet: item.transcriptSnippet || item.transcript || '',
      transcriptSegments: item.transcriptSegments || [],
      riskLevel: item.riskLevel || 'medium',
      classification: item.classification || item.type || 'audio_irregularity',
      explanation: item.message || item.details || '',
      singleUrl: media.singleUrl,
      title: item.title || item.type || 'Incident',
      message: item.message || item.details || '',
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

  const [showExportModal, setShowExportModal] = useState(false);

  return (
    <div className="view-container">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
        <h2>🚨 Irregularities for Class: {classId}</h2>
        <div style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '6px 12px', borderRadius: '6px', fontSize: '0.88rem', color: '#334155', fontWeight: 600 }}>
          📊 Period: <span style={{ color: '#2563eb' }}>{effectiveTimeRange.label}</span>
        </div>
      </div>

      {/* Period & Session Filter Bar */}
      <div style={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '16px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px', marginBottom: periodPreset === 'custom' ? '12px' : '0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.88rem', fontWeight: 600, color: '#475569' }}>⏱️ Scope / Period:</span>
            {[
              { key: 'all', label: 'All Sessions' },
              { key: 'today', label: 'Today' },
              { key: '24h', label: 'Past 24h' },
              { key: '7d', label: 'Past 7 Days' },
              { key: 'custom', label: 'Custom Range...' },
            ].map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => setPeriodPreset(p.key)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  fontWeight: periodPreset === p.key ? 700 : 500,
                  background: periodPreset === p.key ? '#2563eb' : '#f8fafc',
                  color: periodPreset === p.key ? '#ffffff' : '#475569',
                  border: periodPreset === p.key ? '1px solid #2563eb' : '1px solid #cbd5e1',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="actions-container" style={{ display: 'flex', gap: '8px', margin: 0 }}>
            <button onClick={() => refetch && refetch()} style={{ background: '#0284c7', color: '#fff' }}>🔄 Refresh</button>
            <button onClick={() => setShowExportModal(true)} style={{ background: '#2563eb', color: '#fff', fontWeight: 'bold' }}>
              📄 Export Formal Dossier (.docx / .csv)
            </button>
            <button onClick={exportToCSV}>Quick CSV Page</button>
          </div>
        </div>

        {/* Custom Date Range Picker */}
        {periodPreset === 'custom' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', paddingTop: '10px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>From:</label>
              <input
                type="datetime-local"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#64748b' }}>To:</label>
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setAppliedCustomStart(customStart ? new Date(customStart) : null);
                setAppliedCustomEnd(customEnd ? new Date(customEnd) : null);
              }}
              style={{ background: '#10b981', color: '#fff', border: 'none', padding: '5px 14px', borderRadius: '4px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer' }}
            >
              Apply Filter
            </button>
            <button
              type="button"
              onClick={() => {
                setCustomStart('');
                setCustomEnd('');
                setAppliedCustomStart(null);
                setAppliedCustomEnd(null);
                setPeriodPreset('all');
              }}
              style={{ background: '#94a3b8', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', fontSize: '0.85rem', cursor: 'pointer' }}
            >
              Reset
            </button>
          </div>
        )}
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
                            ) : media.audioUrl && (!media.screenUrl && !media.webcamUrl) ? (
                              <div className="media-thumbnail" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fef2f2', border: '1px solid #fca5a5', padding: '6px' }} title="Click to listen to audio incident">
                                <span style={{ fontSize: '1.2rem' }}>🎙️</span>
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#dc2626', marginLeft: '4px' }}>Audio Clip</span>
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
      {selectedEvidence && (
        <DualMediaPlayer 
          data={selectedEvidence} 
          onClose={() => setSelectedEvidence(null)} 
          onOpenTranscriptModal={() => setActiveAudioModalData(selectedEvidence)}
        />
      )}

      {activeAudioModalData && (
        <AudioTranscriptModal
          isOpen={!!activeAudioModalData}
          onClose={() => setActiveAudioModalData(null)}
          studentUid={activeAudioModalData.studentUid}
          studentName={activeAudioModalData.studentEmail}
          audioUrl={activeAudioModalData.audioUrl}
          snapshotUrl={activeAudioModalData.webcamUrl || activeAudioModalData.screenUrl || activeAudioModalData.singleUrl}
          transcriptSegments={activeAudioModalData.transcriptSegments}
          transcriptSnippet={activeAudioModalData.transcriptSnippet}
          riskLevel={activeAudioModalData.riskLevel}
          classification={activeAudioModalData.classification}
          explanation={activeAudioModalData.explanation || activeAudioModalData.message}
        />
      )}

      <IncidentDossierExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        classId={classId}
        user={auth?.currentUser}
        currentSessionStartTime={effectiveTimeRange.start}
        currentSessionEndTime={effectiveTimeRange.end}
      />
    </div>
  );
};

export default IrregularitiesView;