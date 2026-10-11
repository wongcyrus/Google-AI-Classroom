import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue({});
const mockAdd = vi.fn().mockResolvedValue({ id: 'msg_1' });
const mockGet = vi.fn().mockResolvedValue({ exists: true, data: () => ({ teachers: { teacher_1: true } }) });

const mockDoc = vi.fn((id) => ({
  id: id || 'doc_123',
  get: mockGet,
  set: mockSet,
  collection: mockCollection,
}));

const mockWhereChain = () => {
  const chain = {
    where: vi.fn(() => chain),
    get: vi.fn().mockResolvedValue({ empty: true, forEach: () => {} }),
  };
  return chain;
};

let currentWhereChain = mockWhereChain();

const mockCollection = vi.fn((name) => ({
  doc: mockDoc,
  add: mockAdd,
  where: vi.fn((...args) => currentWhereChain.where(...args)),
}));

let defaultRunTransaction = vi.fn(async (cb) => {
  const transaction = {
    get: vi.fn().mockResolvedValue({ exists: false }),
    set: vi.fn(),
    update: vi.fn(),
  };
  return cb(transaction);
});
let currentRunTransaction = defaultRunTransaction;

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: mockCollection,
    runTransaction: vi.fn((...args) => currentRunTransaction(...args)),
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
    arrayUnion: vi.fn((val) => [val]),
  },
}));

const { mockGetUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn().mockResolvedValue({ email: 'student@school.edu' }),
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: mockGetUser,
  })),
}));

vi.mock('./ai.js', () => ({
  ai: {
    defineTool: vi.fn((config, fn) => fn),
    defineFlow: vi.fn((config, fn) => fn),
  },
  vertexAI: {
    model: vi.fn((m) => m),
  },
}));

import {
  recordAudioIrregularity,
  recordAudioAudit,
  sendMessageToStudent,
  recordIrregularity,
  recordVideoIrregularity,
  recordStudentProgress,
  recordScreenshotAnalysis,
  sendMessageToTeacher,
  recordActualWorkingTime,
  recordTaskDuration,
  recordLessonFeedback,
  recordLessonSummary,
} from './aiTools.js';

