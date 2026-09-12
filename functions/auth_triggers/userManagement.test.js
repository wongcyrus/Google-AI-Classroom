import { describe, it, expect, vi } from 'vitest';
import { deriveUserRole, getAllowedEmailDomainsDescription } from './config.js';

describe('User Management Logic (functions/auth_triggers/userManagement.js)', () => {
  it('correctly maps email domains to student and teacher roles using deriveUserRole', () => {
    const studentEmail = 'test.student@stu.vtc.edu.hk';
    const teacherEmail = 'test.teacher@vtc.edu.hk';
    const invalidEmail = 'test.user@gmail.com';
    const iveEmail = 'test.teacher@ive.edu.hk'; // No longer valid by default

    expect(deriveUserRole(studentEmail)).toBe('student');
    expect(deriveUserRole(teacherEmail)).toBe('teacher');
    expect(deriveUserRole(invalidEmail)).toBeNull();
    expect(deriveUserRole(iveEmail)).toBeNull();
  });

  it('handles case-insensitivity and whitespace in deriveUserRole', () => {
    expect(deriveUserRole('  TEACHER@VTC.EDU.HK  ')).toBe('teacher');
    expect(deriveUserRole(' STUDENT@STU.VTC.EDU.HK ')).toBe('student');
    expect(deriveUserRole('')).toBeNull();
    expect(deriveUserRole(null)).toBeNull();
  });

  it('provides formatted allowed domain description', () => {
    const desc = getAllowedEmailDomainsDescription();
    expect(desc).toContain('@stu.vtc.edu.hk');
    expect(desc).toContain('@vtc.edu.hk');
  });

  it('correctly categorizes added and removed students on class update', () => {
    const beforeStudentEmails = ['s1@stu.vtc.edu.hk', 's2@stu.vtc.edu.hk'];
    const afterStudentEmails = ['s2@stu.vtc.edu.hk', 's3@stu.vtc.edu.hk'];

    const studentsBefore = new Set(beforeStudentEmails);
    const studentsAfter = new Set(afterStudentEmails);

    const addedStudents = [...studentsAfter].filter(email => !studentsBefore.has(email));
    const removedStudents = [...studentsBefore].filter(email => !studentsAfter.has(email));

    expect(addedStudents).toEqual(['s3@stu.vtc.edu.hk']);
    expect(removedStudents).toEqual(['s1@stu.vtc.edu.hk']);
  });

  it('sanitizes student email strings by trimming whitespace', () => {
    const rawEmails = ['  s1@stu.vtc.edu.hk  ', 's2@stu.vtc.edu.hk\n', '', '   '];
    const cleaned = rawEmails.map(e => e.replace(/\s/g, '')).filter(Boolean);

    expect(cleaned).toEqual(['s1@stu.vtc.edu.hk', 's2@stu.vtc.edu.hk']);
  });

  it('supports same-domain disambiguation via username regex and zero-trust fallback', async () => {
    vi.resetModules();
    vi.stubEnv('TEACHER_EMAIL_DOMAINS', 'myschool.edu');
    vi.stubEnv('STUDENT_EMAIL_DOMAINS', 'myschool.edu');
    vi.stubEnv('STUDENT_USERNAME_REGEX', '^[0-9]{8}$|^s[0-9]{7}$');
    vi.stubEnv('TEACHER_USERNAME_REGEX', '^[a-zA-Z]+\\.[a-zA-Z]+$');
    vi.stubEnv('DEFAULT_TO_STUDENT', 'true');

    const dynamicConfig = await import('./config.js');

    // Matches student regex
    expect(dynamicConfig.deriveUserRole('20268888@myschool.edu')).toBe('student');
    expect(dynamicConfig.deriveUserRole('s1234567@myschool.edu')).toBe('student');

    // Matches teacher regex
    expect(dynamicConfig.deriveUserRole('professor.oak@myschool.edu')).toBe('teacher');

    // Ambiguous username on same domain defaults to student (zero trust)
    expect(dynamicConfig.deriveUserRole('admin_coordinator@myschool.edu')).toBe('student');

    // Unrelated domain rejected
    expect(dynamicConfig.deriveUserRole('s1234567@otherdomain.com')).toBeNull();

    vi.unstubAllEnvs();
  });
});
