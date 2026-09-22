import { getAI, GoogleAIBackend, AgentPlatformBackend, VertexAIBackend, getLiveGenerativeModel, getGenerativeModel, Modality, ResponseModality } from 'firebase/ai';
import { app, auth } from '../firebase-config';
import { isTeacherEmail } from './domainConfig';

let aiInstance = null;
let activeBackendType = null;

// Official Gemini Live models supported by Firebase AI Logic
export const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const FALLBACK_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const CANDIDATE_LIVE_MODELS = [
  'gemini-3.1-flash-live-preview',
  'gemini-3.5-transcribe-live-preview'
];

// Models for audio transcription with Firebase AI Logic (ordered by Agent Platform GA -> Developer API)
export const DEFAULT_TRANSCRIBE_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.5-flash-lite'
];

// Set of model names that permanently failed (e.g. 404 Not Found in this backend/region)
const unsupportedModels = new Set();

/**
 * Resets unsupported model cache (useful for tests or environment shifts)
 */
export function resetUnsupportedModels() {
  unsupportedModels.clear();
}

// Circuit breaker state for audio transcription requests
let transcribeCooldownUntil = 0;
let lastCooldownNoticeTime = 0;

/**
 * Resets the transcription circuit breaker (useful for tests or billing replenishment)
 */
export function resetTranscribeCooldown() {
  transcribeCooldownUntil = 0;
  lastCooldownNoticeTime = 0;
}

/**
 * Resets the singleton AI instance (useful when switching backends or in tests)
 */
let aiInstances = {};

export function resetFirebaseAIInstance() {
  aiInstance = null;
  activeBackendType = null;
  aiInstances = {};
}

/**
 * Get or initialize the Firebase AI Logic instance.
 * Defaults to VertexAIBackend / AgentPlatformBackend (GCP Cloud Billing / Blaze Plan) with location 'global'.
 * Can be configured via VITE_FIREBASE_AI_BACKEND ('vertex' | 'google_ai') and preferredLocation.
 *
 * @param {'vertex' | 'google_ai'} [preferredBackend]
 * @param {string} [preferredLocation]
 * @returns {import('firebase/ai').AI | null}
 */
export function getFirebaseAI(preferredBackend, preferredLocation) {
  const backendType = preferredBackend || import.meta.env?.VITE_FIREBASE_AI_BACKEND || 'vertex';
  const defaultLocation = import.meta.env?.VITE_VERTEX_AI_LOCATION || 'global';
  const location = preferredLocation || defaultLocation;
  const cacheKey = `${backendType}:${location}`;

  if (!aiInstances[cacheKey]) {
    if (app) {
      try {
        let backend;
        let backendLabel;

        if (backendType === 'google_ai') {
          backend = new GoogleAIBackend();
          backendLabel = 'GoogleAIBackend (Gemini Developer API / AI Studio Prepay)';
        } else if (typeof AgentPlatformBackend !== 'undefined') {
          // Official Firebase AI Logic Agent Platform backend (formerly Vertex AI)
          backend = new AgentPlatformBackend(location);
          backendLabel = `AgentPlatformBackend (GCP Cloud Billing / Agent Platform - location: ${location})`;
        } else {
          backend = new VertexAIBackend(location);
          backendLabel = `VertexAIBackend (GCP Cloud Billing / Vertex AI - location: ${location})`;
        }

        aiInstances[cacheKey] = getAI(app, { backend });
        console.log(`[FirebaseAILogic] Initialized backend: ${backendLabel}`);
      } catch (err) {
        console.warn('[FirebaseAILogic] Failed to initialize Firebase AI instance:', err);
      }
    }
  }
  aiInstance = aiInstances[cacheKey] || null;
  activeBackendType = backendType;
  return aiInstance;
}

/**
 * Convert 16kHz Float32 PCM samples to 16-bit Linear PCM Little-Endian Base64
 * as required by the Gemini Multimodal Live API (mimeType: audio/pcm;rate=16000).
 *
 * @param {Float32Array} float32Array
 * @returns {string} Base64 encoded linear PCM string
 */
