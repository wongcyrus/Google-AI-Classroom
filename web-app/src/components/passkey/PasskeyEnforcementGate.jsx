import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../../firebase-config';
import { isMobileDevice } from '../../utils/browserDetection';
import './passkey.css';

/**
 * PasskeyEnforcementGate
 * Wraps student workspace routes on Desktop.
 * If the student has no registered mobile passkey and no active teacher bypass,
 * this gate blocks desktop access and displays a dynamic pairing QR code.
 */
const PasskeyEnforcementGate = ({ user, classId, role, children }) => {
  const [hasPasskey, setHasPasskey] = useState(null); // null = loading, true/false
  const [hasBypass, setHasBypass] = useState(false);
  const [bypassData, setBypassData] = useState(null);
  const [deviceModel, setDeviceModel] = useState('');
  const [justPaired, setJustPaired] = useState(false);

  // QR Pairing state
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [pairingToken, setPairingToken] = useState('');
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState('');

  // Bypass modal state
  const [showBypassModal, setShowBypassModal] = useState(false);
  const [bypassMode, setBypassMode] = useState('request'); // 'request' | 'pin'
  const [deskNumber, setDeskNumber] = useState('');
  const [bypassReason, setBypassReason] = useState('Battery Depleted');
  const [bypassSubmitting, setBypassSubmitting] = useState(false);
  const [bypassSuccessMsg, setBypassSuccessMsg] = useState('');
  const [bypassErrorMsg, setBypassErrorMsg] = useState('');
  const [emergencyPin, setEmergencyPin] = useState('');
  const [isWhitelisted, setIsWhitelisted] = useState(false);

  const isMobile = isMobileDevice();

  // If role is teacher, or no user, bypass gate entirely
  const isStudent = role === 'student' || (!role && user?.email?.includes('@stu.'));

  // 1. Listen for system_config/loginPolicy password whitelist
  useEffect(() => {
    if (!user?.email || !isStudent) return;

    const userEmail = user.email.toLowerCase().trim();
    const unsubWhitelist = onSnapshot(doc(db, 'system_config/loginPolicy'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const list = Array.isArray(data.passwordWhitelist) ? data.passwordWhitelist : [];
        const isListed = list.some((e) => e && e.toLowerCase().trim() === userEmail) || (data.passwordWhitelistUids && data.passwordWhitelistUids.includes(user.uid));
        setIsWhitelisted(!!isListed);
      } else {
        setIsWhitelisted(false);
      }
    }, (err) => {
      console.warn('[PasskeyEnforcementGate] loginPolicy listener warning:', err);
      setIsWhitelisted(false);
    });

    return () => unsubWhitelist();
  }, [user?.email, user?.uid, isStudent]);

  // 1. Listen for studentPasskeys/{uid}
  useEffect(() => {
    if (!user?.uid || !isStudent) {
      setHasPasskey(true);
      return;
    }

    const unsubPasskey = onSnapshot(doc(db, `studentPasskeys/${user.uid}`), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setDeviceModel(data.deviceModel || 'Mobile Device');
        setHasPasskey(true);
      } else {
        setHasPasskey(false);
      }
    }, (err) => {
      console.warn('[PasskeyEnforcementGate] passkey listener error:', err);
      // In case of error or offline, fallback to check bypass
      setHasPasskey(false);
    });

    return () => unsubPasskey();
  }, [user?.uid, isStudent]);

  // 2. Listen for classes/{classId}/studentProperties/{uid}.passkeyBypass
  useEffect(() => {
    if (!user?.uid || !classId || !isStudent) return;

    const unsubBypass = onSnapshot(doc(db, `classes/${classId}/studentProperties/${user.uid}`), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        const bypass = data.passkeyBypass;
        if (bypass && bypass.active) {
          const now = Date.now();
          const expires = bypass.expiresAtMillis || (bypass.expiresAt ? new Date(bypass.expiresAt).getTime() : 0);
          if (now < expires) {
            setHasBypass(true);
            setBypassData(bypass);
            return;
          }
        }
      }
      setHasBypass(false);
      setBypassData(null);
    }, (err) => {
      console.warn('[PasskeyEnforcementGate] bypass listener error:', err);
    });

    return () => unsubBypass();
  }, [user?.uid, classId, isStudent]);

  // 3. Generate single-use pairing QR code when passkey is missing
  const generatePairingQR = async () => {
    if (!user?.uid) return;
    setQrLoading(true);
    setQrError('');
    try {
      const reqTokenFn = httpsCallable(functions, 'requestPasskeyPairingToken');
      const res = await reqTokenFn({ classId: classId || null });
      const tokenId = res.data?.tokenId;

      if (!tokenId) {
        throw new Error('Failed to generate pairing token.');
      }

      setPairingToken(tokenId);
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
      console.error('[PasskeyEnforcementGate] QR generation error:', err);
      setQrError(err.message || 'Could not initialize pairing QR.');
    } finally {
      setQrLoading(false);
    }
  };

  useEffect(() => {
    if (hasPasskey === false && !hasBypass) {
      generatePairingQR();
    }
  }, [hasPasskey, hasBypass, user?.uid]);

  // Handle teacher bypass request submission
  const handleSubmitBypassRequest = async (e) => {
    e.preventDefault();
    if (bypassSubmitting) return;

    setBypassSubmitting(true);
    setBypassErrorMsg('');
    setBypassSuccessMsg('');

    try {
      if (!classId) {
        throw new Error('Class ID is required to request bypass.');
      }

      const reqBypassFn = httpsCallable(functions, 'requestTeacherPasskeyBypass');
      await reqBypassFn({
        studentUid: user.uid,
        studentEmail: user.email,
        classId,
        deskNumber: deskNumber.trim() || 'Unknown Desk',
        reason: bypassReason,
      });

      setBypassSuccessMsg('Request submitted to Teacher Podium! Please notify your teacher.');
    } catch (err) {
      setBypassErrorMsg(err.message || 'Failed to submit bypass request.');
    } finally {
      setBypassSubmitting(false);
    }
  };

  // Handle emergency PIN verification
  const handleVerifyPin = async (e) => {
    e.preventDefault();
    if (bypassSubmitting || !emergencyPin.trim()) return;

    setBypassSubmitting(true);
    setBypassErrorMsg('');
    setBypassSuccessMsg('');

    try {
      if (!classId) {
        throw new Error('Class ID is required.');
      }

      const verifyPinFn = httpsCallable(functions, 'verifyTeacherPasskeyBypassPin');
      const res = await verifyPinFn({
        classId,
        studentUid: user.uid,
        pin: emergencyPin.trim(),
        deskNumber: deskNumber.trim() || null,
        reason: 'Teacher Aisle Emergency PIN',
      });

      setBypassSuccessMsg(res.data?.message || 'Emergency PIN verified! Entering classroom...');
      setTimeout(() => {
        setShowBypassModal(false);
      }, 1500);
    } catch (err) {
      setBypassErrorMsg(err.message || 'Invalid teacher PIN.');
    } finally {
      setBypassSubmitting(false);
    }
  };

  // If teacher, non-student, or mobile smartphone, allow immediately
  if (!isStudent || isMobile) {
    return children;
  }

  // If loading status
  if (hasPasskey === null) {
    return (
      <div className="passkey-gate-overlay">
        <div className="passkey-gate-card">
          <div className="passkey-spinner" />
          <p style={{ marginTop: '1rem', color: '#94a3b8' }}>Checking passkey security status...</p>
        </div>
      </div>
    );
  }

  // If passkey is registered, bypass active, or whitelisted, unlock classroom
  if (hasPasskey || hasBypass || isWhitelisted) {
    return (
      <>
        {isWhitelisted && !hasPasskey && !hasBypass && (
          <div
            className="passkey-whitelist-banner"
            style={{
              background: '#1e293b',
              borderBottom: '1px solid #3b82f6',
              color: '#93c5fd',
              padding: '6px 16px',
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              zIndex: 1000,
            }}
          >
            <span>🛡️ <strong>Password Whitelist Active:</strong> Account permitted to sign in via password without mandatory mobile passkey.</span>
          </div>
        )}
        {children}
      </>
    );
  }

  // Locked Gate UI (Desktop Browser without passkey)
  return (
    <div className="passkey-gate-overlay">
      <div className="passkey-gate-card">
        <div className="passkey-icon-badge">📱</div>

        <h1 className="passkey-title">Personal Mobile Passkey Required</h1>
        <p className="passkey-subtitle">
          To prevent proxy attendance and account sharing, access to the classroom workspace is gated by your personal smartphone.
        </p>

        <div className="passkey-lab-pc-warning">
          <div className="passkey-warning-icon">⚠️</div>
          <div className="passkey-warning-content">
            <strong>Shared Lab PC Detected — Desktop Passkeys Prohibited</strong>
            <p>
              Do NOT attempt to register Windows Hello or local PC credentials on this shared machine. Passkeys must reside exclusively in your phone's Secure Enclave (Apple Face ID or Android Fingerprint).
            </p>
          </div>
        </div>

        <div className="passkey-qr-section">
          {qrLoading ? (
            <div className="passkey-qr-placeholder">
              <div className="passkey-spinner" />
              <p>Generating pairing token...</p>
            </div>
          ) : qrError ? (
            <div className="passkey-qr-placeholder">
              <p style={{ color: '#f87171' }}>{qrError}</p>
              <button type="button" className="passkey-btn secondary" onClick={generatePairingQR}>
                🔄 Retry
              </button>
            </div>
          ) : qrDataUrl ? (
            <div className="passkey-qr-wrapper">
              <img src={qrDataUrl} alt="Pairing QR Code" className="passkey-qr-img" />
              <p className="passkey-qr-instructions">
                Point your phone camera at this QR code to pair your phone.
              </p>
            </div>
          ) : null}
        </div>

        <div className="passkey-gate-actions">
          <button
            type="button"
            className="passkey-btn secondary"
            onClick={generatePairingQR}
            disabled={qrLoading}
          >
            🔄 Refresh QR Code
          </button>

          <button
            type="button"
            className="passkey-bypass-link-btn"
            onClick={() => setShowBypassModal(true)}
          >
            🙋 Phone Unavailable? (Dead Battery / Left at Home)
          </button>
        </div>
      </div>

      {/* Teacher Bypass Modal */}
      {showBypassModal && (
        <div className="passkey-pair-modal-overlay" onClick={() => setShowBypassModal(false)}>
          <div className="passkey-pair-modal-content" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="passkey-modal-close"
              onClick={() => setShowBypassModal(false)}
            >
              ✕
            </button>

            <h2 className="passkey-title" style={{ fontSize: '1.25rem' }}>Teacher Manual Bypass</h2>
            <p className="passkey-subtitle" style={{ fontSize: '0.875rem', marginBottom: '1rem' }}>
              If your phone is dead, left at home, or broken, request your teacher to authorize your session.
            </p>

            <div className="passkey-tab-switcher">
              <button
                type="button"
                className={`passkey-tab-btn ${bypassMode === 'request' ? 'active' : ''}`}
                onClick={() => setBypassMode('request')}
              >
                🙋 Podium 1-Click Request
              </button>
              <button
                type="button"
                className={`passkey-tab-btn ${bypassMode === 'pin' ? 'active' : ''}`}
                onClick={() => setBypassMode('pin')}
              >
                🔑 Teacher Emergency PIN
              </button>
            </div>

            {bypassMode === 'request' ? (
              <form onSubmit={handleSubmitBypassRequest} className="passkey-bypass-form">
                <div className="passkey-form-group">
                  <label htmlFor="desk-number-input">Your Desk / Seat Number</label>
                  <input
                    id="desk-number-input"
                    type="text"
                    placeholder="e.g. Desk #14"
                    value={deskNumber}
                    onChange={(e) => setDeskNumber(e.target.value)}
                    required
                  />
                </div>

                <div className="passkey-form-group">
                  <label htmlFor="bypass-reason-select">Reason Phone is Unavailable</label>
                  <select
                    id="bypass-reason-select"
                    value={bypassReason}
                    onChange={(e) => setBypassReason(e.target.value)}
                  >
                    <option value="Battery Depleted">Battery Depleted (0%)</option>
                    <option value="Left Phone at Home">Left Phone at Home</option>
                    <option value="Camera / Screen Damaged">Camera or Screen Damaged</option>
                    <option value="Phone Lost / Under Repair">Phone Lost or Under Repair</option>
                    <option value="Device Incompatible">Device Incompatible / Other</option>
                  </select>
                </div>

                <button
                  type="submit"
                  className="passkey-btn primary"
                  disabled={bypassSubmitting}
                >
                  {bypassSubmitting ? 'Sending Request...' : 'Send Request to Teacher Podium'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleVerifyPin} className="passkey-bypass-form">
                <div className="passkey-form-group">
                  <label htmlFor="desk-pin-input">Your Desk Number</label>
                  <input
                    id="desk-pin-input"
                    type="text"
                    placeholder="e.g. Desk #14"
                    value={deskNumber}
                    onChange={(e) => setDeskNumber(e.target.value)}
                  />
                </div>

                <div className="passkey-form-group">
                  <label htmlFor="emergency-pin-input">Teacher 6-Digit Emergency PIN</label>
                  <input
                    id="emergency-pin-input"
                    type="password"
                    maxLength={6}
                    placeholder="Enter 6-digit PIN"
                    value={emergencyPin}
                    onChange={(e) => setEmergencyPin(e.target.value)}
                    autoComplete="off"
                    required
                  />
                  <small style={{ color: '#94a3b8', display: 'block', marginTop: '0.25rem' }}>
                    Ask your teacher to enter the active class emergency PIN on your screen.
                  </small>
                </div>

                <button
                  type="submit"
                  className="passkey-btn primary"
                  disabled={bypassSubmitting || emergencyPin.length < 4}
                >
                  {bypassSubmitting ? 'Verifying PIN...' : 'Verify Emergency PIN'}
                </button>
              </form>
            )}

            {bypassSuccessMsg && (
              <div className="passkey-info-box" style={{ borderColor: 'rgba(52, 211, 153, 0.4)', background: 'rgba(52, 211, 153, 0.1)', marginTop: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#34d399' }}>✅ {bypassSuccessMsg}</p>
              </div>
            )}

            {bypassErrorMsg && (
              <div className="passkey-info-box" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)', marginTop: '1rem' }}>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#f87171' }}>⚠️ {bypassErrorMsg}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PasskeyEnforcementGate;
