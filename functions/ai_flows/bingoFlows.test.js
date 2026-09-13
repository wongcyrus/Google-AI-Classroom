import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock genkit and analysisFlows
vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: vi.fn(),
}));

const {
  mockDocSet,
  mockDocUpdate,
  mockDocGet,
  mockCollectionAdd,
  mockCollectionGet,
  mockFirestore,
} = vi.hoisted(() => {
  const mockDocSet = vi.fn();
  const mockDocUpdate = vi.fn();
  const mockDocGet = vi.fn();
  const mockCollectionAdd = vi.fn();
  const mockCollectionGet = vi.fn();

  const mockFirestore = {
    doc: vi.fn((path) => ({
      get: () => mockDocGet(path),
      set: mockDocSet,
      update: mockDocUpdate,
    })),
    collection: vi.fn((collPath) => ({
      doc: vi.fn((id) => ({
        id: id || 'generated_bingo_id',
        set: mockDocSet,
        get: () => mockDocGet(`${collPath}/${id}`),
        update: mockDocUpdate,
      })),
      add: mockCollectionAdd,
      get: () => mockCollectionGet(collPath),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
    })),
  };

  return {
    mockDocSet,
    mockDocUpdate,
    mockDocGet,
    mockCollectionAdd,
    mockCollectionGet,
    mockFirestore,
  };
});

const { mockTaskQueueEnqueue, mockTaskQueue } = vi.hoisted(() => {
  const mockTaskQueueEnqueue = vi.fn().mockResolvedValue(undefined);
  const mockTaskQueue = vi.fn(() => ({
    enqueue: mockTaskQueueEnqueue,
  }));
  return { mockTaskQueueEnqueue, mockTaskQueue };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => mockFirestore,
  FieldValue: {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
  },
}));

vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: mockTaskQueue,
  }),
}));

vi.mock('./firebase.js', () => ({}));
vi.mock('./ai.js', () => ({
  ai: {},
  vertexAI: { model: vi.fn() },
}));

import {
  generateBingoQuestionBank,
  generateBingoChallenge,
  submitBingoResponse,
  enqueueBingoRetryTask,
  handleDispatchBingoRetry,
} from './bingoFlows.js';
import { generateWithResilience } from './analysisFlows.js';

