import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCloudPricing, DEFAULT_STORAGE_RATE_PER_GIB_MONTH } from './useCloudPricing';
import { onSnapshot } from 'firebase/firestore';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  db: {},
}));

describe('useCloudPricing Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default fallback rate and loading state', () => {
    onSnapshot.mockImplementation(() => () => {});
    const { result } = renderHook(() => useCloudPricing());
    expect(result.current.loading).toBe(true);
    expect(result.current.storageRatePerGibMonth).toBe(DEFAULT_STORAGE_RATE_PER_GIB_MONTH);
  });

  it('updates state when system_config/pricing snapshot arrives with cloud storage data', () => {
    let snapshotCallback;
    onSnapshot.mockImplementation((docRef, cb) => {
      snapshotCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useCloudPricing());

    act(() => {
      snapshotCallback({
        exists: () => true,
        data: () => ({
          'cloud-storage': {
            ratePerGibMonth: 0.025,
            region: 'asia-east2',
            description: 'Standard Storage Hong Kong Live',
          },
          lastSyncedAt: '2026-09-29T12:00:00Z',
        }),
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.storageRatePerGibMonth).toBe(0.025);
    expect(result.current.storageDescription).toBe('Standard Storage Hong Kong Live');
    expect(result.current.lastSyncedAt).toBe('2026-09-29T12:00:00Z');
  });

  it('falls back to default rate if cloud-storage key is absent or invalid', () => {
    let snapshotCallback;
    onSnapshot.mockImplementation((docRef, cb) => {
      snapshotCallback = cb;
      return () => {};
    });

    const { result } = renderHook(() => useCloudPricing());

    act(() => {
      snapshotCallback({
        exists: () => true,
        data: () => ({
          'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
        }),
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.storageRatePerGibMonth).toBe(DEFAULT_STORAGE_RATE_PER_GIB_MONTH);
  });
});
