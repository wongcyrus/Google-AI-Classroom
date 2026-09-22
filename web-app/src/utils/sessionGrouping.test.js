import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  isWithinFuzzySlot,
  resolveSessionGroupId,
  isWithinInactivityGap,
} from './sessionGrouping';

describe('sessionGrouping utilities', () => {
  describe('parseTimeToMinutes', () => {
    it('parses valid HH:mm time string', () => {
      expect(parseTimeToMinutes('10:30')).toBe(630);
      expect(parseTimeToMinutes('00:00')).toBe(0);
      expect(parseTimeToMinutes('23:59')).toBe(1439);
    });

    it('handles invalid inputs gracefully', () => {
      expect(parseTimeToMinutes('')).toBe(0);
      expect(parseTimeToMinutes(null)).toBe(0);
      expect(parseTimeToMinutes('invalid')).toBe(0);
    });
  });

  describe('isWithinFuzzySlot', () => {
    const slot = {
      startTime: '10:30',
      endTime: '11:30',
      days: ['Mon'],
    };

    it('matches an exact time during the slot on Monday', () => {
      // 2026-09-21 is Monday
      const mondayMidclass = new Date('2026-09-21T11:00:00');
      expect(isWithinFuzzySlot(mondayMidclass, slot)).toBe(true);
    });

    it('matches early start (10:28 AM, 2 minutes before 10:30)', () => {
      const earlyStart = new Date('2026-09-21T10:28:31');
      expect(isWithinFuzzySlot(earlyStart, slot)).toBe(true);
    });

    it('matches early start up to 45 minutes before start (e.g. 09:50 AM)', () => {
      const earlyPrep = new Date('2026-09-21T09:50:00');
      expect(isWithinFuzzySlot(earlyPrep, slot)).toBe(true);
    });

    it('matches overrun up to 60 minutes after end (e.g. 12:15 PM for an 11:30 end)', () => {
      const overrunQA = new Date('2026-09-21T12:15:00');
      expect(isWithinFuzzySlot(overrunQA, slot)).toBe(true);
    });

    it('rejects times far outside the window (e.g. 08:30 AM or 14:00 PM)', () => {
      const tooEarly = new Date('2026-09-21T08:30:00');
      const tooLate = new Date('2026-09-21T14:00:00');
      expect(isWithinFuzzySlot(tooEarly, slot)).toBe(false);
      expect(isWithinFuzzySlot(tooLate, slot)).toBe(false);
    });

    it('rejects on wrong day of the week', () => {
      // 2026-09-22 is Tuesday
      const tuesdayTime = new Date('2026-09-22T10:30:00');
      expect(isWithinFuzzySlot(tuesdayTime, slot)).toBe(false);
    });
  });

  describe('resolveSessionGroupId', () => {
    it('prioritizes explicit broadcastSessionId when present', () => {
      const res = resolveSessionGroupId({
        classId: 'ite3101-l',
        broadcastSessionId: 'sess_12345',
        timestamp: new Date('2026-09-21T10:28:31'),
      });
      expect(res).toBe('bcast_sess_12345');
    });

    it('resolves fuzzy schedule slot when timetable is provided', () => {
      const schedule = {
        timeSlots: [
          { startTime: '10:30', endTime: '11:30', days: ['Mon'] },
        ],
      };
      // Monday 10:28:31 (early start)
      const res1 = resolveSessionGroupId({
        classId: 'ite3101-l',
        schedule,
        timestamp: new Date('2026-09-21T10:28:31'),
      });
      // Monday 10:30:30 (main lecture start)
      const res2 = resolveSessionGroupId({
        classId: 'ite3101-l',
        schedule,
        timestamp: new Date('2026-09-21T10:30:30'),
      });

      expect(res1).toBe('ite3101-l_2026-09-21_slot_1030_1130');
      expect(res2).toBe('ite3101-l_2026-09-21_slot_1030_1130');
      expect(res1).toBe(res2); // Both resolve to the identical sessionGroupId!
    });

    it('falls back to date-level session group if no schedule matches', () => {
      const res = resolveSessionGroupId({
        classId: 'ite3101-l',
        schedule: null,
        timestamp: new Date('2026-09-21T15:00:00'),
      });
      expect(res).toBe('ite3101-l_2026-09-21');
    });
  });

  describe('isWithinInactivityGap', () => {
    it('returns true when gap is under 30 minutes', () => {
      const end1 = new Date('2026-09-21T10:29:37');
      const start2 = new Date('2026-09-21T10:30:30'); // 53 seconds later
      expect(isWithinInactivityGap(end1, start2, 30)).toBe(true);

      const breakEnd = new Date('2026-09-21T10:45:00');
      const breakResume = new Date('2026-09-21T11:00:00'); // 15-minute break
      expect(isWithinInactivityGap(breakEnd, breakResume, 30)).toBe(true);
    });

    it('returns false when gap exceeds threshold', () => {
      const morningEnd = new Date('2026-09-21T11:30:00');
      const afternoonStart = new Date('2026-09-21T14:00:00'); // 2.5 hours later
      expect(isWithinInactivityGap(morningEnd, afternoonStart, 30)).toBe(false);
    });

    it('handles invalid timestamps safely', () => {
      expect(isWithinInactivityGap(null, new Date())).toBe(false);
      expect(isWithinInactivityGap('invalid', new Date())).toBe(false);
    });
  });
});
