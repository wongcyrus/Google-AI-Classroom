import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { isHandheldPhone } from '../../utils/browserDetection';
import { getOrCreateDeviceFingerprint } from '../../utils/deviceFingerprint';
import { isTeacherEmail, isPasskeySharingWhitelisted } from '../../utils/domainConfig';
import { functions, db } from '../../firebase-config';
import './passkey.css';

const PasskeyPairModal = ({ show, onClose, user, classId }) => {
  const isTeacher = Boolean(user?.email && isTeacherEmail(user.email));
  const isWhitelisted = Boolean(user?.email && isPasskeySharingWhitelisted(user.email));
  const canUnlink = isTeacher || isWhitelisted;
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [pairedDevice, setPairedDevice] = useState('');
  const [unlinking, setUnlinking] = useState(false);
  const [qrExpiresAtMillis, setQrExpiresAtMillis] = useState(0);
  const [qrTimeLeftSec, setQrTimeLeftSec] = useState(0);
  const isMobile = isHandheldPhone();

  const initPairing = async () => {
    if (!user?.uid || isMobile) return;
    setLoading(true);
    setError('');
    try {
      const reqTokenFn = httpsCallable(functions, 'requestPasskeyPairingToken');
      const res = await reqTokenFn({ classId: classId || null });
      const { tokenId, expiresAtMillis } = res.data || {};

      if (!tokenId) {
        throw new Error('Could not generate pairing token.');
      }

      setPairingToken(tokenId);
      const expMillis = expiresAtMillis || (Date.now() + 5 * 60 * 1000);
      setQrExpiresAtMillis(expMillis);
      setQrTimeLeftSec(Math.max(0, Math.round((expMillis - Date.now()) / 1000)));

      const pairingUrl = `${window.location.origin}/pair-phone?token=${tokenId}`;
      const dataUrl = await QRCode.toDataURL(pairingUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      });

      setQrDataUrl(dataUrl);
    } catch (err) {
      console.error('[PasskeyPairModal] Error generating QR:', err);
      setError(err.message || 'Failed to initialize phone pairing.');
    } finally {
      setLoading(false);
    }
  };

  // 1. Check existing passkey status & generate pairing token if on desktop
  useEffect(() => {
    if (!show || !user?.uid) return;

    setIsPaired(false);
    setError('');

    // If on Desktop, generate pairing QR code for phone to scan
    if (!isMobile) {
      initPairing();
    }

    // 2. Real-time listener for pairing status
    const unsubscribe = onSnapshot(doc(db, `studentPasskeys/${user.uid}`), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data?.credentialID || data?.deviceModel) {
          setIsPaired(true);
          setPairedDevice(data.deviceModel || 'Mobile Device');
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [show, user?.uid, classId, isMobile]);

  // Pairing QR countdown and auto-refresh interval
  useEffect(() => {
    if (!show || !qrExpiresAtMillis || isMobile || isPaired) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((qrExpiresAtMillis - now) / 1000));
      setQrTimeLeftSec(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        initPairing();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [show, qrExpiresAtMillis, isMobile, isPaired]);

  // Direct In-Place Registration on Mobile Phone
  const handleRegisterDirectly = async () => {
    if (!browserSupportsWebAuthn()) {
      setError('Your browser does not support biometric passkeys. Please use Safari (iOS) or Chrome (Android).');
      return;
    }

    setRegistering(true);
    setError('');

    try {
      // Step A: Request single-use pairing token
      let tokenToUse = pairingToken;
      if (!tokenToUse) {
        const reqTokenFn = httpsCallable(functions, 'requestPasskeyPairingToken');
        const tokenRes = await reqTokenFn({ classId: classId || null });
        tokenToUse = tokenRes.data?.tokenId;
        setPairingToken(tokenToUse);
      }

      if (!tokenToUse) throw new Error('Could not generate registration token.');

      // Step B: Fetch WebAuthn registration challenge
      const getOptionsFn = httpsCallable(functions, 'getPasskeyRegistrationOptions');
      const optionsRes = await getOptionsFn({
        pairingToken: tokenToUse,
        clientRpId: window.location.hostname,
      });

      // Step C: Trigger native biometric prompt (Face ID / Fingerprint)
      let attestationResponse;
      try {
        attestationResponse = await startRegistration({ optionsJSON: optionsRes.data });
      } catch (biometricErr) {
        if (biometricErr.name === 'NotAllowedError') {
          setError('Biometric registration was cancelled. Tap the button to try again.');
          return;
        }
        throw biometricErr;
      }

      // Step D: Detect device model
      const userAgent = navigator.userAgent || '';
      let detectedModel = 'Mobile Phone';
      if (/iPhone/i.test(userAgent)) detectedModel = 'Apple iPhone';
      else if (/iPad/i.test(userAgent)) detectedModel = 'Apple iPad';
      else if (/Android/i.test(userAgent)) detectedModel = 'Android Device';

      // Step E: Verify & enforce 1-Student = 1-Device hardware lock
      const deviceFingerprint = getOrCreateDeviceFingerprint();
      const verifyFn = httpsCallable(functions, 'verifyPasskeyRegistration');
      const verifyRes = await verifyFn({
        pairingToken: tokenToUse,
        attestationResponse,
        clientRpId: window.location.hostname,
        deviceModel: detectedModel,
        deviceFingerprint,
      });

      if (verifyRes.data?.verified) {
        setIsPaired(true);
        setPairedDevice(verifyRes.data?.deviceModel || detectedModel);
        setTimeout(() => {
          if (onClose) onClose();
        }, 2200);
      } else {
        throw new Error('Registration could not be verified by server.');
      }
    } catch (err) {
      console.error('[PasskeyPairModal] Direct registration error:', err);
      const msg = err.message || '';
      if (msg.includes('Hardware Lock') || msg.includes('already registered to another student') || msg.includes('already bound to student')) {
        setError(msg.includes('Hardware Lock:') ? msg.replace(/^.*Hardware Lock:\s*/, '') : 'This physical mobile phone is already registered to another student. Devices cannot be shared.');
      } else {
        setError(msg || 'Failed to register biometric passkey.');
      }
    } finally {
      setRegistering(false);
    }
  };

  const handleUnlinkDevice = async () => {
    if (!user?.uid || !canUnlink) return;
    if (!window.confirm('Are you sure you want to unlink this phone? You can immediately pair another phone afterwards.')) return;
    setUnlinking(true);
    setError('');
    try {
      const resetFn = httpsCallable(functions, 'resetStudentPasskey');
      await resetFn({
        studentUid: user.uid,
        studentEmail: user.email,
        reason: 'User self-service phone unlinking/replacement',
      });
      setIsPaired(false);
      setPairedDevice('');
      if (!isMobile) {
        initPairing();
      }
    } catch (err) {
      console.error('[PasskeyPairModal] Error unlinking phone:', err);
      setError(err.message || 'Failed to unlink device.');
    } finally {
      setUnlinking(false);
    }
  };

  if (!show) return null;

  return (
    <div className="passkey-pair-modal-overlay" onClick={onClose}>
      <div className="passkey-pair-modal-content" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '1rem',
            right: '1rem',
            background: 'none',
            border: 'none',
            fontSize: '1.25rem',
            cursor: 'pointer',
            color: '#94a3b8',
          }}
          aria-label="Close"
        >
          ✕
        </button>

        {isPaired ? (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '0.5rem' }}>🎉</div>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#10b981', fontSize: '1.4rem' }}>Passkey Registered!</h2>
            <p style={{ color: '#475569', fontSize: '0.95rem', margin: '0 0 1rem 0' }}>
              Your <strong>{pairedDevice}</strong> is securely linked. You can now use your phone camera to scan and log into desktop lab PCs{isTeacher ? ' with zero passwords.' : ' and complete attendance checks.'}
            </p>
            {error && (
              <div style={{ color: '#ef4444', background: '#fee2e2', padding: '0.65rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
                ⚠️ {error}
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <button
                type="button"
                className="passkey-btn passkey-btn-primary"
                onClick={onClose}
                style={{ background: '#10b981', color: '#ffffff' }}
              >
                Done
              </button>
              {canUnlink ? (
                <button
                  type="button"
                  className="passkey-btn passkey-btn-secondary"
                  disabled={unlinking}
                  onClick={handleUnlinkDevice}
                  style={{ color: '#ef4444', background: '#fef2f2', border: '1px solid #fee2e2', fontSize: '0.85rem', padding: '0.5rem' }}
                >
                  {unlinking ? 'Unlinking...' : '🔄 Unlink / Switch Phone'}
                </button>
              ) : (
                <div style={{
                  marginTop: '0.5rem',
                  padding: '0.65rem 0.85rem',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '0.5rem',
                  color: '#64748b',
                  fontSize: '0.825rem',
                  lineHeight: '1.4',
                  textAlign: 'left'
                }}>
                  ℹ️ <strong>Need to replace or switch your phone?</strong> Please ask your course instructor to reset your passkey registration.
                </div>
              )}
            </div>
          </div>
        ) : isMobile ? (
          /* Mobile Direct Registration Screen (Zero QR Codes) */
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>📱</div>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#1e293b', fontSize: '1.3rem' }}>Register Mobile Passkey</h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1.25rem 0', lineHeight: '1.4' }}>
              {isTeacher
                ? 'Enable Face ID, Touch ID, or Android Fingerprint on this device. This links your smartphone as your physical key to sign in on shared lab PCs without typing your password.'
                : 'Enable Face ID, Touch ID, or Android Fingerprint on this device. This links your smartphone as your physical identity key for lab PC logins and attendance.'}
            </p>

            {error && (
              <div style={{ color: '#ef4444', background: '#fee2e2', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1.25rem', fontSize: '0.875rem', textAlign: 'left' }}>
                ⚠️ {error}
              </div>
            )}

            <button
              type="button"
              className="passkey-btn passkey-btn-primary"
              onClick={handleRegisterDirectly}
              disabled={registering}
              style={{
                width: '100%',
                padding: '0.85rem 1rem',
                fontSize: '1rem',
                fontWeight: '600',
                borderRadius: '0.5rem',
                background: '#4f46e5',
                color: '#ffffff',
                marginBottom: '0.75rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.5rem',
              }}
            >
              {registering ? (
                <>
                  <div style={{ width: '18px', height: '18px', border: '2px solid #ffffff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  Touching Biometric...
                </>
              ) : (
                '🔑 Touch Face ID / Fingerprint to Register'
              )}
            </button>

            <button
              type="button"
              className="passkey-btn passkey-btn-secondary"
              onClick={onClose}
              style={{ width: '100%', color: '#64748b', background: '#f1f5f9' }}
            >
              Later
            </button>
          </div>
        ) : (
          /* Desktop Screen: Shows QR Code for Phone Camera to Scan */
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>📱</div>
            <h2 style={{ margin: '0 0 0.25rem 0', color: '#1e293b' }}>Pair Your Smartphone</h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
              {isTeacher
                ? 'Point your smartphone camera at this screen to pair your personal phone. Log into shared lab desktop PCs in 2 seconds without typing your password!'
                : 'Point your smartphone camera at this screen to enable 2-second biometric attendance. Zero passwords required on your phone!'}
            </p>

            {error && (
              <div style={{ color: '#ef4444', background: '#fee2e2', padding: '0.75rem', borderRadius: '0.5rem', marginBottom: '1rem', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            {loading ? (
              <div style={{ padding: '3rem 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: '32px', height: '32px', border: '3px solid #e2e8f0', borderTopColor: '#4f46e5', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <span style={{ color: '#64748b', fontSize: '0.875rem' }}>Generating secure pairing token...</span>
              </div>
            ) : qrDataUrl ? (
              <div>
                <div style={{
                  fontSize: '0.825rem',
                  color: '#64748b',
                  background: '#f8fafc',
                  padding: '0.35rem 0.85rem',
                  borderRadius: '9999px',
                  border: '1px solid #e2e8f0',
                  marginBottom: '0.75rem',
                  display: 'inline-block'
                }}>
                  ⏱️ Token expires in: <strong>{Math.floor(qrTimeLeftSec / 60)}:{String(qrTimeLeftSec % 60).padStart(2, '0')}</strong> (Auto-refreshes)
                </div>
                <div className="passkey-qr-frame">
                  <img src={qrDataUrl} alt="Pair Phone QR Code" className="passkey-qr-image" />
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', fontSize: '0.85rem', color: '#475569', marginBottom: '1rem' }}>
                  <span>1. Open Camera</span>
                  <span>•</span>
                  <span>2. Scan QR</span>
                  <span>•</span>
                  <span>3. Face ID / Fingerprint</span>
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className="passkey-btn passkey-btn-secondary"
              onClick={onClose}
              style={{ color: '#475569', background: '#f1f5f9' }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PasskeyPairModal;

