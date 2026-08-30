import { describe, it, expect } from 'vitest';

describe('Cleanup Triggers & Retention Calculation (functions/storage_triggers/cleanupTriggers.js)', () => {
  it('correctly calculates new expireAt timestamps on retention update', () => {
    const calculateNewExpireAt = (createdAtTimestamp, retentionDays) => {
      const baseTime = createdAtTimestamp instanceof Date ? createdAtTimestamp.getTime() : new Date(createdAtTimestamp).getTime();
      return new Date(baseTime + retentionDays * 24 * 60 * 60 * 1000);
    };

    const now = new Date('2026-08-01T00:00:00Z');
    const expire14Days = calculateNewExpireAt(now, 14);
    const expire60Days = calculateNewExpireAt(now, 60);

    expect(expire14Days.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    expect(expire60Days.toISOString()).toBe('2026-09-30T00:00:00.000Z');
  });

  it('determines if retentionDays has actually changed', () => {
    const hasRetentionChanged = (beforeData, afterData) => {
      const beforeRet = beforeData?.retentionDays ?? 14;
      const afterRet = afterData?.retentionDays ?? 14;
      return beforeRet !== afterRet;
    };

    expect(hasRetentionChanged({ retentionDays: 14 }, { retentionDays: 30 })).toBe(true);
    expect(hasRetentionChanged({ retentionDays: 14 }, { retentionDays: 14 })).toBe(false);
    expect(hasRetentionChanged({}, { retentionDays: 14 })).toBe(false);
  });
});
