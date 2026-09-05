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

const mockCollection = vi.fn((name) => ({
  doc: mockDoc,
  add: mockAdd,
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => ({
    collection: mockCollection,
    runTransaction: vi.fn(async (cb) => {
      const transaction = {
        get: vi.fn().mockResolvedValue({ exists: false }),
        set: vi.fn(),
      };
      return cb(transaction);
    }),
  })),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
    arrayUnion: vi.fn((val) => [val]),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: vi.fn().mockResolvedValue({ email: 'student@school.edu' }),
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
  });

  describe('recordTaskDuration', () => {
    it('records task duration in performanceMetrics', async () => {
      const result = await recordTaskDuration({
        studentUid: 's1',
        classId: 'CLASS_1',
        taskName: 'AWS Academy Lab 2.1',
        durationMinutes: 35,
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

      expect(mockCollection).toHaveBeenCalledWith('classes');
      expect(result).toContain('Successfully recorded feedback for lesson');
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
  });
});
