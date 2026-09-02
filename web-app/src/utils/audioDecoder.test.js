import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { downsamplePcmTo16k, decodeAudioBlobToPcm } from './audioDecoder';

describe('audioDecoder Utility', () => {
  let originalAudioContext;

  beforeEach(() => {
    originalAudioContext = window.AudioContext;
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    vi.restoreAllMocks();
  });

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
    expect(await decodeAudioBlobToPcm(null)).toBeNull();
    expect(await decodeAudioBlobToPcm('not a blob')).toBeNull();
  });

  it('returns null if arrayBuffer is empty', async () => {
    const blob = new Blob([], { type: 'audio/webm' });
    vi.spyOn(blob, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(0));
    expect(await decodeAudioBlobToPcm(blob)).toBeNull();
  });

  it('decodes mono 16kHz audio directly without resampling', async () => {
    const channelData = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const mockAudioBuffer = {
      numberOfChannels: 1,
      sampleRate: 16000,
      length: 4,
      getChannelData: vi.fn(() => channelData),
    };

    const mockClose = vi.fn().mockResolvedValue();
    window.AudioContext = class {
      constructor() {
        this.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);
        this.close = mockClose;
        this.state = 'running';
      }
    };

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const pcm = await decodeAudioBlobToPcm(blob, 16000);

    expect(pcm).toBe(channelData);
    expect(mockClose).toHaveBeenCalled();
  });

  it('decodes and resamples stereo 48kHz audio to 16kHz mono', async () => {
    const leftData = new Float32Array([0.2, 0.4, 0.6]);
    const rightData = new Float32Array([0.4, 0.6, 0.8]);
    const mockAudioBuffer = {
      numberOfChannels: 2,
      sampleRate: 48000,
      length: 3,
      getChannelData: vi.fn((ch) => (ch === 0 ? leftData : rightData)),
    };

    const mockClose = vi.fn().mockResolvedValue();
    window.AudioContext = class {
      constructor() {
        this.decodeAudioData = vi.fn().mockResolvedValue(mockAudioBuffer);
        this.close = mockClose;
        this.state = 'running';
      }
    };

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const pcm = await decodeAudioBlobToPcm(blob, 16000);

    expect(pcm).toBeInstanceOf(Float32Array);
    expect(pcm.length).toBe(1);
    expect(pcm[0]).toBeCloseTo(0.3);
    expect(mockClose).toHaveBeenCalled();
  });

  it('returns null and catches decode error when decodeAudioData fails', async () => {
    window.AudioContext = class {
      constructor() {
        this.decodeAudioData = vi.fn().mockRejectedValue(new Error('Corrupt audio data'));
        this.close = vi.fn();
        this.state = 'running';
      }
    };

    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    const pcm = await decodeAudioBlobToPcm(blob);

    expect(pcm).toBeNull();
  });
});
