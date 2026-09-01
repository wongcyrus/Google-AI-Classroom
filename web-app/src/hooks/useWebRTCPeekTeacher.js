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
  const [screenStream, setScreenStream] = useState(null);
  const [webcamStream, setWebcamStream] = useState(null);
  const [remoteAudioStream, setRemoteAudioStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isTalkbackActive, setIsTalkbackActive] = useState(false);
  const [error, setError] = useState(null);

  const peerConnectionRef = useRef(null);
  const unsubscribeSnapshotRef = useRef(null);
  const talkbackStreamRef = useRef(null);
  const talkbackSenderRef = useRef(null);
  const audioTransceiverRef = useRef(null);
  const streamMetadataRef = useRef(null);

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
    audioTransceiverRef.current = null;
    streamMetadataRef.current = null;

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
    setScreenStream(null);
    setWebcamStream(null);
    setRemoteAudioStream(null);
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

      // Handle incoming tracks from student (screen, webcam, audio)
      pc.ontrack = (event) => {
        const track = event.track;
        const stream = event.streams?.[0] || new MediaStream([track]);

        if (event.streams?.[0]) {
          event.streams[0].getTracks?.().forEach((t) => {
            newRemoteStream.addTrack(t);
          });
        }
        if (track) {
          newRemoteStream.addTrack(track);
        }

        if (track?.kind === 'video') {
          const meta = streamMetadataRef.current;
          if (meta?.screenStreamId && (stream.id === meta.screenStreamId || track.id === meta.screenStreamId)) {
            setScreenStream(stream);
          } else if (meta?.webcamStreamId && (stream.id === meta.webcamStreamId || track.id === meta.webcamStreamId)) {
            setWebcamStream(stream);
          } else {
            // Assign first video stream to screen/primary, second to webcam
            setScreenStream((prevScreen) => {
              if (!prevScreen) {
                return stream;
              } else if (prevScreen.id !== stream.id) {
                setWebcamStream(stream);
              }
              return prevScreen;
            });
          }
        } else if (track?.kind === 'audio') {
          console.log('[Teacher WebRTC Audio] Received student remote audio track:', track.id, track.label, 'enabled:', track.enabled, 'readyState:', track.readyState);
          setRemoteAudioStream(stream);
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

      // Add transceivers: 2 video transceivers for Dual View (Screen & Webcam), sendrecv for 2-way talkback audio
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('video', { direction: 'recvonly' });
      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      audioTransceiverRef.current = audioTransceiver;

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

        if (data.streamMetadata) {
          streamMetadataRef.current = data.streamMetadata;
        }

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
      if (audioTransceiverRef.current && audioTransceiverRef.current.sender) {
        try {
          await audioTransceiverRef.current.sender.replaceTrack(null);
        } catch {}
      } else if (talkbackSenderRef.current) {
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

      if (audioTransceiverRef.current && audioTransceiverRef.current.sender) {
        await audioTransceiverRef.current.sender.replaceTrack(audioTrack);
      } else if (talkbackSenderRef.current) {
        await talkbackSenderRef.current.replaceTrack(audioTrack);
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
    screenStream,
    webcamStream,
    remoteAudioStream,
    isTalkbackActive,
    error,
    startPeek,
    stopPeek,
    toggleTalkback,
  };
}
