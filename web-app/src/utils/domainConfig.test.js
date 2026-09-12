import { describe, it, expect } from 'vitest';
import {
  getEmailDomain,
  isStudentEmail,
  isTeacherEmail,
  deriveRoleFromEmail,
  isValidInstitutionalEmail,
  getAllowedDomainsDescription,
  STUDENT_DOMAINS,
  TEACHER_DOMAINS
} from './domainConfig';

describe('domainConfig Utility', () => {
  it('correctly extracts email domains', () => {
    expect(getEmailDomain('test@vtc.edu.hk')).toBe('vtc.edu.hk');
    expect(getEmailDomain('TEST@STU.VTC.EDU.HK')).toBe('stu.vtc.edu.hk');
    expect(getEmailDomain('invalid-email')).toBe('');
    expect(getEmailDomain('')).toBe('');
    expect(getEmailDomain(null)).toBe('');
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
});
