import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { isMobileDevice } from '../utils/browserDetection';
import { playBingoChime, triggerBingoNotification } from '../utils/systemNotification';
import './BingoModal.css';

export { playBingoChime };

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

  const [submissionResult, setSubmissionResult] = useState(null);
  const [autoDismissCountdown, setAutoDismissCountdown] = useState(5);

  // Reset all state and refs when activeBingo.bingoId changes (clean lifecycle for consecutive challenges)
  useEffect(() => {
    setSelectedIdx(null);
    setIsSubmitting(false);
    setFeedback(null);
    setIsClosed(false);
    setSubmissionResult(null);
    setAutoDismissCountdown(5);
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

  // Play multi-channel alert (audio chime, OS notification, tab title flash, vibration) on mount ONLY if challenge is fresh
  useEffect(() => {
    if (!activeBingo || isExpiredOnMountRef.current) return;
    const stopAttention = triggerBingoNotification(activeBingo);
    return () => {
      if (typeof stopAttention === 'function') {
        stopAttention();
      }
    };
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
    hasSubmittedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    const timeoutLatency = activeBingo?.timeLimitSeconds || 30;

    let res = null;
    if (onSubmit) {
      try {
        res = await onSubmit({
          bingoId: activeBingo.bingoId,
          selectedIndex: null,
          responseTimeSec: timeoutLatency,
          windowFocused: document.hasFocus ? document.hasFocus() : true,
        });
      } catch (e) {
        console.warn('[BingoModal] Timeout submit error:', e);
      }
    }

    setSubmissionResult({
      result: 'missed_timeout',
      isCorrect: false,
      responseTimeSec: timeoutLatency,
      rank: null,
      totalStudents: res?.totalStudents || activeBingo?.totalStudents || null,
      pointsAwarded: 0,
      leaderboard: res?.leaderboard || activeBingo?.leaderboard || [],
    });
  };

  const handleSelectOption = async (index) => {
    if (isSubmitting || hasSubmittedRef.current || isClosed || submissionResult) return;
    hasSubmittedRef.current = true;
    setSelectedIdx(index);
    setIsSubmitting(true);

    if (timerRef.current) clearInterval(timerRef.current);

    const latency = Math.max(0.1, Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));

    let resultPayload = {
      result: 'passed',
      isCorrect: true,
      responseTimeSec: latency,
      rank: 1,
      totalStudents: null,
      pointsAwarded: 100,
      leaderboard: [],
    };

    if (onSubmit) {
      try {
        const res = await onSubmit({
          bingoId: activeBingo.bingoId,
          selectedIndex: index,
          responseTimeSec: latency,
          windowFocused: document.hasFocus ? document.hasFocus() : true,
        });
        if (res) {
          resultPayload = {
            result: res.result || (res.isCorrect ? 'passed' : 'failed_incorrect'),
            isCorrect: res.isCorrect !== undefined ? res.isCorrect : (res.result === 'passed'),
            responseTimeSec: res.responseTimeSec !== undefined ? res.responseTimeSec : latency,
            rank: res.rank || 1,
            totalStudents: res.totalStudents || null,
            pointsAwarded: res.pointsAwarded ?? (res.isCorrect ? 100 : 0),
            leaderboard: res.leaderboard || [],
          };
        }
      } catch (err) {
        console.warn('[BingoModal] Error submitting bingo answer:', err);
      }
    }

    setSubmissionResult(resultPayload);
  };

  // Auto-dismiss countdown when showing result
  useEffect(() => {
    if (!submissionResult || isClosed) return;
    const interval = setInterval(() => {
      setAutoDismissCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsClosed(true);
          if (onClose) onClose();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [submissionResult, isClosed, onClose]);

  const handleDismiss = () => {
    setIsClosed(true);
    if (onClose) onClose();
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
        className={`bingo-modal-container ${isMobileViewport ? 'is-mobile' : ''} ${isLandscape ? 'is-landscape' : ''} ${submissionResult ? 'has-result' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bingo-title"
      >
        {/* Header */}
        <div className="bingo-header">
          <div className="bingo-title-row">
            <h2 id="bingo-title" className="bingo-title">
              <span>{submissionResult ? '🎯 Bingo Speed & Rank' : '🎯 Class Bingo Check'}</span>
              {(activeBingo.className || activeBingo.classId) && (
                <span className="bingo-class-pill" data-testid="bingo-class-pill">
                  {activeBingo.className || activeBingo.classId}
                </span>
              )}
            </h2>
            {!submissionResult && (
              <span className={`bingo-timer-badge ${secondsRemaining <= 10 ? 'warning' : ''}`}>
                ⏱️ {secondsRemaining}s
              </span>
            )}
          </div>
          {!submissionResult && (
            <div className="bingo-progress-track">
              <div
                className={`bingo-progress-fill ${secondsRemaining <= 10 ? 'warning' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Modal Body: Either Result & Ranking Card OR Question Options */}
        {submissionResult ? (
          <div className="bingo-result-card" data-testid="bingo-result-card">
            {/* Header Hero */}
            <div className={`bingo-result-hero ${submissionResult.isCorrect ? 'correct' : (submissionResult.result === 'missed_timeout' ? 'timeout' : 'incorrect')}`}>
              <div className="bingo-result-icon">
                {submissionResult.isCorrect ? '🎉' : (submissionResult.result === 'missed_timeout' ? '⏰' : '❌')}
              </div>
              <h3 className="bingo-result-title">
                {submissionResult.isCorrect
                  ? 'Correct!'
                  : (submissionResult.result === 'missed_timeout' ? 'Time Expired!' : 'Incorrect')}
              </h3>
              <p className="bingo-result-subtitle">
                {submissionResult.isCorrect
                  ? 'Presence verified with speed and accuracy.'
                  : (submissionResult.result === 'missed_timeout'
                    ? 'No response recorded within the time limit.'
                    : 'Recorded response. Keep up with the lecture!')}
              </p>
            </div>

            {/* Metrics Dual/Triple Pod */}
            <div className="bingo-result-stats-grid">
              {/* Answering Speed Pod */}
              <div className="bingo-stat-pod speed" data-testid="bingo-stat-speed">
                <span className="bingo-stat-label">⚡ Answering Time</span>
                <span className="bingo-stat-value">{submissionResult.responseTimeSec}s</span>
                <span className="bingo-stat-hint">Response Latency</span>
              </div>

              {/* Class Rank Pod */}
              <div className="bingo-stat-pod rank" data-testid="bingo-stat-rank">
                <span className="bingo-stat-label">🏆 Class Rank</span>
                <span className="bingo-stat-value">
                  {submissionResult.rank === 1
                    ? '🥇 #1'
                    : submissionResult.rank === 2
                      ? '🥈 #2'
                      : submissionResult.rank === 3
                        ? '🥉 #3'
                        : submissionResult.rank
                          ? `#${submissionResult.rank}`
                          : '—'}
                </span>
                <span className="bingo-stat-hint">
                  {submissionResult.totalStudents ? `of ${submissionResult.totalStudents} students` : 'Live Standing'}
                </span>
              </div>

              {/* Points Pod */}
              <div className="bingo-stat-pod points" data-testid="bingo-stat-points">
                <span className="bingo-stat-label">⭐ Points</span>
                <span className="bingo-stat-value">+{submissionResult.pointsAwarded || 0}</span>
                <span className="bingo-stat-hint">Speed & Accuracy</span>
              </div>
            </div>

            {/* Mini Podium / Leaderboard */}
            {submissionResult.leaderboard && submissionResult.leaderboard.length > 0 && (
              <div className="bingo-mini-leaderboard" data-testid="bingo-mini-leaderboard">
                <div className="bingo-leaderboard-header">⚡ Fastest Responders</div>
                <div className="bingo-leaderboard-list">
                  {submissionResult.leaderboard.map((item, idx) => (
                    <div
                      key={idx}
                      className={`bingo-leaderboard-item ${item.studentUid === activeBingo.studentUid ? 'highlight-me' : ''}`}
                    >
                      <span className="leaderboard-rank-badge">
                        {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`}
                      </span>
                      <span className="leaderboard-name">{item.studentEmail?.split('@')[0] || `Student ${idx + 1}`}</span>
                      <span className="leaderboard-speed">{item.responseTimeSec !== null && item.responseTimeSec !== undefined ? `${item.responseTimeSec}s` : '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer Dismiss Button & Countdown */}
            <div className="bingo-result-actions">
              <button
                type="button"
                className="bingo-btn-dismiss"
                onClick={handleDismiss}
                data-testid="bingo-btn-dismiss"
              >
                Dismiss ({autoDismissCountdown}s)
              </button>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
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
