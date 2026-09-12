import React, { useEffect, useRef } from 'react';
import './TeacherScreenBroadcastModal.css';

export default function TeacherScreenBroadcastModal({
  isOpen,
  onClose,
  screenStream,
  isBroadcasting,
  broadcastMode = 'frame',
  frameStats,
  hasAudio,
  viewers = [],
  onStopBroadcast,
}) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current && screenStream) {
      videoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  if (!isOpen) return null;

  const activeCount = viewers.filter((v) => v.status !== 'queued' && (v.connectionState === 'connected' || v.connectionState === 'connecting' || !v.connectionState)).length;
  const queuedCount = viewers.filter((v) => v.status === 'queued').length;

  return (
    <div className="broadcast-modal-overlay" onClick={onClose}>
      <div className="broadcast-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="broadcast-modal-header">
          <div className="broadcast-modal-title">
            <span className="live-pulse-dot" />
            <h3>🖥️ Live Class Screen Broadcast</h3>
          </div>
          <button className="broadcast-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="broadcast-modal-body">
          {/* Main Video Preview */}
          <div className="broadcast-preview-container">
            {screenStream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="broadcast-preview-video"
              />
            ) : (
              <div className="broadcast-placeholder">
                <p>No active screen stream.</p>
              </div>
            )}
            <div className="broadcast-status-badge">
              <span className="badge-pill live-pill">🔴 LIVE</span>
              {broadcastMode === 'frame' ? (
                <span className="badge-pill" style={{ background: '#059669', color: '#fff' }}>
                  🌐 Classroom Stream (50+ Students)
                </span>
              ) : (
                <span className="badge-pill" style={{ background: '#2563eb', color: '#fff' }}>
                  ⚡ WebRTC Video (Max 6)
                </span>
              )}
              {hasAudio && broadcastMode !== 'frame' && <span className="badge-pill audio-pill">🔊 Audio Active</span>}
              <span className="badge-pill viewer-pill">
                👥 {activeCount} Students Watching {queuedCount > 0 ? `(${queuedCount} queued)` : ''}
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
                  {isBroadcasting ? 'Broadcasting to Classroom' : 'Stopped'}
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Mode:</span>
                <span className="stat-value font-bold" style={{ color: broadcastMode === 'frame' ? '#059669' : '#2563eb' }}>
                  {broadcastMode === 'frame' ? 'Classroom Frame Stream' : 'WebRTC Star Mesh'}
                </span>
              </div>
              {broadcastMode === 'frame' ? (
                <>
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
                </>
              ) : (
                <>
                  <div className="stat-row">
                    <span className="stat-label">Active Slots:</span>
                    <span className="stat-value font-bold">{activeCount} / 6</span>
                  </div>
                  {queuedCount > 0 && (
                    <div className="stat-row">
                      <span className="stat-label">Queued Students:</span>
                      <span className="stat-value text-amber-500 font-bold">{queuedCount}</span>
                    </div>
                  )}
                </>
              )}
              <div className="stat-row">
                <span className="stat-label">Audio Transport:</span>
                <span className="stat-value">{hasAudio && broadcastMode !== 'frame' ? 'Included' : 'Visual Stream'}</span>
              </div>
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
                      <span className={`viewer-status-badge ${v.connectionState}`}>
                        {v.status === 'queued'
                          ? '⏳ Queued'
                          : (broadcastMode === 'frame' || v.status === 'watching_frame' || v.connectionState === 'connected')
                          ? '🟢 Watching'
                          : '⏳ Connecting'}
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
