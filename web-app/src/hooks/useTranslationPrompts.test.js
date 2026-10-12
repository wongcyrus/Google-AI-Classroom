import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useTranslationPrompts } from './useTranslationPrompts';

vi.mock('../firebase-config', () => ({
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((q, callback) => {
    setTimeout(() => {
      callback({
        docs: [
          {
            id: 't_prompt_1',
            data: () => ({
              name: 'Bilingual CS Subtitle Translator',
              category: 'translations',
              accessLevel: 'public',
              applyTo: ['Live Subtitles & Translation'],
              promptText: 'Translate CS lectures'
            })
          },
          {
            id: 't_prompt_2',
            data: () => ({
              name: 'Medical Lecture Translator',
              category: 'translations',
              accessLevel: 'private',
              owner: 'teacher_1',
              applyTo: ['Live Subtitles & Translation'],
              promptText: 'Translate medical clinical terminology'
            })
          },
          {
            id: 't_prompt_3',
            data: () => ({
              name: 'Whole-Lecture Subtitle & Terminology Translator',
              category: 'translations',
              accessLevel: 'public',
              applyTo: ['Lecture Subtitle Translation'],
              promptText: 'Translate full lecture sentences array'
            })
          },
          {
            id: 't_prompt_4',
            data: () => ({
              name: 'On-Device Gemma Multilingual Lecture Translator',
              category: 'translations',
              accessLevel: 'public',
              applyTo: ['On-Device Gemma Translation'],
              promptText: 'Local Gemma translation'
            })
          },
          {
            id: 'a_prompt_1',
            data: () => ({
              name: 'Invigilation Whisper Detector',
              category: 'audios',
              accessLevel: 'public',
              applyTo: ['Live Audio Invigilation'],
              promptText: 'Detect whisper'
            })
          }
        ],
      });
    }, 0);
    return () => {};
  }),
}));

describe('useTranslationPrompts Hook', () => {
  it('returns empty array when user is null', () => {
    const { result } = renderHook(() => useTranslationPrompts(null));
    expect(result.current).toEqual([]);
  });

  it('fetches translation prompts filtering out general audio prompts', async () => {
    const { result } = renderHook(() => useTranslationPrompts({ uid: 'teacher_1' }));
    await waitFor(() => {
      expect(result.current.length).toBe(4);
      expect(result.current.map(p => p.id).sort()).toEqual(['t_prompt_1', 't_prompt_2', 't_prompt_3', 't_prompt_4'].sort());
      expect(result.current.map(p => p.name)).toContain('Bilingual CS Subtitle Translator');
      expect(result.current.map(p => p.name)).toContain('Medical Lecture Translator');
      expect(result.current.map(p => p.name)).toContain('Whole-Lecture Subtitle & Terminology Translator');
    });
  });

  it('filters for Live Subtitles & Translation: unshifts default and strictly excludes whole-lecture and on-device prompts', async () => {
    const { result } = renderHook(() => useTranslationPrompts({ uid: 'teacher_1' }, 'Live Subtitles & Translation'));
    await waitFor(() => {
      // Should include default live subtitle prompt + t_prompt_1 + t_prompt_2
      expect(result.current.length).toBe(3);
      expect(result.current.some(p => p.name === 'Bilingual Lecture & Technical Terminology Subtitle Translator')).toBe(true);
      expect(result.current.some(p => p.id === 't_prompt_1')).toBe(true);
      expect(result.current.some(p => p.id === 't_prompt_2')).toBe(true);
      // Strictly excludes whole lecture and on-device gemma prompts
      expect(result.current.some(p => p.id === 't_prompt_3')).toBe(false);
      expect(result.current.some(p => p.id === 't_prompt_4')).toBe(false);
    });
  });

  it('filters for Lecture Subtitle Translation: unshifts default and strictly excludes live subtitle and on-device prompts', async () => {
    const { result } = renderHook(() => useTranslationPrompts({ uid: 'teacher_1' }, 'Lecture Subtitle Translation'));
    await waitFor(() => {
      // Should include default lecture translation prompt + t_prompt_3
      expect(result.current.length).toBe(2);
      expect(result.current.some(p => p.name === 'Lecture Subtitle & Terminology Translator')).toBe(true);
      expect(result.current.some(p => p.id === 't_prompt_3')).toBe(true);
      // Strictly excludes live subtitle and on-device gemma prompts
      expect(result.current.some(p => p.id === 't_prompt_1')).toBe(false);
      expect(result.current.some(p => p.id === 't_prompt_2')).toBe(false);
      expect(result.current.some(p => p.id === 't_prompt_4')).toBe(false);
    });
  });
});
