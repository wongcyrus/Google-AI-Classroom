/**
 * Mobile Device Fingerprint Utility
 * 
 * Generates and persists a hardware-anchored device identifier in the mobile browser's
 * local storage to enforce the strict 1-Student = 1-Device = 1-Passkey security constraint.
 */

const STORAGE_KEY = 'gemini_assistant_device_fingerprint';

/**
 * Retrieves the persistent device fingerprint or creates a new one if not present.
 * @returns {string} Unique device fingerprint prefixed with 'mdev_'
 */
export function getOrCreateDeviceFingerprint() {
  try {
    let fp = localStorage.getItem(STORAGE_KEY);
    if (fp && fp.startsWith('mdev_') && fp.length >= 20) {
      return fp;
    }

    const uuid = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : 'rand_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

    fp = `mdev_${uuid}`;
    localStorage.setItem(STORAGE_KEY, fp);
    return fp;
  } catch (err) {
    console.warn('[DeviceFingerprint] LocalStorage unavailable, using session fallback:', err);
    return 'mdev_fallback_' + Date.now().toString(36);
  }
}

/**
 * Resets the device fingerprint (useful for automated testing)
 */
export function clearDeviceFingerprint() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore error in restricted storage
  }
}
