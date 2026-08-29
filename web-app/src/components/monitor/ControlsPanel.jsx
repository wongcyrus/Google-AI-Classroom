import React from 'react';
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
    isAllImagesAnalysisRunning, setIsPerImageAnalysisRunning, 
    setIsAllImagesAnalysisRunning, samplingRate, setSamplingRate,
    storageUsage, storageQuota, storageUsageScreenShots, storageUsageVideos, storageUsageZips,
    aiQuota, aiUsedQuota
}) => {
    const storagePercentage = storageQuota > 0 ? Math.min((storageUsage / storageQuota) * 100, 100) : 0;
    const aiPercentage = aiQuota > 0 ? Math.min((aiUsedQuota / aiQuota) * 100, 100) : 0;

    return (
    <div className="monitor-controls-sidebar">
        <div className="sidebar-top-action">
          <button onClick={() => setShowControls(false)} className="hide-controls-btn">
            ◀ Hide Controls
          </button>
        </div>

        {/* Broadcast Message */}
        <div className="control-section">
            <h4 className="control-section-header">📢 Class Broadcast</h4>
            
            {/* Pre-defined Message Template Dropdown */}
            <div style={{ marginBottom: '8px' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #64748b)', display: 'block', marginBottom: '3px' }}>
                Pre-defined Message Templates:
              </label>
              <select
                aria-label="Pre-defined message templates"
                style={{ width: '100%', fontSize: '0.78rem', padding: '4px 6px', borderRadius: '4px', border: '1px solid var(--color-border, #cbd5e1)' }}
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

        {/* Capture Configuration */}
        <div className="control-section">
            <h4 className="control-section-header">Stream Settings</h4>
            <div className="control-form-grid">
              <div className="control-item">
                <label>View Channel:</label>
                <select value={selectedChannel} onChange={(e) => setSelectedChannel && setSelectedChannel(e.target.value)}>
                  <option value="both">Dual View (Screen + Webcam)</option>
                  <option value="screen">🖥️ Screen Only</option>
                  <option value="webcam">📷 Webcam Only</option>
                </select>
              </div>
              <div className="control-item">
                <label>Frame Interval:</label>
                <select value={frameRate} onChange={handleFrameRateChange}>
                  {frameRateOptions.map(rate => <option key={rate} value={rate}>{rate}s</option>)}
                </select>
              </div>
              <div className="control-item" style={{ gridColumn: 'span 2' }}>
                <label>Max Resolution:</label>
                <select value={maxImageSize} onChange={handleMaxImageSizeChange}>
                  {maxImageSizeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
              </div>
            </div>
        </div>

        {/* Live Controls */}
        <div className="control-section">
            <h4 className="control-section-header">Session Controls</h4>
            <div className="button-vertical-stack">
                <button 
                  onClick={toggleCapture} 
                  className={isCapturing ? "danger-action-btn" : "success-action-btn"}
                >
                  {isCapturing ? '⏹ Stop Capture' : '▶ Start Capture'}
                </button>
                <button 
                  onClick={() => setIsPaused(!isPaused)} 
                  className="secondary-action"
                >
                  {isPaused ? '▶ Resume Stream' : '⏸ Pause Stream'}
                </button>
                <button onClick={() => setShowPromptModal(true)} className="secondary-action">
                  ⚙️ Active Prompt
                </button>
            </div>
        </div>

        {/* Quick Actions */}
        <div className="control-section">
            <h4 className="control-section-header">Attendance & Status</h4>
            <div className="button-vertical-stack">
                <button onClick={() => setShowNotSharingModal(true)} className="outline-action-btn">
                  👀 Not Sharing ({notSharingStudents.length})
                </button>
                <button onClick={handleDownloadAttendance} className="outline-action-btn">
                  📥 Download Attendance
                </button>
            </div>
        </div>

        {/* Resource Usage */}
        <div className="control-section">
            <h4 className="control-section-header">Usage & Quotas</h4>
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
                </div>
            </div>

            <div className="quota-block" style={{ marginTop: '1rem' }}>
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

        {/* AI Analysis Control */}
        {editablePromptText && (
            <div className="control-section highlight-section">
              <h4 className="control-section-header">AI Invigilation / Analysis</h4>
              <div className="button-vertical-stack">
                {!isPerImageAnalysisRunning && !isAllImagesAnalysisRunning && (
                  <>
                    <button onClick={() => setIsPerImageAnalysisRunning(true)} className="ai-action-btn">
                      ✨ Start Per-Image Analysis
                    </button>
                    <button onClick={() => setIsAllImagesAnalysisRunning(true)} className="ai-action-btn">
                      ⚡ Start All-Images Analysis
                    </button>
                  </>
                )}
                {isPerImageAnalysisRunning && (
                  <button onClick={() => setIsPerImageAnalysisRunning(false)} className="danger-action-btn">
                    ⏹ Stop Per-Image Analysis
                  </button>
                )}
                {isAllImagesAnalysisRunning && (
                  <button onClick={() => setIsAllImagesAnalysisRunning(false)} className="danger-action-btn">
                    ⏹ Stop All-Images Analysis
                  </button>
                )}
              </div>

              <div className="interval-slider-group" style={{ marginTop: '0.85rem' }}>
                <label className="slider-label">
                  <span>Analysis Cycle:</span>
                  <strong>{samplingRate}s</strong>
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
            </div>
        )}
    </div>
    );
};

export default React.memo(ControlsPanel);
