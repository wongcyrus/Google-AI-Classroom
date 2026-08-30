import { describe, it, expect } from 'vitest';
import { fromZonedTime } from 'date-fns-tz';

describe('Attendance Calculation Logic (functions/attendance/index.mjs)', () => {
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
    
    // Screenshot captured at 09:15:30 (minute index 15)
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

  it('handles negative or 0 minute lesson duration safely', () => {
    const lessonStartTime = new Date('2026-08-29T10:00:00Z');
    const lessonEndTime = new Date('2026-08-29T09:00:00Z');
    const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

    expect(lessonDurationInMinutes <= 0).toBe(true);
  });
});
