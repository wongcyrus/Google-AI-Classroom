/**
 * Passkey Error Normalizer & Platform Diagnostic Utilities
 * 
 * Provides human-readable, actionable guidance for platform-specific WebAuthn failure modes:
 * 1. Android devices missing lock screen/biometrics ("provider not found" / CreateCredentialNoProviderException).
 * 2. iOS devices where Microsoft Authenticator is enabled but iCloud Keychain is disabled.
 * 3. Browser silos (e.g. registered in Chrome but opened in Samsung Internet causing credential/device mismatch).
 * 4. User cancellations and expired QR tokens.
 */

import { isAndroidDevice, isIOSDevice, isHonorDevice, getBrowserName } from './browserDetection';
import { detectDeviceBrand, getDeviceBrandGuide } from './deviceBrandUtils';

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
 * @param {Object} [context] - Environmental context (isAndroid, isIOS, isHonor, brand, browserName)
 * @returns {Object} Structured diagnostic information
 */
export const normalizePasskeyError = (error, context = {}) => {
  const rawMsg = (typeof error === 'string' ? error : error?.message || '').trim();
  const errName = typeof error === 'object' && error?.name ? error.name : '';
  const isAndroid = context.isAndroid !== undefined ? context.isAndroid : isAndroidDevice();
  const isIOS = context.isIOS !== undefined ? context.isIOS : isIOSDevice();
  const isHonor = isAndroid && (context.isHonor !== undefined ? context.isHonor : isHonorDevice());
  const rawBrand = context.brand || (isHonor ? 'honor' : (isIOS ? 'apple' : detectDeviceBrand()));
  const detectedBrandId = rawBrand === 'unknown' ? 'android_generic' : rawBrand;
  const brandGuide = getDeviceBrandGuide(detectedBrandId);
  const browser = context.browserName || getBrowserName();

  // 0. Phone Not Paired with Student Account (Student scanned without pre-registering)
  const isNotPaired = /not paired with any student account|phone passkey is not paired|no paired phone|phone not registered|please pair your phone|no passkey found|no credentials available|no credentials found/i.test(rawMsg);
  if (isNotPaired) {
    return {
      type: 'phone_not_paired',
      title: 'Phone Not Paired with Account',
      brandId: detectedBrandId,
      brandName: brandGuide.brandName,
      message: 'This phone has not been registered as your classroom attendance passkey yet.',
      resolutionSteps: [
        'Log into the classroom portal on your laptop or lab PC.',
        'Click "Pair Mobile Phone" (or your Profile > Passkey) to display your personal Pairing QR code.',
        'Scan that pairing QR code with this phone camera to enroll your biometrics.',
        'Once paired, scan this lecture attendance code again to record your attendance.',
      ],
      action: 'pair_first',
      raw: rawMsg,
    };
  }

  // 1. Android Missing Biometrics / Screen Lock / Provider Not Found (Vendor-Specific)
  const isProviderMissing = /provider not found|no credential provider|CreateCredentialNoProviderException|TYPE_NO_CREATE_OPTIONS/i.test(rawMsg);
  const isPlatformNotSupported = errName === 'NotSupportedError' || /the operation is not supported|cannot satisfy the requested requirements/i.test(rawMsg);

  if (isAndroid && (isProviderMissing || isPlatformNotSupported)) {
    let title = 'Screen Lock & Biometrics Required';
    if (detectedBrandId === 'honor') {
      title = 'Honor / MagicOS Passkey Setup Required';
    } else if (detectedBrandId !== 'android_generic') {
      title = `${brandGuide.brandName} Passkey Setup Required`;
    }

    return {
      type: 'android_screen_lock_missing',
      title,
      brandId: detectedBrandId,
      brandName: brandGuide.brandName,
      message: detectedBrandId === 'honor'
        ? 'MagicOS 8.0 requires Google Play Services and Google Password Manager to be enabled for WebAuthn passkeys.'
        : `Your ${brandGuide.brandName} needs a secure Screen Lock and Google Password Manager to register passkeys.`,
      resolutionSteps: brandGuide.steps,
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
        'Note: Microsoft Authenticator on iOS does not support third-party website passkeys. Both Apple Safari and Google Chrome are supported once iCloud Keychain is enabled.',
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

  // 4. Credential Mismatch ("wrong key"), Device Mismatch
  if (
    /credential mismatch|wrong key|does not match the paired hardware key|does not belong to the student/i.test(rawMsg) ||
    /device mismatch/i.test(rawMsg)
  ) {
    return {
      type: 'credential_mismatch',
      title: 'Browser or Phone Mismatch',
      message: 'This phone does not match the paired hardware passkey registered for this student account.',
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
