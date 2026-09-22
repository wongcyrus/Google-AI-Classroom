import { describe, it, expect } from 'vitest';
import { sanitizeClassDataForLog } from './logSanitizer';

describe('logSanitizer Utility', () => {
  it('returns null for null, undefined, or non-object inputs', () => {
    expect(sanitizeClassDataForLog(null)).toBeNull();
    expect(sanitizeClassDataForLog(undefined)).toBeNull();
    expect(sanitizeClassDataForLog('string')).toBeNull();
    expect(sanitizeClassDataForLog(123)).toBeNull();
  });

  it('strips studentEmails, students, teacherEmails, teachers, and ipRestrictions', () => {
    const rawClassData = {
      name: 'Mobile App Development',
      frameRate: 15,
      captureMode: 'dual',
      isCapturing: true,
      isExamActive: false,
      schedule: {
        timeZone: 'Asia/Hong_Kong',
        timeSlots: [{ days: ['Mon'], startTime: '09:00', endTime: '12:00' }],
      },
      studentEmails: ['alice@gmail.com', 'bob@gmail.com', 'charlie@gmail.com'],
      students: {
        uid_1: 'alice@gmail.com',
        uid_2: 'bob@gmail.com',
        uid_3: 'charlie@gmail.com',
      },
      teacherEmails: ['teacher@vtc.edu.hk'],
      teachers: {
        tuid_1: 'teacher@vtc.edu.hk',
      },
      ipRestrictions: ['192.168.1.0/24'],
      retentionDays: 30,
      aiMonitoringMode: 'hybrid',
    };

    const sanitized = sanitizeClassDataForLog(rawClassData);

    expect(sanitized).toBeDefined();
    // Sensitive fields must NOT exist
    expect(sanitized.studentEmails).toBeUndefined();
    expect(sanitized.students).toBeUndefined();
    expect(sanitized.teacherEmails).toBeUndefined();
    expect(sanitized.teachers).toBeUndefined();
    expect(sanitized.ipRestrictions).toBeUndefined();

    // Verify raw JSON string does not contain any student or teacher email
    const jsonStr = JSON.stringify(sanitized);
    expect(jsonStr).not.toContain('alice@gmail.com');
    expect(jsonStr).not.toContain('bob@gmail.com');
    expect(jsonStr).not.toContain('charlie@gmail.com');
    expect(jsonStr).not.toContain('teacher@vtc.edu.hk');
    expect(jsonStr).not.toContain('192.168.1.0/24');

    // Non-sensitive fields preserved
    expect(sanitized.name).toBe('Mobile App Development');
    expect(sanitized.frameRate).toBe(15);
    expect(sanitized.captureMode).toBe('dual');
    expect(sanitized.isCapturing).toBe(true);
    expect(sanitized.isExamActive).toBe(false);
    expect(sanitized.retentionDays).toBe(30);
    expect(sanitized.aiMonitoringMode).toBe('hybrid');
    expect(sanitized.schedule).toEqual(rawClassData.schedule);

    // Counts correctly computed
    expect(sanitized.enrolledStudentCount).toBe(3);
    expect(sanitized.teacherCount).toBe(1);
  });

  it('handles empty or missing student/teacher collections gracefully', () => {
    const rawClassData = {
      name: 'Empty Class',
      frameRate: 10,
    };

    const sanitized = sanitizeClassDataForLog(rawClassData);
    expect(sanitized.name).toBe('Empty Class');
    expect(sanitized.frameRate).toBe(10);
    expect(sanitized.enrolledStudentCount).toBe(0);
    expect(sanitized.teacherCount).toBe(0);
  });
});
