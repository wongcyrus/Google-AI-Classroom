import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import PublicLiveView from './PublicLiveView';

// Hoisted mock state
const {
  mockAuth,
  mockSignInAnonymously,
  mockSetDoc,
  mockGetDoc,
  mockDeleteDoc,
  mockOnSnapshot,
  listenersMap,
  errorListenersMap,
} = vi.hoisted(() => {
  const listeners = new Map();
  const errorListeners = new Map();
  return {
    mockAuth: {
      currentUser: null,
    },
    mockSignInAnonymously: vi.fn(),
    mockSetDoc: vi.fn(),
    mockGetDoc: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockOnSnapshot: vi.fn((docRef, onNext, onError) => {
      listeners.set(docRef.path, onNext);
      if (onError) errorListeners.set(docRef.path, onError);
      return vi.fn(() => {
        listeners.delete(docRef.path);
        errorListeners.delete(docRef.path);
      });
    }),
    listenersMap: listeners,
    errorListenersMap: errorListeners,
  };
});

vi.mock('../../firebase-config', () => ({
  db: {},
  auth: mockAuth,
}));

vi.mock('firebase/auth', () => ({
  signInAnonymously: mockSignInAnonymously,
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path })),
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  deleteDoc: mockDeleteDoc,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
}));

describe('PublicLiveView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenersMap.clear();
    errorListenersMap.clear();
    mockAuth.currentUser = null;
    sessionStorage.setItem('public_spectator_uid', 'anon_spectator_123');
    mockSetDoc.mockResolvedValue();
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockDeleteDoc.mockResolvedValue();
  });

  it('initializes zero-auth spectator session without calling signInAnonymously and renders PIN entry screen when no pin param', async () => {
    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockSignInAnonymously).not.toHaveBeenCalled();
      expect(screen.getByText('Join Live Presentation')).toBeInTheDocument();
      expect(screen.getByText('CLASS_TALK_101')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
  });

  it('allows manual PIN entry and registers spectator in screenBroadcastViewers', async () => {
    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('PIN');
    fireEvent.change(input, { target: { value: '8833' } });

    const submitBtn = screen.getByRole('button', { name: /Watch Live Screen/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/CLASS_TALK_101/screenBroadcastViewers/anon_spectator_123' }),
        expect.objectContaining({
          pin: '8833',
          isAnonymousSpectator: true,
        })
      );
    });

    // Should now show live stage
    await waitFor(() => {
      expect(screen.getByText("Waiting for presenter's screen...")).toBeInTheDocument();
    });
  });

  it('displays error message when PIN verification fails with PERMISSION_DENIED', async () => {
    mockSetDoc.mockRejectedValueOnce(new Error('PERMISSION_DENIED: Missing or insufficient permissions.'));

    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('PIN');
    fireEvent.change(input, { target: { value: '9999' } });

    const submitBtn = screen.getByRole('button', { name: /Watch Live Screen/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText(/Invalid PIN or presentation is not currently public/i)).toBeInTheDocument();
    });
  });

  it('auto-verifies PIN, loads initial static slide from session, skips unchanged refresh, and updates only on manual Refresh', async () => {
    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101?pin=4321']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/CLASS_TALK_101/screenBroadcastViewers/anon_spectator_123' }),
        expect.objectContaining({
          pin: '4321',
        })
      );
      expect(listenersMap.get('classes/CLASS_TALK_101/screenBroadcast/session')).toBeDefined();
      expect(listenersMap.get('classes/CLASS_TALK_101/screenBroadcast/liveFrame')).toBeUndefined();
    });

    // Simulate incoming session with initial static slide URL & timestamp
    const sessionCb = listenersMap.get('classes/CLASS_TALK_101/screenBroadcast/session');
    sessionCb({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        frameUrl: 'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=1000',
        frameUpdatedAt: 1000,
      }),
    });

    // Simulate incoming subtitles
    const subtitlesCb = listenersMap.get('classes/CLASS_TALK_101/liveSubtitles/current');
    expect(subtitlesCb).toBeDefined();
    subtitlesCb({
      exists: () => true,
      data: () => ({
        text: 'Hello and welcome everyone',
        sourceLang: 'en',
        translations: {
          en: 'Hello and welcome everyone',
          'zh-Hans': '大家好，欢迎各位',
        },
      }),
    });

    await waitFor(() => {
      const img = screen.getByAltText('Live presentation stream');
      expect(img).toBeInTheDocument();
      expect(img.getAttribute('src')).toBe('https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=1000');
      expect(screen.getAllByText('Hello and welcome everyone').length).toBeGreaterThan(0);
    });

    // Refresh when timestamp is unchanged -> keeps existing src and marks Up to Date
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        frameUrl: 'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=1000',
        frameUpdatedAt: 1000,
      }),
    });
    const refreshBtn = screen.getByRole('button', { name: /^Refresh Slide$/i });
    fireEvent.click(refreshBtn);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Refresh Slide$/i })).toHaveTextContent('✓ Up to Date');
      expect(screen.getByAltText('Live presentation stream').getAttribute('src')).toBe(
        'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=1000'
      );
    });

    // Presenter moves to slide 2 -> session updates timestamp, image stays cached until clicked
    sessionCb({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        frameUrl: 'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=2000',
        frameUpdatedAt: 2000,
      }),
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Refresh Slide \(New slide available\)$/i })).toBeInTheDocument();
    });

    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        frameUrl: 'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=2000',
        frameUpdatedAt: 2000,
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: /^Refresh Slide \(New slide available\)$/i }));
    await waitFor(() => {
      expect(screen.getByAltText('Live presentation stream').getAttribute('src')).toBe(
        'https://storage.mock/broadcasts/CLASS_TALK_101/slide.jpg?t=2000'
      );
    });

    // Simulate expired image 404 triggering auto-recovery when presenter pushes slide 3
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        frameUrl: 'https://storage.mock/broadcasts/CLASS_TALK_101/slide_3000_xyz.jpg?token=t3&t=3000',
        frameUpdatedAt: 3000,
      }),
    });
    fireEvent.error(screen.getByAltText('Live presentation stream'));
    await waitFor(() => {
      expect(screen.getByAltText('Live presentation stream').getAttribute('src')).toBe(
        'https://storage.mock/broadcasts/CLASS_TALK_101/slide_3000_xyz.jpg?token=t3&t=3000'
      );
    });

    // Subtitle language selector
    const langSelect = screen.getByRole('combobox', { name: /Subtitle Language/i });
    fireEvent.change(langSelect, { target: { value: 'zh-Hans' } });

    await waitFor(() => {
      expect(screen.getByText('大家好，欢迎各位')).toBeInTheDocument();
      // Verifies YouTube CC overlay container is present and no footer panel exists
      expect(document.querySelector('.public-youtube-cc-overlay')).toBeInTheDocument();
      expect(document.querySelector('.public-subtitles-card')).toBeNull();
    });

    // Test YouTube-style CC toggle button
    const ccBtn = screen.getByRole('button', { name: /Toggle Closed Captions/i });
    expect(ccBtn).toBeInTheDocument();

    // Click to hide CC
    fireEvent.click(ccBtn);
    await waitFor(() => {
      expect(document.querySelector('.public-youtube-cc-overlay')).toBeNull();
    });

    // Click to re-enable CC
    fireEvent.click(ccBtn);
    await waitFor(() => {
      expect(document.querySelector('.public-youtube-cc-overlay')).toBeInTheDocument();
      expect(screen.getByText('大家好，欢迎各位')).toBeInTheDocument();
    });

    // Click Fullscreen and verify CC overlay remains visible with fullscreen styling & HUD controls
    const fsBtn = screen.getByRole('button', { name: /Toggle Fullscreen/i });
    fireEvent.click(fsBtn);
    await waitFor(() => {
      expect(document.querySelector('.public-live-container.is-fullscreen')).toBeInTheDocument();
      expect(document.querySelector('.public-youtube-cc-overlay.is-fullscreen-cc')).toBeInTheDocument();
      expect(screen.getByText('大家好，欢迎各位')).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: /Fullscreen Subtitle Language/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Exit Fullscreen/i })).toBeInTheDocument();
    });
  });

  it('cleans up spectator viewer document on unmount', async () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101?pin=4321']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
      expect(listenersMap.get('classes/CLASS_TALK_101/screenBroadcast/session')).toBeDefined();
    });

    unmount();

    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TALK_101/screenBroadcastViewers/anon_spectator_123' })
    );
  });

  it('stops retrying immediately and prompts for PIN on permission-denied snapshot error', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101?pin=4321']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(errorListenersMap.get('classes/CLASS_TALK_101/screenBroadcast/session')).toBeDefined();
    });

    const initialSubscribeCalls = mockOnSnapshot.mock.calls.length;
    const sessionErrCb = errorListenersMap.get('classes/CLASS_TALK_101/screenBroadcast/session');
    sessionErrCb(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));

    await waitFor(() => {
      expect(screen.getByText(/Session ended or access expired/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText('PIN')).toBeInTheDocument();
    });

    await new Promise((r) => setTimeout(r, 30));
    expect(mockOnSnapshot.mock.calls.length).toBe(initialSubscribeCalls);
    warnSpy.mockRestore();
  });

  it('caps transient onSnapshot retries using exponential backoff', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(
      <MemoryRouter initialEntries={['/live/CLASS_RETRY_TEST?pin=4321']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    // Flush mount setDoc promise and useEffect subscription setup
    await vi.waitFor(() => {
      expect(errorListenersMap.get('classes/CLASS_RETRY_TEST/screenBroadcast/session')).toBeDefined();
    });

    const countSessionSubscribes = () =>
      mockOnSnapshot.mock.calls.filter(
        ([ref]) => ref.path === 'classes/CLASS_RETRY_TEST/screenBroadcast/session'
      ).length;

    expect(countSessionSubscribes()).toBe(1);

    // Trigger MAX_SNAPSHOT_RETRIES (8) + 2 extra transient errors
    for (let i = 0; i < 10; i++) {
      const errCb = errorListenersMap.get('classes/CLASS_RETRY_TEST/screenBroadcast/session');
      errCb(Object.assign(new Error('unavailable'), { code: 'unavailable' }));
      await vi.advanceTimersByTimeAsync(35000);
    }

    // 1 initial + max 8 retries = 9 total subscriptions
    expect(countSessionSubscribes()).toBe(9);
    warnSpy.mockRestore();
    vi.useRealTimers();
  });

  it('loads legacy liveFrame via single read without onSnapshot when pre-deploy presenter lacks frameUrl', async () => {
    render(
      <MemoryRouter initialEntries={['/live/CLASS_LEGACY_PUB?pin=4321']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listenersMap.get('classes/CLASS_LEGACY_PUB/screenBroadcast/session')).toBeDefined();
      expect(listenersMap.get('classes/CLASS_LEGACY_PUB/screenBroadcast/liveFrame')).toBeUndefined();
    });

    // Queue single-read session + liveFrame responses triggered when legacy session emits without frameUrl
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          isPublic: true,
          broadcastMode: 'frame',
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameData: 'data:image/jpeg;base64,legacy_public_1',
          frameSeq: 12,
          timestamp: { _seconds: 1795591320, _nanoseconds: 0 },
        }),
      });

    const sessionCb = listenersMap.get('classes/CLASS_LEGACY_PUB/screenBroadcast/session');
    sessionCb({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        isPublic: true,
        broadcastMode: 'frame',
      }),
    });

    await waitFor(() => {
      const img = screen.getByAltText('Live presentation stream');
      expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,legacy_public_1');
    });

    expect(listenersMap.get('classes/CLASS_LEGACY_PUB/screenBroadcast/liveFrame')).toBeUndefined();
  });
});
