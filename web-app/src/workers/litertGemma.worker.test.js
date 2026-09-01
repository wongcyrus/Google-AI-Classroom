import { describe, it, expect } from 'vitest';
import {
  buildGemmaProctorPrompt,
  evaluateTranscriptHeuristic,
  parseGemmaOutput,
} from './litertGemma.worker';

describe('litertGemma.worker', () => {
  it('builds a structured Gemma proctor prompt formatted with chat tokens', () => {
    const prompt = buildGemmaProctorPrompt('What is the answer for question 4?');
    expect(prompt).toContain('<start_of_turn>user');
    expect(prompt).toContain('What is the answer for question 4?');
    expect(prompt).toContain('COLLUSION_EXAM');
    expect(prompt).toContain('<start_of_turn>model');
  });

  it('detects exam collusion in English (question / option questions)', () => {
    const result = evaluateTranscriptHeuristic('Hey Alice, what did you choose for question 3? Option B?');
    expect(result.isViolation).toBe(true);
    expect(result.category).toBe('COLLUSION_EXAM');
    expect(result.severity).toBe('critical');
    expect(result.evidence).toContain('question 3');
  });

  it('detects exam collusion in Cantonese code-switching (點解揀C, 話我知)', () => {
    const result = evaluateTranscriptHeuristic('喂，點解揀C嘅？話我知啦。');
    expect(result.isViolation).toBe(true);
    expect(result.category).toBe('COLLUSION_EXAM');
    expect(result.severity).toBe('critical');
  });

  it('detects exam collusion in Mandarin (這題答案是選A還是選B)', () => {
    const result = evaluateTranscriptHeuristic('請問第5題答案是選A還是選B？');
    expect(result.isViolation).toBe(true);
    expect(result.category).toBe('COLLUSION_EXAM');
    expect(result.severity).toBe('critical');
  });

  it('detects external voice assistant dictation (Hey Siri, calculate...)', () => {
    const result = evaluateTranscriptHeuristic('Hey Siri, search for the formula of variance');
    expect(result.isViolation).toBe(true);
    expect(result.category).toBe('EXTERNAL_AI_ASSIST');
    expect(result.severity).toBe('high');
  });

  it('recognizes legitimate technical inquiries as non-violations (teacher my screen is blank)', () => {
    const result = evaluateTranscriptHeuristic('Teacher, excuse me, my screen is completely blank.');
    expect(result.isViolation).toBe(false);
    expect(result.category).toBe('LEGITIMATE_INQUIRY');
    expect(result.severity).toBe('none');
  });

  it('recognizes legitimate Cantonese procedural questions (唔該阿sir我睇唔到個mon)', () => {
    const result = evaluateTranscriptHeuristic('唔該阿Sir，我個screen睇唔到題目。');
    expect(result.isViolation).toBe(false);
    expect(result.category).toBe('LEGITIMATE_INQUIRY');
    expect(result.severity).toBe('none');
  });

  it('recognizes normal ambient utterances as benign', () => {
    const result = evaluateTranscriptHeuristic('hmm... let me think.');
    expect(result.isViolation).toBe(false);
    expect(result.category).toBe('BENIGN');
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
});
