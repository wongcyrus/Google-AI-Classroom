import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFirestoreDoc,
  mockGetFirestore,
  mockHandlers,
} = vi.hoisted(() => {
  const mockFirestoreDoc = {
    get: vi.fn(),
  };

  const mockGetFirestore = vi.fn(() => ({
    doc: vi.fn(() => mockFirestoreDoc),
    collection: vi.fn(() => ({
      doc: vi.fn(() => mockFirestoreDoc),
    })),
  }));

  const mockHandlers = {
    analyzeImageFlow: vi.fn(),
    analyzeAllImagesFlow: vi.fn(),
    analyzeFaceFallbackFlow: vi.fn(),
    analyzeAudioFlow: vi.fn(),
    generateBingoChallenge: vi.fn().mockResolvedValue({ status: 'ok' }),
    cancelActiveBingoFlow: vi.fn().mockResolvedValue({ status: 'cancelled' }),
    submitBingoResponse: vi.fn().mockResolvedValue({ status: 'submitted' }),
    generateBingoQuestionBank: vi.fn().mockResolvedValue({ questions: [] }),
    translateTeacherSpeechInternal: vi.fn().mockResolvedValue({ translations: {} }),
    handleDispatchBingoRetry: vi.fn().mockResolvedValue({ status: 'dispatched' }),
    handleProcessBingoJob: vi.fn().mockResolvedValue({ status: 'processed' }),
    handleDispatchScheduledBingo: vi.fn().mockResolvedValue({ status: 'scheduled' }),
    handleRequestPasskeyPairingToken: vi.fn().mockResolvedValue({ token: 'pair1' }),
    handleGetPasskeyRegistrationOptions: vi.fn().mockResolvedValue({ options: {} }),
    handleVerifyPasskeyRegistration: vi.fn().mockResolvedValue({ verified: true }),
    handleGetPasskeyAuthOptions: vi.fn().mockResolvedValue({ options: {} }),
    handleVerifyPasskeyAuth: vi.fn().mockResolvedValue({ verified: true }),
    handleClaimInPersonAttendance: vi.fn().mockResolvedValue({ claimed: true }),
    handleVerifyInPersonAttendanceOverride: vi.fn().mockResolvedValue({ override: true }),
    handleGetStudentPasskeyStatus: vi.fn().mockResolvedValue({ status: 'paired' }),
    handleResetStudentPasskey: vi.fn().mockResolvedValue({ reset: true }),
    handleInitiateDesktopLoginSession: vi.fn().mockResolvedValue({ session: 's1' }),
    handleGetDesktopLoginPasskeyOptions: vi.fn().mockResolvedValue({ options: {} }),
    handleVerifyDesktopLoginPasskey: vi.fn().mockResolvedValue({ verified: true }),
    handleRequestTeacherPasskeyBypass: vi.fn().mockResolvedValue({ bypass: true }),
    handleApproveTeacherPasskeyBypass: vi.fn().mockResolvedValue({ approved: true }),
    handleVerifyTeacherPasskeyBypassPin: vi.fn().mockResolvedValue({ verified: true }),
    handleToggleStudentPasskeyExemption: vi.fn().mockResolvedValue({ exempt: true }),
    handleCreateLectureBingoSession: vi.fn().mockResolvedValue({ created: true }),
    handleGetLecturePasskeyAuthOptions: vi.fn().mockResolvedValue({ options: {} }),
    handleVerifyLecturePasskeyAuth: vi.fn().mockResolvedValue({ verified: true }),
    handleReconcileLectureRecordings: vi.fn().mockResolvedValue({ reconciled: true }),
  };

  return { mockFirestoreDoc, mockGetFirestore, mockHandlers };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: mockGetFirestore,
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCallGenkit: vi.fn((opts, handler) => {
    const fn = (req) => handler(req);
    fn.__opts = opts;
    return fn;
  }),
  onCall: vi.fn((opts, handler) => {
    const fn = (req) => handler(req);
    fn.__opts = opts;
    return fn;
  }),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('firebase-functions/v2/tasks', () => ({
  onTaskDispatched: vi.fn((opts, handler) => {
    const fn = (req) => handler(req);
    fn.__opts = opts;
    return fn;
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => {
    const fn = (req) => handler(req);
    fn.__opts = opts;
    return fn;
  }),
}));

vi.mock('./analysisFlows.js', () => ({
  analyzeImageFlow: mockHandlers.analyzeImageFlow,
  analyzeAllImagesFlow: mockHandlers.analyzeAllImagesFlow,
  analyzeFaceFallbackFlow: mockHandlers.analyzeFaceFallbackFlow,
  analyzeAudioFlow: mockHandlers.analyzeAudioFlow,
}));

vi.mock('./bingoFlows.js', () => ({
  generateBingoChallenge: mockHandlers.generateBingoChallenge,
  cancelActiveBingo: mockHandlers.cancelActiveBingoFlow,
  submitBingoResponse: mockHandlers.submitBingoResponse,
  generateBingoQuestionBank: mockHandlers.generateBingoQuestionBank,
  handleDispatchBingoRetry: mockHandlers.handleDispatchBingoRetry,
  enqueueBingoRetryTask: vi.fn(),
  handleProcessBingoJob: mockHandlers.handleProcessBingoJob,
  handleDispatchScheduledBingo: mockHandlers.handleDispatchScheduledBingo,
}));

vi.mock('./subtitleFlows.js', () => ({
  translateTeacherSpeech: mockHandlers.translateTeacherSpeechInternal,
}));

vi.mock('./passkeyFlows.js', () => ({
  handleRequestPasskeyPairingToken: mockHandlers.handleRequestPasskeyPairingToken,
  handleGetPasskeyRegistrationOptions: mockHandlers.handleGetPasskeyRegistrationOptions,
  handleVerifyPasskeyRegistration: mockHandlers.handleVerifyPasskeyRegistration,
  handleGetPasskeyAuthOptions: mockHandlers.handleGetPasskeyAuthOptions,
  handleVerifyPasskeyAuth: mockHandlers.handleVerifyPasskeyAuth,
  handleClaimInPersonAttendance: mockHandlers.handleClaimInPersonAttendance,
  handleVerifyInPersonAttendanceOverride: mockHandlers.handleVerifyInPersonAttendanceOverride,
  handleGetStudentPasskeyStatus: mockHandlers.handleGetStudentPasskeyStatus,
  handleResetStudentPasskey: mockHandlers.handleResetStudentPasskey,
  handleInitiateDesktopLoginSession: mockHandlers.handleInitiateDesktopLoginSession,
  handleGetDesktopLoginPasskeyOptions: mockHandlers.handleGetDesktopLoginPasskeyOptions,
  handleVerifyDesktopLoginPasskey: mockHandlers.handleVerifyDesktopLoginPasskey,
  handleRequestTeacherPasskeyBypass: mockHandlers.handleRequestTeacherPasskeyBypass,
  handleApproveTeacherPasskeyBypass: mockHandlers.handleApproveTeacherPasskeyBypass,
  handleVerifyTeacherPasskeyBypassPin: mockHandlers.handleVerifyTeacherPasskeyBypassPin,
  handleCreateLectureBingoSession: mockHandlers.handleCreateLectureBingoSession,
  handleGetLecturePasskeyAuthOptions: mockHandlers.handleGetLecturePasskeyAuthOptions,
  handleVerifyLecturePasskeyAuth: mockHandlers.handleVerifyLecturePasskeyAuth,
  handleToggleStudentPasskeyExemption: mockHandlers.handleToggleStudentPasskeyExemption,
}));

vi.mock('./processLectureSubtitles.js', () => ({
  processLectureSubtitles: vi.fn(),
  processLectureSubtitleJob: vi.fn(),
  handleReconcileLectureRecordings: mockHandlers.handleReconcileLectureRecordings,
}));

vi.mock('./retryVideoAnalysisJob.js', () => ({
  retryVideoAnalysisJob: vi.fn(),
}));

vi.mock('./analyzeSingleVideoTask.js', () => ({
  analyzeSingleVideoTask: vi.fn(),
}));

vi.mock('./quotaTriggers.js', () => ({
  onAiJobCreated: vi.fn(),
}));

vi.mock('./triggerAutomaticAnalysis.js', () => ({
  triggerAutomaticAnalysis: vi.fn(),
}));

vi.mock('./performanceMetrics.js', () => ({
  aggregatePerformanceMetrics: vi.fn(),
}));

vi.mock('./generateLabTaskPrompt.js', () => ({
  generateLabTaskPrompt: vi.fn(),
}));

vi.mock('./evaluateTaskSubmission.js', () => ({
  evaluateTaskSubmission: vi.fn(),
  evaluateTaskSubmissionTask: vi.fn(),
  enqueueTaskEvaluation: vi.fn(),
}));

vi.mock('./extractTaskDemoSteps.js', () => ({
  extractTaskDemoSteps: vi.fn(),
}));

import {
  analyzeImage,
  analyzeAllImages,
  analyzeFaceFallback,
  analyzeAudio,
  triggerBingoCheck,
  cancelActiveBingo,
  submitBingoAnswer,
  generateQuestionBankAi,
  translateTeacherSpeech,
  dispatchBingoRetryTask,
  processBingoJob,
  dispatchScheduledBingoTask,
  requestPasskeyPairingToken,
  getPasskeyRegistrationOptions,
  verifyPasskeyRegistration,
  getPasskeyAuthOptions,
  verifyPasskeyAuth,
  claimInPersonAttendance,
  verifyInPersonAttendanceOverride,
  getStudentPasskeyStatus,
  resetStudentPasskey,
  initiateDesktopLoginSession,
  getDesktopLoginPasskeyOptions,
  verifyDesktopLoginPasskey,
  requestTeacherPasskeyBypass,
  approveTeacherPasskeyBypass,
  verifyTeacherPasskeyBypassPin,
  toggleStudentPasskeyExemption,
  createLectureBingoSession,
  getLecturePasskeyAuthOptions,
  verifyLecturePasskeyAuth,
  reconcileLectureRecordings,
} from './index.mjs';

describe('AI Flows Index Callables and Dispatches (functions/ai_flows/index.mjs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Genkit flow auth policies', () => {
    it('verifies authPolicy on analyzeImage and analyzeAllImages', () => {
      const authPolicyImg = analyzeImage.__opts.authPolicy;
      expect(authPolicyImg({ token: { role: 'teacher' } })).toBe(true);
      expect(authPolicyImg({ token: { role: 'admin' } })).toBe(true);
      expect(authPolicyImg({ token: { role: 'student' } })).toBe(false);

      const authPolicyAll = analyzeAllImages.__opts.authPolicy;
      expect(authPolicyAll({ token: { role: 'teacher' } })).toBe(true);
      expect(authPolicyAll({ token: { role: 'student' } })).toBe(false);
    });

    it('verifies authPolicy on analyzeFaceFallback and analyzeAudio', () => {
      const authFace = analyzeFaceFallback.__opts.authPolicy;
      expect(authFace({ uid: 'user_1' })).toBe(true);
      expect(authFace(null)).toBe(false);

      const authAud = analyzeAudio.__opts.authPolicy;
      expect(authAud({ uid: 'user_1' })).toBe(true);
      expect(authAud(null)).toBe(false);
    });
  });

  describe('Bingo callables & task dispatches', () => {
    it('triggerBingoCheck enforces teacher role and delegates', async () => {
      await expect(
        triggerBingoCheck({ auth: { token: { role: 'student' } }, data: { classId: 'C1' } })
      ).rejects.toThrow(/Only teachers/);

      const res = await triggerBingoCheck({
        auth: { token: { role: 'teacher' } },
        data: { classId: 'C1' },
      });
      expect(res).toEqual({ status: 'ok' });
      expect(mockHandlers.generateBingoChallenge).toHaveBeenCalledWith({ classId: 'C1' });
    });

    it('cancelActiveBingo enforces teacher role and delegates', async () => {
      await expect(
        cancelActiveBingo({ auth: { token: { role: 'student' } }, data: { classId: 'C1' } })
      ).rejects.toThrow(/Only teachers/);

      const res = await cancelActiveBingo({
        auth: { token: { role: 'teacher' } },
        data: { classId: 'C1' },
      });
      expect(res).toEqual({ status: 'cancelled' });
      expect(mockHandlers.cancelActiveBingoFlow).toHaveBeenCalledWith({ classId: 'C1' });
    });

    it('submitBingoAnswer enforces authenticated user and delegates', async () => {
      await expect(
        submitBingoAnswer({ auth: null, data: {} })
      ).rejects.toThrow(/User must be authenticated/);

      const res = await submitBingoAnswer({
        auth: { uid: 'student_1' },
        data: { classId: 'C1', bingoId: 'B1', selectedIndex: 2 },
      });
      expect(res).toEqual({ status: 'submitted' });
      expect(mockHandlers.submitBingoResponse).toHaveBeenCalledWith(
        expect.objectContaining({ studentUid: 'student_1', classId: 'C1' })
      );
    });

    it('generateQuestionBankAi enforces teacher role and delegates', async () => {
      await expect(
        generateQuestionBankAi({ auth: { token: { role: 'student' } }, data: {} })
      ).rejects.toThrow(/Only teachers/);

      const res = await generateQuestionBankAi({
        auth: { token: { role: 'teacher' } },
        data: { topic: 'Math', count: 5, classId: 'C1' },
      });
      expect(res).toEqual({ questions: [] });
    });

    it('dispatches bingo retry task and scheduled bingo task', async () => {
      const resRetry = await dispatchBingoRetryTask({
        data: { classId: 'C1', studentUid: 'S1', priorBingoId: 'B0' },
      });
      expect(resRetry).toEqual({ status: 'dispatched' });

      const resSched = await dispatchScheduledBingoTask({
        data: { classId: 'C1', studentUid: 'S1', questionSource: 'history' },
      });
      expect(resSched).toEqual({ status: 'scheduled' });

      const resJob = await processBingoJob({
        params: { jobId: 'job_1' },
        data: { data: () => ({ classId: 'C1', mode: 'auto' }) },
      });
      expect(resJob).toEqual({ status: 'processed' });
    });
  });

  describe('translateTeacherSpeech', () => {
    it('rejects unauthenticated caller', async () => {
      await expect(translateTeacherSpeech({ auth: null, data: {} })).rejects.toThrow(
        /User must be authenticated/
      );
    });

    it('allows teacher by role and delegates', async () => {
      const res = await translateTeacherSpeech({
        auth: { uid: 'teacher_1', token: { role: 'teacher', email: 'prof@school.edu' } },
        data: { classId: 'C1', text: 'Hello class' },
      });
      expect(res).toEqual({ translations: {} });
      expect(mockHandlers.translateTeacherSpeechInternal).toHaveBeenCalledWith(
        expect.objectContaining({ teacherUid: 'teacher_1', text: 'Hello class' })
      );
    });

    it('allows teacher authorized via classDoc check', async () => {
      mockFirestoreDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherEmails: ['sub@school.edu'] }),
      });

      const res = await translateTeacherSpeech({
        auth: { uid: 'sub_1', token: { email: 'sub@school.edu' } },
        data: { classId: 'C1', text: 'Good morning' },
      });
      expect(res).toEqual({ translations: {} });
    });

    it('rejects non-teacher', async () => {
      mockFirestoreDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherEmails: ['other@school.edu'] }),
      });

      await expect(
        translateTeacherSpeech({
          auth: { uid: 'student_1', token: { role: 'student', email: 'stu@school.edu' } },
          data: { classId: 'C1', text: 'Hello' },
        })
      ).rejects.toThrow(/Only teachers/);
    });
  });

  describe('Passkey flows callables', () => {
    it('requestPasskeyPairingToken enforces auth and delegates', async () => {
      await expect(requestPasskeyPairingToken({ auth: null, data: {} })).rejects.toThrow(/authenticated/);

      const res = await requestPasskeyPairingToken({
        auth: { uid: 's1', token: { email: 's1@stu.edu' } },
        data: { classId: 'C1' },
      });
      expect(res).toEqual({ token: 'pair1' });
    });

    it('delegates registration options and verification', async () => {
      const resOpt = await getPasskeyRegistrationOptions({
        auth: { uid: 's1' },
        data: { pairingToken: 'pt1' },
      });
      expect(resOpt).toEqual({ options: {} });

      const resVer = await verifyPasskeyRegistration({
        auth: { uid: 's1' },
        data: { pairingToken: 'pt1', attestationResponse: {} },
      });
      expect(resVer).toEqual({ verified: true });
    });

    it('delegates auth options and verification', async () => {
      const resOpt = await getPasskeyAuthOptions({ data: { classId: 'C1' } });
      expect(resOpt).toEqual({ options: {} });

      const resVer = await verifyPasskeyAuth({ data: { classId: 'C1', assertionResponse: {} } });
      expect(resVer).toEqual({ verified: true });
    });

    it('claimInPersonAttendance and verifyInPersonAttendanceOverride', async () => {
      await expect(claimInPersonAttendance({ auth: null, data: {} })).rejects.toThrow(/authenticated/);

      const resClaim = await claimInPersonAttendance({
        auth: { uid: 's1' },
        data: { classId: 'C1', bingoId: 'B1' },
      });
      expect(resClaim).toEqual({ claimed: true });

      // Override rejection for student
      await expect(
        verifyInPersonAttendanceOverride({
          auth: { uid: 's1', token: { role: 'student' } },
          data: { classId: 'C1' },
        })
      ).rejects.toThrow(/Only teachers/);

      // Override allowed for teacher
      const resOverride = await verifyInPersonAttendanceOverride({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'C1', studentUid: 's1' },
      });
      expect(resOverride).toEqual({ override: true });
    });

    it('getStudentPasskeyStatus delegates with fallback to auth.uid', async () => {
      await expect(getStudentPasskeyStatus({ auth: null, data: {} })).rejects.toThrow(/authenticated/);

      const res = await getStudentPasskeyStatus({
        auth: { uid: 's1' },
        data: {},
      });
      expect(res).toEqual({ status: 'paired' });
    });

    it('resetStudentPasskey enforces teacher or whitelisted self-reset', async () => {
      await expect(resetStudentPasskey({ auth: null, data: {} })).rejects.toThrow(/authenticated/);
      await expect(
        resetStudentPasskey({ auth: { uid: 'u1' }, data: {} })
      ).rejects.toThrow(/Missing studentUid/);

      // Student attempting self-reset without whitelist
      await expect(
        resetStudentPasskey({
          auth: { uid: 's1', token: { role: 'student', email: 's1@school.edu' } },
          data: { studentUid: 's1', classId: 'C1' },
        })
      ).rejects.toThrow(/Students cannot self-unlink/);

      // Teacher reset
      const res = await resetStudentPasskey({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { studentUid: 's1', classId: 'C1' },
      });
      expect(res).toEqual({ reset: true });
    });

    it('desktop login session flows', async () => {
      expect(await initiateDesktopLoginSession({ data: {} })).toEqual({ session: 's1' });
      expect(await getDesktopLoginPasskeyOptions({ data: {} })).toEqual({ options: {} });
      expect(await verifyDesktopLoginPasskey({ data: {} })).toEqual({ verified: true });
    });

    it('teacher bypass flows: request, approve, verifyPin', async () => {
      const reqRes = await requestTeacherPasskeyBypass({
        auth: { uid: 's1' },
        data: { classId: 'C1', deskNumber: 'D1' },
      });
      expect(reqRes).toEqual({ bypass: true });

      await expect(
        approveTeacherPasskeyBypass({
          auth: { uid: 's1', token: { role: 'student' } },
          data: { classId: 'C1' },
        })
      ).rejects.toThrow(/Only teachers/);

      const appRes = await approveTeacherPasskeyBypass({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'C1', studentUid: 's1' },
      });
      expect(appRes).toEqual({ approved: true });

      const pinRes = await verifyTeacherPasskeyBypassPin({
        auth: { uid: 's1' },
        data: { classId: 'C1', pin: '1234' },
      });
      expect(pinRes).toEqual({ verified: true });
    });

    it('toggleStudentPasskeyExemption allows teacher and rejects others', async () => {
      await expect(
        toggleStudentPasskeyExemption({ auth: null, data: {} })
      ).rejects.toThrow(/authenticated/);

      await expect(
        toggleStudentPasskeyExemption({
          auth: { uid: 's1', token: { role: 'student' } },
          data: { classId: 'C1' },
        })
      ).rejects.toThrow(/Only teachers/);

      const res = await toggleStudentPasskeyExemption({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'C1', studentUid: 's1', exempt: true },
      });
      expect(res).toEqual({ exempt: true });
    });

    it('lecture QR session and reconciliation callables', async () => {
      await expect(
        createLectureBingoSession({
          auth: { uid: 's1', token: { role: 'student' } },
          data: { classId: 'C1' },
        })
      ).rejects.toThrow(/Only instructors/);

      const resCreate = await createLectureBingoSession({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'C1', timeLimitSeconds: 30 },
      });
      expect(resCreate).toEqual({ created: true });

      expect(await getLecturePasskeyAuthOptions({ data: {} })).toEqual({ options: {} });
      expect(await verifyLecturePasskeyAuth({ data: {} })).toEqual({ verified: true });

      await expect(
        reconcileLectureRecordings({
          auth: { uid: 's1', token: { role: 'student' } },
          data: { classId: 'C1' },
        })
      ).rejects.toThrow(/Only teachers/);

      const resRec = await reconcileLectureRecordings({
        auth: { uid: 't1', token: { role: 'teacher' } },
        data: { classId: 'C1' },
      });
      expect(resRec).toEqual({ reconciled: true });
    });
  });
});
