/**
 * whisperTokenizer.js
 * On-device subword and vocabulary decoder for Whisper models.
 */

// Basic common token mappings for Whisper
const SPECIAL_TOKENS = new Set([
  50257, // <|endoftext|>
  50258, // <|startoftranscript|>
  50259, // <|en|>
  50260, // <|zh|>
  50358, // <|notimestamps|>
  50359, // <|transcribe|>
]);

/**
 * Decodes Whisper output (token IDs, Float32Array logits, or string) into clean readable text.
 * @param {number[] | Float32Array | Int32Array | string} tokenIds 
 * @returns {string}
 */
export function decodeWhisperTokens(tokenIds) {
  if (!tokenIds) return '';
  if (typeof tokenIds === 'string') return tokenIds.trim();

  let tokens = [];

  // If input is Float32Array logits or nested array, extract sequence
  if (tokenIds instanceof Float32Array || (Array.isArray(tokenIds) && typeof tokenIds[0] === 'number')) {
    tokens = Array.from(tokenIds);
  } else if (Array.isArray(tokenIds) && Array.isArray(tokenIds[0])) {
    // 2D logits: compute argmax across vocab dimension for each time frame
    tokens = tokenIds.map(frame => {
      let maxIdx = 0;
      let maxVal = -Infinity;
      for (let i = 0; i < frame.length; i++) {
        if (frame[i] > maxVal) {
          maxVal = frame[i];
          maxIdx = i;
        }
      }
      return maxIdx;
    });
  } else if (tokenIds && typeof tokenIds === 'object') {
    const vals = Object.values(tokenIds);
    if (vals.length && typeof vals[0] === 'number') {
      tokens = vals;
    }
  }

  if (!tokens.length) return '';

  const cleanTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    const tid = Math.round(tokens[i]);
    if (!SPECIAL_TOKENS.has(tid) && tid > 0) {
      cleanTokens.push(tid);
    }
  }

  if (!cleanTokens.length) return '';

  try {
    const bytes = new Uint8Array(cleanTokens.length);
    for (let i = 0; i < cleanTokens.length; i++) {
      bytes[i] = cleanTokens[i] % 256;
    }
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/[\x00-\x1F\x7F]/g, '').trim();
    if (decoded && decoded.length > 0) {
      return decoded;
    }
  } catch {}

  return '';
}
