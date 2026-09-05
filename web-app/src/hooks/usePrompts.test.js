import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePrompts } from './usePrompts';
import { onSnapshot } from 'firebase/firestore';
import { auth } from '../firebase-config';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  db: {},
  auth: { currentUser: null },
}));

describe('usePrompts Hook', () => {
  const unsubMock1 = vi.fn();
  const unsubMock2 = vi.fn();
  const unsubMock3 = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles unauthenticated state gracefully', () => {
    auth.currentUser = null;
    const { result } = renderHook(() => usePrompts());
    expect(result.current.prompts).toEqual([]);
    expect(result.current.filteredPrompts).toEqual([]);
  });

  it('subscribes to public, owned, and shared prompts, dedupes, sorts and filters', () => {
    auth.currentUser = { uid: 'teacher_1' };

    let pubCb, ownCb, shaCb;
    let callIdx = 0;
    onSnapshot.mockImplementation((q, cb) => {
      callIdx++;
      if (callIdx === 1) {
        pubCb = cb;
        return unsubMock1;
      }
      if (callIdx === 2) {
        ownCb = cb;
        return unsubMock2;
      }
      shaCb = cb;
      return unsubMock3;
    });

    const { result } = renderHook(() => usePrompts());

    act(() => {
      pubCb({
        docs: [
          { id: 'p1', data: () => ({ name: 'B Public Prompt', category: 'images', accessLevel: 'public' }) },
        ],
      });
      ownCb({
        docs: [
          { id: 'p2', data: () => ({ name: 'A Private Prompt', category: 'images', accessLevel: 'private', owner: 'teacher_1' }) },
          { id: 'p_other', data: () => ({ name: 'Ignore Video', category: 'videos', accessLevel: 'private', owner: 'teacher_1' }) },
        ],
      });
      shaCb({
        docs: [
          { id: 'p3', data: () => ({ name: 'C Shared Prompt', category: 'images', accessLevel: 'shared', sharedWith: ['teacher_1'] }) },
        ],
      });
    });

    // Should be sorted alphabetically by name: A, B, C
    expect(result.current.prompts).toHaveLength(3);
    expect(result.current.prompts[0].name).toBe('A Private Prompt');
    expect(result.current.prompts[1].name).toBe('B Public Prompt');
    expect(result.current.prompts[2].name).toBe('C Shared Prompt');

    // Default filter is 'all'
    expect(result.current.filteredPrompts).toHaveLength(3);

    // Filter by 'public'
    act(() => {
      result.current.setPromptFilter('public');
    });
    expect(result.current.filteredPrompts).toHaveLength(1);
    expect(result.current.filteredPrompts[0].id).toBe('p1');

    // Filter by 'private'
    act(() => {
      result.current.setPromptFilter('private');
    });
    expect(result.current.filteredPrompts).toHaveLength(1);
    expect(result.current.filteredPrompts[0].id).toBe('p2');

    // Filter by 'shared'
    act(() => {
      result.current.setPromptFilter('shared');
    });
    expect(result.current.filteredPrompts).toHaveLength(1);
    expect(result.current.filteredPrompts[0].id).toBe('p3');
  });

  it('unsubscribes all listeners on unmount', () => {
    auth.currentUser = { uid: 'teacher_1' };
    onSnapshot.mockReturnValue(unsubMock1);

    const { unmount } = renderHook(() => usePrompts());
    unmount();

    expect(unsubMock1).toHaveBeenCalled();
  });
});
