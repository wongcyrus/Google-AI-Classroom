/**
 * Device Brand Detection & Platform Troubleshooting Utilities
 * 
 * Provides brand-level heuristics and vendor-specific setup guides for WebAuthn passkey enrollment.
 * Covers: Apple iOS, Honor (MagicOS), Samsung (One UI), Xiaomi/POCO (HyperOS/MIUI),
 * OPPO/OnePlus (ColorOS), Vivo/iQOO (OriginOS), Huawei (HarmonyOS), and Google Pixel/Stock Android.
 */

export const DEVICE_BRAND_GUIDES = {
  apple: {
    id: 'apple',
    brandName: 'Apple iPhone (iOS)',
    icon: '🍎',
    supportedBrowsers: 'Apple Safari or Google Chrome',
    steps: [
      'Open iPhone "Settings" > "Passwords" > "Password Options" (or "AutoFill Passwords and Passkeys").',
      'Ensure "iCloud Passwords & Keychain" (Apple Passwords) is turned ON (checked).',
      'If you use Microsoft Authenticator, ensure iCloud Keychain is also enabled (MS Authenticator on iOS only supports Microsoft accounts).',
      'Ensure Face ID or Touch ID is enrolled in "Settings" > "Face ID & Passcode".',
      'Both Apple Safari and Google Chrome on iOS are fully supported.',
    ],
  },
  honor: {
    id: 'honor',
    brandName: 'Honor (MagicOS 8.0 / 7.0)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Honor / MagicOS 8.0: Open "Settings" > "Users & accounts" (用户与账户) and turn ON "Google Play Services" (Google Play 服务).',
      'Set Google Autofill: Open "Settings" > "System & updates" > "Language & input" > "Autofill service" and select "Google".',
      'Enroll Screen Lock: Open "Settings" > "Biometrics & password" and set a PIN and Fingerprint.',
      'Always open the QR link in Google Chrome (Honor built-in browser does not support passkey sync).',
    ],
  },
  samsung: {
    id: 'samsung',
    brandName: 'Samsung Galaxy (One UI)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Open this link in Google Chrome (Samsung Internet does NOT sync passkeys with Google Password Manager).',
      'Enroll Screen Lock: Open "Settings" > "Security and privacy" > "Lock screen" and register Fingerprint or PIN.',
      'Enable Google Autofill: Open "Settings" > "General management" > "Passwords and autofill" (or "Autofill service") and choose "Google".',
    ],
  },
  xiaomi: {
    id: 'xiaomi',
    brandName: 'Xiaomi / Redmi / POCO (HyperOS / MIUI)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Always open the QR link in Google Chrome (Mi Browser is not supported).',
      'Enable Google Services: If using a regional/China ROM, open "Settings" > "Accounts & sync" and turn ON "Basic Google services".',
      'Set Google Autofill: Open "Settings" > "Additional settings" > "Languages & input" > "Autofill service" and select "Google".',
      'Enroll Screen Lock: Open "Settings" > "Passwords & security" and enroll Fingerprint or PIN.',
    ],
  },
  oppo: {
    id: 'oppo',
    brandName: 'OPPO / OnePlus / Realme (ColorOS / OxygenOS)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Open the QR link in Google Chrome (stock browser is not supported).',
      'Enroll Screen Lock: Open "Settings" > "Password & security" and enroll Fingerprint and Lock Screen Password.',
      'Set Google Autofill: Open "Settings" > "Additional settings" > "Keyboard & input method" > "Autofill service" and select "Google".',
    ],
  },
  vivo: {
    id: 'vivo',
    brandName: 'Vivo / iQOO (OriginOS / FuntouchOS)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Open the QR link in Google Chrome (Vivo Browser is not supported).',
      'Enroll Screen Lock: Open "Settings" > "Fingerprint, face and password" and enroll Fingerprint and Screen Lock.',
      'Set Google Autofill: Open "Settings" > "More settings" (or "System management") > "Autofill service" and select "Google".',
    ],
  },
  pixel: {
    id: 'pixel',
    brandName: 'Google Pixel & Stock Android',
    icon: '🤖',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Open the QR link in Google Chrome.',
      'Enroll Screen Lock: Open "Settings" > "Security & privacy" > "Device unlock" and set a Fingerprint or PIN.',
      'Ensure "Google Password Manager" is active in "Settings" > "Passwords & accounts".',
    ],
  },
  huawei: {
    id: 'huawei',
    brandName: 'Huawei (HarmonyOS / EMUI)',
    icon: '📱',
    supportedBrowsers: 'Google Chrome (with GMS) or Teacher Exemption',
    steps: [
      'Huawei devices without Google Play Services cannot register Google WebAuthn passkeys.',
      'If your phone supports Google Play Services or microG, open the link in Google Chrome with screen lock enabled.',
      'If your phone lacks Google Play Services, please notify your course instructor for an in-person passkey exemption / bypass.',
    ],
  },
  android_generic: {
    id: 'android_generic',
    brandName: 'Android Smartphone',
    icon: '🤖',
    supportedBrowsers: 'Google Chrome only',
    steps: [
      'Open the QR link in Google Chrome (other browsers are not supported).',
      'Set up a secure Screen Lock (Fingerprint, PIN, or Pattern) in Android Settings > Security.',
      'Ensure "Google Password Manager" is enabled in Settings > Passwords & Accounts > Autofill service.',
    ],
  },
};

/**
 * Detects the smartphone brand / OEM platform from the User Agent.
 * 
 * @param {string} [customUserAgent] - Optional UA string for testing
 * @returns {string} Brand identifier ('apple' | 'honor' | 'samsung' | 'xiaomi' | 'oppo' | 'vivo' | 'pixel' | 'huawei' | 'android_generic' | 'unknown')
 */
export const detectDeviceBrand = (customUserAgent) => {
  const userAgent = customUserAgent !== undefined
    ? customUserAgent
    : (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';

  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return 'apple';
  }

  if (/Honor|MagicOS|HNR\b/i.test(userAgent)) {
    return 'honor';
  }

  if (/Samsung|SM-[A-Z0-9]+|Galaxy/i.test(userAgent)) {
    return 'samsung';
  }

  // Check Vivo/iQOO before Xiaomi model regexes
  if (/vivo|iQOO|V[0-9]{4}[A-Z]?\b/i.test(userAgent)) {
    return 'vivo';
  }

  if (/Xiaomi|Redmi|POCO|Mi [A-Z0-9]|22[0-9]{2}|23[0-9]{2}|24[0-9]{2}|M20|M21/i.test(userAgent)) {
    return 'xiaomi';
  }

  if (/Huawei|HarmonyOS|HMA-|LYA-|VOG-|ELE-|TAS-|NOH-/i.test(userAgent)) {
    return 'huawei';
  }

  if (/OPPO|OnePlus|Realme|CPH[0-9]{4}|PG[A-Z0-9]{4}|KB200|IN202|NE221/i.test(userAgent)) {
    return 'oppo';
  }

  if (/vivo|iQOO|V2[0-9]{3}/i.test(userAgent)) {
    return 'vivo';
  }

  if (/Pixel/i.test(userAgent)) {
    return 'pixel';
  }

  if (/Android/i.test(userAgent)) {
    return 'android_generic';
  }

  return 'unknown';
};

/**
 * Retrieves the tailored troubleshooting guide for a given brand ID.
 * 
 * @param {string} brandId - Device brand key
 * @returns {Object} Brand guide configuration
 */
export const getDeviceBrandGuide = (brandId) => {
  return DEVICE_BRAND_GUIDES[brandId] || DEVICE_BRAND_GUIDES.android_generic;
};
