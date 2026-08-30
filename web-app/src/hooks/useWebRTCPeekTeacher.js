import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, updateDoc, deleteDoc, serverTimestamp, arrayUnion } from 'firebase/firestore';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Teacher-side WebRTC hook for 1-to-1 live peeking.
 * Creates an SDP offer, exchanges ICE candidates via Firestore,
 * and receives the student's live video and audio feed.
 */
export default function useWebRTCPeekTeacher({ classId, studentUid, teacherUid }) {
  const [isPeeking, setIsPeeking] = useState(false);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'failed' | 'closed'
  const [remoteStream, setRemoteStream] = useState(null);
  const [isTalkbackActive, setIsTalkbackActive] = useState(false);
  const [error, setError] = useState(null);

  const peerConnectionRef = useRef(null);
  const unsubscribeSnapshotRef = useRef(null);
  const talkbackStreamRef = useRef(null);
  const talkbackSenderRef = useRef(null);

  // Clean up WebRTC connection and talkback tracks
  const cleanup = useCallback(async () => {
    if (unsubscribeSnapshotRef.current) {
      unsubscribeSnapshotRef.current();
      unsubscribeSnapshotRef.current = null;
    }

    if (talkbackStreamRef.current) {
      talkbackStreamRef.current.getTracks().forEach(t => t.stop());
      talkbackStreamRef.current = null;
    }
    talkbackSenderRef.current = null;

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (classId && studentUid) {
      try {
        const peekDocRef = doc(db, `classes/${classId}/livePeeks/${studentUid}`);
        await deleteDoc(peekDocRef);
      } catch {
        // Ignore deletion error on unmount
      }
    }

    setIsPeeking(false);
    setConnectionState('idle');
    setRemoteStream(null);
    setIsTalkbackActive(false);
  }, [classId, studentUid]);

  const startPeek = useCallback(async () => {
    if (!classId || !studentUid) return;
    setError(null);
    setConnectionState('connecting');
    setIsPeeking(true);

    try {
      const pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
      peerConnectionRef.current = pc;

      const newRemoteStream = new MediaStream();
      setRemoteStream(newRemoteStream);

      // Handle incoming tracks from student
      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          newRemoteStream.addTrack(track);
        });
        if (event.track) {
          newRemoteStream.addTrack(event.track);
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setConnectionState('connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setConnectionState('failed');
        } else if (pc.connectionState === 'closed') {
          setConnectionState('closed');
        }
      };

      const peekDocRef = doc(db, `classes/${classId}/livePeeks/${studentUid}`);

      // Handle ICE candidates from teacher
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          updateDoc(peekDocRef, {
            teacherCandidates: arrayUnion(event.candidate.toJSON()),
          }).catch(() => {});
        }
      };

      // Add transceivers to receive both video and audio
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Write offer to Firestore
      await setDoc(peekDocRef, {
        offer: { type: offer.type, sdp: offer.sdp },
        status: 'offered',
        teacherUid: teacherUid || '',
        createdAt: serverTimestamp(),
        teacherCandidates: [],
        studentCandidates: [],
      });

      // Listen for student's answer & ICE candidates
      let hasSetRemote = false;
      const unsubscribe = onSnapshot(peekDocRef, async (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();

        if (data.answer && !hasSetRemote && pc.signalingState !== 'closed') {
          hasSetRemote = true;
          const remoteDesc = new RTCSessionDescription(data.answer);
          await pc.setRemoteDescription(remoteDesc);
        }

        if (data.studentCandidates && Array.isArray(data.studentCandidates)) {
          for (const cand of data.studentCandidates) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch {
              // Ignore duplicate/invalid candidate
            }
          }
        }

        if (data.status === 'rejected' || data.status === 'closed') {
          cleanup();
        }
      });

      unsubscribeSnapshotRef.current = unsubscribe;
    } catch (err) {
      console.error('WebRTC Start Peek Error:', err);
      setError(err.message || 'Failed to start live peek');
      setConnectionState('failed');
      cleanup();
    }
  }, [classId, studentUid, teacherUid, cleanup]);

  // Toggle 2-way voice talkback (Teacher speaks to student)
  const toggleTalkback = useCallback(async (enable, micDeviceId = '') => {
    const pc = peerConnectionRef.current;
    if (!pc) return;

    if (!enable) {
      if (talkbackStreamRef.current) {
        talkbackStreamRef.current.getTracks().forEach(t => t.stop());
        talkbackStreamRef.current = null;
      }
      if (talkbackSenderRef.current) {
        try {
          pc.removeTrack(talkbackSenderRef.current);
        } catch {}
        talkbackSenderRef.current = null;
      }
      setIsTalkbackActive(false);
      return;
    }

    try {
      const constraints = {
        audio: micDeviceId ? { deviceId: { exact: micDeviceId } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      talkbackStreamRef.current = stream;
      const audioTrack = stream.getAudioTracks()[0];

      if (talkbackSenderRef.current) {
        talkbackSenderRef.current.replaceTrack(audioTrack);
      } else {
        talkbackSenderRef.current = pc.addTrack(audioTrack, stream);
      }
      setIsTalkbackActive(true);
    } catch (err) {
      console.error('Failed to enable teacher talkback:', err);
      setIsTalkbackActive(false);
    }
  }, []);

  const stopPeek = useCallback(async () => {
    await cleanup();
  }, [cleanup]);

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    isPeeking,
    connectionState,
    remoteStream,
    isTalkbackActive,
    error,
    startPeek,
    stopPeek,
    toggleTalkback,
  };
}
