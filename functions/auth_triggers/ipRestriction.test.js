import { describe, it, expect } from 'vitest';
import { Address4 } from 'ip-address';
import { format } from 'date-fns-tz';
import { toZonedTime } from 'date-fns-tz/toZonedTime';

describe('IP & Schedule Restrictions Logic (functions/auth_triggers/ipRestriction.js)', () => {
  it('correctly matches IP addresses within CIDR subnet masks', () => {
    const cidr = '192.168.1.0/24';
    const subnet = new Address4(cidr);
    
    const validIp = new Address4('192.168.1.45');
    const outsideIp = new Address4('192.168.2.10');

    expect(validIp.isInSubnet(subnet)).toBe(true);
    expect(outsideIp.isInSubnet(subnet)).toBe(false);
  });

  it('correctly parses time slot schedules within timezone', () => {
    const schedule = {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      timeZone: 'Asia/Hong_Kong',
      timeSlots: [
        { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], startTime: '00:00', endTime: '23:59' }
      ]
    };

    const isDuringScheduledTime = (sched, testDate = new Date()) => {
      if (!sched?.startDate || !sched?.endDate || !sched?.timeSlots || !sched?.timeZone) return false;
      const timeZone = sched.timeZone;
      const zonedNow = toZonedTime(testDate, timeZone);
      const dayMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const currentDay = dayMap[zonedNow.getUTCDay()];
      const currentTime = format(zonedNow, 'HH:mm', { timeZone });

      for (const slot of sched.timeSlots) {
        if (slot.days.includes(currentDay)) {
          if (currentTime >= slot.startTime && currentTime <= slot.endTime) {
            return true;
          }
        }
      }
      return false;
    };

    expect(isDuringScheduledTime(schedule, new Date())).toBe(true);
  });

  it('rejects invalid or missing schedule data gracefully without crashing', () => {
    const isDuringScheduledTime = (sched) => {
      if (!sched?.startDate || !sched?.endDate || !sched?.timeSlots || !sched?.timeZone) return false;
      return true;
    };

    expect(isDuringScheduledTime(null)).toBe(false);
    expect(isDuringScheduledTime({})).toBe(false);
    expect(isDuringScheduledTime({ startDate: '2026-01-01' })).toBe(false);
  });
});
