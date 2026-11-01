import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const mockUpdateDoc = vi.fn().mockResolvedValue(true);
const mockOnSnapshot = vi.fn();
const mockUploadBytesResumable = vi.fn();
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.example.com/screen_clip.webm');

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, path) => ({ path })),
  onSnapshot: (...args) => mockOnSnapshot(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  arrayUnion: (val) => val,
  serverTimestamp: () => 'SERVER_TS',
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn((_s, path) => ({ path })),
  uploadBytesResumable: (...args) => mockUploadBytesResumable(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

vi.mock('./useLectureRecorder', () => ({
  injectWebmDuration: vi.fn(async (blob) => blob),
  getSupportedMimeType: vi.fn(() => 'video/webm'),
}));

import useStudentProjectMeetingScreenRecorder from './useStudentProjectMeetingScreenRecorder';

describe('useStudentProjectMeetingScreenRecorder', () => {
  let snapshotCallbacks = {};
  let lastRecorderInstance = null;

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCallbacks = {};
    lastRecorderInstance = null;

    mockOnSnapshot.mockImplementation((ref, onNext) => {
      snapshotCallbacks[ref.path] = onNext;
      return vi.fn();
    });

    global.MediaRecorder = class MockMediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        lastRecorderInstance = this;
      }
      start() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
    };

    mockUploadBytesResumable.mockImplementation(() => ({
      on: (_evt, onProgress, _onErr, onComplete) => {
        onProgress({ bytesTransferred: 50, totalBytes: 100 });
        onComplete();
      },
    }));
  });

  it('transitions from waiting_for_screen_share to recording_screen and uploads clip on stopping', async () => {
    const screenStreamRef = { current: null };

    const { result, rerender } = renderHook(
      ({ isScreenSharing }) =>
        useStudentProjectMeetingScreenRecorder({
          activeClass: 'it114115',
          userClasses: [{ id: 'it114115' }],
          studentUid: 'stu_1',
          studentEmail: '250105348@stu.vtc.edu.hk',
          studentName: 'Chan Tai Man',
          screenStreamRef,
          isScreenSharing,
        }),
      { initialProps: { isScreenSharing: false } }
    );

    const docPath = 'classes/it114115/activeMeetingCaptures/stu_1';
    expect(snapshotCallbacks[docPath]).toBeDefined();

    // 1. Supervisor triggers recording while student is NOT yet sharing screen
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({
          status: 'recording',
          groupId: 'grp_a01',
          meetingId: 'mtg_wk4',
          clipId: 'clip_1',
          label: 'Part 1',
        }),
      });
    });

    expect(result.current.meetingScreenState).toBe('waiting_for_screen_share');

    // 2. Student starts sharing their PC screen -> hook auto-starts MediaRecorder
    screenStreamRef.current = {
      getVideoTracks: () => [{ readyState: 'live' }],
    };
    rerender({ isScreenSharing: true });

    await waitFor(() => {
      expect(result.current.meetingScreenState).toBe('recording_screen');
    });
    expect(lastRecorderInstance).not.toBeNull();

    // Emit recorded video chunk
    act(() => {
      lastRecorderInstance.ondataavailable({
        data: new Blob(['video-bytes'], { type: 'video/webm' }),
      });
    });

    // 3. Supervisor stops recording -> hook stops MediaRecorder and uploads clip to Storage & Firestore
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({
          status: 'stopping',
          groupId: 'grp_a01',
          meetingId: 'mtg_wk4',
          clipId: 'clip_1',
          label: 'Part 1',
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.meetingScreenState).toBe('completed');
    });
    expect(mockGetDownloadURL).toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_wk4' }),
      expect.objectContaining({ hasVideo: true, videoDownloadUrl: 'https://storage.example.com/screen_clip.webm' })
    );

    // 4. Supervisor resets capture doc to idle or deletes it
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({ status: 'idle' }),
      });
    });
    expect(result.current.meetingScreenState).toBe('idle');

    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => false,
      });
    });
    expect(result.current.activeMeetingCapture).toBeNull();
  });

  it('handles empty chunks and upload failure gracefully', async () => {
    const screenStreamRef = {
      current: { getVideoTracks: () => [{ readyState: 'live' }] },
    };

    const { result } = renderHook(() =>
      useStudentProjectMeetingScreenRecorder({
        activeClass: 'it114115',
        studentUid: 'stu_2',
        studentEmail: 'stu2@stu.vtc.edu.hk',
        screenStreamRef,
        isScreenSharing: true,
      })
    );

    const docPath = 'classes/it114115/activeMeetingCaptures/stu_2';

    // Start and stop with 0 chunks -> completes immediately without storage upload
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({ status: 'recording', groupId: 'g1', meetingId: 'm1', clipId: 'c1' }),
      });
    });
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({ status: 'stopping', groupId: 'g1', meetingId: 'm1', clipId: 'c1' }),
      });
    });
    await waitFor(() => {
      expect(result.current.meetingScreenState).toBe('completed');
    });

    // Now test upload error path
    mockUploadBytesResumable.mockImplementationOnce(() => ({
      on: (_evt, _onProg, onErr) => {
        onErr(new Error('Storage quota exceeded'));
      },
    }));

    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({ status: 'recording', groupId: 'g1', meetingId: 'm1', clipId: 'c2' }),
      });
    });
    act(() => {
      lastRecorderInstance.ondataavailable({
        data: new Blob(['chunk'], { type: 'video/webm' }),
      });
    });
    await act(async () => {
      snapshotCallbacks[docPath]({
        exists: () => true,
        data: () => ({ status: 'stopping', groupId: 'g1', meetingId: 'm1', clipId: 'c2' }),
      });
    });

    await waitFor(() => {
      expect(result.current.meetingScreenState).toBe('error');
    });
  });
});
