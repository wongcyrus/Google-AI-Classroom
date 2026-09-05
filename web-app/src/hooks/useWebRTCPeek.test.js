import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useWebRTCPeekTeacher from './useWebRTCPeekTeacher';
import useWebRTCPeekStudent from './useWebRTCPeekStudent';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockUnsubscribe = vi.fn();
let snapshotCallback = null;
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockSetDoc = vi.fn(() => Promise.resolve());
const mockDeleteDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path })),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  arrayUnion: vi.fn((val) => [val]),
  onSnapshot: vi.fn((docRef, cb) => {
    snapshotCallback = cb;
    return mockUnsubscribe;
  }),
}));

describe('useWebRTCPeekTeacher and useWebRTCPeekStudent Hooks', () => {
  let mockPeerConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    snapshotCallback = null;

    mockPeerConnection = {
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0...' }),
      createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0...' }),
      setLocalDescription: vi.fn().mockResolvedValue(),
      setRemoteDescription: vi.fn().mockResolvedValue(),
      addTrack: vi.fn().mockReturnValue({ replaceTrack: vi.fn() }),
      removeTrack: vi.fn(),
      addTransceiver: vi.fn(),
      addIceCandidate: vi.fn().mockResolvedValue(),
      close: vi.fn(),
      connectionState: 'connecting',
      signalingState: 'have-local-offer',
      ontrack: null,
      onicecandidate: null,
      onconnectionstatechange: null,
    };

    function MockRTCPeerConnection() {
      return mockPeerConnection;
    }

    function MockRTCSessionDescription(desc) {
      return desc;
    }

    function MockRTCIceCandidate(cand) {
      return cand;
    }

    function MockMediaStream() {
      return {
        addTrack: vi.fn(),
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      };
    }

    global.window.RTCPeerConnection = MockRTCPeerConnection;
    global.window.webkitRTCPeerConnection = MockRTCPeerConnection;
    global.window.RTCSessionDescription = MockRTCSessionDescription;
    global.window.RTCIceCandidate = MockRTCIceCandidate;
    global.MediaStream = MockMediaStream;

    navigator.mediaDevices = {
      getUserMedia: vi.fn().mockResolvedValue({
        getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
        getAudioTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }]),
      }),
    };
  });

  it('teacher initiates live peek with SDP offer, handles student answer, candidate and talkback', async () => {
    const { result, unmount } = renderHook(() =>
      useWebRTCPeekTeacher({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        teacherUid: 'teacher_abc',
      })
    );

    expect(result.current.isPeeking).toBe(false);

    await act(async () => {
      await result.current.startPeek();
    });

    expect(result.current.isPeeking).toBe(true);
    expect(mockPeerConnection.createOffer).toHaveBeenCalled();
    expect(mockPeerConnection.setLocalDescription).toHaveBeenCalled();
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'offered' })
    );

    // Simulate onicecandidate
    mockPeerConnection.onicecandidate({
      candidate: { toJSON: () => ({ candidate: 'teacher-candidate' }) },
    });
    expect(mockUpdateDoc).toHaveBeenCalled();

    // Simulate incoming video and audio tracks
    const mockVideoTrack = { id: 'remote_video', kind: 'video' };
    const mockAudioTrack = { id: 'remote_audio', kind: 'audio', label: 'Mic', enabled: true, readyState: 'live' };
    
    act(() => {
      mockPeerConnection.ontrack({
        streams: [{ id: 'screen_stream', getTracks: () => [mockVideoTrack] }],
        track: mockVideoTrack,
      });

      mockPeerConnection.ontrack({
        streams: [{ id: 'audio_stream', getTracks: () => [mockAudioTrack] }],
        track: mockAudioTrack,
      });
    });

    // Simulate connection state change
    await act(async () => {
      mockPeerConnection.connectionState = 'connected';
      mockPeerConnection.onconnectionstatechange();
    });
    expect(result.current.connectionState).toBe('connected');

    // Simulate student answer, streamMetadata & candidate via snapshot
    await act(async () => {
      await snapshotCallback({
        exists: () => true,
        data: () => ({
          answer: { type: 'answer', sdp: 'v=0...' },
          streamMetadata: { screenStreamId: 'remote_video', webcamStreamId: 'cam_video' },
          studentCandidates: [{ candidate: 'student-cand-1' }],
        }),
      });
    });

    // Simulate webcam track arriving after metadata
    const mockCamTrack = { id: 'cam_video', kind: 'video' };
    act(() => {
      mockPeerConnection.ontrack({
        streams: [{ id: 'cam_stream', getTracks: () => [mockCamTrack] }],
        track: mockCamTrack,
      });
    });

    expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalled();
    expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();

    // Teacher toggles talkback intercom ON
    await act(async () => {
      await result.current.toggleTalkback(true, 'default-mic');
    });
    expect(result.current.isTalkbackActive).toBe(true);

    // Replace audio track while talkback is ON
    await act(async () => {
      await result.current.toggleTalkback(true, 'headset-mic');
    });
    expect(result.current.isTalkbackActive).toBe(true);

    // Disable talkback OFF
    await act(async () => {
      await result.current.toggleTalkback(false);
    });
    expect(result.current.isTalkbackActive).toBe(false);

    // Teacher stops peek
    await act(async () => {
      await result.current.stopPeek();
    });

    expect(result.current.isPeeking).toBe(false);
    expect(mockPeerConnection.close).toHaveBeenCalled();

    unmount();
  });

  it('handles rejected or closed status in teacher snapshot', async () => {
    const { result } = renderHook(() =>
      useWebRTCPeekTeacher({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        teacherUid: 'teacher_abc',
      })
    );

    await act(async () => {
      await result.current.startPeek();
    });

    await act(async () => {
      await snapshotCallback({
        exists: () => true,
        data: () => ({ status: 'rejected' }),
      });
    });

    expect(result.current.isPeeking).toBe(false);
  });

  it('student responds to incoming live peek offer with SDP answer, tracks and ICE exchange', async () => {
    const mockScreenTrack = { stop: vi.fn() };
    const mockWebcamTrack = { stop: vi.fn() };
    const mockAudioTrack = { stop: vi.fn() };

    const screenStreamRef = { current: { getTracks: () => [mockScreenTrack] } };
    const webcamStreamRef = { current: { getTracks: () => [mockWebcamTrack] } };
    const audioStreamRef = { current: { getTracks: () => [mockAudioTrack] } };

    const { unmount } = renderHook(() =>
      useWebRTCPeekStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        screenStreamRef,
        webcamStreamRef,
        audioStreamRef,
      })
    );

    expect(snapshotCallback).toBeTypeOf('function');

    // Simulate incoming offer
    await act(async () => {
      await snapshotCallback({
        exists: () => true,
        data: () => ({
          status: 'offered',
          offer: { type: 'offer', sdp: 'v=0...' },
          teacherCandidates: [{ candidate: 'c1' }],
        }),
      });
    });

    expect(mockPeerConnection.addTrack).toHaveBeenCalledTimes(3);
    expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalled();
    expect(mockPeerConnection.createAnswer).toHaveBeenCalled();
    expect(mockPeerConnection.setLocalDescription).toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'connected' })
    );

    // Trigger student ice candidate
    mockPeerConnection.onicecandidate({
      candidate: { toJSON: () => ({ candidate: 'student-candidate' }) },
    });
    expect(mockUpdateDoc).toHaveBeenCalled();

    // Trigger student ontrack (teacher talkback voice)
    mockPeerConnection.ontrack({
      track: { kind: 'audio', id: 'teacher-voice' },
      streams: [{ getTracks: () => [{ id: 'teacher-voice' }] }],
    });

    if (mockPeerConnection.onconnectionstatechange) {
      mockPeerConnection.onconnectionstatechange();
    }

    unmount();
    expect(mockPeerConnection.close).toHaveBeenCalled();
  });

  it('student closes connection when doc does not exist', async () => {
    const { unmount } = renderHook(() =>
      useWebRTCPeekStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        screenStreamRef: { current: null },
        webcamStreamRef: { current: null },
        audioStreamRef: { current: null },
      })
    );

    await act(async () => {
      await snapshotCallback({
        exists: () => false,
      });
    });

    unmount();
  });

  it('handles responder errors gracefully when remote offer processing fails', async () => {
    mockPeerConnection.setRemoteDescription = vi.fn().mockRejectedValueOnce(new Error('Invalid SDP offer'));

    const { unmount } = renderHook(() =>
      useWebRTCPeekStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        screenStreamRef: { current: null },
        webcamStreamRef: { current: null },
        audioStreamRef: { current: null },
      })
    );

    await act(async () => {
      await snapshotCallback({
        exists: () => true,
        data: () => ({
          status: 'offered',
          offer: { type: 'offer', sdp: 'broken' },
        }),
      });
    });

    unmount();
  });
});
