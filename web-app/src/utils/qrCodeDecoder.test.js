import { describe, it, expect, vi, beforeEach } from 'vitest';
import jsQR from 'jsqr';
import { decodeQrFromElement, decodeQrFromImageFile } from './qrCodeDecoder';

vi.mock('jsqr', () => ({
  default: vi.fn(),
}));

describe('qrCodeDecoder Utility', () => {
  const mockCtx = {
    drawImage: vi.fn(),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(100) }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockCtx);
  });

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

  it('falls back to jsQR if BarcodeDetector throws', async () => {
    class MockFailingBarcodeDetector {
      constructor() {
        this.detect = vi.fn().mockRejectedValue(new Error('BarcodeDetector failed'));
      }
    }
    window.BarcodeDetector = MockFailingBarcodeDetector;

    jsQR.mockReturnValueOnce({ data: 'fallback-qr-data' });

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    const result = await decodeQrFromElement(canvas);
    expect(result).toBe('fallback-qr-data');

    delete window.BarcodeDetector;
  });

  it('returns null if element has zero width or height', async () => {
    const mockZero = { width: 0, height: 0 };
    expect(await decodeQrFromElement(mockZero)).toBeNull();
  });

  it('returns null if canvas 2d context cannot be created', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;

    expect(await decodeQrFromElement(canvas)).toBeNull();
  });

  it('catches errors in decodeQrFromElement and returns null', async () => {
    const failingSource = {
      width: 100,
      height: 100,
    };
    mockCtx.drawImage.mockImplementationOnce(() => {
      throw new Error('Canvas render fail');
    });

    const result = await decodeQrFromElement(failingSource);
    expect(result).toBeNull();
  });

  it('decodes QR from image file and downscales when width > maxDim (width > height)', async () => {
    jsQR.mockReturnValueOnce({ data: 'decoded-file-qr' });

    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.width = 2560;
        this.height = 1440;
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

    const blob = new Blob(['image data'], { type: 'image/jpeg' });
    const result = await decodeQrFromImageFile(blob);
    expect(result).toBe('decoded-file-qr');

    global.Image = originalImage;
  });

  it('decodes QR from image file and downscales when height > maxDim (height >= width)', async () => {
    jsQR.mockReturnValueOnce({ data: 'portrait-qr' });

    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.width = 1080;
        this.height = 1920;
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

    const blob = new Blob(['portrait image data'], { type: 'image/jpeg' });
    const result = await decodeQrFromImageFile(blob);
    expect(result).toBe('portrait-qr');

    global.Image = originalImage;
  });

  it('resolves null if canvas getContext fails in decodeQrFromImageFile', async () => {
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(null);

    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.width = 640;
        this.height = 480;
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

    const blob = new Blob(['image data'], { type: 'image/jpeg' });
    const result = await decodeQrFromImageFile(blob);
    expect(result).toBeNull();

    global.Image = originalImage;
  });

  it('catches processing error in img.onload and resolves null', async () => {
    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        this.width = 640;
        this.height = 480;
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

    mockCtx.drawImage.mockImplementationOnce(() => {
      throw new Error('Image parsing memory crash');
    });

    const blob = new Blob(['corrupt image data'], { type: 'image/jpeg' });
    const result = await decodeQrFromImageFile(blob);
    expect(result).toBeNull();

    global.Image = originalImage;
  });

  it('rejects when image loading fails with img.onerror', async () => {
    const originalImage = global.Image;
    global.Image = class {
      constructor() {
        setTimeout(() => {
          if (this.onerror) this.onerror(new Error('Corrupt image headers'));
        }, 10);
      }
      set src(val) {
        this._src = val;
      }
      get src() {
        return this._src;
      }
    };

    const blob = new Blob(['corrupt content'], { type: 'image/png' });
    await expect(decodeQrFromImageFile(blob)).rejects.toThrow('Failed to load image file');

    global.Image = originalImage;
  });

  it('rejects when FileReader encounters an error with reader.onerror', async () => {
    const originalFileReader = global.FileReader;
    global.FileReader = class {
      readAsDataURL() {
        setTimeout(() => {
          if (this.onerror) this.onerror(new Error('File reading permission error'));
        }, 10);
      }
    };

    const blob = new Blob(['sample data'], { type: 'image/png' });
    await expect(decodeQrFromImageFile(blob)).rejects.toThrow('Failed to read image file');

    global.FileReader = originalFileReader;
  });
});
