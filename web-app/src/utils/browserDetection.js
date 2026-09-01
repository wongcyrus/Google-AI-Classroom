/**
 * Browser Detection Utility
 * Enforces Google Chrome requirement for student monitoring and invigilation integrity.
 */

/**
 * Detects whether the current browser environment is genuine Google Chrome.
 * Detects and rejects other browsers including Firefox, Safari, Edge, Opera, Brave, Samsung Internet, etc.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {string} [customVendor] - Optional vendor string for testing
 * @param {boolean} [isBraveFlag] - Optional flag for Brave browser detection
 * @returns {boolean} True if Google Chrome, false otherwise.
 */
export const isGoogleChrome = (customUserAgent, customVendor, isBraveFlag) => {
  if (typeof window === 'undefined' && customUserAgent === undefined) {
    return true; // Default fallback for SSR / non-browser test environments
  }

  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  const vendor = customVendor !== undefined
    ? customVendor
    : (typeof navigator !== 'undefined' ? navigator.vendor : '') || '';

  // In headless/test DOM environments (jsdom) without explicit custom UA, default to true
  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return true;
  }

  const isBrave = isBraveFlag !== undefined
    ? isBraveFlag
    : (typeof navigator !== 'undefined' && Boolean(navigator.brave && typeof navigator.brave.isBrave === 'function'));

  // 1. Explicitly reject Brave
  if (isBrave) {
    return false;
  }

  // 2. Reject Chromium-derived browsers that are not genuine Google Chrome
  // Edge: Edg/ or Edge/
  // Opera: OPR/ or OPT/ or Opera/
  // Samsung Internet: SamsungBrowser/
  // UC Browser: UCBrowser/
  // Vivaldi: Vivaldi/
  // Yandex: YaBrowser/
  // DuckDuckGo: DuckDuckGo/
  const isOtherChromium = /Edg\/|Edge\/|OPR\/|OPT\/|Opera\/|SamsungBrowser\/|UCBrowser\/|Vivaldi\/|YaBrowser\/|DuckDuckGo\//i.test(userAgent);
  if (isOtherChromium) {
    return false;
  }

  // 3. Reject Gecko (Firefox)
  const isFirefox = /Firefox\/|FxiOS\//i.test(userAgent);
  if (isFirefox) {
    return false;
  }

  // 4. Genuine Google Chrome Desktop & Android:
  // Vendor is 'Google Inc.' and userAgent contains 'Chrome/'
  const isDesktopOrAndroidChrome = /Google Inc/i.test(vendor) && /Chrome\//i.test(userAgent);

  // 5. Google Chrome on iOS:
  // Uses 'CriOS/' in userAgent (due to iOS WebKit requirement, vendor may be Apple)
  const isIOSChrome = /CriOS\//i.test(userAgent);

  return Boolean(isDesktopOrAndroidChrome || isIOSChrome);
};

/**
 * Returns a human-readable name of the current detected browser.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {string} [customVendor] - Optional vendor string for testing
 * @param {boolean} [isBraveFlag] - Optional flag for Brave
 * @returns {string} Name of browser (e.g. 'Google Chrome', 'Mozilla Firefox', 'Apple Safari', 'Microsoft Edge', etc.)
 */
export const getBrowserName = (customUserAgent, customVendor, isBraveFlag) => {
  if (typeof window === 'undefined' && customUserAgent === undefined) {
    return 'Google Chrome';
  }

  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return 'Google Chrome';
  }

  const isBrave = isBraveFlag !== undefined
    ? isBraveFlag
    : (typeof navigator !== 'undefined' && Boolean(navigator.brave && typeof navigator.brave.isBrave === 'function'));

  if (isBrave) return 'Brave Browser';
  if (/Edg\/|Edge\//i.test(userAgent)) return 'Microsoft Edge';
  if (/OPR\/|OPT\/|Opera\//i.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/UCBrowser\//i.test(userAgent)) return 'UC Browser';
  if (/Vivaldi\//i.test(userAgent)) return 'Vivaldi';
  if (/Firefox\/|FxiOS\//i.test(userAgent)) return 'Mozilla Firefox';
  if (/CriOS\//i.test(userAgent)) return 'Google Chrome (iOS)';
  if (/Google Inc/i.test(customVendor !== undefined ? customVendor : (typeof navigator !== 'undefined' ? navigator.vendor : '')) && /Chrome\//i.test(userAgent)) {
    return 'Google Chrome';
  }
  if (/Safari\//i.test(userAgent) && !/Chrome\//i.test(userAgent)) return 'Apple Safari';
  
  return 'Non-Chrome Browser';
};
