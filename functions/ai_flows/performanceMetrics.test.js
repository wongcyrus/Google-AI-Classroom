import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDocRef, mockAdd, mockCollection, mockDb } = vi.hoisted(() => {
  const mockDocRef = {
    update: vi.fn().mockResolvedValue(true),
  };

  const mockAdd = vi.fn().mockResolvedValue({ id: 'metric_new' });

  const mockCollection = {
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn(),
    add: mockAdd,
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
  };

  return { mockDocRef, mockAdd, mockCollection, mockDb };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => handler),
}));

import { aggregatePerformanceMetrics } from './performanceMetrics.js';

describe('aggregatePerformanceMetrics (functions/ai_flows/performanceMetrics.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
    mockCollection.orderBy.mockReturnValue(mockCollection);
    mockCollection.limit.mockReturnValue(mockCollection);
  });

  it('exits early when event has no snapshot data', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await aggregatePerformanceMetrics({ data: null });
    expect(consoleLogSpy).toHaveBeenCalledWith('No data associated with the event');
    expect(mockDb.collection).not.toHaveBeenCalled();
    consoleLogSpy.mockRestore();
  });

  it('creates a new in-progress performance metric when no active metric exists', async () => {
    mockCollection.get.mockResolvedValueOnce({
      empty: true,
      docs: [],
    });

    const timestamp = { toDate: () => new Date('2026-08-01T10:00:00Z') };
    const event = {
      data: {
        data: () => ({
          studentUid: 'student_1',
          classId: 'CLASS_A',
          currentTask: 'Task 1: Setup',
          timestamp,
        }),
      },
    };

    await aggregatePerformanceMetrics(event);

    expect(mockCollection.add).toHaveBeenCalledWith({
      studentUid: 'student_1',
      classId: 'CLASS_A',
      taskName: 'Task 1: Setup',
      startTime: timestamp,
      status: 'in-progress',
    });
  });

  it('completes the previous task and creates a new one when taskName changes', async () => {
    const prevStart = new Date('2026-08-01T10:00:00Z');
    const newTimestamp = { toDate: () => new Date('2026-08-01T10:15:00Z') };

    const activeDoc = {
      ref: mockDocRef,
      data: () => ({
        taskName: 'Task 1: Setup',
        startTime: { toDate: () => prevStart },
      }),
    };

    mockCollection.get.mockResolvedValueOnce({
      empty: false,
      docs: [activeDoc],
    });

    const event = {
      data: {
        data: () => ({
          studentUid: 'student_1',
          classId: 'CLASS_A',
          currentTask: 'Task 2: Coding',
          timestamp: newTimestamp,
        }),
      },
    };

    await aggregatePerformanceMetrics(event);

    // Old task updated to completed with 15 minutes (900 seconds) duration
    expect(mockDocRef.update).toHaveBeenCalledWith({
      status: 'completed',
      endTime: newTimestamp,
      duration: 900,
    });

    // New task added as in-progress
    expect(mockCollection.add).toHaveBeenCalledWith({
      studentUid: 'student_1',
      classId: 'CLASS_A',
      taskName: 'Task 2: Coding',
      startTime: newTimestamp,
      status: 'in-progress',
    });
  });

  it('does nothing when the currentTask has not changed', async () => {
    const activeDoc = {
      ref: mockDocRef,
      data: () => ({
        taskName: 'Task 1: Setup',
        startTime: { toDate: () => new Date('2026-08-01T10:00:00Z') },
      }),
    };

    mockCollection.get.mockResolvedValueOnce({
      empty: false,
      docs: [activeDoc],
    });

    const event = {
      data: {
        data: () => ({
          studentUid: 'student_1',
          classId: 'CLASS_A',
          currentTask: 'Task 1: Setup',
          timestamp: { toDate: () => new Date('2026-08-01T10:05:00Z') },
        }),
      },
    };

    await aggregatePerformanceMetrics(event);

    expect(mockDocRef.update).not.toHaveBeenCalled();
    expect(mockCollection.add).not.toHaveBeenCalled();
  });
});
