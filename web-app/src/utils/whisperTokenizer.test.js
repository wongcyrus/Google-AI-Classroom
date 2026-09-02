import { describe, expect, it } from 'vitest';
import { decodeWhisperTokens } from './whisperTokenizer';

describe('decodeWhisperTokens', () => {
  it('decodes Whisper byte-level vocabulary tokens and skips special tokens', () => {
    const vocabulary = [];
    vocabulary[0] = 'H';
    vocabulary[1] = 'i';
    vocabulary[2] = 'Ġ';

    expect(decodeWhisperTokens(
      new Int32Array([50258, 0, 1, 2, 50257]),
      vocabulary
    )).toBe('Hi');
  });
});
