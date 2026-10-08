import { describe, it, expect, vi } from 'vitest';
import { decodeQrFromElement, decodeQrFromImageFile } from './qrCodeDecoder';

describe('qrCodeDecoder Utility', () => {
  it('returns null if element or file is null/undefined', async () => {
    expect(await decodeQrFromElement(null)).toBeNull();
    expect(await decodeQrFromImageFile(null)).toBeNull();
  });

  it('uses BarcodeDetector if available on window', async () => {
    const mockDetect = vi.fn().mockResolvedValue([{ rawValue: 'https://example.com/qr-token-123' }]);
    class MockBarcodeDetector {
      constructor() {
        this.detect = mockDetect;
      }
    }
    window.BarcodeDetector = MockBarcodeDetector;

    const mockVideo = {
      videoWidth: 640,
      videoHeight: 480,
    };

    const result = await decodeQrFromElement(mockVideo);
    expect(result).toBe('https://example.com/qr-token-123');
    expect(mockDetect).toHaveBeenCalledWith(mockVideo);

    delete window.BarcodeDetector;
  });

  it('falls back to jsQR and returns null if no QR found in empty frame', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    const result = await decodeQrFromElement(canvas);
    expect(result).toBeNull();
  });

  it('handles decodeQrFromImageFile with a dummy blob gracefully', async () => {
    // In jsdom, Image onload needs to be triggered
    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.width = 100;
        this.height = 100;
        setTimeout(() => {
          if (this.onload) this.onload();
        }, 10);
      }
      set src(val) {
        this._src = val;
      }
      get src() {
        return this._src;
      }
    };

    const blob = new Blob(['dummy content'], { type: 'image/png' });
    const result = await decodeQrFromImageFile(blob);
    expect(result).toBeNull();

    global.Image = originalImage;
  });
});
