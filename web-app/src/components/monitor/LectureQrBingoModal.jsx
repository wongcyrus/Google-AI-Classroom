import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../../firebase-config';
import {
  computeClientLectureQrToken,
  LECTURE_QR_ROTATION_INTERVAL_MS,
} from '../../utils/lectureQrCrypto';
import { getStudentDisplayName } from '../../utils/studentDisplayUtils';
import './LectureQrBingoModal.css';

export default function LectureQrBingoModal({
  show,
  onClose,
  classId,
  className,
  totalStudentsCount = 0,
  timeLimitSeconds = 90,
  defaultRotationIntervalSeconds = 15,
  onViewResults,
}) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rotationIntervalSec, setRotationIntervalSec] = useState(defaultRotationIntervalSeconds || 15);

  const [currentToken, setCurrentToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [rotationProgress, setRotationProgress] = useState(100);
  const [responsesMap, setResponsesMap] = useState({});
  const [timeRemainingSec, setTimeRemainingSec] = useState(timeLimitSeconds);

  const sessionRef = useRef(null);
  const intervalIndexRef = useRef(0);

  // Initialize session on mount
  useEffect(() => {
    if (!show || !classId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    const initSession = async () => {
      try {
        const createSessionFn = httpsCallable(functions, 'createLectureBingoSession');
        const res = await createSessionFn({
          classId,
          timeLimitSeconds,
          rotationIntervalSeconds: rotationIntervalSec,
        });

        if (!isMounted) return;

        const sessionData = res.data;
        setSession(sessionData);
        sessionRef.current = sessionData;

        // Generate initial token using selected rotation interval
        const intervalMs = (rotationIntervalSec || 15) * 1000;
        const initialInterval = Math.floor(Date.now() / intervalMs);
        intervalIndexRef.current = initialInterval;
        const initialTok = await computeClientLectureQrToken(sessionData.sessionSecret, initialInterval);
        setCurrentToken(initialTok);

        setLoading(false);
      } catch (err) {
        console.error('[LectureQrBingoModal] Error creating lecture session:', err);
        if (isMounted) {
          setError(err.message || 'Failed to initialize lecture QR session.');
          setLoading(false);
        }
      }
    };

    initSession();

    return () => {
      isMounted = false;
    };
  }, [show, classId, timeLimitSeconds, rotationIntervalSec]);

  // Real-time listener for student check-ins
  useEffect(() => {
    if (!session?.bingoId || !classId) return;

    const bingoDocRef = doc(db, 'classes', classId, 'bingoRecords', session.bingoId);
    const unsubscribe = onSnapshot(bingoDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setResponsesMap(data.responses || {});
      }
    });

    return () => unsubscribe();
  }, [session?.bingoId, classId]);

  // Dynamic QR Token Rotation & Countdown Loop (every 100ms)
  useEffect(() => {
    if (!session?.sessionSecret) return;

    const timer = setInterval(async () => {
      const now = Date.now();
      const intervalMs = (rotationIntervalSec || 15) * 1000;
      const currentInterval = Math.floor(now / intervalMs);
      const elapsedInInterval = now % intervalMs;
      const progress = Math.max(0, 100 - (elapsedInInterval / intervalMs) * 100);
      setRotationProgress(progress);

      // Remaining total challenge time
      if (session.expiresAtMillis) {
        const rem = Math.max(0, Math.ceil((session.expiresAtMillis - now) / 1000));
        setTimeRemainingSec(rem);
      }

      // Check if interval rotated
      if (currentInterval !== intervalIndexRef.current) {
        intervalIndexRef.current = currentInterval;
        const nextTok = await computeClientLectureQrToken(session.sessionSecret, currentInterval);
        setCurrentToken(nextTok);
      }
    }, 100);

    return () => clearInterval(timer);
  }, [session, rotationIntervalSec]);

  // Re-generate QR Code image when token updates
  useEffect(() => {
    if (!session?.bingoId || !currentToken || !classId) return;

    const verifyUrl = `${window.location.origin}/lecture-verify?classId=${encodeURIComponent(classId)}&bingoId=${encodeURIComponent(session.bingoId)}&token=${encodeURIComponent(currentToken)}`;

    QRCode.toDataURL(verifyUrl, {
      width: 320,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    }).then((url) => {
      setQrDataUrl(url);
    }).catch((err) => {
      console.warn('[LectureQrBingoModal] Error generating QR image:', err);
    });
  }, [session?.bingoId, currentToken, classId]);

  if (!show) return null;

  const responsesList = Object.values(responsesMap).sort((a, b) => (a.rank || 999) - (b.rank || 999));
  const verifiedCount = responsesList.length;
  const targetTotal = Math.max(totalStudentsCount, verifiedCount, 1);
  const attendancePercentage = Math.min(100, Math.round((verifiedCount / targetTotal) * 100));

  return (
    <div className="lecture-qr-overlay" role="dialog" aria-modal="true" aria-labelledby="lecture-qr-title">
      <div className="lecture-qr-modal">
        {/* Header */}
        <div className="lecture-qr-header">
          <div className="lecture-qr-title-area">
            <div className="lecture-qr-icon-badge">📽️</div>
            <div>
              <h2 id="lecture-qr-title" className="lecture-qr-title">Lecture Hall Dynamic QR Check-In</h2>
              <p className="lecture-qr-subtitle">
                {className || classId} • Rotating Anti-Spoofing Biometric Passkey Verification
              </p>
            </div>
          </div>
          <div className="lecture-qr-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255, 255, 255, 0.08)', padding: '0.35rem 0.65rem', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.15)' }}>
              <label htmlFor="lecture-rotation-select" style={{ fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, margin: 0, whiteSpace: 'nowrap' }}>
                ⏱️ Rotation:
              </label>
              <select
                id="lecture-rotation-select"
                value={rotationIntervalSec}
                onChange={e => setRotationIntervalSec(Number(e.target.value))}
                style={{
                  background: '#1e293b',
                  color: '#f8fafc',
                  border: '1px solid #475569',
                  borderRadius: '6px',
                  padding: '0.2rem 0.4rem',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                  outline: 'none',
                }}
                data-testid="lecture-rotation-select"
                title="Set how often the anti-spoofing QR code rotates"
              >
                <option value={10}>10s (Fast)</option>
                <option value={15}>15s (Default)</option>
                <option value={20}>20s (Relaxed)</option>
                <option value={30}>30s (Slow)</option>
                <option value={45}>45s</option>
                <option value={60}>60s (1 min)</option>
              </select>
            </div>
            <button
              type="button"
              className="lecture-qr-close-btn"
              onClick={onClose}
              aria-label="Close modal"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="lecture-qr-body">
          {/* Left Column: QR Code & Rotation Status */}
          <div className="lecture-qr-code-section">
            {loading ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '3rem 0', color: '#64748b' }}>
                <div style={{ width: '40px', height: '40px', border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span>Initializing Lecture Passkey Challenge...</span>
              </div>
            ) : error ? (
              <div style={{ color: '#dc2626', textAlign: 'center', padding: '2rem 1rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚠️</div>
                <div style={{ fontWeight: 600 }}>{error}</div>
              </div>
            ) : (
              <>
                <div className="lecture-qr-frame">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt="Lecture Hall Dynamic Attendance QR Code"
                      className="lecture-qr-image"
                    />
                  ) : (
                    <div style={{ width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
                      Generating QR...
                    </div>
                  )}
                </div>

                {/* Rotating Progress Bar */}
                <div className="lecture-qr-rotation-status">
                  <div className="lecture-qr-rotation-bar-track">
                    <div
                      className="lecture-qr-rotation-bar-fill"
                      style={{ width: `${rotationProgress}%` }}
                    />
                  </div>
                  <div className="lecture-qr-rotation-label">
                    <span>⚡ Anti-Spoofing Token</span>
                    <span>Rotates in {Math.ceil((rotationProgress / 100) * rotationIntervalSec)}s</span>
                  </div>
                </div>

                <p className="lecture-qr-prompt-instruction">
                  📱 Point your mobile phone camera at the screen to scan. Face ID / Fingerprint required.
                </p>
              </>
            )}
          </div>

          {/* Right Column: Live Attendees & Speed Leaderboard */}
          <div className="lecture-qr-stats-section">
            {/* Live Counter */}
            <div className="lecture-qr-counter-card">
              <div>
                <div className="lecture-qr-counter-label">👥 Checked In</div>
                <div className="lecture-qr-progress-track" style={{ width: '160px' }}>
                  <div
                    className="lecture-qr-progress-fill"
                    style={{ width: `${attendancePercentage}%` }}
                  />
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="lecture-qr-counter-number">{verifiedCount}</span>
                {totalStudentsCount > 0 && (
                  <span className="lecture-qr-counter-total"> / {totalStudentsCount}</span>
                )}
              </div>
            </div>

            {/* Realtime Check-In Feed / Speed Leaderboard */}
            <div className="lecture-qr-feed-card">
              <div className="lecture-qr-feed-header">
                <span>⚡ Live Check-In Feed ({verifiedCount})</span>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  ⏳ Time Remaining: <strong>{timeRemainingSec}s</strong>
                </span>
              </div>

              {responsesList.length === 0 ? (
                <div className="lecture-qr-feed-empty">
                  <span>Waiting for students to scan the projector screen...</span>
                </div>
              ) : (
                <ul className="lecture-qr-feed-list">
                  {responsesList.map((resp, idx) => {
                    const rank = idx + 1;
                    const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
                    return (
                      <li key={resp.studentUid || idx} className="lecture-qr-feed-item">
                        <div className="lecture-qr-feed-student">
                          <span className={`lecture-qr-feed-rank ${rankClass}`}>
                            {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
                          </span>
                          <span>{resp.studentEmail ? resp.studentEmail.split('@')[0] : (resp.studentUid || 'Student')}</span>
                        </div>
                        <div className="lecture-qr-feed-speed">
                          ⚡ {resp.responseTimeSec || 2.0}s
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="lecture-qr-footer">
          <div className="lecture-qr-footer-left">
            <span>🔐 Hardware Passkey Enforced</span>
            <span>•</span>
            <span>1-Phone = 1-Student Lock</span>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            {onViewResults && (
              <button
                type="button"
                className="lecture-qr-btn lecture-qr-btn-secondary"
                onClick={() => {
                  onClose();
                  onViewResults();
                }}
              >
                📊 View Results Grid
              </button>
            )}
            <button
              type="button"
              className="lecture-qr-btn lecture-qr-btn-primary"
              onClick={onClose}
            >
              ✅ Finish Check-In
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
