import { describe, it, expect, vi } from 'vitest';
import {
  getEmailDomain,
  getEmailUsername,
  isStudentEmail,
  isTeacherEmail,
  deriveRoleFromEmail,
  isValidInstitutionalEmail,
  getAllowedDomainsDescription,
  STUDENT_DOMAINS,
  TEACHER_DOMAINS
} from './domainConfig';

describe('domainConfig Utility', () => {
  it('correctly extracts email domains and usernames', () => {
    expect(getEmailDomain('test@vtc.edu.hk')).toBe('vtc.edu.hk');
    expect(getEmailDomain('TEST@STU.VTC.EDU.HK')).toBe('stu.vtc.edu.hk');
    expect(getEmailDomain('invalid-email')).toBe('');
    expect(getEmailDomain('')).toBe('');
    expect(getEmailDomain(null)).toBe('');

    expect(getEmailUsername('test@vtc.edu.hk')).toBe('test');
    expect(getEmailUsername('23456789@stu.vtc.edu.hk')).toBe('23456789');
    expect(getEmailUsername('invalid')).toBe('');
  });

  it('correctly identifies student emails and student subdomains', () => {
    expect(isStudentEmail('student@stu.vtc.edu.hk')).toBe(true);
    expect(isStudentEmail('student@cs.stu.vtc.edu.hk')).toBe(true);
    expect(isStudentEmail('teacher@vtc.edu.hk')).toBe(false);
    expect(isStudentEmail('outsider@gmail.com')).toBe(false);
    expect(isStudentEmail('')).toBe(false);
  });

  it('correctly identifies teacher emails and prevents student subdomains from matching teacher', () => {
    expect(isTeacherEmail('teacher@vtc.edu.hk')).toBe(true);
    expect(isTeacherEmail('teacher@staff.vtc.edu.hk')).toBe(true);
    expect(isTeacherEmail('student@stu.vtc.edu.hk')).toBe(false);
    expect(isTeacherEmail('outsider@gmail.com')).toBe(false);
    expect(isTeacherEmail('')).toBe(false);
  });

  it('correctly derives roles from emails', () => {
    expect(deriveRoleFromEmail('student@stu.vtc.edu.hk')).toBe('student');
    expect(deriveRoleFromEmail('teacher@vtc.edu.hk')).toBe('teacher');
    expect(deriveRoleFromEmail('other@gmail.com')).toBeNull();
  });

  it('validates institutional emails and rejects foreign/unrelated domains', () => {
    expect(isValidInstitutionalEmail('student@stu.vtc.edu.hk')).toBe(true);
    expect(isValidInstitutionalEmail('teacher@vtc.edu.hk')).toBe(true);
    expect(isValidInstitutionalEmail('user@gmail.com')).toBe(false);
    expect(isValidInstitutionalEmail('user@ive.edu.hk')).toBe(false);
  });

  it('generates allowed domains description matching the default configuration', () => {
    const desc = getAllowedDomainsDescription();
    expect(desc).toBe('@stu.vtc.edu.hk or @vtc.edu.hk');
  });

  it('supports custom dynamic regex rules and same-domain fallback', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_TEACHER_DOMAINS', 'myschool.edu');
    vi.stubEnv('VITE_STUDENT_DOMAINS', 'myschool.edu');
    vi.stubEnv('VITE_STUDENT_USERNAME_REGEX', '^[0-9]{8}$|^s[0-9]{7}$');
    vi.stubEnv('VITE_TEACHER_USERNAME_REGEX', '^[a-zA-Z]+\\.[a-zA-Z]+$');
    vi.stubEnv('VITE_DEFAULT_TO_STUDENT', 'true');

    const dynamicModule = await import('./domainConfig');

    // Student ID pattern matches
    expect(dynamicModule.deriveRoleFromEmail('20261234@myschool.edu')).toBe('student');
    expect(dynamicModule.deriveRoleFromEmail('s1234567@myschool.edu')).toBe('student');

    // Teacher name pattern matches
    expect(dynamicModule.deriveRoleFromEmail('john.smith@myschool.edu')).toBe('teacher');

    // Non-standard username falls back to student (zero trust)
    expect(dynamicModule.deriveRoleFromEmail('guest_speaker@myschool.edu')).toBe('student');

    // Foreign domain still rejected
    expect(dynamicModule.deriveRoleFromEmail('s1234567@gmail.com')).toBeNull();

    vi.unstubAllEnvs();
  });
});
