import React, { useState, useEffect } from 'react';
import { acquireInputDeviceStream } from '../../utils/mediaDeviceCapture';
import { useAudioPrompts } from '../../hooks/useAudioPrompts';
import { auth } from '../../firebase-config';
import './TeacherSubtitleControlModal.css';

const AVAILABLE_LANGUAGES = [
  { code: 'zh-Hant', label: 'Traditional Chinese (繁體中文)' },
  { code: 'en', label: 'English' },
  { code: 'zh-Hans', label: 'Simplified Chinese (简体中文)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' },
];

export default function TeacherSubtitleControlModal({
  isOpen,
  onClose,
  enabled,
  onToggleEnabled,
  engineMode,
  onSelectEngineMode,
  speechLanguage,
  onSelectSpeechLanguage,
  targetLanguages,
  onToggleTargetLanguage,
  isNanoAvailable,
  isGemmaAvailable,
  gemmaProgress = 0,
  latestTranscript,
  latestTranslations = {},
  status,
  error,
  liveUsageStats,
  languagePairStatuses = {},
  selectedMicDeviceId = '',
  onSelectMicDeviceId,
  courseContext = '',
  subtitlePrompt = null,
  user = null,
  onSelectSubtitlePrompt = null,
  onSelectCourseContext = null,
  availablePrompts = null,
}) {
  const [audioDevices, setAudioDevices] = useState([]);
  const [micVolume, setMicVolume] = useState(0);
  const [micTestError, setMicTestError] = useState(null);

  const fetchedPrompts = useAudioPrompts(user || auth?.currentUser, 'Live Subtitles & Translation');
  const promptsList = availablePrompts || fetchedPrompts;
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [customPromptDraft, setCustomPromptDraft] = useState(subtitlePrompt?.promptText || '');

  useEffect(() => {
    setCustomPromptDraft(subtitlePrompt?.promptText || '');
  }, [subtitlePrompt]);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    const loadDevices = async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const mics = devices
          .filter((d) => d.kind === 'audioinput')
          .map((d, i) => ({
            deviceId: d.deviceId,
            label: d.label || (i === 0 ? 'Default Microphone' : `Microphone ${i + 1}`),
          }));
        if (isMounted) {
          setAudioDevices(mics);
          if (mics.length > 0 && !selectedMicDeviceId && onSelectMicDeviceId) {
            onSelectMicDeviceId(mics[0].deviceId);
          }
        }
      } catch (err) {
        console.warn('[TeacherSubtitleControlModal] Error loading audio devices:', err);
      }
    };

    loadDevices();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', loadDevices);
      return () => {
        isMounted = false;
        navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
      };
    }
  }, [isOpen, selectedMicDeviceId, onSelectMicDeviceId]);

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    let stream = null;
    let audioCtx = null;
    let animId = null;

    const startMicMeter = async () => {
      try {
        setMicTestError(null);
        stream = await acquireInputDeviceStream('audio', selectedMicDeviceId, {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        });

        if (!isMounted) {
          stream?.getTracks?.().forEach((t) => t.stop());
          return;
        }

        const tracks = stream?.getAudioTracks?.() || [];
        if (tracks.length === 0) {
          setMicTestError('Selected microphone has no audio track.');
          return;
        }

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        audioCtx = new AudioCtx();
        if (audioCtx.state === 'suspended') {
          await audioCtx.resume().catch(() => {});
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          if (!isMounted) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const pct = Math.min(100, Math.round((avg / 128) * 100));
          setMicVolume(pct);
          animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);
      } catch (err) {
        if (isMounted) {
          console.warn('[TeacherSubtitleControlModal] Mic test notice:', err);
          setMicTestError(err.message || 'Unable to access microphone.');
        }
      }
    };

    startMicMeter();

    return () => {
      isMounted = false;
      if (animId) cancelAnimationFrame(animId);
      if (stream) stream.getTracks?.().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
      setMicVolume(0);
    };
  }, [isOpen, selectedMicDeviceId]);

  const getMeterColor = (val) => {
    if (val < 5) return '#94a3b8'; // gray
    if (val < 65) return '#22c55e'; // green
    if (val < 85) return '#eab308'; // yellow
    return '#ef4444'; // red
  };

  if (!isOpen) return null;

  return (
    <div className="teacher-subtitle-modal-backdrop" onClick={onClose}>
      <div
        className="teacher-subtitle-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="subtitle-modal-title"
      >
        <div className="teacher-subtitle-modal-header">
          <div className="title-group">
            <span className="modal-icon">🎙️</span>
            <h3 id="subtitle-modal-title">Live Classroom Subtitles & Multilingual Translation</h3>
          </div>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="teacher-subtitle-modal-body">
          {/* Main Broadcast Switch */}
          <div className="teacher-subtitle-section broadcast-toggle-section">
            <div className="section-label-group">
              <span className="section-title">Subtitle Broadcast Status</span>
              <span className="section-desc">
                When enabled, real-time bilingual subtitles are broadcast to all attending students.
              </span>
            </div>
            <button
              type="button"
              className={`toggle-broadcast-btn ${enabled ? 'active' : ''}`}
              onClick={onToggleEnabled}
            >
              {enabled ? '🔴 Stop Subtitle Broadcast' : '🟢 Start Subtitle Broadcast'}
            </button>
          </div>

          {/* Microphone Device Selection & Live Audio Test */}
          <div className="teacher-subtitle-section">
            <div className="section-label-group">
              <label className="section-title" htmlFor="teacher-mic-select">
                🎙️ Audio Input (Microphone)
              </label>
              <span className="section-desc">
                Select your microphone to capture speech for live subtitles.
              </span>
            </div>

            <div className="mic-select-container">
              <select
                id="teacher-mic-select"
                aria-label="Select Microphone"
                className="teacher-mic-select"
                value={selectedMicDeviceId}
                onChange={(e) => onSelectMicDeviceId?.(e.target.value)}
              >
                {audioDevices.length > 0 ? (
                  audioDevices.map((d, index) => (
                    <option key={d.deviceId || index} value={d.deviceId}>
                      {d.label || `Microphone ${index + 1}`}
                    </option>
                  ))
                ) : (
                  <option value="">Default Microphone</option>
                )}
              </select>
            </div>

            {/* Live Volume Meter */}
            <div className="mic-meter-card">
              <div className="mic-meter-header">
                <span className="mic-meter-label">Live Input Level</span>
                <span className="mic-meter-badge" style={{ color: getMeterColor(micVolume) }}>
                  {micVolume > 0 ? `Active: ${micVolume}%` : 'Quiet / Speak to test'}
                </span>
              </div>
              <div className="mic-meter-track" role="progressbar" aria-valuenow={micVolume} aria-valuemin="0" aria-valuemax="100">
                <div
                  className="mic-meter-fill"
                  style={{
                    width: `${micVolume}%`,
                    backgroundColor: getMeterColor(micVolume),
                  }}
                />
              </div>
              {micTestError && (
                <div className="mic-test-error">⚠️ {micTestError}</div>
              )}
            </div>
          </div>

          {/* Model Selection (Server vs Client LiteRT.js) */}
          <div className="teacher-subtitle-section">
            <span className="section-title">🤖 Translation Model Architecture</span>
            <span className="section-desc">
              Speech-to-Text (STT) uses local on-device LiteRT Whisper with high-accuracy multilingual translation.
            </span>

            <div className="engine-card-group">
              <label
                className={`engine-card ${engineMode === 'server' ? 'selected' : ''}`}
              >
                <div className="engine-card-header">
                  <input
                    type="radio"
                    name="engineMode"
                    value="server"
                    checked={engineMode === 'server'}
                    onChange={() => onSelectEngineMode('server')}
                  />
                  <span className="engine-badge server-badge">🟣 Server Model (Recommended · 100% Reliable)</span>
                </div>
                <div className="engine-card-body">
                  <strong>Cloud Functions (Gemini 3.5 Flash-Lite / 3.8 Flash)</strong>
                  <p>High-accuracy multilingual output, preserving code syntax and technical terminology.</p>
                  <span className="server-status">⚡ 100% cross-platform support (Windows, macOS, Linux, Chrome & Edge) · ~$0.01 per lecture</span>
                </div>
              </label>

              <label
                className={`engine-card ${engineMode === 'client' ? 'selected' : ''}`}
              >
                <div className="engine-card-header">
                  <input
                    type="radio"
                    name="engineMode"
                    value="client"
                    checked={engineMode === 'client'}
                    onChange={() => onSelectEngineMode('client')}
                  />
                  <span className="engine-badge client-badge">⚪ Client Model (LiteRT.js + Gemma 4 · On-Device)</span>
                </div>
                <div className="engine-card-body">
                  <strong>LiteRT.js (Whisper STT + Gemma 4 E2B)</strong>
                  <p>100% on-device STT (LiteRT Whisper) + on-device translation (LiteRT.js Gemma 4 E2B). Ultra-low latency, $0 cloud cost, full privacy with automatic server fallback.</p>
                  <span className="nano-status">
                    {isGemmaAvailable
                      ? '✅ On-Device Gemma 4 Ready'
                      : gemmaProgress > 0 && gemmaProgress < 100
                      ? `⏳ Downloading Gemma 4 Model (${gemmaProgress}%)...`
                      : '⚡ LiteRT.js Active (automatic cloud fallback)'}
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Spoken Language */}
          <div className="teacher-subtitle-section">
            <label className="section-title" htmlFor="speech-lang-select">
              🗣️ Spoken Speech Language
            </label>
            <select
              id="speech-lang-select"
              className="speech-lang-select"
              value={speechLanguage}
              onChange={(e) => onSelectSpeechLanguage(e.target.value)}
            >
              <option value="zh-HK">Cantonese (zh-HK) + English Technical Terms</option>
              <option value="en-US">English (US)</option>
              <option value="zh-CN">Mandarin (zh-CN)</option>
              <option value="ja">Japanese (日本語 ja)</option>
            </select>
          </div>

          {/* Target Languages */}
          <div className="teacher-subtitle-section">
            <span className="section-title">🌐 Target Broadcast Languages</span>
            <div className="target-lang-grid">
              {AVAILABLE_LANGUAGES.map(({ code, label }) => {
                const checked = targetLanguages.includes(code);
                const pairInfo = languagePairStatuses?.[code];
                const pairStatus = pairInfo?.status;

                return (
                  <label key={code} className="target-lang-item">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleTargetLanguage(code)}
                    />
                    <div className="lang-label-group">
                      <span>{label}</span>
                      {engineMode === 'client' && pairStatus && (
                        <span className={`pair-pill pair-pill-${pairStatus}`} data-testid={`pair-pill-${code}`}>
                          {pairStatus === 'readily' && '✅ Ready'}
                          {pairStatus === 'after-download' && '⬇️ Download Required'}
                          {(pairStatus === 'no' || pairStatus === 'unsupported' || pairStatus === 'same-language') && '⚠️ Cloud Fallback'}
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
            {engineMode === 'client' && (
              <div className="engine-client-note">
                💡 Client mode: Supported languages are translated on-device. Unsupported or pending languages automatically fallback to cloud translation to prevent interruptions.
              </div>
            )}
          </div>

          {/* Subject Discipline & Translation AI Prompt Context */}
          <div className="teacher-subtitle-section domain-prompt-section" data-testid="domain-prompt-section">
            <span className="section-title">📚 Course Subject Domain & Translation AI Prompt</span>
            <span className="section-desc">
              Contextual terminology rules and AI prompt steering live speech-to-text and translation. Configure directly for this session and class.
            </span>
            <div className="domain-prompt-card">
              <div className="domain-info-row">
                <span className="domain-badge">
                  🎓 Subject: <strong>{courseContext || 'Computer Science & Software Development'}</strong>
                </span>
                {subtitlePrompt && (
                  <span className="prompt-badge">
                    ✨ Prompt: <strong>{subtitlePrompt.name || 'Custom Prompt'}</strong>
                  </span>
                )}
              </div>

              {/* Quick Configuration Controls */}
              <div className="domain-prompt-controls">
                <div className="domain-config-field">
                  <label htmlFor="modal-course-context-select" className="domain-field-label">Discipline Domain</label>
                  <select
                    id="modal-course-context-select"
                    aria-label="Course Subject Domain"
                    value={courseContext || 'Computer Science & Software Development'}
                    onChange={(e) => onSelectCourseContext?.(e.target.value)}
                    className="domain-select"
                  >
                    <option value="Computer Science & Software Development">💻 Computer Science & Software Development</option>
                    <option value="Business, Finance & Accounting">💼 Business, Finance & Accounting</option>
                    <option value="Design, Media & Visual Arts">🎨 Design, Media & Visual Arts</option>
                    <option value="Healthcare, Nursing & Medical Sciences">🏥 Healthcare, Nursing & Medical Sciences</option>
                    <option value="Engineering & Construction">⚙️ Engineering & Construction</option>
                    <option value="Hospitality, Culinary & Tourism">🍳 Hospitality, Culinary & Tourism</option>
                    <option value="Languages, Humanities & Social Sciences">📚 Languages, Humanities & Social Sciences</option>
                    <option value="General Studies & Interdisciplinary">🎓 General Studies & Interdisciplinary</option>
                    {courseContext && ![
                      'Computer Science & Software Development',
                      'Business, Finance & Accounting',
                      'Design, Media & Visual Arts',
                      'Healthcare, Nursing & Medical Sciences',
                      'Engineering & Construction',
                      'Hospitality, Culinary & Tourism',
                      'Languages, Humanities & Social Sciences',
                      'General Studies & Interdisciplinary',
                    ].includes(courseContext) && (
                      <option value={courseContext}>✏️ {courseContext}</option>
                    )}
                  </select>
                </div>

                <div className="domain-config-field">
                  <label htmlFor="modal-subtitle-prompt-select" className="domain-field-label">Translation AI Prompt (Library)</label>
                  <select
                    id="modal-subtitle-prompt-select"
                    aria-label="Translation AI Prompt"
                    value={subtitlePrompt?.id || (subtitlePrompt ? 'custom' : '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        onSelectSubtitlePrompt?.(null);
                        setIsEditingPrompt(false);
                      } else {
                        const found = promptsList.find((p) => p.id === val);
                        if (found) {
                          onSelectSubtitlePrompt?.(found);
                          setCustomPromptDraft(found.promptText || '');
                        }
                      }
                    }}
                    className="domain-select"
                  >
                    <option value="">-- Default Discipline Prompt --</option>
                    {promptsList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                    {subtitlePrompt && !promptsList.some((p) => p.id === subtitlePrompt.id) && (
                      <option value="custom">{subtitlePrompt.name || 'Custom Prompt'}</option>
                    )}
                  </select>
                </div>
              </div>

              {subtitlePrompt?.promptText ? (
                <div className="prompt-preview-container">
                  <div className="prompt-details-header">
                    <span className="prompt-name-tag">Prompt Instructions Preview:</span>
                    <div className="prompt-actions-inline">
                      <button
                        type="button"
                        className="prompt-toggle-btn"
                        onClick={() => setIsEditingPrompt(!isEditingPrompt)}
                      >
                        {isEditingPrompt ? 'Close Editor' : '✏️ Edit Prompt'}
                      </button>
                      <button
                        type="button"
                        className="prompt-toggle-btn reset"
                        onClick={() => onSelectSubtitlePrompt?.(null)}
                      >
                        Reset to Default
                      </button>
                    </div>
                  </div>

                  {isEditingPrompt ? (
                    <div className="prompt-editor-box">
                      <textarea
                        className="modal-prompt-textarea"
                        aria-label="Edit Translation Prompt Instructions"
                        value={customPromptDraft}
                        onChange={(e) => setCustomPromptDraft(e.target.value)}
                        rows={5}
                        placeholder="Enter custom prompt instructions or domain terms..."
                      />
                      <button
                        type="button"
                        className="prompt-apply-btn"
                        onClick={() => {
                          onSelectSubtitlePrompt?.({
                            ...subtitlePrompt,
                            name: subtitlePrompt.name?.includes('(Customized)')
                              ? subtitlePrompt.name
                              : `${subtitlePrompt.name || 'Translation Prompt'} (Customized)`,
                            promptText: customPromptDraft,
                          });
                          setIsEditingPrompt(false);
                        }}
                      >
                        Apply Custom Instructions
                      </button>
                    </div>
                  ) : (
                    <div className="prompt-preview-snippet">
                      "{subtitlePrompt.promptText.length > 140
                        ? `${subtitlePrompt.promptText.substring(0, 140)}...`
                        : subtitlePrompt.promptText}"
                    </div>
                  )}
                </div>
              ) : (
                <div className="domain-hint-text">
                  Using default discipline context. You can select a pre-configured translation prompt from the prompt library above or customize instructions in <strong>Class Management ➔ 8. Live Subtitles, Translation &amp; Subject Domain</strong>.
                </div>
              )}
            </div>
          </div>

          {/* Live Preview Ticker */}
          {enabled && (
            <div className="teacher-subtitle-section live-preview-section">
              <span className="section-title">👀 Live Preview (Ticker)</span>
              <div className="live-preview-box">
                <div className="preview-row">
                  <span className="preview-tag">Recognized Speech:</span>
                  <span className="preview-text">
                    {latestTranscript || '(Listening for speech...)'}
                  </span>
                </div>
                <div className="preview-row">
                  <span className="preview-tag target">Translation Preview:</span>
                  <span className="preview-text translated">
                    {latestTranslations?.['zh-Hant'] ||
                     latestTranslations?.['en'] ||
                     Object.values(latestTranslations || {})[0] ||
                     (latestTranscript ? '(Translating...)' : '(Waiting for speech...)')}
                  </span>
                </div>
              </div>
            </div>
          )}

          {error && <div className="error-alert">⚠️ {error}</div>}
        </div>

        <div className="teacher-subtitle-modal-footer">
          <button type="button" className="footer-btn primary" onClick={onClose}>
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
}
