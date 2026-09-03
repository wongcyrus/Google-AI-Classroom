import { describe, expect, it } from 'vitest';
import {
  allowsCloudVoiceAi,
  allowsLocalVoiceAi,
  shouldSendTranscriptToCloud,
  shouldRunCloudVoiceFallback,
} from './voiceAiPolicy';

describe('voiceAiPolicy', () => {
  it('keeps client and cloud execution aligned with the teacher mode', () => {
    expect(allowsLocalVoiceAi('client_only')).toBe(true);
    expect(allowsCloudVoiceAi('client_only')).toBe(false);
    expect(allowsLocalVoiceAi('cloud_only')).toBe(false);
    expect(allowsCloudVoiceAi('cloud_only')).toBe(true);
    expect(allowsLocalVoiceAi('disabled')).toBe(false);
    expect(allowsCloudVoiceAi('disabled')).toBe(false);
  });

  it('applies the configured cloud fallback chunk cadence', () => {
    const settings = {
      mode: 'hybrid',
      fallbackRate: 3,
      hasLocalTranscript: false,
      hasAudioUrl: true,
    };

    expect(shouldRunCloudVoiceFallback({ ...settings, strideIndex: 1 })).toBe(false);
    expect(shouldRunCloudVoiceFallback({ ...settings, strideIndex: 2 })).toBe(false);
    expect(shouldRunCloudVoiceFallback({ ...settings, strideIndex: 3 })).toBe(true);
  });

  it('never calls cloud when local STT succeeded or client-only is selected', () => {
    expect(shouldRunCloudVoiceFallback({
      mode: 'hybrid',
      fallbackRate: 1,
      strideIndex: 1,
      hasLocalTranscript: true,
      hasAudioUrl: true,
    })).toBe(false);
    expect(shouldRunCloudVoiceFallback({
      mode: 'client_only',
      fallbackRate: 1,
      strideIndex: 1,
      hasLocalTranscript: false,
      hasAudioUrl: true,
    })).toBe(false);
  });

  it('sends existing transcripts to cloud in cloud-enabled modes', () => {
    expect(shouldSendTranscriptToCloud('hybrid')).toBe(true);
    expect(shouldSendTranscriptToCloud('cloud_only')).toBe(true);
    expect(shouldSendTranscriptToCloud('client_only')).toBe(false);
    expect(shouldSendTranscriptToCloud('disabled')).toBe(false);
  });
});
