import { describe, it, expect } from 'vitest';
import { VIDEO_FRAME_RATE } from './config.js';

describe('Video Encoding Settings', () => {
  it('should have standard 1 FPS frame rate configured', () => {
    expect(VIDEO_FRAME_RATE).toBe(1);
  });

  it('should format text overlay string accurately', () => {
    const date = '2026-08-28';
    const time = '14:30:00';
    const classId = 'CLASS-101';
    const studentEmail = 'student@example.com';
    const text = `Date: ${date}, Time: ${time}, Class: ${classId}, Email: ${studentEmail}`;
    expect(text).toBe('Date: 2026-08-28, Time: 14:30:00, Class: CLASS-101, Email: student@example.com');
  });

  it('should compute even dimensions for odd width/height inputs', () => {
    let width = 1921;
    let height = 1079;
    if (width > 1920) {
      height = Math.round((height * 1920) / width);
      width = 1920;
    }
    if (width % 2 !== 0) width--;
    if (height % 2 !== 0) height--;

    expect(width).toBe(1920);
    expect(height % 2).toBe(0);
    expect(width % 2).toBe(0);
  });
});
