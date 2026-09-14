import React, { useState } from 'react';
import './TeacherScreenViewerModal.css';
import LiveSubtitleOverlay from './subtitles/LiveSubtitleOverlay';
import { useStudentLiveSubtitles } from '../hooks/useStudentLiveSubtitles';

export default function TeacherScreenViewerModal({
  isOpen,
  onClose,
  liveFrame,
  connectionState,
  broadcastInfo,
  classId,
}) {
  const [viewMode, setViewMode] = useState('floating'); // 'floating' | 'docked' | 'fullscreen' | 'minimized'

  const subtitleState = useStudentLiveSubtitles({ classId });

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
                ? '🟢 Live Classroom Stream (50+ Students)'
                : '⏳ Connecting...'}
            </span>
            {broadcastInfo?.resolution && (
              <span className="badge-pill" style={{ background: '#2563eb', color: '#fff', fontSize: '0.72rem', padding: '1px 7px', borderRadius: '9999px', fontWeight: 700 }}>
                {broadcastInfo.resolution.toUpperCase()}
              </span>
            )}
          </div>

          <div className="stream-header-right">
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

        {/* Live Frame Display Area */}
        <div className="teacher-stream-video-box">
          {liveFrame ? (
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
          )}

          {/* Real-time Subtitles Overlay */}
          <LiveSubtitleOverlay
            active={subtitleState.active}
            originalText={subtitleState.originalText}
            sourceLang={subtitleState.sourceLang}
            currentTranslation={subtitleState.currentTranslation}
            translations={subtitleState.translations}
            selectedLanguage={subtitleState.selectedLanguage}
            onSelectLanguage={subtitleState.setSelectedLanguage}
            displayMode={subtitleState.displayMode}
            onSelectDisplayMode={subtitleState.setDisplayMode}
            fontSize={subtitleState.fontSize}
            onSelectFontSize={subtitleState.setFontSize}
            isVisible={subtitleState.isVisible}
            onToggleVisible={subtitleState.setIsVisible}
            isDocked={true}
            engine={subtitleState.engine}
          />
        </div>
      </div>
    </div>
  );
}
