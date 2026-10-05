import { describe, it, expect, vi } from 'vitest';
import {
  SUBTITLE_LANGUAGES,
  getInitialSubtitleLang,
  getSubtitleLanguageLabel,
  isTrackMatch,
  applySubtitleTrack,
  getActiveSubtitleLang,
  determineDefaultPlayerMode,
  fixWebmPlaybackDuration,
  handleVideoEndedGuard,
  parseVttTimestamp,
  parseWebVTT,
  findActiveCue,
} from './videoSubtitleUtils';

describe('videoSubtitleUtils', () => {
  describe('getInitialSubtitleLang', () => {
    it('returns "off" for null, undefined, or empty object', () => {
      expect(getInitialSubtitleLang(null)).toBe('off');
      expect(getInitialSubtitleLang(undefined)).toBe('off');
      expect(getInitialSubtitleLang({})).toBe('off');
    });

    it('prioritizes English if available', () => {
      expect(
        getInitialSubtitleLang({
          'zh-Hant': 'https://...',
          en: 'https://...',
        })
      ).toBe('en');
    });

    it('falls back to Traditional Chinese if English is not present', () => {
      expect(
        getInitialSubtitleLang({
          'zh-Hant': 'https://...',
          ja: 'https://...',
        })
      ).toBe('zh-Hant');
    });

    it('falls back to Simplified Chinese if en and zh-Hant not present', () => {
      expect(
        getInitialSubtitleLang({
          'zh-Hans': 'https://...',
          ja: 'https://...',
        })
      ).toBe('zh-Hans');
    });

    it('falls back to original if en, zh-Hant, zh-Hans not present', () => {
      expect(
        getInitialSubtitleLang({
          original: 'https://...',
        })
      ).toBe('original');
    });

    it('returns first key if unknown language key is present', () => {
      expect(
        getInitialSubtitleLang({
          de: 'https://...',
        })
      ).toBe('de');
    });
  });

  describe('getSubtitleLanguageLabel', () => {
    it('returns Off label for off or empty string', () => {
      expect(getSubtitleLanguageLabel('off')).toBe('Off (關閉)');
      expect(getSubtitleLanguageLabel('')).toBe('Off (關閉)');
      expect(getSubtitleLanguageLabel(null)).toBe('Off (關閉)');
    });

    it('returns configured emoji flag and label for known codes', () => {
      expect(getSubtitleLanguageLabel('en')).toBe('🇬🇧 English');
      expect(getSubtitleLanguageLabel('zh-Hant')).toBe('🇭🇰 繁體中文');
      expect(getSubtitleLanguageLabel('zh-Hans')).toBe('🇨🇳 简体中文');
      expect(getSubtitleLanguageLabel('ja')).toBe('🇯🇵 日本語');
      expect(getSubtitleLanguageLabel('ko')).toBe('🇰🇷 한국어');
      expect(getSubtitleLanguageLabel('es')).toBe('🇪🇸 Español');
      expect(getSubtitleLanguageLabel('fr')).toBe('🇫🇷 Français');
      expect(getSubtitleLanguageLabel('original')).toBe('🎙️ 原文 (粵/英)');
    });

    it('returns uppercase code for unrecognized language code', () => {
      expect(getSubtitleLanguageLabel('ar')).toBe('AR');
    });
  });

  describe('isTrackMatch', () => {
    it('matches en track by language or label', () => {
      expect(isTrackMatch({ language: 'en', label: 'English' }, 'en')).toBe(true);
      expect(isTrackMatch({ language: 'en-US', label: 'English (US)' }, 'en')).toBe(true);
      expect(isTrackMatch({ language: 'fr', label: 'French' }, 'en')).toBe(false);
    });

    it('matches zh-Hant track by language or label', () => {
      expect(isTrackMatch({ language: 'zh-Hant', label: 'Traditional Chinese' }, 'zh-Hant')).toBe(true);
      expect(isTrackMatch({ language: 'zh-TW', label: '繁體中文' }, 'zh-Hant')).toBe(true);
      expect(isTrackMatch({ language: 'zh-HK', label: 'Chinese (HK)' }, 'zh-Hant')).toBe(true);
      expect(isTrackMatch({ language: 'en', label: 'English' }, 'zh-Hant')).toBe(false);
    });

    it('matches zh-Hans track by language or label', () => {
      expect(isTrackMatch({ language: 'zh-Hans', label: 'Simplified Chinese' }, 'zh-Hans')).toBe(true);
      expect(isTrackMatch({ language: 'zh-CN', label: '简体中文' }, 'zh-Hans')).toBe(true);
    });

    it('matches ja track by language or label', () => {
      expect(isTrackMatch({ language: 'ja', label: 'Japanese' }, 'ja')).toBe(true);
      expect(isTrackMatch({ language: 'ja-JP', label: '日本語' }, 'ja')).toBe(true);
    });

    it('matches ko, es, fr tracks by language or label', () => {
      expect(isTrackMatch({ language: 'ko', label: 'Korean' }, 'ko')).toBe(true);
      expect(isTrackMatch({ language: 'es', label: 'Spanish' }, 'es')).toBe(true);
      expect(isTrackMatch({ language: 'fr', label: 'French' }, 'fr')).toBe(true);
    });

    it('matches original speech track by language or label', () => {
      expect(isTrackMatch({ language: 'zh', label: 'Original (Cantonese/English)' }, 'original')).toBe(true);
      expect(isTrackMatch({ language: 'yue', label: 'Original Speech' }, 'original')).toBe(true);
      expect(isTrackMatch({ language: 'original', label: 'Original' }, 'original')).toBe(true);
    });

    it('returns false for off target', () => {
      expect(isTrackMatch({ language: 'en', label: 'English' }, 'off')).toBe(false);
    });
  });

  describe('applySubtitleTrack & getActiveSubtitleLang', () => {
    it('sets matching track to showing and others to disabled for built-in player CC', () => {
      const track1 = { language: 'en', label: 'English', mode: 'disabled' };
      const track2 = { language: 'zh-Hant', label: 'Traditional Chinese', mode: 'disabled' };
      const videoElement = {
        textTracks: [track1, track2],
      };

      const matched = applySubtitleTrack(videoElement, 'zh-Hant');
      expect(matched).toBe(track2);
      expect(track1.mode).toBe('disabled');
      expect(track2.mode).toBe('showing');
      expect(getActiveSubtitleLang(videoElement)).toBe('zh-Hant');
    });

    it('disables all tracks when targetLang is off', () => {
      const track1 = { language: 'en', label: 'English', mode: 'showing' };
      const track2 = { language: 'zh-Hant', label: 'Traditional Chinese', mode: 'showing' };
      const videoElement = {
        textTracks: [track1, track2],
      };

      const matched = applySubtitleTrack(videoElement, 'off');
      expect(matched).toBeNull();
      expect(track1.mode).toBe('disabled');
      expect(track2.mode).toBe('disabled');
      expect(getActiveSubtitleLang(videoElement)).toBe('off');
    });

    it('safely handles null videoElement or missing textTracks', () => {
      expect(applySubtitleTrack(null, 'en')).toBeNull();
      expect(applySubtitleTrack({}, 'en')).toBeNull();
      expect(getActiveSubtitleLang(null)).toBe('off');
      expect(getActiveSubtitleLang({})).toBe('off');
    });
  });

  describe('determineDefaultPlayerMode', () => {
    it('prioritizes YouTube if youtubeVideoId is present', () => {
      const rec = {
        youtubeVideoId: 'yt123',
        videoUrl: 'https://cloud.storage/video.mp4',
        driveFileId: 'drive123',
        vttUrls: { en: 'https://...' },
      };
      expect(determineDefaultPlayerMode(rec)).toBe('youtube');
    });

    it('prioritizes Cloud Storage Player over Drive if subtitles (vttUrls) exist, avoiding Drive no-CC issue', () => {
      const rec = {
        videoUrl: 'https://cloud.storage/video.mp4',
        driveFileId: 'drive123',
        vttUrls: { en: 'https://...', 'zh-Hant': 'https://...' },
      };
      expect(determineDefaultPlayerMode(rec)).toBe('cloud');
    });

    it('falls back to Google Drive if no subtitles exist and driveFileId is present', () => {
      const rec = {
        videoUrl: 'https://cloud.storage/video.mp4',
        driveFileId: 'drive123',
        vttUrls: {},
      };
      expect(determineDefaultPlayerMode(rec)).toBe('drive');
    });

    it('falls back to cloud player if only videoUrl is present', () => {
      const rec = {
        videoUrl: 'https://cloud.storage/video.mp4',
      };
      expect(determineDefaultPlayerMode(rec)).toBe('cloud');
    });

    it('returns cloud for empty or null recording', () => {
      expect(determineDefaultPlayerMode(null)).toBe('cloud');
    });
  });

  describe('fixWebmPlaybackDuration', () => {
    it('safely exits if video element is null or undefined', () => {
      expect(() => fixWebmPlaybackDuration(null, 100)).not.toThrow();
      expect(() => fixWebmPlaybackDuration(undefined, 100)).not.toThrow();
    });

    it('does not seek if browser duration is already accurate', () => {
      const listeners = {};
      const video = {
        duration: 2210.5,
        currentTime: 10,
        muted: false,
        paused: false,
        addEventListener: vi.fn((ev, cb) => { listeners[ev] = cb; }),
        removeEventListener: vi.fn(),
      };

      fixWebmPlaybackDuration(video, 2211);
      expect(video.addEventListener).not.toHaveBeenCalled();
      expect(video.currentTime).toBe(10);
    });

    it('probes true duration near the expected end if browser duration is truncated', () => {
      const listeners = {};
      const playMock = vi.fn().mockResolvedValue(undefined);
      const video = {
        duration: 45.2, // truncated by Chromium
        currentTime: 0,
        muted: false,
        paused: true,
        addEventListener: vi.fn((ev, cb) => { listeners[ev] = cb; }),
        removeEventListener: vi.fn((ev) => { delete listeners[ev]; }),
        play: playMock,
      };

      fixWebmPlaybackDuration(video, 2211); // ~36 min 51s

      // Should have temporarily muted video and set currentTime to 1e101
      expect(video.muted).toBe(true);
      expect(video.currentTime).toBe(1e101);
      expect(listeners['seeked']).toBeDefined();

      // Simulate browser reaching end of media and firing seeked
      video.duration = 2211.4;
      listeners['seeked']();

      // Video should seek back to 0
      expect(video.currentTime).toBe(0);
      expect(listeners['seeked']).toBeDefined();

      // Simulate second seeked event (back at 0)
      listeners['seeked']();

      // Should have restored muted state and cleared fixing flag
      expect(video.muted).toBe(false);
      expect(video._isFixingWebmDuration).toBe(false);
    });

    it('does not trigger multiple concurrent seeks', () => {
      const video = {
        duration: 45.2,
        _isFixingWebmDuration: true,
        addEventListener: vi.fn(),
      };
      fixWebmPlaybackDuration(video, 2211);
      expect(video.addEventListener).not.toHaveBeenCalled();
    });

    it('invokes onComplete immediately when browser duration is already accurate', () => {
      const onComplete = vi.fn();
      const video = {
        duration: 120,
        currentTime: 0,
        muted: false,
        paused: true,
        addEventListener: vi.fn(),
      };
      fixWebmPlaybackDuration(video, 120, onComplete);
      expect(onComplete).toHaveBeenCalledWith(video);
    });

    it('invokes onComplete after seek back to 0 is complete when duration was truncated', () => {
      const listeners = {};
      const onComplete = vi.fn();
      const video = {
        duration: 10,
        currentTime: 0,
        muted: false,
        paused: true,
        addEventListener: vi.fn((ev, cb) => { listeners[ev] = cb; }),
        removeEventListener: vi.fn((ev) => { delete listeners[ev]; }),
      };

      fixWebmPlaybackDuration(video, 100, onComplete);
      expect(onComplete).not.toHaveBeenCalled();

      // End seeked
      video.duration = 100;
      listeners['seeked']();
      expect(onComplete).not.toHaveBeenCalled();

      // Start seeked (back to 0)
      listeners['seeked']();
      expect(onComplete).toHaveBeenCalledWith(video);
    });
  });

  describe('handleVideoEndedGuard', () => {
    it('safely exits if event or currentTarget is missing', () => {
      expect(() => handleVideoEndedGuard(null, 100)).not.toThrow();
      expect(() => handleVideoEndedGuard({}, 100)).not.toThrow();
    });

    it('does not resume if video ended near the expected end', () => {
      const playMock = vi.fn();
      const video = {
        currentTime: 2205,
        play: playMock,
      };
      handleVideoEndedGuard({ currentTarget: video }, 2211);
      expect(playMock).not.toHaveBeenCalled();
    });

    it('resumes playback if video prematurely ended significantly before expected duration', () => {
      const playMock = vi.fn().mockResolvedValue(undefined);
      const video = {
        currentTime: 45.2,
        play: playMock,
      };
      handleVideoEndedGuard({ currentTarget: video }, 2211);
      expect(video.currentTime).toBeCloseTo(45.3, 1);
      expect(playMock).toHaveBeenCalled();
    });

    it('does nothing if expected duration is 0 or very short', () => {
      const playMock = vi.fn();
      const video = {
        currentTime: 5,
        play: playMock,
      };
      handleVideoEndedGuard({ currentTarget: video }, 0);
      handleVideoEndedGuard({ currentTarget: video }, 20);
      expect(playMock).not.toHaveBeenCalled();
    });
  });

  describe('parseVttTimestamp', () => {
    it('parses HH:MM:SS.mmm format', () => {
      expect(parseVttTimestamp('01:02:03.500')).toBeCloseTo(3723.5, 3);
    });

    it('parses MM:SS.mmm format', () => {
      expect(parseVttTimestamp('02:15.200')).toBeCloseTo(135.2, 3);
      expect(parseVttTimestamp('00:00.500')).toBeCloseTo(0.5, 3);
    });

    it('ignores cue positioning directives', () => {
      expect(parseVttTimestamp('00:10.000 line:0 position:20%')).toBe(10);
    });

    it('returns NaN for invalid or empty timestamp', () => {
      expect(parseVttTimestamp('')).toBeNaN();
      expect(parseVttTimestamp(null)).toBeNaN();
      expect(parseVttTimestamp('invalid')).toBeNaN();
    });
  });

  describe('parseWebVTT', () => {
    it('returns empty array for empty or invalid string', () => {
      expect(parseWebVTT('')).toEqual([]);
      expect(parseWebVTT(null)).toEqual([]);
    });

    it('parses standard WebVTT cues into start, end, and text', () => {
      const vtt = `WEBVTT

1
00:00:00.500 --> 00:00:15.200
Today we will use useState to build a real-time component.

2
00:00:16.000 --> 00:00:20.500
First, import useState from react.`;

      const cues = parseWebVTT(vtt);
      expect(cues).toHaveLength(2);
      expect(cues[0]).toEqual({
        start: 0.5,
        end: 15.2,
        text: 'Today we will use useState to build a real-time component.',
      });
      expect(cues[1]).toEqual({
        start: 16.0,
        end: 20.5,
        text: 'First, import useState from react.',
      });
    });

    it('handles multiline cue texts and skips NOTE comments', () => {
      const vtt = `WEBVTT

NOTE This is a comment

1
00:01:00.000 --> 00:01:05.000
Line 1
Line 2`;

      const cues = parseWebVTT(vtt);
      expect(cues).toHaveLength(1);
      expect(cues[0].text).toBe('Line 1\nLine 2');
    });
  });

  describe('findActiveCue', () => {
    const cues = [
      { start: 0.5, end: 15.2, text: 'Hello class' },
      { start: 20.0, end: 25.0, text: 'Second part' },
    ];

    it('returns cue text when current time falls within start and end', () => {
      expect(findActiveCue(cues, 5.0)).toBe('Hello class');
      expect(findActiveCue(cues, 0.5)).toBe('Hello class');
      expect(findActiveCue(cues, 15.2)).toBe('Hello class');
      expect(findActiveCue(cues, 22.0)).toBe('Second part');
    });

    it('returns empty string when current time is outside any cue', () => {
      expect(findActiveCue(cues, 0.1)).toBe('');
      expect(findActiveCue(cues, 17.0)).toBe('');
      expect(findActiveCue(cues, 30.0)).toBe('');
    });

    it('safely handles empty cues or invalid times', () => {
      expect(findActiveCue([], 10)).toBe('');
      expect(findActiveCue(null, 10)).toBe('');
      expect(findActiveCue(cues, null)).toBe('');
    });
  });
});
