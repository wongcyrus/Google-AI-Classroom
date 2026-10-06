/**
 * Passkey Error Normalizer & Platform Diagnostic Utilities
 * 
 * Provides human-readable, actionable guidance for platform-specific WebAuthn failure modes:
 * 1. Android devices missing lock screen/biometrics ("provider not found" / CreateCredentialNoProviderException).
 * 2. iOS devices where Microsoft Authenticator is enabled but iCloud Keychain is disabled.
 * 3. Browser silos (e.g. registered in Chrome but opened in Samsung Internet causing credential/device mismatch).
 * 4. User cancellations and expired QR tokens.
 */

import { isAndroidDevice, isIOSDevice, getBrowserName } from './browserDetection';

/**
 * Checks if the user's platform has a user-verifying authenticator (biometrics / PIN / screen lock) available.
 * @returns {Promise<boolean>}
 */
export const checkPlatformAuthenticatorAvailable = async () => {
  try {
    if (typeof window === 'undefined') {
      return true;
    }
    if (window.PublicKeyCredential && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
    return true;
  } catch (err) {
    console.warn('[passkeyErrorUtils] Capability check error:', err);
    return true; // Fallback to allowing attempt if check throws
  }
};

/**
 * Normalizes raw WebAuthn and backend error messages into actionable, student-friendly diagnostics.
 * 
 * @param {Error|string} error - The caught error
 * @param {Object} [context] - Environmental context (isAndroid, isIOS, browserName)
 * @returns {Object} Structured diagnostic information
 */
export const normalizePasskeyError = (error, context = {}) => {
  const rawMsg = (typeof error === 'string' ? error : error?.message || '').trim();
  const errName = typeof error === 'object' && error?.name ? error.name : '';
  const isAndroid = context.isAndroid !== undefined ? context.isAndroid : isAndroidDevice();
  const isIOS = context.isIOS !== undefined ? context.isIOS : isIOSDevice();
  const browser = context.browserName || getBrowserName();

  // 1. Android Missing Biometrics / Screen Lock / Provider Not Found
  const isProviderMissing = /provider not found|no credential provider|CreateCredentialNoProviderException|TYPE_NO_CREATE_OPTIONS/i.test(rawMsg);
  const isPlatformNotSupported = errName === 'NotSupportedError' || /the operation is not supported|cannot satisfy the requested requirements/i.test(rawMsg);

  if (isAndroid && (isProviderMissing || isPlatformNotSupported)) {
    return {
      type: 'android_screen_lock_missing',
      title: 'Screen Lock & Biometrics Required',
      message: 'Your Android phone needs a secure Screen Lock to register or use passkeys.',
      resolutionSteps: [
        'Open your phone "Settings" > "Security & Privacy" (or "Lock screen").',
        'Set up a Fingerprint, Face Unlock, or PIN / Pattern screen lock.',
        'Ensure "Google Password Manager" is enabled under "Settings" > "Passwords & Accounts" > "Autofill service".',
      ],
      action: 'enable_screen_lock',
      raw: rawMsg,
    };
  }

  // 2. iOS Microsoft Authenticator / iCloud Keychain Disabled
  // When Microsoft Authenticator is the autofill provider and Apple Keychain is turned off,
  // iOS throws NotSupportedError or NotAllowedError because MS Authenticator does not support 3rd-party passkeys.
  if (isIOS && (isPlatformNotSupported || (errName === 'NotAllowedError' && !rawMsg.includes('cancelled') && !rawMsg.includes('canceled')))) {
    return {
      type: 'ios_keychain_missing',
      title: 'iPhone Passkey Setting Required',
      message: 'If you use Microsoft Authenticator, Apple iCloud Keychain must also be enabled for classroom passkeys.',
      resolutionSteps: [
        'Open iPhone "Settings" > "Passwords" > "Password Options" (or "AutoFill Passwords and Passkeys").',
        'Ensure "iCloud Passwords & Keychain" (Apple Passwords) is turned ON (checked).',
        'Note: Microsoft Authenticator on iOS only supports Microsoft accounts; third-party website passkeys require Apple Keychain.',
      ],
      action: 'enable_keychain',
      raw: rawMsg,
    };
  }

  // 3. User explicitly cancelled biometric scan
  if (errName === 'NotAllowedError' || /cancelled|user cancelled|canceled/i.test(rawMsg)) {
    return {
      type: 'user_cancelled',
      title: 'Biometric Scan Cancelled',
      message: 'Biometric verification prompt was cancelled. Tap the button below to try again.',
      resolutionSteps: ['Tap the button and authenticate with your Fingerprint or Face ID when prompted.'],
      action: 'retry',
      raw: rawMsg,
    };
  }

  // 4. Credential Mismatch ("wrong key"), Device Mismatch, or No Passkey/Phone Found
  if (
    /credential mismatch|wrong key|does not match the paired hardware key|does not belong to the student|no passkey found|no paired phone/i.test(rawMsg) ||
    /device mismatch/i.test(rawMsg)
  ) {
    return {
      type: 'credential_mismatch',
      title: 'Browser or Phone Mismatch',
      message: /no paired phone/i.test(rawMsg)
        ? rawMsg
        : 'This phone does not match the paired hardware passkey registered for this student account.',
      resolutionSteps: [
        isAndroid
          ? 'If you registered using Google Chrome, you must scan and open this link in Google Chrome (not Samsung Internet or another browser).'
          : 'Make sure you are using the same personal smartphone you originally paired.',
        'If you recently reset, updated, or switched to a new phone, ask your course instructor to reset your passkey registration.',
      ],
      action: isAndroid ? 'open_chrome' : 'contact_teacher',
      raw: rawMsg,
    };
  }

  // 5. Token Expired or Invalid QR
  if (/expired|already been used|invalid qr|invalid pairing token/i.test(rawMsg)) {
    return {
      type: 'token_expired',
      title: 'QR Code Expired',
      message: 'This QR code has expired or was already used. Live QR codes rotate periodically for security.',
      resolutionSteps: ['Please scan the fresh live QR code currently displayed on the screen.'],
      action: 'refresh_qr',
      raw: rawMsg,
    };
  }

  // 6. Hardware Lock (1 Phone = 1 Student)
  if (/hardware lock|already registered to another student|already bound to student/i.test(rawMsg)) {
    return {
      type: 'hardware_lock',
      title: 'Phone Already Registered',
      message: rawMsg.includes('Hardware Lock:')
        ? rawMsg.replace(/^.*Hardware Lock:\s*/, '')
        : 'This physical mobile phone is already registered to another student account. Phones cannot be shared.',
      resolutionSteps: ['Each student must pair their own personal handheld smartphone.'],
      action: 'different_phone',
      raw: rawMsg,
    };
  }

  // 7. Generic Fallback
  return {
    type: 'generic_error',
    title: 'Verification Failed',
    message: rawMsg || 'Biometric authentication could not be completed. Please try again.',
    resolutionSteps: ['Ensure you are using Google Chrome (Android) or Apple Safari (iPhone).'],
    action: 'retry',
    raw: rawMsg,
  };
};
