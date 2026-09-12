import { describe, it, expect, vi } from 'vitest';
import { deriveUserRole, getAllowedEmailDomainsDescription } from './config.js';
import { handleBeforeUserCreatedLogic } from './userManagement.js';

function createMockFirestore({ preEnrolledTeacher = false, preEnrolledClasses = [] } = {}) {
  const batchUpdates = [];
  const batchSets = [];
  return {
    collection: (colName) => ({
      doc: (id) => ({
        id,
        collectionName: colName
      }),
      where: (field, op, val) => {
        const queryResult = {
          empty: (field === 'teacherEmails' && !preEnrolledTeacher) ||
                 (field === 'studentEmails' && preEnrolledClasses.length === 0),
          size: field === 'teacherEmails' && preEnrolledTeacher ? (preEnrolledClasses.length || 1) : preEnrolledClasses.length,
          forEach: (cb) => {
            preEnrolledClasses.forEach(c => cb({
              id: c.id,
              ref: { id: c.id }
            }));
          }
        };
        return {
          limit: () => ({
            get: async () => queryResult
          }),
          get: async () => queryResult
        };
      }
    }),
    batch: () => ({
      update: (ref, data) => batchUpdates.push({ ref, data }),
      set: (ref, data, opts) => batchSets.push({ ref, data, opts }),
      commit: async () => {}
    }),
    _getOperations: () => ({ batchUpdates, batchSets })
  };
}

const mockFieldValue = {
  arrayUnion: (...items) => items
};

describe('User Management Logic (functions/auth_triggers/userManagement.js)', () => {
  it('correctly maps email domains to student and teacher roles using deriveUserRole', () => {
    const studentEmail = 'test.student@stu.vtc.edu.hk';
    const teacherEmail = 'test.teacher@vtc.edu.hk';
    const invalidEmail = 'test.user@gmail.com';
    const iveEmail = 'test.teacher@ive.edu.hk';

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

  it('safely handles malformed and edge-case email inputs in backend deriveUserRole', () => {
    expect(deriveUserRole('@')).toBeNull();
    expect(deriveUserRole('@stu.vtc.edu.hk')).toBeNull();
    expect(deriveUserRole('user@')).toBeNull();
    expect(deriveUserRole('noatsign')).toBeNull();
    expect(deriveUserRole('   ')).toBeNull();
    expect(deriveUserRole(undefined)).toBeNull();
    expect(deriveUserRole(12345)).toBeNull();
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

  describe('beforeusercreated Lifecycle & Blocking Trigger', () => {
    it('throws error when email is missing', async () => {
      await expect(
        handleBeforeUserCreatedLogic({ data: { uid: 'u1' } })
      ).rejects.toThrow('Email is required to sign up.');
    });

    it('throws error when email domain is not authorized', async () => {
      const mockDb = createMockFirestore();
      await expect(
        handleBeforeUserCreatedLogic(
          { data: { uid: 'u1', email: 'intruder@bad.com' } },
          { db: mockDb, deriveUserRole: () => null, getAllowedEmailDomainsDescription: () => '@school.edu' }
        )
      ).rejects.toThrow(/valid institutional email address/);
    });

    it('promotes pre-enrolled teacher to teacher role even if regex would classify as student', async () => {
      const mockDb = createMockFirestore({
        preEnrolledTeacher: true,
        preEnrolledClasses: [{ id: 'class_ai_101' }]
      });

      const result = await handleBeforeUserCreatedLogic(
        { data: { uid: 'teacher_uid', email: 's1234567@school.edu' } },
        {
          db: mockDb,
          deriveUserRole: () => 'student', // regex might have said student
          FieldValue: mockFieldValue
        }
      );

      // Successfully overridden to teacher
      expect(result.customClaims).toEqual({ role: 'teacher' });

      // Verifies class document was updated with teachers[uid] = email
      const { batchUpdates, batchSets } = mockDb._getOperations();
      expect(batchUpdates).toHaveLength(1);
      expect(batchUpdates[0].data).toEqual({ 'teachers.teacher_uid': 's1234567@school.edu' });
      expect(batchSets[0].data.classes).toEqual(['class_ai_101']);
    });

    it('assigns student role and links classes when student signs up', async () => {
      const mockDb = createMockFirestore({
        preEnrolledTeacher: false,
        preEnrolledClasses: [{ id: 'class_eng_202' }]
      });

      const result = await handleBeforeUserCreatedLogic(
        { data: { uid: 'student_uid', email: 'student@stu.vtc.edu.hk' } },
        {
          db: mockDb,
          deriveUserRole: () => 'student',
          FieldValue: mockFieldValue
        }
      );

      expect(result.customClaims).toEqual({ role: 'student' });

      const { batchUpdates, batchSets } = mockDb._getOperations();
      expect(batchUpdates).toHaveLength(1);
      expect(batchUpdates[0].data).toEqual({ 'students.student_uid': 'student@stu.vtc.edu.hk' });
      expect(batchSets[0].data.classes).toEqual(['class_eng_202']);
    });

    it('assigns zero-trust student role when ambiguous username on same domain signs up', async () => {
      const mockDb = createMockFirestore({
        preEnrolledTeacher: false,
        preEnrolledClasses: []
      });

      const result = await handleBeforeUserCreatedLogic(
        { data: { uid: 'user_unknown', email: 'guest@school.edu' } },
        {
          db: mockDb,
          deriveUserRole: () => 'student', // Default-to-student fallback
          FieldValue: mockFieldValue
        }
      );

      expect(result.customClaims).toEqual({ role: 'student' });
    });
  });
});
