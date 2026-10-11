import { describe, it, expect } from 'vitest';
import { parsePeriodDateMs } from './examPeriodUtils';

describe('examPeriodUtils parsePeriodDateMs', () => {
  it('handles falsy or invalid types', () => {
    expect(Number.isNaN(parsePeriodDateMs(''))).toBe(true);
    expect(Number.isNaN(parsePeriodDateMs(null))).toBe(true);
    expect(Number.isNaN(parsePeriodDateMs(undefined))).toBe(true);
    expect(Number.isNaN(parsePeriodDateMs(true))).toBe(true);
    expect(Number.isNaN(parsePeriodDateMs({}))).toBe(true);
  });

  it('handles Firestore Timestamp objects with toMillis', () => {
    const mockTimestamp = { toMillis: () => 1700000000000 };
    expect(parsePeriodDateMs(mockTimestamp)).toBe(1700000000000);
  });

  it('handles Date instances and numbers', () => {
    const d = new Date('2026-10-12T00:00:00Z');
    expect(parsePeriodDateMs(d)).toBe(d.getTime());
    expect(parsePeriodDateMs(1728691200000)).toBe(1728691200000);
  });

  it('handles strings with explicit timezone (Z or offset)', () => {
    const isoZ = '2026-10-12T08:30:00Z';
    expect(parsePeriodDateMs(isoZ)).toBe(new Date(isoZ).getTime());

    const isoOffset = '2026-10-12T16:30:00+08:00';
    expect(parsePeriodDateMs(isoOffset)).toBe(new Date(isoOffset).getTime());
  });

  it('handles naive date strings with zoned time', () => {
    const naive = '2026-10-12T16:30:00';
    const ms = parsePeriodDateMs(naive, 'Asia/Hong_Kong');
    expect(typeof ms).toBe('number');
    expect(isNaN(ms)).toBe(false);
  });

  it('falls back to new Date when fromZonedTime throws or returns NaN', () => {
    // Passing an invalid timezone triggers the catch block in fromZonedTime
    const naiveLike = '2026-10-12 12:00:00';
    const ms = parsePeriodDateMs(naiveLike, 'INVALID/TIMEZONE');
    expect(typeof ms).toBe('number');

    // Invalid date string returns NaN
    const invalidDate = 'not-a-valid-date';
    expect(Number.isNaN(parsePeriodDateMs(invalidDate))).toBe(true);
  });
});
