import React, { useState } from 'react';
import Modal from '../Modal';
import { formatBytes, formatAiCost } from '../../utils/formatters';
import './ControlsPanel.css';

const ControlsPanel = ({ 
    message, setMessage, handleSendMessage, setShowControls, 
    frameRate, handleFrameRateChange, frameRateOptions, 
    maxImageSize, handleMaxImageSizeChange, maxImageSizeOptions,
    selectedChannel = 'both', setSelectedChannel,
    isCapturing, toggleCapture, isPaused, setIsPaused, 
    setShowPromptModal, notSharingStudents, setShowNotSharingModal, 
    handleDownloadAttendance, editablePromptText, isPerImageAnalysisRunning, 
    isAllImagesAnalysisRunning, setIsPerImageAnalysisRunning, setIsAllImagesAnalysisRunning,
    samplingRate = 5, setSamplingRate,
    storageUsage, storageQuota, storageUsageScreenShots, storageUsageVideos, storageUsageZips, storageUsageAudio,
    aiQuota, aiUsedQuota,
    selectedAiModel = 'gemini-3.5-flash-lite', handleAiModelChange,
    enableAudioCapture = false, handleAudioCaptureToggle,
    aiMonitoringMode = 'hybrid',
    enableClientAi = true,
    gazeSensitivity = 'standard',
    customYawAngle = 25,
    customPitchDownAngle = -22,
    customPitchUpAngle = 26,
    faceDebounceSeconds = 3, handleFaceDebounceChange,
    enableCloudFallback = false, handleEnableCloudFallbackChange,
    cloudFallbackRate = 3, handleCloudFallbackRateChange,
    handleSaveGazeSettings
}) => {
    const [showGazeModal, setShowGazeModal] = useState(false);

    // Derive current mode with fallback
    const currentMode = (() => {
      if (aiMonitoringMode) return aiMonitoringMode;
      if (enableClientAi === false && !enableCloudFallback) return 'disabled';
      if (enableClientAi === false && enableCloudFallback) return 'cloud_only';
      if (enableClientAi !== false && !enableCloudFallback) return 'client_only';
      return 'hybrid';
    })();

    const [modalAiMonitoringMode, setModalAiMonitoringMode] = useState('hybrid');
    const [modalGazeSensitivity, setModalGazeSensitivity] = useState('standard');
    const [modalCustomYawAngle, setModalCustomYawAngle] = useState(25);
    const [modalCustomPitchDownAngle, setModalCustomPitchDownAngle] = useState(-22);
    const [modalCustomPitchUpAngle, setModalCustomPitchUpAngle] = useState(26);
    const [modalFaceDebounceSeconds, setModalFaceDebounceSeconds] = useState(3);
    const [modalCloudFallbackRate, setModalCloudFallbackRate] = useState(3);

    const openGazeConfigModal = () => {
      setModalAiMonitoringMode(currentMode);
      setModalGazeSensitivity(gazeSensitivity || 'standard');
      setModalCustomYawAngle(customYawAngle !== undefined ? customYawAngle : 25);
      setModalCustomPitchDownAngle(customPitchDownAngle !== undefined ? customPitchDownAngle : -22);
      setModalCustomPitchUpAngle(customPitchUpAngle !== undefined ? customPitchUpAngle : 26);
      setModalFaceDebounceSeconds(faceDebounceSeconds || 3);
      setModalCloudFallbackRate(cloudFallbackRate || 3);
      setShowGazeModal(true);
    };

    const handleApplyGazeSettings = async () => {
      const clientAllowed = modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'client_only';
      const cloudAllowed = modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'cloud_only';

      if (handleSaveGazeSettings) {
        await handleSaveGazeSettings({
          aiMonitoringMode: modalAiMonitoringMode,
          enableClientAi: clientAllowed,
          gazeSensitivity: modalGazeSensitivity,
          customYawAngle: modalCustomYawAngle,
          customPitchDownAngle: modalCustomPitchDownAngle,
          customPitchUpAngle: modalCustomPitchUpAngle,
          faceDebounceSeconds: modalFaceDebounceSeconds,
          enableCloudFallback: cloudAllowed,
          cloudFallbackRate: modalCloudFallbackRate,
        });
      } else {
        if (handleFaceDebounceChange) handleFaceDebounceChange(modalFaceDebounceSeconds);
        if (handleEnableCloudFallbackChange) handleEnableCloudFallbackChange(cloudAllowed);
        if (handleCloudFallbackRateChange) handleCloudFallbackRateChange(modalCloudFallbackRate);
      }
      setShowGazeModal(false);
    };

    const storagePercentage = storageQuota > 0 ? Math.min((storageUsage / storageQuota) * 100, 100) : 0;
    const aiPercentage = aiQuota > 0 ? Math.min((aiUsedQuota / aiQuota) * 100, 100) : 0;

    return (
    <div className="monitor-controls-sidebar">
        <div className="sidebar-top-action">
          <button onClick={() => setShowControls(false)} className="hide-controls-btn">
            ◀ Hide Controls
          </button>
        </div>

        {/* 1. Session & Stream Control */}
        <div className="control-section">
            <h4 className="control-section-header">🎬 Session & Stream</h4>
            <div className="button-vertical-stack">
                <button 
                  onClick={toggleCapture} 
                  className={isCapturing ? "danger-action-btn" : "success-action-btn"}
                  style={{ fontSize: '0.92rem', padding: '0.65rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                >
                  {isCapturing ? '⏹ Stop Capture' : '▶ Start Capture'}
                </button>
                <button 
                  onClick={() => setIsPaused(!isPaused)} 
                  className="secondary-action"
                  style={{ fontSize: '0.85rem', padding: '0.5rem 0.8rem' }}
                >
                  {isPaused ? '▶ Resume Stream' : '⏸ Pause Stream'}
                </button>
            </div>

            <div className="stream-settings-compact" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border, #e2e8f0)' }}>
              <div className="control-form-grid">
                <div className="control-item">
                  <label>Channel:</label>
                  <select value={selectedChannel} onChange={(e) => setSelectedChannel && setSelectedChannel(e.target.value)}>
                    <option value="both">Dual (Screen + Webcam)</option>
                    <option value="screen">🖥️ Screen Only</option>
                    <option value="webcam">📷 Webcam Only</option>
                  </select>
                </div>
                <div className="control-item">
                  <label>🎙️ Audio Stream:</label>
                  <select 
                    value={enableAudioCapture ? 'on' : 'off'} 
                    onChange={(e) => handleAudioCaptureToggle && handleAudioCaptureToggle(e.target.value === 'on')}
                  >
                    <option value="on">🟢 Recording (Segments)</option>
                    <option value="off">🚫 Disabled (Muted)</option>
                  </select>
                </div>
                <div className="control-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  <div className="control-item">
                    <label>Interval:</label>
                    <select value={frameRate} onChange={handleFrameRateChange}>
                      {frameRateOptions.map(rate => <option key={rate} value={rate}>{rate}s</option>)}
                    </select>
                  </div>
                  <div className="control-item">
                    <label>Max Size:</label>
                    <select value={maxImageSize} onChange={handleMaxImageSizeChange}>
                      {maxImageSizeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
        </div>

        {/* 2. Broadcast Announcement */}
        <div className="control-section">
            <h4 className="control-section-header">📢 Class Broadcast</h4>
            
            <div style={{ marginBottom: '6px' }}>
              <select
                aria-label="Pre-defined message templates"
                style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--color-border, #cbd5e1)', background: '#fff' }}
                onChange={(e) => {
                  if (e.target.value) {
                    setMessage(e.target.value);
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Select a pre-defined template...</option>
                <optgroup label="⏰ Time Remaining">
                  <option value="⏰ 15 minutes remaining in test/class.">⏰ 15 minutes remaining</option>
                  <option value="⏰ 10 minutes remaining. Please begin wrapping up.">⏰ 10 minutes remaining</option>
                  <option value="⏰ 5 minutes remaining! Double check your answers.">⏰ 5 minutes remaining</option>
                  <option value="⏰ Time is up! Please submit your work immediately.">⏰ Time is up - submit now</option>
                </optgroup>
                <optgroup label="💻 Screen & Compliance">
                  <option value="💻 Please turn on your screen sharing now.">💻 Please start screen sharing</option>
                  <option value="⚠️ Please close all unauthorized browser tabs and windows.">⚠️ Close unauthorized tabs/apps</option>
                  <option value="🔇 Please ensure your microphone is muted.">🔇 Please mute microphone</option>
                </optgroup>
                <optgroup label="👍 Motivation & Assistance">
                  <option value="👍 Great work everyone, keep going!">👍 Great work, keep going!</option>
                  <option value="✋ Please raise your hand if you need any assistance.">✋ Raise hand for help</option>
                  <option value="⏸️ Feel free to take a 1-minute stretch break.">⏸️ 1-minute stretch break</option>
                </optgroup>
              </select>
            </div>

            <div className="broadcast-input-group">
              <input 
                type="text" 
                value={message} 
                onChange={(e) => setMessage(e.target.value)} 
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="Type message or pick template..." 
              />
              <button onClick={() => handleSendMessage()} className="primary-action-btn">Send</button>
            </div>
        </div>

        {/* 3. AI Monitoring & Invigilation */}
        <div className="control-section highlight-section">
            <h4 className="control-section-header">👁️ AI & Invigilation</h4>

            {/* Gaze Monitoring Status Box */}
            <div style={{ 
              background: currentMode === 'disabled' ? '#fef2f2' : currentMode === 'cloud_only' ? '#eff6ff' : '#f0fdf4', 
              border: `1px solid ${currentMode === 'disabled' ? '#fecaca' : currentMode === 'cloud_only' ? '#bfdbfe' : '#bbf7d0'}`, 
              borderRadius: '8px', 
              padding: '8px 10px', 
              marginBottom: '8px',
              fontSize: '0.8rem'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '3px' }}>
                <span style={{ fontWeight: 600, color: currentMode === 'disabled' ? '#991b1b' : currentMode === 'cloud_only' ? '#1e40af' : '#166534' }}>
                  {currentMode === 'hybrid' && '⚡ Client AI + Fallback'}
                  {currentMode === 'client_only' && '💻 Client AI Only'}
                  {currentMode === 'cloud_only' && '☁️ Cloud AI Only'}
                  {currentMode === 'disabled' && '🚫 AI Disabled'}
                </span>
                {(currentMode === 'hybrid' || currentMode === 'client_only') && (
                  <span style={{ fontSize: '0.72rem', background: 'rgba(0,0,0,0.06)', padding: '1px 5px', borderRadius: '4px', textTransform: 'capitalize' }}>
                    {gazeSensitivity}
                  </span>
                )}
              </div>
              <div style={{ color: '#475569', fontSize: '0.74rem', lineHeight: 1.35 }}>
                {currentMode === 'disabled' ? (
                  'Face & gaze tracking is deactivated.'
                ) : currentMode === 'cloud_only' ? (
                  `Cloud Gemini frame checks (~${(cloudFallbackRate || 3) * 5}s)`
                ) : (
                  gazeSensitivity === 'custom' 
                    ? `Yaw ±${customYawAngle}°, Pitch ${customPitchDownAngle}°/+${customPitchUpAngle}°`
                    : gazeSensitivity === 'relaxed'
                    ? 'Yaw ±28°, Pitch -26°/+30°'
                    : gazeSensitivity === 'strict'
                    ? 'Yaw ±16°, Pitch -16°/+22°'
                    : 'Yaw ±22°, Pitch -20°/+26° (Standard)'
                )}
              </div>
              {currentMode !== 'disabled' && (
                <div style={{ color: '#64748b', fontSize: '0.7rem', marginTop: '3px' }}>
                  Debounce: {faceDebounceSeconds}s {currentMode === 'hybrid' ? `• Fallback: ~${(cloudFallbackRate || 3) * 5}s` : ''}
                </div>
              )}
            </div>

            <button
              type="button"
              className="action-btn"
              style={{
                width: '100%',
                padding: '6px 10px',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: '#4f46e5',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '5px',
                marginBottom: '10px'
              }}
              onClick={openGazeConfigModal}
            >
              ⚙️ Configure Gaze & Mode
            </button>

            {/* Cloud Gemini Multimodal Analysis Controls */}
            <div style={{ paddingTop: '8px', borderTop: '1px solid #e0e7ff' }}>
              <div style={{ marginBottom: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>Gemini Model:</span>
                <span style={{ fontSize: '0.72rem', padding: '1px 6px', background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontWeight: 600 }}>
                  {selectedAiModel === 'gemini-3.7-pro' ? '🔬 3.7 Pro' : selectedAiModel === 'gemini-3.7-flash' ? '🧠 3.7 Flash' : '⚡ 3.5 Flash-Lite'}
                </span>
              </div>

              {editablePromptText ? (
                <>
                  <div className="button-vertical-stack" style={{ gap: '0.45rem' }}>
                    {!isPerImageAnalysisRunning && !isAllImagesAnalysisRunning && (
                      <>
                        <button onClick={() => setIsPerImageAnalysisRunning(true)} className="ai-action-btn" style={{ fontSize: '0.8rem', padding: '6px 8px' }}>
                          ✨ Start Per-Image Analysis
                        </button>
                        <button onClick={() => setIsAllImagesAnalysisRunning(true)} className="ai-action-btn" style={{ fontSize: '0.8rem', padding: '6px 8px' }}>
                          ⚡ Start All-Images Analysis
                        </button>
                      </>
                    )}
                    {isPerImageAnalysisRunning && (
                      <button onClick={() => setIsPerImageAnalysisRunning(false)} className="danger-action-btn" style={{ fontSize: '0.8rem', padding: '6px 8px' }}>
                        ⏹ Stop Per-Image Analysis
                      </button>
                    )}
                    {isAllImagesAnalysisRunning && (
                      <button onClick={() => setIsAllImagesAnalysisRunning(false)} className="danger-action-btn" style={{ fontSize: '0.8rem', padding: '6px 8px' }}>
                        ⏹ Stop All-Images Analysis
                      </button>
                    )}
                  </div>

                  <div className="interval-slider-group" style={{ marginTop: '0.65rem', marginBottom: '0.65rem' }}>
                    <label className="slider-label" style={{ fontSize: '0.75rem' }}>
                      <span>Inspection Interval:</span>
                      <strong>Every {samplingRate} rounds</strong>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={samplingRate}
                      onChange={(e) => setSamplingRate(Number(e.target.value))}
                      className="interval-slider"
                    />
                  </div>

                  <button
                    onClick={() => setShowPromptModal(true)}
                    className="secondary-action"
                    style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px' }}
                  >
                    ⚙️ Change Prompt & Model
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setShowPromptModal(true)} 
                  className="secondary-btn" 
                  style={{ width: '100%', fontSize: '0.8rem', padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px' }}
                >
                  ✨ Select Analysis Prompt
                </button>
              )}
            </div>
        </div>

        {/* 4. Student Attendance & Status */}
        <div className="control-section">
            <h4 className="control-section-header">👥 Attendance & Status</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <button 
                  onClick={() => setShowNotSharingModal(true)} 
                  className="outline-action-btn"
                  style={{ 
                    padding: '6px 8px', 
                    fontSize: '0.78rem',
                    borderColor: notSharingStudents.length > 0 ? '#fca5a5' : undefined,
                    color: notSharingStudents.length > 0 ? '#dc2626' : undefined,
                    background: notSharingStudents.length > 0 ? '#fef2f2' : undefined
                  }}
                >
                  👀 Not Sharing ({notSharingStudents.length})
                </button>
                <button 
                  onClick={handleDownloadAttendance} 
                  className="outline-action-btn"
                  style={{ padding: '6px 8px', fontSize: '0.78rem' }}
                >
                  📥 Download CSV
                </button>
            </div>
        </div>

        {/* 5. Usage & Quotas */}
        <div className="control-section">
            <h4 className="control-section-header">📊 Storage & AI Quotas</h4>
            
            <div className="quota-block">
                <div className="quota-header-row">
                  <span>Storage:</span>
                  <span className="quota-percent">{storagePercentage.toFixed(1)}%</span>
                </div>
                <div className="progress-bar-container">
                    <div 
                      className="progress-bar" 
                      style={{ 
                        width: `${storagePercentage}%`,
                        backgroundColor: storagePercentage > 85 ? '#ef4444' : '#10b981'
                      }}
                    ></div>
                </div>
                <p className="storage-text">
                    {storageQuota > 0 ? `${formatBytes(storageUsage)} of ${formatBytes(storageQuota)}` : `${formatBytes(storageUsage)} used`}
                </p>
                <div className="storage-breakdown">
                    <span>Screenshots: {formatBytes(storageUsageScreenShots)}</span>
                    <span>Videos: {formatBytes(storageUsageVideos)}</span>
                    <span>Zips: {formatBytes(storageUsageZips)}</span>
                    {storageUsageAudio > 0 && <span>Audio: {formatBytes(storageUsageAudio)}</span>}
                </div>
            </div>

            <div className="quota-block" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--color-border, #e2e8f0)' }}>
                <div className="quota-header-row">
                  <span>AI Budget:</span>
                  <span className="quota-percent">{aiPercentage.toFixed(1)}%</span>
                </div>
                <div className="progress-bar-container">
                    <div 
                      className="progress-bar" 
                      style={{ 
                        width: `${aiPercentage}%`,
                        backgroundColor: aiPercentage > 85 ? '#ef4444' : '#6366f1'
                      }}
                    ></div>
                </div>
                <p className="storage-text">
                    {`${formatAiCost(aiUsedQuota)} of $${aiQuota.toFixed(2)} used`}
                </p>
            </div>
        </div>

        {/* Gaze & Invigilation Modal */}
        {showGazeModal && (
          <Modal 
            show={showGazeModal} 
            onClose={() => setShowGazeModal(false)}
            title="👁️ Gaze & Invigilation AI Configuration"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', overflowY: 'auto', paddingRight: '4px' }}>
              <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '6px' }}>
                  AI Face & Gaze Monitoring Mode:
                </label>
                <select
                  value={modalAiMonitoringMode}
                  onChange={(e) => setModalAiMonitoringMode(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                >
                  <option value="hybrid">⚡ Client-side, then fallback to Cloud (Recommended — On-device MediaPipe, fallback to Cloud Gemini)</option>
                  <option value="cloud_only">☁️ Just Cloud (Periodic Cloud Gemini Vision frame inspections)</option>
                  <option value="client_only">💻 Just Client-side (100% Free on-device MediaPipe, zero Cloud quota)</option>
                  <option value="disabled">🚫 Disable it (Turn off all face/gaze AI monitoring)</option>
                </select>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.8rem', color: '#64748b', lineHeight: 1.4 }}>
                  {modalAiMonitoringMode === 'hybrid' && 'Runs real-time face presence and gaze tracking on student machines for free, automatically falling back to Cloud Gemini AI if a student device cannot run local AI.'}
                  {modalAiMonitoringMode === 'cloud_only' && 'Webcam frames are analyzed periodically using Cloud Gemini Vision. Client-side MediaPipe is deactivated.'}
                  {modalAiMonitoringMode === 'client_only' && 'Runs real-time face presence and gaze tracking exclusively on student machines. No cloud vision AI calls or quotas are consumed.'}
                  {modalAiMonitoringMode === 'disabled' && 'Face & Gaze AI monitoring is completely deactivated for this class.'}
                </p>
              </div>

              {(modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'client_only') && (
                <div>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                      Gaze & Head Orientation Sensitivity Mode:
                    </label>
                    <select
                      value={modalGazeSensitivity}
                      onChange={(e) => setModalGazeSensitivity(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                    >
                      <option value="relaxed">🟢 Relaxed / Low Sensitivity (High Tolerance — Yaw ±28°, Pitch -26°/+30°)</option>
                      <option value="standard">🟡 Standard / Balanced Default (Yaw ±22°, Pitch -20°/+26°)</option>
                      <option value="strict">🔴 Strict / High Sensitivity (Yaw ±16°, Pitch -16°/+22°)</option>
                      <option value="custom">⚙️ Custom Manual Angles (Specify exact Yaw & Pitch degrees)</option>
                    </select>
                    <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                      Controls how strictly head rotation and eye deviation off-screen trigger an incident.
                    </p>
                  </div>

                  {modalGazeSensitivity === 'custom' && (
                    <div style={{ background: '#f8fafc', padding: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
                      <h4 style={{ margin: '0 0 10px 0', fontSize: '0.88rem', color: '#1e293b' }}>📐 Custom Angle Limit Sliders</h4>
                      
                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          <span>↔️ Horizontal Yaw Limit (Turn Left / Right)</span>
                          <strong style={{ color: '#4f46e5' }}>±{modalCustomYawAngle}°</strong>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="50"
                          value={modalCustomYawAngle}
                          onChange={(e) => setModalCustomYawAngle(parseInt(e.target.value, 10))}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
                          <span>10° (Strict)</span>
                          <span>50° (Very Relaxed)</span>
                        </div>
                      </div>

                      <div style={{ marginBottom: '12px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          <span>⬇️ Pitch Down Limit (Looking Down)</span>
                          <strong style={{ color: '#4f46e5' }}>{modalCustomPitchDownAngle}°</strong>
                        </div>
                        <input
                          type="range"
                          min="-45"
                          max="-10"
                          value={modalCustomPitchDownAngle}
                          onChange={(e) => setModalCustomPitchDownAngle(parseInt(e.target.value, 10))}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
                          <span>-45° (Very Relaxed)</span>
                          <span>-10° (Strict)</span>
                        </div>
                      </div>

                      <div style={{ marginBottom: '4px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', fontWeight: 600, marginBottom: '4px' }}>
                          <span>⬆️ Pitch Up Limit (Looking Up)</span>
                          <strong style={{ color: '#4f46e5' }}>+{modalCustomPitchUpAngle}°</strong>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="45"
                          value={modalCustomPitchUpAngle}
                          onChange={(e) => setModalCustomPitchUpAngle(parseInt(e.target.value, 10))}
                          style={{ width: '100%' }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#94a3b8' }}>
                          <span>+10° (Strict)</span>
                          <span>+45° (Very Relaxed)</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {modalAiMonitoringMode !== 'disabled' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                    AI Gaze & Absence Debounce Gate:
                  </label>
                  <select
                    value={modalFaceDebounceSeconds}
                    onChange={(e) => setModalFaceDebounceSeconds(parseInt(e.target.value, 10))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                  >
                    <option value={2}>⏱️ 2s (Strict — Rapid Flagging)</option>
                    <option value={3}>⏱️ 3s (Standard — Default Balanced)</option>
                    <option value={5}>⏱️ 5s (Relaxed — Tolerates Brief Glances)</option>
                    <option value={8}>⏱️ 8s (Very Relaxed)</option>
                    <option value={10}>⏱️ 10s (High Tolerance)</option>
                  </select>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    Duration a student must continuously look away or step away from camera before registering an irregularity.
                  </p>
                </div>
              )}

              {(modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'cloud_only') && (
                <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <label style={{ display: 'block', fontSize: '0.88rem', fontWeight: 600, marginBottom: '6px' }}>
                    {modalAiMonitoringMode === 'cloud_only' ? '☁️ Cloud AI Analysis Interval:' : '☁️ Cloud Fallback Analysis Interval:'}
                  </label>
                  <select
                    value={modalCloudFallbackRate}
                    onChange={(e) => setModalCloudFallbackRate(parseInt(e.target.value, 10))}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                  >
                    <option value={1}>⚡ Every 1 round (~5s) — Maximum Responsiveness</option>
                    <option value={2}>⚡ Every 2 rounds (~10s) — Balanced</option>
                    <option value={3}>⚡ Every 3 rounds (~15s) — Default Recommended</option>
                    <option value={5}>⚡ Every 5 rounds (~25s) — Quota Saver</option>
                    <option value={10}>⚡ Every 10 rounds (~50s) — Low Quota Consumption</option>
                  </select>
                  <p style={{ margin: '4px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                    {modalAiMonitoringMode === 'cloud_only'
                      ? 'Interval between Cloud Gemini multimodal video frame inspections.'
                      : 'Analysis frequency for students whose client devices cannot run MediaPipe locally and require cloud Gemini verification.'}
                  </p>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
                <button
                  type="button"
                  onClick={() => setShowGazeModal(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid #cbd5e1',
                    background: '#f8fafc',
                    color: '#475569',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.88rem'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleApplyGazeSettings}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#2563eb',
                    color: '#ffffff',
                    cursor: 'pointer',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                >
                  💾 Save & Apply to Live Class
                </button>
              </div>
            </div>
          </Modal>
        )}
    </div>
    );
};

export default React.memo(ControlsPanel);
