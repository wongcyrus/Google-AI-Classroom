import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { isHandheldPhone } from '../../utils/browserDetection';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import './passkey.css';

export default function LecturePasskeyVerifyView() {
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const bingoId = searchParams.get('bingoId');
  const token = searchParams.get('token');

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked'
  const [errorMessage, setErrorMessage] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [latencySec, setLatencySec] = useState(null);
  const [rank, setRank] = useState(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    if (!isHandheldPhone()) {
      setStatus('desktop_blocked');
      setErrorMessage('Lecture hall attendance check-in must be performed from your personal handheld smartphone. Tablets and laptops cannot be registered as mobile passkeys. Please scan the QR code displayed on the lecture hall screen with your phone camera.');
      return;
    }

    if (!browserSupportsWebAuthn()) {
      setStatus('error');
      setErrorMessage('This mobile browser does not support biometric passkeys. Please scan using Safari (iOS) or Chrome (Android).');
      return;
    }

    if (!classId || !bingoId || !token) {
      setStatus('error');
      setErrorMessage('Missing attendance parameters or token. Please scan the live QR code on the lecture projector screen.');
      return;
    }

    // Auto-trigger biometric verification on load
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      executeLectureBiometricAuth();
    }
  }, [classId, bingoId, token]);

  const executeLectureBiometricAuth = async () => {
    setStatus('authenticating');
    setErrorMessage('');
    const startTime = Date.now();

    try {
      // 1. Request authentication options for this dynamic lecture challenge
      const getOptionsFn = httpsCallable(functions, 'getLecturePasskeyAuthOptions');
      const optionsRes = await getOptionsFn({
        classId,
        bingoId,
        token,
        clientRpId: window.location.hostname,
      });

      const data = optionsRes.data;
      if (!data || !data.options) {
        throw new Error('Could not obtain biometric options for this lecture session.');
      }

      // 2. Trigger native OS biometric authentication prompt (Face ID / Fingerprint)
      let assertionResponse;
      try {
        assertionResponse = await startAuthentication({ optionsJSON: data.options });
      } catch (biometricErr) {
        if (biometricErr.name === 'NotAllowedError') {
          setStatus('ready');
          setErrorMessage('Biometric check was cancelled. Tap "Verify Biometric Passkey" below to try again.');
          return;
        }
        throw biometricErr;
      }

      setStatus('submitting');
      const timeToCompleteMillis = Date.now() - startTime;

      // 3. Verify assertion cryptographically on Cloud Functions
      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyLecturePasskeyAuth');
      const verifyRes = await verifyFn({
        classId,
        bingoId,
        challengeId: data.challengeId,
        token,
        assertionResponse,
        clientRpId: window.location.hostname,
        timeToCompleteMillis,
        deviceFingerprint,
      });

      const result = verifyRes.data;
      if (result?.verified) {
        setStudentEmail(result.studentEmail || '');
        setLatencySec(result.responseTimeSec || Math.round(timeToCompleteMillis / 100) / 10);
        setRank(result.rank || null);
        setAlreadyVerified(Boolean(result.alreadyVerified));
        setStatus('success');
      } else {
        throw new Error('Biometric assertion could not be verified by server.');
      }
    } catch (err) {
      console.error('[LecturePasskeyVerifyView] Authentication error:', err);
      setStatus('error');
      const msg = err.message || '';
      if (msg.includes('Expired or invalid QR code') || msg.includes('token has expired') || msg.toLowerCase().includes('expired')) {
        setErrorMessage('This QR token has expired. The projector screen rotates periodically for security. Please scan the current live code on the screen.');
      } else if (msg.includes('not paired') || msg.includes('not registered')) {
        setErrorMessage('This phone is not paired with your student account. Please pair your phone with your account first.');
      } else if (msg.includes('Device Mismatch')) {
        setErrorMessage('Device Mismatch: Attendance must be verified using your registered mobile phone.');
      } else {
        setErrorMessage(msg || 'Biometric verification failed. Please try scanning again.');
      }
    }
  };

  const isTokenExpiredOrInvalid = Boolean(
    status === 'error' &&
    errorMessage &&
    (errorMessage.toLowerCase().includes('expired') ||
     errorMessage.toLowerCase().includes('invalid qr') ||
     errorMessage.toLowerCase().includes('missing'))
  );

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'desktop_blocked' ? (
          <>
            <div className="passkey-icon-badge error">🚫</div>
            <h1 className="passkey-title">Mobile Phone Required</h1>
            <p className="passkey-subtitle">
              Desktop browser check-in is not permitted.
            </p>
            <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5 }}>
              {errorMessage}
            </div>
          </>
        ) : status === 'success' ? (
          <>
            <div className="passkey-icon-badge success">🎉</div>
            <h1 className="passkey-title">Verified Present!</h1>
            <p className="passkey-subtitle">
              {alreadyVerified
                ? 'Your lecture hall attendance has already been confirmed.'
                : 'Biometric passkey verified in seconds!'}
            </p>

            <div className="passkey-info-box">
              {studentEmail && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Student</span>
                  <span className="passkey-info-value">{studentEmail}</span>
                </div>
              )}
              {rank && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Rank</span>
                  <span className="passkey-info-value" style={{ color: '#4f46e5', fontWeight: 800 }}>
                    {rank === 1 ? '🥇 1st in Hall' : rank === 2 ? '🥈 2nd in Hall' : rank === 3 ? '🥉 3rd in Hall' : `#${rank}`}
                  </span>
                </div>
              )}
              {latencySec !== null && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Speed</span>
                  <span className="passkey-info-value">{latencySec}s</span>
                </div>
              )}
              <div className="passkey-info-row">
                <span className="passkey-info-label">Verification</span>
                <span className="passkey-info-value" style={{ color: '#10b981' }}>Hardware Passkey</span>
              </div>
            </div>

            <div className="passkey-alert passkey-alert-success">
              ✅ Your attendance is recorded live on the lecture screen. You may close this window.
            </div>
          </>
        ) : (
          <>
            <div className={`passkey-icon-badge ${status === 'error' ? 'error' : ''}`}>
              {status === 'error' ? '⚠️' : '📽️'}
            </div>
            <h1 className="passkey-title">Lecture Hall Check-In</h1>
            <p className="passkey-subtitle">
              Verify your physical lecture attendance with Face ID or Fingerprint.
            </p>

            {errorMessage && (
              <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.4 }}>
                {errorMessage}
              </div>
            )}

            {isTokenExpiredOrInvalid ? (
              <div style={{ marginTop: '1.25rem', padding: '1.25rem 1rem', background: '#f8fafc', borderRadius: '10px', border: '1px dashed #cbd5e1', textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>📸</div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: '0.95rem', marginBottom: '0.35rem' }}>
                  QR Code Expired
                </div>
                <p style={{ margin: 0, color: '#64748b', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  Please point your phone camera at the projector screen to scan the active live QR code.
                </p>
              </div>
            ) : (
              <button
                type="button"
                className="passkey-btn passkey-btn-primary"
                onClick={executeLectureBiometricAuth}
                disabled={status === 'authenticating' || status === 'submitting'}
              >
                {status === 'authenticating' ? (
                  <>
                    <span className="passkey-spinner" />
                    <span>Scanning Face ID / Fingerprint...</span>
                  </>
                ) : status === 'submitting' ? (
                  <>
                    <span className="passkey-spinner" />
                    <span>Verifying Lecture Attendance...</span>
                  </>
                ) : (
                  <>
                    <span>🔐</span>
                    <span>Verify Biometric Passkey</span>
                  </>
                )}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
