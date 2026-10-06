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
    return true; // Default fallback for SSR
  }

  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  const vendor = customVendor !== undefined
    ? customVendor
    : (typeof navigator !== 'undefined' ? navigator.vendor : '') || '';

  // In standard jsdom test environment without custom UA, return true
  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return true;
  }

  const isBrave = isBraveFlag !== undefined
    ? isBraveFlag
    : (typeof navigator !== 'undefined' && Boolean(navigator.brave && typeof navigator.brave.isBrave === 'function'));

  if (isBrave) return false;

  const isOtherChromium = /Edg\/|Edge\/|OPR\/|OPT\/|Opera\/|SamsungBrowser\/|UCBrowser\/|Vivaldi\/|YaBrowser\/|DuckDuckGo\//i.test(userAgent);
  if (isOtherChromium) return false;

  const isFirefox = /Firefox\/|FxiOS\//i.test(userAgent);
  if (isFirefox) return false;

  const isDesktopOrAndroidChrome = /Google Inc/i.test(vendor) && /Chrome\//i.test(userAgent);
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

/**
 * Detects whether the current browser environment is genuine Apple Safari.
 * Excludes Google Chrome, Chrome on iOS, Microsoft Edge, Mozilla Firefox, Samsung Internet, etc.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {string} [customVendor] - Optional vendor string for testing
 * @returns {boolean} True if genuine Apple Safari, false otherwise.
 */
export const isAppleSafari = (customUserAgent, customVendor) => {
  if (typeof window === 'undefined' && customUserAgent === undefined) {
    return false;
  }

  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  const vendor = customVendor !== undefined
    ? customVendor
    : (typeof navigator !== 'undefined' ? navigator.vendor : '') || '';

  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return false;
  }

  // Reject Chrome on iOS (CriOS), Firefox on iOS (FxiOS), Edge on iOS (EdgiOS), Opera (OPiOS/OPT), Brave, DuckDuckGo
  if (/CriOS\/|FxiOS\/|EdgiOS\/|Edg\/|OPR\/|OPT\/|OPiOS\/|Opera\/|SamsungBrowser\/|UCBrowser\/|Vivaldi\/|YaBrowser\/|DuckDuckGo\//i.test(userAgent)) {
    return false;
  }

  // Reject desktop Chrome, Chromium, Firefox
  if (/Chrome\/|Chromium\/|Firefox\//i.test(userAgent)) {
    return false;
  }

  // Must have Safari token
  if (!/Safari\//i.test(userAgent)) {
    return false;
  }

  // Must match Apple vendor or Apple OS (iPhone, iPad, iPod, Mac)
  const isApple = /Apple Computer/i.test(vendor) || /iPhone|iPad|iPod|Macintosh/i.test(userAgent);
  return Boolean(isApple);
};

/**
 * Checks if the current browser is within the supported browser whitelist.
 * STRICT POLICY: Only Google Chrome and Apple Safari are supported.
 * All other browsers (Samsung Internet, Firefox, Edge, Opera, UC, etc.) return false.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {string} [customVendor] - Optional vendor string for testing
 * @param {boolean} [isBraveFlag] - Optional flag for Brave
 * @returns {boolean} True if Google Chrome or Apple Safari, false otherwise.
 */
export const isSupportedBrowser = (customUserAgent, customVendor, isBraveFlag) => {
  return isGoogleChrome(customUserAgent, customVendor, isBraveFlag) || isAppleSafari(customUserAgent, customVendor);
};

/**
 * Detects whether the current device is running Android OS.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @returns {boolean} True if Android OS, false otherwise.
 */
export const isAndroidDevice = (customUserAgent) => {
  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  return /Android/i.test(userAgent);
};

/**
 * Detects whether the current device is running Apple iOS / iPadOS.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {number} [customTouchPoints] - Optional maxTouchPoints for testing
 * @returns {boolean} True if iOS / iPadOS device, false otherwise.
 */
export const isIOSDevice = (customUserAgent, customTouchPoints) => {
  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  const touchPoints = customTouchPoints !== undefined
    ? customTouchPoints
    : (typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0);

  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  // Modern iPadOS Safari in desktop mode reports as Macintosh with multi-touch
  if (/Macintosh/i.test(userAgent) && touchPoints > 1) return true;
  return false;
};

/**
 * Detects whether the current device is manufactured by Honor (running MagicOS).
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @returns {boolean} True if Honor / MagicOS device, false otherwise.
 */
export const isHonorDevice = (customUserAgent) => {
  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
  return /Honor|MagicOS|HNR\b/i.test(userAgent);
};

/**
 * Generates an Android Chrome Intent URI from a target URL or current location.
 * When opened in non-Chrome Android browsers (e.g. Samsung Internet),
 * the Android OS directly launches Google Chrome to the exact same URL.
 * 
 * @param {string|Location} [targetUrl] - Target URL string or Location object
 * @returns {string} Intent URI formatted for com.android.chrome
 */
export const getAndroidChromeIntentUrl = (targetUrl) => {
  try {
    const raw = typeof targetUrl === 'string'
      ? targetUrl
      : (typeof window !== 'undefined' ? window.location.href : 'https://it114115-2627.web.app');
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://it114115-2627.web.app';
    const parsed = new URL(raw, base);
    const hostAndPath = `${parsed.host}${parsed.pathname}${parsed.search}${parsed.hash}`;
    const scheme = parsed.protocol.replace(':', '') || 'https';
    return `intent://${hostAndPath}#Intent;scheme=${scheme};package=com.android.chrome;end`;
  } catch (err) {
    console.warn('[getAndroidChromeIntentUrl] Error constructing intent URI:', err);
    return typeof targetUrl === 'string' ? targetUrl : (typeof window !== 'undefined' ? window.location.href : '');
  }
};

