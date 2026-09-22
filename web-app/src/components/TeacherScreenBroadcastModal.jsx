import React, { useState, useEffect, useRef } from 'react';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';
import { useAudioPrompts } from '../hooks/useAudioPrompts';
import { auth } from '../firebase-config';
import './TeacherScreenBroadcastModal.css';

const RESOLUTION_OPTIONS = [
  {
    id: '1080p',
    title: '1080p (Full HD - Sharp)',
    desc: '1920×1080 · High clarity for programming code & diagrams',
    badge: 'Recommended',
    badgeType: 'primary',
  },
  {
    id: 'native',
    title: 'Native (Original / 2K)',
    desc: 'Full screen capture · Pristine text readability for 4K / Retina displays',
    badge: 'Ultra HD',
    badgeType: 'purple',
  },
  {
    id: '720p',
    title: '720p (HD - Balanced)',
    desc: '1280×720 · Low network latency & lower data transfer',
    badge: 'Fast',
    badgeType: 'success',
  },
  {
    id: '480p',
    title: '480p (SD - Low Data)',
    desc: '854×480 · Minimal bandwidth usage for slow school networks',
    badge: 'Economy',
    badgeType: 'neutral',
  },
];

const FRAMERATE_OPTIONS = [
  { interval: 1000, label: '1.0s / 1 FPS', desc: 'Smooth lecture delivery' },
  { interval: 1500, label: '1.5s / 0.7 FPS', desc: 'Standard balance (Default)' },
  { interval: 2000, label: '2.0s / 0.5 FPS', desc: 'Relaxed classroom viewing' },
  { interval: 3000, label: '3.0s / 0.3 FPS', desc: 'Economy bandwidth mode' },
];

const AVAILABLE_LANGUAGES = [
  { code: 'zh-Hant', label: 'Traditional Chinese (繁體中文)' },
  { code: 'en', label: 'English' },
  { code: 'zh-Hans', label: 'Simplified Chinese (简体中文)' },
  { code: 'ja', label: 'Japanese (日本語)' },
  { code: 'ko', label: 'Korean (한국어)' },
];

