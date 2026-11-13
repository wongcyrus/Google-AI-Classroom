import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { db, auth } from '../../firebase-config';
import { doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { LANGUAGE_LABELS, getLanguageLabel } from '../../hooks/useStudentLiveSubtitles';
import './PublicLiveView.css';

function getOrCreateSpectatorId() {
  if (auth?.currentUser?.uid) return auth.currentUser.uid;
  try {
    const existing = sessionStorage.getItem('public_spectator_uid');
    if (existing) return existing;
    const rand =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const generated = `anon_spectator_${rand}`;
    sessionStorage.setItem('public_spectator_uid', generated);
    return generated;
  } catch {
    return `anon_spectator_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export default function PublicLiveView() {
  const { classId } = useParams();
  const [searchParams] = useSearchParams();
  const urlPin = searchParams.get('pin') || '';

  // Spectator identity (zero-auth client ID so large conference audiences never hit Firebase Auth IP limits)
  const [authUid] = useState(() => getOrCreateSpectatorId());
  const [authLoading] = useState(false);

  // PIN & verification state
  const [pinInput, setPinInput] = useState(urlPin);
  const [isVerifyingPin, setIsVerifyingPin] = useState(false);
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [pinError, setPinError] = useState(null);

  // Broadcast stream state
  const [isBroadcastActive, setIsBroadcastActive] = useState(false);
  const [sessionData, setSessionData] = useState(null);
  const [frameData, setFrameData] = useState(null);
  const [hasReceivedFrame, setHasReceivedFrame] = useState(false);

  // Subtitle state
  const [subtitleData, setSubtitleData] = useState(null);
  const [selectedLang, setSelectedLang] = useState(() => {
    try {
      return localStorage.getItem('public_subtitle_lang') || 'en';
    } catch {
      return 'en';
    }
  });
  const [subtitleSize, setSubtitleSize] = useState('md'); // 'sm' | 'md' | 'lg'
  const [showBilingual, setShowBilingual] = useState(true);
  const [isCcEnabled, setIsCcEnabled] = useState(true);

  // Viewport & zoom state
  const [zoomLevel, setZoomLevel] = useState(1); // 1 | 1.5 | 2
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef(null);

  // 1. PIN verification and viewer registration handler
  const handleVerifyPin = useCallback(async (pinToVerify) => {
    const trimmed = (pinToVerify || '').trim();
    if (!trimmed) {
      setPinError('Please enter the 4-digit presentation PIN.');
      return;
    }

    if (!classId) {
      setPinError('Missing presentation ID.');
      return;
    }

    const currentUid = auth?.currentUser?.uid || authUid;
    if (!currentUid) {
      setPinError('Initializing connection, please try again in a moment...');
      return;
    }

    setIsVerifyingPin(true);
    setPinError(null);

    try {
      // Writing to screenBroadcastViewers with pin validates against Firestore security rules
      const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${currentUid}`);
      await setDoc(viewerDocRef, {
        pin: trimmed,
        joinedAt: serverTimestamp(),
        isAnonymousSpectator: true,
      });

      setIsPinVerified(true);
      setIsBroadcastActive(true);
    } catch (err) {
      console.warn('[PublicLiveView] PIN verification denied by Firestore rules:', err);
      setPinError('Invalid PIN or presentation is not currently public. Please check the presentation screen.');
      setIsPinVerified(false);
    } finally {
      setIsVerifyingPin(false);
    }
  }, [classId, authUid]);

  // 3. Auto-verify if PIN is present in URL query params
  useEffect(() => {
    if (!authLoading && authUid && urlPin && !isPinVerified && !isVerifyingPin) {
      handleVerifyPin(urlPin);
    }
  }, [authLoading, authUid, urlPin, isPinVerified, isVerifyingPin, handleVerifyPin]);

  // 4. Subscriptions when PIN is verified (with automatic 2s re-subscription on network/Wi-Fi handoff errors)
  useEffect(() => {
    if (!isPinVerified || !classId) return;

    let cancelled = false;
    let unsubSession = null;
    let unsubFrame = null;
    let unsubSubtitles = null;
    let sessionRetryTimer = null;
    let frameRetryTimer = null;
    let subtitlesRetryTimer = null;

    const subscribeSession = () => {
      if (cancelled) return;
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      unsubSession = onSnapshot(
        sessionDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            const active = Boolean(data.isBroadcasting && (data.isPublic || data.savedIsPublic));
            setIsBroadcastActive(active);
            setSessionData(data);
          } else {
            setIsBroadcastActive(false);
          }
        },
        (err) => {
          console.warn('[PublicLiveView] Session snapshot error (retrying in 2s):', err);
          if (!cancelled) {
            sessionRetryTimer = setTimeout(subscribeSession, 2000);
          }
        }
      );
    };

    const subscribeFrame = () => {
      if (cancelled) return;
      const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
      unsubFrame = onSnapshot(
        liveFrameDocRef,
        (snap) => {
          if (snap.exists()) {
            const data = snap.data();
            if (data.frameData) {
              setFrameData(data.frameData);
              setHasReceivedFrame(true);
            }
          }
        },
        (err) => {
          console.warn('[PublicLiveView] Frame snapshot error (retrying in 2s):', err);
          if (!cancelled) {
            frameRetryTimer = setTimeout(subscribeFrame, 2000);
          }
        }
      );
    };

    const subscribeSubtitles = () => {
      if (cancelled) return;
      const subtitlesDocRef = doc(db, `classes/${classId}/liveSubtitles/current`);
      unsubSubtitles = onSnapshot(
        subtitlesDocRef,
        (snap) => {
          if (snap.exists()) {
            setSubtitleData(snap.data());
          }
        },
        (err) => {
          console.warn('[PublicLiveView] Subtitles snapshot error (retrying in 2s):', err);
          if (!cancelled) {
            subtitlesRetryTimer = setTimeout(subscribeSubtitles, 2000);
          }
        }
      );
    };

    subscribeSession();
    subscribeFrame();
    subscribeSubtitles();

    return () => {
      cancelled = true;
      if (sessionRetryTimer) clearTimeout(sessionRetryTimer);
      if (frameRetryTimer) clearTimeout(frameRetryTimer);
      if (subtitlesRetryTimer) clearTimeout(subtitlesRetryTimer);
      if (unsubSession) unsubSession();
      if (unsubFrame) unsubFrame();
      if (unsubSubtitles) unsubSubtitles();
    };
  }, [isPinVerified, classId]);

  // 5. Clean up spectator viewer doc on exit
  useEffect(() => {
    const currentUid = auth.currentUser?.uid || authUid;
    return () => {
      if (classId && currentUid && isPinVerified) {
        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${currentUid}`);
        deleteDoc(viewerDocRef).catch(() => {});
      }
    };
  }, [classId, authUid, isPinVerified]);

  // Subtitle Language selection
  const handleSelectLanguage = (langCode) => {
    setSelectedLang(langCode);
    try {
      localStorage.setItem('public_subtitle_lang', langCode);
    } catch {}
  };

  // Fullscreen toggle (targets containerRef so CC overlay & HUD stay inside the fullscreen layer, with CSS fallback for iOS Safari)
  const toggleFullscreen = () => {
    const target = containerRef.current || document.documentElement;
    const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsElement && !isFullscreen) {
      const req = target?.requestFullscreen || target?.webkitRequestFullscreen;
      if (typeof req === 'function') {
        Promise.resolve(req.call(target)).catch(() => {});
      }
      setIsFullscreen(true);
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      if (fsElement && typeof exit === 'function') {
        Promise.resolve(exit.call(document)).catch(() => {});
      }
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsElement = document.fullscreenElement || document.webkitFullscreenElement;
      setIsFullscreen(Boolean(fsElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Zoom toggle: 1x -> 1.5x -> 2x -> 1x
  const cycleZoom = () => {
    setZoomLevel((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1));
  };

  // Compute available languages from subtitle translations
  const availableLangs = subtitleData?.translations
    ? Object.keys(subtitleData.translations)
    : ['en', 'zh-Hant', 'zh-Hans', 'zh-HK'];
  if (Array.isArray(subtitleData?.targetLanguages)) {
    subtitleData.targetLanguages.forEach((lang) => {
      if (!availableLangs.includes(lang)) availableLangs.push(lang);
    });
  }
  if (!availableLangs.includes('zh-Hant')) availableLangs.push('zh-Hant');
  if (!availableLangs.includes('en')) availableLangs.push('en');
  if (!availableLangs.includes('zh-Hans')) availableLangs.push('zh-Hans');

  const currentTranslation = subtitleData?.translations?.[selectedLang] || '';
  const originalTranscript = subtitleData?.text || subtitleData?.originalText || '';

  // Render Loading state
  if (authLoading) {
    return (
      <div className="public-live-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div className="setup-spinner" style={{ margin: '0 auto 12px' }} />
          <p>Connecting to Presentation...</p>
        </div>
      </div>
    );
  }

  // Render PIN Verification Screen
  if (!isPinVerified) {
    return (
      <div className="public-live-container">
        <header className="public-live-header">
          <div className="public-live-brand">
            <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>🎓</span>
            <span className="public-class-title">{classId}</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Public Spectator</span>
        </header>

        <main className="pin-prompt-wrapper">
          <div className="pin-card">
            <div className="pin-card-icon" aria-hidden="true">📺</div>
            <h1 className="pin-card-title">Join Live Presentation</h1>
            <p className="pin-card-desc">
              Please enter the 4-digit presentation PIN displayed on the projection screen.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleVerifyPin(pinInput);
              }}
            >
              <div className="pin-input-group">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="PIN"
                  aria-label="Presentation PIN"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  className="pin-digit-input"
                  autoFocus
                  autoComplete="one-time-code"
                />
              </div>

              <button
                type="submit"
                className="pin-submit-btn"
                disabled={isVerifyingPin || !pinInput.trim()}
              >
                {isVerifyingPin ? 'Verifying PIN...' : 'Watch Live Screen'}
              </button>
            </form>

            {pinError && <div className="pin-error-box" role="alert">{pinError}</div>}
          </div>
        </main>
      </div>
    );
  }

  // Render Ended / Inactive state
  if (!isBroadcastActive && hasReceivedFrame) {
    return (
      <div className="public-live-container">
        <header className="public-live-header">
          <div className="public-live-brand">
            <span aria-hidden="true" style={{ fontSize: '1.2rem' }}>🎓</span>
            <span className="public-class-title">{classId}</span>
          </div>
        </header>
        <main className="public-empty-card" style={{ margin: 'auto' }}>
          <div className="public-empty-icon" aria-hidden="true">🏁</div>
          <h1 style={{ color: '#f8fafc', fontSize: '1.3rem', margin: '0 0 0.5rem 0' }}>
            Presentation Ended
          </h1>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>
            The speaker has concluded this live presentation. Thank you for attending!
          </p>
        </main>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`public-live-container ${isFullscreen ? 'is-fullscreen' : ''}`}
    >
      {/* Top Header Bar */}
      <header className="public-live-header">
        <div className="public-live-brand">
          <span className="live-badge">
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#fff' }} />
            LIVE
          </span>
          <span className="public-class-title">{classId}</span>
        </div>

        <div className="public-live-controls">
          {/* Subtitle Translation Language Selector */}
          <select
            value={selectedLang}
            onChange={(e) => handleSelectLanguage(e.target.value)}
            className="lang-select-btn"
            title="Choose Subtitle Language"
            aria-label="Subtitle Language"
          >
            {availableLangs.map((code) => (
              <option key={code} value={code}>
                🌐 {getLanguageLabel(code)}
              </option>
            ))}
          </select>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className="header-action-btn"
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label="Toggle Fullscreen"
          >
            {isFullscreen ? '🗗' : '⛶'}
          </button>
        </div>
      </header>

      {/* Screen Frame Stage */}
      <main className="public-stream-stage">
        <h1 className="visually-hidden">Live Presentation: {classId}</h1>
        {frameData ? (
          <img
            src={frameData}
            alt="Live presentation stream"
            className={`stream-frame-img ${zoomLevel === 1.5 ? 'zoom-15x' : zoomLevel === 2 ? 'zoom-2x' : ''}`}
            onClick={cycleZoom}
            title="Tap to zoom slides and code"
          />
        ) : (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '2rem' }}>
            <div className="setup-spinner" style={{ margin: '0 auto 12px' }} />
            <p style={{ margin: '0 0 6px 0', color: '#e2e8f0', fontWeight: 600 }}>Waiting for presenter's screen...</p>
            <p style={{ margin: 0, fontSize: '0.82rem', color: '#94a3b8' }}>
              You are in the waiting room — live slides and subtitles will appear automatically when the session begins.
            </p>
          </div>
        )}

        {/* Floating Zoom & Orientation HUD (Always available in active/fullscreen view so CC & Fullscreen controls work in fullscreen) */}
        {(frameData || isFullscreen || currentTranslation || originalTranscript) && (
          <div className="stream-overlay-hud">
            {isFullscreen && (
              <select
                value={selectedLang}
                onChange={(e) => handleSelectLanguage(e.target.value)}
                className="hud-lang-select"
                title="Choose Subtitle Language"
                aria-label="Fullscreen Subtitle Language"
              >
                {availableLangs.map((code) => (
                  <option key={code} value={code}>
                    🌐 {getLanguageLabel(code)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className={`hud-btn yt-cc-btn ${isCcEnabled ? 'active' : ''}`}
              onClick={() => setIsCcEnabled((c) => !c)}
              title={isCcEnabled ? 'Turn off captions (CC)' : 'Turn on captions (CC)'}
              aria-label="Toggle Closed Captions"
              aria-pressed={isCcEnabled}
            >
              CC
            </button>
            {frameData && (
              <button
                type="button"
                className="hud-btn"
                onClick={cycleZoom}
                title="Toggle Zoom (1x, 1.5x, 2x)"
                aria-label={`Zoom ${zoomLevel}x, tap to cycle`}
              >
                <span aria-hidden="true">🔍</span> {zoomLevel}x
              </button>
            )}
            <button
              type="button"
              className="hud-btn"
              onClick={() => setSubtitleSize((s) => (s === 'sm' ? 'md' : s === 'md' ? 'lg' : 'sm'))}
              title="Toggle Subtitle Font Size"
              aria-label={`Subtitle size ${subtitleSize}, tap to cycle`}
            >
              A{subtitleSize === 'sm' ? '-' : subtitleSize === 'lg' ? '+' : ''}
            </button>
            <button
              type="button"
              className="hud-btn"
              onClick={() => setShowBilingual((b) => !b)}
              title="Toggle Bilingual / Single Language"
              aria-label={showBilingual ? 'Bilingual subtitles' : 'Single language subtitles'}
              aria-pressed={showBilingual}
            >
              {showBilingual ? 'Bilingual' : 'Single'}
            </button>
            {isFullscreen && (
              <button
                type="button"
                className="hud-btn"
                onClick={toggleFullscreen}
                title="Exit Fullscreen"
                aria-label="Exit Fullscreen"
              >
                🗗
              </button>
            )}
          </div>
        )}

        {/* YouTube-Style Live Closed Captions Cue Overlay (Overlaps Screen View) */}
        {isCcEnabled && (currentTranslation || originalTranscript) && (
          <div
            className={`public-youtube-cc-overlay font-${subtitleSize} ${isFullscreen ? 'is-fullscreen-cc' : ''}`}
            aria-live="polite"
            aria-label="Closed Captions Overlay"
          >
            {/* Original Spoken Line (Bilingual Mode) */}
            {showBilingual && currentTranslation && originalTranscript && (
              <div className="youtube-cc-cue original">
                <span className="youtube-cc-text">{originalTranscript}</span>
              </div>
            )}

            {/* Translated / Main Line (YouTube-style bright yellow highlight) */}
            <div className="youtube-cc-cue translated">
              <span className="youtube-cc-text highlight">
                {currentTranslation || originalTranscript}
              </span>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
