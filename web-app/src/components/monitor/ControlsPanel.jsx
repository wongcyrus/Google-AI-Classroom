import React from 'react';
import { formatBytes } from '../../utils/formatters';
import './ControlsPanel.css';

const ControlsPanel = ({ 
    message, setMessage, handleSendMessage, setShowControls, 
    frameRate, handleFrameRateChange, frameRateOptions, 
    maxImageSize, handleMaxImageSizeChange, maxImageSizeOptions,
    isCapturing, toggleCapture, isPaused, setIsPaused, 
    setShowPromptModal, notSharingStudents, setShowNotSharingModal, 
    handleDownloadAttendance, editablePromptText, isPerImageAnalysisRunning, 
    isAllImagesAnalysisRunning, setIsPerImageAnalysisRunning, 
    setIsAllImagesAnalysisRunning, samplingRate, setSamplingRate,
    storageUsage, storageQuota, storageUsageScreenShots, storageUsageVideos, storageUsageZips,
    aiQuota, aiUsedQuota
}) => {
    const storagePercentage = storageQuota > 0 ? (storageUsage / storageQuota) * 100 : 0;
    const aiPercentage = aiQuota > 0 ? (aiUsedQuota / aiQuota) * 100 : 0;

    return (
    <div className="monitor-controls-sidebar">
        <div className="control-item"><button onClick={() => setShowControls(false)} className="hide-controls-btn">Hide Controls</button></div>
        <div className="control-section">
            <div className="control-item">
              <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Broadcast a message" />
            </div>
            <div className="control-item"><button onClick={handleSendMessage}>Send</button></div>
        </div>
        <div className="control-section">
            <div className="control-item">
              <label>Frame Rate (seconds):</label>
              <select value={frameRate} onChange={handleFrameRateChange}>
                {frameRateOptions.map(rate => <option key={rate} value={rate}>{rate}</option>)}
              </select>
            </div>
            <div className="control-item">
              <label>Max Image Size:</label>
              <select value={maxImageSize} onChange={handleMaxImageSizeChange}>
                {maxImageSizeOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
        </div>
        <div className="control-section">
            <div className="control-item"><button onClick={toggleCapture}>{isCapturing ? 'Stop Capture' : 'Start Capture'}</button></div>
            <div className="control-item"><button onClick={() => setIsPaused(!isPaused)}>{isPaused ? 'Resume' : 'Pause'}</button></div>
            <div className="control-item"><button onClick={() => setShowPromptModal(true)} className="secondary-action">Prompt</button></div>
        </div>
        <div className="control-section">
            <div className="control-item"><button onClick={() => setShowNotSharingModal(true)} className="secondary-action">Show Students Not Sharing ({notSharingStudents.length})</button></div>
            <div className="control-item"><button onClick={handleDownloadAttendance} className="secondary-action">Download Attendance</button></div>
        </div>
        <div className="control-section">
            <div className="control-item" style={{width: '100%'}}>
                <label>Storage Usage:</label>
                <div className="storage-info" style={{ width: '100%' }}>
                    <div className="progress-bar-container" style={{ width: '100%', backgroundColor: '#e0e0e0', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                        <div className="progress-bar" style={{ width: `${storagePercentage}%`, backgroundColor: '#4caf50', height: '10px' }}></div>
                    </div>
                    <p className="storage-text" style={{ fontSize: '0.8em', textAlign: 'center', marginTop: '4px' }}>
                        {storageQuota > 0 ? `${formatBytes(storageUsage)} of ${formatBytes(storageQuota)} used` : `${formatBytes(storageUsage)} used`}
                    </p>
                    <div className="storage-breakdown" style={{ fontSize: '0.7em', marginTop: '5px', textAlign: 'center' }}>
                        <p style={{ margin: '2px 0' }}>Screenshots: {formatBytes(storageUsageScreenShots)}</p>
                        <p style={{ margin: '2px 0' }}>Videos: {formatBytes(storageUsageVideos)}</p>
                        <p style={{ margin: '2px 0' }}>Zips: {formatBytes(storageUsageZips)}</p>
                    </div>
                </div>
            </div>
        </div>
        <div className="control-section">
            <div className="control-item" style={{width: '100%'}}>
                <label>AI Budget:</label>
                <div className="storage-info" style={{ width: '100%' }}>
                    <div className="progress-bar-container" style={{ width: '100%', backgroundColor: '#e0e0e0', borderRadius: '4px', height: '10px', overflow: 'hidden' }}>
                        <div className="progress-bar" style={{ width: `${aiPercentage}%`, backgroundColor: '#4caf50', height: '10px' }}></div>
                    </div>
                    <p className="storage-text" style={{ fontSize: '0.8em', textAlign: 'center', marginTop: '4px' }}>
                        {`$${aiUsedQuota.toFixed(2)} of $${aiQuota.toFixed(2)} used`}
                    </p>
                </div>
            </div>
        </div>
        {editablePromptText && (
            <div className="control-section">
              <div className="control-item">
              {!isPerImageAnalysisRunning && !isAllImagesAnalysisRunning && (
                <>
                  <button onClick={() => setIsPerImageAnalysisRunning(true)}>
                    Start Per Image Analysis
                  </button>
                  <button onClick={() => setIsAllImagesAnalysisRunning(true)}>
                    Start All Images Analysis
                  </button>
                </>
              )}
              </div>
              <div className="control-item">
              {isPerImageAnalysisRunning && (
                <button onClick={() => setIsPerImageAnalysisRunning(false)}>
                  Stop Per Image Analysis
                </button>
              )}
              </div>
              <div className="control-item">
              {isAllImagesAnalysisRunning && (
                <button onClick={() => setIsAllImagesAnalysisRunning(false)}>
                  Stop All Images Analysis
                </button>
              )}
              </div>
              <div className="control-item">
              <label>
                Analysis Interval:
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={samplingRate}
                  onChange={(e) => setSamplingRate(Number(e.target.value))}
                />
                {samplingRate}
              </label>
              </div>
            </div>
          )}
    </div>
    )}
;

export default React.memo(ControlsPanel);
