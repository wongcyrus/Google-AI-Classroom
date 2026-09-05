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
    mockCollection.mockImplementation((name) => {
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
  });
});
