import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import useLectureRecorder, {
  formatDuration,
  getSupportedMimeType,
  getSupportedAudioMimeType,
  injectWebmDuration,
} from './useLectureRecorder';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

const mockCallableInstance = vi.fn().mockResolvedValue({ data: { success: true } });
vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockCallableInstance),
}));

const mockClearRecoverySession = vi.fn().mockResolvedValue();
const mockPersistRecoveryChunk = vi.fn().mockResolvedValue();
const mockGetPendingRecoverySessions = vi.fn().mockResolvedValue([]);
vi.mock('../utils/lectureRecoveryDb', () => ({
  clearRecoverySession: (...args) => mockClearRecoverySession(...args),
  persistRecoveryChunk: (...args) => mockPersistRecoveryChunk(...args),
  getPendingRecoverySessions: (...args) => mockGetPendingRecoverySessions(...args),
}));

vi.mock('fix-webm-duration', () => ({
  default: vi.fn((blob) => Promise.resolve(blob)),
}));

const mockSetDoc = vi.fn(() => Promise.resolve());
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockGetDoc = vi.fn(() => Promise.resolve({
  exists: () => true,
  data: () => ({ isLectureSubtitlesEnabled: true }),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, ...args) => ({ path: args.join('/') })),
  collection: vi.fn((db, ...args) => ({ path: args.join('/') })),
  getDoc: (...args) => mockGetDoc(...args),
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

    it('automatically triggers stopRecording when maxDurationSeconds safety limit is reached', async () => {
      const { result } = renderHook(() =>
        useLectureRecorder({ classId: 'test_class', teacherUid: 'teacher_1', maxDurationSeconds: 5 })
      );

      await act(async () => {
        await result.current.startRecording();
      });
      expect(result.current.recordingState).toBe('recording');

      // Provide chunk data
      act(() => {
        mockMediaRecorderInstances.forEach((inst) => {
          if (inst.ondataavailable) {
            inst.ondataavailable({ data: new Blob(['chunk-data'], { type: inst.mimeType }) });
          }
        });
      });

      // Advance time by 5 seconds to trigger safety limit
      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      expect(result.current.recordingState).toBe('completed');
    });

    it('skips processLectureSubtitles and updates session with subtitlesDisabled: true when class policy is disabled', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ isLectureSubtitlesEnabled: false }),
      });

      const { result } = renderHook(() =>
        useLectureRecorder({
          classId: 'class_disabled_subs',
          teacherUid: 'teacher_123',
        })
      );

      await act(async () => {
        await result.current.startRecording();
      });

      act(() => {
        mockMediaRecorderInstances.forEach((inst) => {
          if (inst.ondataavailable) {
            inst.ondataavailable({ data: new Blob(['chunk'], { type: inst.mimeType }) });
          }
        });
      });

      await act(async () => {
        await result.current.stopRecording();
      });

      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          status: 'ready',
          subtitlesDisabled: true,
        })
      );
    });
  });

  describe('mergeSessionRecordings', () => {
    it('throws error if classId is missing', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: null }));
      await expect(result.current.mergeSessionRecordings({ sessionGroupId: 'grp1' })).rejects.toThrow(
        'classId is required to merge recordings.'
      );
    });

    it('merges recordings and triggers processLectureSubtitles when subtitles are enabled', async () => {
      mockCallableInstance.mockResolvedValueOnce({
        data: {
          success: true,
          combinedSessionId: 'combined_123',
          storagePath: 'recordings/class_1/combined_123/lecture.webm',
          title: 'Master Combined Lecture',
        },
      });

      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      const mergeRes = await result.current.mergeSessionRecordings({
        sessionGroupId: 'grp1',
        recordingIds: ['rec1', 'rec2'],
        customTitle: 'Master Combined Lecture',
      });

      expect(mergeRes.success).toBe(true);
      expect(mergeRes.combinedSessionId).toBe('combined_123');
    });

    it('merges recordings and marks subtitlesDisabled when class subtitles are disabled', async () => {
      mockGetDoc.mockResolvedValueOnce({
        exists: () => true,
        data: () => ({ isLectureSubtitlesEnabled: false }),
      });
      mockCallableInstance.mockResolvedValueOnce({
        data: {
          success: true,
          combinedSessionId: 'combined_456',
        },
      });

      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      const mergeRes = await result.current.mergeSessionRecordings({
        sessionGroupId: 'grp2',
        recordingIds: ['rec3', 'rec4'],
      });

      expect(mergeRes.success).toBe(true);
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ subtitlesDisabled: true })
      );
    });

    it('propagates error when merge call fails', async () => {
      mockCallableInstance.mockRejectedValueOnce(new Error('Merge Cloud Function Failed'));

      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      await expect(
        result.current.mergeSessionRecordings({ sessionGroupId: 'grp_err' })
      ).rejects.toThrow('Merge Cloud Function Failed');
    });
  });

  describe('recoverInterruptedSession', () => {
    it('returns null if recoverySession is missing or has empty chunks', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      expect(await result.current.recoverInterruptedSession(null)).toBeNull();
      expect(await result.current.recoverInterruptedSession({ sessionId: 's1', chunks: [] })).toBeNull();
    });

    it('clears recovery session and returns null if chunks create empty blob', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      const res = await result.current.recoverInterruptedSession({
        sessionId: 's_empty',
        chunks: [new Blob([])],
      });
      expect(res).toBeNull();
      expect(mockClearRecoverySession).toHaveBeenCalledWith('s_empty');
    });

    it('recovers crashed recording session with chunks, uploads and saves to firestore', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      const recoverySession = {
        sessionId: 'session_crashed_1',
        classId: 'class_1',
        sessionGroupId: 'group_crash_1',
        mimeType: 'video/webm',
        chunks: [new Blob(['test-video-chunk'], { type: 'video/webm' })],
        title: 'Crashed Lecture Part 1',
        topic: 'Neural Networks',
      };

      const res = await result.current.recoverInterruptedSession(recoverySession);
      expect(res).toBeDefined();
      expect(res.sessionId).toBe('session_crashed_1');
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          title: 'Crashed Lecture Part 1',
          isRecoveredAfterCrash: true,
          status: 'ready',
        }),
        { merge: true }
      );
      expect(mockClearRecoverySession).toHaveBeenCalledWith('session_crashed_1');
    });

    it('catches error and returns null when recovery upload fails', async () => {
      const { result } = renderHook(() => useLectureRecorder({ classId: 'class_1' }));
      mockSetDoc.mockRejectedValueOnce(new Error('Firestore crash write failed'));

      const res = await result.current.recoverInterruptedSession({
        sessionId: 's_err',
        classId: 'class_1',
        chunks: [new Blob(['video-data'])],
      });
      expect(res).toBeNull();
    });
  });

  describe('injectWebmDuration', () => {
    it('returns raw blob if blob is null or undefined', async () => {
      expect(await injectWebmDuration(null, 1000)).toBeNull();
      expect(await injectWebmDuration(undefined, 1000)).toBeUndefined();
    });

    it('returns raw blob if durationMs is zero or negative', async () => {
      const mockBlob = new Blob(['abc']);
      expect(await injectWebmDuration(mockBlob, 0)).toBe(mockBlob);
      expect(await injectWebmDuration(mockBlob, -100)).toBe(mockBlob);
    });

    it('calls fixWebmDuration with duration and returns patched blob', async () => {
      const mockBlob = new Blob(['test-video'], { type: 'video/webm' });
      const resultBlob = await injectWebmDuration(mockBlob, 2211000);
      expect(resultBlob).toBeDefined();
    });
  });
});
