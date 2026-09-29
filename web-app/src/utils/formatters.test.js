import { formatBytes, formatAiCost, calculateStorageCost, formatStorageCost } from './formatters.js';

describe('formatBytes', () => {
  it('should handle zero, null, and undefined bytes correctly', () => {
    expect(formatBytes(0)).toBe('0 Bytes');
    expect(formatBytes(null)).toBe('0 Bytes');
    expect(formatBytes(undefined)).toBe('0 Bytes');
    expect(formatBytes(-100)).toBe('0 Bytes');
  });

  it('should format bytes accurately', () => {
    expect(formatBytes(500)).toBe('500 Bytes');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5 GB');
  });

  it('should respect custom decimal precision', () => {
    expect(formatBytes(1536, 1)).toBe('1.5 KB');
    expect(formatBytes(1536, 0)).toBe('2 KB');
  });
});

describe('formatAiCost', () => {
  it('should format zero and falsy amounts as $0.00', () => {
    expect(formatAiCost(0)).toBe('$0.00');
    expect(formatAiCost(null)).toBe('$0.00');
    expect(formatAiCost(undefined)).toBe('$0.00');
    expect(formatAiCost(NaN)).toBe('$0.00');
  });

  it('should format sub-cent micro amounts with 4 decimal places', () => {
    expect(formatAiCost(0.0042)).toBe('$0.0042');
    expect(formatAiCost(0.0001)).toBe('$0.0001');
  });

  it('should format standard amounts with 2 decimal places', () => {
    expect(formatAiCost(1.234)).toBe('$1.23');
    expect(formatAiCost(25.5)).toBe('$25.50');
    expect(formatAiCost(100)).toBe('$100.00');
  });
});

describe('calculateStorageCost & formatStorageCost', () => {
  it('should handle zero and invalid bytes correctly', () => {
    expect(calculateStorageCost(0)).toBe(0);
    expect(calculateStorageCost(null)).toBe(0);
    expect(calculateStorageCost(undefined)).toBe(0);
    expect(calculateStorageCost(-100)).toBe(0);
    expect(formatStorageCost(0)).toBe('$0.00');
    expect(formatStorageCost(null)).toBe('$0.00');
    expect(formatStorageCost(undefined)).toBe('$0.00');
    expect(formatStorageCost(NaN)).toBe('$0.00');
  });

  it('should calculate and format micro-amounts (sub-cent) with 4 decimal places', () => {
    // 200 MB = 200 * 1024 * 1024 bytes -> ~0.1953 GiB * 0.023 ~= $0.00449
    const bytes200MB = 200 * 1024 * 1024;
    expect(calculateStorageCost(bytes200MB, 0.023)).toBeCloseTo(0.00449, 4);
    expect(formatStorageCost(bytes200MB, 0.023)).toBe('$0.0045');
  });

  it('should format sub-dime amounts with 3 decimal places', () => {
    // 1 GiB at 0.023 = $0.023
    const bytes1GB = 1024 * 1024 * 1024;
    expect(calculateStorageCost(bytes1GB, 0.023)).toBe(0.023);
    expect(formatStorageCost(bytes1GB, 0.023)).toBe('$0.023');
  });

  it('should format amounts over 10 cents with 2 decimal places', () => {
    // 5 GiB at 0.023 = $0.115
    const bytes5GB = 5 * 1024 * 1024 * 1024;
    expect(calculateStorageCost(bytes5GB, 0.023)).toBeCloseTo(0.115, 5);
    expect(formatStorageCost(bytes5GB, 0.023)).toBe('$0.115');

    // 10 GiB at 0.023 = $0.23
    const bytes10GB = 10 * 1024 * 1024 * 1024;
    expect(formatStorageCost(bytes10GB, 0.023)).toBe('$0.23');

    // 20 GiB at 0.023 = $0.46
    const bytes20GB = 20 * 1024 * 1024 * 1024;
    expect(formatStorageCost(bytes20GB, 0.023)).toBe('$0.46');
  });

  it('should support custom decimal precision override', () => {
    const bytes5GB = 5 * 1024 * 1024 * 1024;
    expect(formatStorageCost(bytes5GB, 0.023, 3)).toBe('$0.115');
    expect(formatStorageCost(bytes5GB, 0.023, 4)).toBe('$0.1150');
  });
});
