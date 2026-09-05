import { describe, it, expect } from 'vitest';
import {
  formatFilenameDate,
  computeLessonDuration,
  getLessonId,
  mergeAttendanceData,
} from './attendanceUtils';

describe('attendanceUtils Module', () => {
  it('formatFilenameDate formats valid date correctly', () => {
    const formatted = formatFilenameDate('2026-08-30T10:15:00Z');
    expect(formatted).toMatch(/2026-08-30/);
    expect(formatFilenameDate(null)).toBe('');
    expect(formatFilenameDate('invalid-date')).toBe('');
  });

  it('computeLessonDuration calculates duration in minutes', () => {
    const start = '2026-08-30T10:00:00Z';
    const end = '2026-08-30T11:30:00Z';
    expect(computeLessonDuration(start, end)).toBe(90);
    expect(computeLessonDuration(null, end)).toBe(0);
    expect(computeLessonDuration('bad', end)).toBe(0);
  });

  it('getLessonId produces consistent SHA-256 hash or fallback', async () => {
    const start = '2026-08-30T10:00:00Z';
    const end = '2026-08-30T11:00:00Z';
    const hash1 = await getLessonId(start, end);
    const hash2 = await getLessonId(start, end);
    expect(hash1).toBeTruthy();
    expect(hash1).toBe(hash2);
    expect(await getLessonId('', '')).toBe('');
  });

  it('toIsoDateString and getLessonId handle timezone strings consistently', async () => {
    // 09:30 in Hong Kong (UTC+8) is 01:30 UTC
    const start = '2026-09-04 09:30:00';
    const end = '2026-09-04 11:30:00';
    const hashZoned = await getLessonId(start, end, 'Asia/Hong_Kong');
    const hashUtc = await getLessonId('2026-09-04T01:30:00.000Z', '2026-09-04T03:30:00.000Z');
    expect(hashZoned).toBe(hashUtc);
  });

  it('mergeAttendanceData merges attendance server data with lesson snapshot data', () => {
    const attData = [
      { email: 'alice@school.edu', totalMinutes: 45, percentage: '75.00%', attendance: [1, 1, 0] },
    ];
    const lessonStudents = [
      { uid: 'u1', email: 'alice@school.edu', workingMinutes: 40, summary: 'Good progress' },
      { uid: 'u2', email: 'bob@school.edu', sharedScreenMinutes: 60, workingMinutes: 55 },
    ];

    const merged = mergeAttendanceData(attData, lessonStudents, 60);
    expect(merged.length).toBe(2);

    const alice = merged.find((s) => s.email === 'alice@school.edu');
    expect(alice.uid).toBe('u1');
    expect(alice.totalMinutes).toBe(45);
    expect(alice.workingMinutes).toBe(40);

    const bob = merged.find((s) => s.email === 'bob@school.edu');
    expect(bob.uid).toBe('u2');
    expect(bob.totalMinutes).toBe(60);
    expect(bob.percentage).toBe('100.00%');
  });

  it('returns empty array when both inputs are empty', () => {
    expect(mergeAttendanceData([], [], 60)).toEqual([]);
  });
});
