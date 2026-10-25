import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStudentClassSchedule } from './useStudentClassSchedule';
import { onSnapshot, getDoc } from 'firebase/firestore';

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn(),
  getDoc: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  db: {},
}));

describe('useStudentClassSchedule Hook', () => {
  const unsubMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('handles missing user gracefully', () => {
    const { result } = renderHook(() => useStudentClassSchedule(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.userClasses).toEqual([]);
    expect(result.current.currentActiveClassId).toBeNull();
  });

  it('handles non-existent student profile', () => {
    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_none' }));
    act(() => {
      profileCb({
        exists: () => false,
      });
    });

    expect(result.current.userClasses).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('fetches class list and schedule, determining active class in daytime slot', async () => {
    // Freeze time to Wednesday 2026-09-02 10:30:00 UTC
    const mockNow = new Date('2026-09-02T10:30:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          timeZone: 'UTC',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          timeSlots: [
            { days: ['Wed'], startTime: '10:00', endTime: '12:00' },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_1' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_A'] }),
      });
    });

    // Advance timers so useEffect check runs
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.userClasses).toEqual(['CLASS_A']);
    expect(result.current.currentActiveClassId).toBe('CLASS_A');
  });

  it('handles overnight slots and out-of-range dates', async () => {
    // Monday night 23:30 UTC
    const mockNow = new Date('2026-09-07T23:30:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          timeZone: 'UTC',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          timeSlots: [
            // Overnight slot from 22:00 to 02:00 next day
            { days: ['Mon'], startTime: '22:00', endTime: '02:00' },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_2' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_OVERNIGHT'] }),
      });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.currentActiveClassId).toBe('CLASS_OVERNIGHT');

    // Advance time past slot (03:00 UTC) -> should no longer be active
    act(() => {
      vi.setSystemTime(new Date('2026-09-08T03:00:00Z'));
      vi.advanceTimersByTime(35000);
    });

    expect(result.current.currentActiveClassId).toBeNull();
  });

  it('handles errors when fetching class document gracefully', async () => {
    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc.mockRejectedValueOnce(new Error('Permission denied'));

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_3' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_ERR'] }),
      });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.currentActiveClassId).toBeNull();
  });

  it('identifies multiple concurrent overlapping classes in activeClassIds', async () => {
    // Wednesday 2026-09-02 10:30:00 UTC
    const mockNow = new Date('2026-09-02T10:30:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Wed'], startTime: '09:00', endTime: '11:00' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Wed'], startTime: '10:00', endTime: '12:00' }],
          },
        }),
      });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_overlap' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_1', 'CLASS_2'] }),
      });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.activeClassIds).toEqual(['CLASS_1', 'CLASS_2']);
    expect(result.current.currentActiveClassId).toBe('CLASS_1');
  });

  it('unsubscribes and clears interval on unmount', () => {
    onSnapshot.mockReturnValue(unsubMock);
    const { unmount } = renderHook(() => useStudentClassSchedule({ uid: 'student_4' }));
    unmount();
    expect(unsubMock).toHaveBeenCalled();
  });

  it('keeps class active during overrun when teacher is broadcasting or overtimeUntil is active even after endTime and endDate', async () => {
    // Freeze time to 2026-10-05 14:30:00 UTC (after endDate 2026-09-30 and after slot endTime 12:00)
    const mockNow = new Date('2026-10-05T14:30:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: false,
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Mon'], startTime: '09:00', endTime: '11:00' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          overtimeUntil: '2026-10-05T16:30:00Z',
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Mon'], startTime: '10:00', endTime: '12:00' }],
          },
        }),
      });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_overrun' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_IDLE', 'CLASS_OVERRUN_BCAST'] }),
      });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.currentActiveClassId).toBe('CLASS_OVERRUN_BCAST');
    expect(result.current.activeClassIds).toContain('CLASS_OVERRUN_BCAST');
  });

  it('keeps class active during slot overrun when teacher capture (isCapturing) is still active within 90 minutes of endTime', async () => {
    // Wednesday 2026-09-02 12:25:00 UTC (25 mins after 12:00 endTime)
    const mockNow = new Date('2026-09-02T12:25:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isCapturing: true,
        schedule: {
          timeZone: 'UTC',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          timeSlots: [{ days: ['Wed'], startTime: '10:00', endTime: '12:00' }],
        },
      }),
    });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_capture_overrun' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_CAPTURE_OVERRUN'] }),
      });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(result.current.currentActiveClassId).toBe('CLASS_CAPTURE_OVERRUN');
  });

  it('does not let a non-broadcasting overrun class hijack a newly started back-to-back scheduled class while keeping both in activeClassIds', async () => {
    // Wednesday 2026-09-02 12:03:00 UTC:
    // CLASS_A (10:00-12:00) just ended 3 mins ago and still has isCapturing: true (waiting for 12:05 auto-stop)
    // CLASS_B (12:00-14:00) is now in its scheduled slot
    const mockNow = new Date('2026-09-02T12:03:00Z');
    vi.setSystemTime(mockNow);

    let profileCb;
    onSnapshot.mockImplementation((ref, cb) => {
      profileCb = cb;
      return unsubMock;
    });

    getDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isCapturing: true,
          isBroadcasting: false,
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Wed'], startTime: '10:00', endTime: '12:00' }],
          },
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isCapturing: true,
          isBroadcasting: false,
          schedule: {
            timeZone: 'UTC',
            startDate: '2026-09-01',
            endDate: '2026-09-30',
            timeSlots: [{ days: ['Wed'], startTime: '12:00', endTime: '14:00' }],
          },
        }),
      });

    const { result } = renderHook(() => useStudentClassSchedule({ uid: 'student_back_to_back' }));

    await act(async () => {
      profileCb({
        exists: () => true,
        data: () => ({ classes: ['CLASS_A', 'CLASS_B'] }),
      });
    });

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // CLASS_B is in its scheduled slot so it must be primary (currentActiveClassId),
    // while both CLASS_B and CLASS_A remain in activeClassIds for multi-class background telemetry
    expect(result.current.currentActiveClassId).toBe('CLASS_B');
    expect(result.current.activeClassIds).toEqual(['CLASS_B', 'CLASS_A']);
  });
});


