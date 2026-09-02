import { describe, it, expect } from 'vitest';
import {
  buildGemmaProctorPrompt,
  parseGemmaOutput,
  resolveLiteRtLmWasmUrl,
} from './litertGemma.worker';

describe('litertGemma.worker', () => {
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
});
