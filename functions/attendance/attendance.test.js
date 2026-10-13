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
        // 3. Mock bingoRecords query
        .mockResolvedValueOnce({
          forEach: () => {},
        })
        // 4. Mock attendanceAdjustments query
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

    it('correctly maps 3 Bingo statuses: Correct (3), Incorrect (4), and Timeout (2)', async () => {
      // 1. Mock class document
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            u1: 'student1@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query (30 mins = 1 chunk, empty)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 3. Mock lesson doc (none)
      mockDoc.get.mockResolvedValueOnce({ exists: false });

      // 4. Mock videoJobs (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 5. Mock bingoRecords query (3 challenges: 1 passed, 1 failed_incorrect, 1 missed_timeout)
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'u1',
              studentEmail: 'student1@vtc.edu.hk',
              issuedAtMillis: new Date('2026-08-29T09:05:00Z').getTime(), // Min 5
              result: 'passed',
            }),
          });
          cb({
            data: () => ({
              studentUid: 'u1',
              studentEmail: 'student1@vtc.edu.hk',
              issuedAtMillis: new Date('2026-08-29T09:12:00Z').getTime(), // Min 12
              result: 'failed_incorrect',
            }),
          });
          cb({
            data: () => ({
              studentUid: 'u1',
              studentEmail: 'student1@vtc.edu.hk',
              issuedAtMillis: new Date('2026-08-29T09:20:00Z').getTime(), // Min 20
              result: 'missed_timeout',
            }),
          });
        },
      });

      // 6. Mock attendanceAdjustments query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      mockDoc.set.mockResolvedValueOnce({});

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-08-29T09:00:00Z',
          endTime: '2026-08-29T09:30:00Z',
        },
      });

      expect(res.attendanceData).toHaveLength(1);
      const student = res.attendanceData[0];
      expect(student.attendance[5]).toBe(3); // Bingo Correct
      expect(student.attendance[12]).toBe(4); // Bingo Incorrect
      expect(student.attendance[20]).toBe(2); // Bingo Timeout
      expect(student.bingoCorrectMinutes).toBe(1);
      expect(student.bingoIncorrectMinutes).toBe(1);
      expect(student.bingoTimeoutMinutes).toBe(1);
      expect(student.totalMinutes).toBe(2); // 3 (Correct) + 4 (Incorrect) count as active presence
    });

    it('reconstructs attendance from completed videoJobs and preserves existing AI working time when screenshots are purged', async () => {
      // 1. Mock class doc
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            uid1: 'alice@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query returning 0 screenshots (purged)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 3. Mock existing lesson doc get() returning AI working minutes
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            uid1: {
              workingMinutes: 30,
              summary: 'Active student working on lab.',
            },
          },
        }),
      });

      // 4. Mock videoJobs query returning completed screencast
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'uid1',
              studentEmail: 'alice@vtc.edu.hk',
              startTime: new Date('2026-08-29T09:00:00Z'),
              status: 'completed',
            }),
          });
        },
      });

      // 5. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 6. Mock attendanceAdjustments query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-08-29T09:00:00Z',
          endTime: '2026-08-29T09:30:00Z',
        },
      });

      expect(res.attendanceData).toHaveLength(1);
      const student = res.attendanceData[0];
      expect(student.totalMinutes).toBe(30);
      expect(student.percentage).toBe('100.00%');
      expect(student.attendance.filter(v => v === 1)).toHaveLength(30);
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

    it('caps reconstructed attendance and AI working time to physical video duration based on capture interval', async () => {
      // 1. Mock class doc
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            shortUid: 'short@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query returning 0 screenshots (purged)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 3. Mock existing lesson doc get() returning hallucinated AI working minutes and shared minutes
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            shortUid: {
              sharedScreenMinutes: 30,
              workingMinutes: 30,
              attendance: Array(30).fill(1),
            },
          },
        }),
      });

      // 4. Mock videoJobs query returning 1-second video
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'shortUid',
              studentEmail: 'short@vtc.edu.hk',
              startTime: new Date('2026-10-08T07:00:00Z'),
              status: 'completed',
              duration: 1, // 1 second = 1 frame = 1 min min-clamped
            }),
          });
        },
      });

      // 5. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 6. Mock attendanceAdjustments query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-10-08T07:00:00Z',
          endTime: '2026-10-08T07:30:00Z',
        },
      });

      const shortStudent = res.attendanceData.find((s) => s.email === 'short@vtc.edu.hk');
      expect(shortStudent).toBeDefined();
      expect(shortStudent.totalMinutes).toBe(1);
      expect(shortStudent.percentage).toBe('3.33%');
      expect(mockDoc.set).toHaveBeenCalledWith(
        expect.objectContaining({
          students: expect.objectContaining({
            shortUid: expect.objectContaining({
              sharedScreenMinutes: 1,
              workingMinutes: 1,
            }),
          }),
        }),
        { merge: true }
      );
    });

    it('accurately calculates attendance from video duration using dynamic class frameRate', async () => {
      // 1. Mock class doc with frameRate = 10s (6 frames per min)
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          frameRate: 10,
          students: {
            student10: 's10@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query (purged)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 3. Mock existing lesson doc get() (empty student records)
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {},
        }),
      });

      // 4. Mock videoJobs: 60s video at 10s capture interval = (60 * 10) / 60 = 10 minutes
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'student10',
              studentEmail: 's10@vtc.edu.hk',
              startTime: new Date('2026-10-08T07:00:00Z'),
              status: 'completed',
              duration: 60,
            }),
          });
        },
      });

      // 5. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 6. Mock attendanceAdjustments query
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-10-08T07:00:00Z',
          endTime: '2026-10-08T07:30:00Z', // 30 min lesson
        },
      });

      const student = res.attendanceData.find((s) => s.email === 's10@vtc.edu.hk');
      expect(student).toBeDefined();
      expect(student.totalMinutes).toBe(10);
      expect(student.percentage).toBe('33.33%');
    });

    it('reconstructs authentic chronological bitmask from Firestore lesson doc even when both screenshots and video jobs are deleted', async () => {
      // 1. Mock class doc
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            sPermanent: 'perm@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query (purged - 0 docs)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 3. Mock existing lesson doc get() with authentic non-contiguous bitmask
      const savedBitmask = [1, 0, 1, 1, 0, 0, 1, 1, 1, 0]; // 10 minutes total
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            sPermanent: {
              sharedScreenMinutes: 6,
              rawScreenMinutes: 6,
              attendance: savedBitmask,
            },
          },
        }),
      });

      // 4. Mock videoJobs query (video was also deleted - 0 docs)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 5. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 6. Mock attendanceAdjustments query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-10-08T07:00:00Z',
          endTime: '2026-10-08T07:10:00Z', // 10 min lesson
        },
      });

      const student = res.attendanceData.find((s) => s.email === 'perm@vtc.edu.hk');
      expect(student).toBeDefined();
      expect(student.totalMinutes).toBe(6);
      expect(student.rawMinutes).toBe(6);
      expect(student.deductedMinutes).toBe(0);
      // Ensure exact chronological positions are preserved (not left-aligned like a bar chart)
      expect(student.attendance).toEqual([1, 0, 1, 1, 0, 0, 1, 1, 1, 0]);
    });

    it('reconciles frozen lesson bitmask even when 1 flagged screenshot remains after routine screenshot purge', async () => {
      // 1. Mock class doc
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            sFlagged: 'flagged@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query returning 1 preserved flagged screenshot at minute 5 (unflaggedCount === 0)
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'sFlagged',
              email: 'flagged@vtc.edu.hk',
              timestamp: new Date('2026-10-08T07:05:00Z'),
              isFlagged: true,
            }),
          });
        },
      });

      // 3. Mock existing lesson doc get() with 8 active minutes
      const savedBitmask = [1, 1, 1, 1, 0, 0, 1, 1, 1, 1];
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            sFlagged: {
              sharedScreenMinutes: 8,
              rawScreenMinutes: 8,
              attendance: savedBitmask,
            },
          },
        }),
      });

      // 4. Mock videoJobs query (0 docs)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 5. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 6. Mock attendanceAdjustments query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-10-08T07:00:00Z',
          endTime: '2026-10-08T07:10:00Z',
        },
      });

      const student = res.attendanceData.find((s) => s.email === 'flagged@vtc.edu.hk');
      expect(student).toBeDefined();
      // Union of savedBitmask (8 mins) + preserved flagged screenshot at minute 5 = 9 mins
      expect(student.totalMinutes).toBe(9);
      expect(student.attendance).toEqual([1, 1, 1, 1, 0, 1, 1, 1, 1, 1]);
    });

    it('only deducts active screen-share minutes (1) in attendanceAdjustments without turning absent minutes (0) into 2', async () => {
      // 1. Mock class doc
      mockDoc.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          students: {
            uidLate: 'late@vtc.edu.hk',
          },
          schedule: { timeZone: 'UTC' },
        }),
      });

      // 2. Mock screenshots query (10-minute lesson): student only shared at minutes 7, 8, 9 (absent 0..6)
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          [7, 8, 9].forEach((m) => {
            cb({
              data: () => ({
                studentUid: 'uidLate',
                email: 'late@vtc.edu.hk',
                timestamp: new Date(`2026-10-08T07:0${m}:00Z`),
              }),
            });
          });
        },
      });

      // 3. Mock bingoRecords query (none)
      mockCollection.get.mockResolvedValueOnce({
        forEach: () => {},
      });

      // 4. Mock attendanceAdjustments query covering minutes 2..8
      mockCollection.get.mockResolvedValueOnce({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentUid: 'uidLate',
              startTime: new Date('2026-10-08T07:02:00Z'),
              endTime: new Date('2026-10-08T07:08:00Z'),
            }),
          });
        },
      });

      const res = await getAttendanceData({
        data: {
          classId: 'c1',
          startTime: '2026-10-08T07:00:00Z',
          endTime: '2026-10-08T07:10:00Z',
        },
      });

      const student = res.attendanceData.find((s) => s.email === 'late@vtc.edu.hk');
      expect(student).toBeDefined();
      // Minutes 0..6 remain 0 (absent), minutes 7..8 become 2 (deducted), minute 9 remains 1 (active)
      expect(student.attendance).toEqual([0, 0, 0, 0, 0, 0, 0, 2, 2, 1]);
      expect(student.deductedMinutes).toBe(2);
      expect(student.totalMinutes).toBe(1);
      expect(student.rawMinutes).toBe(3);
    });
  });
});

