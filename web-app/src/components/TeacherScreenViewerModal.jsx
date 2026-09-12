import React, { useState, useEffect, useRef } from 'react';
import './TeacherScreenViewerModal.css';

export default function TeacherScreenViewerModal({
  isOpen,
  onClose,
  remoteStream,
  liveFrame,
  broadcastMode = 'frame',
  connectionState,
  hasAudio,
  isAudioMuted,
  onToggleMute,
  broadcastInfo,
}) {
  const videoRef = useRef(null);
  const [viewMode, setViewMode] = useState('floating'); // 'floating' | 'docked' | 'fullscreen' | 'minimized'

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
      videoRef.current.play().catch((err) => {
        console.warn('[Teacher Screen Viewer] Autoplay play error:', err);
      });
    }
  }, [remoteStream, viewMode]);

  if (!isOpen) return null;

  // Minimized Pill Mode
  if (viewMode === 'minimized') {
    return (
      <div className="teacher-stream-minimized-pill" onClick={() => setViewMode('docked')}>
        <span className="live-pulse-dot" />
        <span className="pill-text">🖥️ Teacher Screen Sharing (Click to Expand)</span>
        <button
          className="pill-close-btn"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="Close Screen Share"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className={`teacher-stream-viewer-wrapper ${viewMode}`}>
      {viewMode === 'docked' && <div className="viewer-backdrop" onClick={onClose} />}

      <div className={`teacher-stream-container ${viewMode}`}>
        {/* Top Control Bar */}
        <div className="teacher-stream-header">
          <div className="stream-header-left">
            <span className="live-pulse-dot" />
            <span className="stream-title">
              🖥️ {broadcastInfo?.teacherEmail ? `${broadcastInfo.teacherEmail}'s Screen` : 'Teacher Screen'}
            </span>
            <span className={`stream-conn-status ${connectionState}`}>
              {connectionState === 'connected'
                ? (broadcastMode === 'frame' ? '🟢 Live Classroom Stream (50+ Students)' : '🟢 Live')
                : connectionState === 'queued'
                ? '⏳ In Queue (Capacity Reached)'
                : '⏳ Connecting...'}
            </span>
          </div>

          <div className="stream-header-right">
            {/* Audio Toggle (WebRTC only) */}
            {hasAudio && broadcastMode !== 'frame' && (
              <button
                className={`stream-tool-btn ${isAudioMuted ? 'muted' : 'active'}`}
                onClick={onToggleMute}
                title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
              >
                {isAudioMuted ? '🔇 Muted' : '🔊 Sound'}
              </button>
            )}

            {/* Layout Mode Switchers */}
            <div className="view-mode-buttons">
              <button
                className={`mode-btn ${viewMode === 'floating' ? 'active' : ''}`}
                onClick={() => setViewMode('floating')}
                title="Floating Picture-in-Picture"
              >
                🪟 Float
              </button>
              <button
                className={`mode-btn ${viewMode === 'docked' ? 'active' : ''}`}
                onClick={() => setViewMode('docked')}
                title="Standard Docked View"
              >
                🔲 Standard
              </button>
              <button
                className={`mode-btn ${viewMode === 'fullscreen' ? 'active' : ''}`}
                onClick={() => setViewMode('fullscreen')}
                title="Fullscreen Presentation"
              >
                ⛶ Max
              </button>
              <button
                className="mode-btn"
                onClick={() => setViewMode('minimized')}
                title="Minimize to Floating Pill"
              >
                ➖ Min
              </button>
            </div>

            {/* Close Button */}
            <button className="stream-close-btn" onClick={onClose} title="Close Stream">
              ✕
            </button>
          </div>
        </div>

        {/* Video / Frame Display Area */}
        <div className="teacher-stream-video-box">
          {broadcastMode === 'frame' || liveFrame ? (
            liveFrame ? (
              <img
                src={liveFrame}
                alt="Teacher Live Screen"
                className="teacher-live-video"
                style={{ objectFit: 'contain', width: '100%', height: '100%', display: 'block', backgroundColor: '#090d16' }}
              />
            ) : (
              <div className="video-loading-state">
                <div className="loading-spinner" />
                <p>Receiving classroom screen broadcast...</p>
              </div>
            )
          ) : remoteStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="teacher-live-video"
            />
          ) : connectionState === 'queued' ? (
            <div className="video-loading-state queued-state">
              <div className="loading-spinner" />
              <p style={{ fontWeight: 600, fontSize: '1rem', color: '#f59e0b', marginBottom: '8px' }}>
                Broadcast Slot Queued
              </p>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '340px', textAlign: 'center', lineHeight: 1.4 }}>
                Teacher screen broadcast is currently at full capacity (maximum active viewers reached). You will connect automatically as soon as a slot opens.
              </p>
            </div>
          ) : (
            <div className="video-loading-state">
              <div className="loading-spinner" />
              <p>Connecting to Teacher's Live Screen...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
