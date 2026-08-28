import { describe, it, expect } from 'vitest';
import { calculateConstrainedDimensions, calculateDownscaleFactor, calculateExpirationDate } from './imageUtils.js';

describe('calculateConstrainedDimensions', () => {
  it('should scale down 4K displays (3840x2160) to 1080p width (1920x1080)', () => {
    const { width, height } = calculateConstrainedDimensions(3840, 2160, 1920);
    expect(width).toBe(1920);
    expect(height).toBe(1080);
  });

  it('should scale down 2560x1440 (1440p) maintaining 16:9 aspect ratio and even integers', () => {
    const { width, height } = calculateConstrainedDimensions(2560, 1440, 1920);
    expect(width).toBe(1920);
    expect(height).toBe(1080);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
  });

  it('should not scale up standard 1080p or 720p screens', () => {
    const res1 = calculateConstrainedDimensions(1920, 1080, 1920);
    expect(res1.width).toBe(1920);
    expect(res1.height).toBe(1080);

    const res2 = calculateConstrainedDimensions(1280, 720, 1920);
    expect(res2.width).toBe(1280);
    expect(res2.height).toBe(720);
  });

  it('should ensure odd source dimensions result in even numbers for video codecs', () => {
    const res = calculateConstrainedDimensions(1365, 767, 1920);
    expect(res.width % 2).toBe(0);
    expect(res.height % 2).toBe(0);
  });
});

describe('calculateDownscaleFactor', () => {
  it('should return 1.0 if blob size is within threshold', () => {
    expect(calculateDownscaleFactor(100000, 250000)).toBe(1.0);
  });

  it('should compute geometric reduction factor if blob is oversized', () => {
    const factor = calculateDownscaleFactor(1000000, 250000); // 1MB vs 250KB (4x over)
    // sqrt(1/4) * 0.9 = 0.5 * 0.9 = 0.45
    expect(factor).toBeCloseTo(0.45, 2);
  });
});

describe('calculateExpirationDate', () => {
  it('should add exact days in milliseconds', () => {
    const base = new Date('2026-08-01T00:00:00Z');
    const expiry = calculateExpirationDate(14, base);
    expect(expiry.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('should default to 30 days if unspecified', () => {
    const base = new Date('2026-08-01T00:00:00Z');
    const expiry = calculateExpirationDate(null, base);
    expect(expiry.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});
