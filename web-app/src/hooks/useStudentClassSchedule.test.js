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

  it('unsubscribes and clears interval on unmount', () => {
    onSnapshot.mockReturnValue(unsubMock);
    const { unmount } = renderHook(() => useStudentClassSchedule({ uid: 'student_4' }));
    unmount();
    expect(unsubMock).toHaveBeenCalled();
  });
});
