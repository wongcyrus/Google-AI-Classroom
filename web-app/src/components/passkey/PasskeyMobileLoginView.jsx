import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { startAuthentication, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import {
  isHandheldPhone,
  isSupportedBrowser,
  getBrowserName,
  isAndroidDevice,
  isIOSDevice,
  getAndroidChromeIntentUrl,
} from '../../utils/browserDetection';
import { normalizePasskeyError } from '../../utils/passkeyErrorUtils';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import './passkey.css';

const PasskeyMobileLoginView = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session') || searchParams.get('sessionId');
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked' | 'unsupported_browser'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [studentEmail, setStudentEmail] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const hasAutoStarted = useRef(false);

  const detectedBrowser = getBrowserName();
  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const chromeIntentUrl = typeof window !== 'undefined' ? getAndroidChromeIntentUrl(window.location.href) : '';

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

    // 2. Strict Browser Whitelist: Only Google Chrome and Apple Safari supported
    if (!isSupportedBrowser()) {
      setStatus('unsupported_browser');
      setErrorMessage(`This classroom assistant strictly supports Google Chrome and Apple Safari. Detected: ${detectedBrowser}.`);
      return;
    }

    // 3. Browser WebAuthn capability check
    if (!browserSupportsWebAuthn()) {
      setStatus('error');
      const diag = normalizePasskeyError(
        'This mobile browser does not support biometric passkeys. Please open this link in your phone\'s default browser (Safari on iPhone or Chrome on Android).'
      );
      setErrorDetails(diag);
      setErrorMessage(diag.message);
      return;
    }

    // 4. Session parameter presence check
    if (!sessionId) {
      setStatus('error');
      const diag = normalizePasskeyError('Missing login session ID. Please scan the QR code displayed on your lab desktop screen.');
      setErrorDetails(diag);
      setErrorMessage('Missing login session ID. Please scan the QR code displayed on your lab desktop screen.');
      return;
    }

    // 5. Ready to authenticate
    setStatus('ready');

    // Auto-prompt once on initial load
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      executePasskeyLogin();
    }
  }, [sessionId, token, detectedBrowser]);

  const executePasskeyLogin = async () => {
    if (!sessionId) return;
    setStatus('authenticating');
    setErrorMessage('');
    setErrorDetails(null);

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
        const diag = normalizePasskeyError(authErr, { isAndroid, isIOS, browserName: detectedBrowser });
        if (diag.type === 'user_cancelled') {
          setStatus('ready');
          setErrorMessage('Biometric scan was cancelled. Tap the button below to try again.');
          return;
        }
        throw authErr;
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
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      setErrorDetails(diag);
      setErrorMessage(diag.message || 'Passkey login failed. Please ensure this phone was paired with your student account.');
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

        {status === 'unsupported_browser' && (
          <>
            <div className="passkey-icon-badge error">🌐</div>
            <h1 className="passkey-title">Unsupported Browser</h1>
            <p className="passkey-subtitle">
              Detected: <strong>{detectedBrowser}</strong>
            </p>
            <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5 }}>
              Desktop passkey login strictly supports <strong>Google Chrome</strong> (Android / PC) and <strong>Apple Safari</strong> (iPhone / iOS). Other browsers (such as Samsung Internet, Firefox, Edge, Opera) cannot access your credentials.
            </div>

            {isAndroid && (
              <div style={{ marginTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <a
                  href={chromeIntentUrl}
                  className="passkey-btn primary"
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
        )}

        {status === 'ready' && (
          <>
            <div className="passkey-icon-badge">📱</div>
            <h1 className="passkey-title">Unlock Lab Desktop</h1>
            <p className="passkey-subtitle">
              Verify your identity with your mobile passkey (Face ID / Fingerprint) to instantly sign in on your lab PC.
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
                      className="passkey-btn primary"
                      style={{ textDecoration: 'none', display: 'inline-flex', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                    >
                      🚀 Switch to Google Chrome
                    </a>
                  </div>
                )}
              </div>
            ) : errorMessage ? (
              <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)', marginBottom: '1.25rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#fca5a5' }}>{errorMessage}</p>
              </div>
            ) : null}
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
                      className="passkey-btn primary"
                      style={{ textDecoration: 'none', display: 'inline-flex', padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
                    >
                      🚀 Open in Google Chrome
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.1)' }}>
                <p style={{ margin: 0, fontSize: '0.875rem', lineHeight: '1.5', color: '#fca5a5' }}>
                  {errorMessage}
                </p>
              </div>
            )}

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

        {/* Troubleshooting Guide */}
        <details style={{ marginTop: '1.25rem', textAlign: 'left', fontSize: '0.825rem', color: '#64748b', borderTop: '1px solid rgba(226, 232, 240, 0.2)', paddingTop: '0.85rem' }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem' }}>
            ❓ Having Trouble Signing In?
          </summary>
          <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(226, 232, 240, 0.1)', lineHeight: 1.5 }}>
            <p style={{ margin: '0 0 0.35rem 0', color: '#f59e0b' }}><strong>📱 Not Paired Yet?</strong></p>
            <ul style={{ margin: '0 0 0.65rem 1.25rem', padding: 0 }}>
              <li>If your phone is not paired yet, switch to the "Email &amp; Password" tab on your desktop screen to sign in. Once signed in, pair your phone from your student profile.</li>
            </ul>
            <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🤖 Android Users:</strong></p>
            <ul style={{ margin: '0 0 0.65rem 1.25rem', padding: 0 }}>
              <li>Open this link in <strong>Google Chrome</strong> (Samsung Internet and other browsers are not supported).</li>
              <li><strong>Honor / MagicOS 8.0:</strong> Go to Settings &gt; Users &amp; Accounts &gt; turn ON <strong>Google Play Services</strong>, and select <strong>Google</strong> as Autofill service in Settings &gt; System &amp; updates &gt; Language &amp; input.</li>
            </ul>
            <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🍎 iPhone Users:</strong></p>
            <ul style={{ margin: '0 0 1.25rem', padding: 0 }}>
              <li>Open this link in <strong>Apple Safari</strong> or <strong>Google Chrome</strong>.</li>
              <li>If you use Microsoft Authenticator, ensure <strong>iCloud Passwords &amp; Keychain</strong> is turned ON in iOS Settings &gt; Passwords &gt; Password Options.</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
};

export default PasskeyMobileLoginView;
