import { describe, it, expect } from 'vitest';
import { isGoogleChrome, getBrowserName, isMobileDevice, isTabletDevice, isHandheldPhone } from './browserDetection';

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

  describe('isTabletDevice', () => {
    const classicIpadUA = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
    const modernIpadOSUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const androidTabletUA = 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Safari/537.36';
    const androidPhoneUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36';
    const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const macDesktopUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

    it('identifies classic iPad as tablet', () => {
      expect(isTabletDevice(classicIpadUA, 0)).toBe(true);
    });

    it('identifies modern iPadOS in desktop Safari mode (Macintosh UA + multi-touch > 1) as tablet', () => {
      expect(isTabletDevice(modernIpadOSUA, 5)).toBe(true);
    });

    it('does not classify genuine Mac desktop without touch as tablet', () => {
      expect(isTabletDevice(macDesktopUA, 0)).toBe(false);
    });

    it('identifies Android Tablet (Android without Mobile token) as tablet', () => {
      expect(isTabletDevice(androidTabletUA, 5)).toBe(true);
    });

    it('does not classify Android phone (Android + Mobile token) as tablet', () => {
      expect(isTabletDevice(androidPhoneUA, 5)).toBe(false);
    });

    it('does not classify iPhone as tablet', () => {
      expect(isTabletDevice(iPhoneUA, 5)).toBe(false);
    });
  });

  describe('isHandheldPhone', () => {
    const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const androidPhoneUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36';
    const classicIpadUA = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';
    const modernIpadOSUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    const androidTabletUA = 'Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Safari/537.36';
    const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

    it('allows iPhone and Android phones', () => {
      expect(isHandheldPhone(iPhoneUA, 5)).toBe(true);
      expect(isHandheldPhone(androidPhoneUA, 5)).toBe(true);
    });

    it('blocks iPads from being considered handheld phones', () => {
      expect(isHandheldPhone(classicIpadUA, 5)).toBe(false);
      expect(isHandheldPhone(modernIpadOSUA, 5)).toBe(false);
    });

    it('blocks Android tablets from being considered handheld phones', () => {
      expect(isHandheldPhone(androidTabletUA, 5)).toBe(false);
    });

    it('blocks desktop PCs from being considered handheld phones', () => {
      expect(isHandheldPhone(desktopUA, 0, 1920, 1080)).toBe(false);
    });

    it('detects handheld phone even when Desktop site is requested with emulated 980px viewport', () => {
      const origScreen = window.screen;
      try {
        window.screen = { width: 393, height: 852 };
        const desktopSiteAndroidUA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
        // With touchPoints > 0 and physical screen < 600px, it should detect handheld phone
        expect(isHandheldPhone(desktopSiteAndroidUA, 5, 980, 1200)).toBe(true);
      } finally {
        window.screen = origScreen;
      }
    });
  });

  describe('isMobileDevice', () => {
    it('detects iPhone, Android phone, and tablets as mobile devices', () => {
      const iPhoneUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      const androidUA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.6613.88 Mobile Safari/537.36';
      const classicIpadUA = 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

      expect(isMobileDevice(iPhoneUA, 1024)).toBe(true);
      expect(isMobileDevice(androidUA, 1024)).toBe(true);
      expect(isMobileDevice(classicIpadUA, 1024)).toBe(true);
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

