import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotifications } from './useNotifications';
import { onSnapshot } from 'firebase/firestore';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  db: {},
}));

describe('useNotifications Hook', () => {
  const unsubscribeMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns empty array and zero count when user is missing or has no email', () => {
    const { result, rerender } = renderHook(({ user }) => useNotifications(user), {
      initialProps: { user: null },
    });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);

    rerender({ user: {} });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it('subscribes to notifications and calculates unread count', () => {
    let snapshotCallback;
    onSnapshot.mockImplementation((q, cb) => {
      snapshotCallback = cb;
      return unsubscribeMock;
    });

    const user = { email: 'student@example.com' };
    const { result } = renderHook(() => useNotifications(user));

    const mockDocs = [
      { id: 'n1', data: () => ({ message: 'Exam started', read: false }) },
      { id: 'n2', data: () => ({ message: 'Warning issued', read: true }) },
      { id: 'n3', data: () => ({ message: 'Time extension', read: false }) },
    ];

    act(() => {
      snapshotCallback({
        forEach: (fn) => mockDocs.forEach(fn),
      });
    });

    expect(result.current.notifications).toHaveLength(3);
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.notifications[0]).toEqual({
      id: 'n1',
      message: 'Exam started',
      read: false,
    });
  });

  it('unsubscribes on unmount', () => {
    onSnapshot.mockReturnValue(unsubscribeMock);
    const user = { email: 'teacher@example.com' };
    const { unmount } = renderHook(() => useNotifications(user));

    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
