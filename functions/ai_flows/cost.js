// Default baseline pricing lookup table for Gemini models in USD per 1 million tokens (Input / Output)
export const MODEL_PRICING = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-pro': { input: 3.00, output: 15.00 },
  'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
  'gemini-3.5-transcribe-live': { input: 0.60, output: 3.00 },
};

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

// In-memory warm cache to avoid network round-trips on hot invocations
let dynamicPricingCache = null;
let lastCacheFetchTime = 0;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export function setDynamicPricingCache(pricingData) {
  if (pricingData && typeof pricingData === 'object') {
    dynamicPricingCache = pricingData;
    lastCacheFetchTime = Date.now();
  }
}

export function getModelPricing(model = DEFAULT_MODEL) {
  if (dynamicPricingCache && dynamicPricingCache[model]) {
    return dynamicPricingCache[model];
  }
  return MODEL_PRICING[model] || MODEL_PRICING[DEFAULT_MODEL];
}

// A rough estimate of characters per token.
const CHARS_PER_TOKEN_ESTIMATE = 4;
// A rough estimate of tokens per image.
const TOKENS_PER_IMAGE_ESTIMATE = 258;

/**
 * Calculates the actual cost of an AI job based on the usage metadata from the API response.
 * @param {object} usageMetadata - The usage metadata object from the AI response.
 * @param {number} usageMetadata.promptTokenCount - The number of tokens in the input.
 * @param {number} usageMetadata.candidatesTokenCount - The number of tokens in the output.
 * @param {string} [model] - The AI model identifier.
 * @returns {number} The calculated cost in USD.
 */
export function calculateCost(usageMetadata, model = DEFAULT_MODEL) {
  if (!usageMetadata || typeof usageMetadata !== 'object') {
    return 0;
  }
  const pricing = getModelPricing(model);
  const promptTokens = Math.max(0, Number(usageMetadata.promptTokenCount) || 0);
  const candidatesTokens = Math.max(0, Number(usageMetadata.candidatesTokenCount) || 0);
  const inputRate = pricing?.input ?? MODEL_PRICING[DEFAULT_MODEL].input;
  const outputRate = pricing?.output ?? MODEL_PRICING[DEFAULT_MODEL].output;
  const inputCost = (promptTokens / 1000000) * inputRate;
  const outputCost = (candidatesTokens / 1000000) * outputRate;
  return Number((inputCost + outputCost).toFixed(6)) || 0;
}

/**
 * Estimates the cost of an AI job before execution.
 * @param {string} prompt - The text prompt.
 * @param {Array<object>} media - An array of media items.
 * @param {string} [model] - The AI model identifier.
 * @returns {number} The estimated cost in USD.
 */
export function estimateCost(prompt, media = [], model = DEFAULT_MODEL) {
  const pricing = getModelPricing(model);
  const inputRate = pricing?.input ?? MODEL_PRICING[DEFAULT_MODEL].input;
  const textTokens = Math.ceil((prompt?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
  const imageTokens = (Array.isArray(media) ? media.length : 0) * TOKENS_PER_IMAGE_ESTIMATE;
  const totalInputTokens = textTokens + imageTokens;

  const inputCost = (totalInputTokens / 1000000) * inputRate;
  return Number(inputCost.toFixed(6)) || 0;
}
