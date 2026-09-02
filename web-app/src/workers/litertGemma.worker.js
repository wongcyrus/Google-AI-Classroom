/**
 * litertGemma.worker.js
 * 
 * Background Web Worker executing Google LiteRT.js (@litertjs/core) Gemma LLM inference
 * for real-time exam speech transcript monitoring and intent classification.
 */

import { fetchGemmaWithProgress, checkGemmaHardwareAcceleration, DEFAULT_GEMMA_CONFIG } from '../utils/gemmaLiteRTLoader.js';

let compiledGemmaModel = null;
let activeDelegate = 'wasm';
let isReady = false;

/**
 * System prompt template for Gemma exam proctoring.
 */
export function buildGemmaProctorPrompt(transcript) {
  return `<start_of_turn>user
You are an AI Exam Proctor monitoring student spoken transcripts in real time.
Analyze the following transcript for exam cheating, collusion, or unauthorized communication.

Allowed Categories:
- COLLUSION_EXAM: Asking peers for answers, discussing exam questions, or sharing answers.
- EXTERNAL_AI_ASSIST: Dictating questions to voice assistants, phones, or search engines.
- UNAUTHORIZED_TALK: Off-topic conversation with peers during silent exam.
- LEGITIMATE_INQUIRY: Asking teacher or proctor for technical/procedural help (e.g. bathroom, screen freeze).
- BENIGN: Normal ambient utterance, self-reading, coughing, or silence.

Transcript: "${transcript}"

Respond ONLY with a valid JSON object in this exact format:
{
  "isViolation": boolean,
  "category": "COLLUSION_EXAM" | "EXTERNAL_AI_ASSIST" | "UNAUTHORIZED_TALK" | "LEGITIMATE_INQUIRY" | "BENIGN",
  "severity": "critical" | "high" | "medium" | "low" | "none",
  "confidence": number,
  "evidence": "quoted key phrase",
  "rationale": "short explanation"
}<end_of_turn>
<start_of_turn>model
`;
}

/**
 * Robust regex-assisted fallback evaluator for simulated/lightweight environments
 * or multilingual Cantonese/Mandarin/English code-switching phrases.
 * @param {string} text 
 * @returns {object}
 */
export function evaluateTranscriptHeuristic(text) {
  if (!text || typeof text !== 'string') {
    return {
      isViolation: false,
      category: 'BENIGN',
      severity: 'none',
      confidence: 1.0,
      evidence: '',
      rationale: 'No audible speech detected.',
    };
  }

  const clean = text.trim();
  const lower = clean.toLowerCase();

  // 1. Check for External Voice Assistant / AI Prompts First
  const aiAssistRegex = /(hey siri|siri|ok google|alexa|chatgpt|search for|google search|solve this|calculate integral|幫我search|幫我搵答案)/i;
  if (aiAssistRegex.test(lower)) {
    return {
      isViolation: true,
      category: 'EXTERNAL_AI_ASSIST',
      severity: 'high',
      confidence: 0.96,
      evidence: clean,
      rationale: 'Student appears to be dictating questions to an external voice assistant or search tool.',
    };
  }

  // 2. Check for Exam Collusion / Asking for answers (English + Cantonese + Mandarin)
  const collusionRegex = /(answer for|what did you choose|option a|option b|option c|option d|question 1|question 2|question 3|question 4|question 5|what is the answer|點解揀|話我知|第[0-9一二三四五六七八九十]+題|答案係|答案是|選a|選b|選c|選d|幾多號)/i;
  if (collusionRegex.test(lower) || collusionRegex.test(clean)) {
    return {
      isViolation: true,
      category: 'COLLUSION_EXAM',
      severity: 'critical',
      confidence: 0.95,
      evidence: clean,
      rationale: 'Student is actively asking for or discussing specific exam questions/options.',
    };
  }

  // 3. Check for Legitimate Inquiries (with boundary checks)
  const legitRegex = /(\bteacher\b|\bprof\b|\bproctor\b|\bsir\b|\bmiss\b|washroom|toilet|bathroom|screen|frozen|blank|can i|may i|唔該阿sir|阿sir|睇唔到|睇唔清|去洗手間|壞咗)/i;
  if (legitRegex.test(lower) && !/(answer|option|question|答案|揀)/i.test(lower)) {
    return {
      isViolation: false,
      category: 'LEGITIMATE_INQUIRY',
      severity: 'none',
      confidence: 0.94,
      evidence: clean,
      rationale: 'Student is raising a procedural or technical question with the instructor.',
    };
  }

  // 4. Check for General Unauthorized Talking
  const unauthorizedRegex = /(lunch|dinner|where are we|after exam|阵间|陣間|去邊|食飯|打機|game)/i;
  if (unauthorizedRegex.test(lower)) {
    return {
      isViolation: true,
      category: 'UNAUTHORIZED_TALK',
      severity: 'medium',
      confidence: 0.88,
      evidence: clean,
      rationale: 'Student is having an off-topic side conversation during the exam.',
    };
  }

  // 5. Default: Benign
  return {
    isViolation: false,
    category: 'BENIGN',
    severity: 'none',
    confidence: 0.85,
    evidence: '',
    rationale: 'Normal background utterance or self-talk.',
  };
}

