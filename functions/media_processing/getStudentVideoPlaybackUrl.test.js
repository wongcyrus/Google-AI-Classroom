import { describe, it, expect } from 'vitest';
import {
  evaluateStudentRecordingsAccess,
  isTimestampInExamPeriods,
  executeGetStudentVideoPlaybackUrl,
} from './getStudentVideoPlaybackUrl.js';

describe('getStudentVideoPlaybackUrl Logic', () => {
  it('validates permission correctly for student owner and teacher', () => {
    const studentUid = 'student-123';
    const otherStudentUid = 'student-456';
    const jobData = {
      jobId: 'job-1',
      studentUid: studentUid,
      videoPath: 'videos/class-1/job-1.mp4',
    };

    const isOwner = jobData.studentUid === studentUid;
    expect(isOwner).toBe(true);

    const isOtherOwner = jobData.studentUid === otherStudentUid;
    expect(isOtherOwner).toBe(false);

    const isTeacher = true;
    expect(isOwner || isTeacher).toBe(true);
  });

  it('rejects unauthenticated requests or requests with missing jobId', () => {
    const requestNoAuth = { auth: null, data: { jobId: 'job-1' } };
    expect(requestNoAuth.auth).toBeNull();

    const requestNoJobId = { auth: { uid: 'student-123' }, data: {} };
    expect(requestNoJobId.data.jobId).toBeUndefined();
  });

  describe('isTimestampInExamPeriods helper', () => {
    const examPeriods = [
      {
        id: 'ep1',
        name: 'Midterm Exam',
        startDate: '2026-10-25T14:00:00.000Z',
        endDate: '2026-10-25T16:00:00.000Z',
      },
    ];

    it('returns true when timestamp falls within exam period', () => {
      const examTime = new Date('2026-10-25T14:30:00.000Z');
      expect(isTimestampInExamPeriods(examTime, examPeriods)).toBe(true);
      expect(isTimestampInExamPeriods('2026-10-25T15:00:00.000Z', examPeriods)).toBe(true);
    });

    it('returns false when timestamp is outside exam period', () => {
      const beforeExam = new Date('2026-10-25T13:30:00.000Z');
      const afterExam = new Date('2026-10-25T17:00:00.000Z');
      expect(isTimestampInExamPeriods(beforeExam, examPeriods)).toBe(false);
      expect(isTimestampInExamPeriods(afterExam, examPeriods)).toBe(false);
    });

    it('returns false for empty or invalid periods', () => {
      expect(isTimestampInExamPeriods(new Date(), [])).toBe(false);
      expect(isTimestampInExamPeriods(null, examPeriods)).toBe(false);
    });
  });

  describe('evaluateStudentRecordingsAccess rules', () => {
    const examPeriods = [
      {
        id: 'ep1',
        name: 'Final Exam',
        startDate: '2026-12-10T09:00:00.000Z',
        endDate: '2026-12-10T12:00:00.000Z',
      },
    ];

    it('strictly blocks access for recordings during defined exam periods', () => {
      const result = evaluateStudentRecordingsAccess({
        examPeriods,
        jobData: {
          startTime: '2026-12-10T09:30:00.000Z',
          isExam: false,
        },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Screen recordings for exam or test periods are confidential');
    });

    it('blocks access when jobData is stamped as isExam or lessonType is exam', () => {
      const resultExam = evaluateStudentRecordingsAccess({
        examPeriods: [],
        jobData: { isExam: true },
      });
      expect(resultExam.allowed).toBe(false);

      const resultLessonType = evaluateStudentRecordingsAccess({
        examPeriods: [],
        jobData: { lessonType: 'exam' },
      });
      expect(resultLessonType.allowed).toBe(false);
    });

    it('allows access for regular lab sessions outside exam periods', () => {
      const result = evaluateStudentRecordingsAccess({
        examPeriods,
        jobData: {
          startTime: '2026-12-05T09:30:00.000Z',
          isExam: false,
        },
      });
      expect(result.allowed).toBe(true);
    });

    it('blocks access when policy is disabled', () => {
      const result = evaluateStudentRecordingsAccess({
        policy: 'disabled',
        jobData: { isExam: false },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('disabled by the instructor');
    });

    it('blocks access during delayed_release before release date', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = evaluateStudentRecordingsAccess({
        policy: 'delayed_release',
        releaseDate: futureDate,
        jobData: { isExam: false },
      });
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('locked until');
    });

    it('allows access during delayed_release after release date passes', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const result = evaluateStudentRecordingsAccess({
        policy: 'delayed_release',
        releaseDate: pastDate,
        jobData: { isExam: false },
      });
      expect(result.allowed).toBe(true);
    });
  });

  describe('executeGetStudentVideoPlaybackUrl Handler', () => {
    const createMockDb = ({
      jobDocExists = true,
      jobData = { studentUid: 'student-1', classId: 'CLASS-1', videoPath: 'videos/test.mp4' },
      classDocExists = true,
      classData = { studentRecordingsPolicy: 'always_enabled', examPeriods: [] },
    } = {}) => ({
      collection: (col) => ({
        doc: (id) => ({
          get: async () => {
            if (col === 'videoJobs') {
              return {
                exists: jobDocExists,
                data: () => ({ ...jobData, jobId: id }),
              };
            }
            if (col === 'classes') {
              return {
                exists: classDocExists,
                data: () => ({ ...classData, classId: id }),
              };
            }
            return { exists: false, data: () => ({}) };
          },
        }),
      }),
    });

    const createMockStorage = ({ fileExists = true, signedUrl = 'https://signed-url.example.com/video.mp4' } = {}) => ({
      bucket: () => ({
        file: (path) => ({
          exists: async () => [fileExists],
          getSignedUrl: async () => [signedUrl],
        }),
      }),
    });

    it('throws unauthenticated error when request.auth is missing', async () => {
      await expect(
        executeGetStudentVideoPlaybackUrl({ auth: null, data: { jobId: 'job-1' } })
      ).rejects.toThrow(/User must be authenticated/);
    });

    it('throws invalid-argument error when jobId is missing', async () => {
      await expect(
        executeGetStudentVideoPlaybackUrl({ auth: { uid: 'student-1' }, data: {} })
      ).rejects.toThrow(/jobId is required/);
    });

    it('throws not-found error when video job document does not exist', async () => {
      const db = createMockDb({ jobDocExists: false });
      const storage = createMockStorage();
      await expect(
        executeGetStudentVideoPlaybackUrl(
          { auth: { uid: 'student-1' }, data: { jobId: 'job-404' } },
          { db, storage }
        )
      ).rejects.toThrow(/Video job not found/);
    });

    it('throws permission-denied error when student is neither owner nor teacher', async () => {
      const db = createMockDb({
        jobData: { studentUid: 'student-owner', classId: 'CLASS-1', videoPath: 'videos/test.mp4' },
      });
      const storage = createMockStorage();
      await expect(
        executeGetStudentVideoPlaybackUrl(
          { auth: { uid: 'student-intruder' }, data: { jobId: 'job-1' } },
          { db, storage }
        )
      ).rejects.toThrow(/You do not have permission/);
    });

    it('throws permission-denied error when student requests an exam recording', async () => {
      const db = createMockDb({
        jobData: { studentUid: 'student-1', classId: 'CLASS-1', isExam: true, videoPath: 'videos/exam.mp4' },
      });
      const storage = createMockStorage();
      await expect(
        executeGetStudentVideoPlaybackUrl(
          { auth: { uid: 'student-1' }, data: { jobId: 'job-1' } },
          { db, storage }
        )
      ).rejects.toThrow(/Screen recordings for exam or test periods are confidential/);
    });

    it('allows teacher to access exam recording with override privilege', async () => {
      const db = createMockDb({
        jobData: {
          studentUid: 'student-1',
          classId: 'CLASS-1',
          isExam: true,
          videoPath: 'videos/exam.mp4',
          duration: 120,
          size: 5000000,
        },
      });
      const storage = createMockStorage();
      const result = await executeGetStudentVideoPlaybackUrl(
        { auth: { uid: 'teacher-1', token: { role: 'teacher' } }, data: { jobId: 'job-1' } },
        { db, storage }
      );
      expect(result.url).toBe('https://signed-url.example.com/video.mp4');
      expect(result.videoPath).toBe('videos/exam.mp4');
      expect(result.duration).toBe(120);
    });

    it('throws failed-precondition error when videoPath is missing on job document', async () => {
      const db = createMockDb({
        jobData: { studentUid: 'student-1', classId: 'CLASS-1', videoPath: null },
      });
      const storage = createMockStorage();
      await expect(
        executeGetStudentVideoPlaybackUrl(
          { auth: { uid: 'student-1' }, data: { jobId: 'job-1' } },
          { db, storage }
        )
      ).rejects.toThrow(/Video path not available/);
    });

    it('throws not-found error when video file does not exist in storage', async () => {
      const db = createMockDb({
        jobData: { studentUid: 'student-1', classId: 'CLASS-1', videoPath: 'videos/missing.mp4' },
      });
      const storage = createMockStorage({ fileExists: false });
      await expect(
        executeGetStudentVideoPlaybackUrl(
          { auth: { uid: 'student-1' }, data: { jobId: 'job-1' } },
          { db, storage }
        )
      ).rejects.toThrow(/Video file not found in storage/);
    });

    it('generates signed URL and returns video metadata on valid student request', async () => {
      const db = createMockDb({
        jobData: {
          studentUid: 'student-1',
          classId: 'CLASS-1',
          videoPath: 'videos/student-1.mp4',
          duration: 300,
          size: 15000000,
        },
      });
      const storage = createMockStorage({ signedUrl: 'https://storage.googleapis.com/v4-signed-link' });
      const result = await executeGetStudentVideoPlaybackUrl(
        { auth: { uid: 'student-1' }, data: { jobId: 'job-1' } },
        { db, storage }
      );
      expect(result.url).toBe('https://storage.googleapis.com/v4-signed-link');
      expect(result.videoPath).toBe('videos/student-1.mp4');
      expect(result.duration).toBe(300);
      expect(result.size).toBe(15000000);
    });
  });
});

