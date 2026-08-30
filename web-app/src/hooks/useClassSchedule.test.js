import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useClassSchedule } from './useClassSchedule';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
}));

describe('useClassSchedule Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches schedule and generates lesson list for valid class', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          startDate: '2026-08-01',
          endDate: '2026-08-03',
          timeZone: 'UTC',
          timeSlots: [
            { days: ['Sat', 'Sun', 'Mon'], startTime: '09:00', endTime: '10:00' },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useClassSchedule('CLASS_101'));

    await waitFor(() => {
      expect(result.current.lessons.length).toBeGreaterThan(0);
    });

    expect(result.current.timezone).toBe('UTC');
    expect(result.current.startTime).toBeTruthy();
    expect(result.current.endTime).toBeTruthy();
  });

  it('handles changing selected lesson from dropdown', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          startDate: '2026-08-01',
          endDate: '2026-08-05',
          timeZone: 'UTC',
          timeSlots: [
            { days: ['Sat', 'Sun', 'Mon', 'Tue', 'Wed'], startTime: '09:00', endTime: '10:00' },
          ],
        },
      }),
    });

    const { result } = renderHook(() => useClassSchedule('CLASS_101'));

    await waitFor(() => {
      expect(result.current.lessons.length).toBeGreaterThan(1);
    });

    const firstLessonStart = result.current.lessons[0].start.toISOString();
    act(() => {
      result.current.handleLessonChange({ target: { value: firstLessonStart } });
    });

    expect(result.current.selectedLesson).toBe(firstLessonStart);

    act(() => {
      result.current.setStartTime('2026-08-01T08:00');
      result.current.setEndTime('2026-08-01T11:00');
    });
    expect(result.current.startTime).toBe('2026-08-01T08:00');
    expect(result.current.endTime).toBe('2026-08-01T11:00');
  });

  it('handles class with no schedule or non-existent document gracefully', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    const { result } = renderHook(() => useClassSchedule('CLASS_EMPTY'));

    await waitFor(() => {
      expect(result.current.schedule).toBeNull();
      expect(result.current.lessons).toEqual([]);
    });
  });
});
