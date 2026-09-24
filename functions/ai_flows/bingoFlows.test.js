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
  mockBatch,
  mockFirestore,
} = vi.hoisted(() => {
  const mockDocSet = vi.fn();
  const mockDocUpdate = vi.fn();
  const mockDocGet = vi.fn();
  const mockCollectionAdd = vi.fn();
  const mockCollectionGet = vi.fn();
  const mockBatch = {
    update: vi.fn(),
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue(true),
  };

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
    batch: vi.fn(() => mockBatch),
  };

  return {
    mockDocSet,
    mockDocUpdate,
    mockDocGet,
    mockCollectionAdd,
    mockCollectionGet,
    mockBatch,
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
  enqueueScheduledBingoTask,
  handleDispatchScheduledBingo,
  handleProcessBingoJob,
  isClassSessionActive,
  resolveBingoQuestion,
  cancelActiveBingo,
  isDuplicateQuestion,
  shuffleOptionsAndCorrectIndex,
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
      expect(result.questions[0].options[result.questions[0].correctIndex]).toBe('docker ps');
      expect(result.questions[1].options[result.questions[1].correctIndex]).toBe('443');
      expect(result.questions[0].options).toHaveLength(4);
    });

    it('logs AI job and cost when classId is provided', async () => {
      const mockQuestions = [
        {
          question: 'What command shows docker containers?',
          options: ['docker ps', 'docker run', 'docker build', 'docker stop'],
          correctIndex: 0,
        },
      ];

      generateWithResilience.mockResolvedValueOnce({
        response: {
          output: { questions: mockQuestions },
          usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 40 },
        },
        modelUsed: 'gemini-3.5-flash-lite',
      });

      const result = await generateBingoQuestionBank({
        topic: 'Docker CLI',
        count: 1,
        classId: 'CLASS_TEST_AI_COST',
      });

      expect(result.questions).toHaveLength(1);
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'CLASS_TEST_AI_COST',
          jobType: 'generateBingoQuestionBank',
          status: 'completed',
        })
      );
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
      expect(studentPropsCall[0].activeBingo.result).toBeNull();
      expect(studentPropsCall[0].activeBingo.selectedIndex).toBeNull();
      expect(studentPropsCall[0].activeBingo.responseTimeSec).toBeNull();
      expect(studentPropsCall[0].activeBingo.status).toBe('pending');
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
      expect(res.rank).toBe(1);
      expect(res.pointsAwarded).toBeGreaterThan(100); // 100 base + speed bonus + rank 1 bonus
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          result: 'passed',
          selectedIndex: 2,
          responseTimeSec: 3.4,
          rank: 1,
          pointsAwarded: expect.any(Number),
        })
      );
    });

    it('computes rank 2 when another student in the same round answered faster', async () => {
      mockDocGet.mockImplementation(() => Promise.resolve({
        exists: true,
        data: () => ({
          result: 'pending',
          correctIndex: 1,
          options: ['A', 'B', 'C', 'D'],
          timeLimitSeconds: 30,
          issuedAtMillis: 1727160000000,
        }),
      }));

      // Simulate an existing faster student record in this round
      mockCollectionGet.mockImplementation(() => Promise.resolve([
        {
          id: 'faster_bingo_id',
          data: () => ({
            studentUid: 'student_faster',
            studentEmail: 'faster@stu.vtc.edu.hk',
            result: 'passed',
            responseTimeSec: 1.2,
            isCorrect: true,
          }),
        },
      ]));

      const res = await submitBingoResponse({
        classId: 'class_1',
        studentUid: 'student_slower',
        bingoId: 'bingo_slower_id',
        selectedIndex: 1,
        responseTimeSec: 4.5,
      });

      expect(res.success).toBe(true);
      expect(res.rank).toBe(2);
      expect(res.leaderboard[0].studentUid).toBe('student_faster');
      expect(res.leaderboard[1].studentUid).toBe('student_slower');
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
              isCapturing: true,
              students: { student_1: 'stu@vtc.edu.hk' },
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: true }),
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
              isCapturing: true,
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
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: true }),
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

  describe('enqueueScheduledBingoTask', () => {
    it('enqueues a task to dispatchScheduledBingoTask with scheduleDelaySeconds', async () => {
      const res = await enqueueScheduledBingoTask({
        classId: 'class_1',
        studentUid: 'stu_1',
        questionSource: 'question_bank',
        delaySeconds: 120,
      });

      expect(res.success).toBe(true);
      expect(mockTaskQueue).toHaveBeenCalledWith(
        expect.stringContaining('dispatchScheduledBingoTask')
      );
      expect(mockTaskQueueEnqueue).toHaveBeenCalledWith(
        { classId: 'class_1', studentUid: 'stu_1', questionSource: 'question_bank' },
        expect.objectContaining({
          scheduleDelaySeconds: 120,
          id: expect.stringMatching(/^auto-class_1-stu_1-/),
        })
      );
    });
  });

  describe('handleDispatchScheduledBingo', () => {
    it('skips if class is no longer capturing', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isCapturing: false }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleDispatchScheduledBingo({
        classId: 'class_1',
        studentUid: 'stu_1',
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('class_session_ended');
    });

    it('skips if student is not enrolled', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: { other_student: 'other@test.com' },
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleDispatchScheduledBingo({
        classId: 'class_1',
        studentUid: 'stu_1',
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('student_not_enrolled');
    });

    it('dispatches bingo challenge if class is capturing and student enrolled', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: { stu_1: 'stu_1@test.com' },
              questionBank: [
                { id: 'q1', question: 'What is 2+2?', options: ['3', '4'], correctIndex: 1 }
              ],
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: true }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleDispatchScheduledBingo({
        classId: 'class_1',
        studentUid: 'stu_1',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(mockDocSet).toHaveBeenCalled();
    });
  });

  describe('handleProcessBingoJob', () => {
    it('skips job if class is not capturing', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isCapturing: false }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleProcessBingoJob({
        jobId: 'job_1',
        classId: 'class_1',
        mode: 'question_bank',
        jitterMinutes: 3,
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('class_session_ended');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'skipped_session_ended' })
      );
    });

    it('dispatches immediately and simultaneously to all students (no jitter)', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: {
                stu_1: 'stu1@test.com',
                stu_2: 'stu2@test.com',
              },
              questionBank: [
                { id: 'q1', question: 'Q?', options: ['A', 'B'], correctIndex: 0 }
              ],
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: true }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      mockCollectionGet.mockImplementation((collPath) => {
        if (collPath === 'classes/class_1/status') {
          return Promise.resolve({
            forEach: vi.fn(),
          });
        }
        return Promise.resolve({ forEach: vi.fn() });
      });

      const res = await handleProcessBingoJob({
        jobId: 'job_2',
        classId: 'class_1',
        mode: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(res.totalStudentsTargeted).toBe(2);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          totalStudentsTargeted: 2,
        })
      );
    });

    it('dispatches immediately when jitterMinutes == 0', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: {
                stu_1: 'stu1@test.com',
              },
              questionBank: [
                { id: 'q1', question: 'Q?', options: ['A', 'B'], correctIndex: 0 }
              ],
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: true }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      mockCollectionGet.mockImplementation(() => Promise.resolve({ forEach: vi.fn() }));

      const res = await handleProcessBingoJob({
        jobId: 'job_3',
        classId: 'class_1',
        mode: 'question_bank',
        jitterMinutes: 0,
      });

      expect(res.success).toBe(true);
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          totalStudentsTargeted: 1,
        })
      );
    });
  });

  describe('isClassSessionActive helper (capturing and schedule enforcement)', () => {
    const fixedMonday = new Date('2026-09-14T09:30:00Z'); // Monday 09:30 UTC

    it('Case 1: Scheduled class with active capture is active during slot, inactive when slot ends', () => {
      const classData = {
        isCapturing: true,
        schedule: {
          timeZone: 'UTC',
          startDate: '2026-09-01',
          endDate: '2026-12-31',
          timeSlots: [
            { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
          ],
        },
      };

      expect(isClassSessionActive(classData, fixedMonday)).toBe(true);

      const afterSlot = new Date('2026-09-14T10:15:00Z');
      expect(isClassSessionActive(classData, afterSlot)).toBe(false);
    });

    it('Case 2: Manual capture class without schedule stops when isCapturing is false or stale', () => {
      const classDataActive = {
        isCapturing: true,
        captureStartedAt: { toMillis: () => fixedMonday.getTime() - (15 * 60 * 1000) },
      };
      expect(isClassSessionActive(classDataActive, fixedMonday)).toBe(true);

      const classDataStopped = {
        isCapturing: false,
      };
      expect(isClassSessionActive(classDataStopped, fixedMonday)).toBe(false);

      const classDataStale = {
        isCapturing: true,
        captureStartedAt: { toMillis: () => fixedMonday.getTime() - (4 * 60 * 60 * 1000) },
      };
      expect(isClassSessionActive(classDataStale, fixedMonday)).toBe(false);
    });

    it('Scheduled class is active during scheduled slot even if isCapturing is not set or false', () => {
      const classDataCase3 = {
        isCapturing: false,
        autoBingoMode: 'question_bank',
        schedule: {
          timeZone: 'UTC',
          startDate: '2026-09-01',
          endDate: '2026-12-31',
          timeSlots: [
            { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
          ],
        },
      };

      // During scheduled slot, scheduled class is active
      expect(isClassSessionActive(classDataCase3, fixedMonday)).toBe(true);

      // Outside scheduled slot, inactive
      const afterSlot = new Date('2026-09-14T10:05:00Z');
      expect(isClassSessionActive(classDataCase3, afterSlot)).toBe(false);
    });

    it('uses batched writes when creating challenges for multiple students in large class', async () => {
      mockDocGet.mockImplementation((path) => {
        return Promise.resolve({
          exists: true,
          data: () => ({
            students: {
              stu_1: 'alice@vtc.edu.hk',
              stu_2: 'bob@vtc.edu.hk',
              stu_3: 'charlie@vtc.edu.hk',
            },
            bingoQuestionBank: [
              {
                id: 'q_batch',
                question: 'What is Cloud Native?',
                options: ['Microservices', 'Monolith', 'Tape Drive', 'Punch Card'],
                correctIndex: 0,
              },
            ],
          }),
        });
      });

      const res = await generateBingoChallenge({
        classId: 'CLASS_LARGE',
        targetStudentUid: 'all',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(res.createdCount).toBe(3);
      expect(mockBatch.set).toHaveBeenCalledTimes(6); // 3 students * 2 writes
      expect(mockBatch.commit).toHaveBeenCalled();
    });
  });

  describe('Vision Modes: Non-Fallback to Question Bank', () => {
    it('returns null and skips when teacher_screen broadcast frame is missing', async () => {
      const q = await resolveBingoQuestion({
        classId: 'CLASS_TEST_TEACHER_SCREEN_NO_FRAME',
        studentUid: 'stu_1',
        questionSource: 'teacher_screen',
      });

      expect(q).toBeNull();
    });

    it('returns null and skips when student_screen capture is missing', async () => {
      const q = await resolveBingoQuestion({
        classId: 'CLASS_TEST_STUDENT_SCREEN_NO_CAPTURE',
        studentUid: 'stu_missing_screen',
        questionSource: 'student_screen',
      });

      expect(q).toBeNull();
    });

    it('generates dynamic question from student screen and logs AI cost', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_STUDENT_SCREEN/livePeeks/stu_live') {
          return Promise.resolve({
            exists: true,
            data: () => ({ screenshotUrl: 'https://storage.googleapis.com/bucket/live.jpg' }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      generateWithResilience.mockResolvedValueOnce({
        response: {
          output: {
            question: 'What window is currently open?',
            options: ['VS Code', 'Chrome', 'Spotify', 'Slack'],
            correctIndex: 0,
            observedEvidence: 'VS Code editor is open',
          },
          usageMetadata: { promptTokenCount: 200, candidatesTokenCount: 50 },
        },
        modelUsed: 'gemini-3.5-flash-lite',
      });

      const q = await resolveBingoQuestion({
        classId: 'CLASS_STUDENT_SCREEN',
        studentUid: 'stu_live',
        questionSource: 'student_screen',
      });

      expect(q).toBeDefined();
      expect(q.questionSource).toBe('student_screen');
      expect(mockCollectionAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'CLASS_STUDENT_SCREEN',
          studentUid: 'stu_live',
          jobType: 'generateBingoQuestion',
          status: 'completed',
        })
      );
    });

    it('generateBingoChallenge cleanly skips and does not dispatch questions when teacher screen is missing', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_TEST_NO_FRAME') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              students: { stu_1: 'stu_1@school.edu' },
            }),
          });
        }
        if (path === 'classes/CLASS_TEST_NO_FRAME/screenBroadcast/liveFrame') {
          return Promise.resolve({ exists: false });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await generateBingoChallenge({
        classId: 'CLASS_TEST_NO_FRAME',
        targetStudentUid: 'stu_1',
        questionSource: 'teacher_screen',
      });

      expect(res.success).toBe(false);
      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('teacher_screen_not_broadcasting');
    });

    it('incorporates recent teacher speech captions into teacher_screen prompt when available', async () => {
      generateWithResilience.mockResolvedValueOnce({
        response: {
          output: {
            question: 'What did the instructor state regarding Docker compose?',
            options: ['It builds multiple containers', 'It deletes volumes', 'It runs only databases', 'It formats the disk'],
            correctIndex: 0,
            observedEvidence: 'Teacher explained docker compose and terminal was showing compose.yaml',
          },
        },
      });

      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_CAPTIONS') {
          return Promise.resolve({
            exists: true,
            data: () => ({ students: { stu_1: 'stu_1@school.edu' } }),
          });
        }
        if (path === 'classes/CLASS_CAPTIONS/screenBroadcast/liveFrame') {
          return Promise.resolve({
            exists: true,
            data: () => ({ frameData: 'data:image/jpeg;base64,abc123mock' }),
          });
        }
        if (path === 'classes/CLASS_CAPTIONS/liveSubtitles/current') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              originalText: 'Now we run docker compose up',
              recentHistory: [
                { originalText: 'Make sure your compose file is saved' },
                { originalText: 'Now we run docker compose up' },
              ],
              timestamp: Date.now() - 30000, // 30 seconds ago
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const q = await resolveBingoQuestion({
        classId: 'CLASS_CAPTIONS',
        studentUid: 'stu_1',
        questionSource: 'teacher_screen',
      });

      expect(q).toBeDefined();
      expect(q.captionContext).toContain('docker compose');
      expect(generateWithResilience).toHaveBeenCalled();
      const callPrompt = generateWithResilience.mock.calls[0][0].prompt;
      expect(callPrompt[0].text).toContain('Recent Instructor Spoken Commentary:');
      expect(callPrompt[0].text).toContain('docker compose');
    });

    it('ignores stale teacher speech captions older than 5 minutes', async () => {
      generateWithResilience.mockResolvedValueOnce({
        response: {
          output: {
            question: 'What code editor is open?',
            options: ['VS Code', 'Vim', 'Emacs', 'Notepad'],
            correctIndex: 0,
            observedEvidence: 'VS Code visible on screen',
          },
        },
      });

      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_STALE_CAPTIONS') {
          return Promise.resolve({
            exists: true,
            data: () => ({ students: { stu_1: 'stu_1@school.edu' } }),
          });
        }
        if (path === 'classes/CLASS_STALE_CAPTIONS/screenBroadcast/liveFrame') {
          return Promise.resolve({
            exists: true,
            data: () => ({ frameData: 'data:image/jpeg;base64,abc123mock' }),
          });
        }
        if (path === 'classes/CLASS_STALE_CAPTIONS/liveSubtitles/current') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              originalText: 'Old explanation from 10 minutes ago',
              timestamp: Date.now() - (10 * 60 * 1000), // 10 minutes ago
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const q = await resolveBingoQuestion({
        classId: 'CLASS_STALE_CAPTIONS',
        studentUid: 'stu_1',
        questionSource: 'teacher_screen',
      });

      expect(q).toBeDefined();
      expect(q.captionContext).toBeNull();
      const callPrompt = generateWithResilience.mock.calls[0][0].prompt;
      expect(callPrompt[0].text).not.toContain('Recent Instructor Spoken Commentary:');
    });

    it('injects anti-duplication rules into prompt and retries when duplicate question is generated', async () => {
      // First attempt returns duplicate, second attempt returns distinct question
      generateWithResilience
        .mockResolvedValueOnce({
          response: {
            output: {
              question: 'What is the main topic of the LinkedIn post shared on the screen celebrating a new certification?',
              options: ['Certification', 'Vacation', 'Dinner', 'Gaming'],
              correctIndex: 0,
              observedEvidence: 'Screen shows certification',
            },
          },
        })
        .mockResolvedValueOnce({
          response: {
            output: {
              question: 'Who is the original author of the post shown in the feed?',
              options: ['Alice Smith', 'Bob Jones', 'Charlie Brown', 'David Lee'],
              correctIndex: 0,
              observedEvidence: 'Screen shows author name',
            },
          },
        });

      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_DEDUP') {
          return Promise.resolve({
            exists: true,
            data: () => ({ students: { stu_1: 'stu_1@school.edu' } }),
          });
        }
        if (path === 'classes/CLASS_DEDUP/screenBroadcast/liveFrame') {
          return Promise.resolve({
            exists: true,
            data: () => ({ frameData: 'data:image/jpeg;base64,abc123mock' }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      mockCollectionGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_DEDUP/bingoRecords') {
          return Promise.resolve([
            {
              data: () => ({
                question: 'What is the main topic of the LinkedIn post shared on the screen celebrating a new certification?',
              }),
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const q = await resolveBingoQuestion({
        classId: 'CLASS_DEDUP',
        studentUid: 'stu_1',
        questionSource: 'teacher_screen',
      });

      expect(q).toBeDefined();
      expect(q.question).toBe('Who is the original author of the post shown in the feed?');
      expect(generateWithResilience).toHaveBeenCalledTimes(2);

      const firstCallPrompt = generateWithResilience.mock.calls[0][0].prompt[0].text;
      expect(firstCallPrompt).toContain('CRITICAL ANTI-DUPLICATION RULE:');
      expect(firstCallPrompt).toContain('What is the main topic of the LinkedIn post');

      const secondCallPrompt = generateWithResilience.mock.calls[1][0].prompt[0].text;
      expect(secondCallPrompt).toContain('ATTENTION: Your previous question was rejected because it duplicated a recent question');
    });

    describe('isDuplicateQuestion helper', () => {
      it('detects exact and case-insensitive duplicates', () => {
        const priors = ['What is the main topic of the LinkedIn post?'];
        expect(isDuplicateQuestion('What is the main topic of the LinkedIn post?', priors)).toBe(true);
        expect(isDuplicateQuestion('what is the main topic of the linkedin post?', priors)).toBe(true);
      });

      it('detects high lexical similarity (> 80% word overlap)', () => {
        const priors = ['What is the main topic of the LinkedIn post shared on the screen celebrating a new certification?'];
        const candidate = 'What is the headline topic of the LinkedIn post shared on the screen celebrating a new certification?';
        expect(isDuplicateQuestion(candidate, priors)).toBe(true);
      });

      it('allows distinct questions covering different details', () => {
        const priors = ['What is the main topic of the LinkedIn post shared on the screen celebrating a new certification?'];
        const candidate = 'Who is the author of the post shown in the feed?';
        expect(isDuplicateQuestion(candidate, priors)).toBe(false);
      });

      it('handles empty or null inputs gracefully', () => {
        expect(isDuplicateQuestion(null, ['Test?'])).toBe(false);
        expect(isDuplicateQuestion('Test?', [])).toBe(false);
        expect(isDuplicateQuestion('Test?', null)).toBe(false);
      });
    });

    describe('shuffleOptionsAndCorrectIndex helper', () => {
      it('always preserves the exact text of the correct option', () => {
        const originalOptions = ['True Answer', 'Distractor B', 'Distractor C', 'Distractor D'];
        const originalCorrectIndex = 0;

        for (let i = 0; i < 20; i++) {
          const { options, correctIndex } = shuffleOptionsAndCorrectIndex(originalOptions, originalCorrectIndex);
          expect(options).toHaveLength(4);
          expect(correctIndex).toBeGreaterThanOrEqual(0);
          expect(correctIndex).toBeLessThanOrEqual(3);
          expect(options[correctIndex]).toBe('True Answer');
        }
      });

      it('distributes the correct answer across multiple positions over multiple runs', () => {
        const originalOptions = ['Option 1', 'Option 2', 'Option 3', 'Option 4'];
        const originalCorrectIndex = 2; // 'Option 3'
        const observedPositions = new Set();

        for (let i = 0; i < 50; i++) {
          const { options, correctIndex } = shuffleOptionsAndCorrectIndex(originalOptions, originalCorrectIndex);
          expect(options[correctIndex]).toBe('Option 3');
          observedPositions.add(correctIndex);
        }

        // Over 50 iterations, it should have appeared in at least 2 distinct positions
        expect(observedPositions.size).toBeGreaterThanOrEqual(2);
      });

      it('handles single item or empty arrays safely', () => {
        expect(shuffleOptionsAndCorrectIndex([], 0)).toEqual({ options: [], correctIndex: 0 });
        expect(shuffleOptionsAndCorrectIndex(['Single'], 0)).toEqual({ options: ['Single'], correctIndex: 0 });
      });
    });
  });

  describe('Class-Level bingoTimeLimitSeconds Configuration', () => {
    it('uses classDoc.bingoTimeLimitSeconds when timeLimitSeconds is not explicitly passed', async () => {
      let savedRecord = null;
      let savedActiveBingo = null;

      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_CUSTOM_TIME') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              students: { stu_1: 'stu_1@school.edu' },
              bingoTimeLimitSeconds: 60,
              questionBank: [
                { id: 'q1', question: 'What is 3+3?', options: ['5', '6'], correctIndex: 1 }
              ],
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      mockDocSet.mockImplementation((data) => {
        if (data.question) {
          savedRecord = data;
        } else if (data.activeBingo) {
          savedActiveBingo = data.activeBingo;
        }
        return Promise.resolve();
      });

      const res = await generateBingoChallenge({
        classId: 'CLASS_CUSTOM_TIME',
        targetStudentUid: 'stu_1',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(savedRecord.timeLimitSeconds).toBe(60);
      expect(savedActiveBingo.timeLimitSeconds).toBe(60);
      expect(savedActiveBingo.expiresAtMillis - savedActiveBingo.issuedAtMillis).toBe(60000);
    });

    it('falls back to 30 seconds when neither param nor classDoc has bingoTimeLimitSeconds', async () => {
      let savedActiveBingo = null;

      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/CLASS_DEFAULT_TIME') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              students: { stu_1: 'stu_1@school.edu' },
              questionBank: [
                { id: 'q1', question: 'What is 3+3?', options: ['5', '6'], correctIndex: 1 }
              ],
            }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      mockDocSet.mockImplementation((data) => {
        if (data.activeBingo) {
          savedActiveBingo = data.activeBingo;
        }
        return Promise.resolve();
      });

      const res = await generateBingoChallenge({
        classId: 'CLASS_DEFAULT_TIME',
        targetStudentUid: 'stu_1',
        questionSource: 'question_bank',
      });

      expect(res.success).toBe(true);
      expect(savedActiveBingo.timeLimitSeconds).toBe(30);
    });
  });

  describe('cancelActiveBingo flow', () => {
    it('cancels active bingo challenges and pending retries for enrolled students', async () => {
      const mockStudentDocs = [
        {
          id: 'stu_1',
          ref: { id: 'stu_1' },
          data: () => ({
            activeBingo: { id: 'b1', status: 'pending' },
            pendingRetryBingo: true,
          }),
        },
        {
          id: 'stu_2',
          ref: { id: 'stu_2' },
          data: () => ({
            activeBingo: { id: 'b2', status: 'active' },
          }),
        },
        {
          id: 'stu_3',
          ref: { id: 'stu_3' },
          data: () => ({
            activeBingo: { id: 'b3', status: 'completed' },
            pendingRetryBingo: false,
          }),
        },
      ];

      mockCollectionGet.mockImplementation((collPath) => {
        if (collPath === 'classes/c1/studentProperties') {
          return Promise.resolve({ docs: mockStudentDocs });
        }
        if (collPath === 'bingoJobs') {
          return Promise.resolve({
            docs: [
              {
                id: 'job_pending_1',
                ref: { id: 'job_pending_1' },
                data: () => ({ status: 'pending' }),
              },
            ],
          });
        }
        return Promise.resolve({ docs: [] });
      });

      const res = await cancelActiveBingo({ classId: 'c1' });

      expect(res.success).toBe(true);
      expect(res.cancelledStudentsCount).toBe(2);
      expect(mockBatch.update).toHaveBeenCalledWith(
        mockStudentDocs[0].ref,
        expect.objectContaining({
          'activeBingo.status': 'cancelled',
          'activeBingo.result': 'cancelled',
          pendingRetryBingo: false,
          retryCancelledReason: 'teacher_cancelled',
        })
      );
      expect(mockBatch.commit).toHaveBeenCalled();
    });

    it('throws error when classId is missing', async () => {
      await expect(cancelActiveBingo({})).rejects.toThrow('classId is required');
    });
  });

  describe('Screen Broadcast & Session End Safety Preconditions', () => {
    it('handleDispatchBingoRetry aborts retry when screen is not broadcasting', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: { student_1: 'stu@vtc.edu.hk' },
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: false }), // Not broadcasting
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
        return Promise.resolve({ exists: false });
      });

      const result = await handleDispatchBingoRetry({
        classId: 'class_1',
        studentUid: 'student_1',
        priorBingoId: 'prior_1',
      });

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('screen_not_broadcasting');
      expect(mockDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          pendingRetryBingo: false,
          retryCancelledReason: 'screen_not_broadcasting',
        }),
        { merge: true }
      );
    });

    it('handleDispatchScheduledBingo aborts when screen is not broadcasting', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: { stu_1: 'stu_1@test.com' },
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: false }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleDispatchScheduledBingo({
        classId: 'class_1',
        studentUid: 'stu_1',
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('screen_not_broadcasting');
    });

    it('handleProcessBingoJob aborts and marks job skipped when screen is not broadcasting', async () => {
      mockDocGet.mockImplementation((path) => {
        if (path === 'classes/class_1') {
          return Promise.resolve({
            exists: true,
            data: () => ({
              isCapturing: true,
              students: { stu_1: 'stu_1@test.com' },
            }),
          });
        }
        if (path === 'classes/class_1/screenBroadcast/session') {
          return Promise.resolve({
            exists: true,
            data: () => ({ isBroadcasting: false }),
          });
        }
        return Promise.resolve({ exists: false });
      });

      const res = await handleProcessBingoJob({
        jobId: 'job_screen_off',
        classId: 'class_1',
      });

      expect(res.skipped).toBe(true);
      expect(res.reason).toBe('screen_not_broadcasting');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'skipped_screen_not_sharing',
        })
      );
    });
  });
});


