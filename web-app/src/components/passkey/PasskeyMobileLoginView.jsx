import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { isHandheldPhone } from '../../utils/browserDetection';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import './passkey.css';

const PasskeyMobileLoginView = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session') || searchParams.get('sessionId');
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked'
  const [errorMessage, setErrorMessage] = useState('');
  const [studentEmail, setStudentEmail] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const hasAutoStarted = useRef(false);

  useEffect(() => {
    // 1. Strict anti-desktop & anti-tablet enforcement: Handheld smartphone hardware only
    if (!isHandheldPhone()) {
      setStatus('desktop_blocked');
      setErrorMessage(
        'Desktop and tablet passkey logins are strictly prohibited on shared computer laboratory devices. ' +
        'Please point your personal smartphone camera (iOS Safari or Android Chrome) at the QR code displayed on the screen.'
      );
      return;
    }

    // 2. Browser WebAuthn capability check
    if (!browserSupportsWebAuthn()) {
      setStatus('error');
      setErrorMessage(
        'This mobile browser does not support biometric passkeys. ' +
        'Please open this link in your phone\'s default browser (Safari on iPhone or Chrome on Android).'
      );
      return;
    }

    // 3. Session parameter presence check
    if (!sessionId) {
      setStatus('error');
      setErrorMessage('Missing login session ID. Please scan the QR code displayed on your lab desktop screen.');
      return;
    }

    // 4. Ready to authenticate
    setStatus('ready');

    // Auto-prompt once on initial load
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      executePasskeyLogin();
    }
  }, [sessionId, token]);

  const executePasskeyLogin = async () => {
    if (!sessionId) return;
    setStatus('authenticating');
    setErrorMessage('');

    try {
      // 1. Fetch authentication challenge options from Cloud Function
      const getOptionsFn = httpsCallable(functions, 'getDesktopLoginPasskeyOptions');
      const optionsRes = await getOptionsFn({
        sessionId,
        token,
        clientRpId: window.location.hostname,
      });

      const { options } = optionsRes.data || {};
      if (!options) {
        throw new Error('Failed to retrieve passkey challenge options from server.');
      }

      // 2. Trigger native OS Face ID / Fingerprint prompt
      let authenticationResponse;
      try {
        authenticationResponse = await startAuthentication({ optionsJSON: options });
      } catch (authErr) {
        console.error('[PasskeyMobileLoginView] WebAuthn biometric error:', authErr);
        if (authErr.name === 'NotAllowedError') {
          setStatus('ready');
          setErrorMessage('Biometric scan was cancelled. Tap the button below to try again.');
          return;
        }
        throw new Error(authErr.message || 'Biometric authentication cancelled or failed.');
      }

      // 3. Submit assertion to server to verify signature and mint custom auth token for desktop
      setStatus('submitting');
      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyDesktopLoginPasskey');
      const verifyRes = await verifyFn({
        sessionId,
        token,
        authenticationResponse,
        clientRpId: window.location.hostname,
        deviceFingerprint,
      });

      const data = verifyRes.data || {};
      if (data.verified) {
        setStudentEmail(data.studentEmail || '');
        setDeviceModel(data.deviceModel || '');
        setStatus('success');
      } else {
        throw new Error('Passkey verification failed on server.');
      }
    } catch (err) {
      console.error('[PasskeyMobileLoginView] Verification failed:', err);
      setStatus('error');
      setErrorMessage(err.message || 'Passkey login failed. Please ensure this phone was paired with your student account.');
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'initializing' && (
          <>
            <div className="passkey-icon-badge">📱</div>
            <h1 className="passkey-title">Desktop Passkey Sign-In</h1>
            <p className="passkey-subtitle">Connecting to your desktop session...</p>
            <div className="passkey-spinner" />
          </>
        )}

        {status === 'desktop_blocked' && (
          <>
            <div className="passkey-icon-badge error">🚫</div>
            <h1 className="passkey-title">Shared PC Detected</h1>
            <p className="passkey-subtitle" style={{ color: '#f87171' }}>
              Desktop Passkeys Strictly Prohibited
            </p>
            <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: '1.5', color: '#fca5a5' }}>
                {errorMessage}
              </p>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
              To ensure account integrity on shared lab computers, passkeys reside exclusively in your personal smartphone's Secure Enclave.
            </p>
          </>
        )}

        {status === 'ready' && (
          <>
            <div className="passkey-icon-badge">📱</div>
            <h1 className="passkey-title">Unlock Lab Desktop</h1>
            <p className="passkey-subtitle">
              Verify your identity with your mobile passkey (Face ID / Fingerprint) to instantly sign in on your lab PC.
            </p>
            {errorMessage && (
              <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)', marginBottom: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#fca5a5' }}>{errorMessage}</p>
              </div>
            )}
            <button
              type="button"
              className="passkey-btn primary"
              onClick={executePasskeyLogin}
            >
              📱 Sign In with Biometrics
            </button>
          </>
        )}

        {status === 'authenticating' && (
          <>
            <div className="passkey-icon-badge">👆</div>
            <h1 className="passkey-title">Touch Biometric Sensor</h1>
            <p className="passkey-subtitle">
              Please authenticate using Face ID or your phone's fingerprint sensor...
            </p>
            <div className="passkey-spinner" />
          </>
        )}

        {status === 'submitting' && (
          <>
            <div className="passkey-icon-badge">🔐</div>
            <h1 className="passkey-title">Authorizing Desktop...</h1>
            <p className="passkey-subtitle">Validating passkey signature and establishing secure desktop session...</p>
            <div className="passkey-spinner" />
          </>
        )}

        {status === 'success' && (
          <>
            <div className="passkey-icon-badge success">✅</div>
            <h1 className="passkey-title" style={{ color: '#34d399' }}>Desktop Signed In!</h1>
            <p className="passkey-subtitle">
              Your identity has been verified. Your desktop computer is now signed in and unlocking your workspace.
            </p>
            <div className="passkey-info-box">
              {studentEmail && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Account</span>
                  <span className="passkey-info-value" style={{ color: '#38bdf8' }}>{studentEmail}</span>
                </div>
              )}
              {deviceModel && (
                <div className="passkey-info-row">
                  <span className="passkey-info-label">Paired Phone</span>
                  <span className="passkey-info-value">{deviceModel}</span>
                </div>
              )}
              <div className="passkey-info-row">
                <span className="passkey-info-label">Status</span>
                <span className="passkey-info-value" style={{ color: '#34d399' }}>Unlocked & Authorized</span>
              </div>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
              You may safely close this browser window.
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="passkey-icon-badge error">❌</div>
            <h1 className="passkey-title">Sign-In Failed</h1>
            <p className="passkey-subtitle" style={{ color: '#f87171' }}>
              Could not verify passkey
            </p>
            <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' }}>
              <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: '1.5', color: '#fca5a5' }}>
                {errorMessage}
              </p>
            </div>
            <button
              type="button"
              className="passkey-btn primary"
              onClick={executePasskeyLogin}
            >
              🔄 Try Again
            </button>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '1rem' }}>
              If your phone has not been paired yet, or if you replaced your device, ask your teacher to grant a temporary bypass or reset your passkey lock.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PasskeyMobileLoginView;
