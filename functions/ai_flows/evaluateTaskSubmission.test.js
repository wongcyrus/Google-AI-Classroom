import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockTaskGet = vi.fn();
const mockAttemptSet = vi.fn();
const mockSubmissionSet = vi.fn();
const mockAttemptsSnap = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: vi.fn((colName) => {
      if (colName === 'classes') {
        return {
          doc: vi.fn(() => ({
            collection: vi.fn((subCol) => {
              if (subCol === 'tasks') {
                return {
                  doc: vi.fn(() => ({
                    get: mockTaskGet,
                    collection: vi.fn((subSubCol) => {
                      if (subSubCol === 'submissions') {
                        return {
                          doc: vi.fn(() => ({
                            set: mockSubmissionSet,
                            collection: vi.fn(() => ({
                              doc: vi.fn(() => ({
                                set: mockAttemptSet,
                              })),
                              get: mockAttemptsSnap,
                            })),
                          })),
                        };
                      }
                      return {};
                    }),
                  })),
                };
              }
              return {};
            }),
          })),
        };
      }
      return {};
    }),
  }),
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'test-bucket',
    }),
  }),
}));

const mockEnqueue = vi.fn().mockResolvedValue({ id: 'mock-task-id' });
const mockTaskQueue = vi.fn(() => ({
  enqueue: mockEnqueue,
}));
vi.mock('firebase-admin/functions', () => ({
  getFunctions: () => ({
    taskQueue: mockTaskQueue,
  }),
}));

const mockGenerateWithResilience = vi.fn();
vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: (...args) => mockGenerateWithResilience(...args),
}));

vi.mock('./jobLogger.js', () => ({
  logJob: vi.fn().mockResolvedValue(true),
}));

import { handleEvaluateTaskSubmission, enqueueTaskEvaluation, evaluateTaskSubmissionTask } from './evaluateTaskSubmission.js';

