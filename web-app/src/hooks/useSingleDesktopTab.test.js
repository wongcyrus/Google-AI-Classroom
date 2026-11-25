import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useSingleDesktopTab } from './useSingleDesktopTab';

describe('useSingleDesktopTab', () => {
  const originalLocks = navigator.locks;
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const originalWindowClose = window.close;

  beforeEach(() => {
    window.close = vi.fn();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: originalLocks,
    });
    globalThis.BroadcastChannel = originalBroadcastChannel;
    window.close = originalWindowClose;
    vi.restoreAllMocks();
  });

  it('falls back synchronously to acquired when navigator.locks is unavailable', () => {
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { result } = renderHook(() => useSingleDesktopTab({ enabled: true, uid: 'student-1' }));
    expect(result.current.status).toBe('acquired');
  });

  it('does not request a Web Lock when disabled (e.g. mobile view or preview)', () => {
    const requestMock = vi.fn();
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request: requestMock },
    });

    const { result } = renderHook(() => useSingleDesktopTab({ enabled: false, uid: 'student-1' }));
    expect(result.current.status).toBe('acquired');
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('acquires the lock when available and releases it on unmount', async () => {
    let lockPromiseResolved = false;
    const requestMock = vi.fn(async (_name, _opts, cb) => {
      await cb({ name: _name });
      lockPromiseResolved = true;
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request: requestMock },
    });

    const { result, unmount } = renderHook(() =>
      useSingleDesktopTab({ enabled: true, uid: 'student-abc' })
    );

    await waitFor(() => {
      expect(result.current.status).toBe('acquired');
    });
    expect(requestMock).toHaveBeenCalledWith(
      'student_desktop_tab_student-abc',
      { ifAvailable: true },
      expect.any(Function)
    );
    expect(lockPromiseResolved).toBe(false);

    unmount();

    await waitFor(() => {
      expect(lockPromiseResolved).toBe(true);
    });
  });

  it('marks tab as duplicate and attempts window.close when another tab holds the lock', async () => {
    const requestMock = vi.fn(async (_name, _opts, cb) => {
      await cb(null);
    });
    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request: requestMock },
    });

    const { result } = renderHook(() =>
      useSingleDesktopTab({ enabled: true, uid: 'student-dup' })
    );

    await waitFor(() => {
      expect(result.current.status).toBe('duplicate');
    });
    expect(window.close).toHaveBeenCalledTimes(1);

    act(() => {
      const closed = result.current.tryCloseTab();
      expect(closed).toBe(false);
    });
    expect(result.current.closeBlockedByBrowser).toBe(true);
  });

  it('yields original tab and lets duplicate tab take over via BroadcastChannel + Web Locks', async () => {
    const channels = new Map();
    class MockBroadcastChannel {
      constructor(name) {
        this.name = name;
        this.onmessage = null;
        if (!channels.has(name)) channels.set(name, new Set());
        channels.get(name).add(this);
      }
      postMessage(data) {
        for (const peer of channels.get(this.name) || []) {
          if (peer !== this && typeof peer.onmessage === 'function') {
            peer.onmessage({ data });
          }
        }
      }
      close() {
        channels.get(this.name)?.delete(this);
      }
    }
    globalThis.BroadcastChannel = MockBroadcastChannel;

    let activeOwner = null;
    const waiters = [];
    const requestMock = vi.fn((name, opts, cb) => {
      if (opts?.ifAvailable) {
        if (activeOwner) {
          return Promise.resolve(cb(null));
        }
        activeOwner = name;
        return Promise.resolve(cb({ name })).finally(() => {
          activeOwner = null;
          const next = waiters.shift();
          if (next) next();
        });
      }

      // Queued takeover lock request with AbortSignal
      return new Promise((resolve, reject) => {
        const tryGrant = () => {
          if (opts?.signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
            return;
          }
          if (!activeOwner) {
            activeOwner = name;
            Promise.resolve(cb({ name }))
              .finally(() => {
                activeOwner = null;
                const next = waiters.shift();
                if (next) next();
              })
              .then(resolve, reject);
          } else {
            waiters.push(tryGrant);
          }
        };
        tryGrant();
      });
    });

    Object.defineProperty(navigator, 'locks', {
      configurable: true,
      writable: true,
      value: { request: requestMock },
    });

    const tab1 = renderHook(() => useSingleDesktopTab({ enabled: true, uid: 'student-takeover' }));
    await waitFor(() => expect(tab1.result.current.status).toBe('acquired'));

    const tab2 = renderHook(() => useSingleDesktopTab({ enabled: true, uid: 'student-takeover' }));
    await waitFor(() => expect(tab2.result.current.status).toBe('duplicate'));

    act(() => {
      tab2.result.current.takeOverFromDuplicateTab();
    });

    await waitFor(() => {
      expect(tab1.result.current.status).toBe('yielded');
      expect(tab2.result.current.status).toBe('acquired');
    });

    tab1.unmount();
    tab2.unmount();
  });
});
