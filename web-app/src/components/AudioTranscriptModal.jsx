import React, { useRef } from 'react';
import { timeStringToSeconds } from '../utils/transcriptMerger';
import './AudioTranscriptModal.css';

export default function AudioTranscriptModal({
  isOpen,
  onClose,
  studentUid = '',
  studentName = '',
  audioUrl = '',
  snapshotUrl = '',
  transcriptSegments = [],
  transcriptSnippet = '',
  transcript = '',
  riskLevel = 'none',
  classification = 'normal_quiet',
  explanation = '',
}) {
  const audioPlayerRef = useRef(null);

  if (!isOpen) return null;

  const effectiveSegments = (transcriptSegments && transcriptSegments.length > 0)
    ? transcriptSegments
    : (transcriptSnippet || transcript)
      ? [{ id: 'seg-1', speaker: 'Detected Speech', text: transcriptSnippet || transcript, startTime: '00:00', displayStart: '00:00' }]
      : [];

  const handleSeek = (timeStr) => {
    if (!audioPlayerRef.current) return;
    const seconds = timeStringToSeconds(timeStr);
    audioPlayerRef.current.currentTime = seconds;
    try {
      const playPromise = audioPlayerRef.current.play?.();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignore autoplay/playback restrictions in test environments
    }
  };

  const getSpeakerStyleClass = (speaker = '') => {
    const s = speaker.toLowerCase();
    if (s.includes('secondary') || s.includes('unauthorized') || s.includes('speaker 2') || s.includes('collaborator')) {
      return { card: 'speaker-secondary', tag: 'secondary', icon: '🔴' };
    }
    if (s.includes('whisper')) {
      return { card: 'speaker-whisper', tag: 'whisper', icon: '🟡' };
    }
    return { card: 'speaker-student', tag: 'student', icon: '🔵' };
  };

  return (
    <div className="transcript-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="transcript-modal-title">
      <div className="transcript-modal-card">
        {/* Header */}
        <div className="transcript-modal-header">
          <div className="transcript-header-title">
            <span className="transcript-header-icon">🎙️</span>
            <div>
              <h3 id="transcript-modal-title">
                Audio Diarization & Transcript: {studentName || studentUid || 'Student'}
              </h3>
              <p className="transcript-header-subtitle">
                Powered by Gemini 3.5 Transcribe • Multi-Speaker & Exam Chat Detection
              </p>
            </div>
          </div>
          <button className="transcript-close-btn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="transcript-modal-body">
          {/* Summary / Risk Status Banner */}
          <div className={`transcript-summary-bar risk-${riskLevel}`}>
            <div>
              <strong>Classification:</strong> {classification.replace(/_/g, ' ')}
              {explanation && <span> — {explanation}</span>}
            </div>
            <span className={`risk-badge ${riskLevel}`}>
              Risk: {riskLevel}
            </span>
          </div>

          {/* Media Split: Audio Player & Snapshot */}
          <div className="transcript-media-split">
            <div className="transcript-player-col">
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>
                🔊 Audio Recording Playback:
              </label>
              {audioUrl ? (
                <audio ref={audioPlayerRef} controls src={audioUrl}>
                  Your browser does not support audio playback.
                </audio>
              ) : (
                <div style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  No audio stream recording available for this segment.
                </div>
              )}
            </div>

            {snapshotUrl && (
              <div className="transcript-snapshot-col">
                <img
                  src={snapshotUrl}
                  alt="Student webcam snapshot during speech"
                  className="transcript-snapshot-img"
                />
                <span className="transcript-snapshot-label">Webcam snapshot at incident</span>
              </div>
            )}
          </div>

          {/* Dialogue Turns List */}
          <div>
            <h4 style={{ margin: '0.5rem 0', fontSize: '0.95rem', color: '#334155' }}>
              💬 Multi-Speaker Dialogue Timeline:
            </h4>

            {effectiveSegments && effectiveSegments.length > 0 ? (
              <div className="transcript-dialogue-list">
                {effectiveSegments.map((turn, index) => {
                  const style = getSpeakerStyleClass(turn.speaker);
                  const startTime = turn.displayStart || turn.startTime || '00:00';
                  const endTime = turn.displayEnd || turn.endTime || '';

                  return (
                    <div key={turn.id || index} className={`dialogue-turn-card ${style.card}`}>
                      <div className="dialogue-header">
                        <span className={`speaker-tag ${style.tag}`}>
                          {style.icon} {turn.speaker || 'Speaker'}
                        </span>
                        <button
                          type="button"
                          className="turn-timestamp-btn"
                          title="Click to seek audio to this timestamp"
                          onClick={() => handleSeek(turn.startTime || startTime)}
                        >
                          ▶ {startTime} {endTime ? `- ${endTime}` : ''}
                        </button>
                      </div>
                      <p className="dialogue-text">"{turn.text}"</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="transcript-empty-state">
                <p>No speech detected or transcript empty for this session segment.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="transcript-modal-footer">
          <button type="button" className="transcript-btn-close" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
