import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideoPrompts } from './useVideoPrompts';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockUnsub = vi.fn();
let snapshotCallbacks = [];

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: vi.fn((q, cb) => {
    snapshotCallbacks.push(cb);
    return mockUnsub;
  }),
}));

describe('useVideoPrompts Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCallbacks = [];
  });

  it('returns empty array if user is null', () => {
    const { result } = renderHook(() => useVideoPrompts(null));
    expect(result.current).toEqual([]);
    expect(snapshotCallbacks.length).toBe(0);
  });

  it('aggregates public, private, and shared prompts, filters videos category and sorts alphabetically', async () => {
    const mockUser = { uid: 'user_123' };
    const { result, unmount } = renderHook(() => useVideoPrompts(mockUser));

    expect(snapshotCallbacks.length).toBe(3);

    // 1. Public prompts
    await act(async () => {
      snapshotCallbacks[0]({
        docs: [
          { id: 'vp_2', data: () => ({ name: 'Video Summary Beta', category: 'videos', promptText: 'Text 2' }) },
          { id: 'other_1', data: () => ({ name: 'Audio Prompt', category: 'audios', promptText: 'Ignored' }) },
        ],
      });
    });

    // 2. Private prompts
    await act(async () => {
      snapshotCallbacks[1]({
        docs: [
          { id: 'vp_1', data: () => ({ name: 'Alpha Video Proctor', category: 'videos', promptText: 'Text 1' }) },
        ],
      });
    });

    // 3. Shared prompts
    await act(async () => {
      snapshotCallbacks[2]({
        docs: [
          { id: 'vp_3', data: () => ({ name: 'Zeta Video Analysis', category: 'videos', promptText: 'Text 3' }) },
        ],
      });
    });

    expect(result.current).toHaveLength(3);
    expect(result.current[0].name).toBe('Alpha Video Proctor');
    expect(result.current[1].name).toBe('Video Summary Beta');
    expect(result.current[2].name).toBe('Zeta Video Analysis');

    unmount();
    expect(mockUnsub).toHaveBeenCalledTimes(3);
  });
});