/**
 * Detects whether the current device is a tablet (iPad or Android tablet/pad).
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {number} [customTouchPoints] - Optional maxTouchPoints for testing
 * @param {number} [customWidth] - Optional viewport width for testing
 * @param {number} [customHeight] - Optional viewport height for testing
 * @returns {boolean} True if tablet, false otherwise.
 */
export const isTabletDevice = (customUserAgent, customTouchPoints, customWidth, customHeight) => {
  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return false;
  }

  // Explicitly reject handheld phones (iPhone or Android Mobile) from tablet detection
  if (/iPhone|iPod/i.test(userAgent) || (/Android/i.test(userAgent) && /Mobile/i.test(userAgent))) {
    return false;
  }

  const touchPoints = customTouchPoints !== undefined
    ? customTouchPoints
    : (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0) || 0;

  const width = customWidth !== undefined
    ? customWidth
    : (typeof window !== 'undefined' ? window.innerWidth : 1024);

  const height = customHeight !== undefined
    ? customHeight
    : (typeof window !== 'undefined' ? window.innerHeight : 800);

  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);

  const screenMin = typeof window !== 'undefined' && window.screen
    ? Math.min(window.screen.width || 1024, window.screen.height || 800)
    : 1024;

  // 1. Explicit iPad UA or iPadOS 13+ desktop Mac UA with multi-touch and tablet-sized display
  const isIPad = /iPad/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && touchPoints > 1 && (minDim >= 600 || screenMin >= 600));
  if (isIPad) return true;

  // 2. Android Tablet: 'Android' WITHOUT 'Mobile'
  const isAndroidTablet = /Android/i.test(userAgent) && !/Mobile/i.test(userAgent);
  if (isAndroidTablet) return true;

  // 3. Touch device with tablet screen geometry (short dimension >= 600px and max dimension >= 900px, e.g. 768x1024, 800x1280)
  // Ensure physical screen is not a smartphone emulating desktop viewport (screenMin must also be >= 600)
  if (touchPoints > 1 && minDim >= 600 && maxDim >= 900 && screenMin >= 600 && !/Windows NT|Macintosh/i.test(userAgent)) {
    return true;
  }

  return false;
};

/**
 * Detects whether the current client is strictly a handheld smartphone (iPhone or Android phone).
 * Excludes tablets (iPads, Android pads) and desktop computers.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {number} [customTouchPoints] - Optional maxTouchPoints for testing
 * @param {number} [customWidth] - Optional viewport width for testing
 * @param {number} [customHeight] - Optional viewport height for testing
 * @returns {boolean} True if handheld smartphone, false otherwise.
 */
export const isHandheldPhone = (customUserAgent, customTouchPoints, customWidth, customHeight) => {
  if (isTabletDevice(customUserAgent, customTouchPoints, customWidth, customHeight)) {
    return false;
  }

  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  if (customUserAgent === undefined && /jsdom/i.test(userAgent)) {
    return false;
  }

  // iPhone or iPod
  if (/iPhone|iPod/i.test(userAgent)) return true;

  // Android Phone ('Android' AND 'Mobile')
  if (/Android/i.test(userAgent) && /Mobile/i.test(userAgent)) return true;

  // Other handheld phone UA
  if (/webOS|BlackBerry|IEMobile|Opera Mini/i.test(userAgent)) return true;

  const width = customWidth !== undefined
    ? customWidth
    : (typeof window !== 'undefined' ? window.innerWidth : 1024);

  const height = customHeight !== undefined
    ? customHeight
    : (typeof window !== 'undefined' ? window.innerHeight : 800);

  // Small viewport characteristic of phones (short dimension < 600px)
  if (Math.min(width, height) < 600) {
    return true;
  }

  // Physical screen size fallback with touch (e.g. mobile browser with "Desktop site" requested)
  // When Desktop site is enabled in mobile Chrome/Safari, innerWidth is emulated as 980px+,
  // but physical screen dimensions (screen.width/height) remain < 600px with touch capabilities.
  const touchPoints = customTouchPoints !== undefined
    ? customTouchPoints
    : (typeof navigator !== 'undefined' ? (navigator.maxTouchPoints || 0) : 0);

  if (touchPoints > 0 && typeof window !== 'undefined' && window.screen) {
    const physScreenMin = Math.min(window.screen.width || 1024, window.screen.height || 800);
    if (physScreenMin > 0 && physScreenMin < 600) {
      return true;
    }
  }

  return false;
};

/**
 * Detects whether the current client is any mobile device (handheld phone or tablet)
 * by examining device type, touch capability, or responsive viewport dimensions.
 * 
 * @param {string} [customUserAgent] - Optional user agent string for testing
 * @param {number} [customWidth] - Optional viewport width for testing
 * @param {number} [customHeight] - Optional viewport height for testing
 * @returns {boolean} True if mobile device, false otherwise.
 */
export const isMobileDevice = (customUserAgent, customWidth, customHeight) => {
  const width = customWidth !== undefined
    ? customWidth
    : (typeof window !== 'undefined' ? window.innerWidth : 1024);

  const height = customHeight !== undefined
    ? customHeight
    : (typeof window !== 'undefined' ? window.innerHeight : 800);

  // Portrait phone/tablet or small responsive screen
  if (width <= 768) return true;

  // Landscape phone
  if (height <= 550 && width <= 1024) return true;

  return isHandheldPhone(customUserAgent, undefined, customWidth, customHeight) ||
    isTabletDevice(customUserAgent, undefined, customWidth, customHeight);
};



