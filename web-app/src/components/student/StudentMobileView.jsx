import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { db, functions, auth } from '../../firebase-config';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { signOut } from 'firebase/auth';
import { useStudentClassSchedule } from '../../hooks/useStudentClassSchedule';
import useTeacherScreenBroadcastStudent from '../../hooks/useTeacherScreenBroadcastStudent';
import { useStudentLiveSubtitles } from '../../hooks/useStudentLiveSubtitles';
import BingoModal from '../BingoModal';
import PasskeyPairModal from '../passkey/PasskeyPairModal';
import './StudentMobileView.css';

export default function StudentMobileView({ user, onSwitchToDesktop }) {
  const navigate = useNavigate();
  const [showPasskeyModal, setShowPasskeyModal] = useState(false);
  // Mobile View Mode: 'overlay' (Screen & Overlap CC), 'screen' (Screen Only), 'cc' (CC Only)
  const [mobileViewMode, setMobileViewMode] = useState(() => {
    try {
      const saved = localStorage.getItem('student_mobile_mode');
      if (saved === 'overlay' || saved === 'screen' || saved === 'slide' || saved === 'cc') {
        return saved === 'slide' ? 'screen' : saved;
      }
    } catch {
      // ignore
    }
    return 'overlay';
  });

  // YouTube-style CC Toggle in Screen & CC mode
  const [isCcEnabled, setIsCcEnabled] = useState(true);

  const handleSetViewMode = (mode) => {
    setMobileViewMode(mode);
    try {
      localStorage.setItem('student_mobile_mode', mode);
    } catch {
      // ignore
    }
  };

  // 1. Class Schedule & Enrolled Classes Selection
  const { userClasses, currentActiveClassId, activeClassIds } = useStudentClassSchedule(user);
  const [isManualScheduleOverride, setIsManualScheduleOverride] = useState(() => {
    try {
      return localStorage.getItem('isManualScheduleOverride') === 'true';
    } catch {
      return false;
    }
  });
  const [selectedClassId, setSelectedClassId] = useState(() => {
    try {
      return localStorage.getItem('selectedStudentClassId') || '';
    } catch {
      return '';
    }
  });

  const activeClass = useMemo(() => {
    if (isManualScheduleOverride && selectedClassId && userClasses?.some(c => (typeof c === 'string' ? c : c.id) === selectedClassId)) {
      return selectedClassId;
    }
    if (currentActiveClassId) return currentActiveClassId;
    if (selectedClassId && userClasses?.some(c => (typeof c === 'string' ? c : c.id) === selectedClassId)) {
      return selectedClassId;
    }
    if (userClasses && userClasses.length > 0) {
      const first = userClasses[0];
      return typeof first === 'string' ? first : (first?.id || null);
    }
    return null;
  }, [isManualScheduleOverride, selectedClassId, currentActiveClassId, userClasses]);

  const activeClassName = useMemo(() => {
    if (!activeClass || !userClasses) return 'Google AI Classroom';
    const found = userClasses.find(c => (typeof c === 'string' ? c : c.id) === activeClass);
    return (typeof found === 'object' ? found?.name : found) || activeClass;
  }, [activeClass, userClasses]);

  const handleSelectClass = (e) => {
    const id = e.target.value;
    setSelectedClassId(id);
    setIsManualScheduleOverride(true);
    try {
      localStorage.setItem('selectedStudentClassId', id);
      localStorage.setItem('isManualScheduleOverride', 'true');
    } catch {
      // ignore storage errors
    }
  };

  const handleFollowSchedule = () => {
    setIsManualScheduleOverride(false);
    try {
      localStorage.setItem('isManualScheduleOverride', 'false');
    } catch {
      // ignore storage errors
    }
  };

  // 2. Feature 1: Teacher Screen Broadcast (Screen Sharing)
  const {
    isBroadcastActive,
    broadcastInfo,
    liveFrame,
    connectionState,
    joinBroadcast,
  } = useTeacherScreenBroadcastStudent({
    classId: activeClass,
    studentUid: user?.uid,
    studentEmail: user?.email,
  });

  // Auto-join broadcast if active
  useEffect(() => {
    if (isBroadcastActive && activeClass && user?.uid && connectionState === 'idle') {
      joinBroadcast();
    }
  }, [isBroadcastActive, activeClass, user?.uid, connectionState, joinBroadcast]);

  // Touch zoom & pan state for mobile screen viewer
  const [zoomScale, setZoomScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isLandscapeFullscreen, setIsLandscapeFullscreen] = useState(false);
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth > window.innerHeight;
  });

  useEffect(() => {
    const handleOrientation = () => {
      if (typeof window !== 'undefined') {
        const landscape = window.innerWidth > window.innerHeight;
        setIsLandscape(landscape);
      }
    };
    window.addEventListener('resize', handleOrientation);
    window.addEventListener('orientationchange', handleOrientation);
    return () => {
      window.removeEventListener('resize', handleOrientation);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  const touchStartDistRef = useRef(null);
  const touchStartPanRef = useRef({ x: 0, y: 0 });
  const panOriginRef = useRef({ x: 0, y: 0 });
  const screenBoxRef = useRef(null);
  const layoutContainerRef = useRef(null);

  const resetZoom = () => {
    setZoomScale(1);
    setPanOffset({ x: 0, y: 0 });
  };

  const handleDoubleTap = () => {
    setZoomScale((prev) => {
      if (prev > 1) {
        setPanOffset({ x: 0, y: 0 });
        return 1;
      }
      return 2.0;
    });
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 2) {
      // Pinch to zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchStartDistRef.current = Math.hypot(dx, dy);
    } else if (e.touches.length === 1 && zoomScale > 1) {
      // Single finger drag when zoomed
      touchStartPanRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      panOriginRef.current = { ...panOffset };
    }
  };

  const handleTouchMove = (e) => {
    if (e.touches.length === 2 && touchStartDistRef.current) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const currentDist = Math.hypot(dx, dy);
      const factor = currentDist / touchStartDistRef.current;
      setZoomScale((prev) => Math.min(3.0, Math.max(1.0, Math.round(prev * factor * 100) / 100)));
      touchStartDistRef.current = currentDist;
    } else if (e.touches.length === 1 && zoomScale > 1) {
      const dx = e.touches[0].clientX - touchStartPanRef.current.x;
      const dy = e.touches[0].clientY - touchStartPanRef.current.y;
      const maxOffset = (zoomScale - 1) * 200;
      setPanOffset({
        x: Math.max(-maxOffset, Math.min(maxOffset, panOriginRef.current.x + dx)),
        y: Math.max(-maxOffset, Math.min(maxOffset, panOriginRef.current.y + dy)),
      });
    }
  };

  const toggleFullscreen = () => {
    const target = layoutContainerRef.current || screenBoxRef.current;
    if (!document.fullscreenElement) {
      target?.requestFullscreen?.().catch(() => {
        setIsLandscapeFullscreen((prev) => !prev);
      });
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsLandscapeFullscreen(false);
    }
  };

  // Synchronize fullscreenchange event from user gestures or escape key
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setIsLandscapeFullscreen(isFs);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // 3. Feature 2: Live Captions & Multilingual Translation (YouTube Style)
  const {
    active: subtitlesActive,
    originalText,
    sourceLang,
    currentTranslation,
    translations,
    availableLanguages = [],
    recentHistory,
    selectedLanguage,
    setSelectedLanguage,
    displayMode,
    setDisplayMode,
    fontSize,
    setFontSize,
    engine,
  } = useStudentLiveSubtitles({
    classId: activeClass,
    defaultLanguage: 'zh-Hans',
  });

  // Earphone Audio Read-Aloud (Text-to-Speech)
  const [audioTtsEnabled, setAudioTtsEnabled] = useState(false);
  const lastSpokenTextRef = useRef('');

  useEffect(() => {
    if (!audioTtsEnabled || !window.speechSynthesis) return;

    const textToSpeak = currentTranslation || translations?.[selectedLanguage];
    if (textToSpeak && textToSpeak !== lastSpokenTextRef.current) {
      lastSpokenTextRef.current = textToSpeak;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(textToSpeak);
      utter.lang = selectedLanguage;
      utter.rate = 1.0;
      window.speechSynthesis.speak(utter);
    }
  }, [audioTtsEnabled, currentTranslation, translations, selectedLanguage]);

  // Clean up audio speech synthesis on unmount or disable
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // 4. Feature 3: Interactive Classroom Bingo Challenge across all enrolled classes
  const [enrolledBingoChallenges, setEnrolledBingoChallenges] = useState({});
  const [activeClassBingo, setActiveClassBingo] = useState(null);

  // Subscribe to student's private properties for active Bingo challenges from any enrolled class
  useEffect(() => {
    if (!user?.uid) {
      setEnrolledBingoChallenges({});
      setActiveClassBingo(null);
      return;
    }

    const unsubs = [];
    const classIdsToListen = (userClasses && userClasses.length > 0)
      ? Array.from(new Set(userClasses.map(c => typeof c === 'string' ? c : c.id).filter(Boolean)))
      : (activeClass ? [activeClass] : []);

    classIdsToListen.forEach(cId => {
      const classObj = userClasses?.find(c => (typeof c === 'string' ? c : c.id) === cId);
      const cName = typeof classObj === 'string' ? classObj : (classObj?.name || cId);
      const studentPropsRef = doc(db, 'classes', cId, 'studentProperties', user.uid);

      const unsub = onSnapshot(studentPropsRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          let bingo = data.activeBingo;
          if (!bingo && data['activeBingo.status']) {
            bingo = {
              status: data['activeBingo.status'],
              result: data['activeBingo.result'],
            };
          }

          // Must be unfinalized and pending/active
          if (bingo && (bingo.status === 'pending' || bingo.status === 'active') && (!bingo.result || bingo.result === 'pending')) {
            const totalSeconds = bingo.timeLimitSeconds || 45;
            const expiresAt = bingo.expiresAtMillis || (bingo.issuedAtMillis ? bingo.issuedAtMillis + totalSeconds * 1000 : null);
            if (expiresAt && expiresAt <= Date.now()) {
              setEnrolledBingoChallenges(prev => {
                if (!prev[cId]) return prev;
                const next = { ...prev };
                delete next[cId];
                return next;
              });
              if (cId === activeClass) setActiveClassBingo(null);
              return;
            }

            const challenge = {
              ...bingo,
              classId: bingo.classId || cId,
              className: cName,
            };

            setEnrolledBingoChallenges(prev => ({
              ...prev,
              [cId]: challenge,
            }));
            if (cId === activeClass) setActiveClassBingo(challenge);
          } else {
            setEnrolledBingoChallenges(prev => {
              if (!prev[cId]) return prev;
              const next = { ...prev };
              delete next[cId];
              return next;
            });
            if (cId === activeClass) setActiveClassBingo(null);
          }
        } else {
          setEnrolledBingoChallenges(prev => {
            if (!prev[cId]) return prev;
            const next = { ...prev };
            delete next[cId];
            return next;
          });
          if (cId === activeClass) setActiveClassBingo(null);
        }
      }, (err) => {
        console.warn(`[StudentMobileView] Error subscribing to studentProperties for ${cId}:`, err);
      });
      unsubs.push(unsub);
    });

    return () => {
      unsubs.forEach(u => u());
    };
  }, [userClasses, user?.uid, activeClass]);

  const activeBingo = useMemo(() => {
    // 1. Check activeClass first
    if (activeClass && enrolledBingoChallenges[activeClass]) {
      return enrolledBingoChallenges[activeClass];
    }
    // 2. Check any other enrolled class with active challenge
    const otherId = Object.keys(enrolledBingoChallenges).find(id => enrolledBingoChallenges[id]);
    if (otherId) {
      return enrolledBingoChallenges[otherId];
    }
    return activeClassBingo;
  }, [enrolledBingoChallenges, activeClass, activeClassBingo]);

  const handleBingoSubmit = async ({ bingoId, selectedIndex, responseTimeSec, windowFocused }) => {
    const targetClassId = activeBingo?.classId || activeClass;
    if (!targetClassId || !bingoId) return { success: false };
    try {
      const submitFn = httpsCallable(functions, 'submitBingoAnswer');
      const res = await submitFn({
        classId: targetClassId,
        bingoId,
        selectedIndex,
        responseTimeSec,
        windowFocused: Boolean(windowFocused),
      });
      return res?.data || { success: true };
    } catch (err) {
      console.warn('[StudentMobileView] Callable submitBingoAnswer error:', err);
      return { success: false, error: err.message };
    }
  };

  // Selected language human label
  const selectedLangLabel = useMemo(() => {
    const found = availableLanguages.find(l => l.code === selectedLanguage);
    if (found) return found.label;
    if (selectedLanguage === 'zh-Hans' || selectedLanguage === 'zh-CN') return '简体中文';
    if (selectedLanguage === 'en') return 'English';
    if (selectedLanguage === 'zh-Hant' || selectedLanguage === 'zh-HK') return '繁體中文';
    return selectedLanguage;
  }, [availableLanguages, selectedLanguage]);

  const effectiveDisplayMode = displayMode || 'bilingual';

  // Proactively exit fullscreen when an active Bingo challenge appears so it is not hidden under maximized screen
  useEffect(() => {
    if (activeBingo) {
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
      }
      setIsLandscapeFullscreen(false);
    }
  }, [activeBingo]);

  return (
    <div
      ref={layoutContainerRef}
      className={`student-mobile-layout ${isLandscapeFullscreen ? 'landscape-fullscreen' : ''} ${isLandscape ? 'is-landscape' : ''} mode-${mobileViewMode}`}
    >
      {/* Mobile Top Header */}
      <header className="mobile-header" role="banner">
        <div className="mobile-header-brand">
          <span className="mobile-brand-icon">🎓</span>
          <div className="mobile-title-block">
            {userClasses && userClasses.length > 1 ? (
              <div className="mobile-class-select-group" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <select
                  className="mobile-class-select"
                  value={activeClass || ''}
                  onChange={handleSelectClass}
                  aria-label="Select Enrolled Class"
                >
                  {userClasses.map((cls) => {
                    const id = typeof cls === 'string' ? cls : cls.id;
                    const name = (typeof cls === 'object' ? cls.name : cls) || id;
                    const isScheduled = activeClassIds?.includes(id);
                    return <option key={id} value={id}>{name}{isScheduled ? ' 🕒' : ''}</option>;
                  })}
                </select>
                {isManualScheduleOverride && currentActiveClassId && currentActiveClassId !== activeClass && (
                  <button
                    type="button"
                    onClick={handleFollowSchedule}
                    className="mobile-follow-schedule-btn"
                    title={`Follow scheduled class: ${currentActiveClassId}`}
                    style={{
                      padding: '2px 6px',
                      fontSize: '11px',
                      borderRadius: '4px',
                      border: '1px solid #3b82f6',
                      backgroundColor: '#eff6ff',
                      color: '#1d4ed8',
                      cursor: 'pointer',
                      fontWeight: 'bold'
                    }}
                  >
                    ↩
                  </button>
                )}
              </div>
            ) : (
              <h1 className="mobile-class-title">{activeClassName}</h1>
            )}
            <span className="mobile-user-email">{user?.email}</span>
          </div>
        </div>

        <div className="mobile-header-actions">
          <button
            type="button"
            className="mobile-records-nav-btn"
            onClick={() => setShowPasskeyModal(true)}
            title="Link or View Mobile Passkey"
            aria-label="Link or View Mobile Passkey"
            style={{ background: '#4f46e5', color: '#ffffff' }}
          >
            📱 Passkey
          </button>
          <button
            type="button"
            className="mobile-records-nav-btn"
            onClick={() => navigate('/student/records')}
            title="View Attendance & Quiz Records"
            aria-label="View Attendance & Quiz Records"
          >
            📊 Records
          </button>
          {onSwitchToDesktop && (
            <button
              type="button"
              className="mobile-switch-desktop-btn"
              onClick={onSwitchToDesktop}
              title="Switch to Desktop Invigilation Mode"
              aria-label="Switch to Desktop Invigilation"
            >
              💻 Desktop
            </button>
          )}
          <button
            type="button"
            className="mobile-logout-btn"
            onClick={() => signOut(auth)}
            title="Sign Out"
            aria-label="Sign Out"
          >
            🚪
          </button>
        </div>
      </header>

      {/* Main View Area: Rendered based on mobileViewMode */}
      <main className="mobile-main-viewport">
        {/* MODE 1 & 2: Fullscreen Teacher Screen (with YouTube-style CC cues or Screen Only) */}
        {(mobileViewMode === 'overlay' || mobileViewMode === 'screen' || mobileViewMode === 'slide') && (
          <section className="mobile-screen-section" aria-label="Teacher Screen Broadcast">
            <div
              ref={screenBoxRef}
              className={`mobile-screen-box ${zoomScale > 1 ? 'is-zoomed' : ''}`}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onDoubleClick={handleDoubleTap}
            >
              {liveFrame ? (
                <img
                  src={liveFrame}
                  alt="Live Teacher Screen"
                  className="mobile-live-screen-img"
                  draggable={false}
                  style={{
                    transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomScale})`,
                  }}
                />
              ) : (
                <div className="mobile-screen-empty">
                  <span className="empty-screen-icon">🖥️</span>
                  <p className="empty-screen-text">
                    {isBroadcastActive
                      ? 'Connecting to teacher screen broadcast...'
                      : 'Teacher is not sharing screen right now.'}
                  </p>
                  <div className="mobile-stream-pill">
                    <span className={`pill-dot ${isBroadcastActive ? 'dot-active' : 'dot-idle'}`} />
                    <span>{isBroadcastActive ? 'Screen Live' : 'Screen Idle'}</span>
                  </div>
                </div>
              )}

              {/* Top Overlay Bar: Resolution & Zoom Controls */}
              {liveFrame && (
                <div className="mobile-screen-overlay-bar">
                  <div className="stream-badge-info">
                    <span className="live-dot" />
                    <span className="badge-text">SCREEN LIVE</span>
                    <span className="res-tag">{broadcastInfo?.resolution?.toUpperCase() || '1080P'}</span>
                  </div>
                  <div className="zoom-actions">
                    {zoomScale > 1 && (
                      <button type="button" className="mobile-overlay-btn" onClick={resetZoom} title="Reset Zoom" aria-label="Reset Zoom">
                        1x
                      </button>
                    )}
                    <button type="button" className="mobile-overlay-btn" onClick={handleDoubleTap} title="Toggle Zoom" aria-label="Toggle Zoom">
                      {zoomScale > 1 ? '🔍 Normal' : '🔍 2x Zoom'}
                    </button>
                    <button type="button" className="mobile-overlay-btn" onClick={toggleFullscreen} title="Fullscreen" aria-label="Fullscreen">
                      ⛶
                    </button>
                  </div>
                </div>
              )}

              {/* YouTube-Style Live Closed Captions (Mode: 'overlay') */}
              {mobileViewMode === 'overlay' && isCcEnabled && subtitlesActive && (originalText || currentTranslation || translations?.[selectedLanguage]) && (
                <div
                  className={`youtube-cc-cue-container font-${fontSize}`}
                  aria-live="polite"
                  aria-label="Closed Captions Overlay"
                >
                  {/* Original Speech Line (Dimmer, translucent black pill) */}
                  {(effectiveDisplayMode === 'bilingual' || effectiveDisplayMode === 'original') && originalText && (
                    <div className="youtube-cc-cue original">
                      <span className="youtube-cc-text">{originalText}</span>
                    </div>
                  )}

                  {/* Translated Line (Highlighted yellow/white, translucent black pill) */}
                  {(effectiveDisplayMode === 'bilingual' || effectiveDisplayMode === 'translation') && (currentTranslation || translations?.[selectedLanguage]) && (
                    <div className="youtube-cc-cue translated">
                      <span className="youtube-cc-text highlight">
                        {currentTranslation || translations?.[selectedLanguage]}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* YouTube-Style Player Bottom Control Bar (Mode: 'overlay') */}
              {mobileViewMode === 'overlay' && (
                <div className="yt-player-bottom-bar" aria-label="Caption and Audio Controls">
                  <div className="yt-bar-left">
                    {/* YouTube-style CC Toggle Button */}
                    <button
                      type="button"
                      className={`yt-control-btn yt-cc-btn ${isCcEnabled ? 'active' : ''}`}
                      onClick={() => setIsCcEnabled(!isCcEnabled)}
                      title={isCcEnabled ? 'Turn off captions' : 'Turn on captions'}
                      aria-label="Toggle Closed Captions"
                    >
                      <span className="yt-cc-badge">CC</span>
                    </button>

                    {/* Dynamic Language Chips from Teacher */}
                    {isCcEnabled && availableLanguages.length > 0 && (
                      <div className="yt-lang-pills" role="tablist" aria-label="Subtitle Language">
                        {availableLanguages.map((lang) => (
                          <button
                            key={lang.code}
                            type="button"
                            role="tab"
                            aria-selected={selectedLanguage === lang.code}
                            className={`yt-lang-chip ${selectedLanguage === lang.code ? 'active' : ''}`}
                            onClick={() => setSelectedLanguage(lang.code)}
                          >
                            {lang.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="yt-bar-right">
                    {/* Earphone Audio Read-Aloud */}
                    <button
                      type="button"
                      className={`yt-control-btn yt-tts-btn ${audioTtsEnabled ? 'active' : ''}`}
                      onClick={() => setAudioTtsEnabled(!audioTtsEnabled)}
                      title="Read Aloud in Earphones"
                      aria-label="Toggle Read Aloud in Earphones"
                    >
                      {audioTtsEnabled ? '🔊 Speaking' : '🎧 Listen'}
                    </button>

                    {/* Subtitle Mode Toggle: Bilingual -> Translation -> Original */}
                    <button
                      type="button"
                      className="yt-control-btn yt-mode-btn"
                      onClick={() => {
                        const nextMode = effectiveDisplayMode === 'bilingual' ? 'translation' : effectiveDisplayMode === 'translation' ? 'original' : 'bilingual';
                        setDisplayMode?.(nextMode);
                      }}
                      title={`Caption Mode: ${effectiveDisplayMode}`}
                      aria-label="Toggle Subtitle Mode"
                    >
                      {effectiveDisplayMode === 'bilingual' ? '双语' : effectiveDisplayMode === 'translation' ? '译文' : '原文'}
                    </button>

                    {/* Font Scale Toggle: small -> medium -> large */}
                    <button
                      type="button"
                      className="yt-control-btn yt-font-btn"
                      onClick={() => {
                        const nextSize = fontSize === 'small' ? 'medium' : fontSize === 'medium' ? 'large' : 'small';
                        setFontSize(nextSize);
                      }}
                      title={`Font Size: ${fontSize}`}
                      aria-label="Toggle Font Size"
                    >
                      {fontSize === 'small' ? 'A-' : fontSize === 'large' ? 'A+' : 'A'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* MODE 3: CC Only Dedicated Reader Mode */}
        {mobileViewMode === 'cc' && (
          <section className="mobile-subtitles-section dedicated-reader" aria-label="Dedicated Subtitles Reader">
            {/* Shortcut to switch back to teacher screen if broadcasting */}
            {isBroadcastActive && (
              <div
                className="cc-reader-slide-alert"
                onClick={() => handleSetViewMode('overlay')}
                role="button"
                tabIndex={0}
                aria-label="Teacher is sharing screen live. Tap to switch to screen."
              >
                <span className="alert-icon">🖥️</span>
                <span className="alert-text">Teacher is sharing screen live!</span>
                <span className="alert-action">View Screen →</span>
              </div>
            )}

            <div className="subtitles-toolbar">
              <div className="subtitles-status-pill">
                <span className={`cc-dot ${subtitlesActive ? 'cc-active' : 'cc-inactive'}`} />
                <span className="cc-label">LIVE CC</span>
                <span className="engine-badge">{engine === 'client' ? 'LiteRT' : 'Gemini'}</span>
              </div>

              <div className="subtitles-controls">
                <button
                  type="button"
                  className={`tts-toggle-btn ${audioTtsEnabled ? 'active' : ''}`}
                  onClick={() => setAudioTtsEnabled(!audioTtsEnabled)}
                  title="Read Aloud in Earphones"
                  aria-label="Toggle Read Aloud in Earphones"
                >
                  {audioTtsEnabled ? '🔊 Speaking' : '🎧 Listen'}
                </button>

                <div className="font-size-group" role="group" aria-label="Font Size">
                  <button
                    type="button"
                    className={`font-btn ${fontSize === 'small' ? 'active' : ''}`}
                    onClick={() => setFontSize('small')}
                    aria-label="Small font"
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    className={`font-btn ${fontSize === 'medium' ? 'active' : ''}`}
                    onClick={() => setFontSize('medium')}
                    aria-label="Medium font"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className={`font-btn ${fontSize === 'large' ? 'active' : ''}`}
                    onClick={() => setFontSize('large')}
                    aria-label="Large font"
                  >
                    A+
                  </button>
                </div>
              </div>
            </div>

            {/* Teacher's Available Translated Languages */}
            <div className="lang-chip-scroll" role="tablist" aria-label="Subtitle Language">
              {availableLanguages.map((lang) => (
                <button
                  key={lang.code}
                  type="button"
                  role="tab"
                  aria-selected={selectedLanguage === lang.code}
                  className={`lang-chip ${selectedLanguage === lang.code ? 'chip-active' : ''}`}
                  onClick={() => setSelectedLanguage(lang.code)}
                >
                  {lang.label}
                </button>
              ))}
            </div>

            {/* Live Subtitle Card Display */}
            <div className={`subtitles-display-card font-${fontSize}`}>
              {subtitlesActive ? (
                <>
                  <div className="subtitles-original-box">
                    <span className="lang-tag">{sourceLang || 'Teacher'}:</span>
                    <p className="original-text">{originalText || 'Listening to teacher...'}</p>
                  </div>

                  <div className="subtitles-translation-box">
                    <span className="lang-tag highlight">
                      {selectedLangLabel}:
                    </span>
                    <p className="translated-text">
                      {currentTranslation || translations?.[selectedLanguage] || 'Waiting for speech...'}
                    </p>
                  </div>
                </>
              ) : (
                <div className="subtitles-idle-placeholder">
                  <span className="idle-cc-icon">💬</span>
                  <p>Live classroom subtitles are paused.</p>
                  <span className="idle-hint">Teacher's speech will appear here when active.</span>
                </div>
              )}
            </div>

            {/* Recent History Transcript Log */}
            {recentHistory && recentHistory.length > 0 && (
              <div className="cc-history-feed">
                <h3 className="history-title">Lecture Transcript History</h3>
                <div className="history-entries">
                  {recentHistory.map((entry, idx) => (
                    <div key={idx} className="history-card">
                      <p className="history-orig">{entry.originalText || entry.text}</p>
                      <p className="history-trans">
                        {entry.translations?.[selectedLanguage] || entry.currentTranslation || ''}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {/* Floating Bottom Dock: 3 Native Mobile Viewing Modes */}
      <nav className="mobile-dock" aria-label="Viewing Mode Selection">
        <button
          type="button"
          className={`mobile-dock-btn ${mobileViewMode === 'overlay' ? 'active' : ''}`}
          onClick={() => handleSetViewMode('overlay')}
          aria-label="Teacher Screen and Overlapping Subtitles"
        >
          <span className="dock-icon">🖥️+💬</span>
          <span className="dock-label">Screen & CC</span>
        </button>
        <button
          type="button"
          className={`mobile-dock-btn ${(mobileViewMode === 'screen' || mobileViewMode === 'slide') ? 'active' : ''}`}
          onClick={() => handleSetViewMode('screen')}
          aria-label="Teacher Screen Only"
        >
          <span className="dock-icon">🖥️</span>
          <span className="dock-label">Screen Only</span>
        </button>
        <button
          type="button"
          className={`mobile-dock-btn ${mobileViewMode === 'cc' ? 'active' : ''}`}
          onClick={() => handleSetViewMode('cc')}
          aria-label="Subtitles Only"
        >
          <span className="dock-icon">💬</span>
          <span className="dock-label">CC Only</span>
        </button>
      </nav>

      {/* Feature 3: Interactive Classroom Bingo Modal */}
      {activeBingo && (
        <BingoModal
          key={activeBingo?.bingoId || 'mobile-bingo-modal'}
          activeBingo={activeBingo}
          isMobile={true}
          onSubmit={handleBingoSubmit}
          onClose={() => {
            const targetClassId = activeBingo?.classId || activeClass;
            if (targetClassId && user?.uid && activeBingo) {
              const studentPropsRef = doc(db, 'classes', targetClassId, 'studentProperties', user.uid);
              setDoc(studentPropsRef, {
                activeBingo: {
                  ...activeBingo,
                  status: 'closed',
                }
              }, { merge: true }).catch(() => {});
            }
            setEnrolledBingoChallenges(prev => {
              if (!targetClassId || !prev[targetClassId]) return prev;
              const next = { ...prev };
              delete next[targetClassId];
              return next;
            });
            setActiveClassBingo(null);
          }}
        />
      )}

      {showPasskeyModal && (
        <PasskeyPairModal
          show={showPasskeyModal}
          onClose={() => setShowPasskeyModal(false)}
          user={user}
          classId={activeClass}
        />
      )}
    </div>
  );
}
