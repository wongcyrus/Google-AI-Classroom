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
    doc: vi.fn((id = 'generated_doc_id') => ({
      id: id || 'generated_doc_id',
      set: mockDocSet,
      update: mockDocUpdate,
      delete: mockDocDelete,
      get: () => mockDocGet(id || 'generated_doc_id'),
    })),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
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
    increment: vi.fn((n) => n),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    createCustomToken: vi.fn().mockResolvedValue('mock-custom-token-student-123'),
  })),
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
  handleInitiateDesktopLoginSession,
  handleGetDesktopLoginPasskeyOptions,
  handleVerifyDesktopLoginPasskey,
  handleRequestTeacherPasskeyBypass,
  handleApproveTeacherPasskeyBypass,
  handleVerifyTeacherPasskeyBypassPin,
  handleCreateLectureBingoSession,
  handleGetLecturePasskeyAuthOptions,
  handleVerifyLecturePasskeyAuth,
  computeLectureQrToken,
  isValidLectureQrToken,
  LECTURE_QR_ROTATION_INTERVAL_MS,
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

    it('BLOCKS registration when deviceFingerprint is already bound to another student', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'student_2',
          studentEmail: 's2@stu.vtc.edu.hk',
          currentChallenge: 'mock-reg-challenge',
          expiresAtMillis: Date.now() + 600000,
          used: false,
        }),
      });

      // Existing deviceFingerprint query matches student_1
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [{ id: 'student_1', data: () => ({ studentEmail: 's1@stu.vtc.edu.hk' }) }],
      });

      await expect(
        handleVerifyPasskeyRegistration({
          pairingToken: 'token-456',
          attestationResponse: { id: 'hardware-cred-xyz', response: {} },
          deviceModel: 'iPhone 15 Pro',
          deviceFingerprint: 'mdev_phone_student1',
        })
      ).rejects.toThrow('Hardware Lock: This physical phone is already bound to student account');
    });

    it('allows registration when deviceFingerprint belongs to the same student or is new', async () => {
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

      // 1. deviceFingerprint query: empty (unbound)
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });
      // 2. credentialID query: empty (unbound)
      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

      const res = await handleVerifyPasskeyRegistration({
        pairingToken: 'token-789',
        attestationResponse: { id: 'hardware-cred-new', response: {} },
        deviceModel: 'Pixel 9',
        deviceFingerprint: 'mdev_phone_pixel',
      });

      expect(res.verified).toBe(true);
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'student_1',
          deviceFingerprint: 'mdev_phone_pixel',
        })
      );
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

    it('rejects assertion when deviceFingerprint does not match registered mobile phone', async () => {
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
          deviceFingerprint: 'mdev_phone_original',
        }),
      });

      await expect(
        handleVerifyPasskeyAuth({
          classId: 'class_1',
          bingoId: 'bingo_123',
          assertionResponse: { id: 'hardware-cred-abc', response: {} },
          deviceFingerprint: 'mdev_phone_imposter',
        })
      ).rejects.toThrow('Device Mismatch: Attendance must be verified using your registered mobile phone.');
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

    it('looks up studentUid by studentEmail when studentUid is not provided', async () => {
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'looked_up_uid_1',
            data: () => ({
              studentEmail: 'student_lookup@vtc.edu.hk',
              deviceModel: 'Pixel 8',
              credentialID: 'cred_pixel_8',
            }),
          },
        ],
      });

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentEmail: 'student_lookup@vtc.edu.hk',
          deviceModel: 'Pixel 8',
          credentialID: 'cred_pixel_8',
        }),
      });

      const res = await handleResetStudentPasskey({
        studentUid: null,
        studentEmail: 'STUDENT_LOOKUP@VTC.EDU.HK',
        classId: 'class_1',
        teacherEmail: 'teacher@vtc.edu.hk',
      });

      expect(res.success).toBe(true);
      expect(res.previousDeviceModel).toBe('Pixel 8');
      expect(mockDocDelete).toHaveBeenCalled();
    });

    it('catches and logs student properties update errors without failing the reset', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentEmail: 'student_prop_err@vtc.edu.hk',
          deviceModel: 'Samsung S24',
        }),
      });

      mockDocUpdate.mockRejectedValueOnce(new Error('Permission denied on subcollection'));

      const res = await handleResetStudentPasskey({
        studentUid: 'student_s24',
        classId: 'class_1',
        teacherEmail: 'teacher@vtc.edu.hk',
      });

      expect(res.success).toBe(true);
      expect(res.previousDeviceModel).toBe('Samsung S24');
    });
  });

  describe('handleInitiateDesktopLoginSession', () => {
    it('creates an ephemeral 90s login session and returns QR URL', async () => {
      const res = await handleInitiateDesktopLoginSession({ clientRpId: 'localhost' });

      expect(res.sessionId).toBeDefined();
      expect(res.expiresAtMillis).toBeGreaterThan(Date.now());
      expect(res.qrUrl).toBe(`/mobile-login?session=${res.sessionId}`);
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: res.sessionId,
          status: 'pending',
          rpId: 'localhost',
        })
      );
    });
  });

  describe('handleGetDesktopLoginPasskeyOptions', () => {
    it('throws error if sessionId is missing', async () => {
      await expect(handleGetDesktopLoginPasskeyOptions({})).rejects.toThrow('Missing sessionId.');
    });

    it('throws error if session not found', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });
      await expect(handleGetDesktopLoginPasskeyOptions({ sessionId: 'unknown_session' })).rejects.toThrow('Login session not found or expired.');
    });

    it('throws error if session is not pending', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'authorized', expiresAtMillis: Date.now() + 60000 }),
      });
      await expect(handleGetDesktopLoginPasskeyOptions({ sessionId: 'session_auth' })).rejects.toThrow('Session is authorized.');
    });

    it('throws error and marks session expired if TTL passed', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', expiresAtMillis: Date.now() - 5000 }),
      });
      await expect(handleGetDesktopLoginPasskeyOptions({ sessionId: 'expired_session' })).rejects.toThrow('Login session expired.');
      expect(mockDocUpdate).toHaveBeenCalledWith({ status: 'expired' });
    });

    it('returns WebAuthn authentication options and saves challenge', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ status: 'pending', expiresAtMillis: Date.now() + 60000, rpId: 'localhost' }),
      });

      const res = await handleGetDesktopLoginPasskeyOptions({ sessionId: 'valid_session' });
      expect(res.options).toBeDefined();
      expect(res.sessionId).toBe('valid_session');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          challenge: 'mock-auth-challenge',
        })
      );
    });
  });

  describe('handleVerifyDesktopLoginPasskey', () => {
    it('throws error if sessionId or assertion is missing', async () => {
      await expect(handleVerifyDesktopLoginPasskey({})).rejects.toThrow('Missing sessionId or authenticationResponse.');
    });

    it('throws error if no student passkey matches device credential ID', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          status: 'pending',
          expiresAtMillis: Date.now() + 60000,
          challenge: 'mock-auth-challenge',
        }),
      });

      mockCollectionGet.mockResolvedValueOnce({ empty: true, docs: [] });

      await expect(
        handleVerifyDesktopLoginPasskey({
          sessionId: 'session_1',
          authenticationResponse: { id: 'unregistered_cred' },
        })
      ).rejects.toThrow('No student passkey found matching this mobile device.');
    });

    it('authenticates, updates counter, mints custom token, and authorizes session', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          status: 'pending',
          expiresAtMillis: Date.now() + 60000,
          challenge: 'mock-auth-challenge',
          rpIdUsed: 'it114115-2627.web.app',
        }),
      });

      const mockPasskeyDocRef = { update: vi.fn().mockResolvedValue(true) };
      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'student_alex',
            ref: mockPasskeyDocRef,
            data: () => ({
              studentEmail: 'alex@vtc.edu.hk',
              credentialID: 'hardware-cred-abc',
              credentialPublicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
              counter: 0,
              deviceModel: 'iPhone 15 Pro',
            }),
          },
        ],
      });

      const res = await handleVerifyDesktopLoginPasskey({
        sessionId: 'session_1',
        authenticationResponse: { id: 'hardware-cred-abc' },
      });

      expect(res.verified).toBe(true);
      expect(res.studentUid).toBe('student_alex');
      expect(res.studentEmail).toBe('alex@vtc.edu.hk');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'authorized',
          customToken: 'mock-custom-token-student-123',
          studentUid: 'student_alex',
        })
      );
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DESKTOP_LOGIN_VIA_MOBILE_QR',
          studentUid: 'student_alex',
        })
      );
    });

    it('throws error when deviceFingerprint does not match the bound passkey device', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          status: 'pending',
          challenge: 'mock-login-challenge',
          expiresAtMillis: Date.now() + 60000,
        }),
      });

      mockCollectionGet.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'student_1',
            data: () => ({
              credentialID: 'hardware-cred-abc',
              credentialPublicKey: Buffer.from('mock-public-key').toString('base64'),
              studentEmail: 's1@stu.vtc.edu.hk',
              deviceModel: 'iPhone 15 Pro',
              deviceFingerprint: 'mdev_phone_original',
            }),
          },
        ],
      });

      await expect(
        handleVerifyDesktopLoginPasskey({
          sessionId: 'session_1',
          authenticationResponse: { id: 'hardware-cred-abc' },
          deviceFingerprint: 'mdev_phone_different',
        })
      ).rejects.toThrow('Device Mismatch: This passkey was registered on a different physical smartphone.');
    });
  });

  describe('handleRequestTeacherPasskeyBypass', () => {
    it('throws error if classId is missing', async () => {
      await expect(
        handleRequestTeacherPasskeyBypass({ studentUid: 'alex', reason: 'dead battery' })
      ).rejects.toThrow('Missing classId.');
    });

    it('creates a bypass request and audit log', async () => {
      const res = await handleRequestTeacherPasskeyBypass({
        classId: 'class_it101',
        studentUid: 'alex',
        studentEmail: 'alex@vtc.edu.hk',
        deskNumber: 'Desk #14',
        reason: 'Battery Depleted',
      });

      expect(res.success).toBe(true);
      expect(res.requestId).toBeDefined();
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class_it101',
          studentUid: 'alex',
          deskNumber: 'Desk #14',
          reason: 'Battery Depleted',
          status: 'pending',
        })
      );
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BYPASS_REQUEST_CREATED',
          studentUid: 'alex',
        })
      );
    });
  });

  describe('handleApproveTeacherPasskeyBypass', () => {
    it('throws error if classId is missing', async () => {
      await expect(
        handleApproveTeacherPasskeyBypass({ studentUid: 'alex' })
      ).rejects.toThrow('Missing classId.');
    });

    it('approves bypass and writes lesson passkeyBypass property with audit log', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'alex',
          studentEmail: 'alex@vtc.edu.hk',
          reason: 'Battery Depleted',
          deskNumber: 'Desk #14',
        }),
      });

      const res = await handleApproveTeacherPasskeyBypass({
        requestId: 'req_123',
        classId: 'class_it101',
        studentUid: 'alex',
        teacherUid: 'teacher_1',
        teacherEmail: 'teacher@vtc.edu.hk',
        bypassDurationMinutes: 180,
        approved: true,
      });

      expect(res.success).toBe(true);
      expect(res.approved).toBe(true);
      expect(res.expiresAtMillis).toBeGreaterThan(Date.now());
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeyBypass: expect.objectContaining({
            active: true,
            grantedBy: 'teacher@vtc.edu.hk',
            reason: 'Battery Depleted',
            scope: 'current_lesson',
          }),
        }),
        { merge: true }
      );
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEACHER_BYPASS_GRANTED',
          studentUid: 'alex',
        })
      );
    });

    it('records rejection when approved is false', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          studentUid: 'alex',
          studentEmail: 'alex@vtc.edu.hk',
          reason: 'Broken phone',
        }),
      });

      const res = await handleApproveTeacherPasskeyBypass({
        requestId: 'req_rej',
        classId: 'class_it101',
        studentUid: 'alex',
        teacherEmail: 'teacher@vtc.edu.hk',
        approved: false,
      });

      expect(res.success).toBe(true);
      expect(res.approved).toBe(false);
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEACHER_BYPASS_REJECTED',
          studentUid: 'alex',
        })
      );
    });
  });

  describe('handleVerifyTeacherPasskeyBypassPin', () => {
    it('throws error if required arguments are missing', async () => {
      await expect(
        handleVerifyTeacherPasskeyBypassPin({ classId: 'c1', studentUid: 's1' })
      ).rejects.toThrow('Missing classId, studentUid, or pin.');
    });

    it('throws error if class is not found', async () => {
      mockDocGet.mockResolvedValueOnce({ exists: false });
      await expect(
        handleVerifyTeacherPasskeyBypassPin({ classId: 'c_none', studentUid: 's1', pin: '123456' })
      ).rejects.toThrow('Class not found.');
    });

    it('throws error if pin does not match teacher emergency pin', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherBypassPin: '654321' }),
      });
      await expect(
        handleVerifyTeacherPasskeyBypassPin({ classId: 'c1', studentUid: 's1', pin: '111111' })
      ).rejects.toThrow('Invalid teacher emergency PIN.');
    });

    it('grants temporary lesson bypass when PIN matches', async () => {
      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherBypassPin: '889900' }),
      });

      const res = await handleVerifyTeacherPasskeyBypassPin({
        classId: 'c1',
        studentUid: 'alex',
        pin: '889900',
        reason: 'Aisle bypass',
        deskNumber: 'Desk 12',
      });

      expect(res.success).toBe(true);
      expect(res.expiresAtMillis).toBeGreaterThan(Date.now());
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          passkeyBypass: expect.objectContaining({
            active: true,
            grantedBy: 'Teacher Emergency PIN',
            deskNumber: 'Desk 12',
          }),
        }),
        { merge: true }
      );
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'TEACHER_BYPASS_PIN_VERIFIED',
          studentUid: 'alex',
        })
      );
    });
  });

  describe('Lecture Dynamic Rotating QR Code Passkey Bingo', () => {
    describe('computeLectureQrToken & isValidLectureQrToken', () => {
      it('generates consistent 16-char hex tokens for same interval', () => {
        const secret = 'test-secret-1234567890';
        const token1 = computeLectureQrToken(secret, 100);
        const token2 = computeLectureQrToken(secret, 100);
        const tokenDiff = computeLectureQrToken(secret, 101);

        expect(token1).toBe(token2);
        expect(token1.length).toBe(16);
        expect(token1).not.toBe(tokenDiff);
      });

      it('validates current and grace interval tokens', () => {
        const secret = 'test-secret-abcdef';
        const now = 1000000;
        const currentInterval = Math.floor(now / LECTURE_QR_ROTATION_INTERVAL_MS);

        const currentToken = computeLectureQrToken(secret, currentInterval);
        const graceToken1 = computeLectureQrToken(secret, currentInterval - 1);
        const graceToken2 = computeLectureQrToken(secret, currentInterval - 2);
        const expiredToken = computeLectureQrToken(secret, currentInterval - 3);

        expect(isValidLectureQrToken(secret, currentToken, now)).toBe(true);
        expect(isValidLectureQrToken(secret, graceToken1, now)).toBe(true);
        expect(isValidLectureQrToken(secret, graceToken2, now)).toBe(true);
        expect(isValidLectureQrToken(secret, expiredToken, now)).toBe(false);
      });

      it('returns false for invalid arguments', () => {
        expect(isValidLectureQrToken('', 'abcdef1234567890')).toBe(false);
        expect(isValidLectureQrToken('secret', '')).toBe(false);
        expect(isValidLectureQrToken('secret', 'too-short')).toBe(false);
      });
    });

    describe('handleCreateLectureBingoSession', () => {
      it('creates an active lecture bingo session document', async () => {
        mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Cloud Computing' }) });

        const res = await handleCreateLectureBingoSession({
          classId: 'class_it101',
          timeLimitSeconds: 90,
          teacherUid: 'teacher_t1',
        });

        expect(res.bingoId).toBeDefined();
        expect(res.sessionSecret).toBeDefined();
        expect(res.initialToken).toBeDefined();
        expect(res.timeLimitSeconds).toBe(90);
        expect(res.expiresAtMillis).toBeGreaterThan(Date.now());

        expect(mockDocSet).toHaveBeenCalledWith(
          expect.objectContaining({
            questionSource: 'lecture_passkey_qr',
            triggerType: 'teacher_lecture_qr',
            status: 'active',
            timeLimitSeconds: 90,
          })
        );
      });

      it('throws error if class is not found', async () => {
        mockDocGet.mockResolvedValueOnce({ exists: false });
        await expect(
          handleCreateLectureBingoSession({ classId: 'c_none' })
        ).rejects.toThrow('Class not found.');
      });
    });

    describe('handleGetLecturePasskeyAuthOptions', () => {
      it('returns authentication options for a valid token and active session', async () => {
        const secret = 'secret_abc';
        const now = Date.now();
        const interval = Math.floor(now / LECTURE_QR_ROTATION_INTERVAL_MS);
        const token = computeLectureQrToken(secret, interval);

        mockDocGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            status: 'active',
            sessionSecret: secret,
            expiresAtMillis: now + 60000,
            timeLimitSeconds: 60,
          }),
        });

        const res = await handleGetLecturePasskeyAuthOptions({
          classId: 'class_it101',
          bingoId: 'bingo_lecture_1',
          token,
          clientRpId: 'it114115-2627.web.app',
        });

        expect(res.options).toBeDefined();
        expect(res.challengeId).toBeDefined();
        expect(res.bingoId).toBe('bingo_lecture_1');
        expect(mockDocSet).toHaveBeenCalledWith(
          expect.objectContaining({
            challenge: 'mock-auth-challenge',
            token,
          })
        );
      });

      it('rejects expired or invalid rotating token', async () => {
        mockDocGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            status: 'active',
            sessionSecret: 'secret_abc',
            expiresAtMillis: Date.now() + 60000,
          }),
        });

        await expect(
          handleGetLecturePasskeyAuthOptions({
            classId: 'class_it101',
            bingoId: 'bingo_lecture_1',
            token: 'invalid_token_1234',
          })
        ).rejects.toThrow('Expired or invalid QR code.');
      });
    });

    describe('handleVerifyLecturePasskeyAuth', () => {
      it('verifies student WebAuthn assertion and updates lecture records', async () => {
        const secret = 'secret_abc';
        const now = Date.now();
        const interval = Math.floor(now / LECTURE_QR_ROTATION_INTERVAL_MS);
        const token = computeLectureQrToken(secret, interval);

        // 1. Session doc
        mockDocGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            id: 'bingo_lecture_1',
            roundId: 'round_lecture_1',
            sessionSecret: secret,
            issuedAtMillis: now - 3000,
            expiresAtMillis: now + 60000,
            question: 'Lecture Hall Biometric Passkey Check-In',
            options: ['Biometric QR Check-In Verified'],
            responses: {},
          }),
        });

        // 2. Challenge doc
        mockDocGet.mockResolvedValueOnce({
          exists: true,
          data: () => ({
            challenge: 'mock-auth-challenge',
            token,
            expiresAtMillis: now + 60000,
            rpIdUsed: 'it114115-2627.web.app',
          }),
        });

        // 3. studentPasskeys lookup
        mockCollectionGet.mockResolvedValueOnce({
          empty: false,
          docs: [
            {
              id: 'student_alex',
              data: () => ({
                studentUid: 'student_alex',
                studentEmail: 'alex@vtc.edu.hk',
                credentialID: 'hardware-cred-abc',
                credentialPublicKey: Buffer.from([1, 2, 3, 4]).toString('base64'),
                counter: 0,
                deviceFingerprint: 'fp_123',
              }),
              ref: {
                update: mockDocUpdate,
              },
            },
          ],
        });

        const res = await handleVerifyLecturePasskeyAuth({
          classId: 'class_it101',
          bingoId: 'bingo_lecture_1',
          challengeId: 'chal_123',
          token,
          assertionResponse: { id: 'hardware-cred-abc' },
          clientRpId: 'it114115-2627.web.app',
          deviceFingerprint: 'fp_123',
        });

        expect(res.verified).toBe(true);
        expect(res.studentUid).toBe('student_alex');
        expect(res.studentEmail).toBe('alex@vtc.edu.hk');
        expect(res.rank).toBe(1);
        expect(res.pointsAwarded).toBe(10);
        expect(mockDocUpdate).toHaveBeenCalled();
        expect(mockDocSet).toHaveBeenCalledWith(
          expect.objectContaining({
            result: 'passed',
            status: 'completed',
            passkeyVerified: true,
            questionSource: 'lecture_passkey_qr',
          })
        );
      });
    });
  });
});


