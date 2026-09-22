import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGemmaEvaluationPrompt,
  buildGemmaProctorPrompt,
  buildGemmaTranslationPrompt,
  parseGemmaTranslationOutput,
  getGemmaModelResponse,
  parseGemmaOutput,
  resolveLiteRtLmWasmUrl,
} from './litertGemma.worker';

describe('litertGemma.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    self.postMessage = vi.fn();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await self.onmessage?.({ data: { type: 'DISPOSE', id: 'teardown' } });
  });

  it('builds a structured Gemma proctor prompt formatted with chat tokens', () => {
    const prompt = buildGemmaProctorPrompt('What is the answer for question 4?');
    expect(prompt).toContain('<start_of_turn>user');
    expect(prompt).toContain('What is the answer for question 4?');
    expect(prompt).toContain('COLLUSION_EXAM');
    expect(prompt).toContain('<start_of_turn>model');
  });

  it('parses valid JSON output from Gemma model correctly', () => {
    const validJson = JSON.stringify({
      isViolation: true,
      category: 'COLLUSION_EXAM',
      severity: 'critical',
      confidence: 0.98,
      evidence: 'what is answer',
      rationale: 'Discussing exam question',
    });
    const parsed = parseGemmaOutput(validJson, 'what is answer');
    expect(parsed.isViolation).toBe(true);
    expect(parsed.category).toBe('COLLUSION_EXAM');
  });

  it('normalizes common Gemma formatting without changing its classification', () => {
    const parsed = parseGemmaOutput(`\`\`\`json
{"isViolation":false,"category":"benign","severity":"NONE","confidence":"94%","evidence":"","rationale":"Self-talk"}
\`\`\``);

    expect(parsed).toMatchObject({
      isViolation: false,
      category: 'BENIGN',
      severity: 'none',
      confidence: 0.94,
    });
  });

  it('preserves custom instructions while enforcing the evaluation output contract', () => {
    const prompt = buildGemmaEvaluationPrompt({
      transcript: 'Can you tell me the answer?',
      systemPrompt: 'Focus on collaboration and use class {{classId}}.',
      classId: 'CLASS_TEST',
      studentUid: 'student_1',
      studentEmail: 'student@example.com',
    });

    expect(prompt).toContain('Focus on collaboration and use class CLASS_TEST.');
    expect(prompt).toContain('Student transcript: "Can you tell me the answer?"');
    expect(prompt).toContain('"isViolation":boolean');
    expect(prompt).toContain('Respond with only one JSON object and no markdown');
  });

  it('rejects invalid Gemma output instead of applying rule-based classification', () => {
    expect(() => parseGemmaOutput('not valid JSON')).toThrow(
      'Gemma returned an invalid evaluation payload'
    );
  });

  it('rejects incomplete JSON instead of filling fields with fallback values', () => {
    expect(() => parseGemmaOutput(
      '{"isViolation":false,"category":"BENIGN"}'
    )).toThrow('Gemma returned an invalid evaluation payload');
  });

  it('resolves LiteRT-LM WASM beside the versioned CDN runtime', () => {
    expect(resolveLiteRtLmWasmUrl('litertlm_wasm_asyncify_internal.wasm')).toBe(
      'https://cdn.jsdelivr.net/npm/@litert-lm/core@0.15.0/wasm/litertlm_wasm_asyncify_internal.wasm'
    );
  });

  it('loads Gemma from CacheStorage without downloading it again', async () => {
    const cachedResponse = new Response('cached-gemma-model');
    const match = vi.fn().mockResolvedValue(cachedResponse);
    const open = vi.fn().mockResolvedValue({ match });
    const originalCaches = globalThis.caches;
    globalThis.caches = { open };
    globalThis.fetch = vi.fn();

    try {
      const result = await getGemmaModelResponse('https://example.com/gemma-model.bin');

      expect(open).toHaveBeenCalledWith('webai-litert-gemma-v1');
      expect(match).toHaveBeenCalledWith('https://example.com/gemma-model.bin');
      expect(result.response).toBe(cachedResponse);
      expect(result.fromCache).toBe(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
    } finally {
      globalThis.caches = originalCaches;
    }
  });

  it('handles onmessage lifecycle for INIT, EVALUATE_TRANSCRIPT, DISPOSE and errors', async () => {
    const messages = [];
    self.postMessage = vi.fn((msg) => messages.push(msg));

    // 1. Unknown message
    await self.onmessage({ data: { type: 'UNKNOWN_OP', id: '1' } });

    // 2. Evaluate before init throws error
    await self.onmessage({
      data: {
        type: 'EVALUATE_TRANSCRIPT',
        id: '2',
        payload: { transcript: 'hello' }
      }
    });
    expect(messages.some(m => m.type === 'ERROR' && m.id === '2')).toBe(true);

    // 3. Dispose
    await self.onmessage({ data: { type: 'DISPOSE', id: '3' } });
    expect(messages.some(m => m.type === 'DISPOSE_COMPLETE' && m.id === '3')).toBe(true);
  });

  it('initializes Gemma engine and evaluates transcript with custom prompt', async () => {
    const messages = [];
    self.postMessage = vi.fn((msg) => messages.push(msg));
    Object.defineProperty(navigator, 'gpu', { value: {}, configurable: true });

    const mockResponsePayload = {
      isViolation: true,
      category: 'UNAUTHORIZED_TALK',
      severity: 'medium',
      confidence: 0.92,
      evidence: 'talking to neighbor',
      rationale: 'Side talk detected',
    };

    const mockConversation = {
      sendMessage: vi.fn().mockResolvedValue({
        content: JSON.stringify(mockResponsePayload),
      }),
      delete: vi.fn().mockResolvedValue(),
    };

    const mockEngine = {
      createConversation: vi.fn().mockResolvedValue(mockConversation),
      delete: vi.fn().mockResolvedValue(),
    };

    const EngineMock = await import('@litert-lm/core');
    EngineMock.Engine.create = vi.fn().mockResolvedValue(mockEngine);

    // Mock fetch for model streaming
    let readCount = 0;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '100' }),
      body: {
        getReader: () => ({
          read: vi.fn().mockImplementation(async () => {
            if (readCount++ === 0) {
              return { done: false, value: new Uint8Array(50) };
            }
            return { done: true, value: undefined };
          }),
          cancel: vi.fn(),
        }),
      },
    });

    // 1. INIT
    await self.onmessage({
      data: {
        type: 'INIT',
        id: 'init_1',
        payload: { modelUrl: 'https://example.com/gemma-model.bin' },
      },
    });

    const initComplete = messages.find((m) => m.type === 'INIT_COMPLETE' && m.id === 'init_1');
    expect(initComplete).toBeDefined();
    expect(initComplete.payload.ready).toBe(true);

    // 2. EVALUATE_TRANSCRIPT with custom systemPrompt
    await self.onmessage({
      data: {
        type: 'EVALUATE_TRANSCRIPT',
        id: 'eval_1',
        payload: {
          transcript: 'hey buddy give me the answer',
          studentUid: 'student_1',
          classId: 'IT114115-Demo',
          systemPrompt: 'Custom proctor prompt instructions',
        },
      },
    });

    const evalComplete = messages.find((m) => m.type === 'EVALUATION_COMPLETE' && m.id === 'eval_1');
    expect(evalComplete).toBeDefined();
    expect(evalComplete.payload.isViolation).toBe(true);
    expect(evalComplete.payload.category).toBe('UNAUTHORIZED_TALK');
    expect(evalComplete.payload.studentUid).toBe('student_1');
    expect(mockConversation.sendMessage).toHaveBeenCalledWith(
      expect.stringContaining('"isViolation":boolean')
    );

    // 3. TRANSLATE_TRANSCRIPT
    mockConversation.sendMessage.mockResolvedValueOnce({
      content: '{"en":"Today we demonstrate React useState"}',
    });
    await self.onmessage({
      data: {
        type: 'TRANSLATE_TRANSCRIPT',
        id: 'trans_1',
        payload: {
          transcript: '今日我哋示範 React useState',
          sourceLang: 'zh-HK',
          targetLangs: ['en'],
        },
      },
    });
    const transComplete = messages.find((m) => m.type === 'TRANSLATE_COMPLETE' && m.id === 'trans_1');
    expect(transComplete).toBeDefined();
    expect(transComplete.payload.translations.en).toBe('Today we demonstrate React useState');

    // 4. DISPOSE
    await self.onmessage({ data: { type: 'DISPOSE', id: 'disp_1' } });
    expect(mockEngine.delete).toHaveBeenCalled();
  });

  it('posts INIT_COMPLETE with ready: false when engine initialization fails', async () => {
    const messages = [];
    self.postMessage = vi.fn((msg) => messages.push(msg));

    const EngineMock = await import('@litert-lm/core');
    EngineMock.Engine.create = vi.fn().mockRejectedValue(new Error('WebGPU unavailable on this machine'));

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '100' }),
      body: {
        getReader: () => ({
          read: vi.fn().mockResolvedValue({ done: true }),
          cancel: vi.fn(),
        }),
      },
    });

    await self.onmessage({
      data: {
        type: 'INIT',
        id: 'init_err',
        payload: { modelUrl: 'https://example.com/gemma-model.bin' },
      },
    });

    const initFail = messages.find((m) => m.type === 'INIT_COMPLETE' && m.id === 'init_err');
    expect(initFail).toBeDefined();
    expect(initFail.payload.ready).toBe(false);
    expect(initFail.payload.unavailableReason).toContain('WebGPU unavailable');
  });

  it('builds a multilingual lecture translation prompt preserving technical terms', () => {
    const prompt = buildGemmaTranslationPrompt({
      transcript: '今日我哋示範 React useState 同埋 Docker deploy',
      sourceLang: 'zh-HK',
      targetLangs: ['en', 'zh-Hant', 'ja'],
    });

    expect(prompt).toContain('Cantonese (Hong Kong');
    expect(prompt).toContain('- "en": English');
    expect(prompt).toContain('- "zh-Hant": Traditional Chinese');
    expect(prompt).toContain('- "ja": Japanese');
    expect(prompt).toContain('Preserve discipline-specific terminology, proper nouns');
    expect(prompt).toContain('今日我哋示範 React useState 同埋 Docker deploy');
  });

  it('builds translation prompt with custom courseContext and special instructions', () => {
    const prompt = buildGemmaTranslationPrompt({
      transcript: '今日講下護理評估程序',
      sourceLang: 'zh-HK',
      targetLangs: ['en'],
      courseContext: 'Healthcare, Nursing & Medical Sciences',
      customPrompt: 'Keep medical terms like CPR and ECG in English.',
    });

    expect(prompt).toContain('Healthcare, Nursing & Medical Sciences');
    expect(prompt).toContain('Keep medical terms like CPR and ECG in English.');
    expect(prompt).toContain('今日講下護理評估程序');
  });

  it('parses structured JSON translation output from Gemma', () => {
    const mockOutput = '{"en":"Today we demonstrate React useState and Docker deploy","ja":"本日はReact useStateとDocker deployを実演します"}';
    const parsed = parseGemmaTranslationOutput(mockOutput, ['en', 'ja']);
    expect(parsed.en).toBe('Today we demonstrate React useState and Docker deploy');
    expect(parsed.ja).toBe('本日はReact useStateとDocker deployを実演します');
  });

  it('interpolates template placeholders when custom translation prompt contains {{transcript}}', () => {
    const libraryPromptTemplate = `Translate {{sourceLang}} into:
{{targetLangs}}
Context: {{courseContext}}
Spoken: "{{transcript}}"`;

    const prompt = buildGemmaTranslationPrompt({
      transcript: '講下微積分同矩陣運算',
      sourceLang: 'zh-HK',
      targetLangs: ['en'],
      courseContext: 'Mathematics & Linear Algebra',
      customPrompt: libraryPromptTemplate,
    });

    expect(prompt).toContain('Translate Cantonese (Hong Kong');
    expect(prompt).toContain('Context: Mathematics & Linear Algebra');
    expect(prompt).toContain('Spoken: "講下微積分同矩陣運算"');
    expect(prompt).toContain('<start_of_turn>user');
    expect(prompt).toContain('<start_of_turn>model');
  });

  it('prevents duplicating category instructions in buildGemmaEvaluationPrompt when already present', () => {
    const fullProctorPrompt = `# Custom Proctor
You are an AI exam proctor.
Use exactly one category:
- COLLUSION_EXAM
- BENIGN
Respond with only one JSON object:
{"isViolation":boolean}`;

    const prompt = buildGemmaEvaluationPrompt({
      transcript: 'Can you give me question 3 answer?',
      systemPrompt: fullProctorPrompt,
      classId: 'class_1',
      studentUid: 'student_1',
      studentEmail: 'student1@stu.vtc.edu.hk',
    });

    // Should only occur once, not duplicated
    const matches = prompt.match(/Use exactly one category:/g);
    expect(matches).toHaveLength(1);
    expect(prompt).toContain('Can you give me question 3 answer?');
  });
});

