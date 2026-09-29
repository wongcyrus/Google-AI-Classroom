/**
 * Client-side cryptographic helper for generating rotating Desktop Login QR tokens.
 * Computes HMAC-SHA256 matching the backend implementation.
 */

export const DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC = 15;
export const DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS = DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC * 1000; // 15-second rotation

/**
 * Computes the 16-character hex token from sessionSecret and timeInterval using Web Crypto API.
 * @param {string} sessionSecret
 * @param {number} timeInterval
 * @returns {Promise<string>}
 */
export async function computeClientDesktopQrToken(sessionSecret, timeInterval) {
  if (!sessionSecret) return '';
  const encoder = new TextEncoder();
  const keyData = encoder.encode(sessionSecret);
  const messageData = encoder.encode(`desktop_login_qr_${timeInterval}`);

  try {
    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await window.crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      messageData
    );

    const hashArray = Array.from(new Uint8Array(signature));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex.substring(0, 16);
  } catch (err) {
    console.warn('[desktopQrCrypto] Web Crypto HMAC error:', err);
    return '';
  }
}
