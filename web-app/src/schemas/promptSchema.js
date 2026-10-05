import { z } from 'zod';

export const PromptCategorySchema = z.enum([
  'images',
  'videos',
  'audios',
  'translations',
  'rubrics',
]);

export const PromptAccessLevelSchema = z.enum([
  'public',
  'private',
  'shared',
]);

/**
 * Zod schema validating a prompt object's structure.
 * Guards against missing promptText or corrupt category definitions.
 */
export const PromptSchema = z.object({
  id: z.string().optional(),
  originalId: z.string().nullable().optional(),
  name: z.string().min(1, 'Prompt name is required'),
  category: PromptCategorySchema,
  promptText: z.string().min(1, 'Prompt text cannot be empty'),
  applyTo: z.union([z.string(), z.array(z.string())]).optional(),
  accessLevel: PromptAccessLevelSchema.optional(),
  owner: z.string().nullable().optional(),
}).passthrough();

/**
 * Safely extracts promptText from a prompt object or string.
 * Guards against null, undefined, and non-object inputs.
 *
 * @param {unknown} prompt
 * @param {string} [fallback='']
 * @returns {string}
 */
export function safePromptText(prompt, fallback = '') {
  if (typeof prompt === 'string') return prompt.trim();
  if (prompt && typeof prompt === 'object' && 'promptText' in prompt) {
    const text = prompt.promptText;
    if (typeof text === 'string') return text.trim();
  }
  return fallback;
}

/**
 * Safely generates a preview snippet for a prompt without risking undefined access.
 *
 * @param {unknown} prompt
 * @param {number} [maxLength=120]
 * @returns {string}
 */
export function safePromptPreview(prompt, maxLength = 120) {
  const text = safePromptText(prompt);
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.substring(0, maxLength)}...`;
}

/**
 * Validates that a prompt belongs to the expected category hierarchy.
 * Prevents assigning Video Prompt IDs into Image Prompt fields and vice versa.
 *
 * @param {string} actualCategory
 * @param {string} expectedCategory
 * @returns {boolean}
 */
export function validateCategoryMatch(actualCategory, expectedCategory) {
  if (!actualCategory || !expectedCategory) return false;
  return actualCategory.toLowerCase() === expectedCategory.toLowerCase();
}

/**
 * Validates a prompt object and returns structured validation status.
 *
 * @param {unknown} prompt
 * @returns {{ valid: boolean, prompt: any, error: string | null }}
 */
export function validatePrompt(prompt) {
  const result = PromptSchema.safeParse(prompt);
  if (!result.success) {
    const errorMsg = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    return { valid: false, prompt: null, error: errorMsg };
  }
  return { valid: true, prompt: result.data, error: null };
}
