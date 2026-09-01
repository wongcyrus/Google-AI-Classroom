import { describe, it, expect } from 'vitest';
import { extractAudioFeatures, classifyLanguage, CODE_SWITCHING_ANCHORS } from './litertWhisper.worker';

describe('litertWhisper.worker', () => {
  it('extracts and normalizes 16kHz audio features into target 30s buffer', () => {
    const pcm = new Float32Array(16000); // 1 second of audio
    pcm.fill(0.5);

    const features = extractAudioFeatures(pcm);
    expect(features).toBeInstanceOf(Float32Array);
    expect(features.length).toBe(480000); // 30s * 16000
    expect(features[0]).toBe(0.5);
    expect(features[16001]).toBe(0); // Padded with 0s
  });

  it('classifies mixed code-switching Cantonese and English', () => {
    const mixedText = '點解 question 3 嘅答案係 option B?';
    const lang = classifyLanguage(mixedText);
    expect(lang).toBe('mixed');
  });

  it('classifies pure Cantonese text', () => {
    const yueText = '唔該你幫我睇睇呢個題目。';
    const lang = classifyLanguage(yueText);
    expect(lang).toBe('cantonese');
  });

  it('classifies pure Mandarin text', () => {
    const zhText = '這個考試的答案是什麼？';
    const lang = classifyLanguage(zhText);
    expect(lang).toBe('mandarin');
  });

  it('classifies pure English text', () => {
    const enText = 'What is the answer for question five?';
    const lang = classifyLanguage(enText);
    expect(lang).toBe('english');
  });

  it('contains Cantonese/Mandarin anchor keywords for prompt biasing', () => {
    expect(CODE_SWITCHING_ANCHORS).toContain('唔該');
    expect(CODE_SWITCHING_ANCHORS).toContain('點解');
    expect(CODE_SWITCHING_ANCHORS).toContain('exam');
  });
});
