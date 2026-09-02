/**
 * whisperTokenizer.js
 * On-device subword and vocabulary decoder for Whisper models.
 */

const WHISPER_SPECIAL_TOKEN_START = 50257;

function createByteDecoder() {
  const bytes = [];
  for (let value = 33; value <= 126; value++) bytes.push(value);
  for (let value = 161; value <= 172; value++) bytes.push(value);
  for (let value = 174; value <= 255; value++) bytes.push(value);

  const codePoints = [...bytes];
  let extraCodePoint = 256;
  for (let value = 0; value < 256; value++) {
    if (!bytes.includes(value)) {
      bytes.push(value);
      codePoints.push(extraCodePoint++);
    }
  }

  return new Map(codePoints.map((codePoint, index) => [
    String.fromCodePoint(codePoint),
    bytes[index],
  ]));
}

const BYTE_DECODER = createByteDecoder();

/**
 * Decodes Whisper output token IDs using its GPT-2 byte-level vocabulary.
 * @param {number[] | Int32Array | string} tokenIds
 * @param {string[]} vocabulary
 * @returns {string}
 */
export function decodeWhisperTokens(tokenIds, vocabulary = []) {
  if (!tokenIds) return '';
  if (typeof tokenIds === 'string') return tokenIds.trim();

  const tokens = Array.from(tokenIds).map(value => Math.round(value));
  const byteValues = [];

  for (const tokenId of tokens) {
    if (tokenId >= WHISPER_SPECIAL_TOKEN_START) continue;
    const token = vocabulary[tokenId];
    if (!token) continue;

    for (const character of token) {
      const byte = BYTE_DECODER.get(character);
      if (byte !== undefined) {
        byteValues.push(byte);
      }
    }
  }

  return Array.from(new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(byteValues)))
    .filter(character => {
      const codePoint = character.codePointAt(0);
      return codePoint === 9 || codePoint === 10 || codePoint === 13 ||
        (codePoint >= 32 && codePoint !== 127);
    })
    .join('')
    .trim();
}
