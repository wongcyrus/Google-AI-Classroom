import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';

const { mockDoc, mockCollection, mockDb } = vi.hoisted(() => {
  const mockDoc = {
    get: vi.fn(),
    set: vi.fn(),
    collection: vi.fn(),
  };

  const mockCollection = {
    doc: vi.fn(() => mockDoc),
    where: vi.fn(),
    get: vi.fn(),
  };

  const mockDb = {
    collection: vi.fn(() => mockCollection),
  };

  return { mockDoc, mockCollection, mockDb };
});

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: vi.fn(() => mockDb),
  FieldValue: {
    arrayRemove: vi.fn(val => ({ arrayRemove: val })),
  },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((opts, handler) => handler),
  HttpsError: class extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

// Import after mocks
import { parseDateTime, getAttendanceData } from './index.mjs';

describe('Attendance Calculation Logic (functions/attendance/index.mjs)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.where.mockReturnValue(mockCollection);
    mockDoc.collection.mockReturnValue(mockCollection);
  });

  describe('parseDateTime helper', () => {
    it('returns null for null, undefined, or empty values', () => {
      expect(parseDateTime(null)).toBeNull();
      expect(parseDateTime(undefined)).toBeNull();
      expect(parseDateTime('')).toBeNull();
    });

    it('returns Date instance directly if passed Date', () => {
      const now = new Date('2026-08-29T10:00:00Z');
      expect(parseDateTime(now)).toBe(now);
    });

    it('parses numeric epoch milliseconds', () => {
      const timestamp = 1787997600000;
      const parsed = parseDateTime(timestamp);
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getTime()).toBe(timestamp);
    });

    it('parses ISO string with UTC or timezone offsets', () => {
      const parsedUtc = parseDateTime('2026-08-29T09:00:00Z');
      expect(parsedUtc).toBeInstanceOf(Date);
      expect(parsedUtc.toISOString()).toBe('2026-08-29T09:00:00.000Z');

      const parsedOffset = parseDateTime('2026-08-29T17:00:00+08:00');
      expect(parsedOffset.toISOString()).toBe('2026-08-29T09:00:00.000Z');
    });

    it('parses local datetime string using fromZonedTime and specified timeZone', () => {
      const parsed = parseDateTime('2026-08-29 09:00:00', 'Asia/Hong_Kong');
      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.toISOString()).toBe('2026-08-29T01:00:00.000Z');
    });
  });

  describe('getAttendanceData Callable Function', () => {
    it('throws invalid-argument error when required parameters are missing', async () => {
      await expect(getAttendanceData({ data: {} })).rejects.toThrow('classId');
      await expect(getAttendanceData({ data: { classId: 'c1' } })).rejects.toThrow('startTime');
    });

    it('throws not-found when class document does not exist', async () => {
      mockDoc.get.mockResolvedValueOnce({ exists: false });

      await expect(
        getAttendanceData({
          data: {
            classId: 'non_existent',
            startTime: '2026-08-29T09:00:00Z',
            endTime: '2026-08-29T11:00:00Z',
          },
        })
      ).rejects.toThrow('not found');
    });

    it('returns empty array if calculated lesson duration is <= 0', async () => {
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: { s1: 'alice@vtc.edu.hk' },
        }),
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-08-29T11:00:00Z',
          endTime: '2026-08-29T09:00:00Z',
        },
      });

      expect(res).toEqual({ attendanceData: [] });
    });

    it('calculates full attendance and applies attendance adjustments', async () => {
      // 1. Mock class document
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            uid1: 'alice@vtc.edu.hk',
            uid2: 'bob@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query (60 min = 2 chunks of 30 mins)
      mockCollection.get
        .mockResolvedValueOnce({
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 'uid1',
                email: 'alice@vtc.edu.hk',
                timestamp: new Date('2026-08-29T09:15:00Z'),
              }),
            });
          },
        })
        .mockResolvedValueOnce({
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 'uid2',
                studentEmail: 'bob@vtc.edu.hk',
                timestamp: new Date('2026-08-29T09:45:00Z'),
              }),
            });
          },
        })
        // 3. Mock attendanceAdjustments query
        .mockResolvedValueOnce({
          forEach: (cb) => {
            cb({
              data: () => ({
                studentUid: 'uid1',
                startTime: new Date('2026-08-29T09:10:00Z'),
                endTime: new Date('2026-08-29T09:20:00Z'),
              }),
            });
          },
        });

      mockDoc.set.mockResolvedValueOnce({});

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-08-29T09:00:00Z',
          endTime: '2026-08-29T10:00:00Z',
        },
      });

      expect(res.attendanceData).toHaveLength(2);
      const alice = res.attendanceData.find((s) => s.email === 'alice@vtc.edu.hk');
      const bob = res.attendanceData.find((s) => s.email === 'bob@vtc.edu.hk');

      expect(alice).toBeDefined();
      expect(alice.deductedMinutes).toBeGreaterThan(0);
      expect(bob).toBeDefined();
      expect(bob.totalMinutes).toBe(1);
    });
  });

  describe('Attendance bitmask arithmetic', () => {
    it('correctly calculates total lesson duration in minutes', () => {
      const timeZone = 'Asia/Hong_Kong';
      const startTimeStr = '2026-08-29 09:00:00';
      const endTimeStr = '2026-08-29 11:30:00';

      const lessonStartTime = fromZonedTime(startTimeStr, timeZone);
      const lessonEndTime = fromZonedTime(endTimeStr, timeZone);
      const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

      expect(lessonDurationInMinutes).toBe(150);
    });

    it('correctly allocates screenshots to per-minute attendance buckets', () => {
      const durationMinutes = 60;
      const studentEmail = 'student1@stu.vtc.edu.hk';
      const attendanceMap = new Map([[studentEmail, Array(durationMinutes).fill(0)]]);

      const lessonStartTime = new Date('2026-08-29T09:00:00Z');
      const shotTimestamp = new Date('2026-08-29T09:15:30Z');
      const minuteIndex = Math.floor((shotTimestamp.getTime() - lessonStartTime.getTime()) / 60000);

      if (minuteIndex >= 0 && minuteIndex < durationMinutes) {
        attendanceMap.get(studentEmail)[minuteIndex] = 1;
      }

      const studentAttendance = attendanceMap.get(studentEmail);
      expect(studentAttendance[15]).toBe(1);
      expect(studentAttendance[0]).toBe(0);
      expect(studentAttendance[14]).toBe(0);

      const totalSharedMinutes = studentAttendance.reduce((acc, val) => acc + val, 0);
      expect(totalSharedMinutes).toBe(1);
    });

    it('correctly voids minutes and updates totalMinutes when Bingo adjustments are applied', () => {
      const durationMinutes = 60;
      const bitmask = Array(durationMinutes).fill(0);
      for (let m = 10; m <= 30; m++) {
        bitmask[m] = 1;
      }

      const startMinute = 18;
      const endMinute = 23;
      for (let m = startMinute; m <= endMinute; m++) {
        bitmask[m] = 2;
      }

      const totalMinutes = bitmask.reduce((sum, val) => sum + (val === 1 ? 1 : 0), 0);
      const deductedMinutes = bitmask.reduce((sum, val) => sum + (val === 2 ? 1 : 0), 0);

      expect(deductedMinutes).toBe(6);
      expect(totalMinutes).toBe(15);
      expect(bitmask[17]).toBe(1);
      expect(bitmask[18]).toBe(2);
      expect(bitmask[23]).toBe(2);
      expect(bitmask[24]).toBe(1);
    });
  });
});
