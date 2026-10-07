import React, { useEffect, useRef, useState, useCallback } from 'react';
import jsQR from 'jsqr';
import { isAndroidDevice, isIOSDevice, getAndroidCameraAppIntentUrl } from '../../utils/browserDetection';

/**
 * CameraQrScannerModal
 * Provides in-browser live camera QR scanning with fallback to native Android Camera App.
 * Automatically cleans up camera tracks when closed or unmounted.
 *
 * @param {Object} props
 * @param {boolean} props.isOpen - Whether the scanner modal is open
 * @param {Function} props.onScan - Callback with decoded QR text: (decodedText: string) => void
 * @param {Function} props.onClose - Callback to close scanner
 * @param {string} [props.title] - Modal title
 * @param {string} [props.instructions] - Help instructions
 */
export default function CameraQrScannerModal({
  isOpen,
  onScan,
  onClose,
  title = 'Scan Classroom QR Code',
  instructions = 'Point your camera at the active live QR code displayed on the screen.',
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scanLoopRef = useRef(null);
  const canvasRef = useRef(null);

  const [cameraState, setCameraState] = useState('initializing'); // 'initializing' | 'active' | 'error' | 'scanned'
  const [errorMessage, setErrorMessage] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const isAndroid = isAndroidDevice();
  const isIOS = isIOSDevice();
  const cameraIntentUrl = getAndroidCameraAppIntentUrl();

  const stopCamera = useCallback(() => {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current);
      scanLoopRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore track stop errors
        }
      });
      streamRef.current = null;
    }
  }, []);

  const handleQrDetected = useCallback((qrData) => {
    if (!qrData) return;
    setCameraState('scanned');
    stopCamera();

    // Haptic feedback if available
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(50);
      }
    } catch {
      // ignore
    }

    onScan(qrData);
  }, [onScan, stopCamera]);

  // Scan loop using BarcodeDetector if available, falling back to jsQR
  const startScanningLoop = useCallback((video) => {
    let hasBarcodeDetector = typeof window !== 'undefined' && 'BarcodeDetector' in window;
    let detector = null;

    if (hasBarcodeDetector) {
      try {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch {
        hasBarcodeDetector = false;
        detector = null;
      }
    }

    const tick = async () => {
      if (!video || video.readyState < 2) {
        scanLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;

      if (videoWidth > 0 && videoHeight > 0) {
        // Method A: Native BarcodeDetector (Chrome Android / Safari 17+)
        if (detector) {
          try {
            const barcodes = await detector.detect(video);
            if (barcodes && barcodes.length > 0) {
              const detected = barcodes[0]?.rawValue;
              if (detected) {
                handleQrDetected(detected);
                return;
              }
            }
          } catch {
            // If detector throws, fall through to jsQR
          }
        }

        // Method B: jsQR pure JS decoder
        if (!canvasRef.current) {
          canvasRef.current = document.createElement('canvas');
        }
        const canvas = canvasRef.current;
        if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
          canvas.width = videoWidth;
          canvas.height = videoHeight;
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
          try {
            const imgData = ctx.getImageData(0, 0, videoWidth, videoHeight);
            const code = jsQR(imgData.data, imgData.width, imgData.height, {
              inversionAttempts: 'dontInvert',
            });
            if (code && code.data) {
              handleQrDetected(code.data);
              return;
            }
          } catch {
            // ignore scan frame exceptions
          }
        }
      }

      scanLoopRef.current = requestAnimationFrame(tick);
    };

    scanLoopRef.current = requestAnimationFrame(tick);
  }, [handleQrDetected]);

  // Initialize camera stream when open
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCameraState('initializing');
      setErrorMessage('');
      return;
    }

    let isMounted = true;
    setCameraState('initializing');
    setErrorMessage('');

    const startCamera = async () => {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by this browser.');
        }

        // Prefer environment (rear) camera on mobile
        const constraints = {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        // Check torch support
        const track = stream.getVideoTracks()[0];
        if (track && typeof track.getCapabilities === 'function') {
          const caps = track.getCapabilities();
          setTorchSupported(Boolean(caps?.torch));
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play();
          } catch {
            // Auto-play was prevented or interrupted
          }
        }

        setCameraState('active');
        if (videoRef.current) {
          startScanningLoop(videoRef.current);
        }
      } catch (err) {
        console.warn('[CameraQrScannerModal] Camera error:', err);
        if (!isMounted) return;
        setCameraState('error');
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setErrorMessage('Camera access was denied. Please allow camera permissions in your browser settings.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setErrorMessage('No camera found on this device.');
        } else {
          setErrorMessage(err.message || 'Unable to start camera.');
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      stopCamera();
    };
  }, [isOpen, startScanningLoop, stopCamera]);

  const toggleTorch = async () => {
    if (!streamRef.current || !torchSupported) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (!track) return;

    try {
      const nextState = !torchOn;
      await track.applyConstraints({ advanced: [{ torch: nextState }] });
      setTorchOn(nextState);
    } catch (err) {
      console.warn('[CameraQrScannerModal] Failed to toggle torch:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.96)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '1.25rem 1rem env(safe-area-inset-bottom, 1.25rem) 1rem',
        boxSizing: 'border-box',
        color: '#f8fafc',
      }}
    >
      {/* Header */}
      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc' }}>
            {title}
          </h2>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Scan the rotating QR code on screen
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Scanner"
          style={{
            background: 'rgba(255, 255, 255, 0.1)',
            border: 'none',
            color: '#f8fafc',
            borderRadius: '50%',
            width: '38px',
            height: '38px',
            cursor: 'pointer',
            fontSize: '1.1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          ✕
        </button>
      </div>

      {/* Main Viewfinder Frame */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: '360px',
          aspectRatio: '1 / 1',
          margin: 'auto 0',
          borderRadius: '1.25rem',
          overflow: 'hidden',
          background: '#000000',
          boxShadow: '0 0 0 2px rgba(99, 102, 241, 0.5), 0 20px 40px rgba(0, 0, 0, 0.6)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <video
          ref={videoRef}
          playsInline
          autoPlay
          muted
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            display: cameraState === 'active' || cameraState === 'scanned' ? 'block' : 'none',
          }}
        />

        {/* Viewfinder Target Framing & Scan Line */}
        {cameraState === 'active' && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              boxSizing: 'border-box',
              padding: '24px',
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                border: '2px solid rgba(255, 255, 255, 0.7)',
                borderRadius: '16px',
                position: 'relative',
                boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.4)',
              }}
            >
              {/* Corner Accents */}
              <div style={{ position: 'absolute', top: -3, left: -3, width: 20, height: 20, borderTop: '4px solid #6366f1', borderLeft: '4px solid #6366f1', borderTopLeftRadius: 8 }} />
              <div style={{ position: 'absolute', top: -3, right: -3, width: 20, height: 20, borderTop: '4px solid #6366f1', borderRight: '4px solid #6366f1', borderTopRightRadius: 8 }} />
              <div style={{ position: 'absolute', bottom: -3, left: -3, width: 20, height: 20, borderBottom: '4px solid #6366f1', borderLeft: '4px solid #6366f1', borderBottomLeftRadius: 8 }} />
              <div style={{ position: 'absolute', bottom: -3, right: -3, width: 20, height: 20, borderBottom: '4px solid #6366f1', borderRight: '4px solid #6366f1', borderBottomRightRadius: 8 }} />

              {/* Animated Scan Line */}
              <div
                className="qr-scanner-line"
                style={{
                  position: 'absolute',
                  left: '10%',
                  right: '10%',
                  height: '2px',
                  background: 'linear-gradient(90deg, transparent, #38bdf8, #6366f1, transparent)',
                  boxShadow: '0 0 8px #6366f1',
                  animation: 'scanner-line-sweep 2s infinite ease-in-out',
                }}
              />
            </div>
          </div>
        )}

        {/* Initializing Spinner */}
        {cameraState === 'initializing' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', padding: '1rem' }}>
            <div className="passkey-spinner" style={{ width: 36, height: 36 }} />
            <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Starting camera...</span>
          </div>
        )}

        {/* Scanned Success Badge */}
        {cameraState === 'scanned' && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(16, 185, 129, 0.85)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>✅</span>
            <span style={{ fontWeight: 700, fontSize: '1.1rem' }}>QR Code Captured!</span>
          </div>
        )}

        {/* Camera Error Message */}
        {cameraState === 'error' && (
          <div style={{ padding: '1.5rem', textAlign: 'center', color: '#fca5a5' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🚫</div>
            <p style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', lineHeight: 1.4 }}>
              {errorMessage}
            </p>
            {isAndroid && (
              <a
                href={cameraIntentUrl}
                className="passkey-btn passkey-btn-primary"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  textDecoration: 'none',
                  fontSize: '0.85rem',
                  padding: '0.5rem 1rem',
                }}
              >
                📷 Open Phone Camera App
              </a>
            )}
          </div>
        )}
      </div>

      {/* Footer Controls & Instructions */}
      <div style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.4, textAlign: 'center' }}>
          {instructions}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          {torchSupported && cameraState === 'active' && (
            <button
              type="button"
              onClick={toggleTorch}
              className="passkey-btn passkey-btn-secondary"
              style={{ flex: 1, padding: '0.6rem 1rem', fontSize: '0.85rem' }}
            >
              {torchOn ? '🔦 Flashlight Off' : '💡 Flashlight On'}
            </button>
          )}

          {isAndroid && (
            <a
              href={cameraIntentUrl}
              className="passkey-btn passkey-btn-secondary"
              style={{
                flex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                textDecoration: 'none',
                padding: '0.6rem 1rem',
                fontSize: '0.85rem',
              }}
            >
              📱 Camera App
            </a>
          )}
        </div>

        {isIOS && (
          <p style={{ margin: 0, fontSize: '0.78rem', color: '#94a3b8', textAlign: 'center' }}>
            💡 Tip: You can also swipe up to your Home Screen and use the built-in iPhone Camera app to scan the code.
          </p>
        )}

        <button
          type="button"
          onClick={onClose}
          className="passkey-btn"
          style={{
            background: 'transparent',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            color: '#94a3b8',
            padding: '0.5rem 1rem',
            fontSize: '0.85rem',
          }}
        >
          Cancel
        </button>
      </div>

      <style>{`
        @keyframes scanner-line-sweep {
          0% { top: 15%; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 85%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
