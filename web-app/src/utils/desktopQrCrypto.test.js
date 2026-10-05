import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC,
  DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS,
  computeClientDesktopQrToken,
} from './desktopQrCrypto';

describe('desktopQrCrypto Utility', () => {
  it('exports rotation constants correctly', () => {
    expect(DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_SEC).toBe(15);
    expect(DEFAULT_DESKTOP_QR_ROTATION_INTERVAL_MS).toBe(15000);
  });

  it('returns empty string when sessionSecret is empty or missing', async () => {
    expect(await computeClientDesktopQrToken('', 100)).toBe('');
    expect(await computeClientDesktopQrToken(null, 100)).toBe('');
    expect(await computeClientDesktopQrToken(undefined, 100)).toBe('');
  });

  it('computes consistent 16-character hex token from sessionSecret and timeInterval', async () => {
    const token1 = await computeClientDesktopQrToken('secret_key_123', 1000);
    const token2 = await computeClientDesktopQrToken('secret_key_123', 1000);
    const tokenDiffInterval = await computeClientDesktopQrToken('secret_key_123', 1001);

    expect(token1).toHaveLength(16);
    expect(token1).toMatch(/^[0-9a-f]{16}$/);
    expect(token1).toBe(token2);
    expect(token1).not.toBe(tokenDiffInterval);
  });

  it('handles crypto errors gracefully and returns empty string', async () => {
    const spy = vi.spyOn(window.crypto.subtle, 'importKey').mockRejectedValueOnce(new Error('SubtleCrypto failure'));
    const token = await computeClientDesktopQrToken('secret', 100);
    expect(token).toBe('');
    spy.mockRestore();
  });
});
