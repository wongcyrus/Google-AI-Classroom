import { describe, it, expect } from 'vitest';
import { downsamplePcmTo16k, decodeAudioBlobToPcm } from './audioDecoder';

describe('audioDecoder Utility', () => {
  it('returns empty Float32Array for empty or null buffer in downsamplePcmTo16k', () => {
    expect(downsamplePcmTo16k(null, 48000)).toEqual(new Float32Array(0));
    expect(downsamplePcmTo16k(new Float32Array(0), 48000)).toEqual(new Float32Array(0));
  });

  it('returns exact copy if inputSampleRate is already 16000', () => {
    const input = new Float32Array([0.1, -0.2, 0.5, 0.0]);
    const resampled = downsamplePcmTo16k(input, 16000, 16000);
    expect(resampled.length).toBe(input.length);
    expect(resampled[0]).toBeCloseTo(0.1);
    expect(resampled[1]).toBeCloseTo(-0.2);
    expect(resampled[2]).toBeCloseTo(0.5);
    expect(resampled[3]).toBeCloseTo(0.0);
  });

  it('correctly downsamples 48000Hz PCM to 16000Hz PCM (3x reduction)', () => {
    const input = new Float32Array(4800); // 0.1s at 48kHz
    for (let i = 0; i < input.length; i++) {
      input[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
    }

    const resampled = downsamplePcmTo16k(input, 48000, 16000);
    expect(resampled.length).toBe(1600); // 0.1s at 16kHz
    expect(resampled[0]).toBeCloseTo(0, 1);
  });

  it('correctly downsamples 44100Hz PCM to 16000Hz PCM', () => {
    const input = new Float32Array(4410); // 0.1s at 44.1kHz
    for (let i = 0; i < input.length; i++) {
      input[i] = 0.5;
    }

    const resampled = downsamplePcmTo16k(input, 44100, 16000);
    expect(resampled.length).toBe(1600);
    expect(resampled[100]).toBeCloseTo(0.5);
  });

  it('handles null or invalid blob safely in decodeAudioBlobToPcm', async () => {
    const result = await decodeAudioBlobToPcm(null);
    expect(result).toBeNull();
  });
});
