/**
 * chromeTranslator.js
 * 
 * Production wrapper for Chrome Built-in AI Translation API (window.Translator).
 * Handles language code normalization (e.g. zh-HK -> zh), availability checks,
 * download progress monitoring, and instance caching.
 */

// In-memory cache for created Translator instances: "source->target" => Translator
const translatorCache = new Map();
const inFlightPromises = new Map();

/**
 * Normalizes an IETF BCP 47 language code into the base ISO 639-1 code required by Chrome Translator.
 * (e.g., 'zh-HK' -> 'zh', 'en-US' -> 'en', 'ja-JP' -> 'ja')
 * @param {string} lang 
 * @returns {string}
 */
export function normalizeLanguageCode(lang) {
  if (!lang || typeof lang !== 'string') return 'en';
  return lang.trim().toLowerCase().split(/[-_]/)[0];
}

/**
 * Checks whether the Chrome Translator global API is present and supported in the current environment.
 * Supports both W3C window.translation and experimental window.Translator specifications.
 * @returns {boolean}
 */
export function isChromeTranslatorSupported() {
  if (typeof window === 'undefined') return false;
  if (window.Translator && typeof window.Translator.create === 'function') return true;
  if (window.translation && (typeof window.translation.canTranslate === 'function' || typeof window.translation.createTranslator === 'function')) return true;
  return false;
}

/**
 * Checks availability of a language pair in Chrome Translator.
 * @param {string} sourceLang 
 * @param {string} targetLang 
 * @returns {Promise<'readily' | 'after-download' | 'no' | 'unsupported'>}
 */
export async function checkLanguagePairAvailability(sourceLang, targetLang) {
  if (!isChromeTranslatorSupported()) {
    return 'unsupported';
  }

  const baseSource = normalizeLanguageCode(sourceLang);
  const baseTarget = normalizeLanguageCode(targetLang);

  if (baseSource === baseTarget) {
    return 'readily';
  }

  try {
    if (typeof window !== 'undefined' && window.translation && typeof window.translation.canTranslate === 'function') {
      const status = await window.translation.canTranslate({
        sourceLanguage: baseSource,
        targetLanguage: baseTarget,
      });
      return status || 'no';
    }
    if (typeof window !== 'undefined' && window.Translator && typeof window.Translator.availability === 'function') {
      const status = await window.Translator.availability({
        sourceLanguage: baseSource,
        targetLanguage: baseTarget,
      });
      return status || 'no';
    }
    return 'no';
  } catch (err) {
    console.warn(`[ChromeTranslator] Error checking availability for ${baseSource}->${baseTarget}:`, err);
    return 'no';
  }
}

/**
 * Checks availability for an array of target languages simultaneously.
 * @param {string} sourceLang 
 * @param {string[]} targetLangs 
 * @returns {Promise<Record<string, { status: string, baseSource: string, baseTarget: string }>>}
 */
export async function checkMultipleLanguagePairs(sourceLang, targetLangs = []) {
  const results = {};
  await Promise.all(
    targetLangs.map(async (targetLang) => {
      const baseSource = normalizeLanguageCode(sourceLang);
      const baseTarget = normalizeLanguageCode(targetLang);
      const status = await checkLanguagePairAvailability(sourceLang, targetLang);
      results[targetLang] = { status, baseSource, baseTarget };
    })
  );
  return results;
}

/**
 * Retrieves an existing Translator instance or creates a new one with download progress monitoring.
 * @param {string} sourceLang 
 * @param {string} targetLang 
 * @param {{ onDownloadProgress?: (percent: number, loaded: number, total: number) => void }} options
 * @returns {Promise<any|null>}
 */
