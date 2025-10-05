
// Pricing for Gemini 1.5 Flash in USD per 1 million tokens
const INPUT_PRICE_PER_MILLION_TOKENS = 0.35;
const OUTPUT_PRICE_PER_MILLION_TOKENS = 1.05;

// A rough estimate of characters per token. This will be refined after research.
const CHARS_PER_TOKEN_ESTIMATE = 4;
// A rough estimate of tokens per image. This will be refined after research.
const TOKENS_PER_IMAGE_ESTIMATE = 258; // Based on some models, but needs verification for Gemini 2.5

/**
 * Calculates the actual cost of an AI job based on the usage metadata from the API response.
 * @param {object} usageMetadata - The usage metadata object from the AI response.
 * @param {number} usageMetadata.promptTokenCount - The number of tokens in the input.
 * @param {number} usageMetadata.candidatesTokenCount - The number of tokens in the output.
 * @returns {number} The calculated cost in USD.
 */
export function calculateCost(usageMetadata) {
  if (!usageMetadata) {
    return 0;
  }
  const inputCost = (usageMetadata.promptTokenCount / 1000000) * INPUT_PRICE_PER_MILLION_TOKENS;
  const outputCost = (usageMetadata.candidatesTokenCount / 1000000) * OUTPUT_PRICE_PER_MILLION_TOKENS;
  return inputCost + outputCost;
}

/**
 * Estimates the cost of an AI job before execution.
 * This is a rough estimate and should be refined with more accurate token calculation methods.
 * @param {string} prompt - The text prompt.
 * @param {Array<string>} media - An array of media items (e.g., image URLs).
 * @returns {number} The estimated cost in USD.
 */
export function estimateCost(prompt, media = []) {
  const textTokens = Math.ceil((prompt?.length || 0) / CHARS_PER_TOKEN_ESTIMATE);
  const imageTokens = media.length * TOKENS_PER_IMAGE_ESTIMATE;
  const totalInputTokens = textTokens + imageTokens;

  // We don't know the output token count, so we can either assume a certain amount
  // or just base the pre-check on the input cost. For now, we'll just use input cost.
  const inputCost = (totalInputTokens / 1000000) * INPUT_PRICE_PER_MILLION_TOKENS;
  return inputCost;
}
