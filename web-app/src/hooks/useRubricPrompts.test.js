import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRubricPrompts } from './useRubricPrompts';

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
            id: 'rubric_1',
            data: () => ({
              name: 'Hands-on Lab Demonstration Rubric Extractor',
              category: 'rubrics',
              accessLevel: 'public',
              applyTo: ['Lab Rubric Milestones'],
              promptText: 'Extract hands-on milestones',
            }),
          },
          {
            id: 'rubric_2',
            data: () => ({
              name: 'Software Engineering Project Milestone Extractor',
              category: 'rubrics',
              accessLevel: 'private',
              owner: 'teacher_1',
              applyTo: ['Lab Rubric Milestones'],
              promptText: 'Extract software engineering milestones',
            }),
          },
          {
            id: 'video_rubric_1',
            data: () => ({
              name: 'Two-Stage Map-Reduce Lab Rubric Synthesizer',
              category: 'videos',
              accessLevel: 'public',
              applyTo: ['Per Video'],
              promptText: 'Synthesize rubrics from observation',
            }),
          },
          {
            id: 'image_prompt_1',
            data: () => ({
              name: 'Standard Face & Gaze Invigilation',
              category: 'images',
              accessLevel: 'public',
              applyTo: ['Per Image'],
              promptText: 'Invigilate student face',
            }),
          },
        ],
      });
    }, 0);
    return () => {};
  }),
}));

describe('useRubricPrompts Hook', () => {
  it('returns empty array when user is null', () => {
    const { result } = renderHook(() => useRubricPrompts(null));
    expect(result.current).toEqual([]);
  });

  it('fetches and filters rubric prompts excluding unrelated image prompts', async () => {
    const { result } = renderHook(() => useRubricPrompts({ uid: 'teacher_1' }));

    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
    });

    const promptNames = result.current.map(p => p.name);
    expect(promptNames).toContain('Hands-on Lab Demonstration Rubric Extractor');
    expect(promptNames).toContain('Software Engineering Project Milestone Extractor');
    expect(promptNames).toContain('Two-Stage Map-Reduce Lab Rubric Synthesizer');
    expect(promptNames).not.toContain('Standard Face & Gaze Invigilation');
  });
});