export async function getOrCreateChromeTranslator(sourceLang, targetLang, options = {}) {
  if (!isChromeTranslatorSupported()) {
    return null;
  }

  const baseSource = normalizeLanguageCode(sourceLang);
  const baseTarget = normalizeLanguageCode(targetLang);
  const cacheKey = `${baseSource}->${baseTarget}`;

  if (translatorCache.has(cacheKey)) {
    return translatorCache.get(cacheKey);
  }

  if (inFlightPromises.has(cacheKey)) {
    return inFlightPromises.get(cacheKey);
  }

  const availability = await checkLanguagePairAvailability(sourceLang, targetLang);
  if (availability === 'no' || availability === 'unsupported') {
    return null;
  }

  const createPromise = (async () => {
    try {
      const createOptions = {
        sourceLanguage: baseSource,
        targetLanguage: baseTarget,
      };

      if (typeof options.onDownloadProgress === 'function') {
        createOptions.monitor = (m) => {
          if (m && typeof m.addEventListener === 'function') {
            m.addEventListener('downloadprogress', (e) => {
              const total = e.total || 0;
              const loaded = e.loaded || 0;
              const percent = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
              options.onDownloadProgress(percent, loaded, total);
            });
          }
        };
      }

      let translator = null;
      if (typeof window !== 'undefined' && window.translation && typeof window.translation.createTranslator === 'function') {
        translator = await window.translation.createTranslator(createOptions);
      } else if (typeof window !== 'undefined' && window.Translator && typeof window.Translator.create === 'function') {
        translator = await window.Translator.create(createOptions);
      }
      if (translator) {
        translatorCache.set(cacheKey, translator);
      }
      return translator;
    } catch (err) {
      const isExpectedGracefulFallback =
        err?.name === 'NotAllowedError' ||
        err?.name === 'NotSupportedError' ||
        String(err?.message || err).toLowerCase().includes('limitation') ||
        String(err?.message || err).toLowerCase().includes('exceeded') ||
        String(err?.message || err).toLowerCase().includes('gesture');

      if (isExpectedGracefulFallback) {
        console.warn(`[ChromeTranslator] Notice for ${cacheKey} (falling back to server/on-device AI):`, err?.message || err);
      } else {
        console.error(`[ChromeTranslator] Failed to create translator for ${cacheKey}:`, err);
      }
      return null;
    } finally {
      inFlightPromises.delete(cacheKey);
    }
  })();

  inFlightPromises.set(cacheKey, createPromise);
  return createPromise;
}

/**
 * Translates a single text string using Chrome Built-in AI.
 * @param {string} text 
 * @param {string} sourceLang 
 * @param {string} targetLang 
 * @returns {Promise<string|null>}
 */
export async function translateWithChrome(text, sourceLang, targetLang) {
  const trimmed = (text || '').trim();
  if (!trimmed) return '';

  const baseSource = normalizeLanguageCode(sourceLang);
  const baseTarget = normalizeLanguageCode(targetLang);
  if (baseSource === baseTarget) return trimmed;

  const translator = await getOrCreateChromeTranslator(sourceLang, targetLang);
  if (!translator || typeof translator.translate !== 'function') {
    return null;
  }

  try {
    return await translator.translate(trimmed);
  } catch (err) {
    console.warn(`[ChromeTranslator] Translation error for ${baseSource}->${baseTarget}:`, err);
    return null;
  }
}

/**
 * Translates a text string into multiple target languages simultaneously.
 * Returns an object mapping targetLang -> translated text.
 * @param {string} text 
 * @param {string} sourceLang 
 * @param {string[]} targetLangs 
 * @returns {Promise<Record<string, string>>}
 */
export async function translateMultipleWithChrome(text, sourceLang, targetLangs = []) {
  const trimmed = (text || '').trim();
  if (!trimmed || !targetLangs.length) return {};

  const translations = {};
  await Promise.all(
    targetLangs.map(async (targetLang) => {
      const result = await translateWithChrome(trimmed, sourceLang, targetLang);
      if (result) {
        translations[targetLang] = result;
      }
    })
  );
  return translations;
}

/**
 * Clears cached translator instances.
 */
export function clearChromeTranslatorCache() {
  for (const translator of translatorCache.values()) {
    try {
      translator?.destroy?.();
    } catch (_) {}
  }
  translatorCache.clear();
  inFlightPromises.clear();
}
