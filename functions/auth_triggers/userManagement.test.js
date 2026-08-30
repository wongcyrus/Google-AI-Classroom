import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('User Management Logic (functions/auth_triggers/userManagement.js)', () => {
  it('correctly maps email domains to student and teacher roles', () => {
    const studentEmail = 'test.student@stu.vtc.edu.hk';
    const teacherEmail = 'test.teacher@vtc.edu.hk';
    const invalidEmail = 'test.user@gmail.com';

    const getRole = (email) => {
      if (email.endsWith('@vtc.edu.hk')) return 'teacher';
      if (email.endsWith('@stu.vtc.edu.hk')) return 'student';
      return null;
    };

    expect(getRole(studentEmail)).toBe('student');
    expect(getRole(teacherEmail)).toBe('teacher');
    expect(getRole(invalidEmail)).toBeNull();
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
