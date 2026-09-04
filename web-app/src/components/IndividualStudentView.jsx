import React, { useState, useEffect, useRef } from 'react';
import './IndividualStudentView.css';
import { db, storage } from '../firebase-config';
import { collection, addDoc, serverTimestamp, query, where, orderBy, limit, onSnapshot, doc } from 'firebase/firestore';
import { ref, getDownloadURL } from 'firebase/storage';
import useWebRTCPeekTeacher from '../hooks/useWebRTCPeekTeacher';
import AudioTranscriptModal from './AudioTranscriptModal';

const IndividualStudentView = ({ 
  student, 
  screenshotData, 
  screenshotUrl, 
  classId, 
  teacherUid, 
  initialTab,
  selectedChannel = 'both',
  problemFilter = 'all',
  captureMode = 'dual',
  onClose 
}) => {
  const [message, setMessage] = useState('');

  const resolveDefaultTab = () => {
    if (initialTab) return initialTab;
    // 1. Contextual problem filter priority
    if (problemFilter === 'no_cam') return 'webcam';
    if (problemFilter === 'no_screen') return 'screen';
    // 2. Class recording mode constraint
    if (captureMode === 'screen') return 'screen';
    if (captureMode === 'webcam') return 'webcam';
    // 3. Overall grid view channel filter
    if (selectedChannel === 'screen') return 'screen';
    if (selectedChannel === 'webcam') return 'webcam';
    return 'dual';
  };

  const [activeTab, setActiveTab] = useState(resolveDefaultTab);
  const previousTabRef = useRef(resolveDefaultTab());

  useEffect(() => {
    if (activeTab !== 'live_peek') {
      previousTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    setActiveTab(resolveDefaultTab());
  }, [student?.id, student?.uid, student?.studentUid, selectedChannel, problemFilter, captureMode, initialTab]);
  const [availableMics, setAvailableMics] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState('');

  // Audio Recordings State
  const [recentAudios, setRecentAudios] = useState([]);
  const [selectedAudioId, setSelectedAudioId] = useState(null);
  const [resolvedAudioUrls, setResolvedAudioUrls] = useState({});
  const [isClipHistoryOpen, setIsClipHistoryOpen] = useState(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const isPlayingAudioRef = useRef(false);
  isPlayingAudioRef.current = isPlayingAudio;
  const [audioStatusInfo, setAudioStatusInfo] = useState({
    isAudioSharing: false,
    audioLevel: 0,
    audioStatus: 'normal',
    latestAudioPath: null,
  });
  const [isTranscriptModalOpen, setIsTranscriptModalOpen] = useState(false);

  const liveVideoRef = useRef(null);
  const liveScreenVideoRef = useRef(null);
  const liveWebcamVideoRef = useRef(null);
  const liveAudioRef = useRef(null);

  // WebRTC Live Peek Hook
  const {
    isPeeking,
    connectionState,
    remoteStream,
    screenStream,
    webcamStream,
    remoteAudioStream,
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

  // Attach remote stream(s) to live video and audio elements
  useEffect(() => {
    if (liveScreenVideoRef.current && screenStream) {
      liveScreenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  useEffect(() => {
    if (liveWebcamVideoRef.current && webcamStream) {
      liveWebcamVideoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (liveAudioRef.current && remoteAudioStream) {
      liveAudioRef.current.srcObject = remoteAudioStream;
      liveAudioRef.current.muted = false;
      liveAudioRef.current.volume = 1.0;
      liveAudioRef.current.play().catch(() => {});
    }
  }, [remoteAudioStream]);

  useEffect(() => {
    if (liveVideoRef.current && (remoteStream || screenStream || webcamStream)) {
      liveVideoRef.current.srcObject = screenStream || webcamStream || remoteStream;
    }
  }, [remoteStream, screenStream, webcamStream, isPeeking]);

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

  const studentUid = student?.id || student?.uid || student?.studentUid;

  // Listen to live student status for real-time audio metadata
  useEffect(() => {
    if (!classId || !studentUid) return;
    try {
      const statusDocRef = doc(db, 'classes', classId, 'status', studentUid);
      const unsub = onSnapshot(statusDocRef, async (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const isSharingAudio = Boolean(data.isAudioSharing || data.isAudioRecording);
          setAudioStatusInfo({
            isAudioSharing: isSharingAudio,
            audioLevel: data.audioLevel || 0,
            audioStatus: data.audioStatus || (isSharingAudio ? 'idle' : 'inactive'),
            latestAudioPath: data.latestAudioPath || null,
            latestAudioUrl: data.latestAudioUrl || null,
          });

          // If latestAudioUrl is available directly in status doc, resolve immediately
          if (data.latestAudioUrl) {
            setResolvedAudioUrls((prev) => ({
              ...prev,
              latest: data.latestAudioUrl,
              ...(data.latestAudioPath ? { [data.latestAudioPath]: data.latestAudioUrl } : {}),
            }));
          } else if (data.latestAudioPath && storage) {
            try {
              const url = await getDownloadURL(ref(storage, data.latestAudioPath));
              setResolvedAudioUrls((prev) => ({ ...prev, latest: url, [data.latestAudioPath]: url }));
            } catch (err) {
              console.debug('Could not pre-resolve latest audio path URL:', err);
            }
          }
        }
      }, (err) => {
        console.warn('Could not listen to student status for audio:', err);
      });
      return () => unsub();
    } catch {}
  }, [classId, studentUid]);

  // Query recent recorded audio chunks from Firestore
  useEffect(() => {
    if (!classId || !studentUid) return;

    try {
      const audioQuery = query(
        collection(db, 'audio'),
        where('classId', '==', classId),
        where('studentUid', '==', studentUid),
        orderBy('timestamp', 'desc'),
        limit(10)
      );

      const unsub = onSnapshot(audioQuery, async (snap) => {
        const audios = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));

        // Sort descending by timestamp client-side for resilient performance
        audios.sort((a, b) => {
          const timeA = a.timestamp?.toMillis ? a.timestamp.toMillis() : (a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp || 0).getTime());
          const timeB = b.timestamp?.toMillis ? b.timestamp.toMillis() : (b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp || 0).getTime());
          return timeB - timeA;
        });

        setRecentAudios(audios);

        // Resolve download URLs for clips
        const urlMap = {};
        for (const item of audios) {
          if (item.audioUrl) {
            urlMap[item.id] = item.audioUrl;
            if (item.audioPath) urlMap[item.audioPath] = item.audioUrl;
          } else if (item.audioPath && storage) {
            try {
              const url = await getDownloadURL(ref(storage, item.audioPath));
              urlMap[item.id] = url;
              urlMap[item.audioPath] = url;
            } catch (err) {
              console.debug('Could not resolve download URL for audio:', item.audioPath, err);
            }
          }
        }
        setResolvedAudioUrls((prev) => ({ ...prev, ...urlMap }));
      }, (err) => {
        console.warn('Audio query snapshot error:', err);
      });

      return () => unsub();
    } catch (err) {
      console.error('Failed to setup recent audios query:', err);
    }
  }, [classId, studentUid]);

  if (!student) {
    return null;
  }

  const screenUrl = screenshotData?.screen?.url || (screenshotUrl && activeTab !== 'webcam' ? screenshotUrl : null);
  const webcamUrl = screenshotData?.webcam?.url;

  // Derive current audio clip stably
  const currentAudio = (selectedAudioId ? recentAudios.find((a) => a.id === selectedAudioId) : null)
    || recentAudios[0]
    || (audioStatusInfo.latestAudioPath ? { audioPath: audioStatusInfo.latestAudioPath, id: 'latest', timestamp: new Date() } : null);

  const currentAudioUrl = currentAudio ? (resolvedAudioUrls[currentAudio.id] || resolvedAudioUrls[currentAudio.audioPath] || resolvedAudioUrls.latest || currentAudio.audioUrl || null) : null;

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
      if (activeTab === 'live_peek') {
        setActiveTab(previousTabRef.current || resolveDefaultTab());
      }
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

          <div className="channel-tab-group" role="tablist" aria-label="Student video channels">
            <button 
              role="tab"
              aria-selected={activeTab === 'dual'}
              aria-label="Dual View Tab"
              className={`channel-tab-btn ${activeTab === 'dual' ? 'active' : ''}`}
              onClick={() => setActiveTab('dual')}
              disabled={captureMode === 'screen' || captureMode === 'webcam'}
              title={captureMode === 'screen' ? 'Class set to Screen Only' : captureMode === 'webcam' ? 'Class set to Webcam Only' : 'Dual View'}
            >
              Dual View
            </button>
            <button 
              role="tab"
              aria-selected={activeTab === 'screen'}
              aria-label="Screen Tab"
              className={`channel-tab-btn ${activeTab === 'screen' ? 'active' : ''}`}
              onClick={() => setActiveTab('screen')}
              disabled={captureMode === 'webcam' || (!screenUrl && captureMode === 'dual')}
              title={captureMode === 'webcam' ? 'Class set to Webcam Only' : '🖥️ Screen'}
            >
              🖥️ Screen
            </button>
            <button 
              role="tab"
              aria-selected={activeTab === 'webcam'}
              aria-label="Webcam Tab"
              className={`channel-tab-btn ${activeTab === 'webcam' ? 'active' : ''}`}
              onClick={() => setActiveTab('webcam')}
              disabled={captureMode === 'screen' || (!webcamUrl && captureMode === 'dual')}
              title={captureMode === 'screen' ? 'Class set to Screen Only' : '📷 Webcam'}
            >
              📷 Webcam
            </button>
            <button 
              role="tab"
              aria-selected={activeTab === 'live_peek'}
              aria-label="Live Peek Tab"
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
              {connectionState === 'connected' && (
                <span
                  style={{
                    backgroundColor: (remoteAudioStream?.getAudioTracks().length > 0) ? '#10b981' : '#64748b',
                    color: '#fff',
                    fontSize: '0.72rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold',
                  }}
                  title={remoteAudioStream?.getAudioTracks().length > 0 ? 'Receiving real-time student audio' : 'No audio track received from student'}
                >
                  {(remoteAudioStream?.getAudioTracks().length > 0) ? '🎙️ Student Mic: LIVE' : '🎙️ Student Mic: Inactive'}
                </span>
              )}
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
            <div className="individual-live-peek-container" style={{ position: 'relative', minHeight: '400px', backgroundColor: '#000', borderRadius: '8px', overflow: 'hidden' }}>
              {/* Hidden audio element to play student microphone audio to teacher in real time */}
              <audio ref={liveAudioRef} autoPlay playsInline style={{ display: 'none' }} />

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
                    backgroundColor: 'rgba(0,0,0,0.88)',
                    zIndex: 10,
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

              {screenStream && webcamStream ? (
                <div className="individual-dual-container webrtc-dual-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem', padding: '1rem', width: '100%', boxSizing: 'border-box' }}>
                  <div className="individual-feed-card" style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', borderRadius: '8px', overflow: 'hidden', border: '1px solid #334155' }}>
                    <div className="feed-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#1e293b', color: '#f8fafc', fontWeight: 600, fontSize: '0.85rem' }}>
                      <span>🖥️ Live Screen</span>
                      <span style={{ backgroundColor: '#ef4444', color: '#fff', fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>● LIVE</span>
                    </div>
                    <video
                      ref={liveScreenVideoRef}
                      autoPlay
                      playsInline
                      controls
                      style={{ width: '100%', height: 'auto', minHeight: '220px', maxHeight: '420px', objectFit: 'contain', backgroundColor: '#000' }}
                    />
                  </div>

                  <div className="individual-feed-card" style={{ display: 'flex', flexDirection: 'column', background: '#0f172a', borderRadius: '8px', overflow: 'hidden', border: '1px solid #334155' }}>
                    <div className="feed-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.5rem 0.75rem', background: '#1e293b', color: '#f8fafc', fontWeight: 600, fontSize: '0.85rem' }}>
                      <span>📷 Live Webcam</span>
                      <span style={{ backgroundColor: '#ef4444', color: '#fff', fontSize: '0.68rem', padding: '2px 6px', borderRadius: '4px', fontWeight: 'bold' }}>● LIVE</span>
                    </div>
                    <video
                      ref={liveWebcamVideoRef}
                      autoPlay
                      playsInline
                      controls
                      style={{ width: '100%', height: 'auto', minHeight: '220px', maxHeight: '420px', objectFit: 'contain', backgroundColor: '#000' }}
                    />
                  </div>
                </div>
              ) : (
                <div className="individual-single-feed" style={{ position: 'relative', width: '100%', height: '100%', minHeight: '400px' }}>
                  <div style={{ position: 'absolute', top: '10px', left: '10px', zIndex: 5, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', padding: '4px 10px', borderRadius: '6px', color: '#fff', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{screenStream ? '🖥️ Live Screen' : webcamStream ? '📷 Live Webcam' : '👁️ Live WebRTC Stream'}</span>
                    <span style={{ color: '#ef4444', fontWeight: 'bold' }}>● LIVE</span>
                  </div>
                  <video
                    ref={liveVideoRef}
                    autoPlay
                    playsInline
                    controls
                    style={{ width: '100%', height: '100%', maxHeight: '600px', objectFit: 'contain' }}
                  />
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

        {/* Compact Voice Recording Bar */}
        <div className="individual-audio-section compact">
          <div className="individual-audio-bar">
            {/* Left: Title & Live Status */}
            <div className="audio-header-title">
              <span>🎙️ Voice</span>
              {audioStatusInfo.isAudioSharing ? (
                <span className={`audio-status-pill ${audioStatusInfo.audioStatus === 'speaking' || audioStatusInfo.audioLevel >= 25 ? 'speaking' : 'silent'}`}>
                  {audioStatusInfo.audioStatus === 'speaking' || audioStatusInfo.audioLevel >= 25 
                    ? `🗣️ ${audioStatusInfo.audioLevel}%` 
                    : '🟢 Live'}
                </span>
              ) : (
                <span className="audio-status-pill silent">⚪ Inactive</span>
              )}
            </div>

            {/* Center: Audio Player or Brief Status */}
            <div className="audio-player-container">
              {currentAudioUrl ? (
                <audio
                  key={currentAudio?.id || currentAudioUrl}
                  controls
                  src={currentAudioUrl}
                  className="individual-audio-player compact"
                  preload="metadata"
                  data-testid="student-audio-player"
                  onPlay={() => {
                    setIsPlayingAudio(true);
                    if (currentAudio?.id && selectedAudioId !== currentAudio.id) {
                      setSelectedAudioId(currentAudio.id);
                    }
                  }}
                  onPause={() => setIsPlayingAudio(false)}
                  onEnded={() => setIsPlayingAudio(false)}
                >
                  Your browser does not support HTML5 audio.
                </audio>
              ) : audioStatusInfo.isAudioSharing ? (
                <span className="audio-compact-hint">🔇 Silent interval (listening live)</span>
              ) : (
                <span className="audio-compact-hint">Mic inactive</span>
              )}
            </div>

            {/* Right: Meta & Actions */}
            <div className="audio-actions-group">
              {currentAudio && (
                <span className="audio-clip-badge" title="Recorded clip time and duration">
                  🕒 {currentAudio.timestamp?.toDate ? currentAudio.timestamp.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date(currentAudio.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ({currentAudio.duration || 30}s)
                </span>
              )}

              {(currentAudio?.transcript || currentAudio?.transcriptSegments?.length > 0) && (
                <button
                  type="button"
                  className="btn-transcript-modal compact"
                  onClick={() => setIsTranscriptModalOpen(true)}
                  title="View full AI diarization transcript"
                >
                  📜 Transcript
                </button>
              )}

              {recentAudios.length > 0 && (
                <button
                  type="button"
                  className={`btn-history-toggle ${isClipHistoryOpen ? 'open' : ''}`}
                  onClick={() => setIsClipHistoryOpen(!isClipHistoryOpen)}
                  title="Toggle recording timeline"
                >
                  📋 Clips ({recentAudios.length}) {isClipHistoryOpen ? '▲' : '▼'}
                </button>
              )}
            </div>
          </div>

          {/* Optional Transcript Subtitle Strip (Live Whisper or Recorded Clip) */}
          {(currentAudio?.transcript || student?.liveTranscript) && !isClipHistoryOpen && (
            <div className="audio-transcript-snippet compact">
              {student?.liveTranscript && !currentAudio?.transcript ? (
                <span>
                  <strong style={{ color: '#38bdf8' }}>🎙️ Whisper (Live):</strong> "{student.liveTranscript.length > 110 ? `${student.liveTranscript.slice(0, 110)}...` : student.liveTranscript}"
                </span>
              ) : (
                <span>💬 "{currentAudio.transcript.length > 110 ? `${currentAudio.transcript.slice(0, 110)}...` : currentAudio.transcript}"</span>
              )}
              {(currentAudio?.transcript || currentAudio?.transcriptSegments?.length > 0) && (
                <button
                  type="button"
                  className="btn-transcript-link"
                  onClick={() => setIsTranscriptModalOpen(true)}
                >
                  Details
                </button>
              )}
            </div>
          )}

          {/* Collapsible Recordings Playlist Drawer */}
          {isClipHistoryOpen && recentAudios.length > 0 && (
            <div className="recordings-playlist-section compact">
              <div className="recordings-playlist-scroll" role="list">
                {recentAudios.map((clip, idx) => {
                  const clipDate = clip.timestamp?.toDate ? clip.timestamp.toDate() : new Date(clip.timestamp || Date.now());
                  const timeStr = clipDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                  const isSelected = currentAudio?.id === clip.id;

                  return (
                    <button
                      key={clip.id || idx}
                      type="button"
                      role="listitem"
                      className={`recording-playlist-item ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedAudioId(clip.id)}
                      title={`Play recording from ${timeStr}`}
                    >
                      <div className="playlist-item-left">
                        <span className="playlist-play-icon">{isSelected ? '🔊' : '▶️'}</span>
                        <div className="playlist-item-meta">
                          <span className="playlist-time">{timeStr}</span>
                          <span className="playlist-duration">{clip.duration || 30}s</span>
                        </div>
                      </div>

                      <div className="playlist-item-preview">
                        {clip.transcript ? (
                          <span className="playlist-transcript-text">"{clip.transcript.length > 50 ? `${clip.transcript.slice(0, 50)}...` : clip.transcript}"</span>
                        ) : clip.hasVoiceActivity ? (
                          <span className="playlist-speech-badge">🗣️ Speech</span>
                        ) : (
                          <span className="playlist-quiet-badge">🤫 Quiet</span>
                        )}
                      </div>

                      <div className="playlist-item-right">
                        {clip.isMultiSpeaker && <span className="playlist-flag warn">👥 Multi</span>}
                        {clip.riskLevel === 'high' && <span className="playlist-flag danger">🚨 Alert</span>}
                        {isSelected && <span className="playlist-now-active">Selected</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
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