import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useClassSchedule, generateLessons } from './useClassSchedule';

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

describe('useClassSchedule Hook & generateLessons Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateLessons with scheduleHistory segments', () => {
    it('generates seamless chronological lessons across past scheduleHistory and active schedule', () => {
      // Historical segment 1: Monday & Wednesday classes from Sept 1 to Sept 10, 2026
      const scheduleHistory = [
        {
          startDate: '2026-09-01',
          endDate: '2026-09-10',
          timeZone: 'UTC',
          timeSlots: [
            { days: ['Wed'], startTime: '09:00', endTime: '11:00' }, // Sept 2, Sept 9
          ],
        },
      ];

      // Active schedule segment 2: Thursday classes from Sept 11 to Sept 25, 2026
      const activeSchedule = {
        startDate: '2026-09-11',
        endDate: '2026-09-25',
        timeZone: 'UTC',
        timeSlots: [
          { days: ['Thu'], startTime: '14:00', endTime: '16:00' }, // Sept 17, Sept 24
        ],
      };

      const customLessonTitles = {
        '2026-09-02T09:00:00.000Z': 'Introduction to Docker',
        '2026-09-09T09:00:00.000Z': 'Container Networking',
        '2026-09-17T14:00:00.000Z': 'Kubernetes Pods',
      };

      const lessons = generateLessons(activeSchedule, 'UTC', customLessonTitles, scheduleHistory);

      // Total 4 lessons: 2 from Segment 1 + 2 from Segment 2
      expect(lessons.length).toBe(4);

      // Because generateLessons returns descending (newest first):
      // Chronological order was:
      // Lesson 1: Sept 2 (09:00)
      // Lesson 2: Sept 9 (09:00)
      // Lesson 3: Sept 17 (14:00)
      // Lesson 4: Sept 24 (14:00)
      // Descending order has Lesson 4 first, Lesson 1 last:
      const oldestLesson = lessons[3];
      const secondLesson = lessons[2];
      const thirdLesson = lessons[1];
      const newestLesson = lessons[0];

      expect(oldestLesson.index).toBe(1);
      expect(oldestLesson.start.toISOString()).toBe('2026-09-02T09:00:00.000Z');
      expect(oldestLesson.title).toBe('Lesson 01: Introduction to Docker');

      expect(secondLesson.index).toBe(2);
      expect(secondLesson.start.toISOString()).toBe('2026-09-09T09:00:00.000Z');
      expect(secondLesson.title).toBe('Lesson 02: Container Networking');

      expect(thirdLesson.index).toBe(3);
      expect(thirdLesson.start.toISOString()).toBe('2026-09-17T14:00:00.000Z');
      expect(thirdLesson.title).toBe('Lesson 03: Kubernetes Pods');

      expect(newestLesson.index).toBe(4);
      expect(newestLesson.start.toISOString()).toBe('2026-09-24T14:00:00.000Z');
      expect(newestLesson.title).toBe('Lesson 04');
    });

    it('gracefully handles empty scheduleHistory and preserves backward compatibility', () => {
      const activeSchedule = {
        startDate: '2026-09-01',
        endDate: '2026-09-05',
        timeZone: 'UTC',
        timeSlots: [
          { days: ['Tue'], startTime: '10:00', endTime: '12:00' }, // Sept 1
        ],
      };

      const lessons = generateLessons(activeSchedule, 'UTC', {});
      expect(lessons.length).toBe(1);
      expect(lessons[0].index).toBe(1);
      expect(lessons[0].title).toBe('Lesson 01');
    });
  });

  it('fetches schedule and scheduleHistory from Firestore and generates lessons', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        schedule: {
          startDate: '2026-08-02',
          endDate: '2026-08-03',
          timeZone: 'UTC',
          timeSlots: [
            { days: ['Mon'], startTime: '09:00', endTime: '10:00' },
          ],
        },
        scheduleHistory: [
          {
            startDate: '2026-08-01',
            endDate: '2026-08-01',
            timeZone: 'UTC',
            timeSlots: [
              { days: ['Sat'], startTime: '09:00', endTime: '10:00' },
            ],
          },
        ],
      }),
    });

    const { result } = renderHook(() => useClassSchedule('CLASS_WITH_HISTORY'));

    await waitFor(() => {
      expect(result.current.lessons.length).toBe(2);
    });

    expect(result.current.scheduleHistory.length).toBe(1);
    expect(result.current.timezone).toBe('UTC');
    expect(result.current.startTime).toBeTruthy();
    expect(result.current.endTime).toBeTruthy();
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

