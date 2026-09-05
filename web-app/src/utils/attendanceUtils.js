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

export const mergeAttendanceData = (attendanceData = [], lessonStudents = [], durationMinutes = 0) => {
  if (attendanceData.length === 0 && lessonStudents.length === 0) {
    return [];
  }

  const allStudentEmails = new Set([
    ...attendanceData.map((s) => s.email).filter(Boolean),
    ...lessonStudents.map((s) => s.email).filter(Boolean),
  ]);

  return Array.from(allStudentEmails).map((email) => {
    const attStudent = attendanceData.find((s) => s.email === email);
    const lessonStudent = lessonStudents.find((s) => s.email === email);

    return {
      email,
      uid: lessonStudent?.uid || null,
      totalMinutes: attStudent?.totalMinutes ?? lessonStudent?.sharedScreenMinutes ?? 0,
      percentage: attStudent?.percentage ?? (durationMinutes > 0 && lessonStudent?.sharedScreenMinutes != null
        ? `${((lessonStudent.sharedScreenMinutes / durationMinutes) * 100).toFixed(2)}%`
        : '0.00%'),
      attendance: attStudent?.attendance || lessonStudent?.attendance || Array(durationMinutes).fill(0),
      workingMinutes: lessonStudent?.workingMinutes,
      summary: lessonStudent?.summary,
      feedback: lessonStudent?.feedback,
    };
  });
};
