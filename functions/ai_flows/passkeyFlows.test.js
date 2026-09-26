import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocSet,
  mockDocUpdate,
  mockDocDelete,
  mockDocGet,
  mockCollectionGet,
  mockCollectionAdd,
  mockFirestore,
} = vi.hoisted(() => {
  const mockDocSet = vi.fn().mockResolvedValue(true);
  const mockDocUpdate = vi.fn().mockResolvedValue(true);
  const mockDocDelete = vi.fn().mockResolvedValue(true);
  const mockDocGet = vi.fn();
  const mockCollectionGet = vi.fn();
  const mockCollectionAdd = vi.fn().mockResolvedValue({ id: 'audit_log_1' });

  const mockCollection = {
    doc: vi.fn((id) => ({
      id,
      set: mockDocSet,
      update: mockDocUpdate,
      delete: mockDocDelete,
      get: () => mockDocGet(id),
    })),
    where: vi.fn().mockReturnThis(),
    get: () => mockCollectionGet(),
    add: mockCollectionAdd,
  };

  const mockFirestore = {
    doc: vi.fn((path) => ({
      get: () => mockDocGet(path),
      set: mockDocSet,
      update: mockDocUpdate,
      delete: mockDocDelete,
    })),
    collection: vi.fn(() => mockCollection),
  };

  return {
    mockDocSet,
    mockDocUpdate,
    mockDocDelete,
    mockDocGet,
    mockCollectionGet,
    mockCollectionAdd,
    mockFirestore,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockFirestore),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-reg-challenge',
    rp: { name: 'Gemini AI Classroom Assistant', id: 'it114115-2627.web.app' },
    user: { id: 'student-123' },
  }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'hardware-cred-abc',
        publicKey: new Uint8Array([1, 2, 3, 4]),
        counter: 0,
        transports: ['internal'],
      },
    },
  }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({
    challenge: 'mock-auth-challenge',
    rpId: 'it114115-2627.web.app',
    allowCredentials: [{ id: 'hardware-cred-abc' }],
  }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({
    verified: true,
    authenticationInfo: {
      newCounter: 1,
    },
  }),
}));

import {
  handleRequestPasskeyPairingToken,
  handleGetPasskeyRegistrationOptions,
  handleVerifyPasskeyRegistration,
  handleGetPasskeyAuthOptions,
  handleVerifyPasskeyAuth,
  handleClaimInPersonAttendance,
  handleVerifyInPersonAttendanceOverride,
  handleGetStudentPasskeyStatus,
  handleResetStudentPasskey,
  resolveRpId,
} from './passkeyFlows.js';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

