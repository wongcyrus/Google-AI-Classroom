import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildGemmaProctorPrompt,
  parseGemmaOutput,
  resolveLiteRtLmWasmUrl,
} from './litertGemma.worker';

describe('litertGemma.worker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

    // 3. DISPOSE
    await self.onmessage({ data: { type: 'DISPOSE', id: 'disp_1' } });
    expect(mockEngine.delete).toHaveBeenCalled();
  });
});
