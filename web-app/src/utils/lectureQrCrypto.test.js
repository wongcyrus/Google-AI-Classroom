import { describe, it, expect } from 'vitest';
import { computeClientLectureQrToken } from './lectureQrCrypto';

describe('lectureQrCrypto Utility', () => {
  it('computes 16-character hex token from session secret and interval', async () => {
    const secret = 'test-session-secret-999';
    const token1 = await computeClientLectureQrToken(secret, 500);
    const token2 = await computeClientLectureQrToken(secret, 500);
    const token3 = await computeClientLectureQrToken(secret, 501);

    expect(token1).toBeDefined();
    expect(token1.length).toBe(16);
    expect(token1).toBe(token2);
    expect(token1).not.toBe(token3);
  });

  it('returns empty string if sessionSecret is missing', async () => {
    const token = await computeClientLectureQrToken('', 500);
    expect(token).toBe('');
  });
});
