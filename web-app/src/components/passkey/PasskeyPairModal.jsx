import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot } from 'firebase/firestore';
import { functions, db } from '../../firebase-config';
import './passkey.css';

const PasskeyPairModal = ({ show, onClose, user, classId }) => {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPaired, setIsPaired] = useState(false);
  const [pairedDevice, setPairedDevice] = useState('');

  // 1. Generate pairing token and QR code when modal opens
  useEffect(() => {
    if (!show || !user?.uid) return;

    let isMounted = true;
    setIsPaired(false);

    const initPairing = async () => {
      setLoading(true);
      setError('');
      try {
        const reqTokenFn = httpsCallable(functions, 'requestPasskeyPairingToken');
        const res = await reqTokenFn({ classId: classId || null });
        const tokenId = res.data?.tokenId;

        if (!tokenId) {
          throw new Error('Could not generate pairing token.');
        }

        const pairingUrl = `${window.location.origin}/pair-phone?token=${tokenId}`;
        const dataUrl = await QRCode.toDataURL(pairingUrl, {
          width: 256,
          margin: 2,
          color: {
            dark: '#0f172a',
            light: '#ffffff',
          },
        });

        if (isMounted) {
          setQrDataUrl(dataUrl);
        }
      } catch (err) {
        console.error('[PasskeyPairModal] Error generating QR:', err);
        if (isMounted) {
          setError(err.message || 'Failed to initialize phone pairing.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initPairing();

    // 2. Real-time listener for pairing completion
    const unsubscribe = onSnapshot(doc(db, `studentPasskeys/${user.uid}`), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setIsPaired(true);
        setPairedDevice(data.deviceModel || 'Mobile Device');
        // Auto-close after 2.5s
        setTimeout(() => {
          if (onClose) onClose();
        }, 2500);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, [show, user?.uid, classId, onClose]);

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
          <div>
            <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🎉</div>
            <h2 style={{ margin: '0 0 0.5rem 0', color: '#10b981' }}>Phone Paired!</h2>
            <p style={{ color: '#475569', fontSize: '0.95rem', margin: '0 0 1rem 0' }}>
              Your <strong>{pairedDevice}</strong> is now securely linked to your account.
            </p>
            <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
              Closing this dialog...
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.25rem' }}>📱</div>
            <h2 style={{ margin: '0 0 0.25rem 0', color: '#1e293b' }}>Pair Your Smartphone</h2>
            <p style={{ color: '#64748b', fontSize: '0.9rem', margin: '0 0 1rem 0' }}>
              Point your smartphone camera at this screen to enable 2-second biometric attendance. Zero passwords required on your phone!
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
