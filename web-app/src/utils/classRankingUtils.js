import { generateLessons } from '../hooks/useClassSchedule';

/**
 * Helper to format time into "HH:mm" (e.g. 14:00).
 * @param {Date} date 
 * @returns {string}
 */
export const formatTimeShort = (date) => {
  if (!date || isNaN(new Date(date).getTime())) return '';
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
};

/**
 * Helper to format date into brief day & time (e.g. "Mon, Oct 5 14:00").
 * @param {Date} date 
 * @returns {string}
 */
export const formatDateBrief = (date) => {
  if (!date || isNaN(new Date(date).getTime())) return '';
  const d = new Date(date);
  const weekday = d.toLocaleDateString([], { weekday: 'short' });
  const monthDay = d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const time = formatTimeShort(d);
  return `${weekday}, ${monthDay} ${time}`;
};

import { formatInTimeZone } from 'date-fns-tz';

/**
 * Checks if two dates share the exact same calendar day within a given timezone.
 * @param {Date} d1 
 * @param {Date} d2 
 * @param {string} [tz='UTC']
 * @returns {boolean}
 */
export const isSameCalendarDay = (d1, d2, tz = 'UTC') => {
  if (!d1 || !d2) return false;
  const a = new Date(d1);
  const b = new Date(d2);
  if (isNaN(a.getTime()) || isNaN(b.getTime())) return false;
  try {
    const dayA = tz ? formatInTimeZone(a, tz, 'yyyy-MM-dd') : a.toISOString().slice(0, 10);
    const dayB = tz ? formatInTimeZone(b, tz, 'yyyy-MM-dd') : b.toISOString().slice(0, 10);
    return dayA === dayB;
  } catch {
    return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);
  }
};

/**
 * Computes the real-time schedule status of a class.
 * 
 * Tiers:
 * Tier 1: 'live' (🟢 Live Now: currently inside lesson start ~ end)
 * Tier 2: 'starting_soon' (⏳ Starts within 45 minutes)
 * Tier 3: 'today' (📅 Has lesson later today or ended within 45 mins)
 * Tier 4: 'upcoming' (🔜 Next upcoming future lesson)
 * Tier 5: 'inactive' (⚪ No upcoming scheduled lessons or past course)
 *
 * @param {Object} classObj - Class object with schedule, scheduleHistory, etc.
 * @param {Date|number} [now=new Date()] - Evaluation timestamp
 * @returns {Object} Status descriptor
 */
