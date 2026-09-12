import { describe, it, expect, vi } from 'vitest';

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({
  FUNCTION_REGION: 'us-central1',
  VIDEO_FRAME_RATE: 15
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      upload: vi.fn().mockResolvedValue(),
    }),
  }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: vi.fn(),
  }),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((opts, handler) => handler),
}));

import { isExamTimeRange } from './processVideoJob.js';

describe('processVideoJob - isExamTimeRange', () => {
  const sampleExamPeriods = [
    {
      id: 'exam-1',
      title: 'Midterm Exam',
      startDate: '2026-09-15T09:00:00.000Z',
      endDate: '2026-09-15T11:00:00.000Z'
    },
    {
      id: 'exam-2',
      title: 'Final Practical Exam',
      startDate: '2026-10-20T14:00:00.000Z',
      endDate: '2026-10-20T16:00:00.000Z'
    }
  ];

  it('returns false if examPeriods is empty or undefined', () => {
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', [])).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', null)).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', undefined)).toBe(false);
  });

  it('returns false for timestamps outside exam windows', () => {
    // Before midterm
    expect(isExamTimeRange('2026-09-15T07:00:00.000Z', '2026-09-15T08:30:00.000Z', sampleExamPeriods)).toBe(false);
    // After midterm
    expect(isExamTimeRange('2026-09-15T11:30:00.000Z', '2026-09-15T12:30:00.000Z', sampleExamPeriods)).toBe(false);
    // On another day
    expect(isExamTimeRange('2026-09-16T09:00:00.000Z', '2026-09-16T11:00:00.000Z', sampleExamPeriods)).toBe(false);
  });

  it('returns true when start time falls within exam period', () => {
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T11:30:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('returns true when end time falls within exam period', () => {
    expect(isExamTimeRange('2026-09-15T08:30:00.000Z', '2026-09-15T09:30:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('returns true when recording encompasses the entire exam period', () => {
    expect(isExamTimeRange('2026-09-15T08:00:00.000Z', '2026-09-15T12:00:00.000Z', sampleExamPeriods)).toBe(true);
  });

  it('handles invalid or malformed dates gracefully without crashing', () => {
    expect(isExamTimeRange('invalid-date', 'also-invalid', sampleExamPeriods)).toBe(false);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', 'invalid-end', sampleExamPeriods)).toBe(true);
    expect(isExamTimeRange('invalid-start', '2026-09-15T10:30:00.000Z', sampleExamPeriods)).toBe(true);
    expect(isExamTimeRange('2026-09-15T09:30:00.000Z', '2026-09-15T10:30:00.000Z', [{ invalid: true }])).toBe(false);
  });
});
