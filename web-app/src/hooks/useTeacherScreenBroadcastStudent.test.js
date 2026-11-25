import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTeacherScreenBroadcastStudent from './useTeacherScreenBroadcastStudent';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockUnsubscribeSession = vi.fn();
let sessionSnapshotCallback = null;
let sessionErrorCallback = null;
let liveFrameSubscribed = false;

const mockSetDoc = vi.fn(() => Promise.resolve());
const mockGetDoc = vi.fn(() => Promise.resolve({ exists: () => false }));
const mockDeleteDoc = vi.fn(() => Promise.resolve());
const mockOnSnapshot = vi.fn((docRef, cb, errCb) => {
  if (docRef.path.includes('screenBroadcast/session')) {
    sessionSnapshotCallback = cb;
    sessionErrorCallback = errCb;
    return mockUnsubscribeSession;
  }
  if (docRef.path.includes('screenBroadcast/liveFrame')) {
    liveFrameSubscribed = true;
  }
  return vi.fn();
});

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path })),
  setDoc: (...args) => mockSetDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  onSnapshot: (...args) => mockOnSnapshot(...args),
}));

describe('useTeacherScreenBroadcastStudent Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionSnapshotCallback = null;
    sessionErrorCallback = null;
    liveFrameSubscribed = false;
    mockGetDoc.mockResolvedValue({ exists: () => false });
  });

  it('listens only to active broadcast session state (no liveFrame listener) and reflects On/Off in return state', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    expect(result.current.isBroadcastActive).toBe(false);
    expect(sessionSnapshotCallback).toBeTypeOf('function');
    expect(liveFrameSubscribed).toBe(false);

    // Simulate teacher starts broadcasting
    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({ isBroadcasting: true, teacherEmail: 'teacher@school.edu' }),
      });
    });

    expect(result.current.isBroadcastActive).toBe(true);
    expect(result.current.broadcastInfo).toEqual({
      isBroadcasting: true,
      teacherEmail: 'teacher@school.edu',
    });

    // Simulate teacher stops broadcasting
    await act(async () => {
      sessionSnapshotCallback({
        exists: () => false,
      });
    });

    expect(result.current.isBroadcastActive).toBe(false);
    expect(result.current.broadcastInfo).toBeNull();

    unmount();
    expect(mockUnsubscribeSession).toHaveBeenCalled();
  });

  it('joins broadcast, loads initial static URL, skips unchanged timestamp on refresh, and loads new slide when timestamp changes', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    // Active session broadcast with initial static slide URL & timestamp
    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'static_url',
          teacherEmail: 'teacher@school.edu',
          frameUrl: 'https://storage.mock/slide.jpg?token=a&t=1000',
          frameUpdatedAt: 1000,
        }),
      });
    });

    expect(result.current.broadcastMode).toBe('static_url');

    // Join broadcast -> populates initial slide immediately without liveFrame onSnapshot
    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(liveFrameSubscribed).toBe(false);
    expect(result.current.isViewing).toBe(true);
    expect(result.current.connectionState).toBe('connected');
    expect(result.current.liveFrame).toBe('https://storage.mock/slide.jpg?token=a&t=1000');
    expect(result.current.frameUpdatedAt).toBe(1000);
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_1/screenBroadcastViewers/student_123' }),
      expect.objectContaining({
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
        status: 'watching',
      })
    );

    // Clicking Refresh while teacher hasn't changed slide returns up_to_date with zero reload
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        frameUrl: 'https://storage.mock/slide.jpg?token=a&t=1000',
        frameUpdatedAt: 1000,
      }),
    });
    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.refreshFrame();
    });
    expect(refreshResult).toEqual(expect.objectContaining({ updated: false, reason: 'up_to_date' }));
    expect(result.current.refreshStatus).toBe('up_to_date');

    // Teacher advances to Slide 2: session notifies metadata without auto-overwriting student's image
    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'static_url',
          teacherEmail: 'teacher@school.edu',
          frameUrl: 'https://storage.mock/slide.jpg?token=a&t=2000',
          frameUpdatedAt: 2000,
        }),
      });
    });
    expect(result.current.liveFrame).toBe('https://storage.mock/slide.jpg?token=a&t=1000');
    expect(result.current.hasNewFrame).toBe(true);

    // Manual Refresh compares timestamp 2000 !== 1000 and updates image
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        frameUrl: 'https://storage.mock/slide.jpg?token=a&t=2000',
        frameUpdatedAt: 2000,
      }),
    });
    await act(async () => {
      refreshResult = await result.current.refreshFrame();
    });
    expect(refreshResult).toEqual(expect.objectContaining({ updated: true, frameUpdatedAt: 2000 }));
    expect(result.current.liveFrame).toBe('https://storage.mock/slide.jpg?token=a&t=2000');
    expect(result.current.hasNewFrame).toBe(false);
    expect(result.current.refreshStatus).toBe('updated');

    // Leave broadcast
    await act(async () => {
      await result.current.leaveBroadcast();
    });

    expect(result.current.isViewing).toBe(false);
    expect(result.current.liveFrame).toBeNull();
    expect(result.current.connectionState).toBe('idle');
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_1/screenBroadcastViewers/student_123' })
    );

    unmount();
  });

  it('stops retrying immediately on permission-denied session errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_PERM',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    const callsBefore = mockOnSnapshot.mock.calls.length;
    await act(async () => {
      sessionErrorCallback(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    });

    expect(result.current.connectionState).toBe('failed');
    await new Promise((r) => setTimeout(r, 30));
    expect(mockOnSnapshot.mock.calls.length).toBe(callsBefore);
    warnSpy.mockRestore();
  });

  it('auto-recovers once per URL via handleFrameLoadError when a previous slide expires in Storage', async () => {
    const { result } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_RECOVER',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'static_url',
          frameUrl: 'https://storage.mock/slide_1000_aaa.jpg?token=t1&t=1000',
          frameUpdatedAt: 1000,
        }),
      });
    });

    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(result.current.liveFrame).toBe('https://storage.mock/slide_1000_aaa.jpg?token=t1&t=1000');

    // Slide 2 is pushed (Slide 1 is deleted from Storage)
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        broadcastMode: 'static_url',
        frameUrl: 'https://storage.mock/slide_2000_bbb.jpg?token=t2&t=2000',
        frameUpdatedAt: 2000,
      }),
    });

    await act(async () => {
      result.current.handleFrameLoadError();
      await Promise.resolve();
    });

    expect(result.current.liveFrame).toBe('https://storage.mock/slide_2000_bbb.jpg?token=t2&t=2000');
    expect(result.current.frameUpdatedAt).toBe(2000);

    // Repeating error on same URL without a newer server slide does not trigger infinite refreshes
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        isBroadcasting: true,
        broadcastMode: 'static_url',
        frameUrl: 'https://storage.mock/slide_2000_bbb.jpg?token=t2&t=2000',
        frameUpdatedAt: 2000,
      }),
    });
    const callsBeforeRepeat = mockGetDoc.mock.calls.length;
    await act(async () => {
      result.current.handleFrameLoadError();
      await Promise.resolve();
    });
    expect(mockGetDoc.mock.calls.length).toBe(callsBeforeRepeat + 1);

    await act(async () => {
      result.current.handleFrameLoadError();
      await Promise.resolve();
    });
    expect(mockGetDoc.mock.calls.length).toBe(callsBeforeRepeat + 1);
  });

  it('supports pre-deploy legacy frame mode via single liveFrame getDoc without using frameSeq as a 1970 timestamp', async () => {
    const { result } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_LEGACY',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'frame',
          teacherEmail: 'teacher@school.edu',
        }),
      });
    });

    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'frame',
          teacherEmail: 'teacher@school.edu',
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameData: 'data:image/jpeg;base64,legacy_frame_1',
          frameSeq: 1990,
          timestamp: { toMillis: () => 1795591320000 },
        }),
      });

    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(liveFrameSubscribed).toBe(false);
    expect(result.current.liveFrame).toBe('data:image/jpeg;base64,legacy_frame_1');
    expect(result.current.frameUpdatedAt).toBe(1795591320000);

    // Clicking Refresh when legacy frameSeq is unchanged returns up_to_date
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'frame',
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameData: 'data:image/jpeg;base64,legacy_frame_1',
          frameSeq: 1990,
          timestamp: { toMillis: () => 1795591320000 },
        }),
      });

    let refreshResult;
    await act(async () => {
      refreshResult = await result.current.refreshFrame();
    });
    expect(refreshResult).toEqual(expect.objectContaining({ updated: false, reason: 'up_to_date' }));

    // Clicking Refresh when legacy frameSeq increments without timestamp still updates frame and leaves frameUpdatedAt null (never 1990)
    mockGetDoc
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          broadcastMode: 'frame',
        }),
      })
      .mockResolvedValueOnce({
        exists: () => true,
        data: () => ({
          frameData: 'data:image/jpeg;base64,legacy_frame_2',
          frameSeq: 1991,
        }),
      });

    await act(async () => {
      refreshResult = await result.current.refreshFrame();
    });
    expect(refreshResult).toEqual(expect.objectContaining({ updated: true }));
    expect(result.current.liveFrame).toBe('data:image/jpeg;base64,legacy_frame_2');
    expect(result.current.frameUpdatedAt).toBeNull();
  });
});
