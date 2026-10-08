import { describe, it, expect } from 'vitest';
import {
  PROMPT_CATEGORIES,
  PROMPT_REGISTRY,
  getPromptTypeByApplyTo,
  getPromptTypesByCategory,
  getAllApplyToOptions,
  getPlaceholdersForPrompt,
  getOutputSchemaForPrompt,
  getPlaceholderTextForSelector,
  getDropdownPlaceholderForSelector,
  validatePrompt,
  DEFAULT_LECTURE_STT_PROMPT,
  DEFAULT_LECTURE_TRANSLATION_PROMPT,
  DEFAULT_LECTURE_STT_PROMPT_TEXT,
  DEFAULT_LECTURE_TRANSLATION_PROMPT_TEXT,
} from './promptRegistry';

describe('promptRegistry Constants & Helper Utilities', () => {
  it('defines 5 valid core prompt categories', () => {
    expect(PROMPT_CATEGORIES).toHaveLength(5);
    const categoryKeys = PROMPT_CATEGORIES.map((c) => c.key);
    expect(categoryKeys).toEqual(['images', 'videos', 'audios', 'translations', 'rubrics']);
  });

  it('includes paired pipeline prompt types for STT and Translation with Gemini 3 recommendations', () => {
    const stt = PROMPT_REGISTRY.lecture_stt_chapters;
    expect(stt).toBeDefined();
    expect(stt.category).toBe('audios');
    expect(stt.applyTo).toBe('Lecture STT & Chapters');
    expect(stt.recommendedModel).toBe('gemini-3.8-flash');
    expect(stt.pairedWith).toBe('lecture_subtitle_translation');
    expect(stt.outputSchema.format).toBe('json_object');

    const trans = PROMPT_REGISTRY.lecture_subtitle_translation;
    expect(trans).toBeDefined();
    expect(trans.category).toBe('translations');
    expect(trans.applyTo).toBe('Lecture Subtitle Translation');
    expect(trans.recommendedModel).toBe('gemini-3.8-flash');
    expect(trans.pairedWith).toBe('lecture_stt_chapters');
    expect(trans.outputSchema.format).toBe('json_string_array');
  });

  describe('getPromptTypeByApplyTo', () => {
    it('resolves prompt type by exact string or array', () => {
      expect(getPromptTypeByApplyTo('Lecture STT & Chapters')?.typeKey).toBe('lecture_stt_chapters');
      expect(getPromptTypeByApplyTo(['Lecture Subtitle Translation'])?.typeKey).toBe('lecture_subtitle_translation');
      expect(getPromptTypeByApplyTo('Live Audio Invigilation')?.typeKey).toBe('live_audio_invigilation');
      expect(getPromptTypeByApplyTo('NonExistent')).toBeNull();
      expect(getPromptTypeByApplyTo(null)).toBeNull();
    });
  });

  describe('getPromptTypesByCategory', () => {
    it('returns prompt types for audios', () => {
      const audioTypes = getPromptTypesByCategory('audios');
      expect(audioTypes.length).toBeGreaterThanOrEqual(4);
      expect(audioTypes.some((p) => p.applyTo === 'Lecture STT & Chapters')).toBe(true);
      expect(audioTypes.some((p) => p.applyTo === 'Live Audio Invigilation')).toBe(true);
    });

    it('returns prompt types for translations', () => {
      const transTypes = getPromptTypesByCategory('translations');
      expect(transTypes.length).toBeGreaterThanOrEqual(4);
      expect(transTypes.some((p) => p.applyTo === 'Lecture Subtitle Translation')).toBe(true);
      expect(transTypes.some((p) => p.applyTo === 'Live Subtitles & Translation')).toBe(true);
    });

    it('returns all prompt types if category is falsy', () => {
      const allTypes = getPromptTypesByCategory(null);
      expect(allTypes.length).toBe(Object.keys(PROMPT_REGISTRY).length);
    });
  });

  describe('getAllApplyToOptions', () => {
    it('returns array of applyTo strings for a given category', () => {
      const audioApplyTo = getAllApplyToOptions('audios');
      expect(audioApplyTo).toContain('Lecture STT & Chapters');
      expect(audioApplyTo).toContain('Live Audio Invigilation');
      expect(audioApplyTo).toContain('Session Audio Summary');
    });
  });

  describe('getPlaceholdersForPrompt', () => {
    it('extracts placeholders for Lecture STT & Chapters', () => {
      const placeholders = getPlaceholdersForPrompt(['Lecture STT & Chapters']);
      const tags = placeholders.map((p) => p.tag);
      expect(tags).toContain('{{classId}}');
      expect(tags).toContain('{{courseContext}}');
      expect(tags).toContain('{{totalDuration}}');
    });

    it('extracts placeholders for Lecture Subtitle Translation', () => {
      const placeholders = getPlaceholdersForPrompt({ applyTo: ['Lecture Subtitle Translation'] });
      const tags = placeholders.map((p) => p.tag);
      expect(tags).toContain('{{classId}}');
      expect(tags).toContain('{{courseContext}}');
      expect(tags).toContain('{{targetLanguage}}');
    });

    it('returns empty array for unknown or null prompts', () => {
      expect(getPlaceholdersForPrompt(null)).toEqual([]);
      expect(getPlaceholdersForPrompt('unknown')).toEqual([]);
    });
  });

  describe('getOutputSchemaForPrompt', () => {
    it('retrieves schema format and snippet', () => {
      const schema = getOutputSchemaForPrompt('Lecture Subtitle Translation');
      expect(schema).toBeDefined();
      expect(schema.format).toBe('json_string_array');
      expect(schema.snippet).toContain('[');
    });

    it('returns null for unknown applyTo', () => {
      expect(getOutputSchemaForPrompt('non-existent')).toBeNull();
    });
  });

  describe('Selector Helpers', () => {
    it('resolves placeholder text for selectors', () => {
      expect(getPlaceholderTextForSelector('audios', 'Lecture STT & Chapters')).toContain('verbatim transcription');
      expect(getPlaceholderTextForSelector('translations', 'Lecture Subtitle Translation')).toContain('custom translation');
      expect(getPlaceholderTextForSelector('images')).toContain('visual invigilation');
      expect(getPlaceholderTextForSelector('images', 'Classroom Bingo Questions')).toContain('Bingo question prompt');
      expect(getPlaceholderTextForSelector('videos')).toContain('Select a prompt or enter text');
    });

    it('resolves dropdown default option text', () => {
      expect(getDropdownPlaceholderForSelector('audios', 'Lecture STT & Chapters')).toContain('chapters');
      expect(getDropdownPlaceholderForSelector('translations')).toContain('subtitle translation');
      expect(getDropdownPlaceholderForSelector('images')).toContain('image invigilation');
      expect(getDropdownPlaceholderForSelector('images', 'Classroom Bingo Questions')).toContain('Classroom Bingo Question');
    });

    it('defines classroom_bingo_question with 4-option schema and Gemini 3 recommendation', () => {
      const bingo = PROMPT_REGISTRY.classroom_bingo_question;
      expect(bingo).toBeDefined();
      expect(bingo.category).toBe('images');
      expect(bingo.applyTo).toBe('Classroom Bingo Questions');
      expect(bingo.recommendedModel).toBe('gemini-3.5-flash-lite');
      expect(bingo.outputSchema.snippet).toContain('observedEvidence');
      expect(bingo.outputSchema.snippet).toContain('correctIndex');
    });
  });

  describe('validatePrompt', () => {
    it('returns invalid if promptText is empty or whitespace', () => {
      expect(validatePrompt('', 'Lecture Subtitle Translation').isValid).toBe(false);
      expect(validatePrompt('   ', 'Lecture Subtitle Translation').isValid).toBe(false);
      expect(validatePrompt(null, 'Lecture Subtitle Translation').isValid).toBe(false);
    });

    it('validates required placeholders for Lecture Subtitle Translation', () => {
      // Both {{courseContext}} and {{targetLanguage}} are required
      const invalid = validatePrompt('Translate text to Cantonese', 'Lecture Subtitle Translation');
      expect(invalid.isValid).toBe(false);
      expect(invalid.missingPlaceholders.map(p => p.tag)).toEqual(['{{courseContext}}', '{{targetLanguage}}']);

      const partial = validatePrompt('Domain: {{courseContext}}, translate text', 'Lecture Subtitle Translation');
      expect(partial.isValid).toBe(false);
      expect(partial.missingPlaceholders.map(p => p.tag)).toEqual(['{{targetLanguage}}']);

      const valid = validatePrompt('Domain: {{courseContext}}, target: {{targetLanguage}}', 'Lecture Subtitle Translation');
      expect(valid.isValid).toBe(true);
      expect(valid.missingPlaceholders).toHaveLength(0);
      expect(valid.errors).toHaveLength(0);
    });

    it('passes prompts with only optional placeholders', () => {
      // Per Video has only optional {{classId}} and {{studentRecords}}
      const res = validatePrompt('Analyze student engagement in after-class video recording', 'Per Video');
      expect(res.isValid).toBe(true);
      expect(res.missingPlaceholders).toHaveLength(0);
    });
  });

  describe('Default Whole-Lecture Recording Studio Prompts', () => {
    it('exports complete default STT and translation prompt objects and texts', () => {
      expect(DEFAULT_LECTURE_STT_PROMPT).toBeDefined();
      expect(DEFAULT_LECTURE_STT_PROMPT.name).toBe('Lecture Audio Speech-to-Text & Chapters');
      expect(DEFAULT_LECTURE_STT_PROMPT.category).toBe('audios');
      expect(DEFAULT_LECTURE_STT_PROMPT.isSystem).toBe(true);
      expect(DEFAULT_LECTURE_STT_PROMPT.promptText).toBe(DEFAULT_LECTURE_STT_PROMPT_TEXT);
      expect(DEFAULT_LECTURE_STT_PROMPT_TEXT).toContain('Lecture Audio Speech-to-Text & Chapters');
      expect(DEFAULT_LECTURE_STT_PROMPT_TEXT).toContain('YouTube Video Milestone Chapters');

      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT).toBeDefined();
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT.name).toBe('Lecture Subtitle & Terminology Translator');
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT.category).toBe('translations');
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT.isSystem).toBe(true);
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT.promptText).toBe(DEFAULT_LECTURE_TRANSLATION_PROMPT_TEXT);
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT_TEXT).toContain('Lecture Subtitle & Terminology Translator');
      expect(DEFAULT_LECTURE_TRANSLATION_PROMPT_TEXT).toContain('{{targetLanguage}}');
    });
  });
});

