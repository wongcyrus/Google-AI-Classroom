import React, { useEffect } from 'react';
import { useAudioSetup } from '../hooks/useAudioSetup';
import './MicSetupModal.css';

export default function MicSetupModal({
  isOpen,
  onClose,
  onConfirm,
  studentUid = '',
  studentName = '',
  initialDeviceId = '',
  currentMicDeviceId = '',
  mandatory = false,
  isMandatory = false,
}) {
  const isRequired = mandatory || isMandatory;
  const initialId = currentMicDeviceId || initialDeviceId || '';
  const {
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    volumeLevel,
    isMuted,
    error,
    challengePhrase,
    isListeningStt,
    transcript,
    isVerified,
    verificationScore,
    startSttVerification,
    stopSttVerification,
    startStream,
    isRecordingPlayback,
    isPlayingBack,
    startPlaybackTest,
  } = useAudioSetup({ studentUid, studentName, initialDeviceId: initialId });

  // Start stream when modal opens or selectedDeviceId changes
  useEffect(() => {
    if (isOpen) {
      startStream(selectedDeviceId);
    }
  }, [isOpen, selectedDeviceId, startStream]);

  if (!isOpen) return null;

  const handleDeviceChange = (e) => {
    const newId = e.target.value;
    const selectedObj = audioDevices.find(d => d.deviceId === newId);
    console.log('%c[MicSetupModal:DeviceSelect] 🎙️ User selected microphone:', 'background:#2563eb;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
      deviceId: newId || '(default)',
      label: selectedObj?.label || 'Default Microphone',
      availableDevicesCount: audioDevices.length,
    });
    setSelectedDeviceId(newId);
    startStream(newId);
  };

  const handleConfirm = () => {
    const selectedObj = audioDevices.find(d => d.deviceId === selectedDeviceId);
    console.log('%c[MicSetupModal:Confirm] ✅ Microphone confirmed:', 'background:#16a34a;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
      deviceId: selectedDeviceId || '(default)',
      label: selectedObj?.label || 'Default Microphone',
      isVerified,
    });
    onConfirm?.({
      deviceId: selectedDeviceId,
      isVerified,
    });
    onClose?.();
  };

  const getMeterColor = (val) => {
    if (val < 5) return '#94a3b8'; // gray
    if (val < 65) return '#22c55e'; // green
    if (val < 85) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  return (
    <div className="mic-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="mic-modal-title">
      <div className="mic-modal-card">
        <div className="mic-modal-header">
          <div className="mic-header-title">
            <span className="mic-header-icon">🎙️</span>
            <div>
              <h3 id="mic-modal-title">Microphone Setup & Verification</h3>
              <p className="mic-header-subtitle">
                {isRequired
                  ? 'Audio recording is required for this class session. Please verify your microphone.'
                  : 'Test and verify your microphone for clear audio capture.'}
              </p>
            </div>
          </div>
          {!isRequired && (
            <button className="mic-close-btn" onClick={onClose} title="Close">
              ✕
            </button>
          )}
        </div>

        {error && (
          <div className="mic-error-banner" role="alert">
            ⚠️ {error}
          </div>
        )}

        <div className="mic-modal-body">
          {/* 1. Device Selection */}
          <div className="mic-section">
            <label className="mic-section-label" htmlFor="mic-select">
              1. Select Microphone Device
            </label>
            <div className="mic-select-row">
              <select
                id="mic-select"
                className="mic-select"
                value={selectedDeviceId}
                onChange={handleDeviceChange}
                disabled={audioDevices.length === 0}
              >
                {audioDevices.length === 0 ? (
                  <option value="">Default Microphone (No devices listed)</option>
                ) : (
                  audioDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                )}
              </select>
            </div>
          </div>

          {/* 2. Live Volume VU Meter */}
          <div className="mic-section">
            <div className="mic-section-header-flex">
              <span className="mic-section-label">2. Live Volume Level</span>
              <span className="mic-volume-badge" style={{ color: getMeterColor(volumeLevel) }}>
                {volumeLevel > 0 ? `${volumeLevel}%` : 'Muted / Quiet'}
              </span>
            </div>
            <div className="mic-meter-track">
              <div
                className="mic-meter-fill"
                style={{
                  width: `${volumeLevel}%`,
                  backgroundColor: getMeterColor(volumeLevel),
                }}
              />
            </div>
            <div className="mic-meter-marks">
              <span>0%</span>
              <span>Good Range</span>
              <span>100%</span>
            </div>
          </div>

          {/* 3. Spoken Phrase Challenge (STT) */}
          <div className="mic-section mic-challenge-section">
            <div className="mic-section-header-flex">
              <span className="mic-section-label">3. Voice Verification Challenge</span>
              {isVerified && (
                <span className="mic-verified-badge">
                  ✅ Voice Verified ({Math.round(verificationScore * 100)}%)
                </span>
              )}
            </div>
            <p className="mic-instructions">
              Please click <strong>"Test Voice"</strong> and read the phrase below aloud:
            </p>
            <div className="mic-phrase-box">
              "{challengePhrase}"
            </div>

            <div className="mic-stt-controls">
              {!isListeningStt ? (
                <button
                  type="button"
                  className="mic-btn mic-btn-primary"
                  onClick={startSttVerification}
                >
                  ▶ Start Voice Test
                </button>
              ) : (
                <button
                  type="button"
                  className="mic-btn mic-btn-listening"
                  onClick={stopSttVerification}
                >
                  <span className="pulsing-dot" /> Listening... (Click to stop)
                </button>
              )}
            </div>

            {transcript && (
              <div className="mic-transcript-result">
                <strong>Recognized:</strong> "{transcript}"
              </div>
            )}
          </div>

          {/* 4. Hear Yourself Playback Test */}
          <div className="mic-section">
            <span className="mic-section-label">4. Audio Loopback Check</span>
            <p className="mic-instructions">
              Record a 3-second sample to listen to your voice and check audio clarity:
            </p>
            <button
              type="button"
              className="mic-btn mic-btn-secondary"
              onClick={startPlaybackTest}
              disabled={isRecordingPlayback || isPlayingBack}
            >
              {isRecordingPlayback
                ? '🔴 Recording 3s sample...'
                : isPlayingBack
                ? '🔊 Playing back your voice...'
                : '🎧 Hear My Voice (3s Test)'}
            </button>
          </div>
        </div>

        <div className="mic-modal-footer">
          {!mandatory && (
            <button type="button" className="mic-btn mic-btn-cancel" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="mic-btn mic-btn-confirm"
            onClick={handleConfirm}
          >
            {isVerified ? '✅ Confirm & Proceed' : 'Proceed with Microphone'}
          </button>
        </div>
      </div>
    </div>
  );
}