describe('evaluateTaskSubmission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws invalid-argument when required arguments are missing', async () => {
    await expect(handleEvaluateTaskSubmission({})).rejects.toThrow(/Missing required parameters/);
  });

  it('throws not-found when task doc does not exist', async () => {
    mockTaskGet.mockResolvedValueOnce({ exists: false });
    await expect(
      handleEvaluateTaskSubmission({ classId: 'c1', taskId: 't1', studentUid: 's1' })
    ).rejects.toThrow(/not found/i);
  });

  it('evaluates student submission and updates attempt and root submission records', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Python Flask API',
        description: 'Build a GET /ping endpoint',
        maxScore: 100,
        rubricSteps: [
          { stepNumber: 1, title: 'Flask app created', points: 50 },
          { stepNumber: 2, title: 'Endpoint returns pong', points: 50 },
        ],
        constraints: {
          attempts: { scoringStrategy: 'highest' },
        },
      }),
    });

    const mockEvaluation = {
      finalScore: 100,
      maxScore: 100,
      completionPercentage: 100,
      overallSummary: 'Student completed all Flask steps flawlessly.',
      stepResults: [
        {
          stepNumber: 1,
          title: 'Flask app created',
          status: 'completed',
          timestampInVideo: '00:45',
          scoreAwarded: 50,
          feedback: 'Flask instantiated and app.py configured properly.',
        },
        {
          stepNumber: 2,
          title: 'Endpoint returns pong',
          status: 'completed',
          timestampInVideo: '01:30',
          scoreAwarded: 50,
          feedback: 'curl localhost:5000/ping returned {"message": "pong"}.',
        },
      ],
      strengths: ['Fast execution', 'Clean code style'],
      deviationsOrErrors: [],
    };

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify(mockEvaluation),
        usage: { inputTokens: 800, outputTokens: 250 },
      },
      modelUsed: 'gemini-3.7-flash',
    });

    mockAttemptsSnap.mockResolvedValueOnce([
      {
        id: '1',
        data: () => ({
          attemptNumber: 1,
          evaluation: { finalScore: 100 },
        }),
      },
    ]);

    const res = await handleEvaluateTaskSubmission({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 1,
    });

    expect(res.success).toBe(true);
    expect(res.effectiveScore).toBe(100);
    expect(res.evaluation.finalScore).toBe(100);
    expect(mockAttemptSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'evaluated',
      }),
      { merge: true }
    );
    expect(mockSubmissionSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'evaluated',
        effectiveScore: 100,
      }),
      { merge: true }
    );
  });

  it('handles invalid JSON from LLM by generating safe fallback evaluation structure', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Task Fallback Test',
        maxScore: 100,
        rubricSteps: [{ stepNumber: 1, title: 'Step 1' }],
      }),
    });

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: 'This is invalid non-json string',
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });

    mockAttemptsSnap.mockResolvedValueOnce([]);

    const res = await handleEvaluateTaskSubmission({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 1,
    });

    expect(res.success).toBe(true);
    expect(res.evaluation.finalScore).toBe(0);
    expect(res.evaluation.deviationsOrErrors).toContain('Model returned non-JSON output.');
  });

  it('strips markdown code fence blocks and calculates scoring strategy = latest', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Task Fences Test',
        maxScore: 100,
        constraints: { attempts: { scoringStrategy: 'latest' } },
      }),
    });

    const mockEval = {
      finalScore: 75,
      maxScore: 100,
      stepResults: [],
    };

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '```json\n' + JSON.stringify(mockEval) + '\n```',
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });

    mockAttemptsSnap.mockResolvedValueOnce([
      { id: '1', data: () => ({ attemptNumber: 1, evaluation: { finalScore: 90 } }) },
      { id: '2', data: () => ({ attemptNumber: 2, evaluation: { finalScore: 75 } }) },
    ]);

    const res = await handleEvaluateTaskSubmission({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 2,
    });

    expect(res.success).toBe(true);
    expect(res.effectiveScore).toBe(75); // latest score
  });

  it('handles logJob error gracefully without failing submission evaluation', async () => {
    const { logJob } = await import('./jobLogger.js');
    vi.mocked(logJob).mockRejectedValueOnce(new Error('Log failure'));

    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Task Log Error Test',
        maxScore: 100,
      }),
    });

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ finalScore: 80, stepResults: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });

    mockAttemptsSnap.mockResolvedValueOnce([]);

    const res = await handleEvaluateTaskSubmission({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 1,
    });

    expect(res.success).toBe(true);
  });

  it('evaluateTaskSubmission onCall handler validates authentication and delegates execution', async () => {
    const { evaluateTaskSubmission } = await import('./evaluateTaskSubmission.js');

    // Unauthenticated
    await expect(
      evaluateTaskSubmission.run
        ? evaluateTaskSubmission.run({ auth: null, data: {} })
        : evaluateTaskSubmission({ auth: null, data: {} })
    ).rejects.toThrow(/authenticated/);

    // Authenticated
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'OnCall Test Task', maxScore: 100 }),
    });

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ finalScore: 90, stepResults: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });

    mockAttemptsSnap.mockResolvedValueOnce([]);

    const runFn = evaluateTaskSubmission.run || evaluateTaskSubmission;
    const res = await runFn({
      auth: { uid: 'teacher_1' },
      data: { classId: 'c1', taskId: 't1', studentUid: 's1', attemptNumber: 1, sync: true },
    });

    expect(res.success).toBe(true);
  });

  it('enqueueTaskEvaluation marks status evaluating and dispatches to Cloud Tasks queue', async () => {
    const res = await enqueueTaskEvaluation({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 1,
      compiledVideoPath: 'classes/c1/tasks/t1/submissions/s1/attempt_1.mp4',
    });

    expect(res.enqueued).toBe(true);
    expect(mockAttemptSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'evaluating' }),
      { merge: true }
    );
    expect(mockSubmissionSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'evaluating' }),
      { merge: true }
    );
    expect(mockTaskQueue).toHaveBeenCalledWith(
      expect.stringContaining('evaluateTaskSubmissionTask')
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'c1', taskId: 't1', studentUid: 's1' }),
      expect.objectContaining({ id: expect.stringContaining('eval-t1-s1-att1') })
    );
  });

  it('enqueueTaskEvaluation falls back gracefully if Cloud Tasks queue fails', async () => {
    mockTaskQueue.mockImplementationOnce(() => {
      throw new Error('Queue service unavailable');
    });

    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Fallback Task', maxScore: 100 }),
    });
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ finalScore: 75, stepResults: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });
    mockAttemptsSnap.mockResolvedValueOnce([]);

    const res = await enqueueTaskEvaluation({
      classId: 'c1',
      taskId: 't1',
      studentUid: 's1',
      attemptNumber: 1,
      compiledVideoPath: 'test.mp4',
    });

    expect(res.enqueued).toBe(false);
    expect(res.fallbackExecuted).toBe(true);
  });

  it('evaluateTaskSubmissionTask handler delegates payload to handleEvaluateTaskSubmission', async () => {
    mockTaskGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Worker Task', maxScore: 100 }),
    });
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ finalScore: 88, stepResults: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.7-flash',
    });
    mockAttemptsSnap.mockResolvedValueOnce([]);

    const workerFn = evaluateTaskSubmissionTask.run || evaluateTaskSubmissionTask;
    const res = await workerFn({
      data: {
        classId: 'c1',
        taskId: 't1',
        studentUid: 's1',
        attemptNumber: 1,
        compiledVideoPath: 'classes/c1/tasks/t1/submissions/s1/attempt_1.mp4',
      },
    });

    expect(res.success).toBe(true);
    expect(res.effectiveScore).toBe(88);
  });
});

