import { getAI, GoogleAIBackend, getLiveGenerativeModel, Modality, ResponseModality } from 'firebase/ai';
import { app, auth } from '../firebase-config';
import { isTeacherEmail } from './domainConfig';

let aiInstance = null;

// Official Gemini Live models supported by Gemini Developer API (GoogleAIBackend)
export const DEFAULT_LIVE_MODEL = 'gemini-3.1-flash-live-preview';
export const FALLBACK_LIVE_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';

/**
 * Get or initialize the Firebase AI Logic instance.
 * Defaults to GoogleAIBackend using client API key and App Check.
 */
export function getFirebaseAI() {
  if (!aiInstance && app) {
    try {
      aiInstance = getAI(app, { backend: new GoogleAIBackend() });
    } catch (err) {
      console.warn('[FirebaseAILogic] Failed to initialize Firebase AI instance:', err);
    }
  }
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
    onOriginalTranscript,
    onTranslatedChunk,
    onTurnComplete,
    onInterrupted,
    onUsageUpdate,
    onError
  } = options;

  const targetLangName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
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

  const systemInstruction = `You are a real-time classroom lecture subtitler and translator for computer science education.
The teacher is lecturing in Cantonese (zh-HK) with mixed English programming terms and jargon.
Translate the speech in real-time into ${targetLangName}.
CRITICAL RULES:
1. Maintain all programming keywords, code syntax, variable names, database queries, and tech terms in English (e.g., useState, Docker, git commit, const, let, npm, pip, CSS flexbox, SQL SELECT).
2. Output concise, accurate real-time subtitle text tokens suitable for live classroom subtitles.
3. Do NOT include conversational pleasantries, markdown formatting, or explanations. Only output the translated subtitle text.`;

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

      const ai = getFirebaseAI();
      if (!ai) {
        throw new Error('Firebase AI Logic is not initialized or app is unavailable.');
      }

      isClosed = false;
      sessionStartTime = Date.now();
      try {
        const liveModel = getLiveGenerativeModel(ai, {
          model: modelName,
          systemInstruction,
          generationConfig: {
            responseModalities: [textModality],
            inputAudioTranscription: {}
          }
        });
        session = await liveModel.connect();
      } catch (connectErr) {
        if (modelName !== FALLBACK_LIVE_MODEL) {
          console.warn(`[FirebaseAILogic:Live] Primary model ${modelName} connect failed, falling back to ${FALLBACK_LIVE_MODEL}:`, connectErr);
          const fallbackModel = getLiveGenerativeModel(ai, {
            model: FALLBACK_LIVE_MODEL,
            systemInstruction,
            generationConfig: {
              responseModalities: [textModality],
              inputAudioTranscription: {}
            }
          });
          session = await fallbackModel.connect();
        } else {
          throw connectErr;
        }
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