export const getClassScheduleStatus = (classObj, now = new Date()) => {
  const defaultStatus = {
    tier: 5,
    type: 'inactive',
    label: 'No upcoming sessions',
    badge: '',
    timeStr: '',
    activeLesson: null,
    nextLesson: null,
  };

  if (!classObj || !classObj.schedule) {
    return defaultStatus;
  }

  const evalDate = now instanceof Date ? now : new Date(now);
  const evalMs = evalDate.getTime();
  if (isNaN(evalMs)) return defaultStatus;

  let allLessons = [];
  try {
    allLessons = generateLessons(
      classObj.schedule,
      classObj.schedule.timeZone || 'Asia/Hong_Kong',
      classObj.customLessonTitles || {},
      classObj.scheduleHistory || []
    );
  } catch (err) {
    console.warn(`[getClassScheduleStatus] Could not parse lessons for ${classObj.id}:`, err);
    return defaultStatus;
  }

  if (!Array.isArray(allLessons) || allLessons.length === 0) {
    return defaultStatus;
  }

  // Sort chronologically ascending
  const chronologicalLessons = [...allLessons].sort((a, b) => new Date(a.start) - new Date(b.start));

  // 1. Check for Tier 1: Currently Live
  for (const lesson of chronologicalLessons) {
    const startMs = new Date(lesson.start).getTime();
    const endMs = new Date(lesson.end).getTime();

    if (evalMs >= startMs && evalMs <= endMs) {
      const timeStr = `${formatTimeShort(lesson.start)} - ${formatTimeShort(lesson.end)}`;
      return {
        tier: 1,
        type: 'live',
        label: `Live Now (${timeStr})`,
        badge: '🟢 Live Now',
        timeStr,
        activeLesson: lesson,
        nextLesson: null,
      };
    }
  }

  // 2. Check for Tier 2: Starting Soon (starts within 45 minutes)
  const FORTY_FIVE_MIN_MS = 45 * 60 * 1000;
  for (const lesson of chronologicalLessons) {
    const startMs = new Date(lesson.start).getTime();
    const diff = startMs - evalMs;

    if (diff > 0 && diff <= FORTY_FIVE_MIN_MS) {
      const minsLeft = Math.max(1, Math.ceil(diff / (60 * 1000)));
      const timeStr = `${formatTimeShort(lesson.start)} - ${formatTimeShort(lesson.end)}`;
      return {
        tier: 2,
        type: 'starting_soon',
        label: `Starts in ${minsLeft}m (${formatTimeShort(lesson.start)})`,
        badge: `⏳ In ${minsLeft}m`,
        timeStr,
        activeLesson: null,
        nextLesson: lesson,
        minutesUntilStart: minsLeft,
      };
    }
  }

  // 3. Check for Tier 3: Today (Later today or finished within last 45 minutes)
  // 3a. Ended recently (within last 45 minutes)
  for (const lesson of chronologicalLessons) {
    const endMs = new Date(lesson.end).getTime();
    const diffEnded = evalMs - endMs;
    if (diffEnded > 0 && diffEnded <= FORTY_FIVE_MIN_MS) {
      return {
        tier: 3,
        type: 'recent',
        label: `Ended recently (${formatTimeShort(lesson.end)})`,
        badge: '🏁 Just Ended',
        timeStr: `${formatTimeShort(lesson.start)} - ${formatTimeShort(lesson.end)}`,
        activeLesson: lesson,
        nextLesson: null,
      };
    }
  }

  // 3b. Later today
  const classTz = classObj.schedule?.timeZone || 'UTC';
  for (const lesson of chronologicalLessons) {
    const startMs = new Date(lesson.start).getTime();
    if (startMs > evalMs && isSameCalendarDay(lesson.start, evalDate, classTz)) {
      const timeStr = `${formatTimeShort(lesson.start)} - ${formatTimeShort(lesson.end)}`;
      return {
        tier: 3,
        type: 'today',
        label: `Today at ${formatTimeShort(lesson.start)}`,
        badge: `📅 Today ${formatTimeShort(lesson.start)}`,
        timeStr,
        activeLesson: null,
        nextLesson: lesson,
      };
    }
  }

  // 4. Check for Tier 4: Next upcoming future lesson
  for (const lesson of chronologicalLessons) {
    const startMs = new Date(lesson.start).getTime();
    if (startMs > evalMs) {
      const dateLabel = formatDateBrief(lesson.start);
      return {
        tier: 4,
        type: 'upcoming',
        label: `Next: ${dateLabel}`,
        badge: `Next: ${dateLabel}`,
        timeStr: `${formatTimeShort(lesson.start)} - ${formatTimeShort(lesson.end)}`,
        activeLesson: null,
        nextLesson: lesson,
      };
    }
  }

  // 5. Tier 5: Inactive (All lessons in past)
  return defaultStatus;
};

/**
 * Comparator function for sorting classes by schedule priority:
 * Tier 1 (Live) -> Tier 2 (Starting soon) -> Tier 3 (Today) -> Tier 4 (Upcoming) -> Tier 5 (Inactive).
 *
 * @param {Object} a 
 * @param {Object} b 
 * @param {Date|number} [now=new Date()] 
 * @returns {number}
 */
