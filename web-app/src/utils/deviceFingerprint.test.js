import { describe, it, expect, beforeEach } from 'vitest';
import { getOrCreateDeviceFingerprint, clearDeviceFingerprint } from './deviceFingerprint';

describe('deviceFingerprint Utility', () => {
  beforeEach(() => {
    clearDeviceFingerprint();
    localStorage.clear();
  });

  it('generates a new device fingerprint prefixed with mdev_', () => {
    const fp = getOrCreateDeviceFingerprint();
    expect(fp).toBeDefined();
    expect(fp.startsWith('mdev_')).toBe(true);
    expect(fp.length).toBeGreaterThanOrEqual(20);
  });

  it('persists and returns the same fingerprint on subsequent calls', () => {
    const fp1 = getOrCreateDeviceFingerprint();
    const fp2 = getOrCreateDeviceFingerprint();
    expect(fp1).toBe(fp2);
  });

  it('generates a new fingerprint when cleared', () => {
    const fp1 = getOrCreateDeviceFingerprint();
    clearDeviceFingerprint();
    const fp2 = getOrCreateDeviceFingerprint();
    expect(fp1).not.toBe(fp2);
    expect(fp2.startsWith('mdev_')).toBe(true);
  });

  it('falls back gracefully if localStorage throws', () => {
    const origGetItem = localStorage.getItem;
    localStorage.getItem = () => {
      throw new Error('Access denied');
    };

    const fp = getOrCreateDeviceFingerprint();
    expect(fp).toBeDefined();
    expect(fp.startsWith('mdev_')).toBe(true);

    localStorage.getItem = origGetItem;
  });
});
