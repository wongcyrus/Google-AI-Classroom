import { describe, it, expect, vi } from 'vitest';
import {
  extractAudioFeatures,
  classifyLanguage,
  compileWhisperModel,
  isValidWhisperTokenSequence,
  CODE_SWITCHING_ANCHORS,
} from './litertWhisper.worker';

describe('litertWhisper.worker', () => {
  it('extracts normalized Whisper log-Mel features', () => {
    const pcm = new Float32Array(16000); // 1 second of audio
    pcm.fill(0.5);

    const features = extractAudioFeatures(pcm);
    expect(features).toBeInstanceOf(Float32Array);
    expect(features.length).toBe(80 * 3000);
    expect(features.every(Number.isFinite)).toBe(true);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (const feature of features) {
      minimum = Math.min(minimum, feature);
      maximum = Math.max(maximum, feature);
    }
    expect(maximum).toBeGreaterThan(minimum);
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

  it('retries dynamic Whisper model compilation with WASM when WebGPU fails', async () => {
    const wasmModel = { getInputDetails: vi.fn() };
    const loadAndCompile = vi.fn()
      .mockRejectedValueOnce(new Error('dynamic-sized tensors are unsupported'))
      .mockResolvedValueOnce(wasmModel);
    const modelBuffer = new ArrayBuffer(8);

    const result = await compileWhisperModel(loadAndCompile, modelBuffer, 'webgpu');

    expect(loadAndCompile).toHaveBeenNthCalledWith(
      1,
      expect.any(Uint8Array),
      { accelerator: 'webgpu' }
    );
    expect(loadAndCompile).toHaveBeenNthCalledWith(
      2,
      expect.any(Uint8Array),
      { accelerator: 'wasm' }
    );
    expect(result).toEqual({ model: wasmModel, delegate: 'wasm' });
  });

  it('rejects invalid dynamic output instead of decoding allocation garbage', () => {
    expect(isValidWhisperTokenSequence(
      new Int32Array([4, 0, 0, 0, 3, 220, 5, 6])
    )).toBe(false);
    expect(isValidWhisperTokenSequence(
      new Int32Array([50258, 50260, 50359, 50363, 15947])
    )).toBe(true);
  });
});