/**
 * Parses raw Gemma text output into structured JSON with fallback resilience.
 * @param {string} rawText 
 * @param {string} originalTranscript 
 * @returns {object}
 */
export function parseGemmaOutput(rawText, originalTranscript) {
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.isViolation === 'boolean' && parsed.category) {
        return parsed;
      }
    }
  } catch {
    // Parse error: fall back to heuristic
  }
  return evaluateTranscriptHeuristic(originalTranscript);
}

/**
 * Handle incoming messages from the main React thread.
 */
self.onmessage = async (event) => {
  const { type, payload, id } = event.data;

  try {
    switch (type) {
      case 'INIT': {
        const { modelUrl = DEFAULT_GEMMA_CONFIG.modelUrl, modelBuffer: directBuffer } = payload || {};
        self.postMessage({ type: 'STATUS', payload: { status: 'loading', progress: 5 } });

        const hw = await checkGemmaHardwareAcceleration();
        activeDelegate = hw.delegate;

        let modelBuffer = directBuffer || null;
        if (!modelBuffer && modelUrl) {
          try {
            // Fetch model with streamed progress reporting if custom URL supplied
            modelBuffer = await fetchGemmaWithProgress(modelUrl, (progress) => {
              self.postMessage({ type: 'PROGRESS', payload: { progress } });
            });
          } catch (downloadErr) {
            // Fall back to on-device intent engine
          }
        }

        // Initialize LiteRT compiled model if buffer is available and @litertjs/core is supported
        if (modelBuffer) {
          try {
            const { loadLiteRt, loadAndCompile, getGlobalLiteRt } = await import('@litertjs/core');
            if (typeof loadLiteRt === 'function' && !getGlobalLiteRt()) {
              try {
                self.Module = self.Module || {};
                self.Module.locateFile = (fileName, scriptDirectory) => {
                  if (fileName.endsWith('.wasm')) {
                    return `/litert/${fileName}`;
                  }
                  return (scriptDirectory || '/litert/') + fileName;
                };
                await loadLiteRt('/litert/');
              } catch (loadErr) {
                if (!String(loadErr?.message).includes('already')) {
                  console.warn('[LiteRTGemmaWorker] Note on loadLiteRt:', loadErr?.message || loadErr);
                }
              }
            }
            if (typeof loadAndCompile === 'function') {
              compiledGemmaModel = await loadAndCompile(modelBuffer, {
                accelerator: activeDelegate === 'webgpu' ? 'webgpu' : 'wasm',
              });
            }
          } catch (e) {
            console.warn('[LiteRTGemmaWorker] Note on compiled model init:', e?.message || e);
          }
        }

        isReady = true;
        self.postMessage({
          type: 'INIT_COMPLETE',
          id,
          payload: {
            ready: true,
            delegate: activeDelegate,
            engine: compiledGemmaModel ? 'litert_compiled_gemma' : 'litert_ondevice_intent_engine',
            cached: Boolean(modelBuffer),
          },
        });
        break;
      }

      case 'EVALUATE_TRANSCRIPT': {
        const { transcript = '', studentUid, classId, timestamp = Date.now() } = payload || {};
        self.postMessage({ type: 'STATUS', payload: { status: 'evaluating' } });

        let evaluationResult;

        if (compiledGemmaModel && typeof compiledGemmaModel.run === 'function') {
          const prompt = buildGemmaProctorPrompt(transcript);
          const rawOutput = await compiledGemmaModel.run({ prompt });
          evaluationResult = parseGemmaOutput(rawOutput?.text || '', transcript);
        } else {
          // Fallback heuristic evaluator
          evaluationResult = evaluateTranscriptHeuristic(transcript);
        }

        self.postMessage({
          type: 'EVALUATION_COMPLETE',
          id,
          payload: {
            ...evaluationResult,
            transcript,
            studentUid,
            classId,
            timestamp,
          },
        });
        break;
      }

      case 'DISPOSE': {
        if (compiledGemmaModel && typeof compiledGemmaModel.unload === 'function') {
          await compiledGemmaModel.unload();
        }
        compiledGemmaModel = null;
        isReady = false;
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
