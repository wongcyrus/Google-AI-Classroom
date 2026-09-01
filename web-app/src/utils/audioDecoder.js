/**
 * audioDecoder.js
 * Utility to decode audio Blobs (WebM/Opus/WAV) to 16kHz Float32Array PCM for on-device LiteRT Whisper.
 */

export async function decodeAudioBlobToPcm(blob, targetSampleRate = 16000) {
  if (!blob || !(blob instanceof Blob)) return null;

  if (typeof window === 'undefined' || (!window.AudioContext && !window.webkitAudioContext)) {
    return null;
  }

  try {
    const arrayBuffer = await blob.arrayBuffer();
    if (!arrayBuffer || arrayBuffer.byteLength === 0) return null;

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioCtx = new AudioContextClass();

    try {
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      
      // Resample / Extract mono channel data
      const numChannels = audioBuffer.numberOfChannels;
      const originalRate = audioBuffer.sampleRate;
      const originalLength = audioBuffer.length;
      
      // If same sample rate, return mono channel directly
      if (originalRate === targetSampleRate && numChannels === 1) {
        return audioBuffer.getChannelData(0);
      }

      // Linear interpolation resampling to targetSampleRate
      const targetLength = Math.round((originalLength * targetSampleRate) / originalRate);
      const resampledPcm = new Float32Array(targetLength);
      const leftChannel = audioBuffer.getChannelData(0);
      const rightChannel = numChannels > 1 ? audioBuffer.getChannelData(1) : null;

      for (let i = 0; i < targetLength; i++) {
        const originalIndex = (i * originalRate) / targetSampleRate;
        const indexPrev = Math.floor(originalIndex);
        const indexNext = Math.min(indexPrev + 1, originalLength - 1);
        const fraction = originalIndex - indexPrev;

        let samplePrev = leftChannel[indexPrev];
        let sampleNext = leftChannel[indexNext];

        if (rightChannel) {
          samplePrev = (samplePrev + rightChannel[indexPrev]) / 2;
          sampleNext = (sampleNext + rightChannel[indexNext]) / 2;
        }

        resampledPcm[i] = samplePrev + fraction * (sampleNext - samplePrev);
      }

      return resampledPcm;
    } finally {
      if (audioCtx && audioCtx.state !== 'closed' && typeof audioCtx.close === 'function') {
        try {
          await audioCtx.close();
        } catch {}
      }
    }
  } catch (err) {
    console.debug('[audioDecoder] Audio decode error:', err);
    return null;
  }
}

/**
 * Resample a Float32Array PCM chunk from inputSampleRate to targetSampleRate (default 16000Hz).
 * @param {Float32Array} buffer
 * @param {number} inputSampleRate
 * @param {number} targetSampleRate
 * @returns {Float32Array}
 */
export function downsamplePcmTo16k(buffer, inputSampleRate = 48000, targetSampleRate = 16000) {
  if (!buffer || buffer.length === 0) return new Float32Array(0);
  if (inputSampleRate === targetSampleRate) {
    return new Float32Array(buffer);
  }

  const sampleRateRatio = inputSampleRate / targetSampleRate;
  const targetLength = Math.round(buffer.length / sampleRateRatio);
  const result = new Float32Array(targetLength);

  for (let i = 0; i < targetLength; i++) {
    const originalIndex = i * sampleRateRatio;
    const indexPrev = Math.floor(originalIndex);
    const indexNext = Math.min(indexPrev + 1, buffer.length - 1);
    const fraction = originalIndex - indexPrev;

    const samplePrev = buffer[indexPrev];
    const sampleNext = buffer[indexNext];

    result[i] = samplePrev + fraction * (sampleNext - samplePrev);
  }

  return result;
}

