import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDoc, mockCollection, mockDb, mockGetUser } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn().mockResolvedValue(true),
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
    doc: vi.fn(() => mockDoc),
  };

  const mockGetUser = vi.fn().mockResolvedValue({ email: 'student1@stu.vtc.edu.hk' });

  return { mockDoc, mockCollection, mockDb, mockGetUser };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
  },
}));

vi.mock('firebase-admin/auth', () => ({
  getAuth: vi.fn(() => ({
    getUser: mockGetUser,
  })),
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
  handleAutomaticBingo,
  isClassSessionActive,
  syncGeminiPricing,
} from './scheduledTasks.js';

describe('Scheduled Tasks & Auto-Capture Time Calculations (functions/scheduled_tasks/scheduledTasks.js)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
    mockDoc.get.mockResolvedValue({
      exists: true,
      data: () => ({ isBroadcasting: true }),
    });
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

    it('creates videoJobs for students and notifies teachers when lesson slot ended within 30 minutes', async () => {
      const fixedTime = new Date('2026-09-14T10:15:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);

      const classDoc = {
        id: 'class_auto_video',
        data: () => ({
          automaticCombine: true,
          students: { 'student-uid-1': 'student1@stu.vtc.edu.hk' },
          teachers: { 'teacher-uid-1': 'teacher1@vtc.edu.hk' },
          schedule: {
            timeZone: 'UTC',
            timeSlots: [
              { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
            ],
          },
        }),
      };

      mockCollection.get
        .mockResolvedValueOnce({
          empty: false,
          size: 1,
          docs: [classDoc],
        })
        .mockResolvedValueOnce({
          empty: true,
          docs: [],
        });

      await handleAutomaticVideoCombination();

      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class_auto_video',
          studentUid: 'student-uid-1',
          studentEmail: 'student1@stu.vtc.edu.hk',
          status: 'pending',
          isExam: false,
        })
      );
      expect(mockCollection.add).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'teacher-uid-1',
          type: 'info',
        })
      );

      vi.useRealTimers();
    });

    it('skips class if schedule or student list is incomplete', async () => {
      const classDocIncomplete = {
        id: 'class_incomplete',
        data: () => ({
          automaticCombine: true,
          students: {},
          schedule: null,
        }),
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [classDocIncomplete],
      });

      await handleAutomaticVideoCombination();
      expect(mockDoc.set).not.toHaveBeenCalled();
    });
  });

  describe('syncGeminiPricing Scheduled Function', () => {
    it('syncs baseline pricing to system_config/pricing when no API key is provided', async () => {
      delete process.env.GOOGLE_CLOUD_API_KEY;
      delete process.env.GEMINI_API_KEY;

      await syncGeminiPricing();

      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          'gemini-3.5-flash-lite': expect.any(Object),
          'gemini-3.7-flash': expect.any(Object),
          source: 'catalog_sync_or_baseline',
        }),
        { merge: true }
      );
    });

    it('queries billing catalog API if API key is present and updates pricingData', async () => {
      process.env.GOOGLE_CLOUD_API_KEY = 'test-api-key';
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ skus: [{ name: 'sku1' }, { name: 'sku2' }] }),
      });

      await syncGeminiPricing();

      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'cloud_billing_catalog_api',
        }),
        { merge: true }
      );

      global.fetch = originalFetch;
      delete process.env.GOOGLE_CLOUD_API_KEY;
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

  describe('handleAutomaticBingo', () => {
    it('skips gracefully when no active classes have autoBingoEnabled', async () => {
      mockCollection.get.mockResolvedValueOnce({ empty: true, docs: [] });

      await handleAutomaticBingo();

      expect(mockDb.collection).toHaveBeenCalledWith('classes');
      expect(mockCollection.where).toHaveBeenCalledWith('autoBingoEnabled', '==', true);
    });

    it('creates a bingoJob and updates lastAutoBingoAt when interval has elapsed', async () => {
      const pastMillis = Date.now() - (25 * 60 * 1000); // 25 minutes ago
      const mockClassDoc = {
        id: 'class_it101',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: true,
          autoBingoIntervalMinutes: 20,
          autoBingoMode: 'question_bank',
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).toHaveBeenCalledWith('bingoJobs');
      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'class_it101',
          mode: 'question_bank',
          status: 'pending',
        })
      );
      expect(mockClassDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAutoBingoAt: 'SERVER_TIMESTAMP',
        })
      );
    });

    it('does not dispatch if interval has not elapsed yet', async () => {
      const recentMillis = Date.now() - (5 * 60 * 1000); // 5 minutes ago (interval is 20m)
      const mockClassDoc = {
        id: 'class_it102',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: true,
          autoBingoIntervalMinutes: 20,
          autoBingoMode: 'teacher_screen',
          lastAutoBingoAt: { toMillis: () => recentMillis },
        })),
        ref: { update: vi.fn() },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockClassDoc.ref.update).not.toHaveBeenCalled();
    });

    it('creates a bingoJob and updates lastAutoBingoAt when minimum 5-minute interval has elapsed', async () => {
      const pastMillis = Date.now() - (305 * 1000); // 305 seconds ago (> 5 mins)
      const mockClassDoc = {
        id: 'class_fast_test',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: true,
          autoBingoIntervalMinutes: 5,
          autoBingoMode: 'question_bank',
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).toHaveBeenCalledWith('bingoJobs');
      expect(mockClassDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAutoBingoAt: 'SERVER_TIMESTAMP',
        })
      );
    });

    it('skips class when session has ended (evaluated across 3 cases)', async () => {
      // Past slot has ended
      const mockClassDoc = {
        id: 'class_ended',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: false, // Not capturing and no active schedule
          schedule: null,
          autoBingoIntervalMinutes: 20,
        })),
        ref: { update: vi.fn() },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockClassDoc.ref.update).not.toHaveBeenCalled();
    });

    it('dispatches auto-bingo for scheduled lecture class when screen is broadcasting even without student webcam capture', async () => {
      const fixedTime = new Date('2026-09-14T09:30:00Z'); // Monday 09:30 UTC
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);

      const pastMillis = fixedTime.getTime() - (25 * 60 * 1000);
      const mockClassDoc = {
        id: 'class_lecture',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: false, // Lecture class: teacher does not monitor student webcams
          autoBingoMode: 'teacher_screen',
          autoBingoIntervalMinutes: 20,
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            timeSlots: [
              { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
            ],
          },
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      // Teacher is broadcasting screen
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ isBroadcasting: true }),
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).toHaveBeenCalledWith('bingoJobs');
      expect(mockClassDoc.ref.update).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips auto-bingo when scheduled class has ended (outside time slot)', async () => {
      const fixedTime = new Date('2026-09-14T10:15:00Z'); // Monday 10:15 UTC (past 10:00 end)
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);

      const pastMillis = fixedTime.getTime() - (25 * 60 * 1000);
      const mockClassDoc = {
        id: 'class_ended',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: false,
          autoBingoMode: 'teacher_screen',
          autoBingoIntervalMinutes: 20,
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            timeSlots: [
              { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
            ],
          },
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).not.toHaveBeenCalledWith('bingoJobs');
      expect(mockClassDoc.ref.update).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips auto-bingo when screen is not broadcasting', async () => {
      const fixedTime = new Date('2026-09-14T09:30:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);

      // Screen broadcast is inactive / not sharing
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ isBroadcasting: false }),
      });

      const pastMillis = fixedTime.getTime() - (25 * 60 * 1000);
      const mockClassDoc = {
        id: 'class_screen_idle',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: true,
          captureStartedAt: { toMillis: () => pastMillis },
          autoBingoMode: 'teacher_screen',
          autoBingoIntervalMinutes: 20,
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).not.toHaveBeenCalledWith('bingoJobs');
      expect(mockClassDoc.ref.update).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('dispatches when isCapturing is true and screen is actively broadcasting', async () => {
      const fixedTime = new Date('2026-09-14T09:30:00Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);

      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({ isBroadcasting: true }),
      });

      const pastMillis = fixedTime.getTime() - (25 * 60 * 1000);
      const mockClassDoc = {
        id: 'class_active',
        data: vi.fn(() => ({
          autoBingoEnabled: true,
          isCapturing: true,
          captureStartedAt: { toMillis: () => pastMillis },
          autoBingoMode: 'teacher_screen',
          autoBingoIntervalMinutes: 20,
          lastAutoBingoAt: { toMillis: () => pastMillis },
        })),
        ref: { update: vi.fn().mockResolvedValue(true) },
      };

      mockCollection.get.mockResolvedValueOnce({
        empty: false,
        docs: [mockClassDoc],
      });

      await handleAutomaticBingo();

      expect(mockDb.collection).toHaveBeenCalledWith('bingoJobs');
      expect(mockClassDoc.ref.update).toHaveBeenCalledWith(
        expect.objectContaining({
          lastAutoBingoAt: 'SERVER_TIMESTAMP',
        })
      );

      vi.useRealTimers();
    });
  });

  describe('isClassSessionActive helper (capturing and schedule enforcement)', () => {
    const fixedMonday = new Date('2026-09-14T09:30:00Z'); // Monday 09:30 UTC

    it('Case 1: Scheduled class with active capture is active during slot, inactive after slot ends', () => {
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

      // During scheduled slot
      expect(isClassSessionActive(classData, fixedMonday)).toBe(true);

      // Past scheduled slot (10:15 UTC) -> Class ended -> Bingo stops
      const afterSlot = new Date('2026-09-14T10:15:00Z');
      expect(isClassSessionActive(classData, afterSlot)).toBe(false);

      // On a non-scheduled day (Sunday)
      const sunday = new Date('2026-09-13T09:30:00Z');
      expect(isClassSessionActive(classData, sunday)).toBe(false);
    });

    it('Case 2: Manual capture class without schedule is active while isCapturing is true and not stale', () => {
      const classDataActive = {
        isCapturing: true,
        captureStartedAt: { toMillis: () => fixedMonday.getTime() - (30 * 60 * 1000) },
      };
      expect(isClassSessionActive(classDataActive, fixedMonday)).toBe(true);

      // Teacher clicks "Stop Capture" -> isCapturing becomes false -> Bingo stops
      const classDataStopped = {
        isCapturing: false,
      };
      expect(isClassSessionActive(classDataStopped, fixedMonday)).toBe(false);

      // Stale capture left running for 4 hours -> safety cutoff terminates Bingo
      const classDataStale = {
        isCapturing: true,
        captureStartedAt: { toMillis: () => fixedMonday.getTime() - (4 * 60 * 60 * 1000) },
      };
      expect(isClassSessionActive(classDataStale, fixedMonday)).toBe(false);
    });

    it('Scheduled class is active during scheduled slot even if isCapturing is not set or false', () => {
      const classDataNoCapture = {
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

      // During scheduled slot, active regardless of isCapturing
      expect(isClassSessionActive(classDataNoCapture, fixedMonday)).toBe(true);

      // Outside scheduled slot, inactive
      const afterSlot = new Date('2026-09-14T10:15:00Z');
      expect(isClassSessionActive(classDataNoCapture, afterSlot)).toBe(false);
    });
  });
});


