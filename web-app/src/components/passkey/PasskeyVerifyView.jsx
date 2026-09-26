import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { functions } from '../../firebase-config';
import './passkey.css';

const PasskeyVerifyView = () => {
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const bingoId = searchParams.get('bingoId');

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [latencySec, setLatencySec] = useState(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) {
      setStatus('error');
      setErrorMessage('This browser or device does not support biometric passkeys. Please scan using Safari (iOS) or Chrome (Android).');
      return;
    }

    if (!classId || !bingoId) {
      setStatus('error');
      setErrorMessage('Missing attendance challenge parameters. Please scan the QR code on your lab PC screen.');
      return;
    }

    // Auto-trigger biometric verification once loaded
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      executeBiometricVerification();
    }
  }, [classId, bingoId]);

  const executeBiometricVerification = async () => {
    setStatus('authenticating');
    setErrorMessage('');
    const startTime = Date.now();

    try {
      // 1. Request authentication options for this bingo challenge
      const getOptionsFn = httpsCallable(functions, 'getPasskeyAuthOptions');
      const optionsRes = await getOptionsFn({
        classId,
        bingoId,
        clientRpId: window.location.hostname,
      });

      const data = optionsRes.data;
      if (data.alreadyPassed) {
        setAlreadyVerified(true);
        setStatus('success');
        return;
      }

      if (data.error === 'no_passkey') {
        setStatus('error');
        setErrorMessage(data.message || 'No paired phone found for this student account. Please pair your phone first or notify your instructor for in-person check.');
        return;
      }

      if (data.studentEmail) {
        setStudentEmail(data.studentEmail);
      }

      // 2. Trigger native OS biometric authentication prompt (Face ID / Fingerprint)
      let assertionResponse;
      try {
        assertionResponse = await startAuthentication({ optionsJSON: data.options });
      } catch (biometricErr) {
        if (biometricErr.name === 'NotAllowedError') {
          setStatus('ready');
          setErrorMessage('Biometric check was cancelled. Tap "Verify Biometric Passkey" to try again.');
          return;
        }
        throw biometricErr;
      }

      setStatus('submitting');
      const timeToCompleteMillis = Date.now() - startTime;

      // 3. Verify assertion cryptographically on Cloud Functions
      const verifyFn = httpsCallable(functions, 'verifyPasskeyAuth');
      const verifyRes = await verifyFn({
        classId,
        bingoId,
        assertionResponse,
        clientRpId: window.location.hostname,
        timeToCompleteMillis,
      });

      if (verifyRes.data?.verified) {
        setLatencySec(verifyRes.data?.responseTimeSec || Math.round(timeToCompleteMillis / 100) / 10);
        setStatus('success');
      } else {
        throw new Error('Biometric assertion could not be verified by server.');
      }
    } catch (err) {
      console.error('[PasskeyVerifyView] Authentication error:', err);
      setStatus('error');
      const msg = err.message || '';
      if (msg.includes('Credential mismatch')) {
        setErrorMessage('Credential mismatch: This phone does not belong to the student account active on the PC.');
      } else if (msg.includes('not found')) {
        setErrorMessage('This attendance challenge has already expired or ended.');
      } else {
        setErrorMessage(msg || 'Biometric verification failed. Please try again.');
      }
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'success' ? (
          <>
            <div className="passkey-icon-badge success">✅</div>
            <h1 className="passkey-title">Verified Present!</h1>
            <p className="passkey-subtitle">
              {alreadyVerified
                ? 'Your attendance has already been confirmed.'
                : 'Biometric passkey verified in seconds!'}
            </p>

            <div className="passkey-info-box">
              {studentEmail && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Student</span>
                  <span className="passkey-info-value">{studentEmail}</span>
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
              🎉 Your lab PC screen has updated automatically. You may close this window.
            </div>
          </>
        ) : (
          <>
            <div className={`passkey-icon-badge ${status === 'error' ? 'error' : ''}`}>
              {status === 'error' ? '⚠️' : '📱'}
            </div>
            <h1 className="passkey-title">Attendance Check</h1>
            <p className="passkey-subtitle">
              Verify your physical lab attendance with Face ID or Fingerprint.
            </p>

            {errorMessage && (
              <div className="passkey-alert passkey-alert-error">
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              className="passkey-btn passkey-btn-primary"
              onClick={executeBiometricVerification}
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
                  <span>Verifying Attendance...</span>
                </>
              ) : (
                <>
                  <span>🔐</span>
                  <span>Verify Biometric Passkey</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PasskeyVerifyView;
