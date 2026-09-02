/**
 * litertGemma.worker.js
 * 
 * Background Web Worker executing LiteRT-LM Gemma inference
 * for real-time exam speech transcript monitoring and intent classification.
 */

import { Engine } from '@litert-lm/core';
import { DEFAULT_GEMMA_CONFIG } from '../utils/gemmaLiteRTLoader.js';

let gemmaEngine = null;
let initializationPromise = null;

const LITERT_LM_WASM_BASE_URL =
  'https://cdn.jsdelivr.net/npm/@litert-lm/core@0.15.0/wasm/';

const GEMMA_PROCTOR_SYSTEM_PROMPT = `You are an AI exam proctor. Classify a student's spoken transcript by meaning and context.

Use exactly one category:
- COLLUSION_EXAM: asking for, offering, or discussing exam answers, questions, or options
- EXTERNAL_AI_ASSIST: asking a voice assistant, search engine, phone, or AI tool for help
- UNAUTHORIZED_TALK: unrelated conversation with another person during a silent exam
- LEGITIMATE_INQUIRY: procedural or technical help requested from the teacher or proctor
- BENIGN: self-talk, reading aloud, ambient speech, coughing, or silence

Respond with only one JSON object:
{"isViolation":boolean,"category":"COLLUSION_EXAM|EXTERNAL_AI_ASSIST|UNAUTHORIZED_TALK|LEGITIMATE_INQUIRY|BENIGN","severity":"critical|high|medium|low|none","confidence":number,"evidence":"quoted key phrase","rationale":"short explanation"}`;

/**
 * System prompt template for Gemma exam proctoring.
 */
export function buildGemmaProctorPrompt(transcript) {
  return `<start_of_turn>user
${GEMMA_PROCTOR_SYSTEM_PROMPT}
Transcript: "${transcript}"
<end_of_turn>
<start_of_turn>model
`;
}

export function resolveLiteRtLmWasmUrl(fileName) {
  return new URL(fileName, LITERT_LM_WASM_BASE_URL).href;
}

function configureLiteRtLmWasmLocation() {
  self.Module = {
    ...(self.Module || {}),
    locateFile: resolveLiteRtLmWasmUrl,
  };
}

