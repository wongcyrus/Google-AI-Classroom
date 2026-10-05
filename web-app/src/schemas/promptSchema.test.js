import { describe, it, expect } from 'vitest';
import {
  safePromptText,
  safePromptPreview,
  validateCategoryMatch,
  validatePrompt,
} from './promptSchema';

describe('Prompt Schema & Boundary Validation', () => {
  it('validates a valid prompt successfully', () => {
    const validData = {
      id: 'p1',
      name: 'Vision Test Prompt',
      category: 'images',
      promptText: 'Analyze student engagement',
      applyTo: 'Per Image',
      accessLevel: 'public',
    };

    const result = validatePrompt(validData);
    expect(result.valid).toBe(true);
    expect(result.prompt.name).toBe('Vision Test Prompt');
    expect(result.error).toBeNull();
  });

  it('rejects prompts with empty promptText or missing required fields', () => {
    const invalidData = {
      id: 'p2',
      name: 'Incomplete Prompt',
      category: 'videos',
      promptText: '',
    };

    const result = validatePrompt(invalidData);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Prompt text cannot be empty');
  });

  it('rejects prompts with invalid categories', () => {
    const invalidCategory = {
      name: 'Wrong Category',
      category: 'non_existent_category',
      promptText: 'Some valid prompt text',
    };

    const result = validatePrompt(invalidCategory);
    expect(result.valid).toBe(false);
  });

  it('safePromptText extracts text safely across all edge cases', () => {
    expect(safePromptText(null)).toBe('');
    expect(safePromptText(undefined)).toBe('');
    expect(safePromptText({})).toBe('');
    expect(safePromptText({ id: 'only_id' })).toBe('');
    expect(safePromptText({ promptText: '  Trimmed text  ' })).toBe('Trimmed text');
    expect(safePromptText('Raw string prompt', 'fallback')).toBe('Raw string prompt');
    expect(safePromptText(null, 'default_fallback')).toBe('default_fallback');
  });

  it('safePromptPreview truncates long text safely and handles missing text', () => {
    expect(safePromptPreview(null)).toBe('');
    expect(safePromptPreview({ promptText: 'Short prompt' }, 50)).toBe('Short prompt');
    const longText = 'A'.repeat(150);
    expect(safePromptPreview({ promptText: longText }, 50)).toBe(`${'A'.repeat(50)}...`);
  });

  it('validateCategoryMatch strictly checks category alignment', () => {
    expect(validateCategoryMatch('images', 'images')).toBe(true);
    expect(validateCategoryMatch('IMAGES', 'images')).toBe(true);
    expect(validateCategoryMatch('videos', 'images')).toBe(false);
    expect(validateCategoryMatch('audios', 'translations')).toBe(false);
    expect(validateCategoryMatch(null, 'images')).toBe(false);
  });
});
