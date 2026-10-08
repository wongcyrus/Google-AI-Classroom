import React, { useEffect, useRef, useState, useCallback } from 'react';
import { decodeQrFromElement, decodeQrFromImageFile } from '../../utils/qrCodeDecoder';

/**
 * CameraQrScannerModal
 * Provides in-browser live camera QR scanning with fallback to native Camera App photo capture.
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
  const fileInputRef = useRef(null);

  const [cameraState, setCameraState] = useState('initializing'); // 'initializing' | 'active' | 'error' | 'scanned'
  const [errorMessage, setErrorMessage] = useState('');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [isProcessingPhoto, setIsProcessingPhoto] = useState(false);
  const [photoError, setPhotoError] = useState('');

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

  // Handle native Camera App snapshot via file input capture="environment"
  const handlePhotoCaptured = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingPhoto(true);
    setPhotoError('');

    try {
      const decoded = await decodeQrFromImageFile(file);
      if (decoded) {
        handleQrDetected(decoded);
      } else {
        setPhotoError('Could not detect a QR code in the captured photo. Please try snapping closer to the screen.');
      }
    } catch (err) {
      console.warn('[CameraQrScannerModal] Photo decode error:', err);
      setPhotoError('Unable to process the photo. Please try again.');
    } finally {
      setIsProcessingPhoto(false);
      if (e.target) e.target.value = '';
    }
  };

  // Continuous frame scanning loop
  const startScanningLoop = useCallback((video) => {
    let isScanning = true;

    const tick = async () => {
      if (!isScanning) return;

      if (!video || video.readyState < 2) {
        scanLoopRef.current = requestAnimationFrame(tick);
        return;
      }

      const decoded = await decodeQrFromElement(video);
      if (decoded) {
        isScanning = false;
        handleQrDetected(decoded);
        return;
      }

      scanLoopRef.current = requestAnimationFrame(tick);
    };

    scanLoopRef.current = requestAnimationFrame(tick);

    return () => {
      isScanning = false;
    };
  }, [handleQrDetected]);

  // Initialize camera stream when open
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setCameraState('initializing');
      setErrorMessage('');
      setPhotoError('');
      return;
    }

    let isMounted = true;
    setCameraState('initializing');
    setErrorMessage('');
    setPhotoError('');

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
          setErrorMessage('Camera permission was blocked. You can still use your native Camera App to snap a photo below.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setErrorMessage('No camera found on this device. Use your Camera App to take a photo of the QR code.');
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
      {/* Hidden file input for native Camera App capture */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={handlePhotoCaptured}
        data-testid="camera-file-input"
      />

      {/* Header */}
      <div style={{ width: '100%', maxWidth: '440px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700, color: '#f8fafc' }}>
            {title}
          </h2>
          <p style={{ margin: '0.2rem 0 0 0', fontSize: '0.8rem', color: '#94a3b8' }}>
            Scan the live rotating QR code on screen
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
            <p style={{ margin: '0 0 0.85rem 0', fontSize: '0.9rem', lineHeight: 1.4 }}>
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="passkey-btn passkey-btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                padding: '0.55rem 1rem',
              }}
              disabled={isProcessingPhoto}
            >
              {isProcessingPhoto ? 'Scanning photo...' : '📸 Open Camera App to Snap Photo'}
            </button>
          </div>
        )}
      </div>

      {/* Footer Controls & Instructions */}
      <div style={{ width: '100%', maxWidth: '380px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {photoError && (
          <div style={{ background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', borderRadius: '8px', padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#fca5a5', lineHeight: 1.4 }}>
            ⚠️ {photoError}
          </div>
        )}

        <p style={{ margin: 0, fontSize: '0.85rem', color: '#cbd5e1', lineHeight: 1.4, textAlign: 'center' }}>
          {instructions}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
          {torchSupported && cameraState === 'active' && (
            <button
              type="button"
              onClick={toggleTorch}
              className="passkey-btn passkey-btn-secondary"
              style={{ flex: 1, padding: '0.6rem 0.75rem', fontSize: '0.85rem' }}
            >
              {torchOn ? '🔦 Flashlight Off' : '💡 Flashlight On'}
            </button>
          )}

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="passkey-btn passkey-btn-secondary"
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.4rem',
              padding: '0.6rem 0.75rem',
              fontSize: '0.85rem',
            }}
            disabled={isProcessingPhoto}
          >
            {isProcessingPhoto ? (
              <>
                <span className="passkey-spinner" style={{ width: 14, height: 14 }} />
                <span>Reading...</span>
              </>
            ) : (
              <>
                <span>📸</span>
                <span>Camera App (Photo)</span>
              </>
            )}
          </button>
        </div>

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
