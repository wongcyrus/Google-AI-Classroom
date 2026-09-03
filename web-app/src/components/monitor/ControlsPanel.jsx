import React, { useState } from 'react';
import Modal from '../Modal';
import AiCostReportView from '../AiCostReportView';
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
    voiceAiMode = 'hybrid',
    speechLanguage = 'zh-HK',
    audioSegmentDuration = 30,
    audioMovingWindowStride = 15,
    audioSilenceSuppression = true,
    vadSensitivity = 15,
    voiceAiCloudFallbackRate = 3,
    liveAudioPrompt = null,
    audioPrompts = [],
    handleSaveAiSettings,
    handleSaveGazeSettings,
    handleBroadcastPreloadAi,
    classId,
    prompts = [],
    selectedPrompt = null,
    setSelectedPrompt,
    promptFilter = 'all',
    setPromptFilter,
    filteredPrompts = [],
    setEditablePromptText,
    handleRunAnalysis,
    handleRunAllImagesAnalysis,
    isAnalyzing = false
}) => {
    const [showGazeModal, setShowGazeModal] = useState(false);
    const [showAiCostModal, setShowAiCostModal] = useState(false);
    const [isPreloadSent, setIsPreloadSent] = useState(false);
    const [modalConfigTab, setModalConfigTab] = useState('webcam'); // 'webcam' | 'voice' | 'screen'

    // Derive current modes with fallback
    const currentMode = (() => {
      if (aiMonitoringMode) return aiMonitoringMode;
      if (enableClientAi === false && !enableCloudFallback) return 'disabled';
      if (enableClientAi === false && enableCloudFallback) return 'cloud_only';
      if (enableClientAi !== false && !enableCloudFallback) return 'client_only';
      return 'hybrid';
    })();

    const currentVoiceMode = voiceAiMode || 'hybrid';

    // Modal state
    const [modalAiMonitoringMode, setModalAiMonitoringMode] = useState('hybrid');
    const [modalGazeSensitivity, setModalGazeSensitivity] = useState('standard');
    const [modalCustomYawAngle, setModalCustomYawAngle] = useState(25);
    const [modalCustomPitchDownAngle, setModalCustomPitchDownAngle] = useState(-22);
    const [modalCustomPitchUpAngle, setModalCustomPitchUpAngle] = useState(26);
    const [modalFaceDebounceSeconds, setModalFaceDebounceSeconds] = useState(3);
    const [modalCloudFallbackRate, setModalCloudFallbackRate] = useState(3);

    const [modalVoiceAiMode, setModalVoiceAiMode] = useState('hybrid');
    const [modalSpeechLanguage, setModalSpeechLanguage] = useState('zh-HK');
    const [modalAudioSegmentDuration, setModalAudioSegmentDuration] = useState(30);
    const [modalAudioMovingWindowStride, setModalAudioMovingWindowStride] = useState(15);
    const [modalAudioSilenceSuppression, setModalAudioSilenceSuppression] = useState(true);
    const [modalVadSensitivity, setModalVadSensitivity] = useState(15);
    const [modalVoiceAiCloudFallbackRate, setModalVoiceAiCloudFallbackRate] = useState(3);
    const [modalVoicePromptFilter, setModalVoicePromptFilter] = useState('all');
    const [modalSelectedVoicePrompt, setModalSelectedVoicePrompt] = useState(null);
    const [modalEditableVoicePromptText, setModalEditableVoicePromptText] = useState('');
    const [modalSelectedAiModel, setModalSelectedAiModel] = useState('gemini-3.5-flash-lite');
    const [modalSamplingRate, setModalSamplingRate] = useState(5);
    const [modalEditablePromptText, setModalEditablePromptText] = useState('');

    const openGazeConfigModal = () => {
      setModalAiMonitoringMode(currentMode);
      setModalGazeSensitivity(gazeSensitivity || 'standard');
      setModalCustomYawAngle(customYawAngle !== undefined ? customYawAngle : 25);
      setModalCustomPitchDownAngle(customPitchDownAngle !== undefined ? customPitchDownAngle : -22);
      setModalCustomPitchUpAngle(customPitchUpAngle !== undefined ? customPitchUpAngle : 26);
      setModalFaceDebounceSeconds(faceDebounceSeconds || 3);
      setModalCloudFallbackRate(cloudFallbackRate || 3);

      setModalVoiceAiMode(currentVoiceMode);
      setModalSpeechLanguage(speechLanguage || 'zh-HK');
      setModalAudioSegmentDuration(audioSegmentDuration || 30);
      setModalAudioMovingWindowStride(audioMovingWindowStride || 15);
      setModalAudioSilenceSuppression(audioSilenceSuppression !== undefined ? audioSilenceSuppression : true);
      setModalVadSensitivity(vadSensitivity || 15);
      setModalVoiceAiCloudFallbackRate(voiceAiCloudFallbackRate || 3);
      setModalVoicePromptFilter('all');
      setModalSelectedVoicePrompt(liveAudioPrompt || null);
      setModalEditableVoicePromptText(liveAudioPrompt?.promptText || (typeof liveAudioPrompt === 'string' ? liveAudioPrompt : ''));
      setModalSelectedAiModel(selectedAiModel || 'gemini-3.5-flash-lite');
      setModalSamplingRate(samplingRate || 5);
      setModalEditablePromptText(editablePromptText || '');

      setShowGazeModal(true);
    };

    const handleApplyGazeSettings = async () => {
      const clientAllowed = modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'client_only';
      const cloudAllowed = modalAiMonitoringMode === 'hybrid' || modalAiMonitoringMode === 'cloud_only';

      if (setSamplingRate) setSamplingRate(modalSamplingRate);
      if (setEditablePromptText) setEditablePromptText(modalEditablePromptText);
      if (handleAiModelChange) handleAiModelChange(modalSelectedAiModel);

      let finalLiveAudioPrompt = null;
      if (modalSelectedVoicePrompt) {
        const isModified = modalSelectedVoicePrompt.promptText !== modalEditableVoicePromptText;
        finalLiveAudioPrompt = {
          ...modalSelectedVoicePrompt,
          promptText: modalEditableVoicePromptText,
          name: isModified && modalSelectedVoicePrompt.name ? `${modalSelectedVoicePrompt.name} (Customized)` : (modalSelectedVoicePrompt.name || 'Custom Voice Prompt'),
          originalId: modalSelectedVoicePrompt.id || modalSelectedVoicePrompt.originalId,
        };
      } else if (modalEditableVoicePromptText && modalEditableVoicePromptText.trim()) {
        finalLiveAudioPrompt = {
          name: 'Custom Voice Prompt',
          promptText: modalEditableVoicePromptText,
        };
      }

      const saveFn = handleSaveAiSettings || handleSaveGazeSettings;
      if (saveFn) {
        await saveFn({
          // Webcam & Gaze
          aiMonitoringMode: modalAiMonitoringMode,
          enableClientAi: clientAllowed,
          gazeSensitivity: modalGazeSensitivity,
          customYawAngle: modalCustomYawAngle,
          customPitchDownAngle: modalCustomPitchDownAngle,
          customPitchUpAngle: modalCustomPitchUpAngle,
          faceDebounceSeconds: modalFaceDebounceSeconds,
          enableCloudFallback: cloudAllowed,
          cloudFallbackRate: modalCloudFallbackRate,
          // Voice
          voiceAiMode: modalVoiceAiMode,
          speechLanguage: modalSpeechLanguage,
          audioSegmentDuration: modalAudioSegmentDuration,
          audioMovingWindowStride: modalAudioMovingWindowStride,
          audioSilenceSuppression: modalAudioSilenceSuppression,
          vadSensitivity: modalVadSensitivity,
          voiceAiCloudFallbackRate: modalVoiceAiCloudFallbackRate,
          liveAudioPrompt: finalLiveAudioPrompt,
          // Screen / Cloud Model
          selectedAiModel: modalSelectedAiModel,
        });
      } else {
        if (handleFaceDebounceChange) handleFaceDebounceChange(modalFaceDebounceSeconds);
        if (handleEnableCloudFallbackChange) handleEnableCloudFallbackChange(cloudAllowed);
        if (handleCloudFallbackRateChange) handleCloudFallbackRateChange(modalCloudFallbackRate);
        if (handleAiModelChange) handleAiModelChange(modalSelectedAiModel);
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
        <div className="control-section" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h4 className="control-section-header" style={{ margin: 0 }}>🎬 Session & Stream</h4>
              <span style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: '12px',
                background: isCapturing ? (isPaused ? '#fef3c7' : '#dcfce7') : '#f1f5f9',
                color: isCapturing ? (isPaused ? '#92400e' : '#15803d') : '#64748b',
                border: `1px solid ${isCapturing ? (isPaused ? '#fde68a' : '#bbf7d0') : '#e2e8f0'}`,
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}>
                {isCapturing ? (isPaused ? '⏸ Paused' : '🟢 Live Recording') : '⚪ Idle'}
              </span>
            </div>

            {/* Main Action Buttons */}
            {!isCapturing ? (
              <button 
                onClick={toggleCapture} 
                className="success-action-btn"
                style={{ 
                  width: '100%', 
                  fontSize: '0.92rem', 
                  padding: '0.7rem 1rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  gap: '8px', 
                  borderRadius: '8px',
                  boxShadow: '0 2px 4px rgba(16,185,129,0.2)'
                }}
              >
                ▶ Start Capture
              </button>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                <button 
                  onClick={toggleCapture} 
                  className="danger-action-btn"
                  style={{ 
                    fontSize: '0.86rem', 
                    padding: '0.6rem 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '6px', 
                    borderRadius: '6px' 
                  }}
                >
                  ⏹ Stop Capture
                </button>
                <button 
                  onClick={() => setIsPaused(!isPaused)} 
                  className="secondary-action"
                  style={{ 
                    fontSize: '0.86rem', 
                    padding: '0.6rem 0.75rem', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    gap: '6px', 
                    borderRadius: '6px',
                    background: isPaused ? '#eff6ff' : '#ffffff',
                    color: isPaused ? '#1d4ed8' : '#334155',
                    borderColor: isPaused ? '#bfdbfe' : '#cbd5e1'
                  }}
                >
                  {isPaused ? '▶ Resume Stream' : '⏸ Pause Stream'}
                </button>
              </div>
            )}

            {/* Media Stream Channels (Screen, Webcam, Voice) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '2px' }}>
              {/* Channel 1: Video Streams (Screen & Webcam) */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🖥️ Video Channels
                  </label>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Screen & Webcam</span>
                </div>
                <div className="capture-option-group" role="group" aria-label="Video capture channels">
                  {[
                    { value: 'both', label: '🖥️+📷 Dual' },
                    { value: 'screen', label: '🖥️ Screen' },
                    { value: 'webcam', label: '📷 Webcam' },
                  ].map(option => (
                    <button
                      key={option.value}
                      type="button"
                      className={`capture-option-btn ${selectedChannel === option.value ? 'active' : ''}`}
                      aria-pressed={selectedChannel === option.value}
                      onClick={() => setSelectedChannel?.(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Channel 2: Audio Stream (Voice & Mic) */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                    🎙️ Audio Stream
                  </label>
                  <span style={{ fontSize: '0.72rem', color: enableAudioCapture ? '#15803d' : '#94a3b8', fontWeight: 600 }}>
                    {enableAudioCapture ? '🟢 Active' : '🔇 Muted'}
                  </span>
                </div>
                <div className="capture-option-group two-options" role="group" aria-label="Audio capture mode">
                  <button
                    type="button"
                    className={`capture-option-btn ${enableAudioCapture ? 'active' : ''}`}
                    aria-pressed={enableAudioCapture}
                    onClick={() => handleAudioCaptureToggle?.(true)}
                  >
                    🎙️ Record
                  </button>
                  <button
                    type="button"
                    className={`capture-option-btn ${!enableAudioCapture ? 'active muted' : ''}`}
                    aria-pressed={!enableAudioCapture}
                    onClick={() => handleAudioCaptureToggle?.(false)}
                  >
                    🔇 Muted
                  </button>
                </div>
              </div>

              {/* Cadence & Size Settings */}
              <div style={{ background: '#f8fafc', padding: '10px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>
                  ⚡ Cadence & Bandwidth
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 600, marginBottom: '3px' }}>
                      ⏱️ Interval
                    </label>
                    <select 
                      value={frameRate} 
                      onChange={handleFrameRateChange}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#ffffff' }}
                    >
                      {frameRateOptions.map(rate => <option key={rate} value={rate}>{rate}s</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.72rem', color: '#64748b', fontWeight: 600, marginBottom: '3px' }}>
                      📦 Max Size
                    </label>
                    <select 
                      value={maxImageSize} 
                      onChange={handleMaxImageSizeChange}
                      style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.82rem', background: '#ffffff' }}
                    >
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

        {/* 3. AI Monitoring & Invigilation Suite (Webcam, Voice, Screen) */}
        <div className="control-section highlight-section">
            <h4 className="control-section-header">🧠 AI & Invigilation Suite</h4>

            <div style={{
              background: '#f8fafc',
              border: '1px solid #e0e7ff',
              borderRadius: '8px',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {/* Modality 1: 📷 Webcam (Face & Gaze Monitoring) */}
              <div>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>📷 WEBCAM (Face & Gaze):</span>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    background: currentMode === 'disabled' ? '#fee2e2' : currentMode === 'cloud_only' ? '#eff6ff' : '#dcfce7',
                    color: currentMode === 'disabled' ? '#991b1b' : currentMode === 'cloud_only' ? '#1e40af' : '#166534'
                  }}>
                    {currentMode === 'hybrid' && '⚡ MediaPipe + Cloud'}
                    {currentMode === 'client_only' && '💻 MediaPipe Local'}
                    {currentMode === 'cloud_only' && '☁️ Cloud Gemini'}
                    {currentMode === 'disabled' && '🚫 Disabled'}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                  {currentMode === 'disabled' ? 'Face & gaze tracking is deactivated.' : `Sensitivity: ${gazeSensitivity} • Debounce: ${faceDebounceSeconds}s`}
                </div>
              </div>

              {/* Modality 2: 🎙️ Voice & Speech Intelligence (Whisper + Gemma) */}
              <div style={{ paddingTop: '6px', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>🎙️ VOICE (Whisper STT):</span>
                  <span style={{
                    fontSize: '0.7rem',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontWeight: 600,
                    background: currentVoiceMode === 'disabled' ? '#fee2e2' : currentVoiceMode === 'cloud_only' ? '#eff6ff' : '#dbeafe',
                    color: currentVoiceMode === 'disabled' ? '#991b1b' : currentVoiceMode === 'cloud_only' ? '#1e40af' : '#1e40af'
                  }}>
                    {currentVoiceMode === 'hybrid' && '⚡ Whisper + Gemma'}
                    {currentVoiceMode === 'client_only' && '💻 Whisper Local'}
                    {currentVoiceMode === 'cloud_only' && '☁️ Cloud Audio'}
                    {currentVoiceMode === 'disabled' && '🚫 Disabled'}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.7rem' }}>
                  {currentVoiceMode === 'disabled' ? 'Voice STT is deactivated.' : `Stride: ${audioMovingWindowStride || 15}s / ${audioSegmentDuration || 30}s (VAD: ${vadSensitivity || 15}%)`}
                </div>
              </div>

              {/* Modality 3: 🖥️ Screen & Multimodal Vision Analysis */}
              <div style={{ paddingTop: '6px', borderTop: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#334155', marginBottom: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>🖥️ SCREEN (Gemini Vision):</span>
                  <span style={{ fontSize: '0.7rem', padding: '1px 6px', background: '#e0f2fe', color: '#0369a1', borderRadius: '4px', fontWeight: 600 }}>
                    {selectedAiModel === 'gemini-3.7-pro' ? '🔬 3.7 Pro' : selectedAiModel === 'gemini-3.8-flash' ? '⚡ 3.8 Flash' : selectedAiModel === 'gemini-3.7-flash' ? '🧠 3.7 Flash' : '⚡ 3.5 Flash-Lite'}
                  </span>
                </div>
                <div style={{ color: '#64748b', fontSize: '0.7rem', display: 'flex', justifyContent: 'space-between' }}>
                  <span>⏱️ Interval: Every {samplingRate}r (~{samplingRate * (frameRate || 15)}s)</span>
                  <span style={{
                    fontWeight: 600,
                    color: isPerImageAnalysisRunning || isAllImagesAnalysisRunning ? '#16a34a' : '#64748b'
                  }}>
                    {isAllImagesAnalysisRunning ? '⚡ All-Screens Stream' : isPerImageAnalysisRunning ? '✨ Per-Screen Stream' : 'Idle'}
                  </span>
                </div>
              </div>

              {/* Active Screen Stream Stop Button */}
              {(isPerImageAnalysisRunning || isAllImagesAnalysisRunning) && (
                <div style={{ paddingTop: '4px' }}>
                  {isPerImageAnalysisRunning && (
                    <button onClick={() => setIsPerImageAnalysisRunning(false)} className="danger-action-btn" style={{ width: '100%', fontSize: '0.78rem', padding: '5px' }}>
                      ⏹ Stop Per-Image Stream
                    </button>
                  )}
                  {isAllImagesAnalysisRunning && (
                    <button onClick={() => setIsAllImagesAnalysisRunning(false)} className="danger-action-btn" style={{ width: '100%', fontSize: '0.78rem', padding: '5px' }}>
                      ⏹ Stop All-Images Stream
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* AI Suite Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px' }}>
              <button
                type="button"
                className="action-btn"
                style={{
                  width: '100%',
                  padding: '7px 10px',
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
                  gap: '5px'
                }}
                onClick={openGazeConfigModal}
              >
                ⚙️ Configure AI Suite (Webcam, Voice, Screen)
              </button>

              {(currentMode === 'hybrid' || currentMode === 'client_only' || currentVoiceMode === 'hybrid' || currentVoiceMode === 'client_only') && (
                <button
                  type="button"
                  className="action-btn preload-broadcast-btn"
                  style={{
                    width: '100%',
                    padding: '6px 10px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    background: isPreloadSent ? '#059669' : '#0d9488',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '5px',
                    transition: 'background 0.2s ease'
                  }}
                  onClick={async () => {
                    if (handleBroadcastPreloadAi) {
                      await handleBroadcastPreloadAi();
                      setIsPreloadSent(true);
                      setTimeout(() => setIsPreloadSent(false), 3000);
                    }
                  }}
                  title="Preload lightweight on-device models. Gemma 4 E2B remains student-controlled because it is approximately 2 GB."
                >
                  {isPreloadSent ? '✅ Lightweight AI Preload Broadcasted' : '⚡ Preload Lightweight AI for All Students'}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                  <p className="storage-text" style={{ margin: 0 }}>
                    {`${formatAiCost(aiUsedQuota)} of $${aiQuota.toFixed(2)} used`}
                  </p>
                  <button
                    onClick={() => setShowAiCostModal(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#6366f1',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      padding: 0,
                      textDecoration: 'underline'
                    }}
                  >
                    View Breakdown ↗
                  </button>
                </div>
            </div>
        </div>

        {/* AI Cost Report Modal */}
        {showAiCostModal && (
          <Modal
            show={showAiCostModal}
            onClose={() => setShowAiCostModal(false)}
            title="💰 AI Cost Breakdown & Audit"
          >
            <div style={{ maxHeight: '80vh', overflowY: 'auto' }}>
              <AiCostReportView
                classId={classId}
                classQuota={aiQuota}
                onClose={() => setShowAiCostModal(false)}
              />
            </div>
          </Modal>
        )}

        {/* AI Modalities & Invigilation Configuration Modal */}
        {showGazeModal && (
          <Modal 
            show={showGazeModal} 
            onClose={() => setShowGazeModal(false)}
            title="🧠 AI & Invigilation Suite Configuration"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '75vh', overflowY: 'auto', paddingRight: '4px' }}>
              {/* Modality Tabs */}
              <div style={{ display: 'flex', borderBottom: '1px solid #cbd5e1', gap: '4px' }}>
                <button
                  type="button"
                  onClick={() => setModalConfigTab('webcam')}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    borderBottom: modalConfigTab === 'webcam' ? '3px solid #4f46e5' : '3px solid transparent',
                    background: modalConfigTab === 'webcam' ? '#eef2ff' : 'transparent',
                    color: modalConfigTab === 'webcam' ? '#4338ca' : '#64748b',
                    borderRadius: '6px 6px 0 0',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  📷 Webcam & Gaze
                </button>
                <button
                  type="button"
                  onClick={() => setModalConfigTab('voice')}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    borderBottom: modalConfigTab === 'voice' ? '3px solid #4f46e5' : '3px solid transparent',
                    background: modalConfigTab === 'voice' ? '#eef2ff' : 'transparent',
                    color: modalConfigTab === 'voice' ? '#4338ca' : '#64748b',
                    borderRadius: '6px 6px 0 0',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🎙️ Voice & Speech
                </button>
                <button
                  type="button"
                  onClick={() => setModalConfigTab('screen')}
                  style={{
                    padding: '8px 14px',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    border: 'none',
                    borderBottom: modalConfigTab === 'screen' ? '3px solid #4f46e5' : '3px solid transparent',
                    background: modalConfigTab === 'screen' ? '#eef2ff' : 'transparent',
                    color: modalConfigTab === 'screen' ? '#4338ca' : '#64748b',
                    borderRadius: '6px 6px 0 0',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  🖥️ Screen & Vision
                </button>
              </div>

              {/* TAB 1: 📷 WEBCAM & GAZE */}
              {modalConfigTab === 'webcam' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
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
                    <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
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
                </div>
              )}

              {/* TAB 2: 🎙️ VOICE & SPEECH */}
              {modalConfigTab === 'voice' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <label htmlFor="voice-ai-monitoring-mode" style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                      Voice AI Monitoring Mode:
                    </label>
                    <select
                      id="voice-ai-monitoring-mode"
                      value={modalVoiceAiMode}
                      onChange={(e) => setModalVoiceAiMode(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                    >
                      <option value="hybrid">⚡ LiteRT Whisper + Gemma (Recommended — Free on-device STT & collusion reasoning)</option>
                      <option value="client_only">💻 Client LiteRT STT Only (Free on-device transcription without intent evaluation)</option>
                      <option value="cloud_only">☁️ Cloud Gemini Audio (Cloud multimodal audio analysis)</option>
                      <option value="disabled">🚫 Disabled (Deactivate speech recognition & audio AI)</option>
                    </select>
                    <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                      {modalVoiceAiMode === 'hybrid' && 'Transcribes speech locally via Whisper and analyzes conversation intent using LiteRT Gemma on student browsers with cloud fallback.'}
                      {modalVoiceAiMode === 'client_only' && 'Only performs local Whisper STT transcription. Transcripts are sent directly to the monitor view without LLM intent classification.'}
                      {modalVoiceAiMode === 'cloud_only' && 'Transcribes and evaluates audio segments periodically via Gemini Multimodal Audio in the cloud.'}
                      {modalVoiceAiMode === 'disabled' && 'Voice AI processing is deactivated. Audio is captured only for manual teacher playback if audio capture is enabled.'}
                    </p>
                  </div>

                  {modalVoiceAiMode !== 'disabled' && (
                    <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
                      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
                        🌐 Speech AI Language / Trilingual Invigilation:
                      </label>
                      <select
                        value={modalSpeechLanguage}
                        onChange={(e) => setModalSpeechLanguage(e.target.value)}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                      >
                        <option value="zh-HK">🌐 粵語 / 普通話 / English (Trilingual Multilingual Code-Switching — Default)</option>
                        <option value="zh-CN">🇨🇳 普通話 / Mandarin Only</option>
                        <option value="en-US">🇬🇧 / 🇺🇸 English Only</option>
                      </select>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                        Enforced on background audio invigilation across all students automatically without exposing settings to student view.
                      </span>
                    </div>
                  )}

                  {modalVoiceAiMode !== 'disabled' && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                      <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
                          Moving Window Duration:
                        </label>
                        <select
                          value={modalAudioSegmentDuration}
                          onChange={(e) => setModalAudioSegmentDuration(parseInt(e.target.value, 10))}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        >
                          <option value={15}>15 seconds</option>
                          <option value={30}>30 seconds (Default)</option>
                          <option value={45}>45 seconds</option>
                          <option value={60}>60 seconds</option>
                        </select>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                          Context length provided to Whisper/Gemma.
                        </span>
                      </div>

                      <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.82rem', marginBottom: '4px' }}>
                          Moving Window Stride:
                        </label>
                        <select
                          value={modalAudioMovingWindowStride}
                          onChange={(e) => setModalAudioMovingWindowStride(parseInt(e.target.value, 10))}
                          style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        >
                          <option value={5}>⚡ 5s (Rapid Updates)</option>
                          <option value={10}>⚡ 10s (High Cadence)</option>
                          <option value={15}>⚡ 15s (Default Balanced)</option>
                          <option value={20}>⚡ 20s (Relaxed)</option>
                          <option value={30}>⚡ 30s (Stride = Window)</option>
                        </select>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                          Frequency of sliding-window evaluation.
                        </span>
                      </div>
                    </div>
                  )}

                  {modalVoiceAiMode !== 'disabled' && (
                    <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer', marginBottom: '8px' }}>
                        <input
                          type="checkbox"
                          checked={modalAudioSilenceSuppression}
                          onChange={(e) => setModalAudioSilenceSuppression(e.target.checked)}
                          style={{ width: '16px', height: '16px' }}
                        />
                        <span>Silence Suppression (VAD Gating)</span>
                      </label>
                      <p style={{ margin: '0 0 10px 24px', fontSize: '0.76rem', color: '#64748b', lineHeight: 1.35 }}>
                        Suppresses uploading and transcribing silent audio chunks to preserve bandwidth and battery.
                      </p>

                      {modalAudioSilenceSuppression && (
                        <div style={{ marginLeft: '24px', marginTop: '6px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', fontWeight: 600, marginBottom: '4px' }}>
                            <span>VAD Energy Threshold:</span>
                            <strong style={{ color: '#4f46e5' }}>{modalVadSensitivity}%</strong>
                          </div>
                          <input
                            type="range"
                            min="5"
                            max="35"
                            value={modalVadSensitivity}
                            onChange={(e) => setModalVadSensitivity(parseInt(e.target.value, 10))}
                            style={{ width: '100%' }}
                          />
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8' }}>
                            <span>5% (Detect faint whispers)</span>
                            <span>35% (Ignore background noise)</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(modalVoiceAiMode === 'hybrid' || modalVoiceAiMode === 'cloud_only') && (
                    <div style={{ background: '#f8fafc', padding: '12px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '4px' }}>
                        Cloud Audio Fallback Interval:
                      </label>
                      <select
                        value={modalVoiceAiCloudFallbackRate}
                        onChange={(e) => setModalVoiceAiCloudFallbackRate(parseInt(e.target.value, 10))}
                        style={{ width: '100%', padding: '6px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                      >
                        <option value={1}>⚡ Every 1 chunk (~15s) — High Cadence</option>
                        <option value={2}>⚡ Every 2 chunks (~30s) — Balanced</option>
                        <option value={3}>⚡ Every 3 chunks (~45s) — Default Recommended</option>
                        <option value={5}>⚡ Every 5 chunks (~75s) — Quota Saver</option>
                      </select>
                      <span style={{ fontSize: '0.72rem', color: '#64748b', display: 'block', marginTop: '3px' }}>
                        Fallback analysis frequency when client device cannot load Whisper/Gemma.
                      </span>
                    </div>
                  )}

                  {modalVoiceAiMode !== 'disabled' && (
                    <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                      <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                        Select & Edit Voice AI Prompt:
                      </label>

                      {/* Filter Radio */}
                      <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '0.8rem', color: '#475569' }}>
                        {['all', 'public', 'private', 'shared'].map(f => (
                          <label key={f} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', textTransform: 'capitalize' }}>
                            <input
                              type="radio"
                              value={f}
                              name="modalVoicePromptFilter"
                              checked={modalVoicePromptFilter === f}
                              onChange={(e) => setModalVoicePromptFilter(e.target.value)}
                            />
                            {f}
                          </label>
                        ))}
                      </div>

                      {/* Voice Prompt Select */}
                      <select
                        value={modalSelectedVoicePrompt ? modalSelectedVoicePrompt.id : ''}
                        onChange={(e) => {
                          const p = (audioPrompts || []).find(item => item.id === e.target.value);
                          setModalSelectedVoicePrompt(p || null);
                          if (p && p.promptText) {
                            setModalEditableVoicePromptText(p.promptText);
                          }
                        }}
                        style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', marginBottom: '8px' }}
                      >
                        <option value="">-- Select a voice/audio prompt template --</option>
                        {(audioPrompts || [])
                          .filter(p => {
                            if (modalVoicePromptFilter === 'all') return true;
                            if (modalVoicePromptFilter === 'public') return p.accessLevel === 'public';
                            if (modalVoicePromptFilter === 'private') return p.accessLevel === 'private';
                            if (modalVoicePromptFilter === 'shared') return p.accessLevel === 'shared';
                            return true;
                          })
                          .map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                      </select>

                      {/* Placeholder hint chips */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', color: '#64748b', fontWeight: 600 }}>Available Placeholders:</span>
                        {['{{transcript}}', '{{classId}}', '{{studentUid}}', '{{studentEmail}}'].map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => setModalEditableVoicePromptText(prev => prev + (prev.endsWith(' ') || !prev ? '' : ' ') + tag)}
                            style={{
                              fontSize: '0.68rem',
                              padding: '2px 6px',
                              background: '#e0e7ff',
                              color: '#3730a3',
                              border: '1px solid #c7d2fe',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              fontFamily: 'monospace'
                            }}
                            title={`Insert ${tag} into prompt`}
                          >
                            + {tag}
                          </button>
                        ))}
                      </div>

                      {/* Editable Prompt Textarea */}
                      <textarea
                        value={modalEditableVoicePromptText}
                        onChange={(e) => setModalEditableVoicePromptText(e.target.value)}
                        placeholder="Select a voice prompt template or write custom instructions for LiteRT Gemma & Cloud Gemini..."
                        style={{
                          width: '100%',
                          minHeight: '100px',
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.82rem',
                          fontFamily: 'monospace',
                          boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: 🖥️ SCREEN & VISION */}
              {modalConfigTab === 'screen' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {/* Gemini Vision Model Selector */}
                  <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                      Gemini Vision Model:
                    </label>
                    <select
                      value={modalSelectedAiModel}
                      onChange={(e) => setModalSelectedAiModel(e.target.value)}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.88rem' }}
                    >
                      <option value="gemini-3.5-flash-lite">⚡ Gemini 3.5 Flash-Lite ($0.30 / $2.50 per 1M tokens - Fastest)</option>
                      <option value="gemini-3.7-flash">🧠 Gemini 3.7 Flash ($0.75 / $3.75 per 1M tokens - Balanced)</option>
                      <option value="gemini-3.8-flash">⚡ Gemini 3.8 Flash ($0.75 / $3.75 per 1M tokens - Next-Gen)</option>
                      <option value="gemini-3.7-pro">🔬 Gemini 3.7 Pro ($3.00 / $15.00 per 1M tokens - Deep Reasoning)</option>
                    </select>
                    <p style={{ margin: '6px 0 0 0', fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                      Used for periodic student screenshot audits, multi-screen collusion checks, and off-task detection.
                    </p>
                  </div>

                  {/* Inspection Interval Slider & Presets */}
                  <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                      <label style={{ fontSize: '0.88rem', fontWeight: 600, color: '#1e293b' }}>
                        ⏱️ Inspection Interval (Analysis Frequency):
                      </label>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#4f46e5' }}>
                        Every {modalSamplingRate} {modalSamplingRate === 1 ? 'round' : 'rounds'} (~{modalSamplingRate * (frameRate || 15)}s)
                      </span>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={modalSamplingRate}
                      onChange={(e) => setModalSamplingRate(Number(e.target.value))}
                      style={{ width: '100%', accentColor: '#4f46e5' }}
                    />
                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      {[1, 2, 3, 5, 10].map(val => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setModalSamplingRate(val)}
                          style={{
                            flex: 1,
                            padding: '4px 0',
                            fontSize: '0.75rem',
                            borderRadius: '4px',
                            border: modalSamplingRate === val ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                            background: modalSamplingRate === val ? '#ede9fe' : '#ffffff',
                            color: modalSamplingRate === val ? '#4338ca' : '#475569',
                            fontWeight: modalSamplingRate === val ? 700 : 500,
                            cursor: 'pointer'
                          }}
                        >
                          {val}r ({val * (frameRate || 15)}s)
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Prompt Selection & Live Editor */}
                  <div style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: '0.88rem', marginBottom: '6px' }}>
                      Select & Edit Vision AI Prompt:
                    </label>

                    {/* Filter Radio */}
                    <div style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '0.8rem', color: '#475569' }}>
                      {['all', 'public', 'private', 'shared'].map(f => (
                        <label key={f} style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', textTransform: 'capitalize' }}>
                          <input
                            type="radio"
                            value={f}
                            name="modalPromptFilter"
                            checked={(promptFilter || 'all') === f}
                            onChange={(e) => setPromptFilter && setPromptFilter(e.target.value)}
                          />
                          {f}
                        </label>
                      ))}
                    </div>

                    {/* Prompt Select */}
                    <select
                      value={selectedPrompt ? selectedPrompt.id : ''}
                      onChange={(e) => {
                        const p = (prompts || []).find(item => item.id === e.target.value);
                        if (setSelectedPrompt) setSelectedPrompt(p);
                        if (p && p.promptText) {
                          setModalEditablePromptText(p.promptText);
                        }
                      }}
                      style={{ width: '100%', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem', marginBottom: '8px' }}
                    >
                      <option value="" disabled>Select a prompt template...</option>
                      {(filteredPrompts || prompts || []).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>

                    {/* Editable Prompt Textarea */}
                    <textarea
                      value={modalEditablePromptText}
                      onChange={(e) => setModalEditablePromptText(e.target.value)}
                      placeholder="Select a prompt template or write custom instructions for Gemini Vision..."
                      style={{
                        width: '100%',
                        minHeight: '90px',
                        padding: '8px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.82rem',
                        fontFamily: 'inherit',
                        boxSizing: 'border-box'
                      }}
                    />
                  </div>

                  {/* Stream & Run Trigger Controls */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (setEditablePromptText) setEditablePromptText(modalEditablePromptText);
                          if (setSamplingRate) setSamplingRate(modalSamplingRate);
                          if (handleAiModelChange) handleAiModelChange(modalSelectedAiModel);
                          setIsPerImageAnalysisRunning(prev => !prev);
                          if (isAllImagesAnalysisRunning) setIsAllImagesAnalysisRunning(false);
                          setShowGazeModal(false);
                        }}
                        className={isPerImageAnalysisRunning ? 'danger-action-btn' : 'ai-action-btn'}
                        style={{ flex: 1, padding: '8px 10px', fontSize: '0.82rem' }}
                      >
                        {isPerImageAnalysisRunning ? '⏹ Stop Per-Image Stream' : '✨ Start Per-Image Stream'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (setEditablePromptText) setEditablePromptText(modalEditablePromptText);
                          if (setSamplingRate) setSamplingRate(modalSamplingRate);
                          if (handleAiModelChange) handleAiModelChange(modalSelectedAiModel);
                          setIsAllImagesAnalysisRunning(prev => !prev);
                          if (isPerImageAnalysisRunning) setIsPerImageAnalysisRunning(false);
                          setShowGazeModal(false);
                        }}
                        className={isAllImagesAnalysisRunning ? 'danger-action-btn' : 'ai-action-btn'}
                        style={{ flex: 1, padding: '8px 10px', fontSize: '0.82rem' }}
                      >
                        {isAllImagesAnalysisRunning ? '⏹ Stop All-Images Stream' : '⚡ Start All-Images Stream'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {handleRunAnalysis && (
                        <button
                          type="button"
                          onClick={() => {
                            if (setEditablePromptText) setEditablePromptText(modalEditablePromptText);
                            handleRunAnalysis();
                            setShowGazeModal(false);
                          }}
                          disabled={isAnalyzing}
                          className="secondary-btn"
                          style={{ flex: 1, fontSize: '0.78rem', padding: '6px' }}
                        >
                          ▶ Run Single Per-Image Check
                        </button>
                      )}
                      {handleRunAllImagesAnalysis && (
                        <button
                          type="button"
                          onClick={() => {
                            if (setEditablePromptText) setEditablePromptText(modalEditablePromptText);
                            handleRunAllImagesAnalysis();
                            setShowGazeModal(false);
                          }}
                          disabled={isAnalyzing}
                          className="secondary-btn"
                          style={{ flex: 1, fontSize: '0.78rem', padding: '6px' }}
                        >
                          ▶ Run Single All-Images Check
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Modal Footer Actions */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px', paddingTop: '12px', borderTop: '1px solid #e2e8f0' }}>
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
