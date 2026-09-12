import { describe, it, expect } from 'vitest';
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
});
