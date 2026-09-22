import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isMobileDevice } from '../utils/browserDetection';
import './BingoModal.css';

/**
 * Clean Web Audio API chime (two-tone gentle notification ping).
 * Safe against autoplay policy (catches unhandled AudioContext errors).
 */
export function playBingoChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();

    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain1.gain.setValueAtTime(0.3, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);

    osc1.start(now);
    osc1.stop(now + 0.5);
  } catch (err) {
    console.warn('[BingoModal] AudioContext chime notice:', err);
  }
}

export default function BingoModal({
  activeBingo,
  onSubmit,
  onClose,
  isMobile: isMobileProp,
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'passed' | 'wrong' | 'timeout', text: string }
  const [isClosed, setIsClosed] = useState(false);

  // Adaptive mobile bottom sheet / dialog detection
  const checkIsMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth <= 768 || window.innerHeight <= 600 || isMobileDevice();
  };

  const checkIsLandscapeViewport = () => {
    if (typeof window === 'undefined') return false;
    const isWiderThanTall = window.innerWidth > window.innerHeight;
    const isMatchLandscape = window.matchMedia ? window.matchMedia('(orientation: landscape)').matches : false;
    const isMobileOrShort = window.innerHeight <= 650 || isMatchLandscape;
    return isWiderThanTall && isMobileOrShort;
  };

  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (isMobileProp !== undefined) return Boolean(isMobileProp);
    return checkIsMobileViewport();
  });

  const [isLandscape, setIsLandscape] = useState(() => checkIsLandscapeViewport());

  // Proactively exit fullscreen if browser is in native fullscreen mode so modal is not hidden under maximized screen
  useEffect(() => {
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (isMobileProp !== undefined) {
      setIsMobileViewport(Boolean(isMobileProp));
    }
    const checkViewport = () => {
      if (isMobileProp === undefined) {
        setIsMobileViewport(checkIsMobileViewport());
      }
      setIsLandscape(checkIsLandscapeViewport());
    };
    window.addEventListener('resize', checkViewport);
    window.addEventListener('orientationchange', checkViewport);
    return () => {
      window.removeEventListener('resize', checkViewport);
      window.removeEventListener('orientationchange', checkViewport);
    };
  }, [isMobileProp]);

  const totalSeconds = activeBingo?.timeLimitSeconds || 30;
  const expiresAt = activeBingo?.expiresAtMillis || (activeBingo?.issuedAtMillis ? activeBingo.issuedAtMillis + totalSeconds * 1000 : null);
  
  // Track if this challenge was already expired before mount
  const isExpiredOnMountRef = useRef(Boolean(expiresAt && expiresAt <= Date.now()));

  const [secondsRemaining, setSecondsRemaining] = useState(() => {
    if (expiresAt) {
      return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    }
    return totalSeconds;
  });

  const startTimeRef = useRef(Date.now());
  const timerRef = useRef(null);
  const hasSubmittedRef = useRef(false);

  // Reset all state and refs when activeBingo.bingoId changes (clean lifecycle for consecutive challenges)
  useEffect(() => {
    setSelectedIdx(null);
    setIsSubmitting(false);
    setFeedback(null);
    setIsClosed(false);
    hasSubmittedRef.current = false;
    startTimeRef.current = Date.now();
    isExpiredOnMountRef.current = Boolean(expiresAt && expiresAt <= Date.now());
    if (expiresAt) {
      setSecondsRemaining(Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)));
    } else {
      setSecondsRemaining(totalSeconds);
    }
  }, [activeBingo?.bingoId, expiresAt, totalSeconds]);

  // If challenge is already expired before mount, trigger background submit/close and never render
  useEffect(() => {
    if (isExpiredOnMountRef.current) {
      if (onClose) onClose();
      if (!hasSubmittedRef.current && onSubmit && activeBingo?.bingoId) {
        hasSubmittedRef.current = true;
        onSubmit({
          bingoId: activeBingo.bingoId,
          selectedIndex: null,
          responseTimeSec: totalSeconds,
          windowFocused: false,
        });
      }
    }
  }, [activeBingo?.bingoId]);

  // Play audio chime and trigger OS notification on mount ONLY if challenge is fresh
  useEffect(() => {
    if (!activeBingo || isExpiredOnMountRef.current) return;
    playBingoChime();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification('🎯 Bingo Active Check!', {
          body: `Quick ${totalSeconds}s presence check. Click to respond.`,
          icon: '/favicon.ico',
          tag: 'bingo-check',
        });
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      } catch (e) {
        console.warn('[BingoModal] Notification error:', e);
      }
    }
  }, [activeBingo?.bingoId]);

  // Synchronized countdown timer
  useEffect(() => {
    if (!activeBingo || isExpiredOnMountRef.current || hasSubmittedRef.current) return;

    const expiresAtTime = expiresAt || (Date.now() + totalSeconds * 1000);

    const updateTimer = () => {
      const now = Date.now();
      const diffMs = expiresAtTime - now;
      const secLeft = Math.max(0, Math.ceil(diffMs / 1000));
      setSecondsRemaining(secLeft);

      if (secLeft <= 0 && !hasSubmittedRef.current) {
        hasSubmittedRef.current = true;
        clearInterval(timerRef.current);
        handleTimeout();
      }
    };

    updateTimer();
    timerRef.current = setInterval(updateTimer, 500);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeBingo?.bingoId, expiresAt, totalSeconds]);

  const handleTimeout = async () => {
    setIsSubmitting(true);
    setFeedback({
      type: 'timeout',
      text: `⏰ Time Expired (${totalSeconds}s) — No response recorded.`,
    });
    if (onSubmit) {
      await onSubmit({
        bingoId: activeBingo.bingoId,
        selectedIndex: null,
        responseTimeSec: activeBingo.timeLimitSeconds || 30,
        windowFocused: document.hasFocus ? document.hasFocus() : true,
      });
    }
    setTimeout(() => {
      if (onClose) onClose();
    }, 2500);
  };

  const handleSelectOption = (index) => {
    if (isSubmitting || hasSubmittedRef.current || isClosed) return;
    hasSubmittedRef.current = true;
    setSelectedIdx(index);
    setIsSubmitting(true);
    setIsClosed(true);

    if (timerRef.current) clearInterval(timerRef.current);

    const latency = Math.max(0.1, Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));

    // Submit answer asynchronously in the background
    if (onSubmit) {
      Promise.resolve(
        onSubmit({
          bingoId: activeBingo.bingoId,
          selectedIndex: index,
          responseTimeSec: latency,
          windowFocused: document.hasFocus ? document.hasFocus() : true,
        })
      ).catch((err) => {
        console.warn('[BingoModal] Error submitting bingo answer:', err);
      });
    }

    // Immediately close modal on answer selection
    if (onClose) {
      onClose();
    }
  };

  if (!activeBingo || isExpiredOnMountRef.current || isClosed) return null;

  const totalTime = activeBingo.timeLimitSeconds || 30;
  const progressPercent = Math.min(100, Math.max(0, (secondsRemaining / totalTime) * 100));

  const optionLabels = ['A', 'B', 'C', 'D'];

  const modalElement = (
    <div
      className={`bingo-modal-overlay ${isMobileViewport ? 'is-mobile' : ''} ${isLandscape ? 'is-landscape' : ''}`}
      data-testid="bingo-modal-overlay"
    >
      <div
        className={`bingo-modal-container ${isMobileViewport ? 'is-mobile' : ''} ${isLandscape ? 'is-landscape' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bingo-title"
      >
        {/* Header & Progress */}
        <div className="bingo-header">
          <div className="bingo-title-row">
            <h2 id="bingo-title" className="bingo-title">
              <span>🎯 Class Bingo Check</span>
              {(activeBingo.className || activeBingo.classId) && (
                <span className="bingo-class-pill" data-testid="bingo-class-pill">
                  {activeBingo.className || activeBingo.classId}
                </span>
              )}
            </h2>
            <span className={`bingo-timer-badge ${secondsRemaining <= 10 ? 'warning' : ''}`}>
              ⏱️ {secondsRemaining}s
            </span>
          </div>
          <div className="bingo-progress-track">
            <div
              className={`bingo-progress-fill ${secondsRemaining <= 10 ? 'warning' : ''}`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Modal Body Container (split 2-column layout in landscape) */}
        <div className="bingo-modal-body">
          {/* Question Prompt */}
          <div className="bingo-question-box">
            <p
              className="bingo-question-text"
              style={{
                color: '#0f172a',
                fontWeight: 600,
                margin: 0,
                fontSize: isLandscape ? '1rem' : (isMobileViewport ? '0.95rem' : '1.15rem'),
                lineHeight: isLandscape ? 1.45 : (isMobileViewport ? 1.4 : 1.5),
              }}
            >
              {activeBingo.question}
            </p>
          </div>

          {/* Options Grid */}
          <div className="bingo-options-grid">
            {(activeBingo.options || []).map((opt, idx) => {
              const isSelected = selectedIdx === idx;
              return (
                <button
                  key={idx}
                  type="button"
                  className={`bingo-option-btn ${isSelected ? 'selected' : ''}`}
                  disabled={isSubmitting}
                  onClick={() => handleSelectOption(idx)}
                  data-testid={`bingo-option-${idx}`}
                >
                  <span className="bingo-option-tag">{optionLabels[idx] || (idx + 1)}</span>
                  <span className="bingo-option-label" style={{ color: '#0f172a' }}>{opt}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`bingo-feedback-banner ${feedback.type}`} data-testid="bingo-feedback">
            {feedback.text}
          </div>
        )}

        <div className="bingo-footer-note">
          <span>Active classroom presence verification. Click your answer before the timer expires.</span>
        </div>
      </div>
    </div>
  );

  // If the browser is in native Fullscreen mode, portal into document.fullscreenElement
  // so the modal is guaranteed to be in the browser's Top Layer above the maximized screen!
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    return createPortal(modalElement, document.fullscreenElement);
  }

  return modalElement;
}
