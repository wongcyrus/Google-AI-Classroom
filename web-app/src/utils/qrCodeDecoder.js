import jsQR from 'jsqr';

/**
 * Decodes a QR code string from an HTML Image, Canvas, or Video element using native BarcodeDetector or jsQR fallback.
 * 
 * @param {HTMLImageElement|HTMLVideoElement|HTMLCanvasElement} source - Visual element
 * @returns {Promise<string|null>} Decoded QR string or null if no code detected
 */
export async function decodeQrFromElement(source) {
  if (!source) return null;

  // 1. Try native BarcodeDetector if available
  if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const barcodes = await detector.detect(source);
      if (barcodes && barcodes.length > 0 && barcodes[0]?.rawValue) {
        return barcodes[0].rawValue;
      }
    } catch {
      // Fall through to jsQR
    }
  }

  // 2. jsQR software fallback using temporary offscreen canvas
  try {
    const width = source.videoWidth || source.naturalWidth || source.width;
    const height = source.videoHeight || source.naturalHeight || source.height;

    if (!width || !height) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    ctx.drawImage(source, 0, 0, width, height);
    const imgData = ctx.getImageData(0, 0, width, height);
    const code = jsQR(imgData.data, width, height, {
      inversionAttempts: 'dontInvert',
    });

    return code?.data || null;
  } catch (err) {
    console.warn('[qrCodeDecoder] decodeQrFromElement error:', err);
    return null;
  }
}

/**
 * Reads an image file (e.g. from camera capture file input) and decodes any QR code present.
 * Downscales images exceeding 1280px max dimension for fast, responsive decoding.
 * 
 * @param {File|Blob} file - Uploaded or captured image blob/file
 * @returns {Promise<string|null>} Decoded QR code text or null
 */
export async function decodeQrFromImageFile(file) {
  if (!file) return null;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          const maxDim = 1280;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          if (!ctx) {
            resolve(null);
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const imgData = ctx.getImageData(0, 0, width, height);
          const code = jsQR(imgData.data, width, height, {
            inversionAttempts: 'dontInvert',
          });

          resolve(code?.data || null);
        } catch (err) {
          console.warn('[qrCodeDecoder] decodeQrFromImageFile parse error:', err);
          resolve(null);
        }
      };
      img.onerror = (e) => reject(new Error('Failed to load image file: ' + (e?.message || 'unknown')));
      img.src = reader.result;
    };
    reader.onerror = (e) => reject(new Error('Failed to read image file: ' + (e?.message || 'unknown')));
    reader.readAsDataURL(file);
  });
}
