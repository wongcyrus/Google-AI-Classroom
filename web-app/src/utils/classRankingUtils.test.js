import { describe, it, expect } from 'vitest';
import {
  getClassScheduleStatus,
  compareClassesBySchedule,
  extractClassTags,
  classMatchesTags,
  filterAndSortClasses,
  formatTimeShort,
  formatDateBrief,
  isSameCalendarDay,
  isDemoClass,
} from './classRankingUtils';

describe('classRankingUtils', () => {
  // Helper to construct a mock class
  const makeClass = (id, name, schedule, tags = [], studentProfiles = {}) => ({
    id,
    name,
    schedule,
    tags,
    studentProfiles,
  });

  describe('format helpers', () => {
    it('formats short time string correctly', () => {
      const d = new Date('2026-10-02T14:30:00Z');
      expect(formatTimeShort(d)).toMatch(/\d{2}:\d{2}/);
    });

    it('formats brief date string correctly', () => {
      const d = new Date('2026-10-02T14:30:00Z');
      expect(formatDateBrief(d)).toBeTruthy();
    });

    it('identifies identical calendar days', () => {
      const d1 = new Date('2026-10-02T09:00:00Z');
      const d2 = new Date('2026-10-02T17:00:00Z');
      const d3 = new Date('2026-10-03T09:00:00Z');
      expect(isSameCalendarDay(d1, d2, 'UTC')).toBe(true);
      expect(isSameCalendarDay(d1, d3, 'UTC')).toBe(false);
    });
  });

  describe('getClassScheduleStatus', () => {
    it('returns inactive tier 5 if class has no schedule', () => {
      const status = getClassScheduleStatus({ id: 'c1', name: 'Test' });
      expect(status.tier).toBe(5);
      expect(status.type).toBe('inactive');
      expect(status.badge).toBe('');
    });

    it('detects Tier 1: Live Now when clock is inside lesson window', () => {
      // Class on Fridays (Fri is 2026-10-02), 14:00 - 17:00 UTC
      const classObj = makeClass('c_live', 'Live Class', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '14:00', endTime: '17:00' }],
      });

      // 15:30 UTC is inside the 14:00-17:00 lesson window
      const now = new Date('2026-10-02T15:30:00.000Z');
      const status = getClassScheduleStatus(classObj, now);

      expect(status.tier).toBe(1);
      expect(status.type).toBe('live');
      expect(status.badge).toBe('🟢 Live Now');
      expect(status.activeLesson).toBeTruthy();
    });

    it('detects Tier 2: Starting Soon when lesson begins in <= 45 minutes', () => {
      const classObj = makeClass('c_soon', 'Soon Class', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '14:00', endTime: '17:00' }],
      });

      // 13:40 UTC is 20 minutes before 14:00 start
      const now = new Date('2026-10-02T13:40:00.000Z');
      const status = getClassScheduleStatus(classObj, now);

      expect(status.tier).toBe(2);
      expect(status.type).toBe('starting_soon');
      expect(status.badge).toContain('⏳ In');
      expect(status.nextLesson).toBeTruthy();
      expect(status.minutesUntilStart).toBe(20);
    });

    it('detects Tier 3: Later Today when lesson is scheduled later on the same day', () => {
      const classObj = makeClass('c_later', 'Later Class', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '18:00', endTime: '21:00' }],
      });

      // 10:00 UTC is on the same day (Fri), but > 45 minutes ahead
      const now = new Date('2026-10-02T10:00:00.000Z');
      const status = getClassScheduleStatus(classObj, now);

      expect(status.tier).toBe(3);
      expect(status.type).toBe('today');
      expect(status.badge).toContain('📅 Today');
      expect(status.nextLesson).toBeTruthy();
    });

    it('detects Tier 3: Ended Recently when lesson ended < 45 minutes ago', () => {
      const classObj = makeClass('c_recent', 'Recent Class', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '14:00', endTime: '17:00' }],
      });

      // 17:15 UTC is 15 minutes after 17:00 end
      const now = new Date('2026-10-02T17:15:00.000Z');
      const status = getClassScheduleStatus(classObj, now);

      expect(status.tier).toBe(3);
      expect(status.type).toBe('recent');
      expect(status.badge).toBe('🏁 Just Ended');
    });

    it('detects Tier 4: Next Upcoming when next session is on a future day', () => {
      const classObj = makeClass('c_next', 'Next Week Class', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Mon'], startTime: '09:00', endTime: '12:00' }],
      });

      // Current time is Friday 2026-10-02. Next session is Monday 2026-10-05.
      const now = new Date('2026-10-02T12:00:00.000Z');
      const status = getClassScheduleStatus(classObj, now);

      expect(status.tier).toBe(4);
      expect(status.type).toBe('upcoming');
      expect(status.badge).toContain('Next:');
      expect(status.nextLesson).toBeTruthy();
    });
  });

  describe('compareClassesBySchedule', () => {
    it('ranks Live Now ahead of Starting Soon, Today, and Inactive', () => {
      const now = new Date('2026-10-02T14:30:00.000Z'); // Friday

      const liveClass = makeClass('live', 'Live Course', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '14:00', endTime: '17:00' }],
      });

      const soonClass = makeClass('soon', 'Starting Soon Course', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '15:00', endTime: '18:00' }],
      });

      const nextWeekClass = makeClass('future', 'Future Course', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Mon'], startTime: '09:00', endTime: '12:00' }],
      });

      const unscheduledClass = makeClass('unscheduled', 'Unscheduled Course', null);

      const list = [unscheduledClass, nextWeekClass, soonClass, liveClass];
      list.sort((a, b) => compareClassesBySchedule(a, b, now));

      expect(list[0].id).toBe('live');
      expect(list[1].id).toBe('soon');
      expect(list[2].id).toBe('future');
      expect(list[3].id).toBe('unscheduled');
    });
  });

  describe('extractClassTags and classMatchesTags', () => {
    it('extracts custom tags and smart weekday tags with accurate counts (no cohort clutter)', () => {
      const c1 = makeClass('c1', 'Class 1', {
        timeSlots: [{ days: ['Mon', 'Wed'] }],
      }, ['Lab 302', 'HD-IT'], {
        s1: { studentClass: 'IT114115/1A' },
      });

      const c2 = makeClass('c2', 'Class 2', {
        timeSlots: [{ days: ['Fri'] }],
      }, ['Lab 302', 'Year 2'], {
        s2: { studentClass: 'IT114115/2B' },
      });

      const tags = extractClassTags([c1, c2]);
      const tagNames = tags.map((t) => t.tag);

      // Custom teacher tags
      expect(tagNames).toContain('Lab 302');
      expect(tagNames).toContain('HD-IT');
      expect(tagNames).toContain('Year 2');
      const labTag = tags.find((t) => t.tag === 'Lab 302');
      expect(labTag.count).toBe(2);

      // Smart tags (ONLY weekdays)
      expect(tagNames).toContain('📅 Monday');
      expect(tagNames).toContain('📅 Wednesday');
      expect(tagNames).toContain('📅 Friday');

      // Clutter tags (cohort/programme) must NOT be present
      expect(tagNames).not.toContain('🎓 IT114115/1A');
      expect(tagNames).not.toContain('🎓 IT114115/2B');
    });

    it('matches class tags using AND and OR modes', () => {
      const c = makeClass('c1', 'Class 1', {
        timeSlots: [{ days: ['Fri'] }],
      }, ['HD-IT', 'Lab 302']);

      expect(classMatchesTags(c, ['HD-IT'], 'AND')).toBe(true);
      expect(classMatchesTags(c, ['HD-IT', 'Lab 302'], 'AND')).toBe(true);
      expect(classMatchesTags(c, ['HD-IT', '📅 Friday'], 'AND')).toBe(true);
      expect(classMatchesTags(c, ['HD-IT', 'Lab 500'], 'AND')).toBe(false);
      expect(classMatchesTags(c, ['HD-IT', 'Lab 500'], 'OR')).toBe(true);
      expect(classMatchesTags(c, ['NonExistent'], 'OR')).toBe(false);
    });

    it('extracts and matches concept template tags derived from classType', () => {
      const cLecture = {
        id: 'c_lec',
        name: 'Lecture Class',
        classType: 'lecture',
        tags: ['CS101'],
      };
      const cLab = {
        id: 'c_lab',
        name: 'Lab Class',
        classType: 'lab',
        tags: ['Lab 302'],
      };
      const cLectureLab = {
        id: 'c_lec_lab',
        name: 'Focus Demo',
        classType: 'lecture_in_lab',
        tags: [],
      };

      const tags = extractClassTags([cLecture, cLab, cLectureLab]);
      const tagNames = tags.map((t) => t.tag);

      expect(tagNames).toContain('Lecture');
      expect(tagNames).toContain('Lab');
      expect(tagNames).toContain('Lecture in Lab');

      // Filter matching
      expect(classMatchesTags(cLecture, ['Lecture'])).toBe(true);
      expect(classMatchesTags(cLecture, ['Lab'])).toBe(false);
      expect(classMatchesTags(cLab, ['Lab'])).toBe(true);
      expect(classMatchesTags(cLectureLab, ['Lecture in Lab'])).toBe(true);
    });
  });

  describe('filterAndSortClasses', () => {
    it('composes search, tag filter, and schedule sorting together seamlessly', () => {
      const now = new Date('2026-10-02T14:30:00.000Z'); // Friday

      const cLive = makeClass('c_live', 'Cloud Computing Lab A', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '14:00', endTime: '17:00' }],
      }, ['Cloud', 'Year 1']);

      const cToday = makeClass('c_today', 'Cloud Computing Lab B', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Fri'], startTime: '19:00', endTime: '22:00' }],
      }, ['Cloud', 'Year 2']);

      const cOther = makeClass('c_other', 'Database Systems', {
        startDate: '2026-10-01',
        endDate: '2026-10-31',
        timeZone: 'UTC',
        timeSlots: [{ days: ['Mon'], startTime: '09:00', endTime: '12:00' }],
      }, ['Database', 'Year 1']);

      const classes = [cOther, cToday, cLive];

      // 1. Text search for 'Cloud' (defaults to today's classes)
      const searchRes = filterAndSortClasses(classes, { searchTerm: 'cloud', now });
      expect(searchRes.length).toBe(2);
      expect(searchRes[0].id).toBe('c_live'); // Live now is ranked first!
      expect(searchRes[1].id).toBe('c_today');

      // 2. Tag filter for 'Year 1' with scheduleFilter: 'all'
      const tagRes = filterAndSortClasses(classes, { selectedTags: ['Year 1'], scheduleFilter: 'all', now });
      expect(tagRes.length).toBe(2);
      expect(tagRes[0].id).toBe('c_live'); // Live ranks above other
      expect(tagRes[1].id).toBe('c_other');

      // 3. Composed: search 'Cloud' + tag 'Year 1'
      const composedRes = filterAndSortClasses(classes, {
        searchTerm: 'Cloud',
        selectedTags: ['Year 1'],
        now,
      });
      expect(composedRes.length).toBe(1);
      expect(composedRes[0].id).toBe('c_live');

      // 4. Schedule filter 'live'
      const liveRes = filterAndSortClasses(classes, { scheduleFilter: 'live', now });
      expect(liveRes.length).toBe(1);
      expect(liveRes[0].id).toBe('c_live');

      // 5. Default filter is 'today'
      const defaultRes = filterAndSortClasses(classes, { now });
      expect(defaultRes.length).toBe(2);
      expect(defaultRes.map((c) => c.id)).toEqual(['c_live', 'c_today']);
    });
  });

  describe('isDemoClass', () => {
    it('returns true when id or name contains demo (case-insensitive)', () => {
      expect(isDemoClass({ id: 'IT114115-Demo', name: 'IT114115 Demo Class' })).toBe(true);
      expect(isDemoClass({ id: 'demo-class-123', name: 'Programming 101' })).toBe(true);
      expect(isDemoClass({ id: 'real-class', name: 'My DEMO Session' })).toBe(true);
    });

    it('returns true when isDemo or isDemoClass flag is true', () => {
      expect(isDemoClass({ id: 'c1', name: 'Course 1', isDemo: true })).toBe(true);
      expect(isDemoClass({ id: 'c2', name: 'Course 2', isDemoClass: true })).toBe(true);
    });

    it('returns true when class has 24/7 all-day schedule (00:00 - 23:59)', () => {
      expect(isDemoClass({
        id: 'sandbox-1',
        name: 'Sandbox Environment',
        _scheduleStatus: { timeStr: '00:00 - 23:59' },
      })).toBe(true);

      expect(isDemoClass({
        id: 'sandbox-2',
        name: 'Always On Testing Room',
        schedule: {
          timeSlots: [{ startTime: '00:00', endTime: '23:59', days: ['Mon', 'Tue'] }],
        },
      })).toBe(true);
    });

    it('returns false for real classes with regular timetables', () => {
      expect(isDemoClass({ id: 'it114115-2026-s1-ite3101-1c', name: 'Introduction to Programming C' })).toBe(false);
      expect(isDemoClass({
        id: 'it114115-2026-s1-ite3101-1c',
        name: 'Introduction to Programming C',
        _scheduleStatus: { timeStr: '09:30 - 11:30' },
        schedule: {
          timeSlots: [{ startTime: '09:30', endTime: '11:30', days: ['Mon'] }],
        },
      })).toBe(false);
      expect(isDemoClass(null)).toBe(false);
    });
  });
});

