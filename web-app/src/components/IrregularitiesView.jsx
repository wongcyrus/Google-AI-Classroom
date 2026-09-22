import React, { useState, useEffect, useMemo } from 'react';
import { db, storage, auth } from '../firebase-config';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';
import IncidentDossierExportModal from './IncidentDossierExportModal';
import AudioTranscriptModal from './AudioTranscriptModal';
import StudentBadge from './common/StudentBadge';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';
import { exportToExcel } from '../utils/exportUtils';

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
  const [studentProfiles, setStudentProfiles] = useState({});

  useEffect(() => {
    if (!classId || !db) return;
    const fetchClassProfiles = async () => {
      try {
        const snap = await getDoc(doc(db, 'classes', classId));
        if (snap && snap.exists && snap.exists()) {
          setStudentProfiles(snap.data().studentProfiles || {});
        }
      } catch (err) {
        console.debug('Could not load class studentProfiles:', err);
      }
    };
    fetchClassProfiles();
  }, [classId]);

  const effectiveTimeRange = useMemo(() => {
    const start = startTime ? new Date(startTime) : null;
    const end = endTime ? new Date(endTime) : null;
    if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
      const label = `${start.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} (${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
      return { start, end, label };
    }
    if (start && !isNaN(start.getTime())) {
      const label = `From: ${start.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      return { start, end: null, label };
    }
    return {
      start: null,
      end: null,
      label: 'All Recorded Sessions',
    };
  }, [startTime, endTime]);

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

  const exportToExcelPage = async () => {
    if (irregularities.length === 0) {
      alert("No data to export.");
      return;
    }

    const headers = ['Student Name', 'Email', 'Cohort', 'Programme', 'Title', 'Message', 'Screen Path', 'Webcam Path', 'Timestamp'];
    const rows = irregularities.map(item => {
      const email = item.email || item.studentEmail || '';
      const prof = getStudentProfile(email, studentProfiles);
      const displayName = getStudentDisplayName(email, studentProfiles);
      return [
        displayName,
        email,
        prof.studentClass || '',
        prof.programme || '',
        item.title || item.type || 'Irregularity',
        item.message || item.details || '',
        item.screenUrl || item.imageUrl || '',
        item.webcamUrl || '',
        item.timestamp?.toDate ? item.timestamp.toDate().toLocaleString() : (item.startedAt?.toDate ? item.startedAt.toDate().toLocaleString() : String(item.timestamp || item.startedAt || '')),
      ];
    });

    await exportToExcel(headers, rows, `irregularities_page_${page}.xlsx`);
  };

  const [showExportModal, setShowExportModal] = useState(false);

  return (
    <div className="view-container">
      <div className="view-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' }}>
        <div>
          <h2 style={{ margin: '0 0 6px 0' }}>🚨 Irregularities for Class: {classId}</h2>
          <div style={{ display: 'inline-flex', alignItems: 'center', background: '#f1f5f9', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: '6px', fontSize: '0.85rem', color: '#334155', fontWeight: 600 }}>
            📊 Period: <span style={{ color: '#2563eb', marginLeft: '4px' }}>{effectiveTimeRange.label}</span>
          </div>
        </div>
        <div className="actions-container" style={{ display: 'flex', gap: '8px', margin: 0, flexWrap: 'wrap' }}>
          <button onClick={() => refetch && refetch()} style={{ background: '#0284c7', color: '#fff' }}>🔄 Refresh</button>
          <button onClick={() => setShowExportModal(true)} style={{ background: '#2563eb', color: '#fff', fontWeight: 'bold' }}>
            📄 Export Formal Dossier (.docx)
          </button>
          <button onClick={exportToExcelPage}>Quick Excel Page</button>
        </div>
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
                      <td>
                        <StudentBadge
                          student={{
                            email: item.email || item.studentEmail || '',
                            ...(studentProfiles[(item.email || item.studentEmail || '').toLowerCase()] || {})
                          }}
                          showEmail={true}
                          size="sm"
                        />
                      </td>
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
          studentName={getStudentDisplayName(activeAudioModalData.email || activeAudioModalData.studentEmail, studentProfiles)}
          studentEmail={activeAudioModalData.email || activeAudioModalData.studentEmail}
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