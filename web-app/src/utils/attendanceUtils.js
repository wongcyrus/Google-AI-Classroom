import { fromZonedTime } from 'date-fns-tz';

/**
 * Utility functions for attendance formatting, hashing, and metric computations.
 */

export const formatFilenameDate = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  const hours = `${d.getHours()}`.padStart(2, '0');
  const minutes = `${d.getMinutes()}`.padStart(2, '0');
  return `${year}-${month}-${day}_${hours}-${minutes}`;
};

export const toIsoDateString = (input, timezone = 'UTC') => {
  if (!input) return '';
  if (input instanceof Date) return input.toISOString();
  if (typeof input === 'number') return new Date(input).toISOString();
  if (typeof input === 'string') {
    if (input.includes('Z') || input.includes('+') || (input.includes('-') && input.lastIndexOf('-') > 10)) {
      const d = new Date(input);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    try {
      const zoned = fromZonedTime(input, timezone);
      if (!isNaN(zoned.getTime())) return zoned.toISOString();
    } catch {
      // fallback
    }
    const fallback = new Date(input);
    return isNaN(fallback.getTime()) ? '' : fallback.toISOString();
  }
  const d = new Date(input);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

export const computeLessonDuration = (startTime, endTime, timezone = 'UTC') => {
  if (!startTime || !endTime) return 0;
  const startISO = toIsoDateString(startTime, timezone);
  const endISO = toIsoDateString(endTime, timezone);
  if (!startISO || !endISO) return 0;
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
  const duration = Math.round((end - start) / 60000);
  return duration > 0 ? duration : 0;
};

export const getLessonId = async (start, end, timezone = 'UTC') => {
  if (!start || !end) return '';
  const startISO = toIsoDateString(start, timezone);
  const endISO = toIsoDateString(end, timezone);
  if (!startISO || !endISO) return '';
  const message = `${startISO}-${endISO}`;
  if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback simple hash for non-subtle crypto test environments
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    hash = (hash << 5) - hash + message.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
};

export const mergeAttendanceData = (attendanceData = [], rawLessonStudents = [], durationMinutes = 0) => {
  const lessonStudents = Array.isArray(rawLessonStudents)
    ? rawLessonStudents
    : (rawLessonStudents && typeof rawLessonStudents === 'object')
      ? Object.entries(rawLessonStudents).map(([uid, val]) => ({
          uid,
          email: typeof val === 'string' ? val : (val?.email || '')
        }))
      : [];

  const safeAttendance = Array.isArray(attendanceData) ? attendanceData : [];

  if (safeAttendance.length === 0 && lessonStudents.length === 0) {
    return [];
  }

  const allStudentEmails = new Set([
    ...safeAttendance.map((s) => s.email).filter(Boolean),
    ...lessonStudents.map((s) => s.email).filter(Boolean),
  ]);

  return Array.from(allStudentEmails).map((email) => {
    const attStudent = attendanceData.find((s) => s.email === email);
    const lessonStudent = lessonStudents.find((s) => s.email === email);

    // Multi-source attendance resolution:
    // If attStudent has 0 minutes (e.g. screenshots purged), fall back to lessonStudent's recorded sharedScreenMinutes or workingMinutes
    const recordedMins = lessonStudent?.sharedScreenMinutes ?? lessonStudent?.workingMinutes;
    const effectiveMins = (attStudent?.totalMinutes != null && attStudent.totalMinutes > 0)
      ? attStudent.totalMinutes
      : (recordedMins != null && recordedMins > 0 ? recordedMins : (attStudent?.totalMinutes ?? 0));

    let effectiveAttendance = (attStudent?.attendance && attStudent.attendance.includes(1))
      ? attStudent.attendance
      : (lessonStudent?.attendance && lessonStudent.attendance.includes(1))
        ? lessonStudent.attendance
        : null;

    if (!effectiveAttendance && effectiveMins > 0 && durationMinutes > 0) {
      // Reconstruct attendance bitmask up to effectiveMins
      effectiveAttendance = Array(durationMinutes).fill(0).map((_, idx) => (idx < effectiveMins ? 1 : 0));
    } else if (!effectiveAttendance) {
      effectiveAttendance = attStudent?.attendance || lessonStudent?.attendance || Array(durationMinutes).fill(0);
    }

    const pct = durationMinutes > 0
      ? `${((effectiveMins / durationMinutes) * 100).toFixed(2)}%`
      : '0.00%';

    return {
      email,
      uid: lessonStudent?.uid || attStudent?.uid || null,
      totalMinutes: effectiveMins,
      percentage: pct,
      attendance: effectiveAttendance,
      workingMinutes: lessonStudent?.workingMinutes,
      summary: lessonStudent?.summary,
      feedback: lessonStudent?.feedback,
    };
  });
};
