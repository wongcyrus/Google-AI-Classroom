import React, { useState, useEffect, useRef } from 'react';
import './IndividualStudentView.css';
import { db, storage } from '../firebase-config';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot, doc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import useWebRTCPeekTeacher from '../hooks/useWebRTCPeekTeacher';
import AudioTranscriptModal from './AudioTranscriptModal';

const IndividualStudentView = ({ student, screenshotData, screenshotUrl, classId, teacherUid, onClose }) => {
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('dual'); // 'dual' | 'screen' | 'webcam' | 'live_peek'
  const [availableMics, setAvailableMics] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');

  // Audio Recordings State
  const [recentAudios, setRecentAudios] = useState([]);
  const [selectedAudioIndex, setSelectedAudioIndex] = useState(0);
  const [resolvedAudioUrls, setResolvedAudioUrls] = useState({});
  const [audioStatusInfo, setAudioStatusInfo] = useState({
    isAudioSharing: false,
    audioLevel: 0,
    audioStatus: 'normal',
    latestAudioPath: null,
  });
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);

  const liveVideoRef = useRef(null);

  // WebRTC Live Peek Hook
  const {
    isPeeking,
    connectionState,
    remoteStream,
    isTalkbackActive,
    error: rtcError,
    startPeek,
    stopPeek,
    toggleTalkback,
  } = useWebRTCPeekTeacher({
    classId,
    studentUid: student?.id,
    teacherUid,
  });

  // Attach remote stream to live video element
  useEffect(() => {
    if (liveVideoRef.current && remoteStream) {
      liveVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream, isPeeking]);

  // Load teacher microphones for talkback
  useEffect(() => {
    if (isTalkbackActive && navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        const mics = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
        setAvailableMics(mics);
        if (mics.length > 0 && !selectedMicId) {
          setSelectedMicId(mics[0].deviceId);
        }
      });
    }
  }, [isTalkbackActive, selectedMicId]);

  // Listen to live student status for real-time audio metadata
  useEffect(() => {
    if (!classId || !student?.id) return;
    try {
      const statusDocRef = doc(db, 'classes', classId, 'status', student.id);
      const unsub = onSnapshot(statusDocRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setAudioStatusInfo({
            isAudioSharing: Boolean(data.isAudioSharing || data.isAudioRecording),
            audioLevel: data.audioLevel || 0,
            audioStatus: data.audioStatus || 'normal',
            latestAudioPath: data.latestAudioPath || null,
          });
        }
      }, (err) => {
        console.warn('Could not listen to student status for audio:', err);
      });
      return () => unsub();
    } catch {}
  }, [classId, student?.id]);

  // Query recent recorded audio chunks from Firestore
  useEffect(() => {
    if (!classId || !student?.id) return;

    try {
      const audioQuery = query(
        collection(db, 'audio'),
        where('classId', '==', classId),
        where('studentUid', '==', student.id),
        orderBy('timestamp', 'desc'),
        limit(5)
      );

      const unsub = onSnapshot(audioQuery, async (snap) => {
        const audios = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        setRecentAudios(audios);

        // Resolve download URLs for clips
        const urlMap = {};
        for (const item of audios) {
          if (item.audioUrl) {
            urlMap[item.id] = item.audioUrl;
          } else if (item.audioPath && storage) {
            try {
              const url = await getDownloadURL(ref(storage, item.audioPath));
              urlMap[item.id] = url;
            } catch (err) {
              console.warn(`Could not resolve download URL for audio ${item.audioPath}:`, err);
            }
          }
        }
        setResolvedAudioUrls((prev) => ({ ...prev, ...urlMap }));
      }, (err) => {
        console.warn('Audio query snapshot error:', err);
      });

      return () => unsub();
    } catch (err) {
      console.warn('Failed to query recent audios:', err);
    }
  }, [classId, student?.id]);

  if (!student) {
    return null;
  }

  const screenUrl = screenshotData?.screen?.url || (screenshotUrl && activeTab !== 'webcam' ? screenshotUrl : null);
  const webcamUrl = screenshotData?.webcam?.url;
  const currentAudio = recentAudios[selectedAudioIndex] || null;
  const currentAudioUrl = currentAudio ? (resolvedAudioUrls[currentAudio.id] || currentAudio.audioUrl || null) : null;

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    try {
      const studentMessagesRef = collection(db, 'students', student.id, 'messages');
      await addDoc(studentMessagesRef, {
        message,
        timestamp: serverTimestamp(),
      });
      setMessage('');
      alert(`Message sent to ${student.email}`);
    } catch (error) {
      console.error('Error sending message: ', error);
    }
  };

  const handleQuickNudge = async (text) => {
    try {
      const studentMessagesRef = collection(db, 'students', student.id, 'messages');
      await addDoc(studentMessagesRef, {
        message: text,
        timestamp: serverTimestamp(),
      });
      alert(`Intervention sent to ${student.email}`);
    } catch (error) {
      console.error('Error sending intervention: ', error);
    }
  };

  const handleShare = async (urlToShare) => {
    const targetUrl = urlToShare || screenUrl || webcamUrl;
    if (navigator.share && targetUrl) {
      try {
        const response = await fetch(targetUrl);
        const blob = await response.blob();
        const file = new File([blob], `${student.email}-screenshot.png`, { type: blob.type });

        await navigator.share({
          files: [file],
          title: `Screenshot of ${student.email}`,
          text: `Here is a screenshot of ${student.email}.`,
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      if (targetUrl) {
        navigator.clipboard.writeText(targetUrl);
        alert('Screenshot URL copied to clipboard!');
      } else {
        alert('No screenshot to share.');
      }
    }
  };

  const handleToggleLivePeek = () => {
    if (isPeeking) {
      stopPeek();
      if (activeTab === 'live_peek') setActiveTab('dual');
    } else {
      startPeek();
      setActiveTab('live_peek');
    }
  };

  return (
    <div className="individual-student-view-overlay" onClick={onClose}>
      <div className="individual-student-view-content" onClick={(e) => e.stopPropagation()}>
        <div className="individual-student-view-header">
          <div>
            <h2>{student.name || student.email}</h2>
            <p className="student-subemail">{student.email}</p>
          </div>

          <div className="channel-tab-group">
            <button 
              className={`channel-tab-btn ${activeTab === 'dual' ? 'active' : ''}`}
              onClick={() => setActiveTab('dual')}
            >
              Dual View
            </button>
            <button 
              className={`channel-tab-btn ${activeTab === 'screen' ? 'active' : ''}`}
              onClick={() => setActiveTab('screen')}
              disabled={!screenUrl}
            >
              🖥️ Screen
            </button>
            <button 
              className={`channel-tab-btn ${activeTab === 'webcam' ? 'active' : ''}`}
              onClick={() => setActiveTab('webcam')}
              disabled={!webcamUrl}
            >
              📷 Webcam
            </button>
            <button 
              className={`channel-tab-btn live-peek-tab-btn ${activeTab === 'live_peek' ? 'active' : ''}`}
              onClick={handleToggleLivePeek}
              style={{
                backgroundColor: isPeeking ? '#dc2626' : '#2563eb',
                color: '#fff',
                fontWeight: '600',
              }}
            >
              {isPeeking ? '⏹️ Stop Live Peek' : '🔴 Live WebRTC Peek'}
            </button>
          </div>

          <div className="message-sender" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
              <input 
                type="text" 
                value={message} 
                onChange={(e) => setMessage(e.target.value)} 
                placeholder="Send direct message to student..." 
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <button onClick={handleSendMessage} className="btn-send">Send</button>
            </div>
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn-mini"
                style={{ fontSize: '0.72rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => handleQuickNudge('⚠️ Please start sharing your screen immediately.')}
                title="Send Screen Share Reminder"
              >
                🖥️ Screen
              </button>
              <button
                type="button"
                className="btn-mini"
                style={{ fontSize: '0.72rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => handleQuickNudge('⚠️ Please turn on your webcam feed for invigilation.')}
                title="Send Webcam Reminder"
              >
                📷 Cam
              </button>
              <button
                type="button"
                className="btn-mini"
                style={{ fontSize: '0.72rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => handleQuickNudge('⚠️ Please check and enable your microphone.')}
                title="Send Mic Reminder"
              >
                🎙️ Mic
              </button>
              <button
                type="button"
                className="btn-mini"
                style={{ fontSize: '0.72rem', padding: '2px 6px', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer' }}
                onClick={() => handleQuickNudge('⚠️ Please keep your face centered and look directly at your screen.')}
                title="Send Face Centering Reminder"
              >
                👁️ Face Screen
              </button>
            </div>
          </div>

          <div className="header-actions">
            <button onClick={() => handleShare()} className="btn-secondary">Share</button>
            <button onClick={() => { stopPeek(); onClose(); }} className="btn-close">✕</button>
          </div>
        </div>

        {/* Live Peek Controls & Status Strip */}
        {isPeeking && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#0f172a',
              padding: '0.6rem 1.25rem',
              borderBottom: '1px solid #334155',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.85rem' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  backgroundColor: connectionState === 'connected' ? '#10b981' : '#f59e0b',
                }}
              />
              <span style={{ fontWeight: '600', color: '#f8fafc' }}>
                Status: {connectionState === 'connected' ? '🟢 Live P2P Stream Active (30 FPS)' : connectionState === 'connecting' ? '🔄 Establishing P2P Connection...' : '⚠️ Connecting...'}
              </span>
              {rtcError && <span style={{ color: '#ef4444' }}>({rtcError})</span>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              {isTalkbackActive && availableMics.length > 1 && (
                <select
                  value={selectedMicId}
                  onChange={(e) => setSelectedMicId(e.target.value)}
                  style={{
                    backgroundColor: '#1e293b',
                    color: '#fff',
                    border: '1px solid #475569',
                    borderRadius: '6px',
                    padding: '0.3rem 0.5rem',
                    fontSize: '0.8rem',
                  }}
                >
                  {availableMics.map((m) => (
                    <option key={m.deviceId} value={m.deviceId}>
                      🎙️ {m.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onClick={() => toggleTalkback(!isTalkbackActive, selectedMicId)}
                style={{
                  padding: '0.35rem 0.85rem',
                  borderRadius: '6px',
                  backgroundColor: isTalkbackActive ? '#ef4444' : '#334155',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.8rem',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {isTalkbackActive ? '🎙️ Intercom Active (Speaking)' : '🗣️ Talk to Student'}
              </button>
            </div>
          </div>
        )}

        <div className="individual-student-view-body">
          {activeTab === 'live_peek' ? (
            <div className="individual-single-feed" style={{ position: 'relative', minHeight: '400px', backgroundColor: '#000' }}>
              <video
                ref={liveVideoRef}
                autoPlay
                playsInline
                controls
                style={{ width: '100%', height: '100%', maxHeight: '600px', objectFit: 'contain' }}
              />
              {connectionState !== 'connected' && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    backgroundColor: 'rgba(0,0,0,0.85)',
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📡</div>
                  <p style={{ fontWeight: '600', color: '#f8fafc', margin: 0 }}>
                    Connecting Live 1-to-1 WebRTC Stream...
                  </p>
                  <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '0.25rem' }}>
                    Requesting video and audio tracks from student browser
                  </p>
                </div>
              )}
            </div>
          ) : activeTab === 'dual' ? (
            <div className="individual-dual-container">
              <div className="individual-feed-card">
                <div className="feed-card-header">
                  <span>🖥️ Screen Stream</span>
                  {screenUrl && <button onClick={() => handleShare(screenUrl)} className="btn-mini">Share Screen</button>}
                </div>
                {screenUrl ? (
                  <img src={screenUrl} alt={`Screen from ${student.email}`} />
                ) : (
                  <div className="feed-card-empty">No Screen Stream Available</div>
                )}
              </div>

              <div className="individual-feed-card">
                <div className="feed-card-header">
                  <span>📷 Webcam Stream</span>
                  {webcamUrl && <button onClick={() => handleShare(webcamUrl)} className="btn-mini">Share Webcam</button>}
                </div>
                {webcamUrl ? (
                  <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
                ) : (
                  <div className="feed-card-empty">No Webcam Stream Available</div>
                )}
              </div>
            </div>
          ) : activeTab === 'screen' ? (
            <div className="individual-single-feed">
              {screenUrl ? (
                <img src={screenUrl} alt={`Screen from ${student.email}`} />
              ) : (
                <p className="no-feed-text">No Screen Stream Available</p>
              )}
            </div>
          ) : (
            <div className="individual-single-feed">
              {webcamUrl ? (
                <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
              ) : (
                <p className="no-feed-text">No Webcam Stream Available</p>
              )}
            </div>
          )}
        </div>

        {/* Recent Audio Recording Section */}
        <div className="individual-audio-section">
          <div className="individual-audio-header">
            <div className="audio-header-title">
              <span>🎙️ Recent Voice Recording</span>
              {audioStatusInfo.isAudioSharing ? (
                <span className={`audio-status-pill ${audioStatusInfo.audioStatus === 'speaking' || audioStatusInfo.audioLevel >= 25 ? 'speaking' : 'silent'}`}>
                  {audioStatusInfo.audioStatus === 'speaking' || audioStatusInfo.audioLevel >= 25 ? '🗣️ Speaking' : '🟢 Mic Active'}
                </span>
              ) : (
                <span className="audio-status-pill silent">⚪ Mic Inactive</span>
              )}
            </div>

            {recentAudios.length > 1 && (
              <select
                className="clip-select-dropdown"
                value={selectedAudioIndex}
                onChange={(e) => setSelectedAudioIndex(Number(e.target.value))}
                aria-label="Select audio clip"
              >
                {recentAudios.map((clip, idx) => {
                  const clipDate = clip.timestamp?.toDate ? clip.timestamp.toDate() : new Date(clip.timestamp || Date.now());
                  const timeStr = clipDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  return (
                    <option key={clip.id || idx} value={idx}>
                      Clip {idx + 1}: {timeStr} ({clip.duration || 30}s)
                    </option>
                  );
                })}
              </select>
            )}
          </div>

          {currentAudioUrl ? (
            <div className="individual-audio-controls">
              <audio
                controls
                src={currentAudioUrl}
                className="individual-audio-player"
                preload="metadata"
                data-testid="student-audio-player"
              >
                Your browser does not support HTML5 audio.
              </audio>

              {(currentAudio?.transcript || currentAudio?.transcriptSegments?.length > 0) && (
                <button
                  type="button"
                  className="btn-transcript-modal"
                  onClick={() => setIsTranscriptModalOpen(true)}
                  title="View full AI diarization transcript with speaker tags"
                >
                  📜 View Full Transcript
                </button>
              )}
            </div>
          ) : (
            <div className="audio-empty-placeholder">
              <span>🔇 No recent audio recordings uploaded for this student yet.</span>
            </div>
          )}

          {currentAudio && (
            <div className="audio-meta-strip">
              <span className="audio-meta-item">
                🕒 Recorded: {currentAudio.timestamp?.toDate ? currentAudio.timestamp.toDate().toLocaleTimeString() : new Date(currentAudio.timestamp || Date.now()).toLocaleTimeString()}
              </span>
              <span className="audio-meta-item">
                ⏱️ Duration: {currentAudio.duration || 30}s
              </span>
              {currentAudio.peakVolume !== undefined && (
                <span className="audio-meta-item">
                  🔊 Peak Volume: {currentAudio.peakVolume}%
                </span>
              )}
              {currentAudio.hasVoiceActivity && (
                <span className="audio-meta-item" style={{ color: '#34d399' }}>
                  🗣️ Voice Detected
                </span>
              )}
              {currentAudio.aiMonitoringMode && (
                <span className="audio-meta-item">
                  🧠 Mode: {currentAudio.aiMonitoringMode}
                </span>
              )}
            </div>
          )}

          {currentAudio?.transcript && (
            <div className="audio-transcript-snippet">
              <span>💬 "{currentAudio.transcript.length > 140 ? `${currentAudio.transcript.slice(0, 140)}...` : currentAudio.transcript}"</span>
              {!isTranscriptModalOpen && (
                <button
                  type="button"
                  style={{ background: 'transparent', border: 'none', color: '#818cf8', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
                  onClick={() => setIsTranscriptModalOpen(true)}
                >
                  Details
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {isTranscriptModalOpen && (
        <AudioTranscriptModal
          isOpen={isTranscriptModalOpen}
          onClose={() => setIsTranscriptModalOpen(false)}
          studentUid={student.id}
          studentName={student.name || student.email}
          audioUrl={currentAudioUrl}
          snapshotUrl={webcamUrl || screenUrl}
          transcriptSegments={currentAudio?.transcriptSegments || []}
          transcriptSnippet={currentAudio?.transcript || ''}
          riskLevel={currentAudio?.riskLevel || 'low'}
          classification={currentAudio?.classification || (currentAudio?.hasVoiceActivity ? 'speaking' : 'normal')}
          explanation={currentAudio?.explanation || currentAudio?.summary || 'Recent student voice recording segment'}
        />
      )}
    </div>
  );
};

export default IndividualStudentView;