import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useClassSchedule } from './useClassSchedule';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn().mockResolvedValue({ empty: true, docs: [] });
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
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

  it('smartly defaults to lesson matching completed video jobs instead of empty later slots', async () => {
    // Class has two slots on the same day: 09:00-11:00 and 14:00-16:00
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          startDate: '2026-08-01',
          endDate: '2026-08-01',
          timeZone: 'UTC',
          timeSlots: [
            { days: ['Sat'], startTime: '09:00', endTime: '11:00' },
            { days: ['Sat'], startTime: '14:00', endTime: '16:00' },
          ],
        },
      }),
    });

    // Mock videoJobs returning a completed job matching the morning slot 09:00
    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [{
        data: () => ({
          startTime: { toDate: () => new Date('2026-08-01T09:00:00.000Z') },
          status: 'completed',
        }),
      }],
    });

    const { result } = renderHook(() => useClassSchedule('CLASS_MULTI_SLOT'));

    await waitFor(() => {
      expect(result.current.lessons.length).toBe(2);
      expect(result.current.selectedLesson).toBe('2026-08-01T09:00:00.000Z');
    });
  });
});

