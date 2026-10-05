import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAudioPrompts } from './useAudioPrompts';

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
            id: 'prompt_1',
            data: () => ({
              name: 'Live Invigilation Audio',
              category: 'audios',
              accessLevel: 'public',
              applyTo: ['Live Audio Invigilation'],
              promptText: 'Detect cheating in rolling audio'
            })
          },
          {
            id: 'prompt_2',
            data: () => ({
              name: 'Session Discussion Summary',
              category: 'audios',
              accessLevel: 'private',
              owner: 'teacher_1',
              applyTo: ['Session Audio Summary'],
              promptText: 'Summarize classroom discussion'
            })
          },
          {
            id: 'prompt_3',
            data: () => ({
              name: 'Bilingual Subtitle Translator',
              category: 'translations',
              accessLevel: 'public',
              applyTo: ['Live Subtitles & Translation'],
              promptText: 'Translate live speech'
            })
          },
          {
            id: 'prompt_4',
            data: () => ({
              name: 'Whole-Lecture Subtitle & Chapter Synthesizer',
              category: 'translations',
              accessLevel: 'public',
              applyTo: ['Lecture Subtitles & Chapters'],
              promptText: 'Transcribe full lecture recording with chapters'
            })
          },
          {
            id: 'prompt_5',
            data: () => ({
              name: 'Real-Time Speech-to-Text Transcriber',
              category: 'audios',
              accessLevel: 'public',
              applyTo: ['Live Audio STT'],
              promptText: 'Real-time live speech to text'
            })
          },
          {
            id: 'prompt_6',
            data: () => ({
              name: 'Lecture Audio Speech-to-Text & Chapters',
              category: 'audios',
              accessLevel: 'public',
              applyTo: ['Lecture STT & Chapters'],
              promptText: 'Batch lecture recording audio STT and chapters'
            })
          },
        ],
      });
    }, 0);
    return () => {};
  }),
}));

describe('useAudioPrompts Hook', () => {
  it('returns empty array when user is null', () => {
    const { result } = renderHook(() => useAudioPrompts(null));
    expect(result.current).toEqual([]);
  });

  it('fetches and filters audio prompts by category and applyTo tag', async () => {
    const { result } = renderHook(() => useAudioPrompts({ uid: 'teacher_1' }, 'Live Audio Invigilation'));
    await waitFor(() => {
      expect(result.current.length).toBe(1);
      expect(result.current[0].name).toBe('Live Invigilation Audio');
    });
  });

  it('returns all audio prompts when no applyTo filter is provided', async () => {
    const { result } = renderHook(() => useAudioPrompts({ uid: 'teacher_1' }));
    await waitFor(() => {
      expect(result.current.length).toBe(4);
      expect(result.current.map(p => p.id).sort()).toEqual(['prompt_1', 'prompt_2', 'prompt_5', 'prompt_6'].sort());
    });
  });

  it('fetches translation prompts when applyToFilter is Live Subtitles & Translation and strictly excludes Lecture Subtitles', async () => {
    const { result } = renderHook(() => useAudioPrompts({ uid: 'teacher_1' }, 'Live Subtitles & Translation'));
    await waitFor(() => {
      expect(result.current.length).toBe(1);
      expect(result.current[0].id).toBe('prompt_3');
      expect(result.current[0].name).toBe('Bilingual Subtitle Translator');
      expect(result.current[0].category).toBe('translations');
    });
  });

  it('fetches lecture recording prompts when applyToFilter is Lecture Subtitles & Chapters and strictly excludes Live Subtitles', async () => {
    const { result } = renderHook(() => useAudioPrompts({ uid: 'teacher_1' }, 'Lecture Subtitles & Chapters'));
    await waitFor(() => {
      expect(result.current.length).toBe(1);
      expect(result.current[0].id).toBe('prompt_4');
      expect(result.current[0].name).toBe('Whole-Lecture Subtitle & Chapter Synthesizer');
      expect(result.current[0].category).toBe('translations');
    });
  });

  it('fetches whole lecture STT & chapters prompts and strictly excludes real-time/live audio prompts', async () => {
    const { result } = renderHook(() => useAudioPrompts({ uid: 'teacher_1' }, 'Lecture STT & Chapters'));
    await waitFor(() => {
      expect(result.current.length).toBe(1);
      expect(result.current[0].id).toBe('prompt_6');
      expect(result.current[0].name).toBe('Lecture Audio Speech-to-Text & Chapters');
      expect(result.current.some(p => p.id === 'prompt_5')).toBe(false);
    });
  });
});
