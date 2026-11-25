import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollection } = vi.hoisted(() => ({
  mockCollection: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => {
  return {
    getFirestore: () => ({
      collection: mockCollection,
    }),
    FieldPath: {
      documentId: vi.fn(() => '__name__'),
    },
    FieldValue: {
      serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
    },
  };
});

vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: vi.fn(async (generateConfig, model) => {
    return {
      response: {
        text: '# Lab 2: AWS & Azure Cloud\n\n## Tasks\n1. Setup MFA\n2. AWS Lab 2.1',
      },
      modelUsed: model || 'gemini-3.8-flash',
    };
  }),
}));

import { generateLabTaskPrompt } from './generateLabTaskPrompt.js';

describe('generateLabTaskPrompt Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws unauthenticated error when called without auth', async () => {
    await expect(generateLabTaskPrompt.run({ auth: null, data: { jobId: 'JOB_1' } })).rejects.toThrow(
      /authenticated/
    );
  });

  it('throws invalid-argument when jobId is missing', async () => {
    await expect(
      generateLabTaskPrompt.run({ auth: { uid: 'teacher1' }, data: {} })
    ).rejects.toThrow(/jobId/);
  });

  it('throws not-found when master videoAnalysisJob is missing', async () => {
    mockCollection.mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      }),
    });

    await expect(
      generateLabTaskPrompt.run({ auth: { uid: 'teacher1' }, data: { jobId: 'MISSING_JOB' } })
    ).rejects.toThrow(/not found/i);
  });

  it('throws failed-precondition when no completed child jobs exist', async () => {
    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerUid: 'teacher1', aiQuota: 100 }),
            }),
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ aiUsedQuota: 0 }) }),
              }),
            }),
          }),
        };
      }
      if (name === 'videoAnalysisJobs') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ classId: 'CLASS_1', aiJobIds: ['AI_1'] }),
            }),
          }),
        };
      }
      if (name === 'aiJobs') {
        return {
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              forEach: vi.fn(), // no completed jobs
            }),
          }),
        };
      }
    });

    await expect(
      generateLabTaskPrompt.run({ auth: { uid: 'teacher1' }, data: { jobId: 'JOB_1' } })
    ).rejects.toThrow(/No completed student video summaries/);
  });

  it('synthesizes prompt from completed child job summaries successfully', async () => {
    const mockAddJob = vi.fn().mockResolvedValue({ id: 'new_prompt_job_id' });
    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerUid: 'teacher1', aiQuota: 100 }),
            }),
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ aiUsedQuota: 0 }) }),
              }),
            }),
          }),
        };
      }
      if (name === 'videoAnalysisJobs') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ classId: 'CLASS_1', aiJobIds: ['AI_1'] }),
            }),
          }),
        };
      }
      if (name === 'aiJobs') {
        return {
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              forEach: (cb) => {
                cb({
                  data: () => ({
                    status: 'completed',
                    studentEmail: 'student@vtc.edu.hk',
                    studentUid: 's1',
                    result: 'Student set up MFA and passed AWS Lab 2.1.',
                  }),
                });
              },
            }),
          }),
          add: mockAddJob,
        };
      }
    });

    const result = await generateLabTaskPrompt.run({
      auth: { uid: 'teacher1' },
      data: { jobId: 'JOB_1', model: 'gemini-3.8-flash' },
    });

    expect(result).toHaveProperty('generatedPrompt');
    expect(result.generatedPrompt).toContain('# Lab 2: AWS & Azure Cloud');
    expect(result.summaryCount).toBe(1);
    expect(result.classId).toBe('CLASS_1');
    expect(result.modelUsed).toBe('gemini-3.8-flash');
    expect(mockAddJob).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'CLASS_1',
        jobType: 'generateLabTaskPrompt',
        status: 'completed',
        masterJobId: 'JOB_1',
      })
    );
  });

  it('queries aiJobs by masterJobId when aiJobIds array is missing, and strips markdown code fences', async () => {
    mockCollection.mockImplementation((name) => {
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerUid: 'teacher1', aiQuota: 100 }),
            }),
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ aiUsedQuota: 0 }) }),
              }),
            }),
          }),
        };
      }
      if (name === 'videoAnalysisJobs') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ classId: 'CLASS_LEGACY' }), // no aiJobIds
            }),
          }),
        };
      }
      if (name === 'aiJobs') {
        return {
          where: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              get: vi.fn().mockResolvedValue({
                forEach: (cb) => {
                  cb({
                    data: () => ({
                      status: 'completed',
                      result: 'Student finished SQL assignment.',
                    }),
                  });
                },
              }),
            }),
          }),
          add: vi.fn().mockRejectedValue(new Error('Quota logger error')), // test log failure
        };
      }
    });

    const { generateWithResilience } = await import('./analysisFlows.js');
    vi.mocked(generateWithResilience).mockResolvedValueOnce({
      response: {
        text: '```markdown\n# Generated Lab Prompt\nTasks\n```',
      },
      modelUsed: 'gemini-3.5-flash-lite',
    });

    const result = await generateLabTaskPrompt.run({
      auth: { uid: 'teacher1' },
      data: { jobId: 'JOB_LEGACY' },
    });

    expect(result.generatedPrompt).toBe('# Generated Lab Prompt\nTasks');
    expect(result.summaryCount).toBe(1);
  });

  it('rejects teacher who is not assigned to the class and enforces AI quota', async () => {
    mockCollection.mockImplementation((name) => {
      if (name === 'videoAnalysisJobs') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ classId: 'CLASS_OTHER', aiJobIds: ['AI_1'] }),
            }),
          }),
        };
      }
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerUid: 'other_teacher', aiQuota: 10 }),
            }),
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ aiUsedQuota: 99 }) }),
              }),
            }),
          }),
        };
      }
      return { where: vi.fn(), add: vi.fn() };
    });

    await expect(
      generateLabTaskPrompt.run({
        auth: { uid: 'teacher1', token: { role: 'teacher' } },
        data: { jobId: 'JOB_OTHER' },
      })
    ).rejects.toThrow(/Only teachers assigned to this class/);

    // Now test quota exhaustion for an authorized class teacher
    const mockAddBlocked = vi.fn().mockResolvedValue({ id: 'blocked_1' });
    mockCollection.mockImplementation((name) => {
      if (name === 'videoAnalysisJobs') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ classId: 'CLASS_FULL', aiJobIds: ['AI_1'] }),
            }),
          }),
        };
      }
      if (name === 'classes') {
        return {
          doc: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              exists: true,
              data: () => ({ ownerUid: 'teacher1', aiQuota: 10 }),
            }),
            collection: vi.fn().mockReturnValue({
              doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ aiUsedQuota: 10 }) }),
              }),
            }),
          }),
        };
      }
      if (name === 'aiJobs') {
        return {
          where: vi.fn().mockReturnValue({
            get: vi.fn().mockResolvedValue({
              forEach: (cb) => {
                cb({
                  data: () => ({
                    status: 'completed',
                    studentUid: 's1',
                    result: 'Finished step 1',
                  }),
                });
              },
            }),
          }),
          add: mockAddBlocked,
        };
      }
    });

    await expect(
      generateLabTaskPrompt.run({
        auth: { uid: 'teacher1' },
        data: { jobId: 'JOB_FULL' },
      })
    ).rejects.toThrow(/Monthly AI quota exceeded/);
    expect(mockAddBlocked).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'blocked-by-quota', jobType: 'generateLabTaskPrompt' })
    );
  });
});
