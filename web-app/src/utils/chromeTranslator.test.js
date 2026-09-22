import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  normalizeLanguageCode,
  isChromeTranslatorSupported,
  checkLanguagePairAvailability,
  checkMultipleLanguagePairs,
  getOrCreateChromeTranslator,
  translateWithChrome,
  translateMultipleWithChrome,
  clearChromeTranslatorCache,
} from './chromeTranslator';

describe('chromeTranslator Utility', () => {
  beforeEach(() => {
    clearChromeTranslatorCache();
  });

  afterEach(() => {
    delete window.Translator;
    vi.restoreAllMocks();
  });

  describe('normalizeLanguageCode', () => {
    it('normalizes locale codes to base ISO 639-1', () => {
      expect(normalizeLanguageCode('zh-HK')).toBe('zh');
      expect(normalizeLanguageCode('zh-TW')).toBe('zh');
      expect(normalizeLanguageCode('en-US')).toBe('en');
      expect(normalizeLanguageCode('ja-JP')).toBe('ja');
      expect(normalizeLanguageCode('')).toBe('en');
      expect(normalizeLanguageCode(null)).toBe('en');
    });
  });

  describe('isChromeTranslatorSupported', () => {
    it('returns false when window.Translator is missing', () => {
      delete window.Translator;
      expect(isChromeTranslatorSupported()).toBe(false);
    });

    it('returns true when window.Translator.create is a function', () => {
      window.Translator = { create: vi.fn() };
      expect(isChromeTranslatorSupported()).toBe(true);
    });
  });

  describe('checkLanguagePairAvailability', () => {
    it('returns unsupported when window.Translator is missing', async () => {
      delete window.Translator;
      const status = await checkLanguagePairAvailability('zh-HK', 'en');
      expect(status).toBe('unsupported');
    });

    it('returns readily if source and target base languages are identical', async () => {
      window.Translator = { create: vi.fn(), availability: vi.fn() };
      const status = await checkLanguagePairAvailability('zh-HK', 'zh-TW');
      expect(status).toBe('readily');
    });

    it('queries window.Translator.availability and returns its status', async () => {
      window.Translator = {
        create: vi.fn(),
        availability: vi.fn().mockResolvedValue('after-download'),
      };

      const status = await checkLanguagePairAvailability('en-US', 'ja');
      expect(status).toBe('after-download');
      expect(window.Translator.availability).toHaveBeenCalledWith({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
      });
    });
  });

  describe('checkMultipleLanguagePairs', () => {
    it('checks multiple target languages in parallel', async () => {
      window.Translator = {
        create: vi.fn(),
        availability: vi.fn().mockImplementation(async ({ targetLanguage }) => {
          if (targetLanguage === 'en') return 'readily';
          if (targetLanguage === 'ja') return 'after-download';
          return 'no';
        }),
      };

      const results = await checkMultipleLanguagePairs('zh-HK', ['en', 'ja', 'es']);
      expect(results.en.status).toBe('readily');
      expect(results.ja.status).toBe('after-download');
      expect(results.es.status).toBe('no');
    });
  });

  describe('getOrCreateChromeTranslator', () => {
    it('creates and caches translator with download progress listener', async () => {
      const mockTranslate = vi.fn().mockResolvedValue('Hello world');
      const mockCreate = vi.fn().mockImplementation(async ({ monitor }) => {
        if (monitor) {
          const listeners = {};
          monitor({
            addEventListener: (event, cb) => {
              listeners[event] = cb;
            },
          });
          listeners['downloadprogress']?.({ loaded: 50, total: 100 });
        }
        return { translate: mockTranslate };
      });

      window.Translator = {
        create: mockCreate,
        availability: vi.fn().mockResolvedValue('after-download'),
      };

      const progressEvents = [];
      const translator = await getOrCreateChromeTranslator('zh-HK', 'en', {
        onDownloadProgress: (p) => progressEvents.push(p),
      });

      expect(translator).toBeDefined();
      expect(progressEvents).toContain(50);

      // Subsequent call should hit cache and not call window.Translator.create again
      const cached = await getOrCreateChromeTranslator('zh-HK', 'en');
      expect(cached).toBe(translator);
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('returns null if availability is no', async () => {
      window.Translator = {
        create: vi.fn(),
        availability: vi.fn().mockResolvedValue('no'),
      };

      const translator = await getOrCreateChromeTranslator('zh-HK', 'xx');
      expect(translator).toBeNull();
    });
  });

  describe('translateWithChrome and translateMultipleWithChrome', () => {
    it('translates text through translator instance', async () => {
      const mockTranslate = vi.fn().mockResolvedValue('Hello translated');
      window.Translator = {
        create: vi.fn().mockResolvedValue({ translate: mockTranslate }),
        availability: vi.fn().mockResolvedValue('readily'),
      };

      const result = await translateWithChrome('你好', 'zh-HK', 'en');
      expect(result).toBe('Hello translated');
      expect(mockTranslate).toHaveBeenCalledWith('你好');
    });

    it('translates multiple target languages concurrently', async () => {
      window.Translator = {
        create: vi.fn().mockImplementation(async ({ targetLanguage }) => ({
          translate: async (txt) => `${txt} in ${targetLanguage}`,
        })),
        availability: vi.fn().mockResolvedValue('readily'),
      };

      const results = await translateMultipleWithChrome('測試', 'zh-HK', ['en', 'ja']);
      expect(results.en).toBe('測試 in en');
      expect(results.ja).toBe('測試 in ja');
    });
  });
});
