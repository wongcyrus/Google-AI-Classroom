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
      expect(result.current.length).toBe(2);
      expect(result.current.map(p => p.id)).toEqual(['t_prompt_1', 't_prompt_2']);
      expect(result.current.map(p => p.name)).toContain('Bilingual CS Subtitle Translator');
      expect(result.current.map(p => p.name)).toContain('Medical Lecture Translator');
    });
  });
});
