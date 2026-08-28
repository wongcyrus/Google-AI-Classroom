import { describe, it, expect } from 'vitest';
import { calculateCost, estimateCost } from './cost.js';

describe('calculateCost', () => {
  it('should return 0 when usageMetadata is missing or null', () => {
    expect(calculateCost(null)).toBe(0);
    expect(calculateCost(undefined)).toBe(0);
  });

  it('should correctly compute exact USD cost from input and output tokens', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $0.075
      candidatesTokenCount: 1000000, // 1M tokens @ $0.30
    };
    const cost = calculateCost(usage);
    expect(cost).toBeCloseTo(0.375, 4);
  });

  it('should handle small token amounts with high precision', () => {
    const usage = {
      promptTokenCount: 1000,
      candidatesTokenCount: 500,
    };
    // Input: (1000 / 1M) * 0.075 = 0.000075
    // Output: (500 / 1M) * 0.30 = 0.00015
    // Total = 0.000225
    const cost = calculateCost(usage);
    expect(cost).toBeCloseTo(0.000225, 6);
  });
});

describe('estimateCost', () => {
  it('should estimate cost for text prompt only', () => {
    const prompt = 'a'.repeat(400); // 400 chars / 4 = 100 tokens
    const cost = estimateCost(prompt, []);
    // (100 / 1M) * 0.075 = 0.0000075
    expect(cost).toBeCloseTo(0.0000075, 7);
  });

  it('should estimate cost including multimodal image/video tokens', () => {
    const prompt = 'Analyze this video frame';
    const media = [{ url: 'gs://bucket/test.mp4' }, { url: 'gs://bucket/test2.mp4' }];
    // Prompt chars: 24 chars -> 6 tokens
    // Media: 2 items * 258 = 516 tokens
    // Total = 522 tokens
    const cost = estimateCost(prompt, media);
    expect(cost).toBeGreaterThan(0);
  });
});
