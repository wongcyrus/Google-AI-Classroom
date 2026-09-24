import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocGet,
  mockDocSet,
  mockCollectionGet,
  mockDoc,
  mockCollection,
  mockLoggerInfo,
  mockLoggerWarn,
  mockEnqueueTaskEvaluation,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocSet = vi.fn().mockResolvedValue({});
  const mockCollectionGet = vi.fn();
  const mockDoc = vi.fn(() => ({
    get: mockDocGet,
    set: mockDocSet,
  }));
  const mockCollection = vi.fn(() => ({
    doc: mockDoc,
    where: vi.fn().mockReturnThis(),
    get: mockCollectionGet,
  }));
  const mockLoggerInfo = vi.fn();
  const mockLoggerWarn = vi.fn();
  const mockEnqueueTaskEvaluation = vi.fn().mockResolvedValue({});

  return {
    mockDocGet,
    mockDocSet,
    mockCollectionGet,
    mockDoc,
    mockCollection,
    mockLoggerInfo,
    mockLoggerWarn,
    mockEnqueueTaskEvaluation,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP',
  },
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: mockLoggerInfo,
    warn: mockLoggerWarn,
    error: vi.fn(),
  },
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentUpdated: vi.fn((opts, handler) => handler),
}));

vi.mock('./config.js', () => ({
  FUNCTION_REGION: 'asia-east2',
}));

vi.mock('./evaluateTaskSubmission.js', () => ({
  enqueueTaskEvaluation: mockEnqueueTaskEvaluation,
}));

import { triggerAutomaticAnalysis } from './triggerAutomaticAnalysis.js';

describe('triggerAutomaticAnalysis Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockDate = new Date('2026-09-24T07:00:00.000Z');
  const mockEndDate = new Date('2026-09-24T09:00:00.000Z');
  const timestampObj = { toDate: () => mockDate };
  const endTimestampObj = { toDate: () => mockEndDate };

  it('triggers automatic analysis even if aiMonitoringMode is disabled, as long as automaticCombine and afterClassVideoPrompt are set', async () => {
    const event = {
      params: { jobId: 'videoJob_123' },
      data: {
        before: { data: () => ({ status: 'processing' }) },
        after: {
          data: () => ({
            classId: 'it3101-ab',
            startTime: timestampObj,
            endTime: endTimestampObj,
            status: 'completed',
          }),
        },
      },
    };

    // Class doc with aiMonitoringMode: 'disabled'
    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: true,
      data: () => ({
        aiMonitoringMode: 'disabled',
        automaticCombine: true,
        afterClassVideoPrompt: {
          name: 'Monitor Student Engagement',
          promptText: 'Analyze engagement and burnout.',
        },
        students: {
          uid1: 's1@stu.vtc.edu.hk',
          uid2: 's2@stu.vtc.edu.hk',
        },
        aiModel: 'gemini-3.5-flash-lite',
      }),
    }));

    // Video jobs query: both 2 students are finished
    mockCollectionGet.mockResolvedValueOnce({
      size: 2,
    });

    // Check if analysisJob exists (does not exist yet)
    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: false,
    }));

    await triggerAutomaticAnalysis(event);

    expect(mockDocSet).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'auto-analysis-it3101-ab-2026-09-24T07:00:00.000Z',
        classId: 'it3101-ab',
        requester: 'system-automatic-analysis',
        prompt: 'Analyze engagement and burnout.',
        model: 'gemini-3.5-flash-lite',
        status: 'pending',
      })
    );
  });

  it('skips when automaticCombine is false', async () => {
    const event = {
      params: { jobId: 'videoJob_123' },
      data: {
        before: { data: () => ({ status: 'processing' }) },
        after: {
          data: () => ({
            classId: 'it3101-ab',
            startTime: timestampObj,
            endTime: endTimestampObj,
            status: 'completed',
          }),
        },
      },
    };

    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: true,
      data: () => ({
        automaticCombine: false,
        afterClassVideoPrompt: { promptText: 'Check focus' },
      }),
    }));

    await triggerAutomaticAnalysis(event);

    expect(mockDocSet).not.toHaveBeenCalled();
    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringContaining('not configured for automatic analysis'));
  });

  it('skips when afterClassVideoPrompt is missing', async () => {
    const event = {
      params: { jobId: 'videoJob_123' },
      data: {
        before: { data: () => ({ status: 'processing' }) },
        after: {
          data: () => ({
            classId: 'it3101-ab',
            startTime: timestampObj,
            endTime: endTimestampObj,
            status: 'completed',
          }),
        },
      },
    };

    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: true,
      data: () => ({
        automaticCombine: true,
        afterClassVideoPrompt: null,
      }),
    }));

    await triggerAutomaticAnalysis(event);

    expect(mockDocSet).not.toHaveBeenCalled();
  });

  it('supports studentEmails array fallback if students map is empty', async () => {
    const event = {
      params: { jobId: 'videoJob_123' },
      data: {
        before: { data: () => ({ status: 'processing' }) },
        after: {
          data: () => ({
            classId: 'it3101-ab',
            startTime: timestampObj,
            endTime: endTimestampObj,
            status: 'completed',
          }),
        },
      },
    };

    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: true,
      data: () => ({
        automaticCombine: true,
        afterClassVideoPrompt: { promptText: 'Check focus' },
        students: null,
        studentEmails: ['a@school.edu', 'b@school.edu'],
      }),
    }));

    mockCollectionGet.mockResolvedValueOnce({
      size: 2,
    });

    mockDocGet.mockImplementationOnce(() => Promise.resolve({
      exists: false,
    }));

    await triggerAutomaticAnalysis(event);

    expect(mockDocSet).toHaveBeenCalled();
  });
});
