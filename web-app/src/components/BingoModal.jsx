import React, { useState, useEffect, useRef } from 'react';
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
}) {
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState(null); // { type: 'passed' | 'wrong' | 'timeout', text: string }

  const totalSeconds = activeBingo?.timeLimitSeconds || 45;
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
  }, []);

  // Play audio chime and trigger OS notification on mount ONLY if challenge is fresh
  useEffect(() => {
    if (!activeBingo || isExpiredOnMountRef.current) return;
    playBingoChime();

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification('🎯 Bingo Active Check!', {
          body: 'Quick 45s presence check. Click to respond.',
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
  }, [expiresAt]);

  const handleTimeout = async () => {
    setIsSubmitting(true);
    setFeedback({
      type: 'timeout',
      text: '⏰ Time Expired (45s) — No response recorded.',
    });
    if (onSubmit) {
      await onSubmit({
        bingoId: activeBingo.bingoId,
        selectedIndex: null,
        responseTimeSec: activeBingo.timeLimitSeconds || 45,
        windowFocused: document.hasFocus ? document.hasFocus() : true,
      });
    }
    setTimeout(() => {
      if (onClose) onClose();
    }, 2500);
  };

  const handleSelectOption = async (index) => {
    if (isSubmitting || hasSubmittedRef.current) return;
    hasSubmittedRef.current = true;
    setSelectedIdx(index);
    setIsSubmitting(true);

    if (timerRef.current) clearInterval(timerRef.current);

    const latency = Math.max(0.1, Number(((Date.now() - startTimeRef.current) / 1000).toFixed(1)));

    let submitResult = null;
    if (onSubmit) {
      submitResult = await onSubmit({
        bingoId: activeBingo.bingoId,
        selectedIndex: index,
        responseTimeSec: latency,
        windowFocused: document.hasFocus ? document.hasFocus() : true,
      });
    }

    if (submitResult?.result === 'passed' || submitResult?.isCorrect) {
      setFeedback({
        type: 'passed',
        text: `✅ Verified! (${latency}s)`,
      });
      setTimeout(() => {
        if (onClose) onClose();
      }, 1500);
    } else {
      setFeedback({
        type: 'wrong',
        text: `Option recorded (${latency}s) — Remember to stay attentive!`,
      });
      setTimeout(() => {
        if (onClose) onClose();
      }, 2000);
    }
  };

  if (!activeBingo || isExpiredOnMountRef.current) return null;

  const totalTime = activeBingo.timeLimitSeconds || 45;
  const progressPercent = Math.min(100, Math.max(0, (secondsRemaining / totalTime) * 100));

  const optionLabels = ['A', 'B', 'C', 'D'];

  return (
    <div className="bingo-modal-overlay" data-testid="bingo-modal-overlay">
      <div className="bingo-modal-container" role="dialog" aria-modal="true" aria-labelledby="bingo-title">
        {/* Header & Progress */}
        <div className="bingo-header">
          <div className="bingo-title-row">
            <h2 id="bingo-title" className="bingo-title">🎯 Class Bingo Check</h2>
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

        {/* Question Prompt */}
        <div className="bingo-question-box">
          <p className="bingo-question-text">{activeBingo.question}</p>
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
                <span className="bingo-option-label">{opt}</span>
              </button>
            );
          })}
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
}
