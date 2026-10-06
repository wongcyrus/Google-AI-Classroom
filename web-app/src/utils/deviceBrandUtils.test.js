import { describe, it, expect } from 'vitest';
import {
  detectDeviceBrand,
  getDeviceBrandGuide,
  DEVICE_BRAND_GUIDES,
} from './deviceBrandUtils';

describe('deviceBrandUtils', () => {
  describe('detectDeviceBrand', () => {
    it('detects Apple iPhone UA correctly', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
      expect(detectDeviceBrand(ua)).toBe('apple');
    });

    it('detects Honor / MagicOS UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; HONOR ELP-AN00 Build/HONORELP-AN00) AppleWebKit/537.36 Chrome/120.0.6099.230 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('honor');
    });

    it('detects Samsung Galaxy UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('samsung');
    });

    it('detects Xiaomi / Redmi UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; 23116PN5BC) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('xiaomi');
    });

    it('detects OPPO / OnePlus UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; CPH2551) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('oppo');
    });

    it('detects Vivo / iQOO UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; V2324A) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('vivo');
    });

    it('detects Google Pixel UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('pixel');
    });

    it('detects Huawei UA correctly', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00) AppleWebKit/537.36 Chrome/99.0.4844.88 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('huawei');
    });

    it('falls back to android_generic for unbranded Android devices', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; UnknownCustomDevice) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36';
      expect(detectDeviceBrand(ua)).toBe('android_generic');
    });

    it('returns unknown for non-mobile platforms without OS tokens', () => {
      const ua = 'CustomBot/1.0';
      expect(detectDeviceBrand(ua)).toBe('unknown');
    });
  });

  describe('getDeviceBrandGuide', () => {
    it('returns the exact guide for a known brand', () => {
      const guide = getDeviceBrandGuide('honor');
      expect(guide.brandName).toContain('Honor');
      expect(guide.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('Google Play Services'),
        expect.stringContaining('Google'),
      ]));
    });

    it('returns apple guide for apple brandId', () => {
      const guide = getDeviceBrandGuide('apple');
      expect(guide.brandName).toContain('Apple');
      expect(guide.steps).toEqual(expect.arrayContaining([
        expect.stringContaining('iCloud Passwords & Keychain'),
      ]));
    });

    it('falls back to android_generic guide for invalid brandId', () => {
      const guide = getDeviceBrandGuide('some_nonexistent_brand');
      expect(guide.id).toBe('android_generic');
    });
  });
});
