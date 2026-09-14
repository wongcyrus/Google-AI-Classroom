import React, { useEffect, useRef, useState, useCallback } from 'react';
import './TeacherScreenBroadcastModal.css';

const RESOLUTION_OPTIONS = [
  {
    id: '1080p',
    title: '1080p (Full HD - Sharp)',
    badge: 'Recommended',
    badgeType: 'recommended',
    desc: 'Crisp font clarity for code, IDEs, terminals & slides. Ideal for classroom projection.',
  },
  {
    id: 'native',
    title: 'Native (Original / 2K)',
    badge: 'Ultra Sharp',
    badgeType: 'info',
    desc: 'Highest pixel density for 1440p/4K screens without hardware downsampling.',
  },
  {
    id: '720p',
    title: '720p (HD - Balanced)',
    badge: 'Balanced',
    badgeType: 'neutral',
    desc: 'Standard clarity with low bandwidth footprint for mixed network environments.',
  },
  {
    id: '480p',
    title: '480p (SD - Low Data)',
    badge: 'Data Saver',
    badgeType: 'neutral',
    desc: 'Lowest network usage for constrained connections.',
  },
];

const FRAMERATE_OPTIONS = [
  { interval: 1000, label: '1.0s / 1 FPS', desc: 'Smooth live updates' },
  { interval: 1500, label: '1.5s / 0.7 FPS', desc: 'Standard classroom (Recommended)' },
  { interval: 2000, label: '2.0s / 0.5 FPS', desc: 'Relaxed refresh' },
  { interval: 3000, label: '3.0s / 0.3 FPS', desc: 'Economy data saver' },
];

