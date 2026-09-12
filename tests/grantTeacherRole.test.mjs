import test from 'node:test';
import assert from 'node:assert/strict';
import { grantTeacherRoleToEmail } from '../admin/scripts/grantTeacherRole.js';

test('grantTeacherRole: creates new user if not found and sets teacher claims & profile', async () => {
  let createdUser = null;
  let customClaims = null;
  let verified = null;
  const firestoreDocs = new Map();

  const mockAuth = {
    getUserByEmail: async (email) => {
      const err = new Error('User not found');
      err.code = 'auth/user-not-found';
      throw err;
    },
    createUser: async (payload) => {
      createdUser = { uid: 'new_uid_123', ...payload };
      return createdUser;
    },
    setCustomUserClaims: async (uid, claims) => {
      customClaims = { uid, claims };
    },
    updateUser: async (uid, update) => {
      verified = { uid, update };
    }
  };

  const mockDb = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => ({
          exists: firestoreDocs.has(`${col}/${id}`),
          data: () => firestoreDocs.get(`${col}/${id}`)
        }),
        set: async (data, opts) => {
          firestoreDocs.set(`${col}/${id}`, data);
        },
        delete: async () => {
          firestoreDocs.delete(`${col}/${id}`);
        }
      })
    })
  };

  const result = await grantTeacherRoleToEmail('new_instructor@school.edu', {
    auth: mockAuth,
    db: mockDb,
    defaultPassword: 'TempPassword123'
  });

  assert.equal(result.email, 'new_instructor@school.edu');
  assert.equal(result.role, 'teacher');
  assert.equal(createdUser.email, 'new_instructor@school.edu');
  assert.deepEqual(customClaims, { uid: 'new_uid_123', claims: { role: 'teacher' } });
  assert.deepEqual(verified, { uid: 'new_uid_123', update: { emailVerified: true } });
  assert.ok(firestoreDocs.has('teacherProfiles/new_uid_123'));
});

test('grantTeacherRole: migrates existing student profile to teacher profile', async () => {
  let customClaims = null;
  const firestoreDocs = new Map();

  // Student originally had a profile and classes enrolled
  firestoreDocs.set('studentProfiles/existing_stu_uid', {
    email: 'promoted_ta@school.edu',
    classes: ['class_1', 'class_2'],
    createdVia: 'student_signup'
  });

  const mockAuth = {
    getUserByEmail: async (email) => ({
      uid: 'existing_stu_uid',
      email
    }),
    setCustomUserClaims: async (uid, claims) => {
      customClaims = { uid, claims };
    },
    updateUser: async () => {}
  };

  const mockDb = {
    collection: (col) => ({
      doc: (id) => ({
        get: async () => ({
          exists: firestoreDocs.has(`${col}/${id}`),
          data: () => firestoreDocs.get(`${col}/${id}`)
        }),
        set: async (data, opts) => {
          const existing = firestoreDocs.get(`${col}/${id}`) || {};
          firestoreDocs.set(`${col}/${id}`, { ...existing, ...data });
        },
        delete: async () => {
          firestoreDocs.delete(`${col}/${id}`);
        }
      })
    })
  };

  const result = await grantTeacherRoleToEmail('promoted_ta@school.edu', {
    auth: mockAuth,
    db: mockDb
  });

  assert.equal(result.uid, 'existing_stu_uid');
  assert.deepEqual(customClaims, { uid: 'existing_stu_uid', claims: { role: 'teacher' } });

  // Verifies student profile was deleted and teacher profile contains migrated classes
  assert.equal(firestoreDocs.has('studentProfiles/existing_stu_uid'), false);
  const teacherDoc = firestoreDocs.get('teacherProfiles/existing_stu_uid');
  assert.ok(teacherDoc);
  assert.deepEqual(teacherDoc.classes, ['class_1', 'class_2']);
  assert.equal(teacherDoc.migratedFromStudent, true);
  assert.ok(teacherDoc.promotedAt);
});
