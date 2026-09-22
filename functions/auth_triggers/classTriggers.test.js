import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocGet,
  mockDocUpdate,
  mockBatchSet,
  mockBatchUpdate,
  mockBatchCommit,
  mockGetUserByEmail,
  mockCreateUser,
  mockSetCustomUserClaims,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocUpdate = vi.fn().mockResolvedValue();
  const mockBatchSet = vi.fn();
  const mockBatchUpdate = vi.fn();
  const mockBatchCommit = vi.fn().mockResolvedValue();

  const mockGetUserByEmail = vi.fn();
  const mockCreateUser = vi.fn();
  const mockSetCustomUserClaims = vi.fn().mockResolvedValue();

  return {
    mockDocGet,
    mockDocUpdate,
    mockBatchSet,
    mockBatchUpdate,
    mockBatchCommit,
    mockGetUserByEmail,
    mockCreateUser,
    mockSetCustomUserClaims,
  };
});

vi.mock('firebase-admin/firestore', () => {
  const docImpl = vi.fn((docId) => ({
    id: docId,
    get: mockDocGet,
    update: mockDocUpdate,
    collection: vi.fn((subCol) => ({
      doc: vi.fn((subDocId) => ({
        id: subDocId,
        get: mockDocGet,
      })),
    })),
  }));

  const colImpl = vi.fn(() => ({
    doc: docImpl,
  }));

  return {
    getFirestore: () => ({
      collection: colImpl,
      batch: () => ({
        set: mockBatchSet,
        update: mockBatchUpdate,
        commit: mockBatchCommit,
      }),
    }),
    FieldValue: {
      arrayUnion: (...items) => ({ arrayUnion: items }),
      arrayRemove: (...items) => ({ arrayRemove: items }),
      delete: () => 'FIELD_DELETE',
    },
  };
});

vi.mock('firebase-admin/auth', () => ({
  getAuth: () => ({
    getUserByEmail: mockGetUserByEmail,
    createUser: mockCreateUser,
    setCustomUserClaims: mockSetCustomUserClaims,
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentWritten: (opts, handler) => handler || opts,
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { onClassUpdate } from './userManagement.js';

describe('onClassUpdate Lifecycle & User Association Trigger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles adding new students: creates auth user, copies classProps, and links class', async () => {
    // 1. classPropsSnap
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ allowScreenShare: true, captureInterval: 10 }),
    });

    // 2. student getUserByEmail -> user-not-found -> createUser
    mockGetUserByEmail.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    mockCreateUser.mockResolvedValueOnce({
      uid: 'new-student-uid',
      email: 'student1@stu.vtc.edu.hk',
    });

    const event = {
      params: { classId: 'CLASS_A' },
      data: {
        before: { data: () => ({ studentEmails: [] }) },
        after: {
          data: () => ({
            studentEmails: ['student1@stu.vtc.edu.hk'],
            teacherEmails: [],
          }),
        },
      },
    };

    await onClassUpdate(event);

    expect(mockCreateUser).toHaveBeenCalledWith({
      email: 'student1@stu.vtc.edu.hk',
      emailVerified: false,
    });
    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('new-student-uid', { role: 'student' });
    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'students.new-student-uid': 'student1@stu.vtc.edu.hk',
      })
    );
  });

  it('handles removing students: removes class link from profile and deletes student map key', async () => {
    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 'existing-student-uid',
      email: 'student1@stu.vtc.edu.hk',
      customClaims: { role: 'student' },
    });

    const event = {
      params: { classId: 'CLASS_A' },
      data: {
        before: { data: () => ({ studentEmails: ['student1@stu.vtc.edu.hk'] }) },
        after: { data: () => ({ studentEmails: [] }) },
      },
    };

    await onClassUpdate(event);

    expect(mockBatchCommit).toHaveBeenCalled();
    expect(mockBatchUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        'students.existing-student-uid': 'FIELD_DELETE',
      })
    );
  });

  it('handles adding and removing teachers: verifies role claims and links/unlinks class', async () => {
    // Existing teacher added: updates claims if needed
    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 'teacher-1-uid',
      email: 'prof@vtc.edu.hk',
      customClaims: {}, // Missing role claim
    });

    // Teacher removed
    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 'teacher-2-uid',
      email: 'oldprof@vtc.edu.hk',
      customClaims: { role: 'teacher' },
    });

    const event = {
      params: { classId: 'CLASS_A' },
      data: {
        before: { data: () => ({ teacherEmails: ['oldprof@vtc.edu.hk'] }) },
        after: { data: () => ({ teacherEmails: ['prof@vtc.edu.hk'] }) },
      },
    };

    await onClassUpdate(event);

    expect(mockSetCustomUserClaims).toHaveBeenCalledWith('teacher-1-uid', { role: 'teacher' });
    expect(mockBatchCommit).toHaveBeenCalled();
  });

  it('sanitizes student emails if whitespace exists', async () => {
    const event = {
      params: { classId: 'CLASS_SPACES' },
      data: {
        before: { data: () => ({ studentEmails: [] }) },
        after: {
          data: () => ({
            studentEmails: [' student1@stu.vtc.edu.hk '],
          }),
        },
      },
    };

    mockDocGet.mockResolvedValueOnce({ exists: false });
    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 's1-uid',
      email: 'student1@stu.vtc.edu.hk',
      customClaims: { role: 'student' },
    });

    await onClassUpdate(event);

    expect(mockDocUpdate).toHaveBeenCalledWith({
      studentEmails: ['student1@stu.vtc.edu.hk'],
    });
  });

  it('skips invalid domains and mismatched roles safely', async () => {
    const event = {
      params: { classId: 'CLASS_MISMATCH' },
      data: {
        before: { data: () => ({ studentEmails: [] }) },
        after: {
          data: () => ({
            studentEmails: [
              'random@gmail.com', // invalid domain
              'prof@vtc.edu.hk', // teacher email in student list
            ],
          }),
        },
      },
    };

    mockDocGet.mockResolvedValueOnce({ exists: false });

    await onClassUpdate(event);

    expect(mockGetUserByEmail).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
  });

  it('seeds studentProperties with profile metadata when studentProfiles is present on class', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ allowScreenShare: true, captureInterval: 10 }),
    });

    mockGetUserByEmail.mockResolvedValueOnce({
      uid: 'david-uid',
      email: 'chan.tm@stu.vtc.edu.hk',
      customClaims: { role: 'student' },
    });

    const event = {
      params: { classId: 'CLASS_A' },
      data: {
        before: { data: () => ({ studentEmails: [] }) },
        after: {
          data: () => ({
            studentEmails: ['chan.tm@stu.vtc.edu.hk'],
            teacherEmails: [],
            studentProfiles: {
              'chan.tm@stu.vtc.edu.hk': {
                studentName: 'Chan Tai Man',
                firstName: 'Tai Man',
                lastName: 'Chan',
                nickname: 'David',
                studentClass: 'IT114115/1A',
                programme: 'Higher Diploma in Software Engineering',
              },
            },
          }),
        },
      },
    };

    await onClassUpdate(event);

    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowScreenShare: true,
        captureInterval: 10,
        studentName: 'Chan Tai Man',
        firstName: 'Tai Man',
        lastName: 'Chan',
        nickname: 'David',
        studentClass: 'IT114115/1A',
        programme: 'Higher Diploma in Software Engineering',
      }),
      { merge: true }
    );
  });
});
