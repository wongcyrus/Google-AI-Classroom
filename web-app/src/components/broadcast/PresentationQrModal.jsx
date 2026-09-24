import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import Modal from '../Modal';

export default function PresentationQrModal({
  isOpen,
  onClose,
  classId,
  pin,
  customUrl = null,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const watchUrl = customUrl || (typeof window !== 'undefined'
    ? `${window.location.origin}/live/${classId}${pin ? `?pin=${pin}` : ''}`
    : `/live/${classId}${pin ? `?pin=${pin}` : ''}`);

  useEffect(() => {
    if (!isOpen || !watchUrl) return;
    let isMounted = true;

    QRCode.toDataURL(watchUrl, {
      width: 360,
      margin: 2,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => {
        if (isMounted) setQrDataUrl(url);
      })
      .catch((err) => {
        console.error('[PresentationQrModal] QR generation error:', err);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, watchUrl]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(watchUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.warn('Copy link failed:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <Modal show={isOpen} onClose={onClose} title="📱 Presentation Screen & Subtitles QR Code">
      <div style={{ textAlign: 'center', padding: '0.5rem 1rem' }}>
        <p style={{ color: '#475569', fontSize: '0.95rem', margin: '0 0 1rem 0' }}>
          Audience members can scan this QR code with their smartphone camera to follow the live screen and select their preferred subtitle language.
        </p>

        {/* Big High-Contrast QR Code Card */}
        <div style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '1.25rem',
          borderRadius: '16px',
          background: '#ffffff',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.08)',
          border: '2px solid #e2e8f0',
          marginBottom: '1rem',
        }}>
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="Scan QR code to join live presentation"
              style={{ width: '280px', height: '280px', borderRadius: '8px', display: 'block' }}
            />
          ) : (
            <div style={{ width: '280px', height: '280px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
              Generating QR Code...
            </div>
          )}

          {pin && (
            <div style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              backgroundColor: '#f1f5f9',
              borderRadius: '999px',
              border: '1px solid #cbd5e1',
            }}>
              <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: '600', marginRight: '0.5rem' }}>
                ACCESS PIN:
              </span>
              <span style={{ fontSize: '1.6rem', fontWeight: '800', letterSpacing: '4px', color: '#1e293b' }}>
                {pin}
              </span>
            </div>
          )}
        </div>

        {/* Direct Link and Copy Button */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          maxWidth: '500px',
          margin: '0 auto 1.25rem auto',
        }}>
          <input
            type="text"
            readOnly
            value={watchUrl}
            style={{
              flex: 1,
              padding: '0.6rem 0.75rem',
              borderRadius: '8px',
              border: '1px solid #cbd5e1',
              backgroundColor: '#f8fafc',
              fontSize: '0.85rem',
              color: '#334155',
            }}
          />
          <button
            type="button"
            className="secondary-btn"
            onClick={handleCopyLink}
            style={{ padding: '0.6rem 1rem', whiteSpace: 'nowrap' }}
          >
            {copied ? '✅ Copied!' : '📋 Copy Link'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            className="primary-btn"
            onClick={onClose}
            style={{ minWidth: '120px' }}
          >
            Done
          </button>
        </div>
      </div>
    </Modal>
  );
}
