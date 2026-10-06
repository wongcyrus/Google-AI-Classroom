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

const PasskeyVerifyView = () => {
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const bingoId = searchParams.get('bingoId');

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked' | 'unsupported_browser'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [studentEmail, setStudentEmail] = useState('');
  const [latencySec, setLatencySec] = useState(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const hasAutoStarted = useRef(false);

  const detectedBrowser = getBrowserName();
  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const chromeIntentUrl = typeof window !== 'undefined' ? getAndroidChromeIntentUrl(window.location.href) : '';

  useEffect(() => {
    // 1. Handheld mobile phone enforcement
    if (!isHandheldPhone()) {
      setStatus('desktop_blocked');
      setErrorMessage('Mobile passkey attendance verification must be performed from your personal handheld smartphone. Shared desktop computers and tablets/iPads cannot be registered as mobile passkeys. Please scan the QR code displayed on your screen using your phone camera.');
      return;
    }

    // 2. Strict Browser Whitelist: Only Google Chrome and Apple Safari supported
    if (!isSupportedBrowser()) {
      setStatus('unsupported_browser');
      setErrorMessage(`This classroom assistant strictly supports Google Chrome and Apple Safari. Detected: ${detectedBrowser}.`);
      return;
    }

    // 3. WebAuthn capability
    if (!browserSupportsWebAuthn()) {
      setStatus('error');
      const diag = normalizePasskeyError('This mobile browser or device does not support biometric passkeys. Please scan using Safari (iOS) or Chrome (Android).');
      setErrorDetails(diag);
      setErrorMessage(diag.message);
      return;
    }

    // 4. Challenge parameters presence
    if (!classId || !bingoId) {
      setStatus('error');
      const diag = normalizePasskeyError('Missing attendance challenge parameters. Please scan the QR code on your lab PC screen.');
      setErrorDetails(diag);
      setErrorMessage('Missing attendance challenge parameters. Please scan the QR code on your lab PC screen.');
      return;
    }

    // Auto-trigger biometric verification once loaded
    if (!hasAutoStarted.current) {
      hasAutoStarted.current = true;
      executeBiometricVerification();
    }
  }, [classId, bingoId, detectedBrowser]);

  const executeBiometricVerification = async () => {
    setStatus('authenticating');
    setErrorMessage('');
    setErrorDetails(null);
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
        const diag = normalizePasskeyError(data.message || 'No paired phone found for this student account. Please pair your phone first or notify your instructor for in-person check.', { isAndroid, isIOS });
        setErrorDetails(diag);
        setErrorMessage(diag.message);
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
        const diag = normalizePasskeyError(biometricErr, { isAndroid, isIOS, browserName: detectedBrowser });
        if (diag.type === 'user_cancelled') {
          setStatus('ready');
          setErrorMessage('Biometric check was cancelled. Tap "Verify Biometric Passkey" to try again.');
          return;
        }
        throw biometricErr;
      }

      setStatus('submitting');
      const timeToCompleteMillis = Date.now() - startTime;

      // 3. Verify assertion cryptographically on Cloud Functions
      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyPasskeyAuth');
      const verifyRes = await verifyFn({
        classId,
        bingoId,
        assertionResponse,
        clientRpId: window.location.hostname,
        timeToCompleteMillis,
        deviceFingerprint,
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
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      setErrorDetails(diag);
      setErrorMessage(diag.message || 'Biometric verification failed. Please try again.');
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
              Attendance verification must be performed using your paired smartphone.
            </p>
            <div className="passkey-alert passkey-alert-error" style={{ textAlign: 'left', lineHeight: 1.5 }}>
              {errorMessage}
            </div>
            <div className="passkey-info-box">
              <div className="passkey-info-row">
                <span className="passkey-info-label">Action</span>
                <span className="passkey-info-value">Scan PC QR Code</span>
              </div>
              <div className="passkey-info-row">
                <span className="passkey-info-label">Lab Desktop PC</span>
                <span className="passkey-info-value" style={{ color: '#ef4444' }}>Desktop Prohibited</span>
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
              Attendance verification strictly supports <strong>Google Chrome</strong> (Android / PC) and <strong>Apple Safari</strong> (iPhone / iOS). Other browsers (such as Samsung Internet, Firefox, Edge, Opera) do not match your paired passkeys.
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
                      🚀 Open in Google Chrome
                    </a>
                  </div>
                )}
              </div>
            ) : errorMessage ? (
              <div className="passkey-alert passkey-alert-error">
                {errorMessage}
              </div>
            ) : null}

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

            {/* Troubleshooting Guide */}
            <details style={{ marginTop: '1.25rem', textAlign: 'left', fontSize: '0.825rem', color: '#64748b', borderTop: '1px solid rgba(226, 232, 240, 0.2)', paddingTop: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem' }}>
                ❓ Having Trouble Verifying?
              </summary>
              <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(226, 232, 240, 0.1)', lineHeight: 1.5 }}>
                <p style={{ margin: '0 0 0.35rem 0', color: '#f59e0b' }}><strong>📱 Not Paired Yet?</strong></p>
                <ul style={{ margin: '0 0 0.65rem 1.25rem', padding: 0 }}>
                  <li>You must pre-register your phone before attending class. Log into the classroom portal on your laptop or lab PC, click <strong>"Pair Mobile Phone"</strong>, and scan your personal pairing QR code.</li>
                </ul>
                <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🤖 Android Users:</strong></p>
                <ul style={{ margin: '0 0 0.65rem 1.25rem', padding: 0 }}>
                  <li>Open this link in <strong>Google Chrome</strong> (Samsung Internet and other browsers are not supported).</li>
                  <li><strong>Honor / MagicOS 8.0:</strong> Go to Settings &gt; Users &amp; Accounts &gt; turn ON <strong>Google Play Services</strong>, and select <strong>Google</strong> as Autofill service in Settings &gt; System &amp; updates &gt; Language &amp; input.</li>
                </ul>
                <p style={{ margin: '0 0 0.35rem 0', color: '#cbd5e1' }}><strong>🍎 iPhone Users:</strong></p>
                <ul style={{ margin: '0 0 0 1.25rem', padding: 0 }}>
                  <li>Open this link in <strong>Apple Safari</strong> or <strong>Google Chrome</strong>.</li>
                  <li>If you use Microsoft Authenticator, ensure <strong>iCloud Passwords &amp; Keychain</strong> is turned ON in iOS Settings &gt; Passwords &gt; Password Options.</li>
                </ul>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  );
};

export default PasskeyVerifyView;
