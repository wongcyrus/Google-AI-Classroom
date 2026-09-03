import { describe, expect, it } from 'vitest';
import { getStudentVoiceStatus } from './studentVoiceStatus';

describe('getStudentVoiceStatus', () => {
  it('preserves live transcript and Gemma fields from a student status document', () => {
    expect(getStudentVoiceStatus({
      liveTranscript: '你做緊乜嘢呀',
      liveTranscriptTimestamp: 1234,
      speechLanguage: 'zh-HK',
      gemmaAlert: 'UNAUTHORIZED_TALK',
      gemmaSeverity: 'medium',
      gemmaConfidence: 0.87,
    })).toEqual({
      liveTranscript: '你做緊乜嘢呀',
      liveTranscriptTimestamp: 1234,
      speechLanguage: 'zh-HK',
      gemmaAlert: 'UNAUTHORIZED_TALK',
      gemmaSeverity: 'medium',
      gemmaConfidence: 0.87,
    });
  });
});