export function pcmFloat32ToBase64(float32Array) {
  if (!float32Array || float32Array.length === 0) return '';
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Convert 16kHz Float32 PCM samples to standard 16-bit mono WAV format as Base64.
 *
 * @param {Float32Array} float32Array
 * @param {number} [sampleRate=16000]
 * @returns {string} Base64 encoded WAV string
 */
export function pcmFloat32ToWavBase64(float32Array, sampleRate = 16000) {
  if (!float32Array || float32Array.length === 0) return '';
  const numChannels = 1;
  const bytesPerSample = 2;
  const dataSize = float32Array.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // RIFF header
  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmt chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);

  // data chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCM samples
  let offset = 44;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Transcribe classroom speech using Firebase AI Logic (Gemini Developer API).
 * Leverages GoogleAIBackend and App Check as documented in Firebase AI Logic get-started.
 *
 * @param {Float32Array} pcmFloat32Array - 16kHz audio samples
 * @param {number} [sampleRate=16000]
 * @param {string} [speechLanguage='zh-HK']
 * @returns {Promise<string>} Transcribed text
 */
export async function transcribeAudioWithFirebaseAI(pcmFloat32Array, sampleRate = 16000, speechLanguage = 'zh-HK', options = {}) {
  if (!pcmFloat32Array || pcmFloat32Array.length === 0) return '';

  const now = Date.now();
  if (now < transcribeCooldownUntil) {
    // In circuit breaker cooldown due to depleted credits or 429 rate limit
    return '';
  }

  const ai = getFirebaseAI();
  if (!ai) {
    console.warn('[FirebaseAILogic] Cannot transcribe: Firebase AI instance is not initialized.');
    return '';
  }

  const wavBase64 = pcmFloat32ToWavBase64(pcmFloat32Array, sampleRate);
  if (!wavBase64) return '';

  const { courseContext = '', customPrompt = '' } = options;
  const domainContext = courseContext?.trim() || 'classroom instruction';
  const spokenLangDesc = speechLanguage === 'en' ? 'English' : 'Cantonese (zh-HK) with mixed domain and technical terms';
  const customInstructions = customPrompt?.trim() ? `\nDomain instructions:\n${customPrompt.trim()}` : '';

  let systemInstruction = `You are a real-time classroom speech-to-text transcriber for ${domainContext}.
The spoken language is ${spokenLangDesc}.
Rules:
1. Transcribe the audio verbatim.
2. Keep discipline-specific terms, proper nouns, and technical vocabulary accurate for ${domainContext}.
3. Output ONLY the transcribed text. Do NOT add notes, explanations, or quotes.${customInstructions}`;

  if (typeof customPrompt === 'string' && customPrompt.includes('{{courseContext}}')) {
    systemInstruction = customPrompt
      .replace(/\{\{courseContext\}\}/g, domainContext)
      .replace(/\{\{speechLanguage\}\}/g, spokenLangDesc);
  }

  const candidateModels = [
    options.model,
    ...DEFAULT_TRANSCRIBE_MODELS
  ].filter((m, idx, arr) => m && !unsupportedModels.has(m) && arr.indexOf(m) === idx);

  if (candidateModels.length === 0) {
    return '';
  }

  for (const modelName of candidateModels) {
    try {
      const model = getGenerativeModel(ai, {
        model: modelName,
        systemInstruction,
      });

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'audio/wav',
            data: wavBase64,
          },
        },
        'Transcribe this classroom audio verbatim.',
      ]);

      const text = (result?.response?.text?.() || '').trim();
      if (text) return text;
    } catch (err) {
      const errMsg = String(err?.message || err || '');
      const isQuotaOrDepleted =
        errMsg.includes('429') ||
        errMsg.includes('depleted') ||
        errMsg.includes('prepayment') ||
        errMsg.includes('credits') ||
        errMsg.includes('RESOURCE_EXHAUSTED') ||
        errMsg.includes('quota');

      if (isQuotaOrDepleted) {
        transcribeCooldownUntil = Date.now() + 60000;
        if (Date.now() - lastCooldownNoticeTime > 60000) {
          lastCooldownNoticeTime = Date.now();
          console.warn(
            '[FirebaseAILogic:Transcribe] Gemini API quota reached or credits depleted (429). Pausing cloud AI transcription for 60s (falling back to on-device audio/simulated transcription):',
            errMsg
          );
        }
        // Depleted prepayment credits or 429 quota exhaustion affects all models on this project; break loop immediately
        break;
      }

      const isDeactivatedOrAppCheck =
        errMsg.includes('deactivated') ||
        errMsg.includes('enforce Firebase App Check') ||
        errMsg.includes('App Check');

      if (isDeactivatedOrAppCheck) {
        transcribeCooldownUntil = Date.now() + 30000;
        if (Date.now() - lastCooldownNoticeTime > 30000) {
          lastCooldownNoticeTime = Date.now();
          console.warn(
            '[FirebaseAILogic:Transcribe] Firebase AI Logic requires App Check attestation token. Pausing cloud requests for 30s:',
            errMsg
          );
        }
        break;
      }


      const isNotFoundOrUnsupported =
        errMsg.includes('404') ||
        errMsg.includes('not found') ||
        errMsg.includes('no longer available') ||
        errMsg.includes('does not have access') ||
        errMsg.includes('Publisher model');

      if (isNotFoundOrUnsupported) {
        unsupportedModels.add(modelName);
        console.warn(`[FirebaseAILogic:Transcribe] Model ${modelName} not available on this backend/region (pruning from future candidates):`, errMsg);
        continue;
      }

      console.warn(`[FirebaseAILogic:Transcribe] Model ${modelName} notice:`, errMsg);
    }
  }

  return '';
}

