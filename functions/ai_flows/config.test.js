import { describe, it, expect } from 'vitest';
import {
  deriveUserRole,
  getAllowedEmailDomainsDescription,
  FUNCTION_REGION,
  CORS_ORIGINS,
  AI_MODEL,
  AI_TRANSCRIBE_MODEL,
  VERTEX_AI_LOCATION,
  AI_TEMPERATURE,
  AI_TOP_P,
  ZIP_COMPRESSION_LEVEL,
  VIDEO_FRAME_RATE,
  MAX_SCREENSHOT_SIZE_BYTES,
  DEFAULT_CLASS_QUOTA_BYTES,
  STUDENT_EMAIL_DOMAINS,
  TEACHER_EMAIL_DOMAINS,
  PASSKEY_DEVICE_SHARING_WHITELIST,
  isPasskeySharingWhitelisted,
  DEFAULT_LECTURE_AI_MODEL,
  SUPPORTED_LECTURE_AI_MODELS,
} from './config.js';

describe('functions/ai_flows/config.js Suite', () => {
  it('exports valid system constants', () => {
    expect(FUNCTION_REGION).toBeDefined();
    expect(CORS_ORIGINS).toBe(true);
    expect(AI_MODEL).toBe('gemini-3.5-flash-lite');
    expect(AI_TRANSCRIBE_MODEL).toBe('gemini-3.5-transcribe-preview');
    expect(DEFAULT_LECTURE_AI_MODEL).toBe('gemini-3.8-flash');
    expect(SUPPORTED_LECTURE_AI_MODELS).toEqual(['gemini-3.8-flash', 'gemini-3.6-flash']);
    expect(VERTEX_AI_LOCATION).toBe('global');
    expect(AI_TEMPERATURE).toBe(0);
    expect(AI_TOP_P).toBe(0.1);
    expect(ZIP_COMPRESSION_LEVEL).toBe(9);
    expect(VIDEO_FRAME_RATE).toBe(1);
    expect(MAX_SCREENSHOT_SIZE_BYTES).toBe(2 * 1024 * 1024);
    expect(DEFAULT_CLASS_QUOTA_BYTES).toBe(5 * 1024 * 1024 * 1024);
    expect(Array.isArray(STUDENT_EMAIL_DOMAINS)).toBe(true);
    expect(Array.isArray(TEACHER_EMAIL_DOMAINS)).toBe(true);
  });

  describe('deriveUserRole', () => {
    it('returns null for empty, non-string, or invalid email formats', () => {
      expect(deriveUserRole(null)).toBeNull();
      expect(deriveUserRole(undefined)).toBeNull();
      expect(deriveUserRole('')).toBeNull();
      expect(deriveUserRole('invalid-email')).toBeNull();
      expect(deriveUserRole('@domain.com')).toBeNull();
      expect(deriveUserRole('user@')).toBeNull();
      expect(deriveUserRole(12345)).toBeNull();
    });

    it('identifies teacher email by domain', () => {
      expect(deriveUserRole('teacher@vtc.edu.hk')).toBe('teacher');
      expect(deriveUserRole('professor.john@vtc.edu.hk')).toBe('teacher');
    });

    it('identifies student email by subdomain or student domain', () => {
      expect(deriveUserRole('200123456@stu.vtc.edu.hk')).toBe('student');
      if (STUDENT_EMAIL_DOMAINS.includes('gmail.com')) {
        expect(deriveUserRole('student@gmail.com')).toBe('student');
      } else {
        expect(deriveUserRole('student@gmail.com')).toBeNull();
      }
    });

    it('returns null for unauthorized external domains', () => {
      expect(deriveUserRole('hacker@unknown-domain.xyz')).toBeNull();
      expect(deriveUserRole('intruder@random.org')).toBeNull();
    });
  });

  describe('getAllowedEmailDomainsDescription', () => {
    it('returns a human-readable list of allowed domains', () => {
      const description = getAllowedEmailDomainsDescription();
      expect(typeof description).toBe('string');
      expect(description.length).toBeGreaterThan(0);
      expect(description).toContain('@');
    });
  });

  describe('isPasskeySharingWhitelisted', () => {
    it('returns false for invalid or empty emails', () => {
      expect(isPasskeySharingWhitelisted(null)).toBe(false);
      expect(isPasskeySharingWhitelisted(undefined)).toBe(false);
      expect(isPasskeySharingWhitelisted('')).toBe(false);
      expect(isPasskeySharingWhitelisted(12345)).toBe(false);
    });

    it('returns true for default whitelisted testing accounts', () => {
      expect(isPasskeySharingWhitelisted('cywong@vtc.edu.hk')).toBe(true);
      expect(isPasskeySharingWhitelisted('CYWONG@VTC.EDU.HK')).toBe(true);
      expect(isPasskeySharingWhitelisted('  t-cywong@stu.vtc.edu.hk  ')).toBe(true);
    });

    it('returns false for non-whitelisted student accounts', () => {
      expect(isPasskeySharingWhitelisted('random-student@stu.vtc.edu.hk')).toBe(false);
      expect(isPasskeySharingWhitelisted('attacker@gmail.com')).toBe(false);
    });
  });
});


