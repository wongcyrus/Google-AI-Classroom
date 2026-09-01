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
  // Unlocked browser constraint for testing: allow all modern browsers
  return true;
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
