import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTeacherScreenBroadcastStudent from './useTeacherScreenBroadcastStudent';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockUnsubscribeSession = vi.fn();
const mockUnsubscribeLiveFrame = vi.fn();
let sessionSnapshotCallback = null;
let liveFrameSnapshotCallback = null;

const mockSetDoc = vi.fn(() => Promise.resolve());
const mockDeleteDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path })),
  setDoc: (...args) => mockSetDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  onSnapshot: vi.fn((docRef, cb) => {
    if (docRef.path.includes('screenBroadcast/session')) {
      sessionSnapshotCallback = cb;
      return mockUnsubscribeSession;
    }
    if (docRef.path.includes('screenBroadcast/liveFrame')) {
      liveFrameSnapshotCallback = cb;
      return mockUnsubscribeLiveFrame;
    }
    return vi.fn();
  }),
}));

describe('useTeacherScreenBroadcastStudent Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionSnapshotCallback = null;
    liveFrameSnapshotCallback = null;
  });

  it('listens to active broadcast session state and reflects it in return state', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    expect(result.current.isBroadcastActive).toBe(false);
    expect(sessionSnapshotCallback).toBeTypeOf('function');

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

  it('joins broadcast, registers presence, receives live frames, and leaves broadcast cleanly', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    // Active session broadcast
    await act(async () => {
      sessionSnapshotCallback({
        exists: () => true,
        data: () => ({
          isBroadcasting: true,
          teacherEmail: 'teacher@school.edu',
        }),
      });
    });

    expect(result.current.broadcastMode).toBe('frame');

    // Join broadcast
    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(result.current.isViewing).toBe(true);
    expect(result.current.connectionState).toBe('connecting');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_1/screenBroadcastViewers/student_123' }),
      expect.objectContaining({
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
        status: 'watching',
      })
    );

    // Simulate liveFrame snapshot
    expect(liveFrameSnapshotCallback).toBeTypeOf('function');
    await act(async () => {
      liveFrameSnapshotCallback({
        exists: () => true,
        data: () => ({
          frameData: 'data:image/jpeg;base64,mock_frame_123',
          frameSeq: 1,
        }),
      });
    });

    expect(result.current.liveFrame).toBe('data:image/jpeg;base64,mock_frame_123');
    expect(result.current.connectionState).toBe('connected');

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
    expect(mockUnsubscribeLiveFrame).toHaveBeenCalled();

    unmount();
  });
});
