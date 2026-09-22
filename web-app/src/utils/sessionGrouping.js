/**
 * Utility functions for identifying, clustering, and grouping classroom lecture recording sessions.
 * Supports early starts (up to 45 mins early) and class overruns (up to 60 mins overrun),
 * as well as inactivity gap clustering (< 30-min gap) and explicit broadcast session IDs.
 */

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Parses "HH:mm" time string into minutes from midnight.
 * @param {string} timeStr - e.g. "10:30"
 * @returns {number}
 */
export function parseTimeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [h, m] = timeStr.split(':').map((num) => parseInt(num, 10));
  return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
}

/**
 * Checks whether a given timestamp falls within a scheduled time slot with generous fuzzy boundaries.
 * Early start tolerance: 45 minutes before slot start.
 * Overrun tolerance: 60 minutes after slot end.
 *
 * @param {Date} dateObj - The recording start time
 * @param {object} slot - { startTime: '10:30', endTime: '11:30', days: ['Mon'] }
 * @param {number} earlyMinutes - Minutes allowed before start (default: 45)
 * @param {number} overrunMinutes - Minutes allowed after end (default: 60)
 * @returns {boolean}
 */
export function isWithinFuzzySlot(dateObj, slot, earlyMinutes = 45, overrunMinutes = 60) {
  if (!dateObj || !slot || !slot.startTime || !slot.endTime) return false;

  // Check day of week
  const dayName = DAYS_OF_WEEK[dateObj.getDay()];
  if (Array.isArray(slot.days) && slot.days.length > 0 && !slot.days.includes(dayName)) {
    return false;
  }

  const currentMinutes = dateObj.getHours() * 60 + dateObj.getMinutes();
  const slotStartMinutes = parseTimeToMinutes(slot.startTime);
  const slotEndMinutes = parseTimeToMinutes(slot.endTime);

  const windowStart = slotStartMinutes - earlyMinutes;
  const windowEnd = slotEndMinutes + overrunMinutes;

  return currentMinutes >= windowStart && currentMinutes <= windowEnd;
}

/**
 * Resolves a canonical sessionGroupId for a lecture recording session.
 * Priority:
 * 1. Explicit broadcastSessionId if broadcast is active (anchored to teacher action).
 * 2. Class schedule timetable match with fuzzy tolerance (-45m early to +60m overrun).
 * 3. Fallback: date string (YYYY-MM-DD).
 *
 * @param {object} params
 * @param {string} params.classId
 * @param {string} [params.broadcastSessionId] - Active broadcast session ID if broadcasting
 * @param {object} [params.schedule] - Class schedule object from Firestore
 * @param {Date} [params.timestamp] - Recording start date (defaults to now)
 * @returns {string} The canonical sessionGroupId
 */
export function resolveSessionGroupId({ classId, broadcastSessionId, schedule, timestamp = new Date() }) {
  if (broadcastSessionId) {
    return `bcast_${broadcastSessionId}`;
  }

  const dateObj = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;

  // Check schedule time slots if available
  if (schedule && Array.isArray(schedule.timeSlots) && schedule.timeSlots.length > 0) {
    for (const slot of schedule.timeSlots) {
      if (isWithinFuzzySlot(dateObj, slot)) {
        const cleanStart = (slot.startTime || '').replace(':', '');
        const cleanEnd = (slot.endTime || '').replace(':', '');
        return `${classId}_${dateStr}_slot_${cleanStart}_${cleanEnd}`;
      }
    }
  }

  // Fallback: Date-level session group
  return `${classId}_${dateStr}`;
}

/**
 * Checks if two recording timestamps belong to the same session based on an inactivity gap rule.
 * @param {number|Date} prevEndedAt - End time of previous recording
 * @param {number|Date} nextStartedAt - Start time of subsequent recording
 * @param {number} maxGapMinutes - Max allowed gap (default: 30 minutes)
 * @returns {boolean}
 */
export function isWithinInactivityGap(prevEndedAt, nextStartedAt, maxGapMinutes = 30) {
  if (!prevEndedAt || !nextStartedAt) return false;
  const prevMs = prevEndedAt instanceof Date ? prevEndedAt.getTime() : new Date(prevEndedAt).getTime();
  const nextMs = nextStartedAt instanceof Date ? nextStartedAt.getTime() : new Date(nextStartedAt).getTime();
  if (isNaN(prevMs) || isNaN(nextMs)) return false;

  const gapMs = Math.abs(nextMs - prevMs);
  return gapMs <= maxGapMinutes * 60 * 1000;
}