export default function TeacherScreenBroadcastModal({
  isOpen,
  onClose,
  initialStep = 1,

  // Screen broadcast state & controls
  screenStream = null,
  lastFrameData = null,
  isBroadcasting = false,
  frameStats = null,
  viewers = [],
  onStartBroadcast = null,
  onStopBroadcast = null,
  broadcastResolution = '1080p',
  broadcastInterval = 1500,
  setBroadcastResolution = null,
  setBroadcastInterval = null,

  // Voice & Subtitles state & controls
  isSubtitlesEnabled = true,
  setIsSubtitlesEnabled = null,
  selectedMicDeviceId = '',
  onSelectMicDeviceId = null,
  teacherSubtitles = null,
  courseContext = '',
  subtitlePrompt = null,
  user = null,
  onSelectSubtitlePrompt = null,
  onSelectCourseContext = null,
  availablePrompts = null,
  onOpenSubtitles = null,

  // Lecture recording
  lectureRecorder = null,
  defaultRecordOnStart = true,
  onOpenRecordings = null,
}) {
  const [step, setStep] = useState(initialStep);
  const [selectedRes, setSelectedRes] = useState(broadcastResolution || '1080p');
  const [selectedInterval, setSelectedInterval] = useState(broadcastInterval || 1500);
  const [recordOnStart, setRecordOnStart] = useState(defaultRecordOnStart !== undefined ? Boolean(defaultRecordOnStart) : true);
  const userToggledRecordRef = useRef(false);
  const [lectureTitle, setLectureTitle] = useState('');
  const [lectureTopic, setLectureTopic] = useState('');
  const [isStarting, setIsStarting] = useState(false);

  // Audio testing state
  const [audioDevices, setAudioDevices] = useState([]);
  const [micVolume, setMicVolume] = useState(0);
  const [micTestError, setMicTestError] = useState(null);

  // Local fallback for prompts
  const fetchedPrompts = useAudioPrompts(user || auth?.currentUser, 'Live Subtitles & Translation');
  const promptsList = availablePrompts || fetchedPrompts || [];
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [customPromptDraft, setCustomPromptDraft] = useState(subtitlePrompt?.promptText || '');

  // Local fallback if setIsSubtitlesEnabled is not provided
  const [localSubtitlesEnabled, setLocalSubtitlesEnabled] = useState(
    isSubtitlesEnabled !== undefined ? Boolean(isSubtitlesEnabled) : true
  );
  const effectiveSubtitlesEnabled = setIsSubtitlesEnabled ? Boolean(isSubtitlesEnabled) : localSubtitlesEnabled;

  useEffect(() => {
    if (isSubtitlesEnabled !== undefined) {
      setLocalSubtitlesEnabled(Boolean(isSubtitlesEnabled));
    }
  }, [isSubtitlesEnabled]);

  // Ensure subtitles default to enabled whenever the studio is opened
  useEffect(() => {
    if (isOpen && !isBroadcasting) {
      if (setIsSubtitlesEnabled && !isSubtitlesEnabled) {
        setIsSubtitlesEnabled(true);
      }
      setLocalSubtitlesEnabled(true);
    }
  }, [isOpen, isBroadcasting, setIsSubtitlesEnabled, isSubtitlesEnabled]);

  const toggleSubtitles = () => {
    if (setIsSubtitlesEnabled) {
      setIsSubtitlesEnabled(!isSubtitlesEnabled);
    } else {
      setLocalSubtitlesEnabled(!localSubtitlesEnabled);
    }
  };

  useEffect(() => {
    setCustomPromptDraft(subtitlePrompt?.promptText || '');
  }, [subtitlePrompt]);

  useEffect(() => {
    setSelectedRes(broadcastResolution || '1080p');
  }, [broadcastResolution]);

  useEffect(() => {
    setSelectedInterval(broadcastInterval || 1500);
  }, [broadcastInterval]);

  useEffect(() => {
    if (initialStep) setStep(initialStep);
  }, [initialStep, isOpen]);

  useEffect(() => {
    if (isOpen) {
      if (!userToggledRecordRef.current) {
        setRecordOnStart(defaultRecordOnStart !== undefined ? Boolean(defaultRecordOnStart) : true);
      }
    } else {
      userToggledRecordRef.current = false;
    }
  }, [isOpen, defaultRecordOnStart]);

  // Enumerate audio input devices when modal is opened
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
        console.warn('[TeacherScreenBroadcastModal] Error loading audio devices:', err);
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

  // Live microphone VU level meter for Step 1 verification
  useEffect(() => {
    if (!isOpen || isBroadcasting) return;
    if (step !== 1) return;

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
          console.warn('[TeacherScreenBroadcastModal] Mic test notice:', err);
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
  }, [isOpen, step, isBroadcasting, selectedMicDeviceId]);

  // Video element preview attachment in Live mode
  const videoRef = useRef(null);
  const attachVideo = (node) => {
    videoRef.current = node;
    if (node && screenStream) {
      if (node.srcObject !== screenStream) {
        node.srcObject = screenStream;
      }
      node.play().catch((err) => {
        console.debug('[TeacherScreenBroadcastModal] video play note:', err);
      });
    }
  };

  useEffect(() => {
    const node = videoRef.current;
    if (!node || !screenStream || !isBroadcasting || !isOpen) return;

    if (node.srcObject !== screenStream) {
      node.srcObject = screenStream;
    }
    node.play().catch((err) => {
      console.debug('[TeacherScreenBroadcastModal] video play note:', err);
    });

    const handleLoadedMetadata = () => {
      node.play().catch(() => {});
    };

    node.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => {
      node.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [screenStream, isBroadcasting, isOpen]);

  if (!isOpen) return null;

  // Unified synchronized start handler
  const handleStart = async () => {
    setIsStarting(true);
    try {
      if (setBroadcastResolution) setBroadcastResolution(selectedRes);
      if (setBroadcastInterval) setBroadcastInterval(selectedInterval);

      if (onStartBroadcast) {
        await onStartBroadcast({
          resolution: selectedRes,
          interval: selectedInterval,
          recordOnStart,
          lectureTitle,
          lectureTopic,
          micDeviceId: selectedMicDeviceId,
          enableSubtitles: effectiveSubtitlesEnabled,
        });
      }
    } catch (err) {
      console.warn('[TeacherScreenBroadcastModal] Start error:', err);
    } finally {
      setIsStarting(false);
    }
  };

  const handleStop = async () => {
    if (onStopBroadcast) {
      await onStopBroadcast();
    }
    if (onClose) {
      onClose();
    }
  };

  const getMeterColor = (val) => {
    if (val < 5) return '#94a3b8';
    if (val < 65) return '#22c55e';
    if (val < 85) return '#eab308';
    return '#ef4444';
  };

  // Subtitle data helpers
  const st = teacherSubtitles || {};
  const currentEngineMode = st.engineMode || 'server';
  const currentSpeechLang = st.speechLanguage || 'zh-HK';
  const currentTargetLangs = st.targetLanguages || ['zh-Hant', 'en'];

  // =============================================================
  // Mode 1: Pre-broadcast 2-Step Setup Wizard (!isBroadcasting)
  // =============================================================
  if (!isBroadcasting) {
    return (
      <div className="broadcast-modal-overlay" onClick={onClose}>
        <div className="broadcast-modal-container broadcast-setup-container" onClick={(e) => e.stopPropagation()}>
          {/* Header */}
          <div className="broadcast-modal-header">
            <div className="broadcast-modal-title">
              <span className="setup-badge-icon">🎙️🖥️</span>
              <div>
                <h3>Broadcast Screen & Voice</h3>
                <p className="setup-subtitle">
                  Configure microphone, live translations, and screen share for your classroom
                </p>
              </div>
            </div>
            <button className="broadcast-close-btn" onClick={onClose} aria-label="Close setup modal">
              ✕
            </button>
          </div>

          {/* Step Progress Tabs (Following Student Readiness Wizard Pattern) */}
          <div className="studio-step-tabs">
            <button
              type="button"
              className={`studio-step-tab ${step === 1 ? 'active' : 'completed'}`}
              onClick={() => setStep(1)}
            >
              1. 🎙️ Voice & Subtitles
            </button>
            <button
              type="button"
              className={`studio-step-tab ${step === 2 ? 'active' : ''}`}
              onClick={() => setStep(2)}
            >
              2. 🖥️ Screen & Recording
            </button>
          </div>

          <div className="broadcast-setup-body">
            {/* ----------------------------------------------------------- */}
            {/* PAGE 1: Voice & Live Subtitles Setup                        */}
            {/* ----------------------------------------------------------- */}
            {step === 1 && (
              <div className="studio-wizard-page page-voice-subtitles">
                {/* Subtitle Broadcast Toggle */}
                <div className="setup-section" style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🌐</span>
                        <span>Live Multilingual Subtitles</span>
                      </div>
                      <p style={{ margin: '2px 0 0 0', fontSize: '0.78rem', color: '#64748b' }}>
                        Broadcast real-time AI speech-to-text and translation to all connected students.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`toggle-broadcast-btn ${effectiveSubtitlesEnabled ? 'active' : ''}`}
                      onClick={toggleSubtitles}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '6px',
                        border: 'none',
                        fontWeight: 700,
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        background: effectiveSubtitlesEnabled ? '#059669' : '#e2e8f0',
                        color: effectiveSubtitlesEnabled ? '#ffffff' : '#334155',
                      }}
                    >
                      {effectiveSubtitlesEnabled ? '🟢 Subtitles ON' : '⚪ Subtitles OFF'}
                    </button>
                  </div>
                </div>

                {/* Audio Input (Microphone) Selection & VU Meter */}
                <div className="setup-section">
                  <label className="setup-section-label" htmlFor="teacher-mic-select">
                    <span className="label-icon">🎙️</span>
                    <span>Audio Input (Microphone) & Level Test</span>
                  </label>
                  <p className="section-desc" style={{ fontSize: '0.78rem', color: '#64748b', margin: '0 0 8px 0' }}>
                    Select your microphone. Test speaking to confirm the live VU volume meter responds.
                  </p>

                  <select
                    id="teacher-mic-select"
                    aria-label="Select Microphone"
                    className="teacher-mic-select"
                    value={selectedMicDeviceId}
                    onChange={(e) => onSelectMicDeviceId?.(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      fontSize: '0.86rem',
                      fontWeight: 600,
                      marginBottom: '10px',
                    }}
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

                  {/* Live Volume Meter */}
                  <div className="mic-meter-card" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '0.78rem' }}>
                      <span style={{ fontWeight: 600, color: '#475569' }}>Live Mic Level</span>
                      <span style={{ color: getMeterColor(micVolume), fontWeight: 700 }}>
                        {micVolume > 0 ? `Active: ${micVolume}%` : 'Quiet / Speak to test'}
                      </span>
                    </div>
                    <div
                      className="mic-meter-track"
                      role="progressbar"
                      aria-valuenow={micVolume}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      style={{ background: '#e2e8f0', height: '8px', borderRadius: '4px', overflow: 'hidden' }}
                    >
                      <div
                        className="mic-meter-fill"
                        style={{
                          width: `${micVolume}%`,
                          height: '100%',
                          backgroundColor: getMeterColor(micVolume),
                          transition: 'width 0.05s ease',
                        }}
                      />
                    </div>
                    {micTestError && (
                      <div style={{ color: '#dc2626', fontSize: '0.76rem', marginTop: '6px' }}>
                        ⚠️ {micTestError}
                      </div>
                    )}
                  </div>
                </div>

                {/* Translation Engine Architecture */}
                <div className="setup-section">
                  <label className="setup-section-label">
                    <span className="label-icon">🤖</span>
                    <span>Translation Model Architecture</span>
                  </label>
                  <div className="engine-card-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                    <label
                      className={`engine-card ${currentEngineMode === 'server' ? 'selected' : ''}`}
                      style={{
                        padding: '10px',
                        border: currentEngineMode === 'server' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: currentEngineMode === 'server' ? '#eef2ff' : '#ffffff',
                      }}
                    >
                      <input
                        type="radio"
                        name="engineMode"
                        value="server"
                        checked={currentEngineMode === 'server'}
                        onChange={() => st.setEngineMode?.('server')}
                        style={{ display: 'none' }}
                      />
                      <strong style={{ fontSize: '0.82rem', color: '#1e293b', display: 'block' }}>🟣 Server Model</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Cloud Functions (Gemini 3.5 Flash-Lite) · 100% Reliable</span>
                    </label>

                    <label
                      className={`engine-card ${currentEngineMode === 'client' ? 'selected' : ''}`}
                      style={{
                        padding: '10px',
                        border: currentEngineMode === 'client' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: currentEngineMode === 'client' ? '#eef2ff' : '#ffffff',
                      }}
                    >
                      <input
                        type="radio"
                        name="engineMode"
                        value="client"
                        checked={currentEngineMode === 'client'}
                        onChange={() => st.setEngineMode?.('client')}
                        style={{ display: 'none' }}
                      />
                      <strong style={{ fontSize: '0.82rem', color: '#1e293b', display: 'block' }}>⚪ Client Model</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>On-device LiteRT Whisper + Chrome Nano ($0 cloud cost)</span>
                    </label>

                    <label
                      className={`engine-card ${currentEngineMode === 'firebase_live' ? 'selected' : ''}`}
                      style={{
                        padding: '10px',
                        border: currentEngineMode === 'firebase_live' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        background: currentEngineMode === 'firebase_live' ? '#eef2ff' : '#ffffff',
                      }}
                    >
                      <input
                        type="radio"
                        name="engineMode"
                        value="firebase_live"
                        checked={currentEngineMode === 'firebase_live'}
                        onChange={() => st.setEngineMode?.('firebase_live')}
                        style={{ display: 'none' }}
                      />
                      <strong style={{ fontSize: '0.82rem', color: '#1e293b', display: 'block' }}>🔴 Gemini Live</strong>
                      <span style={{ fontSize: '0.72rem', color: '#64748b' }}>Bidirectional WebSocket Streaming (Ultra-low latency)</span>
                    </label>
                  </div>
                </div>

                {/* Spoken Language & Target Languages */}
                <div className="setup-section" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div>
                    <label className="setup-section-label" htmlFor="speech-lang-select">
                      <span className="label-icon">🗣️</span>
                      <span>Spoken Speech Language</span>
                    </label>
                    <select
                      id="speech-lang-select"
                      value={currentSpeechLang}
                      onChange={(e) => st.setSpeechLanguage?.(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.82rem',
                      }}
                    >
                      <option value="zh-HK">Cantonese (zh-HK) + English Technical Terms</option>
                      <option value="en-US">English (US)</option>
                      <option value="zh-CN">Mandarin (zh-CN)</option>
                      <option value="ja">Japanese (日本語 ja)</option>
                    </select>
                  </div>

                  <div>
                    <label className="setup-section-label">
                      <span className="label-icon">🌐</span>
                      <span>Target Broadcast Languages</span>
                    </label>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {AVAILABLE_LANGUAGES.map(({ code, label }) => {
                        const checked = currentTargetLangs.includes(code);
                        return (
                          <label
                            key={code}
                            style={{
                              fontSize: '0.74rem',
                              padding: '3px 8px',
                              borderRadius: '4px',
                              border: checked ? '1px solid #4f46e5' : '1px solid #cbd5e1',
                              background: checked ? '#eef2ff' : '#ffffff',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                if (st.setTargetLanguages) {
                                  st.setTargetLanguages((prev) =>
                                    prev.includes(code)
                                      ? (prev.length > 1 ? prev.filter((c) => c !== code) : prev)
                                      : [...prev, code]
                                  );
                                }
                              }}
                            />
                            <span>{label.split(' ')[0]}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Course Subject Domain / AI Prompt */}
                <div className="setup-section" style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                      📚 Subject Domain: <strong>{courseContext || 'Computer Science & Software Development'}</strong>
                    </span>
                    {onSelectSubtitlePrompt && promptsList.length > 0 && (
                      <select
                        aria-label="Translation AI Prompt"
                        value={subtitlePrompt?.id || ''}
                        onChange={(e) => {
                          const found = promptsList.find((p) => p.id === e.target.value);
                          onSelectSubtitlePrompt?.(found || null);
                        }}
                        style={{ fontSize: '0.76rem', padding: '3px 6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                      >
                        <option value="">Default AI Prompt</option>
                        {promptsList.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ----------------------------------------------------------- */}
            {/* PAGE 2: Screen Resolution & Lecture Recording Setup         */}
            {/* ----------------------------------------------------------- */}
            {step === 2 && (
              <div className="studio-wizard-page page-screen-recording">
                {/* Resolution / Image Size Section */}
                <div className="setup-section">
                  <label className="setup-section-label">
                    <span className="label-icon">📺</span>
                    <span>Select Image Size / Resolution</span>
                  </label>
                  <div className="resolution-cards-grid">
                    {RESOLUTION_OPTIONS.map((opt) => {
                      const isSelected = selectedRes === opt.id;
                      return (
                        <div
                          key={opt.id}
                          className={`resolution-card ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedRes(opt.id);
                            if (setBroadcastResolution) setBroadcastResolution(opt.id);
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <div className="card-header-row">
                            <span className="card-title">{opt.title}</span>
                            {opt.badge && (
                              <span className={`card-badge badge-${opt.badgeType}`}>
                                {opt.badge}
                              </span>
                            )}
                          </div>
                          <p className="card-desc">{opt.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Refresh Rate / Frame Rate Section */}
                <div className="setup-section">
                  <label className="setup-section-label">
                    <span className="label-icon">⏱️</span>
                    <span>Select Frame Rate / Refresh Interval</span>
                  </label>
                  <div className="framerate-pills-row">
                    {FRAMERATE_OPTIONS.map((opt) => {
                      const isSelected = selectedInterval === opt.interval;
                      return (
                        <button
                          key={opt.interval}
                          type="button"
                          className={`framerate-pill-btn ${isSelected ? 'selected' : ''}`}
                          onClick={() => {
                            setSelectedInterval(opt.interval);
                            if (setBroadcastInterval) setBroadcastInterval(opt.interval);
                          }}
                        >
                          <span className="pill-primary">{opt.label}</span>
                          <span className="pill-sub">{opt.desc}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Feature Highlights */}
                <div className="setup-highlights-box">
                  <div className="highlight-item">
                    <span className="hl-icon">⚡</span>
                    <span>Low teacher laptop CPU & battery usage</span>
                  </div>
                  <div className="highlight-item">
                    <span className="hl-icon">👥</span>
                    <span>Delivers to 50+ students without WebRTC limits</span>
                  </div>
                  <div className="highlight-item">
                    <span className="hl-icon">🔇</span>
                    <span>No classroom audio echo or feedback loop</span>
                  </div>
                </div>

                {/* Broadcast Mode & Lecture Recording Selector */}
                {lectureRecorder && (
                  <div className="setup-section" style={{ background: '#f8fafc', padding: '14px 16px', borderRadius: '10px', border: '1px solid #e2e8f0', marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ fontWeight: 600, fontSize: '0.92rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>🎥</span>
                        <span>Broadcast Mode &amp; Recording Policy</span>
                      </div>
                      <span
                        style={{
                          fontSize: '0.74rem',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: '999px',
                          backgroundColor: recordOnStart ? '#fee2e2' : '#dbeafe',
                          color: recordOnStart ? '#991b1b' : '#1e40af',
                        }}
                      >
                        {recordOnStart ? '🔴 Mode: Stream & Record' : '📡 Mode: Live Only'}
                      </span>
                    </div>
                    <p style={{ margin: '0 0 12px 0', fontSize: '0.78rem', color: '#64748b' }}>
                      Choose whether this session saves recording archives to Cloud Storage or streams live-only to students without saving.
                    </p>

                    <div className="broadcast-mode-grid">
                      {/* Option 1: Stream & Record */}
                      <div
                        className={`broadcast-mode-card ${recordOnStart ? 'selected-record' : ''}`}
                        onClick={() => {
                          userToggledRecordRef.current = true;
                          setRecordOnStart(true);
                        }}
                        role="radio"
                        aria-checked={recordOnStart}
                        tabIndex={0}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          padding: '12px 14px',
                          borderRadius: '10px',
                          border: recordOnStart ? '2px solid #ef4444' : '1px solid #cbd5e1',
                          backgroundColor: recordOnStart ? '#fef2f2' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>🎥</span>
                            <span>Stream &amp; Record</span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '999px',
                              backgroundColor: recordOnStart ? '#fecaca' : '#f1f5f9',
                              color: recordOnStart ? '#991b1b' : '#64748b',
                            }}
                          >
                            YouTube &amp; CC
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                          Streams live to students + saves HD composite video and pure voice to Cloud Storage for YouTube export and offline AI translation.
                        </p>
                      </div>

                      {/* Option 2: Live Stream Only */}
                      <div
                        className={`broadcast-mode-card ${!recordOnStart ? 'selected-live' : ''}`}
                        onClick={() => {
                          userToggledRecordRef.current = true;
                          setRecordOnStart(false);
                        }}
                        role="radio"
                        aria-checked={!recordOnStart}
                        tabIndex={0}
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          padding: '12px 14px',
                          borderRadius: '10px',
                          border: !recordOnStart ? '2px solid #3b82f6' : '1px solid #cbd5e1',
                          backgroundColor: !recordOnStart ? '#eff6ff' : '#ffffff',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1e293b', display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span>📡</span>
                            <span>Live Stream Only</span>
                          </div>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '2px 6px',
                              borderRadius: '999px',
                              backgroundColor: !recordOnStart ? '#bfdbfe' : '#f1f5f9',
                              color: !recordOnStart ? '#1e40af' : '#64748b',
                            }}
                          >
                            0 Storage / Ephemeral
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748b', lineHeight: 1.4 }}>
                          Streams screen and live voice subtitles directly to student monitors in real-time. No video or audio files are saved to Cloud Storage.
                        </p>
                      </div>
                    </div>

                    {recordOnStart && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '12px' }}>
                        <input
                          type="text"
                          placeholder="Lecture Title (e.g. Unit 4: Cloud Architecture)"
                          value={lectureTitle}
                          onChange={(e) => setLectureTitle(e.target.value)}
                          style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Topic / Tags"
                          value={lectureTopic}
                          onChange={(e) => setLectureTopic(e.target.value)}
                          style={{ padding: '7px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer Navigation */}
          <div className="broadcast-setup-footer">
            {step === 1 ? (
              <>
                {onOpenSubtitles && (
                  <button
                    type="button"
                    className="setup-cancel-btn"
                    onClick={onOpenSubtitles}
                    aria-label="Subtitle Setup"
                  >
                    🎙️ Subtitle Setup
                  </button>
                )}
                <button className="setup-cancel-btn" onClick={onClose}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="setup-start-btn"
                  onClick={() => setStep(2)}
                  style={{ marginLeft: 'auto' }}
                >
                  <span>Next: Screen &amp; Recording Setup</span>
                  <span>➔</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="setup-cancel-btn"
                  onClick={() => setStep(1)}
                  style={{ marginRight: 'auto' }}
                >
                  <span>⬅ Back to Voice Setup</span>
                </button>
                <button className="setup-cancel-btn" onClick={onClose} disabled={isStarting}>
                  Cancel
                </button>
                <button
                  className={`setup-start-btn ${recordOnStart ? 'setup-start-record-btn' : ''}`}
                  onClick={handleStart}
                  disabled={isStarting}
                  aria-label={recordOnStart ? "Start Live Stream and Recording" : "Start Live Stream Only"}
                  title={recordOnStart ? "Start screen sharing, voice subtitles, and HD recording together" : "Start live screen sharing and voice subtitles without saving"}
                  style={recordOnStart ? { backgroundColor: '#dc2626' } : undefined}
                >
                  {isStarting ? (
                    <>
                      <span className="setup-spinner" />
                      <span>Preparing Screen &amp; Voice...</span>
                    </>
                  ) : recordOnStart ? (
                    <>
                      <span>🔴</span>
                      <span>Start Live Stream &amp; Record</span>
                    </>
                  ) : (
                    <>
                      <span>🚀</span>
                      <span>Start Live Stream Only (No Saving)</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =============================================================
  // Mode 2: Active Broadcast Management Dashboard (isBroadcasting)
  // =============================================================
  return (
    <div className="broadcast-modal-overlay" onClick={onClose}>
      <div className="broadcast-modal-container" onClick={(e) => e.stopPropagation()}>
        <div className="broadcast-modal-header">
          <div className="broadcast-modal-title">
            <span className="live-pulse-dot" />
            <h3>🖥️ Live Class Screen Broadcast</h3>
          </div>
          <button className="broadcast-close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        <div className="broadcast-modal-body">
          {/* Main Video Preview Area */}
          <div className="broadcast-preview-container">
            {screenStream ? (
              <video
                ref={attachVideo}
                autoPlay
                playsInline
                muted
                className="broadcast-preview-video"
                poster={lastFrameData || undefined}
                onClick={() => videoRef.current?.play?.().catch(() => {})}
                title="Live Teacher Screen Broadcast (Click to resume preview if paused)"
              />
            ) : lastFrameData ? (
              <img
                src={lastFrameData}
                alt="Teacher broadcast live frame preview"
                className="broadcast-preview-video"
                style={{ objectFit: 'contain' }}
              />
            ) : (
              <div className="broadcast-placeholder">
                <div className="setup-spinner" style={{ margin: '0 auto 12px' }} />
                <p>Waiting for screen stream preview...</p>
              </div>
            )}

            {/* Live Status Overlay Badges */}
            <div className="broadcast-status-badge">
              <span className="badge-pill live-pill">🔴 LIVE</span>
              {lectureRecorder?.isRecording ? (
                <span className="badge-pill" style={{ background: '#dc2626', color: '#fff' }}>
                  🎥 REC ({lectureRecorder.durationFormatted || '00:00'})
                </span>
              ) : (
                <span className="badge-pill" style={{ background: '#475569', color: '#fff' }}>
                  📡 LIVE ONLY (NO SAVING)
                </span>
              )}
              <span className="badge-pill" style={{ background: '#2563eb', color: '#fff' }}>
                📺 {(broadcastResolution || '1080p').toUpperCase()}
              </span>
              <span className="badge-pill" style={{ background: '#059669', color: '#fff' }}>
                🌐 Classroom Stream (50+ Students)
              </span>
              {effectiveSubtitlesEnabled && (
                <span className="badge-pill" style={{ background: '#7c3aed', color: '#fff' }}>
                  🎙️ Subtitles Active
                </span>
              )}
              <span className="badge-pill viewer-pill">
                {`👥 ${viewers.length} ${viewers.length === 1 ? 'Student' : 'Students'} Watching`}
              </span>
            </div>

            {/* Live Real-Time Subtitle Ticker Overlay */}
            {effectiveSubtitlesEnabled && st.latestTranscript && (
              <div
                className="live-subtitles-ticker-strip"
                style={{
                  position: 'absolute',
                  bottom: '48px',
                  left: '12px',
                  right: '12px',
                  background: 'rgba(15, 23, 42, 0.88)',
                  backdropFilter: 'blur(6px)',
                  color: '#ffffff',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  fontSize: '0.84rem',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  zIndex: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#a78bfa', fontWeight: 700 }}>🗣️ {currentSpeechLang}:</span>
                  <span style={{ fontWeight: 600 }}>{st.latestTranscript}</span>
                </div>
                {st.latestTranslations && Object.keys(st.latestTranslations).length > 0 && (
                  <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '8px', fontSize: '0.78rem', color: '#cbd5e1' }}>
                    {Object.entries(st.latestTranslations).map(([lang, text]) => (
                      <div key={lang} style={{ background: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '4px' }}>
                        <span style={{ color: '#67e8f9', fontWeight: 600 }}>{lang}: </span>
                        <span>{text}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Viewers & Info Sidebar */}
          <div className="broadcast-sidebar">
            <div className="broadcast-stats-card">
              <h4>Broadcast Status</h4>
              <div className="stat-row">
                <span className="stat-label">Status:</span>
                <span className="stat-value text-success">
                  Broadcasting to Classroom
                </span>
              </div>
              <div className="stat-row">
                <span className="stat-label">Delivery:</span>
                <span className="stat-value font-bold" style={{ color: '#059669' }}>
                  Classroom Frame Stream
                </span>
              </div>
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

              {/* Dynamic Resolution Tuning */}
              <div className="stat-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                <span className="stat-label">Resolution:</span>
                <select
                  value={broadcastResolution || '1080p'}
                  onChange={(e) => {
                    setBroadcastResolution?.(e.target.value);
                    setSelectedRes(e.target.value);
                  }}
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontWeight: 600,
                  }}
                  title="Change broadcast resolution on the fly"
                >
                  <option value="1080p">1080p (Full HD - Sharp)</option>
                  <option value="native">Native (Original / 2K)</option>
                  <option value="720p">720p (HD - Balanced)</option>
                  <option value="480p">480p (SD - Low Data)</option>
                </select>
              </div>

              {/* Dynamic Refresh Rate Tuning */}
              <div className="stat-row">
                <span className="stat-label">Framerate:</span>
                <select
                  value={broadcastInterval || 1500}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setBroadcastInterval?.(val);
                    setSelectedInterval(val);
                  }}
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 4px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontWeight: 600,
                  }}
                  title="Change refresh interval on the fly"
                >
                  <option value={1000}>1.0s / 1 FPS (Smooth)</option>
                  <option value={1500}>1.5s / 0.7 FPS (Standard)</option>
                  <option value={2000}>2.0s / 0.5 FPS (Relaxed)</option>
                  <option value={3000}>3.0s / 0.3 FPS (Economy)</option>
                </select>
              </div>

              {/* Subtitles Quick Toggle */}
              <div className="stat-row" style={{ marginTop: '4px', paddingTop: '4px', borderTop: '1px solid #e2e8f0' }}>
                <span className="stat-label">Subtitles:</span>
                <button
                  type="button"
                  onClick={onOpenSubtitles ? onOpenSubtitles : toggleSubtitles}
                  style={{
                    fontSize: '0.76rem',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    border: '1px solid #cbd5e1',
                    background: effectiveSubtitlesEnabled ? '#059669' : '#ffffff',
                    color: effectiveSubtitlesEnabled ? '#ffffff' : '#334155',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                  title="Toggle live subtitles and translations"
                >
                  {effectiveSubtitlesEnabled ? '🟢 Live CC Active' : '⚪ CC Disabled'}
                </button>
              </div>
            </div>

            {/* Students Connected Roster */}
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
                      <span className="viewer-status-badge connected">
                        🟢 Watching
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Lecture Recording HUD */}
            {lectureRecorder && (
              <div
                className="lecture-recorder-hud-box"
                style={{
                  margin: '12px 0',
                  padding: '12px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontWeight: 700, fontSize: '0.82rem', color: '#1e293b' }}>
                    🎥 Lecture Recording
                  </span>
                  {lectureRecorder.isRecording && (
                    <span style={{ fontSize: '0.78rem', color: '#dc2626', fontWeight: 700 }}>
                      ● REC {lectureRecorder.durationFormatted}
                    </span>
                  )}
                  {lectureRecorder.isPaused && (
                    <span style={{ fontSize: '0.78rem', color: '#d97706', fontWeight: 700 }}>
                      ⏸️ PAUSED {lectureRecorder.durationFormatted}
                    </span>
                  )}
                  {lectureRecorder.isUploading && (
                    <span style={{ fontSize: '0.78rem', color: '#2563eb', fontWeight: 700 }}>
                      📦 Uploading {lectureRecorder.uploadProgress}%
                    </span>
                  )}
                  {lectureRecorder.recordingState === 'idle' && (
                    <span style={{ fontSize: '0.74rem', color: '#64748b' }}>
                      Ready
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {!lectureRecorder.isRecording && !lectureRecorder.isPaused && !lectureRecorder.isUploading && (
                    <button
                      type="button"
                      onClick={() => lectureRecorder.startRecording({ screenStream })}
                      style={{
                        fontSize: '0.76rem',
                        padding: '5px 10px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#dc2626',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 600,
                        flex: 1,
                      }}
                      title="Start recording HD lecture video and audio for YouTube"
                    >
                      🔴 Start Recording
                    </button>
                  )}

                  {lectureRecorder.isRecording && (
                    <button
                      type="button"
                      onClick={lectureRecorder.pauseRecording}
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      title="Pause recording"
                    >
                      ⏸️ Pause
                    </button>
                  )}

                  {lectureRecorder.isPaused && (
                    <button
                      type="button"
                      onClick={lectureRecorder.resumeRecording}
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      title="Resume recording"
                    >
                      ▶️ Resume
                    </button>
                  )}

                  {(lectureRecorder.isRecording || lectureRecorder.isPaused) && (
                    <button
                      type="button"
                      onClick={lectureRecorder.stopRecording}
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: 'none',
                        background: '#dc2626',
                        color: '#ffffff',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                      title="Finish recording and save to Cloud Storage"
                    >
                      ⏹️ Stop & Save
                    </button>
                  )}

                  {onOpenRecordings && (
                    <button
                      type="button"
                      onClick={onOpenRecordings}
                      style={{
                        fontSize: '0.76rem',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#475569',
                        cursor: 'pointer',
                        fontWeight: 600,
                        marginLeft: 'auto',
                      }}
                      title="View all past lecture recordings and YouTube packages"
                      aria-label="View Past Recordings & YouTube CC"
                    >
                      📂 View Past Recordings & YouTube CC
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Live Broadcast Footer with Stop Sharing Action */}
        <div className="broadcast-modal-footer">
          <button
            type="button"
            className="broadcast-stop-btn"
            onClick={handleStop}
            aria-label="Stop Screen Broadcast"
            title="Stop Screen and Voice Broadcast"
          >
            ⏹ Stop Screen Broadcast
          </button>
        </div>
      </div>
    </div>
  );
}
