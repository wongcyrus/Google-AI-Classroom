import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  subtitleState: externalSubtitleState,
}) {
  const [viewMode, setViewMode] = useState('docked'); // 'floating' | 'docked' | 'fullscreen' | 'minimized'
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const videoBoxRef = useRef(null);

  const internalSubtitleState = useStudentLiveSubtitles({
    classId: externalSubtitleState ? null : classId,
  });
  const subtitleState = externalSubtitleState || internalSubtitleState;

  // Reset zoom & pan when modal closes or mode switches
  const resetZoom = useCallback(() => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
    setIsDragging(false);
  }, []);

  const handleZoomIn = useCallback(() => {
    setZoomScale((prev) => Math.min(3.0, Math.round((prev + 0.25) * 100) / 100));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomScale((prev) => {
      const next = Math.max(1.0, Math.round((prev - 0.25) * 100) / 100);
      if (next === 1.0) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  // Toggle zoom on double click (Fit <-> 1.75x)
  const handleDoubleClick = useCallback(() => {
    setZoomScale((prev) => {
      if (prev > 1) {
        setPanOffset({ x: 0, y: 0 });
        return 1;
      }
      return 1.75;
    });
  }, []);

  // Mouse wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoomScale((prev) => {
      const next = Math.min(3.0, Math.max(1.0, Math.round((prev + delta) * 100) / 100));
      if (next === 1.0) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  }, []);

  // Drag to pan handlers
  const handleMouseDown = useCallback((e) => {
    if (zoomScale <= 1) return;
    if (e.button !== 0) return; // Left mouse only
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...panOffset };
  }, [zoomScale, panOffset]);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging || zoomScale <= 1) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    // Constrain pan offset based on zoomScale
    const maxOffset = (zoomScale - 1) * 450;
    const nextX = Math.max(-maxOffset, Math.min(maxOffset, panStartRef.current.x + dx));
    const nextY = Math.max(-maxOffset, Math.min(maxOffset, panStartRef.current.y + dy));

    setPanOffset({ x: nextX, y: nextY });
  }, [isDragging, zoomScale]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch handlers for mobile / tablet drag
  const handleTouchStart = useCallback((e) => {
    if (zoomScale <= 1 || e.touches.length !== 1) return;
    setIsDragging(true);
    dragStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    panStartRef.current = { ...panOffset };
  }, [zoomScale, panOffset]);

  const handleTouchMove = useCallback((e) => {
    if (!isDragging || zoomScale <= 1 || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - dragStartRef.current.x;
    const dy = e.touches[0].clientY - dragStartRef.current.y;

    const maxOffset = (zoomScale - 1) * 450;
    const nextX = Math.max(-maxOffset, Math.min(maxOffset, panStartRef.current.x + dx));
    const nextY = Math.max(-maxOffset, Math.min(maxOffset, panStartRef.current.y + dy));

    setPanOffset({ x: nextX, y: nextY });
  }, [isDragging, zoomScale]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Keyboard zoom controls (+, -, 0, Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        handleZoomOut();
      } else if (e.key === '0') {
        e.preventDefault();
        resetZoom();
      } else if (e.key === 'Escape') {
        if (zoomScale > 1) {
          resetZoom();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, zoomScale, handleZoomIn, handleZoomOut, resetZoom, onClose]);

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
                ? '🟢 Live Stream'
                : '⏳ Connecting...'}
            </span>
            {broadcastInfo?.resolution && (
              <span className="badge-pill" style={{ background: '#2563eb', color: '#fff', fontSize: '0.72rem', padding: '1px 7px', borderRadius: '9999px', fontWeight: 700 }}>
                {broadcastInfo.resolution.toUpperCase()}
              </span>
            )}
          </div>

          {/* Center Zoom Toolbar */}
          <div className="stream-zoom-toolbar" role="toolbar" aria-label="Screen Zoom Controls">
            <button
              type="button"
              className="zoom-btn"
              onClick={handleZoomOut}
              disabled={zoomScale <= 1}
              title="Zoom Out (-)"
              aria-label="Zoom Out"
            >
              🔍−
            </button>
            <button
              type="button"
              className={`zoom-scale-badge ${zoomScale > 1 ? 'zoomed' : ''}`}
              onClick={resetZoom}
              title="Click to Reset Zoom (100% Fit)"
              aria-label="Reset Zoom"
            >
              {Math.round(zoomScale * 100)}%
            </button>
            <button
              type="button"
              className="zoom-btn"
              onClick={handleZoomIn}
              disabled={zoomScale >= 3.0}
              title="Zoom In (+)"
              aria-label="Zoom In"
            >
              🔍+
            </button>
            {zoomScale > 1 && (
              <button
                type="button"
                className="zoom-reset-btn"
                onClick={resetZoom}
                title="Fit to Screen (0)"
                aria-label="Fit to Screen"
              >
                ↺ Fit
              </button>
            )}
          </div>

          <div className="stream-header-right">
            {/* Layout Mode Switchers */}
            <div className="view-mode-buttons">
              <button
                className={`mode-btn ${viewMode === 'floating' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('floating');
                  resetZoom();
                }}
                title="Floating Picture-in-Picture"
              >
                🪟 Float
              </button>
              <button
                className={`mode-btn ${viewMode === 'docked' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('docked');
                  resetZoom();
                }}
                title="Standard Modal View"
              >
                🔲 Standard
              </button>
              <button
                className={`mode-btn ${viewMode === 'fullscreen' ? 'active' : ''}`}
                onClick={() => {
                  setViewMode('fullscreen');
                  resetZoom();
                }}
                title="Fullscreen Presentation"
              >
                ⛶ Max
              </button>
              <button
                className="mode-btn"
                onClick={() => {
                  setViewMode('minimized');
                  resetZoom();
                }}
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
        <div
          ref={videoBoxRef}
          className={`teacher-stream-video-box ${zoomScale > 1 ? 'is-zoomed' : ''}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onDoubleClick={handleDoubleClick}
        >
          {liveFrame ? (
            <img
              src={liveFrame}
              alt="Teacher Live Screen"
              className="teacher-live-video"
              draggable={false}
              style={{
                transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                transformOrigin: 'center center',
                transition: isDragging ? 'none' : 'transform 0.12s ease-out',
                cursor: zoomScale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              }}
            />
          ) : (
            <div className="video-loading-state">
              <div className="loading-spinner" />
              <p>Receiving classroom screen broadcast...</p>
            </div>
          )}

          {/* Zoom & Pan Guidance Overlay when Zoomed */}
          {zoomScale > 1 && (
            <div className="zoom-hint-banner">
              <span>💡 Drag to pan screen · Scroll or double-click to zoom</span>
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
