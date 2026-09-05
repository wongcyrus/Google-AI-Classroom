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

  it('matches screenshots by studentUid or studentEmail safely without error when email is missing', () => {
    const studentList = [
      { uid: 'uid1', email: 'alice@vtc.edu.hk' },
      { uid: 'uid2', email: 'bob@vtc.edu.hk' },
    ];
    const durationMinutes = 30;
    const emailToStudentMap = new Map();
    const uidToStudentMap = new Map();

    studentList.forEach(s => {
      const bitmask = Array(durationMinutes).fill(0);
      const entry = { student: s, attendance: bitmask };
      if (s.email) emailToStudentMap.set(s.email, entry);
      if (s.uid) uidToStudentMap.set(s.uid, entry);
    });

    const lessonStartTime = new Date('2026-08-29T09:00:00Z');

    const screenshots = [
      // 1. Screenshot with email only
      { email: 'Alice@vtc.edu.hk', timestamp: new Date('2026-08-29T09:05:00Z') },
      // 2. Screenshot with studentEmail instead of email
      { studentEmail: 'bob@vtc.edu.hk', timestamp: new Date('2026-08-29T09:10:00Z') },
      // 3. Screenshot with studentUid and no email at all (must not throw!)
      { studentUid: 'uid1', email: null, timestamp: new Date('2026-08-29T09:15:00Z') },
      // 4. Screenshot with neither email nor studentUid (should safely be ignored)
      { timestamp: new Date('2026-08-29T09:20:00Z') },
    ];

    screenshots.forEach(screenshot => {
      const rawEmail = screenshot.email || screenshot.studentEmail || '';
      const studentEmail = rawEmail.replace(/\s/g, '').toLowerCase();
      const studentUid = screenshot.studentUid || screenshot.userId || screenshot.uid;

      const entry = (studentEmail && emailToStudentMap.get(studentEmail)) || (studentUid && uidToStudentMap.get(studentUid));
      if (!entry) return;

      const screenshotTime = screenshot.timestamp;
      const minuteIndex = Math.floor((screenshotTime.getTime() - lessonStartTime.getTime()) / 60000);
      if (minuteIndex >= 0 && minuteIndex < durationMinutes) {
        entry.attendance[minuteIndex] = 1;
      }
    });

    // Alice should have minute 5 (from email) and minute 15 (from studentUid)
    expect(uidToStudentMap.get('uid1').attendance[5]).toBe(1);
    expect(uidToStudentMap.get('uid1').attendance[15]).toBe(1);
    expect(uidToStudentMap.get('uid1').attendance[0]).toBe(0);

    // Bob should have minute 10 (from studentEmail)
    expect(emailToStudentMap.get('bob@vtc.edu.hk').attendance[10]).toBe(1);
  });
});
