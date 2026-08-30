import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useVideoPrompts } from './useVideoPrompts';

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
          { id: 'prompt_1', data: () => ({ name: 'Video Summary', category: 'videos', accessLevel: 'public' }) },
        ],
      });
    }, 0);
    return () => {};
  }),
}));

describe('Data Hooks (useVideoPrompts)', () => {
  it('returns empty array when user is null', () => {
    const { result } = renderHook(() => useVideoPrompts(null));
    expect(result.current).toEqual([]);
  });

  it('subscribes to public, private, and shared prompts for logged in user', async () => {
    const { result } = renderHook(() => useVideoPrompts({ uid: 'teacher_1' }));
    await waitFor(() => {
      expect(result.current.length).toBeGreaterThan(0);
      expect(result.current[0].name).toBe('Video Summary');
    });
  });
});
