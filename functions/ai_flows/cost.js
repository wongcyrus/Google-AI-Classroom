// Pricing lookup table for Gemini models in USD per 1 million tokens (Input / Output)
export const MODEL_PRICING = {
  'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
  'gemini-3.7-flash': { input: 0.75, output: 3.75 },
  'gemini-3.7-pro': { input: 3.00, output: 15.00 },
};

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

export function getModelPricing(model = DEFAULT_MODEL) {
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
  if (!usageMetadata) {
    return 0;
  }
  const pricing = getModelPricing(model);
  const inputCost = (usageMetadata.promptTokenCount / 1000000) * pricing.input;
  const outputCost = (usageMetadata.candidatesTokenCount / 1000000) * pricing.output;
  return inputCost + outputCost;
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
  const textTokens = Math.ceil((prompt?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
  const imageTokens = media.length * TOKENS_PER_IMAGE_ESTIMATE;
  const totalInputTokens = textTokens + imageTokens;

  const inputCost = (totalInputTokens / 1000000) * pricing.input;
  return inputCost;
}
