import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTeacherScreenBroadcastStudent from './useTeacherScreenBroadcastStudent';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockUnsubscribeSession = vi.fn();
const mockUnsubscribeViewer = vi.fn();
let sessionSnapshotCallback = null;
let viewerSnapshotCallback = null;

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
    if (docRef.path.includes('screenBroadcast/session')) {
      sessionSnapshotCallback = cb;
      return mockUnsubscribeSession;
    }
    if (docRef.path.includes('screenBroadcastViewers')) {
      viewerSnapshotCallback = cb;
      return mockUnsubscribeViewer;
    }
    return vi.fn();
  }),
}));

describe('useTeacherScreenBroadcastStudent Hook', () => {
  let mockPeerConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionSnapshotCallback = null;
    viewerSnapshotCallback = null;

    mockPeerConnection = {
      createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0...' }),
      setLocalDescription: vi.fn().mockResolvedValue(),
      setRemoteDescription: vi.fn().mockResolvedValue(),
      addIceCandidate: vi.fn().mockResolvedValue(),
      close: vi.fn(),
      connectionState: 'connecting',
      iceConnectionState: 'checking',
      signalingState: 'have-remote-offer',
      remoteDescription: { type: 'offer', sdp: 'v=0...' },
      ontrack: null,
      onicecandidate: null,
      onconnectionstatechange: null,
      oniceconnectionstatechange: null,
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

    const mockTracks = [
      { id: 'track_1', kind: 'video', stop: vi.fn() },
      { id: 'track_2', kind: 'audio', stop: vi.fn(), enabled: true },
    ];

    function MockMediaStream(tracks = mockTracks) {
      const localTracks = [...tracks];
      return {
        addTrack: vi.fn((t) => localTracks.push(t)),
        getTracks: vi.fn().mockReturnValue(localTracks),
        getAudioTracks: vi.fn().mockReturnValue(localTracks.filter(t => t.kind === 'audio')),
        getVideoTracks: vi.fn().mockReturnValue(localTracks.filter(t => t.kind === 'video')),
      };
    }

    global.window.RTCPeerConnection = MockRTCPeerConnection;
    global.window.webkitRTCPeerConnection = MockRTCPeerConnection;
    global.window.RTCSessionDescription = MockRTCSessionDescription;
    global.window.RTCIceCandidate = MockRTCIceCandidate;
    global.MediaStream = MockMediaStream;
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

  it('joins broadcast, answers teacher SDP offer, receives ICE candidates and updates state', async () => {
    const { result, unmount } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_1',
        studentUid: 'student_123',
        studentEmail: 'student@school.edu',
      })
    );

    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(result.current.isViewing).toBe(true);
    expect(result.current.connectionState).toBe('connecting');
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        studentUid: 'student_123',
        status: 'requesting',
      })
    );

    // Simulate incoming teacher offer via viewer doc snapshot
    expect(viewerSnapshotCallback).toBeTypeOf('function');
    await act(async () => {
      await viewerSnapshotCallback({
        exists: () => true,
        data: () => ({
          status: 'offered',
          offer: { type: 'offer', sdp: 'v=0...' },
          teacherCandidates: [{ candidate: 'candidate:1 1 UDP...' }],
        }),
      });
    });

    expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalled();
    expect(mockPeerConnection.createAnswer).toHaveBeenCalled();
    expect(mockPeerConnection.setLocalDescription).toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        status: 'answered',
      })
    );

    // Simulate incoming track
    act(() => {
      mockPeerConnection.ontrack({
        track: { id: 't_audio', kind: 'audio', stop: vi.fn() },
        streams: [],
      });
    });
    expect(result.current.hasAudio).toBe(true);

    // Simulate ICE candidate generated by student
    act(() => {
      mockPeerConnection.onicecandidate({
        candidate: { toJSON: () => ({ candidate: 'candidate:student' }) },
      });
    });
    expect(mockUpdateDoc).toHaveBeenCalled();

    // Simulate connection state change to connected
    mockPeerConnection.connectionState = 'connected';
    mockPeerConnection.iceConnectionState = 'connected';
    act(() => {
      mockPeerConnection.onconnectionstatechange();
    });
    expect(result.current.connectionState).toBe('connected');

    // Simulate connection state change to failed
    mockPeerConnection.connectionState = 'failed';
    mockPeerConnection.iceConnectionState = 'failed';
    act(() => {
      mockPeerConnection.onconnectionstatechange();
    });
    expect(result.current.connectionState).toBe('failed');
    expect(result.current.error).toMatch(/failed/i);

    // Toggle audio mute
    act(() => {
      result.current.toggleAudioMute();
    });
    expect(result.current.isAudioMuted).toBe(true);

    // Leave broadcast
    await act(async () => {
      await result.current.leaveBroadcast();
    });
    expect(result.current.isViewing).toBe(false);
    expect(mockDeleteDoc).toHaveBeenCalled();

    unmount();
  });
});
