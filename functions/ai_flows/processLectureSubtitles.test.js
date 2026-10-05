import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTimestampToVTT,
  formatTimestampToSRT,
  buildWebVTT,
  buildSRT,
  formatYouTubeChapters,
  generateYouTubeMetadata,
  resolveEffectiveStoragePath,
  normalizeLectureAudio,
  calibrateSubtitleTimeline,
  ensureIndexedLectureVideo,
  sanitizeJsonStringNewlines,
  parseAiJsonResponse,
  extractSegmentsAndChaptersByRegex,
  buildLectureSubtitlePrompt,
  buildLectureTranslationPrompt,
  ensureSegmentTranslations,
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

    it('fixes zero-duration cues so browser players do not discard them', () => {
      const zeroDurSegs = [{ start: 10.0, end: 10.0, original: 'Zero duration cue' }];
      const vtt = buildWebVTT(zeroDurSegs, 'original');
      expect(vtt).toContain('00:00:10.000 --> 00:00:14.250');
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

    it('fixes zero-duration cues in SRT export', () => {
      const zeroDurSegs = [{ start: 20.0, end: 20.0, original: 'Zero duration srt cue' }];
      const srt = buildSRT(zeroDurSegs, 'original');
      expect(srt).toContain('00:00:20,000 --> 00:00:25,000');
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

    it('prioritizes normalizedAudioStoragePath over raw audioStoragePath', () => {
      const sessionData = {
        storagePath: 'recordings/class_1/rec_1/lecture.webm',
        audioStoragePath: 'recordings/class_1/rec_1/lecture_audio.webm',
        normalizedAudioStoragePath: 'recordings/class_1/rec_1/lecture_audio_normalized.mp3',
      };
      const result = resolveEffectiveStoragePath(sessionData, null);
      expect(result.effectiveStoragePath).toBe('recordings/class_1/rec_1/lecture_audio_normalized.mp3');
      expect(result.transcriptionSource).toBe('audio_only');
    });

    it('returns null and video source if no paths are provided', () => {
      const result = resolveEffectiveStoragePath({}, null);
      expect(result.effectiveStoragePath).toBeNull();
    });
  });

  describe('normalizeLectureAudio', () => {
    it('returns null if rawAudioPath is null or empty', async () => {
      const res = await normalizeLectureAudio({ bucket: {}, classId: 'c1', sessionId: 's1', rawAudioPath: null });
      expect(res).toBeNull();
    });

    it('returns rawAudioPath directly if it is already an mp3', async () => {
      const res = await normalizeLectureAudio({
        bucket: {},
        classId: 'c1',
        sessionId: 's1',
        rawAudioPath: 'recordings/c1/s1/audio.mp3',
      });
      expect(res).toBe('recordings/c1/s1/audio.mp3');
    });

    it('returns normalizedStoragePath if specified and it exists', async () => {
      const mockBucket = {
        file: vi.fn().mockReturnValue({
          exists: vi.fn().mockResolvedValue([true]),
        }),
      };
      const res = await normalizeLectureAudio({
        bucket: mockBucket,
        classId: 'c1',
        sessionId: 's1',
        rawAudioPath: 'recordings/c1/s1/lecture_audio.webm',
        normalizedStoragePath: 'recordings/c1/s1/lecture_audio_normalized.mp3',
      });
      expect(res).toBe('recordings/c1/s1/lecture_audio_normalized.mp3');
    });

    it('returns candidate normalized path if it already exists in bucket', async () => {
      const mockBucket = {
        file: vi.fn((path) => ({
          exists: vi.fn().mockResolvedValue([path.includes('normalized.mp3')]),
        })),
      };
      const res = await normalizeLectureAudio({
        bucket: mockBucket,
        classId: 'c1',
        sessionId: 's1',
        rawAudioPath: 'recordings/c1/s1/lecture_audio.webm',
      });
      expect(res).toBe('recordings/c1/s1/lecture_audio_normalized.mp3');
    });

    it('falls back gracefully to rawAudioPath if download or transcode fails', async () => {
      const mockBucket = {
        file: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue([false]),
          download: vi.fn().mockRejectedValue(new Error('Network error')),
        })),
      };
      const res = await normalizeLectureAudio({
        bucket: mockBucket,
        classId: 'c1',
        sessionId: 's1',
        rawAudioPath: 'recordings/c1/s1/lecture_audio.webm',
      });
      expect(res).toBe('recordings/c1/s1/lecture_audio.webm');
    });
  });

  describe('calibrateSubtitleTimeline', () => {
    it('returns unmodified segments if totalDuration is missing or segments empty', () => {
      const emptyRes = calibrateSubtitleTimeline([], [], 0);
      expect(emptyRes.driftRatio).toBe(1.0);
      expect(emptyRes.segments).toEqual([]);

      const mockSegs = [{ start: 0, end: 5, original: 'test' }];
      const noDurRes = calibrateSubtitleTimeline(mockSegs, [], 0);
      expect(noDurRes.driftRatio).toBe(1.0);
      expect(noDurRes.segments).toBe(mockSegs);
    });

    it('returns unmodified segments if drift ratio is <= 1.05', () => {
      const mockSegs = [{ start: 0, end: 98, original: 'test' }];
      const res = calibrateSubtitleTimeline(mockSegs, [], 100);
      expect(res.driftRatio).toBe(1.0);
      expect(res.segments).toBe(mockSegs);
    });

    it('corrects linear timescale compression when drift ratio > 1.05', () => {
      const mockSegs = [
        { start: 0, end: 6.8, original: 'start' },
        { start: 329.5, end: 335.5, original: 'mid1' },
        { start: 665.5, end: 672.2, original: 'mid2' },
        { start: 1306.8, end: 1313.0, original: 'end' },
      ];
      const mockChapters = [
        { timeSeconds: 0, title: 'Intro' },
        { timeSeconds: 204, title: 'Capacity' },
        { timeSeconds: 870, title: 'Transactions' },
      ];

      const res = calibrateSubtitleTimeline(mockSegs, mockChapters, 2211.5);
      expect(res.driftRatio).toBeCloseTo(1.6843, 3);

      // Cue #1 remains at 0s
      expect(res.segments[0].start).toBe(0);

      // Cue #2 scaled ~555s
      expect(res.segments[1].start).toBeCloseTo(555.0, 0);

      // Cue #3 scaled ~1121s
      expect(res.segments[2].start).toBeCloseTo(1121.0, 0);

      // Final cue aligns with media end (2211.5s)
      expect(res.segments[3].end).toBe(2211.5);

      // Chapters scaled proportionally
      expect(res.chapters[0].timeSeconds).toBe(0);
      expect(res.chapters[1].timeSeconds).toBe(Math.round(204 * res.driftRatio));
    });
  });

  describe('ensureIndexedLectureVideo', () => {
    it('skips non-webm or audio-only files cleanly', async () => {
      const res1 = await ensureIndexedLectureVideo({ videoStoragePath: null });
      expect(res1).toBeNull();

      const res2 = await ensureIndexedLectureVideo({ videoStoragePath: 'recordings/c1/s1/lecture.mp4' });
      expect(res2).toBe('recordings/c1/s1/lecture.mp4');

      const res3 = await ensureIndexedLectureVideo({ videoStoragePath: 'recordings/c1/s1/lecture_audio.webm' });
      expect(res3).toBe('recordings/c1/s1/lecture_audio.webm');
    });

    it('skips already indexed files with hasCuesIndex=true in metadata', async () => {
      const mockBucket = {
        file: vi.fn().mockReturnValue({
          exists: vi.fn().mockResolvedValue([true]),
          getMetadata: vi.fn().mockResolvedValue([{ metadata: { hasCuesIndex: 'true' } }]),
        }),
      };

      const res = await ensureIndexedLectureVideo({
        bucket: mockBucket,
        classId: 'c1',
        sessionId: 's1',
        videoStoragePath: 'recordings/c1/s1/lecture.webm',
      });

      expect(res).toBe('recordings/c1/s1/lecture.webm');
      expect(mockBucket.file).toHaveBeenCalledWith('recordings/c1/s1/lecture.webm');
    });

    it('handles missing file or download errors gracefully without crashing', async () => {
      const mockBucket = {
        file: vi.fn().mockReturnValue({
          exists: vi.fn().mockResolvedValue([false]),
        }),
      };

      const res = await ensureIndexedLectureVideo({
        bucket: mockBucket,
        classId: 'c1',
        sessionId: 's1',
        videoStoragePath: 'recordings/c1/s1/lecture.webm',
      });

      expect(res).toBe('recordings/c1/s1/lecture.webm');
    });
  });

  describe('parseAiJsonResponse', () => {
    it('returns null for null, undefined, or non-string inputs', () => {
      expect(parseAiJsonResponse(null)).toBeNull();
      expect(parseAiJsonResponse(undefined)).toBeNull();
      expect(parseAiJsonResponse(123)).toBeNull();
      expect(parseAiJsonResponse('')).toBeNull();
    });

    it('parses valid JSON without markdown fences', () => {
      const json = JSON.stringify({ chapters: [{ timeSeconds: 0, title: 'Intro' }] });
      const parsed = parseAiJsonResponse(json);
      expect(parsed).toEqual({ chapters: [{ timeSeconds: 0, title: 'Intro' }] });
    });

    it('parses JSON enclosed in markdown code fences with control characters', () => {
      const fenced = '```json\n{\n  "status": "ok",\n  "count": 42\x07\n}\n```';
      const parsed = parseAiJsonResponse(fenced);
      expect(parsed).toEqual({ status: 'ok', count: 42 });
    });

    it('removes trailing commas in objects and arrays', () => {
      const withTrailing = `{
        "items": [
          { "id": 1, },
          { "id": 2, },
        ],
      }`;
      const parsed = parseAiJsonResponse(withTrailing);
      expect(parsed).toEqual({
        items: [{ id: 1 }, { id: 2 }],
      });
    });

    it('auto-repairs truncated JSON responses cut off at token limits', () => {
      const truncated = `{
        "chapters": [{ "timeSeconds": 0, "title": "Intro" }],
        "segments": [
          { "start": 0.0, "end": 2.5, "original": "First sentence" },
          { "start": 2.5, "end": 5.0, "original": "Second sentence" },
          { "start": 5.0, "end": 7.5, "original": "Incomplete sen`;

      const parsed = parseAiJsonResponse(truncated);
      expect(parsed).toBeDefined();
      expect(parsed.chapters).toHaveLength(1);
      expect(parsed.segments).toHaveLength(2);
      expect(parsed.segments[0].original).toBe('First sentence');
      expect(parsed.segments[1].original).toBe('Second sentence');
    });

    it('handles and parses JSON strings containing unescaped literal newlines without throwing JSON5 errors', () => {
      const rawWithNewlines = '{\n  "chapters": [{"timeSeconds": 0, "title": "Intro\nPart 1"}],\n  "segments": [{"start": 0.0, "end": 2.5, "original": "First line\nSecond line"}]\n}';
      const parsed = parseAiJsonResponse(rawWithNewlines);
      expect(parsed).toBeDefined();
      expect(parsed.chapters[0].title).toBe('Intro\nPart 1');
      expect(parsed.segments[0].original).toBe('First line\nSecond line');
    });

    it('sanitizes strings with tabs and carriage returns', () => {
      const sanitized = sanitizeJsonStringNewlines('{"text": "line1\r\nline2\tline3"}');
      expect(sanitized).toBe('{"text": "line1\\nline2\\tline3"}');
    });
  });

  describe('extractSegmentsAndChaptersByRegex', () => {
    it('returns null on empty or non-string inputs', () => {
      expect(extractSegmentsAndChaptersByRegex(null)).toBeNull();
      expect(extractSegmentsAndChaptersByRegex('')).toBeNull();
    });

    it('recovers segments and chapters even when JSON has unescaped quotes or invalid formatting', () => {
      const invalidJson = `
        Here is the transcription:
        { "chapters": [
            { "timeSeconds": 0, "title": "Intro" },
            { "timeSeconds": 120, "title": "Database Overview" }
          ],
          "segments": [
            { "start": 0.5, "end": 3.0, "original": "Welcome to class." },
            { "start": 3.1, "end": 6.8, "original": "This is "database" concepts." },
            { "start": 7.0, "end": 10.5, "original": "Next topic." }
          ]
        }
      `;
      const res = extractSegmentsAndChaptersByRegex(invalidJson);
      expect(res).toBeDefined();
      expect(res.chapters).toHaveLength(2);
      expect(res.chapters[0].title).toBe('Intro');
      expect(res.chapters[1].title).toBe('Database Overview');
      expect(res.segments.length).toBeGreaterThanOrEqual(2);
      expect(res.segments[0].original).toBe('Welcome to class.');
    });
  });

  describe('buildLectureSubtitlePrompt', () => {
    it('generates prompt asking strictly for verbatim original transcript and chapters without inline translations', () => {
      const prompt = buildLectureSubtitlePrompt({
        promptPreamble: 'System context: CS lecture',
        classId: 'itp4124-l',
        title: 'Cloud Architecture',
        topic: 'AWS DynamoDB',
        totalDuration: 3412.5,
      });

      expect(prompt).toContain('Class: itp4124-l');
      expect(prompt).toContain('Title: Cloud Architecture');
      expect(prompt).toContain('Topic: AWS DynamoDB');
      expect(prompt).toContain('spanning from 0.0 to 3413 seconds');
      expect(prompt).toContain('"chapters"');
      expect(prompt).toContain('"segments"');
      // Must not request inline multilingual translation in the audio multimodal pass
      expect(prompt).not.toContain('"translations":');
    });
  });

  describe('ensureSegmentTranslations', () => {
    it('fills missing or blank translation keys with original text as safety fallback', () => {
      const segments = [
        {
          start: 0.0,
          end: 3.5,
          original: 'Hello everyone',
          translations: {
            en: 'Hello everyone',
            'zh-Hant': '大家好',
          },
        },
        {
          start: 3.5,
          end: 7.0,
          original: 'Welcome to class',
          translations: {
            en: '   ', // blank
          },
        },
        {
          start: 7.0,
          end: 10.0,
          original: 'Let us start Docker',
        },
      ];

      const filled = ensureSegmentTranslations(segments, ['en', 'zh-Hant', 'ja']);
      expect(filled[0].translations['ja']).toBe('Hello everyone');
      expect(filled[1].translations['en']).toBe('Welcome to class'); // Replaced blank with original
      expect(filled[1].translations['zh-Hant']).toBe('Welcome to class');
      expect(filled[2].translations['en']).toBe('Let us start Docker');
      expect(filled[2].translations['zh-Hant']).toBe('Let us start Docker');
      expect(filled[2].translations['ja']).toBe('Let us start Docker');
    });

    it('handles non-array or empty inputs gracefully', () => {
      expect(ensureSegmentTranslations(null)).toEqual([]);
      expect(ensureSegmentTranslations([])).toEqual([]);
    });
  });

  describe('buildLectureTranslationPrompt', () => {
    it('generates prompt asking for translation into single target language with flat string array output', () => {
      const chunk = ['今日我哋會講 React state 同埋 useState hook。', '大家請打開 VS Code 準備。'];
      const prompt = buildLectureTranslationPrompt({
        classId: 'itp4124-l',
        subjectDomain: 'Computer Science',
        targetLanguage: 'en',
        chunk,
      });

      expect(prompt).toContain('Class: itp4124-l');
      expect(prompt).toContain('Academic Subject Domain: Computer Science');
      expect(prompt).toContain('English (en)');
      expect(prompt).toContain('Input array of 2 sentences:');
      expect(prompt).toContain('Output MUST be a valid JSON array of translated strings with the exact same length (2)');
      expect(prompt).toContain('今日我哋會講 React state 同埋 useState hook。');
    });

    it('interpolates custom translation template correctly', () => {
      const template = 'Translate for class {{classId}} in domain {{courseContext}} into {{targetLanguage}}. Keep Docker verbatim.';
      const chunk = ['Setup Docker container'];
      const prompt = buildLectureTranslationPrompt({
        template,
        classId: 'cs101',
        subjectDomain: 'DevOps',
        targetLanguage: 'zh-Hant',
        chunk,
      });

      expect(prompt).toContain('Translate for class cs101 in domain DevOps into Traditional Chinese (zh-Hant - 繁體中文書面語). Keep Docker verbatim.');
      expect(prompt).toContain('Input array of 1 sentences:');
    });
  });
});

