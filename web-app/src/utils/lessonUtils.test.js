import { describe, it, expect } from 'vitest';
import {
  sanitizeFolderName,
  padLessonIndex,
  getLessonKey,
  formatLessonTitle,
  formatLessonDisplayName,
  formatLessonFolderName,
  findLessonForTimestamp,
  resolveVideoLessonName,
} from './lessonUtils';

describe('lessonUtils Unit Tests', () => {
  describe('sanitizeFolderName', () => {
    it('removes invalid filesystem/Drive characters and trims whitespace', () => {
      expect(sanitizeFolderName('Lesson 01: Intro / Setup? * <Docker>')).toBe('Lesson 01 Intro Setup Docker');
      expect(sanitizeFolderName('   Multiple   Spaces   ')).toBe('Multiple Spaces');
      expect(sanitizeFolderName('', 'Fallback')).toBe('Fallback');
      expect(sanitizeFolderName(null, 'Default')).toBe('Default');
    });
  });

  describe('padLessonIndex', () => {
    it('pads integers with leading zero', () => {
      expect(padLessonIndex(1)).toBe('01');
      expect(padLessonIndex(9)).toBe('09');
      expect(padLessonIndex(10)).toBe('10');
      expect(padLessonIndex('5')).toBe('05');
      expect(padLessonIndex('invalid')).toBe('01');
    });
  });

  describe('getLessonKey', () => {
    it('returns ISO string for lesson object or Date', () => {
      const date = new Date('2026-09-04T09:00:00.000Z');
      expect(getLessonKey(date)).toBe('2026-09-04T09:00:00.000Z');
      expect(getLessonKey({ start: date })).toBe('2026-09-04T09:00:00.000Z');
      expect(getLessonKey(null)).toBe('');
    });
  });

  describe('formatLessonTitle', () => {
    it('returns default indexed title when no custom title exists', () => {
      const lesson = { start: new Date('2026-09-04T09:00:00.000Z') };
      expect(formatLessonTitle({ lesson, index: 1 })).toBe('Lesson 01');
      expect(formatLessonTitle({ lesson, index: 4 })).toBe('Lesson 04');
    });

    it('uses custom title when mapped by ISO key', () => {
      const lesson = { start: new Date('2026-09-04T09:00:00.000Z') };
      const customTitles = {
        '2026-09-04T09:00:00.000Z': 'Docker Architecture & Setup',
      };
      expect(formatLessonTitle({ lesson, index: 1, customTitles })).toBe(
        'Lesson 01: Docker Architecture & Setup'
      );
    });

    it('avoids double-prefix if custom title already contains Lesson', () => {
      const lesson = { start: new Date('2026-09-04T09:00:00.000Z') };
      const customTitles = {
        '2026-09-04T09:00:00.000Z': 'Lesson 1 - Advanced React',
      };
      expect(formatLessonTitle({ lesson, index: 1, customTitles })).toBe(
        'Lesson 1 - Advanced React'
      );
    });
  });

  describe('formatLessonDisplayName', () => {
    it('formats label with date and time range', () => {
      const lesson = {
        start: new Date('2026-09-04T09:00:00.000Z'),
        end: new Date('2026-09-04T11:00:00.000Z'),
      };
      const label = formatLessonDisplayName({ lesson, index: 2 });
      expect(label).toContain('Lesson 02');
    });
  });

  describe('formatLessonFolderName', () => {
    it('formats folder-safe name with date stamp', () => {
      const lesson = { start: new Date('2026-09-04T09:00:00.000Z') };
      const folder = formatLessonFolderName({ lesson, index: 1 });
      expect(folder).toBe('Lesson 01 (2026-09-04)');

      const withCustom = formatLessonFolderName({
        lesson,
        index: 1,
        customTitles: { '2026-09-04T09:00:00.000Z': 'Docker Setup' },
      });
      expect(withCustom).toBe('Lesson 01 - Docker Setup (2026-09-04)');
    });
  });

  describe('findLessonForTimestamp', () => {
    const lessons = [
      {
        index: 1,
        start: new Date('2026-09-04T09:00:00.000Z'),
        end: new Date('2026-09-04T11:00:00.000Z'),
      },
      {
        index: 2,
        start: new Date('2026-09-11T09:00:00.000Z'),
        end: new Date('2026-09-11T11:00:00.000Z'),
      },
    ];

    it('matches timestamp inside a lesson slot', () => {
      const inLesson = new Date('2026-09-04T09:30:00.000Z');
      const matched = findLessonForTimestamp(inLesson, lessons);
      expect(matched).not.toBeNull();
      expect(matched.index).toBe(1);
    });

    it('matches timestamp within buffer period', () => {
      const justBefore = new Date('2026-09-04T08:45:00.000Z'); // 15 mins before
      const matched = findLessonForTimestamp(justBefore, lessons, 30);
      expect(matched).not.toBeNull();
      expect(matched.index).toBe(1);
    });

    it('returns null if outside all lesson slots and buffers', () => {
      const otherDay = new Date('2026-09-05T12:00:00.000Z');
      const matched = findLessonForTimestamp(otherDay, lessons);
      expect(matched).toBeNull();
    });
  });

  describe('resolveVideoLessonName', () => {
    const lessons = [
      {
        index: 1,
        start: new Date('2026-09-04T09:00:00.000Z'),
        end: new Date('2026-09-04T11:00:00.000Z'),
      },
    ];

    it('routes task submissions to Tasks folder', () => {
      const taskVideo = {
        isTaskSubmission: true,
        taskId: 'task_docker_1',
        taskTitle: 'Docker Basics',
      };
      expect(resolveVideoLessonName({ video: taskVideo })).toBe(
        'Task - Docker Basics'
      );
    });

    it('uses explicit lessonTitle if present on video', () => {
      const video = { lessonTitle: 'Special Workshop 1' };
      expect(resolveVideoLessonName({ video })).toBe('Special Workshop 1');
    });

    it('resolves scheduled lesson folder from video startTime', () => {
      const video = { startTime: new Date('2026-09-04T09:15:00.000Z') };
      expect(resolveVideoLessonName({ video, lessons })).toBe(
        'Lesson 01 (2026-09-04)'
      );
    });

    it('falls back to session date if no scheduled lesson matches', () => {
      const video = { startTime: new Date('2026-09-08T14:00:00.000Z') };
      expect(resolveVideoLessonName({ video, lessons })).toBe('Session 2026-09-08');
    });
  });
});
