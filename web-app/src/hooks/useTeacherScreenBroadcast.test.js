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
const mockUpdateDoc = vi.fn(() => Promise.resolve());
const mockDeleteDoc = vi.fn(() => Promise.resolve());

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, path) => ({ path, isCollection: false })),
  collection: vi.fn((db, path) => ({ path, isCollection: true })),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
  arrayUnion: vi.fn((val) => [val]),
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

describe('useTeacherScreenBroadcast and useTeacherScreenBroadcastStudent Hooks', () => {
  let mockPeerConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    docListeners.clear();
    collectionListeners.clear();

    mockPeerConnection = {
      createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'v=0...' }),
      createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'v=0...' }),
      remoteDescription: null,
      setLocalDescription: vi.fn().mockResolvedValue(),
      setRemoteDescription: vi.fn().mockImplementation((desc) => {
        mockPeerConnection.remoteDescription = desc;
        return Promise.resolve();
      }),
      addTrack: vi.fn().mockReturnValue({ replaceTrack: vi.fn() }),
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

    function MockMediaStream(tracks = []) {
      const internalTracks = [...tracks];
      return {
        addTrack: vi.fn((t) => internalTracks.push(t)),
        getTracks: vi.fn().mockReturnValue(internalTracks),
        getVideoTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'video')),
        getAudioTracks: vi.fn().mockReturnValue(internalTracks.filter((t) => t.kind === 'audio')),
      };
    }

    global.window.RTCPeerConnection = MockRTCPeerConnection;
    global.window.webkitRTCPeerConnection = MockRTCPeerConnection;
    global.window.RTCSessionDescription = MockRTCSessionDescription;
    global.window.RTCIceCandidate = MockRTCIceCandidate;
    global.MediaStream = MockMediaStream;

    navigator.mediaDevices = {
      getDisplayMedia: vi.fn().mockResolvedValue(
        MockMediaStream([
          { id: 'track_screen', kind: 'video', readyState: 'live', stop: vi.fn() },
          { id: 'track_audio', kind: 'audio', readyState: 'live', stop: vi.fn(), enabled: true },
        ])
      ),
    };
  });

  it('teacher initiates broadcast, registers session doc, and handles student connection request', async () => {
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
    expect(result.current.hasAudio).toBe(true);
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcast/session' }),
      expect.objectContaining({ isBroadcasting: true, teacherUid: 'teacher_123' })
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
              status: 'requesting',
              joinedAt: 'MOCK_TIMESTAMP',
            }),
          });
        },
      });
    });

    expect(mockPeerConnection.createOffer).toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcastViewers/student_456' }),
      expect.objectContaining({ status: 'offered' })
    );

    // Stop broadcast
    await act(async () => {
      await result.current.stopBroadcast();
    });

    expect(result.current.isBroadcasting).toBe(false);
    expect(mockPeerConnection.close).toHaveBeenCalled();
  });

  it('student listens to broadcast, joins, responds to offer, and toggles audio mute', async () => {
    const { result } = renderHook(() =>
      useTeacherScreenBroadcastStudent({
        classId: 'CLASS_TEST',
        studentUid: 'student_456',
        studentEmail: 's456@test.com',
      })
    );

    expect(result.current.isBroadcastActive).toBe(false);

    // Simulate teacher activating broadcast session in Firestore
    const sessionCb = docListeners.get('classes/CLASS_TEST/screenBroadcast/session');
    expect(sessionCb).toBeDefined();

    act(() => {
      sessionCb({
        exists: () => true,
        data: () => ({ isBroadcasting: true, teacherUid: 'teacher_123', hasAudio: true }),
      });
    });

    expect(result.current.isBroadcastActive).toBe(true);

    // Student joins broadcast
    await act(async () => {
      await result.current.joinBroadcast();
    });

    expect(result.current.isViewing).toBe(true);
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcastViewers/student_456' }),
      expect.objectContaining({ status: 'requesting', studentUid: 'student_456' })
    );

    // Simulate teacher sending offer
    const viewerCb = docListeners.get('classes/CLASS_TEST/screenBroadcastViewers/student_456');
    expect(viewerCb).toBeDefined();

    await act(async () => {
      viewerCb({
        exists: () => true,
        data: () => ({
          status: 'offered',
          offer: { type: 'offer', sdp: 'v=0...' },
          teacherCandidates: [{ candidate: 'cand1', sdpMid: '0', sdpMLineIndex: 0 }],
        }),
      });
    });

    expect(mockPeerConnection.setRemoteDescription).toHaveBeenCalled();
    expect(mockPeerConnection.createAnswer).toHaveBeenCalled();
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcastViewers/student_456' }),
      expect.objectContaining({ status: 'answered' })
    );

    // Toggle mute
    act(() => {
      result.current.toggleAudioMute();
    });
    expect(result.current.isAudioMuted).toBe(true);

    // Leave broadcast
    await act(async () => {
      await result.current.leaveBroadcast();
    });

    expect(result.current.isViewing).toBe(false);
    expect(mockDeleteDoc).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'classes/CLASS_TEST/screenBroadcastViewers/student_456' })
    );
  });

  it('applies student candidates and answers received on viewers collection', async () => {
    mockPeerConnection.remoteDescription = { type: 'answer' };
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

    const viewersCb = collectionListeners.get('classes/CLASS_TEST/screenBroadcastViewers');
    expect(viewersCb).toBeDefined();

    // 1. Initial request from student to register peer connection
    await act(async () => {
      const mockRequestedDocs = [
        {
          id: 'student_789',
          data: () => ({
            status: 'requesting',
            email: 'student789@school.edu',
          }),
        },
      ];
      viewersCb({
        docs: mockRequestedDocs,
        forEach: (fn) => mockRequestedDocs.forEach(fn),
      });
    });

    // 2. Student replies with answer and candidate while remoteDescription is set
    await act(async () => {
      const mockDocs = [
        {
          id: 'student_789',
          data: () => ({
            status: 'answered',
            email: 'student789@school.edu',
            answer: { type: 'answer', sdp: 'v=0...' },
            studentCandidates: [{ candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 50000 typ host', sdpMid: '0', sdpMLineIndex: 0 }],
          }),
        },
      ];
      viewersCb({
        docs: mockDocs,
        forEach: (fn) => mockDocs.forEach(fn),
      });
    });

    expect(mockPeerConnection.addIceCandidate).toHaveBeenCalled();
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
});