describe('AI Invigilation Tools (aiTools.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordAudioIrregularity', () => {
    it('successfully creates an irregularity document for multi-speaker or audio cheat detection', async () => {
      const result = await recordAudioIrregularity({
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        title: 'Multiple Voices Detected',
        message: 'Second speaker identified reading answer options.',
        audioPath: 'audio/class1/s1/rec.webm',
        classId: 'CLASS_1',
        speakerCount: 2,
        riskLevel: 'high',
        transcriptSnippet: 'Speaker 2: "Select B"',
      });

      expect(mockCollection).toHaveBeenCalledWith('irregularities');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 's1',
          email: 's1@school.edu',
          title: 'Multiple Voices Detected',
          type: 'audio',
          speakerCount: 2,
          riskLevel: 'high',
          transcriptSnippet: 'Speaker 2: "Select B"',
        })
      );
      expect(result).toContain('Successfully recorded audio irregularity');
    });

    it('returns error message if saving audio irregularity throws', async () => {
      mockAdd.mockRejectedValueOnce(new Error('Write rate limit exceeded'));

      const result = await recordAudioIrregularity({
        studentUid: 's_err',
        studentEmail: 's_err@school.edu',
        title: 'Multiple Voices Detected',
        message: 'Second speaker identified',
        audioPath: 'audio/class1/s_err/rec.webm',
        classId: 'CLASS_1',
        speakerCount: 2,
        riskLevel: 'high',
      });

      expect(result).toContain('Failed to record audio irregularity for student s_err. Error: Write rate limit exceeded');
    });
  });

  describe('recordAudioAudit', () => {
    it('saves whole exam audio audit and transcript to class audio_audits subcollection', async () => {
      const result = await recordAudioAudit({
        classId: 'CLASS_1',
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        verdict: 'clean_exam',
        speakerCount: 1,
        summary: 'No foreign voices detected throughout exam.',
        transcript: '[00:00 - 00:30] Speaker 1: "Testing audio mic."',
        audioUrl: 'gs://bucket/audio/combined.webm',
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'CLASS_1',
          studentUid: 's1',
          verdict: 'clean_exam',
          speakerCount: 1,
        }),
        { merge: true }
      );
      expect(result).toContain('Successfully saved audio audit');
    });
  });

  describe('sendMessageToStudent', () => {
    it('sends direct warning message into student messages subcollection', async () => {
      const result = await sendMessageToStudent({
        studentUid: 's1',
        message: 'Please refrain from speaking during exam.',
        classId: 'CLASS_1',
      });

      expect(mockCollection).toHaveBeenCalledWith('students');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Please refrain from speaking during exam.',
          classId: 'CLASS_1',
        })
      );
      expect(result).toContain('Successfully sent message to student');
    });
  });

  describe('recordIrregularity', () => {
    it('records single screenshot irregularity', async () => {
      const result = await recordIrregularity({
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        title: 'Non-Exam Window Detected',
        message: 'Game application active',
        imageUrl: 'screenshots/shot1.jpg',
        classId: 'CLASS_1',
      });

      expect(mockCollection).toHaveBeenCalledWith('irregularities');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 's1',
          title: 'Non-Exam Window Detected',
          imageUrl: 'screenshots/shot1.jpg',
        })
      );
      expect(result).toContain('Successfully recorded irregularity');
    });
  });

  describe('recordVideoIrregularity', () => {
    it('records video analysis irregularity with timestamp offsets', async () => {
      const result = await recordVideoIrregularity({
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        title: 'Unauthorized Collaboration',
        message: 'Student whispered to neighbor',
        classId: 'CLASS_1',
      });

      expect(mockCollection).toHaveBeenCalledWith('irregularities');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 's1',
          title: 'Unauthorized Collaboration',
          type: 'video',
        })
      );
      expect(result).toContain('Successfully recorded video irregularity');
    });
  });

  describe('recordStudentProgress', () => {
    it('records student progress document', async () => {
      const result = await recordStudentProgress({
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        progress: 'Completed Section 1',
        classId: 'CLASS_1',
      });

      expect(mockCollection).toHaveBeenCalledWith('progress');
      expect(result).toContain('Successfully recorded progress');
    });
  });

  describe('recordScreenshotAnalysis', () => {
    it('records analysis on screenshot document', async () => {
      const result = await recordScreenshotAnalysis({
        studentUid: 's1',
        classId: 'CLASS_1',
        screenshotUrl: 'shots/s1.jpg',
        currentTask: 'Writing essay introduction',
      });

      expect(mockCollection).toHaveBeenCalledWith('screenshotAnalyses');
      expect(result).toContain('Successfully recorded screenshot analysis');
    });
  });

  describe('sendMessageToTeacher', () => {
    it('records alert in teacher messages subcollection', async () => {
      const result = await sendMessageToTeacher({
        classId: 'CLASS_1',
        message: 'High rate of gaze deviation detected',
      });

      expect(mockCollection).toHaveBeenCalledWith('teachers');
      expect(result).toContain('Successfully sent message to all 1 teachers');
    });

    it('returns error when class is not found', async () => {
      mockGet.mockResolvedValueOnce({ exists: false });

      const result = await sendMessageToTeacher({
        classId: 'CLASS_NON_EXISTENT',
        message: 'Alert message',
      });

      expect(result).toContain('Class with ID CLASS_NON_EXISTENT not found.');
    });

    it('returns error when class has no teachers', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teachers: {} }),
      });

      const result = await sendMessageToTeacher({
        classId: 'CLASS_NO_TEACHERS',
        message: 'Alert message',
      });

      expect(result).toContain('No teachers found for class CLASS_NO_TEACHERS.');
    });

    it('includes student email when studentUid is provided and resolved', async () => {
      mockGetUser.mockResolvedValueOnce({ email: 'stu@school.edu' });

      const result = await sendMessageToTeacher({
        classId: 'CLASS_1',
        message: 'Student idle',
        studentUid: 'stu_123',
      });

      expect(mockGetUser).toHaveBeenCalledWith('stu_123');
      expect(result).toContain('Successfully sent message to all 1 teachers');
    });

    it('falls back to studentUid when adminAuth.getUser fails', async () => {
      mockGetUser.mockRejectedValueOnce(new Error('User not found'));

      const result = await sendMessageToTeacher({
        classId: 'CLASS_1',
        message: 'Student idle',
        studentUid: 'stu_fallback',
      });

      expect(result).toContain('Successfully sent message to all 1 teachers');
    });

    it('returns error when Firestore write throws', async () => {
      mockGet.mockRejectedValueOnce(new Error('Firestore connection lost'));

      const result = await sendMessageToTeacher({
        classId: 'CLASS_1',
        message: 'Student idle',
      });

      expect(result).toContain('Failed to send message to teachers. Error: Firestore connection lost');
    });
  });

  describe('recordActualWorkingTime', () => {
    it('records active working duration', async () => {
      const result = await recordActualWorkingTime({
        studentUid: 's1',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 45,
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(result).toContain('Successfully recorded 45 working minutes');
    });

    it('caps working duration at lesson duration if AI reports more minutes than the class', async () => {
      // Lesson is 60 minutes, AI attempts to report 150 minutes
      const result = await recordActualWorkingTime({
        studentUid: 's1',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 150,
      });

      expect(result).toContain('Successfully recorded 60 working minutes');
    });

    it('clamps working duration to physical videoJobs duration if student screencast was short', async () => {
      // Mock videoJobs returning a 1-second video (1 frame = 1 minute)
      currentWhereChain = {
        where: vi.fn(() => currentWhereChain),
        get: vi.fn().mockResolvedValue({
          empty: false,
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 's1',
                startTime: new Date('2026-08-30T09:00:00.000Z'),
                duration: 1, // 1 second
                status: 'completed',
              }),
            });
          },
        }),
      };

      const result = await recordActualWorkingTime({
        studentUid: 's1',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 50, // AI hallucinated 50 minutes
      });

      expect(result).toContain('Successfully recorded 1 working minutes');

      // Reset mock
      currentWhereChain = mockWhereChain();
    });

    it('dynamically scales clamped working time using captureInterval on videoJob', async () => {
      // 60-second video with captureInterval = 10s: 60 * 10 / 60 = 10 minutes
      currentWhereChain = {
        where: vi.fn(() => currentWhereChain),
        get: vi.fn().mockResolvedValue({
          empty: false,
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 's2',
                startTime: new Date('2026-08-30T09:00:00.000Z'),
                duration: 60,
                captureInterval: 10,
                status: 'completed',
              }),
            });
          },
        }),
      };

      const result = await recordActualWorkingTime({
        studentUid: 's2',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 45,
      });

      expect(result).toContain('Successfully recorded 10 working minutes');

      // Reset mock
      currentWhereChain = mockWhereChain();
    });

    it('reads class frameRate and clamps working minutes when videoJob lacks captureInterval', async () => {
      mockGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ frameRate: 30 }),
      });

      // 60-second video without captureInterval: 60 * 30 / 60 = 30 minutes
      currentWhereChain = {
        where: vi.fn(() => currentWhereChain),
        get: vi.fn().mockResolvedValue({
          empty: false,
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 's_fr',
                startTime: new Date('2026-08-30T09:00:00.000Z'),
                duration: 60,
                status: 'completed',
              }),
            });
          },
        }),
      };

      const result = await recordActualWorkingTime({
        studentUid: 's_fr',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 50,
      });

      expect(result).toContain('Successfully recorded 30 working minutes');

      // Reset mock
      currentWhereChain = mockWhereChain();
    });

    it('handles videoJobs query errors gracefully during working time cap check', async () => {
      currentWhereChain = {
        where: vi.fn(() => {
          throw new Error('VideoJobs index missing');
        }),
      };

      const result = await recordActualWorkingTime({
        studentUid: 's_err_vj',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 20,
      });

      expect(result).toContain('Successfully recorded 20 working minutes');

      // Reset mock
      currentWhereChain = mockWhereChain();
    });

    it('updates existing lesson doc when lesson already exists in Firestore', async () => {
      const mockUpdateTx = vi.fn();
      currentRunTransaction = vi.fn(async (cb) => {
        const transaction = {
          get: vi.fn().mockResolvedValue({
            exists: true,
            data: () => ({ students: {} }),
          }),
          set: vi.fn(),
          update: mockUpdateTx,
        };
        return cb(transaction);
      });

      const result = await recordActualWorkingTime({
        studentUid: 's_existing',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 25,
      });

      expect(result).toContain('Successfully recorded 25 working minutes');
      expect(mockUpdateTx).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          'students.s_existing.workingMinutes': 25,
        })
      );

      // Reset mock
      currentRunTransaction = defaultRunTransaction;
    });

    it('handles transaction errors gracefully and returns error message', async () => {
      currentRunTransaction = vi.fn(async () => {
        throw new Error('Firestore contention error');
      });

      const result = await recordActualWorkingTime({
        studentUid: 's_err',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 20,
      });

      expect(result).toContain('Failed to record actual working time');
      expect(result).toContain('Firestore contention error');

      // Reset mock
      currentRunTransaction = defaultRunTransaction;
    });

    it('handles error when fetching class frameRate and falls back to default 15s', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network error on class doc'));

      const result = await recordActualWorkingTime({
        studentUid: 's_fr_err',
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        workingMinutes: 30,
      });

      expect(result).toContain('Successfully recorded 30 working minutes');
    });
  });

  describe('recordTaskDuration', () => {
    it('records task duration in performanceMetrics', async () => {
      const result = await recordTaskDuration({
        studentUid: 's1',
        classId: 'CLASS_1',
        taskName: 'AWS Academy Lab 2.1',
        durationMinutes: 35,
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
      });

      expect(mockCollection).toHaveBeenCalledWith('performanceMetrics');
      expect(mockAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 's1',
          classId: 'CLASS_1',
          taskName: 'AWS Academy Lab 2.1',
          duration: 2100, // 35 * 60 seconds
          status: 'completed',
          source: 'videoAnalysis',
        })
      );
      expect(result).toContain('Successfully recorded 35 minutes for task "AWS Academy Lab 2.1"');
    });

    it('returns error message if database throws in recordTaskDuration', async () => {
      mockAdd.mockRejectedValueOnce(new Error('Quota exceeded on writes'));
      const result = await recordTaskDuration({
        studentUid: 's1',
        classId: 'CLASS_1',
        taskName: 'Lab 2',
        durationMinutes: 10,
      });
      expect(result).toContain('Failed to record task duration. Error: Quota exceeded on writes');
    });
  });

  describe('recordLessonFeedback', () => {
    it('records general lesson feedback when no studentUid is specified', async () => {
      const result = await recordLessonFeedback({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        feedback: 'Class was attentive throughout the presentation.',
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(result).toContain('Successfully recorded feedback for lesson');
    });

    it('records student-specific lesson feedback when studentUid is provided', async () => {
      const result = await recordLessonFeedback({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        studentUid: 's1',
        feedback: 'Student solved problem 3 quickly and accurately.',
      });
      expect(result).toContain('Successfully recorded feedback for lesson');
    });

    it('returns error message if Firestore throws in recordLessonFeedback', async () => {
      mockDoc.mockReturnValueOnce({
        collection: vi.fn(() => {
          throw new Error('Lesson path error');
        }),
      });

      const result = await recordLessonFeedback({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        feedback: 'Feedback error',
      });
      expect(result).toContain('Failed to record lesson feedback. Error: Lesson path error');
    });
  });

  describe('recordLessonSummary', () => {
    it('records general lesson summary when no studentUid is specified', async () => {
      const result = await recordLessonSummary({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        feedback: 'Summary of session: Algorithms and data structures overview.',
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(result).toContain('Successfully recorded summary for lesson');
    });

    it('records student-specific summary when studentUid is specified', async () => {
      const result = await recordLessonSummary({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        studentUid: 's1',
        feedback: 'Student showed mastery of sorting algorithms.',
      });

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(result).toContain('Successfully recorded summary for lesson');
    });

    it('returns error message if Firestore throws', async () => {
      mockDoc.mockReturnValueOnce({
        collection: vi.fn(() => {
          throw new Error('Firestore write failure');
        }),
      });

      const result = await recordLessonSummary({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00.000Z',
        endTime: '2026-08-30T10:00:00.000Z',
        feedback: 'Summary failed.',
      });

      expect(result).toContain('Failed to record lesson summary. Error: Firestore write failure');
    });
  });

  describe('recordAudioAudit', () => {
    it('successfully records audio audit document in classes/classId/audio_audits/studentUid', async () => {
      const result = await recordAudioAudit({
        classId: 'CLASS_1',
        studentUid: 's1',
        studentEmail: 's1@school.edu',
        verdict: 'clean_exam',
        speakerCount: 1,
        summary: 'No second speaker detected.',
        transcript: 'Student talking through logic quietly.',
        audioUrl: 'gs://bucket/audio.webm',
      });

      expect(result).toBe('Successfully saved audio audit for student s1.');
    });

    it('returns error message if saving audio audit fails', async () => {
      mockDoc.mockReturnValueOnce({
        collection: vi.fn(() => ({
          doc: vi.fn(() => {
            throw new Error('Audit write denied');
          }),
        })),
      });

      const result = await recordAudioAudit({
        classId: 'CLASS_1',
        studentUid: 's1',
        verdict: 'whisper_detected',
        speakerCount: 2,
        summary: 'Whispering detected',
        transcript: 'whisper whisper',
      });

      expect(result).toContain('Failed to save audio audit. Error: Audit write denied');
    });
  });
});

