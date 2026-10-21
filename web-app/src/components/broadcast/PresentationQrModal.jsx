import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import Modal from '../Modal';

const escapeHtml = (str = '') =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export function buildWatchUrl({ classId, pin, customUrl = null }) {
  if (customUrl) return customUrl;
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}/live/${classId}${pin ? `?pin=${pin}` : ''}`;
}

export function openProjectorQrPopup({
  classId,
  className = '',
  pin = '',
  customUrl = null,
  existingWin = null,
  onlyUpdateIfOpen = false,
}) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return null;
  }

  let popupWin = existingWin && !existingWin.closed ? existingWin : null;
  if (!popupWin) {
    if (onlyUpdateIfOpen) return null;
    try {
      popupWin = window.open(
        '',
        `ProjectorQR_${classId || 'live'}`,
        'width=580,height=760,left=120,top=80,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
      );
    } catch {
      return null;
    }
  }

  if (!popupWin || popupWin.closed || !popupWin.document) {
    return null;
  }

  const watchUrl = buildWatchUrl({ classId, pin, customUrl });
  const displayTitle = className ? `${className} (${classId})` : (classId || 'Live Session');
  const safeTitle = escapeHtml(displayTitle);
  const safePin = escapeHtml(pin);
  const safeUrl = escapeHtml(watchUrl);

  try {
    popupWin.document.open();
    popupWin.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>📱 Projector QR Code — ${safeTitle}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
    }
    .card {
      background: #ffffff;
      color: #0f172a;
      border-radius: 20px;
      padding: 28px 28px 24px;
      width: 100%;
      max-width: 520px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
    }
    .badge {
      display: inline-block;
      background: #ecfdf5;
      color: #047857;
      border: 1px solid #a7f3d0;
      font-size: 0.78rem;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 8px;
    }
    h1 {
      margin: 0 0 6px 0;
      font-size: 1.25rem;
      font-weight: 800;
      color: #0f172a;
    }
    .session-name {
      margin: 0 0 12px 0;
      font-size: 0.92rem;
      font-weight: 600;
      color: #334155;
    }
    .subtitle {
      margin: 0 0 16px 0;
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.45;
    }
    .qr-box {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      padding: 18px;
      border-radius: 16px;
      background: #ffffff;
      border: 2px solid #e2e8f0;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
      margin-bottom: 16px;
    }
    #qr-img {
      width: 300px;
      height: 300px;
      border-radius: 8px;
      display: none;
    }
    #qr-loading {
      width: 300px;
      height: 300px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-weight: 600;
    }
    .pin-pill {
      margin-top: 14px;
      padding: 8px 24px;
      background: #f1f5f9;
      border-radius: 999px;
      border: 1px solid #cbd5e1;
    }
    .pin-label {
      font-size: 0.85rem;
      color: #64748b;
      font-weight: 700;
      margin-right: 8px;
    }
    .pin-value {
      font-size: 1.75rem;
      font-weight: 800;
      letter-spacing: 4px;
      color: #0f172a;
    }
    .url-row {
      display: flex;
      gap: 8px;
      margin: 0 auto 16px auto;
      max-width: 460px;
    }
    .url-input {
      flex: 1;
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #f8fafc;
      font-size: 0.84rem;
      color: #334155;
    }
    .btn {
      padding: 9px 16px;
      border-radius: 8px;
      font-size: 0.86rem;
      font-weight: 700;
      cursor: pointer;
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      white-space: nowrap;
    }
    .btn:hover { background: #f1f5f9; }
    .btn-primary {
      background: #059669;
      border-color: #059669;
      color: #ffffff;
    }
    .btn-primary:hover { background: #047857; }
    .actions-row {
      display: flex;
      justify-content: center;
      gap: 10px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">🌐 PUBLIC LIVE STREAM &amp; MULTILINGUAL SUBTITLES</div>
    <h1>📱 Presentation Screen &amp; Subtitles QR Code</h1>
    <p class="session-name">${safeTitle}</p>
    <p class="subtitle">
      Scan this QR code with your smartphone camera to follow the live screen and select your preferred subtitle language.
    </p>
    <div class="qr-box">
      <div id="qr-loading">Generating QR Code...</div>
      <img id="qr-img" alt="Scan QR code to join live presentation" />
      ${safePin ? `
      <div class="pin-pill">
        <span class="pin-label">ACCESS PIN:</span>
        <span class="pin-value" id="pin-val">${safePin}</span>
      </div>` : ''}
    </div>
    <div class="url-row">
      <input id="watch-url" class="url-input" type="text" readonly value="${safeUrl}" />
      <button id="copy-btn" class="btn" type="button">📋 Copy Link</button>
    </div>
    <div class="actions-row">
      <button id="fs-btn" class="btn" type="button">⛶ Fullscreen</button>
      <button id="close-btn" class="btn btn-primary" type="button">Done</button>
    </div>
  </div>
  <script>
    (function() {
      var copyBtn = document.getElementById('copy-btn');
      var watchInput = document.getElementById('watch-url');
      var fsBtn = document.getElementById('fs-btn');
      var closeBtn = document.getElementById('close-btn');
      if (copyBtn && watchInput) {
        copyBtn.addEventListener('click', function() {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(watchInput.value);
          } else {
            watchInput.select();
            document.execCommand('copy');
          }
          copyBtn.textContent = '✅ Copied!';
          setTimeout(function() { copyBtn.textContent = '📋 Copy Link'; }, 2500);
        });
      }
      if (fsBtn) {
        fsBtn.addEventListener('click', function() {
          if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen().catch(function(){});
          } else if (document.exitFullscreen) {
            document.exitFullscreen().catch(function(){});
          }
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener('click', function() { window.close(); });
      }
    })();
  </script>
</body>
</html>`);
    popupWin.document.close();
    if (typeof popupWin.focus === 'function') {
      popupWin.focus();
    }
  } catch (err) {
    console.warn('[PresentationQrModal] Could not write to popup window:', err);
    return null;
  }

  QRCode.toDataURL(watchUrl, {
    width: 380,
    margin: 2,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
    errorCorrectionLevel: 'M',
  })
    .then((dataUrl) => {
      if (!popupWin || popupWin.closed || !popupWin.document) return;
      const imgEl = popupWin.document.getElementById('qr-img');
      const loadingEl = popupWin.document.getElementById('qr-loading');
      if (imgEl) {
        imgEl.src = dataUrl;
        imgEl.style.display = 'block';
      }
      if (loadingEl) {
        loadingEl.style.display = 'none';
      }
    })
    .catch((err) => {
      console.error('[PresentationQrModal] Popup QR generation error:', err);
    });

  return popupWin;
}

export default function PresentationQrModal({
  isOpen,
  onClose,
  classId,
  className = '',
  pin,
  customUrl = null,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const watchUrl = buildWatchUrl({ classId, pin, customUrl });

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

  const handlePopOut = () => {
    const win = openProjectorQrPopup({ classId, className, pin, customUrl });
    if (win && onClose) {
      onClose();
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

        <div style={{ display: 'flex', justifyContent: 'center', gap: '0.75rem' }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={handlePopOut}
            style={{ minWidth: '160px' }}
          >
            ↗ Open in Popup
          </button>
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