export const compareClassesBySchedule = (a, b, now = new Date()) => {
  const statusA = a._scheduleStatus || getClassScheduleStatus(a, now);
  const statusB = b._scheduleStatus || getClassScheduleStatus(b, now);

  if (statusA.tier !== statusB.tier) {
    return statusA.tier - statusB.tier;
  }

  // Tie breakers within same tier:
  // Tier 1: whichever finishes later or earlier
  if (statusA.tier === 1 && statusA.activeLesson && statusB.activeLesson) {
    const endA = new Date(statusA.activeLesson.end).getTime();
    const endB = new Date(statusB.activeLesson.end).getTime();
    if (endA !== endB) return endA - endB;
  }

  // Tier 2, 3, 4: whichever starts sooner
  if ((statusA.tier === 2 || statusA.tier === 3 || statusA.tier === 4) && statusA.nextLesson && statusB.nextLesson) {
    const startA = new Date(statusA.nextLesson.start).getTime();
    const startB = new Date(statusB.nextLesson.start).getTime();
    if (startA !== startB) return startA - startB;
  }

  // Alphabetical fallback
  const nameA = a.name || a.id || '';
  const nameB = b.name || b.id || '';
  return nameA.localeCompare(nameB);
};

/**
 * Extracts and categorizes all unique tags across a set of classes.
 * Includes both custom tags and auto-derived smart tags.
 *
 * @param {Array<Object>} classes 
 * @param {Date} [now=new Date()]
 * @returns {Array<{ tag: string, count: number, isSmart: boolean, category: string }>}
 */
const WEEKDAY_NAMES = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
  Monday: 'Monday',
  Tuesday: 'Tuesday',
  Wednesday: 'Wednesday',
  Thursday: 'Thursday',
  Friday: 'Friday',
  Saturday: 'Saturday',
  Sunday: 'Sunday',
};

const WEEKDAY_ORDER = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

/**
 * Extracts and categorizes all unique tags across a set of classes.
 * Includes custom teacher tags and auto-derived scheduled weekday tags.
 *
 * @param {Array<Object>} classes 
 * @param {Date} [now=new Date()]
 * @returns {Array<{ tag: string, count: number, isSmart: boolean, category: string }>}
 */
export const extractClassTags = (classes = [], now = new Date()) => {
  if (!Array.isArray(classes)) return [];

  const tagCounts = new Map();
  const smartTagMeta = new Map();

  classes.forEach((c) => {
    const classTags = new Set();

    // 1. Custom tags explicitly set by teachers (c.tags)
    if (Array.isArray(c.tags)) {
      c.tags.forEach((t) => {
        if (typeof t === 'string' && t.trim()) {
          classTags.add(t.trim());
        }
      });
    }

    // 2. Auto-derived Timetable Weekdays (e.g. "📅 Friday")
    if (c.schedule?.timeSlots && Array.isArray(c.schedule.timeSlots)) {
      c.schedule.timeSlots.forEach((slot) => {
        if (Array.isArray(slot.days)) {
          slot.days.forEach((day) => {
            const fullDay = WEEKDAY_NAMES[day] || day;
            const dayTag = `📅 ${fullDay}`;
            classTags.add(dayTag);
            smartTagMeta.set(dayTag, fullDay);
          });
        }
      });
    }

    // Increment counts for all unique tags on this class
    classTags.forEach((tag) => {
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    });
  });

  const result = [];
  tagCounts.forEach((count, tag) => {
    const isSmart = smartTagMeta.has(tag);
    result.push({
      tag,
      count,
      isSmart,
      category: isSmart ? 'weekday' : 'custom',
    });
  });

  // Sort: Custom tags first (alphabetically), then Weekdays in calendar order (Mon -> Sun)
  return result.sort((a, b) => {
    if (a.isSmart !== b.isSmart) {
      return a.isSmart ? 1 : -1;
    }
    if (a.isSmart && b.isSmart) {
      const dayA = smartTagMeta.get(a.tag);
      const dayB = smartTagMeta.get(b.tag);
      const orderA = WEEKDAY_ORDER[dayA] || 99;
      const orderB = WEEKDAY_ORDER[dayB] || 99;
      if (orderA !== orderB) return orderA - orderB;
    }
    return a.tag.localeCompare(b.tag);
  });
};

