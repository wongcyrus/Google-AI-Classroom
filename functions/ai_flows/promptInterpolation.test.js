import { describe, it, expect } from 'vitest';
import { interpolatePromptPlaceholders } from './promptInterpolation.js';

describe('interpolatePromptPlaceholders', () => {
  it('handles null, undefined, or empty templates gracefully', () => {
    expect(interpolatePromptPlaceholders(null)).toBe('');
    expect(interpolatePromptPlaceholders(undefined)).toBe('');
    expect(interpolatePromptPlaceholders('')).toBe('');
  });

  it('interpolates video parameters including captureInterval, frameRate, student info, and times', () => {
    const template = 'Class: {{classId}}, Interval: {{captureInterval}}s ({{frameRate}}s, {{intervalMinutes}}m), Student: {{studentEmail}} ({{studentUid}}), Window: {{startTime}} to {{endTime}}';
    const context = {
      classId: 'itp4124-l',
      captureInterval: 30,
      studentEmail: 'test@school.edu',
      studentUid: 'uid123',
      startTime: '2026-10-11T09:00:00Z',
      endTime: '2026-10-11T12:00:00Z',
    };

    const result = interpolatePromptPlaceholders(template, context);
    expect(result).toBe('Class: itp4124-l, Interval: 30s (30s, 0.5m), Student: test@school.edu (uid123), Window: 2026-10-11T09:00:00Z to 2026-10-11T12:00:00Z');
  });

  it('defaults captureInterval to 15 if not provided or non-positive', () => {
    const template = 'Rate: {{captureInterval}}s';
    expect(interpolatePromptPlaceholders(template, {})).toBe('Rate: 15s');
    expect(interpolatePromptPlaceholders(template, { captureInterval: -5 })).toBe('Rate: 15s');
  });

  it('tolerates spaces inside placeholders e.g. {{ captureInterval }}', () => {
    const template = 'Interval is {{  captureInterval  }} seconds.';
    expect(interpolatePromptPlaceholders(template, { captureInterval: 20 })).toBe('Interval is 20 seconds.');
  });
});
