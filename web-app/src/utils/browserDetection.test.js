import { describe, it, expect } from 'vitest';
import { isGoogleChrome, getBrowserName, isMobileDevice } from './browserDetection';

describe('browserDetection Utility', () => {
  it('identifies genuine Google Chrome desktop and Android as Chrome', () => {
    const chromeDesktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    const chromeVendor = 'Google Inc.';

    expect(isGoogleChrome(chromeDesktopUA, chromeVendor)).toBe(true);
    expect(getBrowserName(chromeDesktopUA, chromeVendor)).toBe('Google Chrome');
  });

  it('identifies Chrome on iOS (CriOS) as Chrome', () => {
    const chromeIOSUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0.6613.92 Mobile/15E148 Safari/604.1';
    const appleVendor = 'Apple Computer, Inc.';

    expect(isGoogleChrome(chromeIOSUA, appleVendor)).toBe(true);
    expect(getBrowserName(chromeIOSUA, appleVendor)).toBe('Google Chrome (iOS)');
  });

  it('rejects Microsoft Edge', () => {
    const edgeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.2739.42';
    const vendor = 'Google Inc.';

    expect(isGoogleChrome(edgeUA, vendor)).toBe(false);
    expect(getBrowserName(edgeUA, vendor)).toBe('Microsoft Edge');
  });

  it('rejects Mozilla Firefox', () => {
    const firefoxUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';
    const vendor = '';

    expect(isGoogleChrome(firefoxUA, vendor)).toBe(false);
    expect(getBrowserName(firefoxUA, vendor)).toBe('Mozilla Firefox');
  });

  it('rejects Apple Safari', () => {
    const safariUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
    const vendor = 'Apple Computer, Inc.';

    expect(isGoogleChrome(safariUA, vendor)).toBe(false);
    expect(getBrowserName(safariUA, vendor)).toBe('Apple Safari');
  });

  it('rejects Opera Browser', () => {
    const operaUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 OPR/114.0.0.0';
    const vendor = 'Google Inc.';

    expect(isGoogleChrome(operaUA, vendor)).toBe(false);
    expect(getBrowserName(operaUA, vendor)).toBe('Opera');
  });

  it('rejects Brave Browser', () => {
    const braveUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    const vendor = 'Google Inc.';

    expect(isGoogleChrome(braveUA, vendor, true)).toBe(false);
    expect(getBrowserName(braveUA, vendor, true)).toBe('Brave Browser');
  });

  it('rejects Samsung Internet', () => {
    const samsungUA = 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.6261.119 Mobile Safari/537.36';
    const vendor = 'Google Inc.';

    expect(isGoogleChrome(samsungUA, vendor)).toBe(false);
    expect(getBrowserName(samsungUA, vendor)).toBe('Samsung Internet');
  });

  it('rejects Vivaldi', () => {
    const vivaldiUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Vivaldi/6.9.3447.37';
    const vendor = 'Google Inc.';

    expect(isGoogleChrome(vivaldiUA, vendor)).toBe(false);
    expect(getBrowserName(vivaldiUA, vendor)).toBe('Vivaldi');
  });

  describe('isMobileDevice', () => {
    it('detects iPhone and Android user agents as mobile', () => {
      const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36';

      expect(isMobileDevice(iPhoneUA, 1024)).toBe(true);
      expect(isMobileDevice(androidUA, 1024)).toBe(true);
    });

    it('detects narrow viewports (<= 768px) as mobile even on generic user agent', () => {
      const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

      expect(isMobileDevice(desktopUA, 414)).toBe(true);
      expect(isMobileDevice(desktopUA, 768)).toBe(true);
      expect(isMobileDevice(desktopUA, 1024)).toBe(false);
    });

    it('detects rotated landscape phones (e.g. 844x390, 852x393) as mobile', () => {
      const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

      // iPhone in landscape (width > 768px, but height <= 550px)
      expect(isMobileDevice(desktopUA, 844, 390)).toBe(true);
      expect(isMobileDevice(desktopUA, 852, 393)).toBe(true);
      expect(isMobileDevice(desktopUA, 932, 430)).toBe(true);

      // Desktop 1080p should not be mobile
      expect(isMobileDevice(desktopUA, 1920, 1080)).toBe(false);
      expect(isMobileDevice(desktopUA, 1280, 800)).toBe(false);
    });
  });
});