/**
 * Evaluates whether a class matches all or any of the selected tags.
 *
 * @param {Object} classObj 
 * @param {Array<string>} selectedTags 
 * @param {'AND'|'OR'} [mode='AND'] 
 * @returns {boolean}
 */
export const classMatchesTags = (classObj, selectedTags = [], mode = 'AND') => {
  if (!Array.isArray(selectedTags) || selectedTags.length === 0) return true;
  if (!classObj) return false;

  // Build the full set of tags for this class
  const classTagSet = new Set(Array.isArray(classObj.tags) ? classObj.tags.map((t) => t.trim()) : []);

  // Include weekday tags (both normalized full day and abbreviation for compatibility)
  if (classObj.schedule?.timeSlots && Array.isArray(classObj.schedule.timeSlots)) {
    classObj.schedule.timeSlots.forEach((slot) => {
      if (Array.isArray(slot.days)) {
        slot.days.forEach((day) => {
          const fullDay = WEEKDAY_NAMES[day] || day;
          classTagSet.add(`📅 ${fullDay}`);
          classTagSet.add(`📅 ${day}`);
        });
      }
    });
  }

  if (mode === 'OR') {
    return selectedTags.some((tag) => classTagSet.has(tag));
  }
  return selectedTags.every((tag) => classTagSet.has(tag));
};

/**
 * Composable filter and sorter for classes list.
 * Combines search text, multi-tag inclusion, schedule status filters, and priority sorting.
 *
 * @param {Array<Object>} classes 
 * @param {Object} options 
 * @param {string} [options.searchTerm='']
 * @param {Array<string>} [options.selectedTags=[]]
 * @param {'AND'|'OR'} [options.tagMode='AND']
 * @param {'all'|'live'|'today'} [options.scheduleFilter='today']
 * @param {'smart'|'name'} [options.sortOption='smart']
 * @param {Date|number} [options.now=new Date()]
 * @returns {Array<Object>} Filtered and sorted classes with attached `_scheduleStatus`
 */
export const filterAndSortClasses = (classes = [], {
  searchTerm = '',
  selectedTags = [],
  tagMode = 'AND',
  scheduleFilter = 'today',
  sortOption = 'smart',
  now = new Date(),
} = {}) => {
  if (!Array.isArray(classes)) return [];

  const evalDate = now instanceof Date ? now : new Date(now);

  // 1. Attach cached schedule status to each class
  const classesWithStatus = classes.map((c) => ({
    ...c,
    _scheduleStatus: getClassScheduleStatus(c, evalDate),
  }));

  // 2. Filter by search term
  const term = (searchTerm || '').trim().toLowerCase();
  let filtered = classesWithStatus;

  if (term) {
    filtered = filtered.filter((c) => {
      const matchId = c.id && c.id.toLowerCase().includes(term);
      const matchName = c.name && c.name.toLowerCase().includes(term);
      const matchCustomTags = Array.isArray(c.tags) && c.tags.some((t) => t.toLowerCase().includes(term));
      const matchLesson = c._scheduleStatus?.timeStr?.toLowerCase().includes(term);
      return matchId || matchName || matchCustomTags || matchLesson;
    });
  }

  // 3. Filter by selected tags
  if (Array.isArray(selectedTags) && selectedTags.length > 0) {
    filtered = filtered.filter((c) => classMatchesTags(c, selectedTags, tagMode));
  }

  // 4. Filter by schedule state
  if (scheduleFilter === 'live') {
    filtered = filtered.filter((c) => c._scheduleStatus?.tier === 1);
  } else if (scheduleFilter === 'today') {
    filtered = filtered.filter((c) => c._scheduleStatus?.tier === 1 || c._scheduleStatus?.tier === 2 || c._scheduleStatus?.tier === 3);
  }

  // 5. Sort classes
  const sorted = [...filtered];
  if (sortOption === 'smart') {
    sorted.sort((a, b) => compareClassesBySchedule(a, b, evalDate));
  } else if (sortOption === 'name') {
    sorted.sort((a, b) => (a.name || a.id || '').localeCompare(b.name || b.id || ''));
  }

  return sorted;
};
