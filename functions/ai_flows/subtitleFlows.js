import './firebase.js';
import { getFirestore } from 'firebase-admin/firestore';
import { ai, vertexAI } from './ai.js';
import { z } from 'genkit';
import { AI_MODEL } from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { checkQuota } from './quotaManagement.js';
import { estimateCost, calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();

/**
 * Supported Language Map with Display Labels
 */
export const SUPPORTED_SUBTITLE_LANGUAGES = {
  'zh-Hant': '繁體中文 (Traditional Chinese)',
  'zh-Hans': '简体中文 (Simplified Chinese)',
  'en': 'English',
  'ja': '日本語 (Japanese)',
  'ko': '한국어 (Korean)',
  'es': 'Español (Spanish)',
  'fr': 'Français (French)',
  'de': 'Deutsch (German)',
  'vi': 'Tiếng Việt (Vietnamese)',
};

/**
 * Server-side Multilingual Subtitle Translation Flow.
 * Translates teacher lecture speech (such as spoken Cantonese with English code-switching)
 * into requested target languages while preserving programming keywords and technical terminology.
 *
 * NOTE: Server audio slicing is intentionally omitted. This endpoint receives clean,
 * continuous transcripts decoded by on-device LiteRT Whisper.
 */
export async function translateTeacherSpeech({
  classId,
  teacherUid,
  teacherEmail = '',
  text,
  sourceLang = 'zh-HK',
  targetLangs = ['zh-Hant'],
  context = '',
  customPrompt = '',
  historyText = null,
}) {
  const trimmedText = (text || '').trim();
  if (!trimmedText) {
    return {
      originalText: '',
      sourceLang,
      translations: {},
      modelUsed: AI_MODEL,
      cost: 0,
    };
  }

  // Ensure targetLangs is an array and filter out invalid/empty entries
  const validTargets = Array.isArray(targetLangs) && targetLangs.length > 0
    ? targetLangs.filter(l => Boolean(l && typeof l === 'string'))
    : ['zh-Hant'];

  const targetDesc = validTargets
    .map(code => `${code} (${SUPPORTED_SUBTITLE_LANGUAGES[code] || code})`)
    .join(', ');

  const domainContext = context?.trim() || 'General Classroom Instruction';
  const customInstructions = customPrompt?.trim()
    ? `\n6. Special Instructions for this Class:\n${customPrompt.trim()}`
    : '';

  let historyBlock = '';
  if (Array.isArray(historyText) && historyText.length > 0) {
    const lines = historyText
      .map(line => (typeof line === 'string' ? line.trim() : ''))
      .filter(Boolean);
    if (lines.length > 0) {
      historyBlock = `\nPreceding Speech History (for conversational context, pronoun resolution, and terminology continuity only; DO NOT translate this section):\n${lines.map(l => `- "${l}"`).join('\n')}\n`;
    }
  } else if (typeof historyText === 'string' && historyText.trim()) {
    historyBlock = `\nPreceding Speech History (for conversational context, pronoun resolution, and terminology continuity only; DO NOT translate this section):\n"${historyText.trim()}"\n`;
  }

  const prompt = `You are a real-time lecture subtitle translator for higher education.
Context / Subject Matter: ${domainContext}
Spoken Source Language: ${sourceLang} (May include colloquial Cantonese and English code-switching)
Target Language(s) to produce: ${targetDesc}
${historyBlock}
Current Speech to Translate:
"${trimmedText}"

Guidelines:
1. FULL TRANSLATION MANDATORY: Translate the complete sentence and meaning accurately and naturally into each requested target language.
2. For English ("en"): Translate all spoken Chinese/Cantonese phrases into natural fluent English (e.g. "hello你好嗎" -> "Hello, how are you?", "今日我哋學..." -> "Today we will learn..."). NEVER leave untranslated Chinese characters or colloquialisms in the English translation.
3. For Simplified Chinese ("zh-Hans"): Translate Cantonese colloquialisms into standard written Simplified Chinese (e.g. "hello你好嗎" -> "你好，你好吗？").
4. For Traditional Chinese ("zh-Hant"): Translate into standard written Traditional Chinese (e.g. "今天我們學習...").
5. Technical Terms: Preserve domain-specific technical keywords, programming syntax, standard formula names, and brand names (e.g. "useEffect", "Firestore", "Docker", "Python", "Kubernetes") in their original technical spelling without unnatural literal translations.
6. Translate ONLY the "Current Speech to Translate", using the Preceding Speech History solely to infer context, resolve pronouns (e.g. "it", "they", "this"), and maintain terminology continuity.
7. Return a JSON mapping with the exact target language codes as keys (e.g. {"en":"...","zh-Hans":"..."}).${customInstructions}`;

  // Estimate cost & check quota
  const estimatedCost = estimateCost(prompt, [], AI_MODEL) + 0.00005;
  if (classId) {
    const hasQuota = await checkQuota(classId, estimatedCost);
    if (!hasQuota) {
      await logJob({
        classId,
        studentUid: teacherUid || 'teacher',
        studentEmail: teacherEmail,
        jobType: 'translateTeacherSpeech',
        status: 'blocked-by-quota',
        promptText: trimmedText,
        mediaPaths: [],
        cost: 0,
        modelUsed: AI_MODEL,
      });
      throw new Error('Classroom AI quota exceeded. Cannot translate subtitles.');
    }
  }

  // Define schema for dynamic target languages
  const translationsSchema = z.record(z.string(), z.string());

  const { response, modelUsed } = await generateWithResilience({
    prompt,
    output: {
      schema: z.object({
        detectedSourceLang: z.string().optional().describe('Detected source language code'),
        translations: translationsSchema.describe('Map of exact target language codes to translated subtitle strings'),
      }),
    },
  }, AI_MODEL);

  const output = response.output || {};
  const rawTranslations = output.translations || {};

  // Normalize translations ensuring all requested target languages have entries
  const normalizedTranslations = {};
  for (const lang of validTargets) {
    if (rawTranslations[lang]) {
      normalizedTranslations[lang] = rawTranslations[lang];
    } else {
      // Check alternative keys (e.g. 'zh' vs 'zh-Hans' or 'zh-Hant', 'en' vs 'English', 'zh-Hans' vs 'Simplified Chinese')
      const targetPrefix = lang.split('-')[0].toLowerCase();
      const altKey = Object.keys(rawTranslations).find(k => {
        const lowerK = k.toLowerCase();
        return lowerK === lang.toLowerCase() ||
          lowerK.startsWith(targetPrefix) ||
          (targetPrefix === 'en' && lowerK.includes('english')) ||
          (targetPrefix === 'zh' && (lowerK.includes('chinese') || lowerK.includes('mandarin') || lowerK.includes('cantonese')));
      });
      normalizedTranslations[lang] = altKey ? rawTranslations[altKey] : trimmedText;
    }
  }

  // Calculate actual cost based on usage or usageMetadata
  const usage = response.usage || response.usageMetadata || response.raw?.usageMetadata || {};
  const inputTokens = usage.promptTokens || usage.promptTokenCount || usage.inputTokens || 0;
  const outputTokens = usage.completionTokens || usage.candidatesTokenCount || usage.outputTokens || 0;
  const totalTokens = usage.totalTokens || usage.totalTokenCount || (inputTokens + outputTokens);

  const actualCost = (inputTokens > 0 || outputTokens > 0)
    ? calculateCost(usage, modelUsed)
    : estimatedCost;

  if (classId) {
    await logJob({
      classId,
      studentUid: teacherUid || 'teacher',
      studentEmail: teacherEmail || 'teacher',
      jobType: 'translateTeacherSpeech',
      status: 'completed',
      promptText: trimmedText,
      mediaPaths: [],
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
      },
      cost: actualCost,
      modelUsed,
    });
  }

  return {
    originalText: trimmedText,
    sourceLang: output.detectedSourceLang || sourceLang,
    translations: normalizedTranslations,
    cost: actualCost,
    modelUsed,
  };
}