describe('WebAuthn Passkey Flows Backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveRpId', () => {
    it('returns clientRpId if allowed', () => {
      expect(resolveRpId('localhost')).toBe('localhost');
      expect(resolveRpId('it114115-dev-2026.web.app')).toBe('it114115-dev-2026.web.app');
    });

    it('falls back to default production RP ID when unlisted or missing', () => {
      expect(resolveRpId('unknown-phishing-domain.com')).toBe('it114115-2627.web.app');
      expect(resolveRpId(null)).toBe('it114115-2627.web.app');
    });
  });

  describe('handleRequestPasskeyPairingToken', () => {
    it('creates temporary pairing token in Firestore for authenticated student', async () => {
      const res = await handleRequestPasskeyPairingToken({
        studentUid: 'student_1',
        studentEmail: 's1@stu.vtc.edu.hk',
        classId: 'class_101',
      });

      expect(res.tokenId).toBeDefined();
      expect(res.expiresAtMillis).toBeGreaterThan(Date.now());
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'student_1',
          studentEmail: 's1@stu.vtc.edu.hk',
          classId: 'class_101',
          used: false,
        })
      );
    });

    it('throws unauthenticated error when studentUid is missing', async () => {
      await expect(handleRequestPasskeyPairingToken({}))
        .rejects.toThrow('User must be authenticated');
    });
  });

  describe('handleGetPasskeyRegistrationOptions', () => {
    it('retrieves valid WebAuthn options and attaches challenge to pairing token', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          studentEmail: 's1@stu.vtc.edu.hk',
          expiresAtMillis: Date.now() + 600000,
          used: false,
        }),
      });

      const options = await handleGetPasskeyRegistrationOptions({
        pairingToken: 'valid-token-123',
        clientRpId: 'localhost',
      });

      expect(options.challenge).toBe('mock-reg-challenge');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          currentChallenge: 'mock-reg-challenge',
        })
      );
    });

    it('throws if token does not exist', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });
      await expect(handleGetPasskeyRegistrationOptions({ pairingToken: 'missing' }))
        .rejects.toThrow('Invalid pairing token');
    });

    it('throws if token has already been used', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ used: true, expiresAtMillis: Date.now() + 600000 }),
      });
      await expect(handleGetPasskeyRegistrationOptions({ pairingToken: 'used-token' }))
        .rejects.toThrow('already been used');
    });
  });

  describe('handleVerifyPasskeyRegistration & 1-Phone = 1-Student Hardware Lock', () => {
    it('successfully registers hardware passkey and marks token as used', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          studentEmail: 's1@stu.vtc.edu.hk',
          currentChallenge: 'mock-reg-challenge',
          expiresAtMillis: Date.now() + 600000,
          used: false,
        }),
      });

      // No collision in studentPasskeys
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

      const result = await handleVerifyPasskeyRegistration({
        pairingToken: 'token-123',
        attestationResponse: { id: 'hardware-cred-abc', response: {} },
        clientRpId: 'it114115-2627.web.app',
        deviceModel: 'iPhone 15 Pro',
      });

      expect(result.verified).toBe(true);
      expect(result.studentUid).toBe('student_1');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'student_1',
          credentialID: 'hardware-cred-abc',
          counter: 0,
          deviceModel: 'iPhone 15 Pro',
        })
      );
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ used: true })
      );
    });

    it('BLOCKS registration when phone hardware is already bound to another student', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_2', // Student 2 trying to use Student 1's phone
          studentEmail: 's2@stu.vtc.edu.hk',
          currentChallenge: 'mock-reg-challenge',
          expiresAtMillis: Date.now() + 600000,
          used: false,
        }),
      });

      // Existing credential belongs to student_1!
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'student_1', data: () => ({ credentialID: 'hardware-cred-abc' }) }],
      });

      await expect(
        handleVerifyPasskeyRegistration({
          pairingToken: 'token-456',
          attestationResponse: { id: 'hardware-cred-abc', response: {} },
          deviceModel: 'iPhone 15 Pro',
        })
      ).rejects.toThrow('already registered to another student');
    });
  });

  describe('handleGetPasskeyAuthOptions', () => {
    it('returns WebAuthn authentication options for pending bingo check', async () => {
      // 1. Bingo doc
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          studentEmail: 's1@stu.vtc.edu.hk',
          result: 'pending',
          timeLimitSeconds: 15,
          expiresAtMillis: Date.now() + 15000,
        }),
      });

      // 2. Passkey doc
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          credentialID: 'hardware-cred-abc',
          transports: ['internal'],
          deviceModel: 'iPhone 15 Pro',
        }),
      });

      const res = await handleGetPasskeyAuthOptions({
        classId: 'class_1',
        bingoId: 'bingo_123',
        clientRpId: 'localhost',
      });

      expect(res.options.challenge).toBe('mock-auth-challenge');
      expect(res.studentEmail).toBe('s1@stu.vtc.edu.hk');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeyChallenge: 'mock-auth-challenge',
        })
      );
    });

    it('returns error if student has not paired phone yet', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ studentUid: 'unpaired_student', result: 'pending' }),
      });
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const res = await handleGetPasskeyAuthOptions({
        classId: 'class_1',
        bingoId: 'bingo_unpaired',
      });

      expect(res.error).toBe('no_passkey');
    });
  });

  describe('handleVerifyPasskeyAuth', () => {
    it('verifies biometric passkey and records passed result with latency in seconds', async () => {
      // 1. Bingo doc
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          result: 'pending',
          passkeyChallenge: 'mock-auth-challenge',
          issuedAtMillis: Date.now() - 2500,
        }),
      });

      // 2. Passkey doc
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          credentialID: 'hardware-cred-abc',
          credentialPublicKey: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64'),
          counter: 0,
        }),
      });

      const result = await handleVerifyPasskeyAuth({
        classId: 'class_1',
        bingoId: 'bingo_123',
        assertionResponse: { id: 'hardware-cred-abc', response: {} },
        timeToCompleteMillis: 2100,
      });

      expect(result.verified).toBe(true);
      expect(result.responseTimeSec).toBe(2.1);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'passed',
          status: 'completed',
          passkeyVerified: true,
          inPersonVerified: false,
          responseTimeSec: 2.1,
        })
      );
    });

    it('rejects assertion when credential ID does not match student registered credential', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          result: 'pending',
          passkeyChallenge: 'mock-auth-challenge',
        }),
      });

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          credentialID: 'hardware-cred-abc',
        }),
      });

      await expect(
        handleVerifyPasskeyAuth({
          classId: 'class_1',
          bingoId: 'bingo_123',
          assertionResponse: { id: 'different-impostor-cred', response: {} },
        })
      ).rejects.toThrow('Credential mismatch');
    });
  });

  describe('In-Person Backup Flow', () => {
    it('handleClaimInPersonAttendance flags the record for in-person verification', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          result: 'pending',
        }),
      });

      const res = await handleClaimInPersonAttendance({
        classId: 'class_1',
        bingoId: 'bingo_123',
        studentUid: 'student_1',
      });

      expect(res.success).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          inPersonClaim: true,
        })
      );
    });

    it('handleVerifyInPersonAttendanceOverride allows teacher to manually approve attendance', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_1',
          result: 'pending',
        }),
      });

      const res = await handleVerifyInPersonAttendanceOverride({
        classId: 'class_1',
        bingoId: 'bingo_123',
        studentUid: 'student_1',
        teacherUid: 'teacher_999',
        teacherEmail: 'prof@vtc.edu.hk',
      });

      expect(res.success).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'passed',
          inPersonVerified: true,
          passkeyVerified: false,
          verifiedByTeacherEmail: 'prof@vtc.edu.hk',
        })
      );
    });
  });

  describe('handleGetStudentPasskeyStatus', () => {
    it('returns isPaired true when student passkey exists', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          deviceModel: 'iPhone 15 Pro',
          registeredAt: '2026-09-26T00:00:00Z',
        }),
      });

      const res = await handleGetStudentPasskeyStatus({ studentUid: 'student_1' });
      expect(res.isPaired).toBe(true);
      expect(res.deviceModel).toBe('iPhone 15 Pro');
    });

    it('returns isPaired false when passkey does not exist', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });
      const res = await handleGetStudentPasskeyStatus({ studentUid: 'new_student' });
      expect(res.isPaired).toBe(false);
    });
  });

  describe('handleResetStudentPasskey', () => {
    it('successfully unlinks passkey, records audit log, and updates studentProperties', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          credentialID: 'hardware-cred-old-phone',
          deviceModel: 'iPhone 13 mini',
          studentUid: 'student_1',
        }),
      });

      const res = await handleResetStudentPasskey({
        studentUid: 'student_1',
        classId: 'class_1',
        teacherUid: 'teacher_999',
        teacherEmail: 'teacher@vtc.edu.hk',
        reason: 'Student replaced phone with iPhone 16',
      });

      expect(res.success).toBe(true);
      expect(res.previousDeviceModel).toBe('iPhone 13 mini');
      expect(mockDocDelete).toHaveBeenCalled();
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'student_1',
          action: 'RESET_PASSKEY_PHONE_REPLACEMENT',
          teacherEmail: 'teacher@vtc.edu.hk',
          previousCredentialID: 'hardware-cred-old-phone',
        })
      );
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeyStatus: 'unpaired',
        })
      );
    });

    it('handles gracefully when student had no existing passkey document', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });

      const res = await handleResetStudentPasskey({
        studentUid: 'student_2',
        classId: 'class_1',
        teacherUid: 'teacher_999',
        teacherEmail: 'teacher@vtc.edu.hk',
      });

      expect(res.success).toBe(true);
      expect(res.previousDeviceModel).toBeNull();
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'student_2',
          action: 'RESET_PASSKEY_PHONE_REPLACEMENT',
        })
      );
    });

    it('throws invalid-argument when studentUid is missing', async () => {
      await expect(
        handleResetStudentPasskey({ studentUid: null, studentEmail: null })
      ).rejects.toThrow('Missing studentUid or studentEmail.');
    });
  });
});

