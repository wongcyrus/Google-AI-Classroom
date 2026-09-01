import { describe, it, expect } from 'vitest';
import { isGoogleChrome, getBrowserName } from './browserDetection';

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
});