async function streamModelWithProgress(modelUrl) {
  const response = await fetch(modelUrl, { credentials: 'omit' });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Gemma E2B model (${response.status})`);
  }

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  console.log('[LiteRTGemmaWorker] Gemma 4 E2B download started.', {
    modelUrl,
    totalBytes,
  });
  const reader = response.body.getReader();
  let receivedBytes = 0;

  return new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        console.log('[LiteRTGemmaWorker] Gemma 4 E2B download completed.', {
          receivedBytes,
        });
        self.postMessage({ type: 'PROGRESS', payload: { progress: 90 } });
        controller.close();
        return;
      }

      receivedBytes += value.byteLength;
      if (totalBytes > 0) {
        const progress = Math.min(89, 5 + Math.round((receivedBytes / totalBytes) * 84));
        self.postMessage({ type: 'PROGRESS', payload: { progress } });
      }
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function initializeGemma(modelUrl) {
  if (gemmaEngine) return;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    if (!navigator.gpu) {
      throw new Error('WebGPU is unavailable on this device');
    }

    configureLiteRtLmWasmLocation();
    const modelStream = await streamModelWithProgress(modelUrl);
    self.postMessage({ type: 'STATUS', payload: { status: 'loading', progress: 90 } });
    gemmaEngine = await Engine.create({
      model: modelStream,
      mainExecutorSettings: {
        maxNumTokens: 2048,
      },
    }, GEMMA_PROCTOR_SYSTEM_PROMPT);
  })();

  try {
    await initializationPromise;
  } finally {
    initializationPromise = null;
  }
}

function getResponseText(response) {
  if (typeof response?.content === 'string') return response.content;
  if (!Array.isArray(response?.content)) return '';
  return response.content
    .filter(part => part?.type === 'text' || typeof part?.text === 'string')
    .map(part => part.text || '')
    .join('');
}

/**
 * Parses and validates structured output from Gemma.
 * @param {string} rawText 
 * @returns {object}
 */
export function parseGemmaOutput(rawText) {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validCategories = new Set([
        'COLLUSION_EXAM',
        'EXTERNAL_AI_ASSIST',
        'UNAUTHORIZED_TALK',
        'LEGITIMATE_INQUIRY',
        'BENIGN',
      ]);
      const validSeverities = new Set(['critical', 'high', 'medium', 'low', 'none']);
      if (
        typeof parsed.isViolation === 'boolean' &&
        validCategories.has(parsed.category) &&
        validSeverities.has(parsed.severity) &&
        Number.isFinite(parsed.confidence) &&
        parsed.confidence >= 0 &&
        parsed.confidence <= 1 &&
        typeof parsed.evidence === 'string' &&
        typeof parsed.rationale === 'string'
      ) {
        return parsed;
      }
    }
  } catch (error) {
    throw new Error(`Gemma returned invalid JSON: ${error.message}`);
  }
  throw new Error('Gemma returned an invalid evaluation payload');
}

async function disposeGemma() {
  await gemmaEngine?.delete?.();
  gemmaEngine = null;
}

/**
 * Handle incoming messages from the main React thread.
 */
self.onmessage = async (event) => {
  const { type, payload, id } = event.data;

  try {
    switch (type) {
      case 'INIT': {
        const { modelUrl = DEFAULT_GEMMA_CONFIG.modelUrl } = payload || {};
        self.postMessage({ type: 'STATUS', payload: { status: 'loading', progress: 5 } });

        try {
          await initializeGemma(modelUrl);
        } catch (error) {
          const unavailableReason = error?.message || 'Gemma E2B initialization failed';
          await disposeGemma();
          console.error('[LiteRTGemmaWorker] Gemma E2B unavailable:', unavailableReason);
          self.postMessage({
            type: 'INIT_COMPLETE',
            id,
            payload: {
              ready: false,
              delegate: 'webgpu',
              engine: 'unavailable',
              cached: false,
              unavailableReason,
            },
          });
          break;
        }

        self.postMessage({
          type: 'INIT_COMPLETE',
          id,
          payload: {
            ready: true,
            delegate: 'webgpu',
            engine: 'litert_lm_gemma_e2b',
            cached: false,
            unavailableReason: '',
          },
        });
        break;
      }

      case 'EVALUATE_TRANSCRIPT': {
        const { transcript = '', studentUid, classId, timestamp = Date.now() } = payload || {};
        self.postMessage({ type: 'STATUS', payload: { status: 'evaluating' } });

        if (!gemmaEngine) {
          throw new Error('Gemma 4 E2B is not loaded');
        }

        let conversation = null;
        let evaluationResult;
        try {
          conversation = await gemmaEngine.createConversation();
          const response = await conversation.sendMessage(
            `${GEMMA_PROCTOR_SYSTEM_PROMPT}\n\nStudent transcript: "${transcript}"`
          );
          evaluationResult = parseGemmaOutput(getResponseText(response));
        } finally {
          await conversation?.delete?.();
        }

        self.postMessage({
          type: 'EVALUATION_COMPLETE',
          id,
          payload: {
            ...evaluationResult,
            engine: 'litert_lm_gemma_e2b',
            transcript,
            studentUid,
            classId,
            timestamp,
          },
        });
        break;
      }

      case 'DISPOSE': {
        await disposeGemma();
        self.postMessage({ type: 'DISPOSE_COMPLETE', id });
        break;
      }

      default:
        console.warn(`[LiteRTGemmaWorker] Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error(`[LiteRTGemmaWorker] Error processing ${type}:`, error);
    self.postMessage({
      type: 'ERROR',
      id,
      payload: {
        error: error.message || 'Gemma worker evaluation failed',
        type,
      },
    });
  }
};
