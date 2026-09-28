/**
 * Client-side cryptographic helper for generating rotating Lecture QR tokens.
 * Computes HMAC-SHA256 matching the backend implementation.
 */

export const DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC = 15;
export const DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS = DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC * 1000; // 15-second default rotation
export const LECTURE_QR_ROTATION_INTERVAL_MS = DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS; // Backwards compatible alias

/**
 * Computes the 16-character hex token from sessionSecret and timeInterval using Web Crypto API.
 * @param {string} sessionSecret
 * @param {number} timeInterval
 * @returns {Promise<string>}
 */
export async function computeClientLectureQrToken(sessionSecret, timeInterval) {
  if (!sessionSecret) return '';
  const encoder = new TextEncoder();
  const keyData = encoder.encode(sessionSecret);
  const messageData = encoder.encode(`lecture_qr_bingo_${timeInterval}`);

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
    console.warn('[lectureQrCrypto] Web Crypto HMAC error:', err);
    return '';
  }
}