export default function TeacherScreenBroadcastModal({
  isOpen,
  onClose,
  screenStream,
  lastFrameData,
  isBroadcasting,
  frameStats,
  viewers = [],
  onStartBroadcast,
  onStopBroadcast,
  broadcastResolution = '1080p',
  broadcastInterval = 1500,
  setBroadcastResolution,
  setBroadcastInterval,
  onOpenSubtitles,
  isSubtitlesEnabled = false,
}) {
  const videoRef = useRef(null);

  // Local selection state for pre-broadcast setup
  const [selectedRes, setSelectedRes] = useState(broadcastResolution || '1080p');
  const [selectedInterval, setSelectedInterval] = useState(broadcastInterval || 1500);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (broadcastResolution) setSelectedRes(broadcastResolution);
  }, [broadcastResolution]);

  useEffect(() => {
    if (broadcastInterval) setSelectedInterval(broadcastInterval);
  }, [broadcastInterval]);

  // Robust callback ref to attach stream and start playback immediately whenever the video element mounts
  const attachVideo = useCallback((node) => {
    videoRef.current = node;
    if (!node) return;

    if (screenStream) {
      if (node.srcObject !== screenStream) {
        node.srcObject = screenStream;
      }
      node.muted = true;
      node.playsInline = true;
      const playPromise = node.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch((err) => {
          console.debug('[TeacherScreenBroadcastModal] video play note:', err);
        });
      }
    }
  }, [screenStream]);

  // Keep srcObject synchronized whenever screenStream, isBroadcasting, or modal opens
  useEffect(() => {
    const node = videoRef.current;
    if (!node || !screenStream || !isOpen || !isBroadcasting) return;

    if (node.srcObject !== screenStream) {
      node.srcObject = screenStream;
    }
    node.muted = true;
    node.playsInline = true;

    const handleLoadedMetadata = () => {
      node.play?.().catch(() => {});
    };
    node.addEventListener('loadedmetadata', handleLoadedMetadata);

    const playPromise = node.play?.();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {});
    }

    return () => {
      node.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [screenStream, isBroadcasting, isOpen]);

  if (!isOpen) return null;

  const handleStart = async () => {
    setIsStarting(true);
    try {
      if (setBroadcastResolution) setBroadcastResolution(selectedRes);
      if (setBroadcastInterval) setBroadcastInterval(selectedInterval);
      if (onStartBroadcast) {
        await onStartBroadcast({ resolution: selectedRes, interval: selectedInterval });
      }
    } catch (err) {
      console.warn('[TeacherScreenBroadcastModal] Start error:', err);
    } finally {
      setIsStarting(false);
    }
  };

  // -------------------------------------------------------------
  // Mode 1: Pre-broadcast Setup Modal (!isBroadcasting)
  // -------------------------------------------------------------
  if (!isBroadcasting) {
    return (
      <div className="broadcast-modal-overlay" onClick={onClose}>
        <div className="broadcast-modal-container broadcast-setup-container" onClick={(e) => e.stopPropagation()}>
          <div className="broadcast-modal-header">
            <div className="broadcast-modal-title">
              <span className="setup-badge-icon">🖥️</span>
              <div>
                <h3>Share Screen to Class</h3>
                <p className="setup-subtitle">
                  Configure image size and frame rate before sharing your screen with students
                </p>
              </div>
            </div>
            <button className="broadcast-close-btn" onClick={onClose} aria-label="Close setup modal">
              ✕
            </button>
          </div>

          <div className="broadcast-setup-body">
            {/* Resolution / Image Size Section */}
            <div className="setup-section">
              <label className="setup-section-label">
                <span className="label-icon">📺</span>
                <span>Select Image Size / Resolution</span>
              </label>
              <div className="resolution-cards-grid">
                {RESOLUTION_OPTIONS.map((opt) => {
                  const isSelected = selectedRes === opt.id;
                  return (
                    <div
                      key={opt.id}
                      className={`resolution-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedRes(opt.id);
                        if (setBroadcastResolution) setBroadcastResolution(opt.id);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="card-header-row">
                        <span className="card-title">{opt.title}</span>
                        {opt.badge && (
                          <span className={`card-badge badge-${opt.badgeType}`}>
                            {opt.badge}
                          </span>
                        )}
                      </div>
                      <p className="card-desc">{opt.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Refresh Rate / Frame Rate Section */}
            <div className="setup-section">
              <label className="setup-section-label">
                <span className="label-icon">⏱️</span>
                <span>Select Frame Rate / Refresh Interval</span>
              </label>
              <div className="framerate-pills-row">
                {FRAMERATE_OPTIONS.map((opt) => {
                  const isSelected = selectedInterval === opt.interval;
                  return (
                    <button
                      key={opt.interval}
                      type="button"
                      className={`framerate-pill-btn ${isSelected ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedInterval(opt.interval);
                        if (setBroadcastInterval) setBroadcastInterval(opt.interval);
                      }}
                    >
                      <span className="pill-primary">{opt.label}</span>
                      <span className="pill-sub">{opt.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Feature Highlights */}
            <div className="setup-highlights-box">
              <div className="highlight-item">
                <span className="hl-icon">⚡</span>
                <span>Low teacher laptop CPU & battery usage</span>
              </div>
              <div className="highlight-item">
                <span className="hl-icon">👥</span>
                <span>Delivers to 50+ students without WebRTC limits</span>
              </div>
              <div className="highlight-item">
                <span className="hl-icon">🔇</span>
                <span>No classroom audio echo or feedback loop</span>
              </div>
            </div>
          </div>

          <div className="broadcast-setup-footer">
            {onOpenSubtitles && (
              <button
                type="button"
                className="setup-cancel-btn"
                onClick={onOpenSubtitles}
                style={{
                  marginRight: 'auto',
                  background: isSubtitlesEnabled ? 'rgba(5, 150, 105, 0.15)' : undefined,
                  color: isSubtitlesEnabled ? '#059669' : undefined,
                  borderColor: isSubtitlesEnabled ? '#059669' : undefined,
                  fontWeight: 600,
                }}
                title="Configure Live Subtitles & Translation"
              >
                {isSubtitlesEnabled ? '🟢 Live Subtitles (ON)' : '🎙️ Subtitle Setup'}
              </button>
            )}
            <button className="setup-cancel-btn" onClick={onClose} disabled={isStarting}>
              Cancel
            </button>
            <button className="setup-start-btn" onClick={handleStart} disabled={isStarting}>
              {isStarting ? (
                <>
                  <span className="setup-spinner" />
                  <span>Preparing Screen Share...</span>
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>Start Sharing Screen</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // Mode 2: Active Broadcast Management Modal (isBroadcasting)
  // -------------------------------------------------------------
  return (
    <div className="broadcast-modal-overlay" onClick={onClose}>
      <div className="broadcast-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="broadcast-modal-header">
          <div className="broadcast-modal-title">
            <span className="live-pulse-dot" />
            <h3>🖥️ Live Class Screen Broadcast</h3>
          </div>
          <button className="broadcast-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="broadcast-modal-body">
          {/* Main Video Preview */}
          <div className="broadcast-preview-container">
            {screenStream ? (
              <video
                ref={attachVideo}
                autoPlay
                playsInline
                muted
                className="broadcast-preview-video"
                poster={lastFrameData || undefined}
                onClick={() => videoRef.current?.play?.().catch(() => {})}
                title="Live Teacher Screen Broadcast (Click to resume preview if paused)"
              />
            ) : lastFrameData ? (
              <img
                src={lastFrameData}
                alt="Teacher Screen Broadcast Live Feed"
                className="broadcast-preview-video"
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div className="broadcast-placeholder">
                <div className="setup-spinner" style={{ margin: '0 auto 12px' }} />
                <p>Waiting for screen stream preview...</p>
              </div>
            )}
            <div className="broadcast-status-badge">
              <span className="badge-pill live-pill">🔴 LIVE</span>
              <span className="badge-pill" style={{ background: '#2563eb', color: '#fff' }}>
                📺 {(broadcastResolution || '1080p').toUpperCase()}
              </span>
              <span className="badge-pill" style={{ background: '#059669', color: '#fff' }}>
                🌐 Classroom Stream (50+ Students)
              </span>
              <span className="badge-pill viewer-pill">
                👥 {viewers.length} Students Watching
              </span>
            </div>
          </div>

          {/* Viewers & Info Sidebar */}
          <div className="broadcast-sidebar">
            <div className="broadcast-stats-card">
              <h4>Broadcast Status</h4>
              <div className="stat-row">
                <span className="stat-label">Status:</span>
                <span className="stat-value text-success">
                  Broadcasting to Classroom
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Delivery:</span>
                <span className="stat-value font-bold" style={{ color: '#059669' }}>
                  Classroom Frame Stream
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Class Capacity:</span>
                <span className="stat-value text-success font-bold">50+ Students (Unlimited)</span>
              </div>
              {frameStats?.emittedFrames > 0 && (
                <div className="stat-row">
                  <span className="stat-label">Frames Published:</span>
                  <span className="stat-value">{frameStats.emittedFrames}</span>
                </div>
              )}
              <div className="stat-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                <span className="stat-label">Resolution:</span>
                <select
                  value={broadcastResolution || '1080p'}
                  onChange={(e) => {
                    setBroadcastResolution?.(e.target.value);
                    setSelectedRes(e.target.value);
                  }}
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontWeight: 600,
                  }}
                  title="Change broadcast resolution on the fly"
                >
                  <option value="1080p">1080p (Full HD - Sharp)</option>
                  <option value="native">Native (Original / 2K)</option>
                  <option value="720p">720p (HD - Balanced)</option>
                  <option value="480p">480p (SD - Low Data)</option>
                </select>
              </div>
              <div className="stat-row">
                <span className="stat-label">Framerate:</span>
                <select
                  value={broadcastInterval || 1500}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setBroadcastInterval?.(val);
                    setSelectedInterval(val);
                  }}
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontWeight: 600,
                  }}
                  title="Change refresh interval on the fly"
                >
                  <option value={1000}>1.0s / 1 FPS (Smooth)</option>
                  <option value={1500}>1.5s / 0.7 FPS (Standard)</option>
                  <option value={2000}>2.0s / 0.5 FPS (Relaxed)</option>
                  <option value={3000}>3.0s / 0.3 FPS (Economy)</option>
                </select>
              </div>
              {onOpenSubtitles && (
                <div className="stat-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                  <span className="stat-label">Subtitles:</span>
                  <button
                    type="button"
                    onClick={onOpenSubtitles}
                    style={{
                      fontSize: '0.76rem',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      background: isSubtitlesEnabled ? '#059669' : '#ffffff',
                      color: isSubtitlesEnabled ? '#ffffff' : '#334155',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title="Live Subtitle and Multi-Language Translation Controls"
                  >
                    {isSubtitlesEnabled ? '🟢 Live CC Active' : '🎙️ Subtitle Setup'}
                  </button>
                </div>
              )}
            </div>

            <div className="broadcast-viewers-list">
              <h4>Students ({viewers.length})</h4>
              {viewers.length === 0 ? (
                <div className="empty-viewers-notice">
                  <p>Waiting for students to connect...</p>
                </div>
              ) : (
                <div className="viewers-scroll-area">
                  {viewers.map((v) => (
                    <div key={v.studentUid} className="viewer-item">
                      <span className="viewer-email">{v.studentEmail}</span>
                      <span className="viewer-status-badge connected">
                        🟢 Watching
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="broadcast-actions">
              <button
                className="broadcast-stop-btn"
                onClick={() => {
                  onStopBroadcast();
                  onClose();
                }}
              >
                ⏹ Stop Screen Broadcast
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
