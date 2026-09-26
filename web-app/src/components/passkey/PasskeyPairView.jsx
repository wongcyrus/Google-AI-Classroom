import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { functions } from '../../firebase-config';
import './passkey.css';

const PasskeyPairView = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('idle'); // 'idle' | 'prompting' | 'verifying' | 'success' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const [isSupported, setIsSupported] = useState(true);

  useEffect(() => {
    if (!browserSupportsWebAuthn()) {
      setIsSupported(false);
      setStatus('error');
      setErrorMessage('Your browser or device does not support WebAuthn biometric passkeys. Please use Safari (iOS) or Chrome (Android).');
    }
  }, []);

  const handlePairDevice = async () => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Missing pairing token. Please scan the QR code displayed on your lab PC.');
      return;
    }

    setStatus('prompting');
    setErrorMessage('');

    try {
      // 1. Fetch WebAuthn registration options from Cloud Function
      const getOptionsFn = httpsCallable(functions, 'getPasskeyRegistrationOptions');
      const optionsRes = await getOptionsFn({
        pairingToken: token,
        clientRpId: window.location.hostname,
      });

      const options = optionsRes.data;

      // 2. Trigger native OS biometric registration dialog
      let attestationResponse;
      try {
        attestationResponse = await startRegistration({ optionsJSON: options });
      } catch (biometricErr) {
        if (biometricErr.name === 'NotAllowedError') {
          setStatus('idle');
          setErrorMessage('Biometric prompt was cancelled. Click "Pair This Phone" to try again.');
          return;
        }
        throw biometricErr;
      }

      setStatus('verifying');

      // Detect user device model description
      const userAgent = navigator.userAgent || '';
      let detectedModel = 'Mobile Phone';
      if (/iPhone/i.test(userAgent)) detectedModel = 'Apple iPhone';
      else if (/iPad/i.test(userAgent)) detectedModel = 'Apple iPad';
      else if (/Android/i.test(userAgent)) detectedModel = 'Android Device';

      // 3. Verify attestation and enforce 1-phone = 1-student hardware lock on server
      const verifyFn = httpsCallable(functions, 'verifyPasskeyRegistration');
      const verifyRes = await verifyFn({
        pairingToken: token,
        attestationResponse,
        clientRpId: window.location.hostname,
        deviceModel: detectedModel,
      });

      if (verifyRes.data?.verified) {
        setDeviceModel(verifyRes.data?.deviceModel || detectedModel);
        setStatus('success');
      } else {
        throw new Error('Registration could not be verified by server.');
      }
    } catch (err) {
      console.error('[PasskeyPairView] Pairing error:', err);
      setStatus('error');
      // Format friendly error messages
      const msg = err.message || '';
      if (msg.includes('already registered to another student')) {
        setErrorMessage('This physical phone is already registered to another student. Devices cannot be shared.');
      } else if (msg.includes('already been used')) {
        setErrorMessage('This pairing token has already been used. Please refresh the QR code on your PC screen.');
      } else if (msg.includes('expired')) {
        setErrorMessage('This pairing QR code has expired. Please refresh the QR code on your PC screen.');
      } else {
        setErrorMessage(msg || 'Failed to complete passkey registration. Please try again.');
      }
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'success' ? (
          <>
            <div className="passkey-icon-badge success">🎉</div>
            <h1 className="passkey-title">Phone Paired!</h1>
            <p className="passkey-subtitle">
              Your device is now securely bound to your student account.
            </p>
            <div className="passkey-info-box">
              <div className="passkey-info-row">
                <span className="passkey-info-label">Device</span>
                <span className="passkey-info-value">{deviceModel || 'Mobile Device'}</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Security</span>
                <span className="passkey-info-value">Hardware Secure Enclave</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Status</span>
                <span className="passkey-info-value" style={{ color: '#10b981' }}>Active & Ready</span>
              </div>
            </div>
            <div className="passkey-alert passkey-alert-success">
              ✅ You can now close this tab. When attendance Bingo is called, point your camera at the screen for instant verification!
            </div>
          </>
        ) : (
          <>
            <div className={`passkey-icon-badge ${status === 'error' ? 'error' : ''}`}>
              {status === 'error' ? '⚠️' : '📱'}
            </div>
            <h1 className="passkey-title">Pair Your Phone</h1>
            <p className="passkey-subtitle">
              Enable instant, passwordless in-class attendance using Face ID or Fingerprint.
            </p>

            {errorMessage && (
              <div className="passkey-alert passkey-alert-error">
                {errorMessage}
              </div>
            )}

            <div className="passkey-info-box">
              <div className="passkey-info-row">
                <span className="passkey-info-label">Zero Passwords</span>
                <span className="passkey-info-value">Uses Device Biometrics</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Attendance Speed</span>
                <span className="passkey-info-value">~2 Seconds per Check</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Device Lock</span>
                <span className="passkey-info-value">1 Phone per Student</span>
              </div>
            </div>

            <button
              type="button"
              className="passkey-btn passkey-btn-primary"
              onClick={handlePairDevice}
              disabled={status === 'prompting' || status === 'verifying' || !isSupported}
            >
              {status === 'prompting' ? (
                <>
                  <span className="passkey-spinner" />
                  <span>Verify Face ID / Fingerprint...</span>
                </>
              ) : status === 'verifying' ? (
                <>
                  <span className="passkey-spinner" />
                  <span>Securing Hardware Key...</span>
                </>
              ) : (
                <>
                  <span>🔐</span>
                  <span>Pair This Phone</span>
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default PasskeyPairView;
