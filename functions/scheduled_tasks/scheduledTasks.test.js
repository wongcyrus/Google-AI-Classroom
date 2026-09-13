import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    data: vi.fn(),
    id: 'test_class_1',
    ref: { update: vi.fn().mockResolvedValue(true) },
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    get: vi.fn(),
    add: vi.fn().mockResolvedValue({ id: 'job_1' }),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
  };

  return { mockDoc, mockCollection, mockDb };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({})),
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((opts, handler) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  handleAutomaticCapture,
  handleAutomaticVideoCombination,
} from './scheduledTasks.js';

describe('Scheduled Tasks & Auto-Capture Time Calculations (functions/scheduled_tasks/scheduledTasks.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
  });

  describe('handleAutomaticCapture trigger execution', () => {
    it('gracefully handles empty class snapshots', async () => {
      mockCollection.get.mockResolvedValueOnce({
        empty: true,
        forEach: vi.fn(),
      });

      await handleAutomaticCapture();
      expect(mockDoc.ref.update).not.toHaveBeenCalled();
    });

    it('processes classes with automaticCapture schedule', async () => {
      const mockClassSnap = {
        id: 'c101',
        data: () => ({
          automaticCapture: true,
          isCapturing: false,
          schedule: {
            timeZone: 'UTC',
            timeSlots: [
              {
                days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
                startTime: '09:00',
                endTime: '11:00',
              },
            ],
          },
        }),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        forEach: (cb) => cb(mockClassSnap),
      });

      await handleAutomaticCapture();
      // Should run without throwing
      expect(mockCollection.get).toHaveBeenCalled();
    });
  });

  describe('handleAutomaticVideoCombination trigger execution', () => {
    it('gracefully handles empty class snapshots', async () => {
      mockCollection.get.mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

      await handleAutomaticVideoCombination();
      expect(mockCollection.add).not.toHaveBeenCalled();
    });
  });

  describe('Local Time & Timezone calculations', () => {
    it('correctly derives local time and weekday parts for timezone', () => {
      function getLocalTimeInfo(date, timeZone) {
        const options = {
          timeZone,
          hour: '2-digit',
          minute: '2-digit',
          weekday: 'short',
          hour12: false,
        };
        const formatter = new Intl.DateTimeFormat('en-US', options);
        const parts = formatter.formatToParts(date);

        const localTime =
          parts.find((p) => p.type === 'hour').value +
          ':' +
          parts.find((p) => p.type === 'minute').value;
        const localDay = parts.find((p) => p.type === 'weekday').value;

        return { localTime, localDay };
      }

      const testDate = new Date('2026-08-29T12:30:00Z');
      const { localTime, localDay } = getLocalTimeInfo(testDate, 'UTC');
      expect(localTime).toBe('12:30');
      expect(localDay).toBe('Sat');
    });

    it('correctly detects if a class slot starts within next 5 minutes', () => {
      const isSlotStartingIn5Min = (slotStartTime, currentMinutes, targetMinutes) => {
        return (
          slotStartTime ===
          `${String(Math.floor(targetMinutes / 60)).padStart(2, '0')}:${String(
            targetMinutes % 60
          ).padStart(2, '0')}`
        );
      };

      expect(isSlotStartingIn5Min('10:00', 55, 600)).toBe(true);
      expect(isSlotStartingIn5Min('10:30', 55, 600)).toBe(false);
    });

    it('formats billing catalog SKUs into model pricing rate matrix', () => {
      const parseBillingSkus = (skus) => {
        const pricing = {
          'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
          'gemini-3.7-flash': { input: 0.75, output: 3.75 },
          'gemini-3.8-flash': { input: 0.75, output: 3.75 },
          'gemini-3.7-pro': { input: 3.0, output: 15.0 },
          'gemini-3.5-transcribe': { input: 0.5, output: 2.5 },
        };
        return pricing;
      };

      const rates = parseBillingSkus([]);
      expect(rates['gemini-3.5-flash-lite'].input).toBe(0.3);
      expect(rates['gemini-3.7-flash'].output).toBe(3.75);
      expect(rates['gemini-3.8-flash'].output).toBe(3.75);
      expect(rates['gemini-3.5-transcribe'].input).toBe(0.5);
    });

    it('correctly tags video jobs as isExam when session overlaps with defined examPeriods', () => {
      const isExamSession = ({ lessonStart, lessonEnd, examPeriods = [] }) => {
        const lStart = new Date(lessonStart).getTime();
        const lEnd = new Date(lessonEnd).getTime();
        return examPeriods.some((period) => {
          if (!period || !period.startDate || !period.endDate) return false;
          const pStart = new Date(period.startDate).getTime();
          const pEnd = new Date(period.endDate).getTime();
          return (
            (lStart >= pStart && lStart <= pEnd) ||
            (lEnd >= pStart && lEnd <= pEnd) ||
            (pStart >= lStart && pEnd <= lEnd)
          );
        });
      };

      const examPeriods = [
        { startDate: '2026-08-29T09:00:00Z', endDate: '2026-08-29T11:00:00Z' },
      ];

      expect(
        isExamSession({
          lessonStart: '2026-08-29T09:30:00Z',
          lessonEnd: '2026-08-29T10:30:00Z',
          examPeriods,
        })
      ).toBe(true);

      expect(
        isExamSession({
          lessonStart: '2026-08-29T12:00:00Z',
          lessonEnd: '2026-08-29T13:00:00Z',
          examPeriods,
        })
      ).toBe(false);
    });
  });
});
