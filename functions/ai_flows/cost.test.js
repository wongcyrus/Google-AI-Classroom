import { describe, it, expect } from 'vitest';
import { calculateCost, estimateCost, MODEL_PRICING } from './cost.js';

describe('calculateCost', () => {
  it('should return 0 when usageMetadata is missing or null', () => {
    expect(calculateCost(null)).toBe(0);
    expect(calculateCost(undefined)).toBe(0);
  });

  it('should correctly compute exact USD cost for default gemini-3.5-flash-lite', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $0.30
      candidatesTokenCount: 1000000, // 1M tokens @ $2.50
    };
    const cost = calculateCost(usage, 'gemini-3.5-flash-lite');
    expect(cost).toBeCloseTo(2.80, 4);
  });

  it('should correctly compute exact USD cost for gemini-3.7-flash', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $0.75
      candidatesTokenCount: 1000000, // 1M tokens @ $3.75
    };
    const cost = calculateCost(usage, 'gemini-3.7-flash');
    expect(cost).toBeCloseTo(4.50, 4);
  });

  it('should correctly compute exact USD cost for gemini-3.8-flash', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $0.75
      candidatesTokenCount: 1000000, // 1M tokens @ $3.75
    };
    const cost = calculateCost(usage, 'gemini-3.8-flash');
    expect(cost).toBeCloseTo(4.50, 4);
  });

  it('should correctly compute exact USD cost for gemini-3.7-pro', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $3.00
      candidatesTokenCount: 1000000, // 1M tokens @ $15.00
    };
    const cost = calculateCost(usage, 'gemini-3.7-pro');
    expect(cost).toBeCloseTo(18.00, 4);
  });

  it('should handle small token amounts with high precision', () => {
    const usage = {
      promptTokenCount: 1000,
      candidatesTokenCount: 500,
    };
    // Input: (1000 / 1M) * 0.30 = 0.00030
    // Output: (500 / 1M) * 2.50 = 0.00125
    // Total = 0.00155
    const cost = calculateCost(usage);
    expect(cost).toBeCloseTo(0.00155, 6);
  });

  it('should correctly handle Genkit format (inputTokens / outputTokens)', () => {
    const usage = {
      inputTokens: 1000000,
      outputTokens: 1000000,
    };
    const cost = calculateCost(usage, 'gemini-3.5-flash-lite');
    expect(cost).toBeCloseTo(2.80, 4);
  });

  it('should correctly compute audio transcription cost for gemini-3.5-transcribe', () => {
    const usage = {
      inputTokens: 2000000, // 2M @ $0.50 = $1.00
      outputTokens: 1000000, // 1M @ $2.50 = $2.50
    };
    const cost = calculateCost(usage, 'gemini-3.5-transcribe');
    expect(cost).toBeCloseTo(3.50, 4);
  });

  it('should correctly compute audio transcription cost for gemini-3.5-transcribe-live', () => {
    const usage = {
      inputTokens: 1000000, // 1M @ $0.60 = $0.60
      outputTokens: 1000000, // 1M @ $3.00 = $3.00
    };
    const cost = calculateCost(usage, 'gemini-3.5-transcribe-live');
    expect(cost).toBeCloseTo(3.60, 4);
  });

  it('should safely handle negative or malformed token counts', () => {
    const usage = {
      inputTokens: -50,
      outputTokens: 'invalid',
    };
    const cost = calculateCost(usage);
    expect(cost).toBe(0);
  });
});

describe('estimateCost', () => {
  it('should estimate cost for text prompt with specified model', () => {
    const prompt = 'a'.repeat(400); // 400 chars / 4 = 100 tokens
    const costLite = estimateCost(prompt, [], 'gemini-3.5-flash-lite');
    // (100 / 1M) * 0.30 = 0.000030
    expect(costLite).toBeCloseTo(0.000030, 7);

    const costPro = estimateCost(prompt, [], 'gemini-3.7-pro');
    // (100 / 1M) * 3.00 = 0.000300
    expect(costPro).toBeCloseTo(0.000300, 7);
  });

  it('should estimate cost including multimodal image/video tokens', () => {
    const prompt = 'Analyze this video frame';
    const media = [{ url: 'gs://bucket/test.mp4' }, { url: 'gs://bucket/test2.mp4' }];
    const cost = estimateCost(prompt, media, 'gemini-3.7-flash');
    expect(cost).toBeGreaterThan(0);
  });
});
