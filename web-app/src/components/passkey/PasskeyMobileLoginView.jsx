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
  getAndroidCameraAppIntentUrl,
} from '../../utils/browserDetection';
import { normalizePasskeyError } from '../../utils/passkeyErrorUtils';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import PasskeyPasswordFallbackForm from './PasskeyPasswordFallbackForm';
import CameraQrScannerModal from './CameraQrScannerModal';
import './passkey.css';

const PasskeyMobileLoginView = () => {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session') || searchParams.get('sessionId');
  const token = searchParams.get('token') || '';

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked' | 'unsupported_browser' | 'password_fallback'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [studentEmail, setStudentEmail] = useState('');
  const [deviceModel, setDeviceModel] = useState('');
  const hasAutoStarted = useRef(false);

  const detectedBrowser = getBrowserName();
  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const chromeIntentUrl = typeof window !== 'undefined' ? getAndroidChromeIntentUrl(window.location.href) : '';
  const cameraAppIntentUrl = getAndroidCameraAppIntentUrl();
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);

  const isTokenExpiredOrInvalid =
    errorDetails?.type === 'token_expired' ||
    errorDetails?.action === 'refresh_qr' ||
    /expired|already been used|invalid qr|invalid session/i.test(errorMessage);

  const handleQrScanned = (scannedUrl) => {
    setIsCameraScannerOpen(false);
    if (!scannedUrl) return;

    try {
      let parsedUrl;
      if (scannedUrl.startsWith('http://') || scannedUrl.startsWith('https://')) {
        parsedUrl = new URL(scannedUrl);
      } else if (scannedUrl.startsWith('/')) {
        parsedUrl = new URL(scannedUrl, window.location.origin);
      }

      if (parsedUrl) {
        window.location.href = parsedUrl.href;
        return;
      }
    } catch (e) {
      console.warn('[PasskeyMobileLoginView] Error parsing scanned QR URL:', e);
    }

    if (scannedUrl.includes('http')) {
      window.location.href = scannedUrl;
    }
  };

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
        if (diag.type === 'phone_not_paired' || authErr?.name === 'NotFoundError') {
          setStatus('password_fallback');
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
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      if (diag.type === 'phone_not_paired' || err?.name === 'NotFoundError') {
        setStatus('password_fallback');
        return;
      }
      setStatus('error');
      setErrorDetails(diag);
      setErrorMessage(diag.message || 'Passkey login failed. Please ensure this phone was paired with your student account.');
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'password_fallback' && (
          <PasskeyPasswordFallbackForm
            initialEmail={studentEmail}
            title="Set Up Desktop Passkey"
            subtitle="No passkey detected on this phone. Enter your account password once to activate Face ID / Fingerprint on this device and unlock desktop."
            submitLabel="Log In & Unlock Desktop"
            onSuccess={async ({ studentEmail: verifiedEmail }) => {
              if (verifiedEmail) setStudentEmail(verifiedEmail);
              await executePasskeyLogin();
            }}
            onCancel={() => {
              setStatus('ready');
              setErrorMessage('');
              setErrorDetails(null);
            }}
          />
        )}

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
            <button
              type="button"
              className="passkey-btn passkey-btn-secondary"
              onClick={() => {
                setStatus('password_fallback');
                setErrorMessage('');
                setErrorDetails(null);
              }}
              style={{ marginTop: '0.75rem' }}
            >
              🔑 First time on this phone? Set up with password
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

            {isTokenExpiredOrInvalid && (
              <div style={{ marginTop: '0.25rem', marginBottom: '1rem', padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '10px', border: '1px dashed rgba(245, 158, 11, 0.3)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', marginBottom: '0.35rem' }}>📸</div>
                <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  QR Code Expired
                </div>
                <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  Desktop login QR codes rotate every 15 seconds. Please scan the active live QR code currently on the screen.
                </p>
              </div>
            )}

            {/* Rescan / Try Again Action Buttons */}
            {isAndroid ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <a
                  href={cameraAppIntentUrl}
                  className="passkey-btn passkey-btn-primary"
                  style={{
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                  }}
                >
                  📷 Open Camera App to Rescan
                </a>
                <button
                  type="button"
                  className="passkey-btn passkey-btn-secondary"
                  onClick={() => setIsCameraScannerOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  🔍 Scan with Camera in Browser
                </button>
                {!isTokenExpiredOrInvalid && (
                  <button
                    type="button"
                    className="passkey-btn passkey-btn-secondary"
                    onClick={executePasskeyLogin}
                  >
                    🔄 Retry Biometrics (Same QR)
                  </button>
                )}
              </div>
            ) : (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <button
                  type="button"
                  className="passkey-btn passkey-btn-primary"
                  onClick={() => setIsCameraScannerOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  📷 Scan QR Code with Camera
                </button>
                {!isTokenExpiredOrInvalid && (
                  <button
                    type="button"
                    className="passkey-btn passkey-btn-secondary"
                    onClick={executePasskeyLogin}
                  >
                    🔄 Retry Biometrics (Same QR)
                  </button>
                )}
                {isIOS && (
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    💡 On iPhone: You can also swipe up to Home and use the <strong>Camera app</strong> to scan the desktop screen.
                  </p>
                )}
              </div>
            )}

            <button
              type="button"
              className="passkey-btn passkey-btn-secondary"
              onClick={() => {
                setStatus('password_fallback');
                setErrorMessage('');
                setErrorDetails(null);
              }}
              style={{ marginTop: '0.75rem' }}
            >
              🔑 First time on this phone? Set up with password
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

      {/* In-Browser Live Camera QR Scanner Modal */}
      <CameraQrScannerModal
        isOpen={isCameraScannerOpen}
        onScan={handleQrScanned}
        onClose={() => setIsCameraScannerOpen(false)}
        title="Scan Desktop Login QR"
        instructions="Point camera at the rotating QR code on your desktop screen to rescan."
      />
    </div>
  );
};

export default PasskeyMobileLoginView;