describe('bingoFlows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateBingoQuestionBank', () => {
    it('generates multiple choice questions using Gemini structured schema', async () => {
      const mockQuestions = [
        {
          question: 'What command shows docker containers?',
          options: ['docker ps', 'docker run', 'docker build', 'docker stop'],
          correctIndex: 0,
        },
        {
          question: 'What port does HTTPS use?',
          options: ['80', '443', '22', '21'],
          correctIndex: 1,
        },
      ];

      generateWithResilience.mockResolvedValueOnce({
        response: { output: { questions: mockQuestions } },
        modelUsed: 'gemini-3.5-flash-lite',
      });

      const result = await generateBingoQuestionBank({ topic: 'Docker & Networking', count: 2 });
      expect(result.questions).toHaveLength(2);
      expect(result.questions[0].correctIndex).toBe(0);
      expect(result.questions[0].options).toHaveLength(4);
    });

    it('throws error if AI fails to return structured questions', async () => {
      generateWithResilience.mockResolvedValueOnce({
        response: { output: null },
      });

      await expect(generateBingoQuestionBank({ topic: 'Test' })).rejects.toThrow(
        'Failed to generate valid question bank format from AI'
      );
    });
  });

  describe('generateBingoChallenge', () => {
    it('creates challenge from predefined question bank and omits correctIndex from studentProperties', async () => {
      // Mock class data
      mockDocGet.mockImplementation((path) => {
        return Promise.resolve({
          exists: true,
          data: () => ({
            students: { student_1: 'alice@vtc.edu.hk' },
            bingoQuestionBank: [
              {
                id: 'q_custom',
                question: 'What is JSX?',
                options: ['Syntax extension', 'Database', 'Operating System', 'Network protocol'],
                correctIndex: 0,
              },
            ],
          }),
        });
      });

      const res = await generateBingoChallenge({
        classId: 'class_1',
        targetStudentUid: 'student_1',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(mockDocSet).toHaveBeenCalled();

      // Check studentProperties update does NOT have correctIndex
      const studentPropsCall = mockDocSet.mock.calls.find(call => call[0]?.activeBingo);
      expect(studentPropsCall).toBeDefined();
      expect(studentPropsCall[0].activeBingo.correctIndex).toBeUndefined();
      expect(studentPropsCall[0].activeBingo.question).toBe('What is JSX?');
    });

    it('falls back to default presence question if question bank is empty', async () => {
      mockDocGet.mockImplementation(() => {
        return Promise.resolve({
          exists: true,
          data: () => ({
            students: { student_1: 'bob@vtc.edu.hk' },
            bingoQuestionBank: [],
          }),
        });
      });

      const res = await generateBingoChallenge({
        classId: 'class_1',
        targetStudentUid: 'student_1',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(res.question).toContain('presence check');
    });
  });

  describe('submitBingoResponse', () => {
    it('marks passed when student selects correctIndex', async () => {
      mockDocGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => ({
          result: 'pending',
          correctIndex: 2,
          options: ['A', 'B', 'C', 'D'],
          timeLimitSeconds: 45,
          strikeNumber: 1,
        }),
      }));

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'student_1',
        bingoId: 'bingo_123',
        selectedIndex: 2,
        responseTimeSec: 3.4,
        windowFocused: true,
      });

      expect(res.success).toBe(true);
      expect(res.result).toBe('passed');
      expect(res.isCorrect).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'passed',
          selectedIndex: 2,
          responseTimeSec: 3.4,
        })
      );
    });

    it('marks failed_incorrect when wrong option is selected without triggering Strike 2 absence deduction', async () => {
      mockDocGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => ({
          result: 'pending',
          correctIndex: 0,
          options: ['Option A', 'Option B', 'Option C', 'Option D'],
          timeLimitSeconds: 45,
          strikeNumber: 1,
        }),
      }));

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'student_1',
        bingoId: 'bingo_123',
        selectedIndex: 3, // Wrong
        responseTimeSec: 5.1,
      });

      expect(res.success).toBe(true);
      expect(res.result).toBe('failed_incorrect');
      expect(res.isCorrect).toBe(false);

      // Attendance deduction was NOT triggered
      const attendanceAdjustCall = mockCollectionAdd.mock.calls.find(call => call[0]?.deductedMinutes);
      expect(attendanceAdjustCall).toBeUndefined();
    });

    it('handles Strike 1 timeout: schedules retry without deducting attendance yet', async () => {
      mockDocGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => ({
          result: 'pending',
          correctIndex: 1,
          options: ['A', 'B', 'C', 'D'],
          timeLimitSeconds: 45,
          strikeNumber: 1,
        }),
      }));

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'student_1',
        bingoId: 'bingo_strike1',
        selectedIndex: null, // Timed out
      });

      expect(res.success).toBe(true);
      expect(res.result).toBe('missed_timeout');

      // Check studentProps was updated with pending retry
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingRetryBingo: true,
        }),
        { merge: true }
      );
    });

    it('handles Strike 2 timeout: triggers confirmed absence and creates attendance adjustment', async () => {
      mockDocGet.mockImplementation((path) => Promise.resolve({
        exists: true,
        data: () => ({
          result: 'pending',
          correctIndex: 1,
          options: ['A', 'B', 'C', 'D'],
          timeLimitSeconds: 45,
          strikeNumber: 2,
          priorBingoId: 'bingo_strike1',
          issuedAtMillis: Date.now() - 300000, // 5 minutes ago
        }),
      }));

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'student_1',
        bingoId: 'bingo_strike2',
        selectedIndex: null, // Timed out on Strike 2
      });

      expect(res.success).toBe(true);
      expect(res.result).toBe('missed_timeout');

      // Attendance adjustment was recorded
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class_1',
          studentUid: 'student_1',
          reason: expect.stringContaining('Missed 2 consecutive Bingo checks'),
          deductedMinutes: expect.any(Number),
        })
      );
    });

    it('enqueues Cloud Task with custom bingoRetryDelayMinutes from classDoc', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_custom') {
          return Promise.resolve({
            exists: true,
            data: () => ({ bingoRetryDelayMinutes: 5 }),
          });
        }
        return Promise.resolve({
          exists: true,
          data: () => ({
            result: 'pending',
            correctIndex: 0,
            options: ['A', 'B', 'C', 'D'],
            timeLimitSeconds: 45,
            strikeNumber: 1,
          }),
        });
      });

      const res = await submitBingoResponse({
        classId: 'class_custom',
        studentUid: 'student_1',
        bingoId: 'bingo_strike1_custom',
        selectedIndex: null,
      });

      expect(res.success).toBe(true);
      expect(mockTaskQueueEnqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class_custom',
          studentUid: 'student_1',
          priorBingoId: 'bingo_strike1_custom',
        }),
        expect.objectContaining({
          scheduleDelaySeconds: 300, // 5 minutes = 300 seconds
        })
      );
    });
  });

  describe('enqueueBingoRetryTask', () => {
    it('enqueues task to regional task queue with sanitized task ID and min delay', async () => {
      const res = await enqueueBingoRetryTask({
        classId: 'class/test',
        studentUid: 'stu@vtc.edu.hk',
        priorBingoId: 'prior:123',
        delaySeconds: 120,
      });

      expect(res.success).toBe(true);
      expect(mockTaskQueue).toHaveBeenCalledWith(expect.stringContaining('dispatchBingoRetryTask'));
      expect(mockTaskQueueEnqueue).toHaveBeenCalledWith(
        { classId: 'class/test', studentUid: 'stu@vtc.edu.hk', priorBingoId: 'prior:123' },
        expect.objectContaining({
          scheduleDelaySeconds: 120,
          id: expect.stringMatching(/^[a-zA-Z0-9_-]+$/),
        })
      );
    });
  });

  describe('handleDispatchBingoRetry', () => {
    it('skips execution if student is no longer pending retry', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({ students: { student_1: 'stu@vtc.edu.hk' } }),
          });
        }
        if (path === 'classes/class_1/studentProperties/student_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({ pendingRetryBingo: false }), // already answered
          });
        }
        return Promise.resolve({ exists: false });
      });

      const result = await handleDispatchBingoRetry({
        classId: 'class_1',
        studentUid: 'student_1',
        priorBingoId: 'prior_1',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('already_cleared');
    });

    it('dispatches Strike 2 challenge when student is pending retry', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              students: { student_1: 'stu@vtc.edu.hk' },
            }),
          });
        }
        if (path === 'classes/class_1/studentProperties/student_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              pendingRetryBingo: true,
              priorMissedBingoId: 'prior_1',
            }),
          });
        }
        if (path === 'classes/class_1/classProperties/config') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              bingoQuestionBank: [
                { id: 'q1', question: 'Test?', options: ['1', '2', '3', '4'], correctIndex: 0 },
              ],
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const result = await handleDispatchBingoRetry({
        classId: 'class_1',
        studentUid: 'student_1',
        priorBingoId: 'prior_1',
      });

      expect(result.success).toBe(true);
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingRetryBingo: false,
        }),
        { merge: true }
      );
    });

    it('dispatches Strike 2 challenge using classes/{classId}.questionBank fallback', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              students: { student_1: 'stu@vtc.edu.hk' },
              questionBank: [
                {
                  id: 'q_root',
                  question: 'Root fallback question?',
                  options: ['A', 'B', 'C', 'D'],
                  correctIndex: 1,
                },
              ],
            }),
          });
        }
        if (path === 'classes/class_1/studentProperties/student_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              pendingRetryBingo: true,
              priorMissedBingoId: 'prior_1',
            }),
          });
        }
        if (path === 'classes/class_1/classProperties/config') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              bingoQuestionBank: [],
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const result = await handleDispatchBingoRetry({
        classId: 'class_1',
        studentUid: 'student_1',
        priorBingoId: 'prior_1',
      });

      expect(result.success).toBe(true);
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingRetryBingo: false,
        }),
        { merge: true }
      );
    });
  });

  describe('submitBingoResponse edge cases', () => {
    it('throws error when required parameters are missing', async () => {
      await expect(submitBingoResponse({ classId: 'c1' })).rejects.toThrow('required');
    });

    it('throws error when bingo record does not exist', async () => {
      mockDocGet.mockImplementation(() => Promise.resolve({ exists: false }));

      await expect(
        submitBingoResponse({
          classId: 'class_1',
          studentUid: 'stu_1',
          bingoId: 'nonexistent_id',
        })
      ).rejects.toThrow('not found');
    });

    it('returns alreadySubmitted if record is not pending', async () => {
      mockDocGet.mockImplementation(() =>
        Promise.resolve({
          exists: true,
          data: () => ({
            result: 'passed',
          }),
        })
      );

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'stu_1',
        bingoId: 'b1',
        selectedIndex: 0,
      });

      expect(res.alreadySubmitted).toBe(true);
      expect(res.result).toBe('passed');
      expect(mockDocUpdate).not.toHaveBeenCalled();
    });
  });
});
