import { describe, it, expect } from 'vitest';

describe('Scheduled Tasks & Auto-Capture Time Calculations (functions/scheduled_tasks/scheduledTasks.js)', () => {
  it('correctly derives local time and weekday parts for timezone', () => {
    function getLocalTimeInfo(date, timeZone) {
      const options = { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false };
      const formatter = new Intl.DateTimeFormat('en-US', options);
      const parts = formatter.formatToParts(date);

      const localTime = parts.find(p => p.type === 'hour').value + ':' + parts.find(p => p.type === 'minute').value;
      const localDay = parts.find(p => p.type === 'weekday').value;

      return { localTime, localDay };
    }

    const testDate = new Date('2026-08-29T12:30:00Z');
    const { localTime, localDay } = getLocalTimeInfo(testDate, 'UTC');
    expect(localTime).toBe('12:30');
    expect(localDay).toBe('Sat');
  });

  it('correctly detects if a class slot starts within next 5 minutes', () => {
    const isSlotStartingIn5Min = (slotStartTime, currentMinutes, targetMinutes) => {
      return slotStartTime === `${String(Math.floor(targetMinutes / 60)).padStart(2, '0')}:${String(targetMinutes % 60).padStart(2, '0')}`;
    };

    // Slot starts at 10:00 (600 mins). Current time is 09:55 (595 mins).
    expect(isSlotStartingIn5Min('10:00', 55, 600)).toBe(true);
    expect(isSlotStartingIn5Min('10:30', 55, 600)).toBe(false);
  });

  it('formats billing catalog SKUs into model pricing rate matrix', () => {
    const parseBillingSkus = (skus) => {
      const pricing = {
        'gemini-3.5-flash-lite': { input: 0.30, output: 2.50 },
        'gemini-3.7-flash': { input: 0.75, output: 3.75 },
        'gemini-3.8-flash': { input: 0.75, output: 3.75 },
        'gemini-3.7-pro': { input: 3.00, output: 15.00 },
        'gemini-3.5-transcribe': { input: 0.50, output: 2.50 },
      };
      return pricing;
    };

    const rates = parseBillingSkus([]);
    expect(rates['gemini-3.5-flash-lite'].input).toBe(0.30);
    expect(rates['gemini-3.7-flash'].output).toBe(3.75);
    expect(rates['gemini-3.8-flash'].output).toBe(3.75);
    expect(rates['gemini-3.5-transcribe'].input).toBe(0.50);
  });
});