/**
 * Maps language code to readable name for prompt context
 */
const LANGUAGE_NAMES = {
  en: 'English',
  'zh-Hant': 'Traditional Chinese (繁體中文)',
  'zh-Hans': 'Simplified Chinese (简体中文)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  es: 'Spanish (Español)',
  fr: 'French (Français)'
};

/**
 * Create a live subtitle session with Gemini Live via Firebase AI Logic.
 *
 * @param {Object} options
 * @param {string} [options.targetLanguage='en'] - Target translation language code
 * @param {string} [options.modelName=DEFAULT_LIVE_MODEL] - Live model identifier (Gemini Developer API)
 * @param {Function} [options.onOriginalTranscript] - Called when input speech is transcribed
 * @param {Function} [options.onTranslatedChunk] - Called with streaming text tokens
 * @param {Function} [options.onTurnComplete] - Called when a speech turn is completed
 * @param {Function} [options.onInterrupted] - Called when user speech interrupts model turn
 * @param {Function} [options.onError] - Error callback
 * @returns {Object} Session controller { connect, sendAudioChunk, close, isConnected }
 */
export function createLiveSubtitleSession(options = {}) {
  const {
    targetLanguage = 'en',
    modelName = DEFAULT_LIVE_MODEL,
    courseContext = '',
    customPrompt = '',
    speechLanguage = 'zh-HK',
    onOriginalTranscript,
    onTranslatedChunk,
    onTurnComplete,
    onInterrupted,
    onUsageUpdate,
    onError
  } = options;

  const targetLangName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
  const domainContext = courseContext?.trim() || 'higher education classroom';
  const customRules = customPrompt?.trim() ? `\n4. Special class instructions:\n${customPrompt.trim()}` : '';
  let session = null;
  let isClosed = false;
  let sessionStartTime = null;
  let totalAudioSamples = 0;
  let recordedAudioTokens = 0;
  let recordedOutputTokens = 0;

  const getSessionUsage = () => {
    const elapsedSeconds = sessionStartTime ? Math.max(0, Math.round((Date.now() - sessionStartTime) / 1000)) : 0;
    const audioTokens = recordedAudioTokens > 0
      ? recordedAudioTokens
      : Math.round((totalAudioSamples / 16000) * 28);
    const outputTokens = recordedOutputTokens;
    const totalTokens = audioTokens + outputTokens;
    const costUsd = Number(
      ((audioTokens / 1000000) * 0.60 + (outputTokens / 1000000) * 2.50).toFixed(6)
    );
    return {
      durationSeconds: elapsedSeconds,
      audioTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd: costUsd,
      modelUsed: modelName
    };
  };

  const spokenLangDesc = speechLanguage === 'en' ? 'English' : 'Cantonese (zh-HK) with mixed domain terminology';
  let systemInstruction = `You are a real-time classroom lecture subtitler and translator for ${domainContext}.
The teacher is lecturing in ${spokenLangDesc}.
Translate the speech in real-time into ${targetLangName}.
CRITICAL RULES:
1. Maintain discipline-specific keywords, proper nouns, abbreviations, and terms in their standard technical/original form as appropriate for ${domainContext}.
2. Output concise, accurate real-time subtitle text tokens suitable for live classroom subtitles.
3. Do NOT include conversational pleasantries, markdown formatting, or explanations. Only output the translated subtitle text.${customRules}`;

  if (typeof customPrompt === 'string' && (customPrompt.includes('{{targetLanguage}}') || customPrompt.includes('{{courseContext}}'))) {
    systemInstruction = customPrompt
      .replace(/\{\{targetLanguage\}\}/g, targetLangName)
      .replace(/\{\{courseContext\}\}/g, domainContext)
      .replace(/\{\{speechLanguage\}\}/g, spokenLangDesc);
  }

  const textModality = (ResponseModality && ResponseModality.TEXT) || (Modality && Modality.TEXT) || 'TEXT';

  return {
    /**
     * Connect to the Gemini Live WebSocket via Firebase AI Logic.
     */
    async connect() {
      // Defensive guardrail: Ensure that only authorized instructors can initiate a Gemini Live session
      const currentUser = options.currentUser || auth?.currentUser;
      if (currentUser && currentUser.email && !isTeacherEmail(currentUser.email)) {
        throw new Error('Unauthorized: Gemini Live subtitle broadcast can only be initiated by verified instructors.');
      }

      // Per Firebase AI Logic documentation (https://firebase.google.com/docs/ai-logic/models#model-names-audio-generating-live):
      // Agent Platform Live API models (e.g. gemini-3.1-flash-live-preview) are not available in 'global',
      // so we use regional location (default: 'us-central1') for the live session.
      const liveLocation = import.meta.env?.VITE_VERTEX_AI_LIVE_LOCATION || 'us-central1';
      const ai = getFirebaseAI(undefined, liveLocation);
      if (!ai) {
        throw new Error('Firebase AI Logic is not initialized or app is unavailable.');
      }

      isClosed = false;
      sessionStartTime = Date.now();
      const candidates = [
        modelName,
        ...CANDIDATE_LIVE_MODELS
      ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

      let lastErr = null;
      for (const candModel of candidates) {
        try {
          const liveModel = getLiveGenerativeModel(ai, {
            model: candModel,
            systemInstruction,
            generationConfig: {
              responseModalities: [textModality],
              inputAudioTranscription: {}
            }
          });
          session = await liveModel.connect();
          lastErr = null;
          break;
        } catch (candErr) {
          lastErr = candErr;
          console.warn(`[FirebaseAILogic:Live] Live model ${candModel} connect notice:`, candErr?.message || candErr);

          // Fast failover: If the failure is caused by App Check, authentication, or project policy,
          // subsequent candidate models on the same endpoint will fail identically. Break immediately.
          const errMsg = String(candErr?.message || candErr || '');
          const isAuthOrAppCheck = errMsg.includes('App Check') ||
            errMsg.includes('app-check') ||
            errMsg.includes('token is invalid') ||
            errMsg.includes('deactivated') ||
            errMsg.includes('Handshake failure') ||
            errMsg.includes('setupComplete') ||
            errMsg.includes('PERMISSION_DENIED') ||
            errMsg.includes('Unauthorized');

          if (isAuthOrAppCheck) {
            break;
          }
        }
      }

      if (lastErr) {
        throw lastErr;
      }

      // Initial usage broadcast
      onUsageUpdate?.(getSessionUsage());

      // Start listening to the WebSocket receive generator in the background
      (async () => {
        try {
          for await (const message of session.receive()) {
            if (isClosed) break;

            // Intercept usageMetadata from server message if provided
            if (message && message.usageMetadata) {
              if (typeof message.usageMetadata.promptTokenCount === 'number') {
                recordedAudioTokens = message.usageMetadata.promptTokenCount;
              }
              if (typeof message.usageMetadata.candidatesTokenCount === 'number') {
                recordedOutputTokens = message.usageMetadata.candidatesTokenCount;
              }
              onUsageUpdate?.(getSessionUsage());
            }

            if (message && message.type === 'serverContent') {
              if (message.inputTranscription?.text && onOriginalTranscript) {
                onOriginalTranscript(message.inputTranscription.text);
              }
              if (message.modelTurn?.parts) {
                for (const part of message.modelTurn.parts) {
                  if (part.text && onTranslatedChunk) {
                    onTranslatedChunk(part.text);
                    recordedOutputTokens += Math.max(1, Math.round(part.text.length / 4));
                  }
                }
                onUsageUpdate?.(getSessionUsage());
              }
              if (message.turnComplete && onTurnComplete) {
                onTurnComplete();
                onUsageUpdate?.(getSessionUsage());
              }
              if (message.interrupted && onInterrupted) {
                onInterrupted();
              }
            } else if (message && (message.type === 'goAway' || message.type === 'goingAwayNotice')) {
              onError?.(new Error('Live session received going away notice from server.'));
            }
          }
        } catch (err) {
          if (!isClosed) {
            console.error('[FirebaseAILogic:Live] Stream error:', err);
            onError?.(err);
          }
        }
      })();

      return session;
    },

    /**
     * Send an audio frame (Float32Array 16kHz) to the Gemini Live session.
     * @param {Float32Array} float32Samples
     */
    async sendAudioChunk(float32Samples) {
      if (!session || isClosed || session.isClosed) return;
      if (float32Samples && float32Samples.length) {
        totalAudioSamples += float32Samples.length;
      }
      const base64Data = pcmFloat32ToBase64(float32Samples);
      if (!base64Data) return;

      await session.sendAudioRealtime({
        mimeType: 'audio/pcm;rate=16000',
        data: base64Data
      });
    },

    /**
     * Get real-time session telemetry including token counts and estimated USD cost.
     */
    getSessionUsage,

    /**
     * Close the active live session.
     */
    async close() {
      isClosed = true;
      if (session) {
        try {
          if (!session.isClosed && typeof session.close === 'function') {
            await session.close();
          }
        } catch (err) {
          console.warn('[FirebaseAILogic:Live] Error during session close:', err);
        }
        session = null;
      }
    },

    /**
     * Check if currently connected.
     */
    isConnected() {
      return Boolean(session && !session.isClosed && !isClosed);
    }
  };
}
