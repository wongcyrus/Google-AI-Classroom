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
import { detectDeviceBrand, DEVICE_BRAND_GUIDES } from '../../utils/deviceBrandUtils';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { functions } from '../../firebase-config';
import PasskeyPasswordFallbackForm from './PasskeyPasswordFallbackForm';
import CameraQrScannerModal from './CameraQrScannerModal';
import { decodeQrFromImageFile } from '../../utils/qrCodeDecoder';
import './passkey.css';

const PasskeyVerifyView = () => {
  const [searchParams] = useSearchParams();
  const classId = searchParams.get('classId');
  const bingoId = searchParams.get('bingoId');

  const [status, setStatus] = useState('initializing'); // 'initializing' | 'ready' | 'authenticating' | 'submitting' | 'success' | 'error' | 'desktop_blocked' | 'unsupported_browser' | 'password_fallback'
  const [errorMessage, setErrorMessage] = useState('');
  const [errorDetails, setErrorDetails] = useState(null);
  const [studentEmail, setStudentEmail] = useState('');
  const [latencySec, setLatencySec] = useState(null);
  const [alreadyVerified, setAlreadyVerified] = useState(false);
  const hasAutoStarted = useRef(false);
  const nativeCameraInputRef = useRef(null);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');

  const detectedBrowser = getBrowserName();
  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const detectedBrandId = isIOS ? 'apple' : detectDeviceBrand();
  const [activeBrandId, setActiveBrandId] = useState(detectedBrandId === 'unknown' ? 'android_generic' : detectedBrandId);
  const chromeIntentUrl = typeof window !== 'undefined' ? getAndroidChromeIntentUrl(window.location.href) : '';
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);

  const isTokenExpiredOrInvalid =
    errorDetails?.type === 'token_expired' ||
    errorDetails?.action === 'refresh_qr' ||
    /expired|already been used|invalid qr/i.test(errorMessage);

  const handleNativeCameraPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    setPhotoError('');

    try {
      const decoded = await decodeQrFromImageFile(file);
      if (decoded) {
        handleQrScanned(decoded);
      } else {
        setPhotoError('Could not detect a QR code in the captured photo. Please try snapping closer to the screen or use the live camera scanner.');
      }
    } catch (err) {
      console.warn('[PasskeyVerifyView] Error processing photo QR:', err);
      setPhotoError('Unable to process the photo. Please try using the live camera scanner.');
    } finally {
      setIsProcessingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

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
    } catch {
      // ignore
    }

    if (scannedUrl.includes('http')) {
      window.location.href = scannedUrl;
    }
  };

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
        if (data.studentEmail) {
          setStudentEmail(data.studentEmail);
        }
        setStatus('password_fallback');
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
        if (diag.type === 'phone_not_paired' || biometricErr?.name === 'NotFoundError') {
          setStatus('password_fallback');
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
      const diag = normalizePasskeyError(err, { isAndroid, isIOS, browserName: detectedBrowser });
      if (diag.type === 'phone_not_paired' || err?.name === 'NotFoundError') {
        setStatus('password_fallback');
        return;
      }
      setStatus('error');
      setErrorDetails(diag);
      setErrorMessage(diag.message || 'Biometric verification failed. Please try again.');
    }
  };

  return (
    <div className="passkey-container">
      <div className="passkey-card">
        {status === 'password_fallback' ? (
          <PasskeyPasswordFallbackForm
            initialEmail={studentEmail}
            title="Set Up Attendance Passkey"
            subtitle="No passkey detected on this phone. Enter your account password once to activate Face ID / Fingerprint on this device and confirm attendance."
            submitLabel="Log In & Verify Attendance"
            onSuccess={async ({ studentEmail: verifiedEmail }) => {
              if (verifiedEmail) setStudentEmail(verifiedEmail);
              await executeBiometricVerification();
            }}
            onCancel={() => {
              setStatus('ready');
              setErrorMessage('');
              setErrorDetails(null);
            }}
          />
        ) : status === 'desktop_blocked' ? (
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

            {isTokenExpiredOrInvalid && (
              <div style={{ marginTop: '0.25rem', marginBottom: '1rem', padding: '1rem', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '10px', border: '1px dashed rgba(245, 158, 11, 0.3)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.75rem', marginBottom: '0.35rem' }}>📸</div>
                <div style={{ fontWeight: 700, color: '#fbbf24', fontSize: '0.95rem', marginBottom: '0.25rem' }}>
                  QR Code Expired
                </div>
                <p style={{ margin: 0, color: '#cbd5e1', fontSize: '0.82rem', lineHeight: 1.4 }}>
                  Please point your phone camera at the classroom screen to scan the active live QR code.
                </p>
              </div>
            )}

            {photoError && (
              <div style={{ width: '100%', marginBottom: '0.75rem', padding: '0.6rem 0.85rem', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px', fontSize: '0.825rem', color: '#fca5a5', lineHeight: 1.4, textAlign: 'left' }}>
                ⚠️ {photoError}
              </div>
            )}

            {/* Hidden file input for native Camera App capture */}
            <input
              ref={nativeCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={handleNativeCameraPhoto}
              data-testid="native-camera-input"
            />

            {isTokenExpiredOrInvalid ? (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                <button
                  type="button"
                  className="passkey-btn passkey-btn-primary"
                  onClick={() => setIsCameraScannerOpen(true)}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  📷 Scan QR Code (Live Camera)
                </button>
                <button
                  type="button"
                  className="passkey-btn passkey-btn-secondary"
                  onClick={() => nativeCameraInputRef.current?.click()}
                  disabled={isProcessingPhoto}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
                >
                  {isProcessingPhoto ? (
                    <>
                      <span className="passkey-spinner" style={{ width: 14, height: 14 }} />
                      <span>Scanning Photo...</span>
                    </>
                  ) : (
                    <>
                      <span>📸</span>
                      <span>Open Camera App to Rescan</span>
                    </>
                  )}
                </button>
                {isIOS && (
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4 }}>
                    💡 On iPhone: You can also swipe up to Home and use the <strong>Camera app</strong>.
                  </p>
                )}
              </div>
            ) : (
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

            {/* Troubleshooting Guide */}
            <details style={{ marginTop: '1.25rem', textAlign: 'left', fontSize: '0.825rem', color: '#64748b', borderTop: '1px solid rgba(226, 232, 240, 0.2)', paddingTop: '0.85rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#94a3b8', marginBottom: '0.5rem' }}>
                ❓ Having Trouble Verifying?
              </summary>
              <div style={{ background: 'rgba(15, 23, 42, 0.4)', padding: '0.75rem', borderRadius: '0.5rem', border: '1px solid rgba(226, 232, 240, 0.1)', lineHeight: 1.5 }}>
                <div style={{ marginBottom: '0.75rem', paddingBottom: '0.65rem', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <p style={{ margin: '0 0 0.35rem 0', color: '#f59e0b' }}><strong>📱 Not Paired Yet?</strong></p>
                  <p style={{ margin: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>
                    You must pre-register your phone before attending class. Log into the classroom portal on your laptop or lab PC, click <strong>"Pair Mobile Phone"</strong>, and scan your personal pairing QR code first.
                  </p>
                </div>

                <div style={{ marginBottom: '0.75rem' }}>
                  <label htmlFor="verify-brand-select" style={{ display: 'block', fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.25rem' }}>
                    Select your smartphone brand:
                  </label>
                  <select
                    id="verify-brand-select"
                    value={activeBrandId}
                    onChange={(e) => setActiveBrandId(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.4rem 0.6rem',
                      borderRadius: '0.375rem',
                      background: '#1e293b',
                      color: '#f8fafc',
                      border: '1px solid #475569',
                      fontSize: '0.85rem',
                    }}
                  >
                    <option value="apple">🍎 Apple iPhone (iOS)</option>
                    <option value="honor">📱 Honor (MagicOS 8.0 / 7.0)</option>
                    <option value="samsung">📱 Samsung Galaxy (One UI)</option>
                    <option value="xiaomi">📱 Xiaomi / Redmi / POCO</option>
                    <option value="oppo">📱 OPPO / OnePlus / Realme</option>
                    <option value="vivo">📱 Vivo / iQOO</option>
                    <option value="pixel">🤖 Google Pixel & Stock Android</option>
                    <option value="huawei">📱 Huawei (HarmonyOS / EMUI)</option>
                    <option value="android_generic">🤖 Other Android Device</option>
                  </select>
                </div>

                <div style={{ background: 'rgba(15, 23, 42, 0.6)', padding: '0.65rem 0.75rem', borderRadius: '0.375rem', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                  <p style={{ margin: '0 0 0.35rem 0', color: '#38bdf8', fontWeight: 600, fontSize: '0.85rem' }}>
                    {DEVICE_BRAND_GUIDES[activeBrandId]?.icon} {DEVICE_BRAND_GUIDES[activeBrandId]?.brandName}:
                  </p>
                  <p style={{ margin: '0 0 0.45rem 0', fontSize: '0.78rem', color: '#94a3b8' }}>
                    Browser: <strong>{DEVICE_BRAND_GUIDES[activeBrandId]?.supportedBrowsers}</strong>
                  </p>
                  <ol style={{ margin: '0 0 0 1.15rem', padding: 0, fontSize: '0.8rem', color: '#cbd5e1' }}>
                    {DEVICE_BRAND_GUIDES[activeBrandId]?.steps.map((st, i) => (
                      <li key={i} style={{ marginBottom: '0.25rem' }}>{st}</li>
                    ))}
                  </ol>
                </div>
              </div>
            </details>
          </>
        )}
      </div>

      {/* In-Browser Live Camera QR Scanner Modal */}
      <CameraQrScannerModal
        isOpen={isCameraScannerOpen}
        onScan={handleQrScanned}
        onClose={() => setIsCameraScannerOpen(false)}
        title="Scan Attendance QR Code"
        instructions="Point camera at the active live attendance QR code on the screen."
      />
    </div>
  );
};

export default PasskeyVerifyView;
