import { describe, it, expect } from 'vitest';
import { formatBytes, formatAiCost } from './formatters.js';

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
