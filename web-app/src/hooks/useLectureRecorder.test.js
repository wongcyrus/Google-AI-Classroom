import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useLectureRecorder, { formatDuration, getSupportedMimeType, getSupportedAudioMimeType } from './useLectureRecorder';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue({ data: { success: true } })),
}));

const mockSetDoc = vi.fn(() => Promise.resolve());
const mockUpdateDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path })),
  collection: vi.fn((db, path) => ({ path })),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
}));

let mockUploadTask;
const mockGetDownloadURL = vi.fn((ref) => {
  const p = ref?.path || '';
  if (p.includes('audio')) {
    return Promise.resolve('https://storage.googleapis.com/test-bucket/lecture_audio.webm');
  }
  return Promise.resolve('https://storage.googleapis.com/test-bucket/lecture.webm');
});

vi.mock('firebase/storage', () => ({
  ref: vi.fn((storage, path) => ({ path })),
  uploadBytesResumable: vi.fn((ref, blob, meta) => {
    mockUploadTask = {
      snapshot: { ref, bytesTransferred: 1000, totalBytes: 1000 },
      ref,
      on: vi.fn((event, onProgress, onError, onComplete) => {
        if (onProgress) onProgress({ bytesTransferred: 500, totalBytes: 1000 });
        if (onComplete) onComplete();
      }),
    };
    return mockUploadTask;
  }),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

describe('useLectureRecorder Hook & Utilities', () => {
  let mockScreenTracks;
  let mockAudioTracks;
  let mockMediaRecorderInstance;
  let mockMediaRecorderInstances = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockMediaRecorderInstances = [];

    mockScreenTracks = [
      { id: 'screen_1', kind: 'video', readyState: 'live', stop: vi.fn() },
    ];
    mockAudioTracks = [
      { id: 'audio_1', kind: 'audio', readyState: 'live', stop: vi.fn() },
    ];

    function MockMediaStream(tracks = []) {
      const internalTracks = [...tracks];
      return {
        active: true,
        addTrack: vi.fn((t) => internalTracks.push(t)),
        getTracks: vi.fn().mockReturnValue(internalTracks),
        getVideoTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'video')),
        getAudioTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'audio')),
      };
    }
    global.MediaStream = MockMediaStream;

    function MockMediaRecorder(stream, options = {}) {
      const instance = {
        stream,
        options,
        state: 'inactive',
        mimeType: options.mimeType || 'video/webm; codecs=vp9,opus',
        start: vi.fn(function () { this.state = 'recording'; }),
        pause: vi.fn(function () { this.state = 'paused'; }),
        resume: vi.fn(function () { this.state = 'recording'; }),
        stop: vi.fn(function () {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }),
        ondataavailable: null,
        onstop: null,
      };
      mockMediaRecorderInstances.push(instance);
      mockMediaRecorderInstance = instance;
      return instance;
    }
    MockMediaRecorder.isTypeSupported = vi.fn((type) => type.includes('webm'));
    global.MediaRecorder = MockMediaRecorder;

    navigator.mediaDevices = {
      getDisplayMedia: vi.fn().mockResolvedValue(new MockMediaStream(mockScreenTracks)),
      getUserMedia: vi.fn().mockResolvedValue(new MockMediaStream(mockAudioTracks)),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Utility Functions', () => {
    it('formats duration correctly', () => {
      expect(formatDuration(0)).toBe('00:00');
      expect(formatDuration(65)).toBe('01:05');
      expect(formatDuration(3665)).toBe('01:01:05');
    });

    it('returns supported mime type', () => {
      expect(getSupportedMimeType()).toBe('video/webm; codecs=vp9,opus');
    });

    it('returns supported audio mime type', () => {
      expect(getSupportedAudioMimeType()).toBe('audio/webm; codecs=opus');
    });
  });

  describe('Recording Lifecycle', () => {
    it('initializes in idle state', () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      expect(result.current.recordingState).toBe('idle');
      expect(result.current.isRecording).toBe(false);
      expect(result.current.isPaused).toBe(false);
      expect(result.current.durationSeconds).toBe(0);
      expect(result.current.activeSessionId).toBeNull();
    });

    it('requires classId to start recording', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: '' }));

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.error).toBe('Class ID is required to start lecture recording.');
      expect(result.current.recordingState).toBe('idle');
    });

    it('starts recording and tracks duration with fake timers', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1', teacherEmail: 'teacher@school.edu' })
      );

      await act(async () => {
        await result.current.startRecording({ title: 'Lab 1 Lecture', topic: 'React & REST' });
      });

      expect(result.current.recordingState).toBe('recording');
      expect(result.current.isRecording).toBe(true);
      expect(result.current.activeSessionId).toBeTruthy();
      expect(mockSetDoc).toHaveBeenCalledTimes(1);

      // Advance timer by 5 seconds
      act(() => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.durationSeconds).toBe(5);
      expect(result.current.durationFormatted).toBe('00:05');
    });

    it('supports pause and resume without resetting duration', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      act(() => {
        vi.advanceTimersByTime(3000);
      });
      expect(result.current.durationSeconds).toBe(3);

      // Pause recording
      act(() => {
        result.current.pauseRecording();
      });
      expect(result.current.isPaused).toBe(true);
      expect(result.current.recordingState).toBe('paused');

      // Advancing timer while paused does not increase duration
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(result.current.durationSeconds).toBe(3);

      // Resume recording
      act(() => {
        result.current.resumeRecording();
      });
      expect(result.current.isRecording).toBe(true);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(result.current.durationSeconds).toBe(5);
    });

    it('stops recording, uploads blob to Cloud Storage and updates Firestore', async () => {
      const onRecordingComplete = vi.fn();
      const { result } = renderHook(() =>
        useLectureRecorder({
          classId: 'test_class',
          teacherUid: 'teacher_1',
          teacherEmail: 'teacher@school.edu',
          onRecordingComplete,
        })
      );

      await act(async () => {
        await result.current.startRecording({ title: 'Final Lecture' });
      });

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      // Simulate data chunks received
      act(() => {
        mockMediaRecorderInstances.forEach((inst) => {
          if (inst.ondataavailable) {
            inst.ondataavailable({ data: new Blob(['chunk1'], { type: inst.mimeType }) });
          }
        });
      });

      let stopResult;
      await act(async () => {
        stopResult = await result.current.stopRecording();
      });

      expect(result.current.recordingState).toBe('completed');
      expect(stopResult).toBeDefined();
      expect(stopResult.videoUrl).toBe('https://storage.googleapis.com/test-bucket/lecture.webm');
      expect(stopResult.audioUrl).toBe('https://storage.googleapis.com/test-bucket/lecture_audio.webm');
      expect(stopResult.audioStoragePath).toContain('lecture_audio');
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      expect(onRecordingComplete).toHaveBeenCalledWith(expect.objectContaining({
        videoUrl: 'https://storage.googleapis.com/test-bucket/lecture.webm',
        audioUrl: 'https://storage.googleapis.com/test-bucket/lecture_audio.webm',
      }));
    });

    it('discards recording without upload when requested', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.isRecording).toBe(true);

      await act(async () => {
        await result.current.discardRecording();
      });

      expect(result.current.recordingState).toBe('idle');
      expect(result.current.isRecording).toBe(false);
      expect(result.current.activeSessionId).toBeNull();
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: 'discarded' })
      );
    });

    it('handles pauseRecording and resumeRecording transitions', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      expect(result.current.recordingState).toBe('recording');

      // Pause
      act(() => {
        result.current.pauseRecording();
      });

      expect(result.current.recordingState).toBe('paused');
      expect(mockMediaRecorderInstance.pause).toHaveBeenCalled();
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isPaused: true })
      );

      // Resume
      act(() => {
        result.current.resumeRecording();
      });

      expect(result.current.recordingState).toBe('recording');
      expect(mockMediaRecorderInstance.resume).toHaveBeenCalled();
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isPaused: false })
      );
    });

    it('sets error state when finalize fails during stopRecording', async () => {
      mockUpdateDoc.mockRejectedValueOnce(new Error('Firestore update failed'));

      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      act(() => {
        mockMediaRecorderInstances.forEach((inst) => {
          if (inst.ondataavailable) {
            inst.ondataavailable({ data: new Blob(['chunk1'], { type: inst.mimeType }) });
          }
        });
      });

      let caughtError;
      await act(async () => {
        try {
          await result.current.stopRecording();
        } catch (err) {
          caughtError = err;
        }
      });

      expect(caughtError).toBeDefined();
      expect(result.current.recordingState).toBe('error');
      expect(result.current.error).toBe('Firestore update failed');
    });

    it('prevents concurrent or rapid double-start and ignores stale chunk events', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1' })
      );

      // Invoke twice concurrently
      await act(async () => {
        const p1 = result.current.startRecording();
        const p2 = result.current.startRecording();
        await Promise.all([p1, p2]);
      });

      // Only one active recording session should be created
      expect(mockSetDoc).toHaveBeenCalledTimes(1);
      expect(result.current.recordingState).toBe('recording');

      // Emit chunk from active recorder
      act(() => {
        mockMediaRecorderInstances.forEach((inst) => {
          if (inst.ondataavailable) {
            inst.ondataavailable({ data: new Blob(['test-chunk'], { type: inst.mimeType }) });
          }
        });
      });

      // Stop recording
      await act(async () => {
        await result.current.stopRecording();
      });
      expect(result.current.recordingState).toBe('completed');
    });
  });
});
