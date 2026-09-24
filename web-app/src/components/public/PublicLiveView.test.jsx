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
  mockDeleteDoc,
  mockOnSnapshot,
  listenersMap,
} = vi.hoisted(() => {
  const listeners = new Map();
  return {
    mockAuth: {
      currentUser: null,
    },
    mockSignInAnonymously: vi.fn(),
    mockSetDoc: vi.fn(),
    mockDeleteDoc: vi.fn(),
    mockOnSnapshot: vi.fn((docRef, onNext) => {
      listeners.set(docRef.path, onNext);
      return vi.fn(() => listeners.delete(docRef.path));
    }),
    listenersMap: listeners,
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
  deleteDoc: mockDeleteDoc,
  onSnapshot: mockOnSnapshot,
  serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
}));

describe('PublicLiveView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listenersMap.clear();
    mockAuth.currentUser = null;
    mockSignInAnonymously.mockResolvedValue({
      user: { uid: 'anon_spectator_123' },
    });
    mockSetDoc.mockResolvedValue();
    mockDeleteDoc.mockResolvedValue();
  });

  it('initializes anonymous authentication and renders PIN entry screen when no pin param', async () => {
    render(
      <MemoryRouter initialEntries={['/live/CLASS_TALK_101']}>
        <Routes>
          <Route path="/live/:classId" element={<PublicLiveView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockSignInAnonymously).toHaveBeenCalled();
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

  it('auto-verifies PIN and streams live frame and subtitles when pin query param is present', async () => {
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
    });

    // Simulate incoming frame
    const frameCb = listenersMap.get('classes/CLASS_TALK_101/screenBroadcast/liveFrame');
    expect(frameCb).toBeDefined();
    frameCb({
      exists: () => true,
      data: () => ({ frameData: 'data:image/jpeg;base64,framepreviewdata' }),
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
      expect(img.getAttribute('src')).toBe('data:image/jpeg;base64,framepreviewdata');
      expect(screen.getAllByText('Hello and welcome everyone').length).toBeGreaterThan(0);
    });

    // Subtitle language selector
    const langSelect = screen.getByRole('combobox', { name: /Subtitle Language/i });
    fireEvent.change(langSelect, { target: { value: 'zh-Hans' } });

    await waitFor(() => {
      expect(screen.getByText('大家好，欢迎各位')).toBeInTheDocument();
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
    });

    unmount();

    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TALK_101/screenBroadcastViewers/anon_spectator_123' })
    );
  });
});
