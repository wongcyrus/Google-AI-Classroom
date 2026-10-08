import { fromZonedTime } from 'date-fns-tz';

/**
 * Safely parses date strings into millisecond timestamps.
 * If the string contains an explicit timezone (Z or offset), it is parsed as standard ISO.
 * If naive (e.g. "YYYY-MM-DDTHH:mm" from datetime-local input), it is interpreted in the class timezone.
 */
export function parsePeriodDateMs(dateStr, timeZone = 'Asia/Hong_Kong') {
  if (!dateStr) return NaN;
  if (typeof dateStr.toMillis === 'function') return dateStr.toMillis();
  if (dateStr instanceof Date) return dateStr.getTime();
  if (typeof dateStr === 'number') return dateStr;
  if (typeof dateStr !== 'string') return NaN;

  if (/Z$|[+-]\d{2}(?::?\d{2})?$/i.test(dateStr.trim())) {
    return new Date(dateStr).getTime();
  }

  try {
    const zoned = fromZonedTime(dateStr, timeZone);
    const ms = zoned.getTime();
    if (!isNaN(ms)) return ms;
  } catch {}

  return new Date(dateStr).getTime();
}
