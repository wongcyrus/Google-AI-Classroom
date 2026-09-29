import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockHandleResetStudentPasskey = vi.fn().mockResolvedValue({ success: true, previousDeviceModel: 'iPhone 15' });
const mockClassGet = vi.fn();

vi.mock('./passkeyFlows.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    handleResetStudentPasskey: (...args) => mockHandleResetStudentPasskey(...args),
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    doc: vi.fn((path) => ({
      get: () => mockClassGet(path),
    })),
  })),
}));

import { resetStudentPasskey } from './index.mjs';

describe('resetStudentPasskey Callable Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    await expect(
      resetStudentPasskey.run({
        data: { studentUid: 'student_123' },
        auth: null,
      })
    ).rejects.toThrow('User must be authenticated.');
  });

  it('rejects when both studentUid and studentEmail are missing', async () => {
    await expect(
      resetStudentPasskey.run({
        data: {},
        auth: { uid: 'teacher_1', token: { role: 'teacher' } },
      })
    ).rejects.toThrow('Missing studentUid or studentEmail.');
  });

  it('allows teacher with teacher role claim to reset any student passkey', async () => {
    const res = await resetStudentPasskey.run({
      data: { studentUid: 'student_123', reason: 'Phone lost' },
      auth: { uid: 'teacher_1', token: { role: 'teacher', email: 'teacher@vtc.edu.hk' } },
    });

    expect(res).toEqual({ success: true, previousDeviceModel: 'iPhone 15' });
    expect(mockHandleResetStudentPasskey).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUid: 'student_123',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
      })
    );
  });

  it('allows teacher identified via classId document', async () => {
    mockClassGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        teacherEmails: ['teacher_alt@vtc.edu.hk'],
      }),
    });

    const res = await resetStudentPasskey.run({
      data: { studentUid: 'student_123', classId: 'class_99' },
      auth: { uid: 'teacher_alt_uid', token: { email: 'teacher_alt@vtc.edu.hk' } },
    });

    expect(res).toEqual({ success: true, previousDeviceModel: 'iPhone 15' });
  });

  it('blocks regular student from self-unlinking their passkey', async () => {
    await expect(
      resetStudentPasskey.run({
        data: { studentUid: 'student_normal_uid', studentEmail: 'normal_student@stu.vtc.edu.hk' },
        auth: { uid: 'student_normal_uid', token: { email: 'normal_student@stu.vtc.edu.hk' } },
      })
    ).rejects.toThrow('Students cannot self-unlink passkey authenticators. Please contact your instructor to request a passkey reset.');

    expect(mockHandleResetStudentPasskey).not.toHaveBeenCalled();
  });

  it('blocks regular student from resetting another student', async () => {
    await expect(
      resetStudentPasskey.run({
        data: { studentUid: 'victim_uid', studentEmail: 'victim@stu.vtc.edu.hk' },
        auth: { uid: 'attacker_uid', token: { email: 'attacker@stu.vtc.edu.hk' } },
      })
    ).rejects.toThrow('Students cannot self-unlink passkey authenticators. Please contact your instructor to request a passkey reset.');
  });

  it('allows whitelisted testing account to self-unlink their own passkey', async () => {
    const res = await resetStudentPasskey.run({
      data: { studentUid: 'whitelisted_uid', studentEmail: 't-cywong@stu.vtc.edu.hk' },
      auth: { uid: 'whitelisted_uid', token: { email: 't-cywong@stu.vtc.edu.hk' } },
    });

    expect(res).toEqual({ success: true, previousDeviceModel: 'iPhone 15' });
    expect(mockHandleResetStudentPasskey).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUid: 'whitelisted_uid',
        studentEmail: 't-cywong@stu.vtc.edu.hk',
      })
    );
  });

  it('blocks whitelisted student account from resetting another student', async () => {
    await expect(
      resetStudentPasskey.run({
        data: { studentUid: 'other_student_uid', studentEmail: 'other@stu.vtc.edu.hk' },
        auth: { uid: 'whitelisted_uid', token: { email: 't-cywong@stu.vtc.edu.hk' } },
      })
    ).rejects.toThrow('Students cannot self-unlink passkey authenticators. Please contact your instructor to request a passkey reset.');
  });
});
