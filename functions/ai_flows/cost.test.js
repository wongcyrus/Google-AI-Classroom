import { describe, it, expect, vi } from 'vitest';
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

  it('should correctly compute exact USD cost for gemini-3.8-flash', () => {
    const usage = {
      promptTokenCount: 1000000, // 1M tokens @ $0.75
      candidatesTokenCount: 1000000, // 1M tokens @ $3.75
    };
    const cost = calculateCost(usage, 'gemini-3.8-flash');
    expect(cost).toBeCloseTo(4.50, 4);
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

    const costFlash = estimateCost(prompt, [], 'gemini-3.8-flash');
    // (100 / 1M) * 0.75 = 0.000075
    expect(costFlash).toBeCloseTo(0.000075, 7);
  });

  it('should estimate cost including multimodal image/video tokens', () => {
    const prompt = 'Analyze this video frame';
    const media = [{ url: 'gs://bucket/test.mp4' }, { url: 'gs://bucket/test2.mp4' }];
    const cost = estimateCost(prompt, media, 'gemini-3.8-flash');
    expect(cost).toBeGreaterThan(0);
  });
});

describe('dynamic pricing cache and getModelPricing', () => {
  it('updates pricing cache and retrieves custom pricing', async () => {
    const { setDynamicPricingCache, getModelPricing } = await import('./cost.js');
    setDynamicPricingCache({
      'custom-model': { input: 1.0, output: 5.0 },
    });
    expect(getModelPricing('custom-model')).toEqual({ input: 1.0, output: 5.0 });
    // Falls back to default when model not found in cache or baseline
    expect(getModelPricing('non-existent')).toEqual(MODEL_PRICING['gemini-3.5-flash-lite']);
  });

  it('correctly resolves rates for live, 3.7, and composite model pipelines', async () => {
    const { getModelPricing } = await import('./cost.js');
    expect(getModelPricing('gemini-3.1-flash-live-preview')).toEqual({ input: 0.60, output: 2.50 });
    expect(getModelPricing('gemini-3.7-flash')).toEqual({ input: 0.75, output: 3.75 });
    expect(getModelPricing('gemini-3.7-pro')).toEqual({ input: 3.00, output: 15.00 });

    // Composite model test: (0.50 + 0.30)/2 = 0.40 input, (2.50 + 2.50)/2 = 2.50 output
    const compositeRate = getModelPricing('gemini-3.5-transcribe-preview + gemini-3.5-flash-lite');
    expect(compositeRate.input).toBeCloseTo(0.40, 2);
    expect(compositeRate.output).toBeCloseTo(2.50, 2);
  });

  it('syncs dynamic pricing from Firestore system_config/pricing', async () => {
    const { syncPricingFromFirestore, getModelPricing } = await import('./cost.js');
    const mockDb = {
      collection: vi.fn().mockReturnValue({
        doc: vi.fn().mockReturnValue({
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({
              'synced-model': { input: 0.88, output: 4.22 },
            }),
          }),
        }),
      }),
    };
    const res = await syncPricingFromFirestore(mockDb);
    expect(res).toBeDefined();
    expect(getModelPricing('synced-model')).toEqual({ input: 0.88, output: 4.22 });
  });
});

