import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { db, auth } from '../../firebase-config';
import { signInAnonymously } from 'firebase/auth';
import { doc, setDoc, deleteDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { LANGUAGE_LABELS, getLanguageLabel } from '../../hooks/useStudentLiveSubtitles';
import './PublicLiveView.css';

export default function PublicLiveView() {
  const { classId } = useParams();
  const [searchParams] = useSearchParams();
  const urlPin = searchParams.get('pin') || '';

  // Auth state
  const [authUid, setAuthUid] = useState(() => auth?.currentUser?.uid || null);
  const [authLoading, setAuthLoading] = useState(true);

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

  // Viewport & zoom state
  const [zoomLevel, setZoomLevel] = useState(1); // 1 | 1.5 | 2
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 1. Ensure user has an anonymous or active auth session
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        if (!auth.currentUser) {
          const userCred = await signInAnonymously(auth);
          if (isMounted) {
            setAuthUid(userCred.user.uid);
            setAuthLoading(false);
          }
        } else {
          if (isMounted) {
            setAuthUid(auth.currentUser.uid);
            setAuthLoading(false);
          }
        }
      } catch (err) {
        console.error('[PublicLiveView] Anonymous auth error:', err);
        if (isMounted) {
          setAuthLoading(false);
          setPinError('Failed to initialize spectator connection. Please reload the page.');
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. PIN verification and viewer registration handler
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

    const currentUid = auth.currentUser?.uid || authUid;
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

  // 4. Subscriptions when PIN is verified
  useEffect(() => {
    if (!isPinVerified || !classId) return;

    // Listen to session status
    const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
    const unsubSession = onSnapshot(
      sessionDocRef,
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const active = Boolean(data.isBroadcasting && data.isPublic);
          setIsBroadcastActive(active);
          setSessionData(data);
        } else {
          setIsBroadcastActive(false);
        }
      },
      (err) => {
        console.warn('[PublicLiveView] Session snapshot error:', err);
      }
    );

    // Listen to live screen frame
    const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
    const unsubFrame = onSnapshot(
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
        console.warn('[PublicLiveView] Frame snapshot error:', err);
      }
    );

    // Listen to live subtitles
    const subtitlesDocRef = doc(db, `classes/${classId}/liveSubtitles/current`);
    const unsubSubtitles = onSnapshot(
      subtitlesDocRef,
      (snap) => {
        if (snap.exists()) {
          setSubtitleData(snap.data());
        }
      },
      (err) => {
        console.warn('[PublicLiveView] Subtitles snapshot error:', err);
      }
    );

    return () => {
      unsubSession();
      unsubFrame();
      unsubSubtitles();
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

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Zoom toggle: 1x -> 1.5x -> 2x -> 1x
  const cycleZoom = () => {
    setZoomLevel((prev) => (prev === 1 ? 1.5 : prev === 1.5 ? 2 : 1));
  };

  // Compute available languages from subtitle translations
  const availableLangs = subtitleData?.translations
    ? Object.keys(subtitleData.translations)
    : ['en', 'zh-Hans', 'zh-HK'];
  if (!availableLangs.includes('en')) availableLangs.push('en');
  if (!availableLangs.includes('zh-Hans')) availableLangs.push('zh-Hans');

  const currentTranslation = subtitleData?.translations?.[selectedLang] || '';
  const originalTranscript = subtitleData?.text || '';

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
            <span style={{ fontSize: '1.2rem' }}>🎓</span>
            <span className="public-class-title">{classId}</span>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Public Spectator</span>
        </header>

        <div className="pin-prompt-wrapper">
          <div className="pin-card">
            <div className="pin-card-icon">📺</div>
            <h2 className="pin-card-title">Join Live Presentation</h2>
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

            {pinError && <div className="pin-error-box">{pinError}</div>}
          </div>
        </div>
      </div>
    );
  }

  // Render Ended / Inactive state
  if (!isBroadcastActive && hasReceivedFrame) {
    return (
      <div className="public-live-container">
        <header className="public-live-header">
          <div className="public-live-brand">
            <span style={{ fontSize: '1.2rem' }}>🎓</span>
            <span className="public-class-title">{classId}</span>
          </div>
        </header>
        <div className="public-empty-card" style={{ margin: 'auto' }}>
          <div className="public-empty-icon">🏁</div>
          <h2 style={{ color: '#f8fafc', fontSize: '1.3rem', margin: '0 0 0.5rem 0' }}>
            Presentation Ended
          </h2>
          <p style={{ margin: 0, fontSize: '0.9rem', color: '#94a3b8' }}>
            The speaker has concluded this live presentation. Thank you for attending!
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="public-live-container">
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
            <p>Waiting for presenter's screen...</p>
          </div>
        )}

        {/* Floating Zoom & Orientation HUD */}
        {frameData && (
          <div className="stream-overlay-hud">
            <button
              type="button"
              className="hud-btn"
              onClick={cycleZoom}
              title="Toggle Zoom (1x, 1.5x, 2x)"
            >
              🔍 {zoomLevel}x
            </button>
            <button
              type="button"
              className="hud-btn"
              onClick={() => setSubtitleSize((s) => (s === 'sm' ? 'md' : s === 'md' ? 'lg' : 'sm'))}
              title="Toggle Subtitle Font Size"
            >
              A{subtitleSize === 'sm' ? '-' : subtitleSize === 'lg' ? '+' : ''}
            </button>
            <button
              type="button"
              className="hud-btn"
              onClick={() => setShowBilingual((b) => !b)}
              title="Toggle Bilingual / Single Language"
            >
              {showBilingual ? 'Bilingual' : 'Single'}
            </button>
          </div>
        )}
      </main>

      {/* Real-Time Live Subtitle Card at Bottom */}
      {(currentTranslation || originalTranscript) && (
        <footer className="public-subtitles-card">
          <div className="subtitles-header-row">
            <span>🗣️ Live Captions &amp; AI Translation ({getLanguageLabel(selectedLang)})</span>
            {subtitleData?.sourceLang && (
              <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                Speaker: {getLanguageLabel(subtitleData.sourceLang)}
              </span>
            )}
          </div>

          <p className={`subtitles-body-text size-${subtitleSize}`}>
            {currentTranslation || originalTranscript}
          </p>

          {showBilingual && currentTranslation && originalTranscript && (
            <p className="subtitles-original-sub">
              {originalTranscript}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
