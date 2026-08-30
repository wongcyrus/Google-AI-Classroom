import { describe, it, expect } from 'vitest';
import {
  normalizeText,
  timeStringToSeconds,
  secondsToTimeString,
  mergeSlidingTranscripts,
} from './transcriptMerger';

describe('transcriptMerger utility', () => {
  describe('time conversion helpers', () => {
    it('converts MM:SS strings to total seconds', () => {
      expect(timeStringToSeconds('00:15')).toBe(15);
      expect(timeStringToSeconds('01:30')).toBe(90);
      expect(timeStringToSeconds('02:05.5')).toBe(125.5);
    });

    it('converts HH:MM:SS strings to total seconds', () => {
      expect(timeStringToSeconds('01:00:00')).toBe(3600);
      expect(timeStringToSeconds('01:15:30')).toBe(4530);
    });

    it('formats seconds to MM:SS string', () => {
      expect(secondsToTimeString(15)).toBe('00:15');
      expect(secondsToTimeString(90)).toBe('01:30');
      expect(secondsToTimeString(3665)).toBe('61:05');
    });

    it('normalizes text and strips punctuation', () => {
      expect(normalizeText('Hello, World!')).toBe('hello world');
      expect(normalizeText('  What is   Question 4?  ')).toBe('what is question 4');
    });
  });

  describe('mergeSlidingTranscripts', () => {
    it('returns new segments when existing list is empty', () => {
      const newSegs = [
        { startTime: '00:04', endTime: '00:09', speaker: 'Speaker 1', text: 'Hello class' },
      ];
      const merged = mergeSlidingTranscripts([], newSegs, 0, 15);
      expect(merged).toHaveLength(1);
      expect(merged[0].absoluteStartSec).toBe(4);
      expect(merged[0].text).toBe('Hello class');
    });

    it('deduplicates overlapping dialogue turns from sliding window', () => {
      // Window 1 (t = 0 to 30s)
      const existing = [
        {
          id: 'turn_1',
          startTime: '00:04',
          endTime: '00:09',
          absoluteStartSec: 4,
          absoluteEndSec: 9,
          speaker: 'Speaker 1',
          text: 'What is question 4?',
        },
        {
          id: 'turn_2',
          startTime: '00:26',
          endTime: '00:29',
          absoluteStartSec: 26,
          absoluteEndSec: 29,
          speaker: 'Speaker 2',
          text: 'The answer is...',
        },
      ];

      // Window 2 (t = 15 to 45s, stride = 15s)
      // Contains the completed sentence from second 26 (rel time 00:11)
      const newSegs = [
        {
          startTime: '00:11', // 15 + 11 = 26s
          endTime: '00:17',   // 15 + 17 = 32s
          speaker: 'Speaker 2',
          text: 'The answer is option B.',
        },
        {
          startTime: '00:20', // 15 + 20 = 35s
          endTime: '00:24',   // 15 + 24 = 39s
          speaker: 'Speaker 1',
          text: 'Thank you.',
        },
      ];

      const merged = mergeSlidingTranscripts(existing, newSegs, 15, 15);

      // Should have 3 turns total: turn 1, updated turn 2 with complete sentence, and turn 3
      expect(merged).toHaveLength(3);
      expect(merged[0].text).toBe('What is question 4?');
      expect(merged[1].text).toBe('The answer is option B.'); // healed boundary sentence!
      expect(merged[2].text).toBe('Thank you.');
      expect(merged[2].absoluteStartSec).toBe(35);
    });

    it('appends distinct non-overlapping turns in chronological order', () => {
      const existing = [
        {
          id: 'turn_1',
          absoluteStartSec: 5,
          absoluteEndSec: 10,
          speaker: 'Speaker 1',
          text: 'First statement',
        },
      ];

      const newSegs = [
        {
          startTime: '00:05', // 30 + 5 = 35s
          endTime: '00:09',   // 30 + 9 = 39s
          speaker: 'Speaker 2',
          text: 'Second statement much later',
        },
      ];

      const merged = mergeSlidingTranscripts(existing, newSegs, 30, 15);
      expect(merged).toHaveLength(2);
      expect(merged[0].text).toBe('First statement');
      expect(merged[1].text).toBe('Second statement much later');
    });

    it('handles numeric and empty string inputs in timeStringToSeconds', () => {
      expect(timeStringToSeconds(42)).toBe(42);
      expect(timeStringToSeconds('')).toBe(0);
      expect(timeStringToSeconds(null)).toBe(0);
      expect(timeStringToSeconds('invalid')).toBe(0);
      expect(timeStringToSeconds('45.2')).toBe(45.2);
    });

    it('returns copy of existing segments when newSegments is empty or null', () => {
      const existing = [{ id: '1', text: 'Existing' }];
      expect(mergeSlidingTranscripts(existing, [])).toEqual(existing);
      expect(mergeSlidingTranscripts(existing, null)).toEqual(existing);
    });

    it('inserts turns in the middle when out of order', () => {
      const existing = [
        { id: '1', absoluteStartSec: 10, absoluteEndSec: 15, text: 'Early turn' },
        { id: '3', absoluteStartSec: 50, absoluteEndSec: 55, text: 'Late turn' },
      ];
      const newSegs = [
        { startTime: '00:10', endTime: '00:15', text: 'Middle turn' }, // abs: 20 + 10 = 30s
      ];
      const merged = mergeSlidingTranscripts(existing, newSegs, 20, 15);
      expect(merged).toHaveLength(3);
      expect(merged[0].text).toBe('Early turn');
      expect(merged[1].text).toBe('Middle turn');
      expect(merged[2].text).toBe('Late turn');
    });

    it('skips empty text turns', () => {
      const existing = [{ id: '1', absoluteStartSec: 10, absoluteEndSec: 15, text: 'Hello' }];
      const newSegs = [{ startTime: '00:05', endTime: '00:08', text: '   ' }];
      const merged = mergeSlidingTranscripts(existing, newSegs, 10, 15);
      expect(merged).toHaveLength(1);
    });

    it('handles large silence gaps (e.g. >5 minutes) without corrupting timeline index', () => {
      const existing = [
        { id: '1', absoluteStartSec: 10, absoluteEndSec: 20, speaker: 'Speaker 1', text: 'Class beginning' },
      ];
      // 5-minute gap (300 seconds), new turn at 320s
      const newSegs = [
        { startTime: '00:20', endTime: '00:30', speaker: 'Speaker 1', text: '5 minutes later question 1' },
      ];
      const merged = mergeSlidingTranscripts(existing, newSegs, 300, 15);
      expect(merged).toHaveLength(2);
      expect(merged[1].absoluteStartSec).toBe(320);
      expect(merged[1].absoluteEndSec).toBe(330);
    });

    it('handles multiple alternating speakers in rapid bursts within single window', () => {
      const newSegs = [
        { startTime: '00:01', endTime: '00:03', speaker: 'Speaker 1', text: 'Is it A?' },
        { startTime: '00:03', endTime: '00:05', speaker: 'Speaker 2', text: 'No it is B.' },
        { startTime: '00:05', endTime: '00:07', speaker: 'Speaker 1', text: 'Are you sure?' },
        { startTime: '00:07', endTime: '00:09', speaker: 'Speaker 2', text: 'Yes 100%.' },
      ];
      const merged = mergeSlidingTranscripts([], newSegs, 0, 15);
      expect(merged).toHaveLength(4);
      expect(merged[0].speaker).toBe('Speaker 1');
      expect(merged[1].speaker).toBe('Speaker 2');
      expect(merged[2].speaker).toBe('Speaker 1');
      expect(merged[3].speaker).toBe('Speaker 2');
    });
  });
});
