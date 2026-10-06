import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import {
  isHandheldPhone,
  isSupportedBrowser,
  getBrowserName,
  isAndroidDevice,
  isIOSDevice,
  getAndroidChromeIntentUrl,
} from '../../utils/browserDetection';
import {
  normalizePasskeyError,
  checkPlatformAuthenticatorAvailable,
} from '../../utils/passkeyErrorUtils';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import './passkey.css';

const PasskeyPairView = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('idle'); // 'idle' | 'prompting' | 'verifying' | 'success' | 'error' | 'desktop_blocked' | 'unsupported_browser'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [deviceModel, setDeviceModel] = useState('');
  const [isSupported, setIsSupported] = useState(true);
  const isIOSChrome = typeof navigator !== 'undefined' && /CriOS\//i.test(navigator.userAgent || '');
  const detectedBrowser = getBrowserName();
  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const chromeIntentUrl = typeof window !== 'undefined' ? getAndroidChromeIntentUrl(window.location.href) : '';

  useEffect(() => {
    // 1. Strict mobile handheld enforcement
    if (!isHandheldPhone()) {
      setIsSupported(false);
      setStatus('desktop_blocked');
      setErrorMessage('Mobile Passkeys must be registered on your personal handheld smartphone (iOS or Android) to enable biometric attendance. Shared desktop computers and tablets/iPads cannot be registered as mobile passkeys. Please scan the QR code displayed on your screen using your smartphone camera.');
      return;
    }

    // 2. Strict Browser Whitelist: Only Google Chrome and Apple Safari supported
    if (!isSupportedBrowser()) {
      setIsSupported(false);
      setStatus('unsupported_browser');
      setErrorMessage(`This classroom assistant strictly supports Google Chrome and Apple Safari. Detected: ${detectedBrowser}.`);
      return;
    }

    // 3. WebAuthn platform capability
    if (!browserSupportsWebAuthn()) {
      setIsSupported(false);
      setStatus('error');
      const errDiag = normalizePasskeyError('Your mobile browser or device does not support WebAuthn biometric passkeys. Please use Safari (iOS) or Chrome (Android).');
      setErrorDetails(errDiag);
      setErrorMessage(errDiag.message);
      return;
    }

  }, [detectedBrowser]);

  const handlePairDevice = async () => {
    if (!token) {
      setStatus('error');
      const errDiag = normalizePasskeyError('Missing pairing token. Please scan the QR code displayed on your lab PC.');
      setErrorDetails(errDiag);
      setErrorMessage('Missing pairing token. Please scan the QR code displayed on your lab PC.');
      return;
    }

    // Pre-flight check for screen lock / biometrics on device
    const isBioAvailable = await checkPlatformAuthenticatorAvailable();
    if (!isBioAvailable && isAndroid) {
      setStatus('error');
      const diag = normalizePasskeyError('provider not found', { isAndroid: true });
      setErrorDetails(diag);
      setErrorMessage(diag.message);
      return;
    }

    setStatus('prompting');
    setErrorMessage('');
    setErrorDetails(null);

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
        const diag = normalizePasskeyError(biometricErr, { isAndroid, isIOS, browserName: detectedBrowser });
        if (diag.type === 'user_cancelled') {
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
      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyPasskeyRegistration');
      const verifyRes = await verifyFn({
        pairingToken: token,
        attestationResponse,
        clientRpId: window.location.hostname,
        deviceModel: detectedModel,
        deviceFingerprint,
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
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      setErrorDetails(diag);
      setErrorMessage(diag.message || 'Failed to complete passkey registration. Please try again.');
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'desktop_blocked' ? (
          <>
            <div className="passkey-icon-badge error">🚫</div>
            <h1 className="passkey-title">Mobile Phone Required</h1>
            <p className="passkey-subtitle">
              Passkey device registration is restricted to personal mobile phones.
            </p>
            <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5 }}>
              {errorMessage}
            </div>
            <div className="passkey-info-box">
              <div className="passkey-info-row">
                <span className="passkey-info-label">Supported Devices</span>
                <span className="passkey-info-value">Apple iPhone / Android Phone</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Lab Desktop PC</span>
                <span className="passkey-info-value" style={{ color: '#ef4444' }}>Blocked (Shared Computer)</span>
              </div>
            </div>
          </>
        ) : status === 'unsupported_browser' ? (
          <>
            <div className="passkey-icon-badge error">🌐</div>
            <h1 className="passkey-title">Unsupported Browser</h1>
            <p className="passkey-subtitle">
              Detected: <strong>{detectedBrowser}</strong>
            </p>
            <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5 }}>
              This classroom assistant strictly supports <strong>Google Chrome</strong> (Android / PC) and <strong>Apple Safari</strong> (iPhone / iOS). Other browsers (including Samsung Internet, Firefox, Edge, Opera) do not sync your passkeys or lab sessions.
            </div>

            {isAndroid && (
              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <a
                  href={chromeIntentUrl}
                  className="passkey-btn passkey-btn-primary"
                  style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  🚀 Open in Google Chrome
                </a>
                <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0, textAlign: 'center' }}>
                  Tip: In Android Settings &gt; Apps &gt; Default apps, set Google Chrome as your Default Browser.
                </p>
              </div>
            )}

            {isIOS && (
              <div className="passkey-alert passkey-alert-warning" style={{ marginTop: '1rem', textAlign: 'left', fontSize: '0.85rem' }}>
                💡 Please open this page in <strong>Apple Safari</strong>. Tap the Share icon and choose <strong>Open in Safari</strong>.
              </div>
            )}
          </>
        ) : status === 'success' ? (
          <>
            <div className="passkey-icon-badge success">🎉</div>
            <h1 className="passkey-title">Phone Paired!</h1>
            <p className="passkey-subtitle">
              Your device is now securely bound to your classroom account.
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
              ✅ You can now close this tab. You can scan the Desktop Login QR code on any lab PC to sign in without typing your password!
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

            {errorDetails ? (
              <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5, marginBottom: '1.25rem' }}>
                <strong style={{ display: 'block', marginBottom: '0.25rem', fontSize: '0.95rem' }}>
                  ⚠️ {errorDetails.title}
                </strong>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.875rem' }}>{errorDetails.message}</p>
                {errorDetails.resolutionSteps?.length > 0 && (
                  <ol style={{ margin: '0.25rem 0 0 1.25rem', padding: 0, fontSize: '0.825rem' }}>
                    {errorDetails.resolutionSteps.map((step, idx) => (
                      <li key={idx} style={{ marginBottom: '0.25rem' }}>{step}</li>
                    ))}
                  </ol>
                )}
                {isAndroid && errorDetails.action === 'open_chrome' && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <a
                      href={chromeIntentUrl}
                      className="passkey-btn passkey-btn-primary"
                      style={{ textDecoration: 'none', display: 'inline-flex', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                    >
                      🚀 Switch to Google Chrome
                    </a>
                  </div>
                )}
              </div>
            ) : errorMessage ? (
              <div className="passkey-alert passkey-alert-error">
                {errorMessage}
              </div>
            ) : null}

            {isIOSChrome && (
              <div className="passkey-alert passkey-alert-warning" style={{ textAlign: 'left', lineHeight: 1.4, fontSize: '0.82rem', marginBottom: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#fbbf24' }}>
                💡 <strong>iPhone Notice:</strong> Open in <strong>Apple Safari</strong> or <strong>Google Chrome</strong> (ensure iCloud Keychain is ON).
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

            {/* Troubleshooting Guide */}
            <details style={{ marginTop: '1.25rem', textAlign: 'left', fontSize: '0.825rem', color: '#64748b', borderTop: '1px solid rgba(226, 232, 240, 0.3)', paddingTop: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem' }}>
                ❓ Troubleshooting Tips (Android & iPhone)
              </summary>
              <div style={{ background: 'rgba(15, 23, 42, 0.3)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(226, 232, 240, 0.1)', lineHeight: 1.5 }}>
                <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🤖 Android Requirements:</strong></p>
                <ul style={{ margin: '0 0 0.65rem 1.25rem', padding: 0 }}>
                  <li>Must use <strong>Google Chrome</strong> (Samsung Internet and other browsers are not supported).</li>
                  <li>Must have a <strong>Screen Lock (Fingerprint, Face Unlock, or PIN)</strong> in Android Settings.</li>
                  <li><strong>Honor / MagicOS 8.0:</strong> Go to Settings &gt; Users &amp; Accounts &gt; turn ON <strong>Google Play Services</strong>, and select <strong>Google</strong> in Settings &gt; System &amp; updates &gt; Language &amp; input &gt; Autofill service.</li>
                  <li>Ensure <strong>Google Password Manager</strong> is enabled in Settings &gt; Passwords &amp; Accounts.</li>
                </ul>
                <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🍎 iPhone Requirements:</strong></p>
                <ul style={{ margin: '0 0 1.25rem', padding: 0 }}>
                  <li>Open in <strong>Apple Safari</strong> or <strong>Google Chrome</strong>.</li>
                  <li>If you use <strong>Microsoft Authenticator</strong>, go to iOS Settings &gt; Passwords &gt; Password Options and ensure <strong>iCloud Passwords &amp; Keychain</strong> is turned ON.</li>
                </ul>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
};

export default PasskeyPairView;
