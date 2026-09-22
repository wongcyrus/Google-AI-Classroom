import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTimestampToVTT,
  formatTimestampToSRT,
  buildWebVTT,
  buildSRT,
  formatYouTubeChapters,
  generateYouTubeMetadata,
  resolveEffectiveStoragePath,
} from './processLectureSubtitles.js';

describe('processLectureSubtitles Formatting Utilities', () => {
  describe('formatTimestampToVTT', () => {
    it('formats 0 seconds properly', () => {
      expect(formatTimestampToVTT(0)).toBe('00:00:00.000');
    });

    it('formats seconds with milliseconds', () => {
      expect(formatTimestampToVTT(74.25)).toBe('00:01:14.250');
    });

    it('formats over an hour', () => {
      expect(formatTimestampToVTT(3665.123)).toBe('01:01:05.123');
    });

    it('handles negative or invalid seconds safely', () => {
      expect(formatTimestampToVTT(-5)).toBe('00:00:00.000');
      expect(formatTimestampToVTT(null)).toBe('00:00:00.000');
    });
  });

  describe('formatTimestampToSRT', () => {
    it('uses comma instead of dot for milliseconds according to SubRip spec', () => {
      expect(formatTimestampToSRT(74.25)).toBe('00:01:14,250');
      expect(formatTimestampToSRT(3665.123)).toBe('01:01:05,123');
    });
  });

  describe('buildWebVTT', () => {
    const mockSegments = [
      {
        start: 1.5,
        end: 4.8,
        original: '今日我哋會講 React state。',
        translations: {
          en: 'Today we will discuss React state.',
          'zh-Hant': '今天我們將討論 React 狀態。',
          ja: '今日は React の state について話します。',
        },
      },
      {
        start: 5.0,
        end: 8.2,
        original: '請大家打開 VS Code。',
        translations: {
          en: 'Please open VS Code.',
          'zh-Hant': '請大家打開 VS Code。',
          ja: 'VS Code を開いてください。',
        },
      },
    ];

    it('generates standard WebVTT header and original text cues', () => {
      const vtt = buildWebVTT(mockSegments, 'original');
      expect(vtt).toContain('WEBVTT\n\n');
      expect(vtt).toContain('1\n00:00:01.500 --> 00:00:04.800\n今日我哋會講 React state。');
      expect(vtt).toContain('2\n00:00:05.000 --> 00:00:08.200\n請大家打開 VS Code。');
    });

    it('generates translated WebVTT cues for English', () => {
      const vtt = buildWebVTT(mockSegments, 'en');
      expect(vtt).toContain('Today we will discuss React state.');
      expect(vtt).toContain('Please open VS Code.');
    });

    it('generates translated WebVTT cues for Japanese', () => {
      const vtt = buildWebVTT(mockSegments, 'ja');
      expect(vtt).toContain('今日は React の state について話します。');
      expect(vtt).toContain('VS Code を開いてください。');
    });
  });

  describe('buildSRT', () => {
    const mockSegments = [
      {
        start: 12.0,
        end: 15.5,
        original: 'Express router setup',
        translations: {
          en: 'Express router setup',
          'zh-Hant': 'Express 路由設置',
        },
      },
    ];

    it('generates SubRip format with commas and 1-indexed numbers', () => {
      const srt = buildSRT(mockSegments, 'en');
      expect(srt).toContain('1\n00:00:12,000 --> 00:00:15,500\nExpress router setup\n\n');
    });
  });

  describe('formatYouTubeChapters', () => {
    it('formats chapters array into YouTube timestamp index', () => {
      const chapters = [
        { timeSeconds: 0, title: 'Introduction' },
        { timeSeconds: 154, title: 'Setting up dependencies' },
        { timeSeconds: 725, title: 'Live Coding Demo' },
      ];
      const output = formatYouTubeChapters(chapters);
      expect(output).toBe('00:00 - Introduction\n02:34 - Setting up dependencies\n12:05 - Live Coding Demo');
    });

    it('handles empty chapters gracefully with default Intro', () => {
      expect(formatYouTubeChapters([])).toBe('00:00 - Introduction\n');
    });
  });

  describe('generateYouTubeMetadata', () => {
    it('produces formatted YouTube title and description', () => {
      const meta = generateYouTubeMetadata({
        classId: 'IT114115',
        title: 'REST API & Express',
        topic: 'Web Development',
        chapters: [
          { timeSeconds: 0, title: 'Intro' },
          { timeSeconds: 60, title: 'Express Setup' },
        ],
        availableLanguages: ['original', 'en', 'zh-Hant', 'ja'],
      });

      expect(meta.title).toContain('IT114115 - REST API & Express');
      expect(meta.description).toContain('Course / Class: IT114115');
      expect(meta.description).toContain('00:00 - Intro');
      expect(meta.description).toContain('01:00 - Express Setup');
      expect(meta.description).toContain('- English');
      expect(meta.description).toContain('- Traditional Chinese (繁體中文)');
      expect(meta.description).toContain('- Japanese (日本語)');
    });
  });

  describe('resolveEffectiveStoragePath', () => {
    it('prioritizes audioStoragePath over composite video storagePath', () => {
      const sessionData = {
        storagePath: 'recordings/class_1/rec_1/lecture.webm',
        audioStoragePath: 'recordings/class_1/rec_1/lecture_audio.webm',
      };
      const result = resolveEffectiveStoragePath(sessionData, null);
      expect(result.effectiveStoragePath).toBe('recordings/class_1/rec_1/lecture_audio.webm');
      expect(result.transcriptionSource).toBe('audio_only');
    });

    it('falls back to video storagePath when audioStoragePath is missing', () => {
      const sessionData = {
        storagePath: 'recordings/class_1/rec_1/lecture.webm',
      };
      const result = resolveEffectiveStoragePath(sessionData, null);
      expect(result.effectiveStoragePath).toBe('recordings/class_1/rec_1/lecture.webm');
      expect(result.transcriptionSource).toBe('video');
    });

    it('uses requestedStoragePath when sessionData has no audio', () => {
      const sessionData = {};
      const result = resolveEffectiveStoragePath(sessionData, 'recordings/override/lecture.mp4');
      expect(result.effectiveStoragePath).toBe('recordings/override/lecture.mp4');
      expect(result.transcriptionSource).toBe('video');
    });

    it('detects audio in requestedStoragePath and tags as audio_only', () => {
      const sessionData = {};
      const result = resolveEffectiveStoragePath(sessionData, 'recordings/override/lecture_audio.webm');
      expect(result.effectiveStoragePath).toBe('recordings/override/lecture_audio.webm');
      expect(result.transcriptionSource).toBe('audio_only');
    });

    it('returns null and video source if no paths are provided', () => {
      const result = resolveEffectiveStoragePath({}, null);
      expect(result.effectiveStoragePath).toBeNull();
      expect(result.transcriptionSource).toBe('video');
    });
  });
});
