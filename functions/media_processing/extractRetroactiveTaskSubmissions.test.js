import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({
  FUNCTION_REGION: 'asia-east2',
  CORS_ORIGINS: true,
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      upload: vi.fn().mockResolvedValue(),
      file: vi.fn(() => ({
        exists: vi.fn().mockResolvedValue([true]),
        download: vi.fn().mockResolvedValue(),
      })),
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: vi.fn(() => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: false }),
      })),
    })),
  }),
  FieldValue: {
    serverTimestamp: () => new Date(),
  },
}));

const mockFfmpegCommand = {
  setStartTime: vi.fn().mockReturnThis(),
  setDuration: vi.fn().mockReturnThis(),
  outputOptions: vi.fn().mockReturnThis(),
  output: vi.fn().mockReturnThis(),
  on: vi.fn(function (event, cb) {
    if (event === 'end') setTimeout(cb, 1);
    return this;
  }),
  run: vi.fn().mockReturnThis(),
};

vi.mock('fluent-ffmpeg', () => {
  const fn = vi.fn(() => mockFfmpegCommand);
  fn.setFfmpegPath = vi.fn();
  fn.ffprobe = vi.fn((path, cb) => cb(null, { format: { duration: 60, size: 100000 } }));
  return { default: fn };
});

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    statSync: vi.fn(() => ({ size: 100000 })),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => true),
  statSync: vi.fn(() => ({ size: 100000 })),
  unlinkSync: vi.fn(),
}));

import {
  sliceStudentClassVideo,
  executeExtractRetroactiveTaskSubmissions,
  extractRetroactiveTaskSubmissions,
  toMs
} from './extractRetroactiveTaskSubmissions.js';

describe('extractRetroactiveTaskSubmissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toMs timestamp helper', () => {
    it('handles various timestamp formats', () => {
      const now = new Date();
      expect(toMs(now)).toBe(now.getTime());
      expect(toMs({ toMillis: () => 12345 })).toBe(12345);
      expect(toMs({ toDate: () => new Date(67890) })).toBe(67890);
      expect(toMs(55555)).toBe(55555);
      expect(toMs(null)).toBeNaN();
    });
  });

  describe('sliceStudentClassVideo', () => {
    it('downloads, slices with ffmpeg, uploads to GCS, and updates Firestore attempt, submission, and videoJobs', async () => {
      const mockBucket = {
        file: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue([true]),
          download: vi.fn().mockResolvedValue(),
        })),
        upload: vi.fn().mockResolvedValue(),
      };

      const setAttemptMock = vi.fn().mockResolvedValue();
      const setSubMock = vi.fn().mockResolvedValue();
      const setJobMock = vi.fn().mockResolvedValue();
      const updateJobMock = vi.fn().mockResolvedValue();

      const mockDb = {
        collection: (colName) => {
          if (colName === 'classes') {
            return {
              doc: () => ({
                collection: () => ({
                  doc: () => ({
                    collection: () => ({
                      doc: () => ({
                        set: setSubMock,
                        collection: () => ({
                          doc: () => ({
                            set: setAttemptMock,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (colName === 'videoJobs') {
            return {
              doc: () => ({
                set: setJobMock,
                update: updateJobMock,
              }),
            };
          }
          return {};
        },
      };

      const sourceJob = {
        id: 'job_class_1',
        videoPath: 'videos/c1/job_class_1.mp4',
        studentEmail: 'student1@school.edu',
      };

      const result = await sliceStudentClassVideo({
        classId: 'c1',
        taskId: 'task_retro_1',
        studentUid: 's1',
        studentEmail: 'student1@school.edu',
        sourceJob,
        startSec: 10,
        durSec: 30,
        attemptNumber: 1,
        bucket: mockBucket,
        dbInstance: mockDb,
      });

      expect(result.success).toBe(true);
      expect(result.destinationPath).toBe('classes/c1/tasks/task_retro_1/submissions/s1/attempt_1.mp4');
      expect(mockBucket.file).toHaveBeenCalledWith('videos/c1/job_class_1.mp4');
      expect(mockBucket.upload).toHaveBeenCalled();
      expect(setAttemptMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'compiling_complete',
          compiledVideoPath: 'classes/c1/tasks/task_retro_1/submissions/s1/attempt_1.mp4',
          isRetroactive: true,
        }),
        { merge: true }
      );
      expect(setJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          isTaskSubmission: true,
          slicedFromClassVideo: true,
          isRetroactive: true,
          status: 'pending',
        })
      );
      expect(updateJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        })
      );
    });
  });

  describe('executeExtractRetroactiveTaskSubmissions', () => {
    it('validates required parameters', async () => {
      await expect(
        executeExtractRetroactiveTaskSubmissions({ classId: null, taskId: 't1' })
      ).rejects.toThrow();
      await expect(
        executeExtractRetroactiveTaskSubmissions({ classId: 'c1', taskId: null })
      ).rejects.toThrow();
    });

    it('processes candidates, slices clips, and marks absent students', async () => {
      const mockBucket = {
        file: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue([true]),
          download: vi.fn().mockResolvedValue(),
        })),
        upload: vi.fn().mockResolvedValue(),
      };

      const setAttemptMock = vi.fn().mockResolvedValue();
      const setSubMock = vi.fn().mockResolvedValue();
      const setJobMock = vi.fn().mockResolvedValue();
      const updateJobMock = vi.fn().mockResolvedValue();

      const candidateJobs = [
        {
          id: 'job_s1',
          data: () => ({
            classId: 'c1',
            studentUid: 's1',
            studentEmail: 's1@test.com',
            videoPath: 'videos/c1/job_s1.mp4',
            status: 'completed',
            isTaskSubmission: false,
            duration: 1800,
            startTime: new Date('2026-10-11T10:00:00Z'),
            endTime: new Date('2026-10-11T10:30:00Z'),
          }),
        },
      ];

      const mockDb = {
        collection: (colName) => {
          if (colName === 'classes') {
            return {
              doc: (classId) => ({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({
                    id: classId,
                    name: 'Test Class',
                    students: [
                      { uid: 's1', email: 's1@test.com' },
                      { uid: 's2_absent', email: 's2@test.com' },
                    ],
                  }),
                }),
                collection: () => ({
                  doc: (taskId) => ({
                    get: vi.fn().mockResolvedValue({
                      exists: true,
                      data: () => ({ id: taskId, title: 'Retro Task', maxScore: 100 }),
                    }),
                    collection: () => ({
                      doc: () => ({
                        get: vi.fn().mockResolvedValue({ exists: false }),
                        set: setSubMock,
                        collection: () => ({
                          doc: () => ({
                            set: setAttemptMock,
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (colName === 'videoJobs') {
            return {
              where: vi.fn().mockReturnThis(),
              get: vi.fn().mockResolvedValue({
                docs: candidateJobs,
              }),
              doc: () => ({
                set: setJobMock,
                update: updateJobMock,
              }),
            };
          }
          return {};
        },
      };

      const summary = await executeExtractRetroactiveTaskSubmissions({
        classId: 'c1',
        taskId: 'retro_task_1',
        windowType: 'relative_offset',
        startOffsetSeconds: 300,
        endOffsetSeconds: 900,
        dbInstance: mockDb,
        bucketInstance: mockBucket,
      });

      expect(summary.success).toBe(true);
      expect(summary.totalCandidates).toBe(1);
      expect(summary.processedCount).toBe(1);
      expect(summary.absentCount).toBe(1);
      expect(setSubMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'missing',
          absent: true,
          isRetroactive: true,
        }),
        { merge: true }
      );
    });

    it('supports windowType absolute_time with timelapse frame rate, lessonId and sessionDate filters', async () => {
      const mockBucket = {
        file: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue([true]),
          download: vi.fn().mockResolvedValue(),
        })),
        upload: vi.fn().mockResolvedValue(),
      };

      const candidateJobs = [
        {
          id: 'job_timelapse',
          data: () => ({
            studentUid: 's1',
            videoPath: 'videos/c1/job_timelapse.mp4',
            duration: 3600,
            isTaskSubmission: false,
            lessonId: 'lesson_101',
            startTime: new Date('2026-09-10T09:00:00Z'),
            endTime: new Date('2026-09-10T11:00:00Z'),
            captureInterval: 15,
            targetFrameRate: 1,
          }),
        },
      ];

      const mockDb = {
        collection: (colName) => {
          if (colName === 'classes') {
            return {
              doc: () => ({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({
                    students: [{ uid: 's1', email: 's1@test.com' }],
                  }),
                }),
                collection: () => ({
                  doc: () => ({
                    get: vi.fn().mockResolvedValue({
                      exists: true,
                      data: () => ({ title: 'Retro Lab' }),
                    }),
                    collection: () => ({
                      doc: () => ({
                        get: vi.fn().mockResolvedValue({ exists: false }),
                        set: vi.fn().mockResolvedValue(),
                        collection: () => ({
                          doc: () => ({
                            set: vi.fn().mockResolvedValue(),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (colName === 'videoJobs') {
            return {
              where: vi.fn().mockReturnThis(),
              get: vi.fn().mockResolvedValue({ docs: candidateJobs }),
              doc: () => ({
                set: vi.fn().mockResolvedValue(),
                update: vi.fn().mockResolvedValue(),
              }),
            };
          }
          return {};
        },
      };

      const summary = await executeExtractRetroactiveTaskSubmissions({
        classId: 'c1',
        taskId: 'task_abs',
        windowType: 'absolute_time',
        startTime: '2026-09-10T09:15:00Z',
        endTime: '2026-09-10T09:45:00Z',
        lessonId: 'lesson_101',
        sessionDate: '2026-09-10',
        dbInstance: mockDb,
        bucketInstance: mockBucket,
      });

      expect(summary.success).toBe(true);
      expect(summary.totalCandidates).toBe(1);
      expect(summary.processedCount).toBe(1);
    });

    it('marks absent students when classData.students is stored as a Firestore Map { [uid]: email }', async () => {
      const setSubMock = vi.fn().mockResolvedValue();
      const mockDb = {
        collection: (colName) => {
          if (colName === 'classes') {
            return {
              doc: () => ({
                get: vi.fn().mockResolvedValue({
                  exists: true,
                  data: () => ({
                    students: {
                      uid_absent_1: 'absent1@school.edu',
                      uid_absent_2: { email: 'absent2@school.edu', displayName: 'Student Two' },
                    },
                  }),
                }),
                collection: () => ({
                  doc: () => ({
                    get: vi.fn().mockResolvedValue({
                      exists: true,
                      data: () => ({ title: 'Retro Map Test' }),
                    }),
                    collection: () => ({
                      doc: () => ({
                        get: vi.fn().mockResolvedValue({ exists: false }),
                        set: setSubMock,
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (colName === 'videoJobs') {
            return {
              where: vi.fn().mockReturnThis(),
              get: vi.fn().mockResolvedValue({ docs: [] }),
            };
          }
          return {};
        },
      };

      const summary = await executeExtractRetroactiveTaskSubmissions({
        classId: 'c1',
        taskId: 'task_map',
        dbInstance: mockDb,
        bucketInstance: {},
      });

      expect(summary.success).toBe(true);
      expect(summary.absentCount).toBe(2);
      expect(setSubMock).toHaveBeenCalledTimes(2);
      expect(setSubMock).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'missing',
          studentUid: 'uid_absent_1',
          email: 'absent1@school.edu',
          studentEmail: 'absent1@school.edu',
          absent: true,
        }),
        { merge: true }
      );
    });
  });

  describe('extractRetroactiveTaskSubmissions onCall authorization', () => {
    it('rejects unauthenticated requests', async () => {
      const handler = extractRetroactiveTaskSubmissions.run || extractRetroactiveTaskSubmissions;
      await expect(
        handler({ auth: null, data: { classId: 'c1', taskId: 't1' } })
      ).rejects.toThrow();
    });

    it('rejects request with missing classId or taskId', async () => {
      const handler = extractRetroactiveTaskSubmissions.run || extractRetroactiveTaskSubmissions;
      await expect(
        handler({ auth: { uid: 'u1' }, data: { classId: '' } })
      ).rejects.toThrow(/Missing classId or taskId/);
    });

    it('rejects non-teacher caller when not in teacherProfiles', async () => {
      const handler = extractRetroactiveTaskSubmissions.run || extractRetroactiveTaskSubmissions;
      await expect(
        handler({
          auth: { uid: 'student_1', token: { role: 'student', email: 'stu@other.com' } },
          data: { classId: 'c1', taskId: 't1' },
        })
      ).rejects.toThrow(/Only teachers can extract/);
    });

    it('allows authorized teacher caller to invoke execution', async () => {
      const handler = extractRetroactiveTaskSubmissions.run || extractRetroactiveTaskSubmissions;
      await expect(
        handler({
          auth: { uid: 'teacher_1', token: { role: 'teacher', email: 'teacher@vtc.edu.hk' } },
          data: { classId: 'non-existent-class', taskId: 't1' },
        })
      ).rejects.toThrow(/not found/);
    });
  });
});
