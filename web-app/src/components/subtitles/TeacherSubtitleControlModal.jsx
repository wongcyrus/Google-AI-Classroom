import React, { useState, useEffect } from 'react';
import { acquireInputDeviceStream } from '../../utils/mediaDeviceCapture';
import { useTranslationPrompts } from '../../hooks/useTranslationPrompts';
import { DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT } from '../../constants/promptRegistry';
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
  isGemmaCached = false,
  isGemmaInitializing = false,
  gemmaUnavailableReason = '',
  onLoadGemmaModel = null,
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
  liveMicVolume = 0,
  activeAudioStream = null,
}) {
  const [audioDevices, setAudioDevices] = useState([]);
  const [micVolume, setMicVolume] = useState(0);
  const [micTestError, setMicTestError] = useState(null);
  const effectiveMicVolume = Math.max(micVolume, Number(liveMicVolume) || 0);

  const fetchedPrompts = useTranslationPrompts(user || auth?.currentUser, 'Live Subtitles & Translation');
  const promptsList = availablePrompts || fetchedPrompts;
  const effectiveSubtitlePrompt = subtitlePrompt || DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT;
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [customPromptDraft, setCustomPromptDraft] = useState(effectiveSubtitlePrompt.promptText || '');

  useEffect(() => {
    setCustomPromptDraft((subtitlePrompt || DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT).promptText || '');
  }, [subtitlePrompt]);

  useEffect(() => {
    if (promptsList && promptsList.length > 0 && subtitlePrompt) {
      if (!subtitlePrompt.promptText) {
        const found = promptsList.find((p) => p.id === subtitlePrompt.id || p.originalId === subtitlePrompt.id || p.id === subtitlePrompt.originalId || p.originalId === subtitlePrompt.originalId);
        if (found && found.promptText) {
          onSelectSubtitlePrompt?.(found);
          setCustomPromptDraft(found.promptText);
        }
      }
    }
  }, [promptsList, subtitlePrompt, onSelectSubtitlePrompt]);

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
    let cleanupResumeListeners = null;

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
        const tryResumeAudioCtx = () => {
          if (audioCtx && (audioCtx.state === 'suspended' || audioCtx.state === 'interrupted')) {
            try {
              const resumePromise = audioCtx.resume?.();
              if (resumePromise && typeof resumePromise.catch === 'function') {
                resumePromise.catch(() => {});
              }
            } catch {}
          }
        };

        // Never `await` audioCtx.resume() here: in Chrome/Safari/iOS WebKit, calling resume()
        // after an async getUserMedia await returns a permanently pending Promise until the next
        // user gesture, which would deadlock startMicMeter before listeners or analyser attach.
        tryResumeAudioCtx();

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
          window.addEventListener('touchstart', tryResumeAudioCtx, { passive: true });
          window.addEventListener('touchend', tryResumeAudioCtx, { passive: true });
          window.addEventListener('pointerdown', tryResumeAudioCtx, { passive: true });
          window.addEventListener('click', tryResumeAudioCtx, { passive: true });
          window.addEventListener('keydown', tryResumeAudioCtx, { passive: true });
          cleanupResumeListeners = () => {
            window.removeEventListener('touchstart', tryResumeAudioCtx);
            window.removeEventListener('touchend', tryResumeAudioCtx);
            window.removeEventListener('pointerdown', tryResumeAudioCtx);
            window.removeEventListener('click', tryResumeAudioCtx);
            window.removeEventListener('keydown', tryResumeAudioCtx);
          };
        }

        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        // On iOS Safari / Chrome (WebKit), MediaStreamAudioSourceNode will not pull audio frames
        // unless connected to audioCtx.destination. Connect via a 0-gain silent node.
        if (
          typeof audioCtx.createGain === 'function' &&
          audioCtx.destination &&
          typeof analyser.connect === 'function'
        ) {
          try {
            const silentGain = audioCtx.createGain();
            if (silentGain?.gain) {
              silentGain.gain.value = 0;
            }
            analyser.connect(silentGain);
            silentGain.connect(audioCtx.destination);
          } catch {}
        }

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const timeDataArray =
          typeof analyser.getByteTimeDomainData === 'function'
            ? new Uint8Array(analyser.fftSize || 256)
            : null;

        const tick = () => {
          if (!isMounted) return;
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const freqPct = Math.min(100, Math.round((avg / 128) * 100));

          let timePct = 0;
          if (timeDataArray && typeof analyser.getByteTimeDomainData === 'function') {
            analyser.getByteTimeDomainData(timeDataArray);
            let sumSq = 0;
            for (let i = 0; i < timeDataArray.length; i++) {
              const norm = (timeDataArray[i] - 128) / 128;
              sumSq += norm * norm;
            }
            const rms = Math.sqrt(sumSq / timeDataArray.length);
            timePct = rms < 0.003 ? 0 : Math.min(100, Math.round(Math.pow(Math.min(1, rms / 0.25), 0.65) * 100));
          }

          const pct = Math.max(freqPct, timePct);
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
      cleanupResumeListeners?.();
      if (animId) cancelAnimationFrame(animId);
      if (stream) {
        stream.getTracks?.().forEach((t) => t.stop());
      }
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
                <span className="mic-meter-badge" style={{ color: getMeterColor(effectiveMicVolume) }}>
                  {effectiveMicVolume > 0 ? `Active: ${effectiveMicVolume}%` : 'Quiet / Speak to test'}
                </span>
              </div>
              <div className="mic-meter-track" role="progressbar" aria-valuenow={effectiveMicVolume} aria-valuemin="0" aria-valuemax="100">
                <div
                  className="mic-meter-fill"
                  style={{
                    width: `${effectiveMicVolume}%`,
                    backgroundColor: getMeterColor(effectiveMicVolume),
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
                      ? `⏳ Downloading Gemma 4 Model (${gemmaProgress}%) · Cloud fallback active`
                      : '⚡ LiteRT.js Active (automatic cloud fallback)'}
                  </span>
                  {engineMode === 'client' &&
                    !isGemmaAvailable &&
                    !(gemmaProgress > 0 && gemmaProgress < 100) &&
                    onLoadGemmaModel && (
                      <div style={{ marginTop: '8px' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onLoadGemmaModel();
                          }}
                          disabled={Boolean(isGemmaInitializing)}
                          style={{
                            padding: '5px 12px',
                            fontSize: '0.76rem',
                            fontWeight: 600,
                            borderRadius: '6px',
                            border: '1px solid #4f46e5',
                            background: '#4f46e5',
                            color: '#ffffff',
                            cursor: isGemmaInitializing ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {isGemmaCached
                            ? '⚡ Load Cached Gemma 4 Model'
                            : '⬇️ Download & Load Gemma 4 (~1.9 GB)'}
                        </button>
                        {gemmaUnavailableReason && (
                          <div style={{ fontSize: '0.72rem', color: '#b45309', marginTop: '4px' }}>
                            ⚠️ {gemmaUnavailableReason}
                          </div>
                        )}
                      </div>
                    )}
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
                    value={subtitlePrompt?.id || subtitlePrompt?.originalId || (subtitlePrompt ? 'custom' : '')}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        onSelectSubtitlePrompt?.(null);
                        setCustomPromptDraft(DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT.promptText);
                        setIsEditingPrompt(false);
                      } else {
                        const found = promptsList.find((p) => p.id === val || p.originalId === val);
                        if (found) {
                          onSelectSubtitlePrompt?.(found);
                          setCustomPromptDraft(found.promptText || '');
                        }
                      }
                    }}
                    className="domain-select"
                  >
                    <option value="">
                      -- Default Discipline Prompt -- ({DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT.name})
                    </option>
                    {promptsList.map((p) => (
                      <option key={p.id || p.originalId} value={p.id || p.originalId}>
                        {p.name}
                      </option>
                    ))}
                    {subtitlePrompt && !promptsList.some((p) => (p.id && (p.id === subtitlePrompt.id || p.id === subtitlePrompt.originalId)) || (p.originalId && (p.originalId === subtitlePrompt.id || p.originalId === subtitlePrompt.originalId))) && (
                      <option value="custom">{subtitlePrompt.name || 'Custom Prompt'}</option>
                    )}
                  </select>
                </div>
              </div>

              {(subtitlePrompt?.promptText || customPromptDraft) ? (
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
                        onClick={() => {
                          onSelectSubtitlePrompt?.(null);
                          setCustomPromptDraft(DEFAULT_LIVE_SUBTITLE_TRANSLATION_PROMPT.promptText);
                          setIsEditingPrompt(false);
                        }}
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
                            name: subtitlePrompt?.name?.includes('(Customized)')
                              ? subtitlePrompt.name
                              : `${subtitlePrompt?.name || 'Translation Prompt'} (Customized)`,
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
                      "{((subtitlePrompt?.promptText || customPromptDraft || '').length > 140)
                        ? `${(subtitlePrompt?.promptText || customPromptDraft || '').substring(0, 140)}...`
                        : (subtitlePrompt?.promptText || customPromptDraft || '')}"
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
