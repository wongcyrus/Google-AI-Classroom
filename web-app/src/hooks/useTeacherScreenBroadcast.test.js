import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTeacherScreenBroadcast from './useTeacherScreenBroadcast';
import useTeacherScreenBroadcastStudent from './useTeacherScreenBroadcastStudent';

vi.mock('../firebase-config', () => ({
  db: {},
}));

let docListeners = new Map();
let collectionListeners = new Map();

const mockSetDoc = vi.fn(() => Promise.resolve());
const mockDeleteDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path, isCollection: false })),
  collection: vi.fn((db, path) => ({ path, isCollection: true })),
  setDoc: (...args) => mockSetDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  onSnapshot: vi.fn((targetRef, cb) => {
    const path = targetRef.path;
    if (targetRef.isCollection) {
      collectionListeners.set(path, cb);
    } else {
      docListeners.set(path, cb);
    }
    return vi.fn(() => {
      docListeners.delete(path);
      collectionListeners.delete(path);
    });
  }),
}));

describe('useTeacherScreenBroadcast Hook', () => {
  let mockTracks;

  beforeEach(() => {
    vi.clearAllMocks();
    docListeners.clear();
    collectionListeners.clear();

    mockTracks = [
      { id: 'track_screen', kind: 'video', readyState: 'live', stop: vi.fn() },
    ];

    function MockMediaStream(tracks = mockTracks) {
      const internalTracks = [...tracks];
      return {
        addTrack: vi.fn((t) => internalTracks.push(t)),
        getTracks: vi.fn().mockReturnValue(internalTracks),
        getVideoTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'video')),
        getAudioTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'audio')),
      };
    }

    global.MediaStream = MockMediaStream;

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(32 * 18 * 4) }),
    });
    HTMLCanvasElement.prototype.toDataURL = vi.fn().mockReturnValue('data:image/jpeg;base64,mockframe123');
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue();
    HTMLMediaElement.prototype.pause = vi.fn();
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 1280, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 720, configurable: true });

    navigator.mediaDevices = {
      getDisplayMedia: vi.fn().mockResolvedValue(MockMediaStream(mockTracks)),
    };
  });

  it('teacher initiates broadcast, captures clamped media, and writes session and liveFrame docs', async () => {
    const { result } = renderHook(() =>
      useTeacherScreenBroadcast({
        classId: 'CLASS_TEST',
        teacherUid: 'teacher_123',
        teacherEmail: 'teacher@test.com',
      })
    );

    expect(result.current.isBroadcasting).toBe(false);

    await act(async () => {
      await result.current.startBroadcast();
    });

    expect(result.current.isBroadcasting).toBe(true);
    expect(result.current.broadcastMode).toBe('frame');

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          displaySurface: 'monitor',
          frameRate: expect.objectContaining({ ideal: 10, max: 15 }),
        }),
        audio: false,
      })
    );

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/session' }),
      expect.objectContaining({ isBroadcasting: true, broadcastMode: 'frame', resolution: '1080p', teacherUid: 'teacher_123' }),
      { merge: true }
    );

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/liveFrame' }),
      expect.objectContaining({ frameData: 'data:image/jpeg;base64,mockframe123', resolution: '1080p' })
    );

    // Simulate student joining collection listener
    const colCb = collectionListeners.get('classes/CLASS_TEST/screenBroadcastViewers');
    expect(colCb).toBeDefined();

    await act(async () => {
      colCb({
        forEach: (fn) => {
          fn({
            id: 'student_456',
            data: () => ({
              studentEmail: 's456@test.com',
              status: 'watching',
              joinedAt: 'MOCK_TIMESTAMP',
            }),
          });
        },
      });
    });

    expect(result.current.viewers).toHaveLength(1);
    expect(result.current.viewers[0].studentUid).toBe('student_456');
    expect(result.current.viewers[0].connectionState).toBe('connected');

    // Stop broadcast
    await act(async () => {
      await result.current.stopBroadcast();
    });

    expect(result.current.isBroadcasting).toBe(false);
    expect(result.current.viewers).toHaveLength(0);

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/session' }),
      expect.objectContaining({ isBroadcasting: false }),
      { merge: true }
    );

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/liveFrame' }),
      expect.objectContaining({ frameData: null }),
      { merge: true }
    );
  });

  it('handles getDisplayMedia error and cleans up broadcast state', async () => {
    navigator.mediaDevices.getDisplayMedia = vi.fn().mockRejectedValueOnce(new Error('Permission denied'));

    const { result } = renderHook(() =>
      useTeacherScreenBroadcast({
        classId: 'CLASS_TEST',
        teacherUid: 'teacher_123',
        teacherEmail: 'teacher@school.edu',
      })
    );

    await act(async () => {
      await result.current.startBroadcast();
    });

    expect(result.current.isBroadcasting).toBe(false);
    expect(result.current.error).toBe('Permission denied');
  });

  it('cleans up broadcast when unmounted', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcast({
        classId: 'CLASS_TEST',
        teacherUid: 'teacher_123',
        teacherEmail: 'teacher@test.com',
      })
    );

    await act(async () => {
      await result.current.startBroadcast();
    });

    expect(result.current.isBroadcasting).toBe(true);

    act(() => {
      unmount();
    });

    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/session' }),
      expect.objectContaining({ isBroadcasting: false }),
      { merge: true }
    );
  });

  it('uses inline Web Worker ticker when Worker and Blob are available', async () => {
    let workerInstance = null;
    const mockPostMessage = vi.fn();
    const mockTerminate = vi.fn();

    class MockWorker {
      constructor(url) {
        this.url = url;
        this.postMessage = mockPostMessage;
        this.terminate = mockTerminate;
        // eslint-disable-next-line consistent-this
        workerInstance = this;
      }
    }

    const originalWorker = window.Worker;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;

    window.Worker = MockWorker;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-worker-url');
    URL.revokeObjectURL = vi.fn();

    try {
      const { result } = renderHook(() =>
        useTeacherScreenBroadcast({
          classId: 'CLASS_WORKER',
          teacherUid: 'teacher_123',
          teacherEmail: 'teacher@test.com',
        })
      );

      await act(async () => {
        await result.current.startBroadcast();
      });

      expect(result.current.isBroadcasting).toBe(true);
      expect(mockPostMessage).toHaveBeenCalledWith({ action: 'start', interval: 1500 });
      expect(workerInstance).not.toBeNull();

      // Simulate a tick from background worker
      await act(async () => {
        workerInstance.onmessage({ data: 'tick' });
      });

      // Stop broadcast terminates worker and revokes blob url
      await act(async () => {
        await result.current.stopBroadcast();
      });

      expect(mockPostMessage).toHaveBeenCalledWith({ action: 'stop' });
      expect(mockTerminate).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-worker-url');
    } finally {
      window.Worker = originalWorker;
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('uses hardware ImageCapture API directly when available on window', async () => {
    const mockGrabFrame = vi.fn().mockResolvedValue({
      width: 1280,
      height: 720,
    });

    class MockImageCapture {
      constructor(track) {
        this.track = track;
        this.grabFrame = mockGrabFrame;
      }
    }

    const originalImageCapture = window.ImageCapture;
    window.ImageCapture = MockImageCapture;

    try {
      const { result } = renderHook(() =>
        useTeacherScreenBroadcast({
          classId: 'CLASS_IC',
          teacherUid: 'teacher_123',
          teacherEmail: 'teacher@test.com',
        })
      );

      await act(async () => {
        await result.current.startBroadcast();
      });

      expect(result.current.isBroadcasting).toBe(true);
      expect(mockGrabFrame).toHaveBeenCalled();

      await act(async () => {
        await result.current.stopBroadcast();
      });
    } finally {
      window.ImageCapture = originalImageCapture;
    }
  });

  it('allows teacher to configure resolution and framerate interval dynamically', async () => {
    const { result } = renderHook(() =>
      useTeacherScreenBroadcast({
        classId: 'CLASS_RES_TEST',
        teacherUid: 'teacher_123',
        teacherEmail: 'teacher@test.com',
      })
    );

    // Initial default is 1080p and 1500ms
    expect(result.current.broadcastResolution).toBe('1080p');
    expect(result.current.broadcastInterval).toBe(1500);

    // Change resolution to native and interval to 1000ms
    act(() => {
      result.current.setBroadcastResolution('native');
      result.current.setBroadcastInterval(1000);
    });

    expect(result.current.broadcastResolution).toBe('native');
    expect(result.current.broadcastInterval).toBe(1000);
    expect(localStorage.getItem('gemini_teacher_broadcast_resolution')).toBe('native');
    expect(localStorage.getItem('gemini_teacher_broadcast_interval')).toBe('1000');

    // Start broadcast with custom options
    await act(async () => {
      await result.current.startBroadcast({ resolution: '720p', interval: 2000 });
    });

    expect(result.current.isBroadcasting).toBe(true);
    expect(result.current.broadcastResolution).toBe('720p');
    expect(result.current.broadcastInterval).toBe(2000);

    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          displaySurface: 'monitor',
          frameRate: expect.objectContaining({ ideal: 10, max: 15 }),
        }),
      })
    );

    await act(async () => {
      await result.current.stopBroadcast();
    });
  });
});

