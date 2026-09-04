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
 * Student-side WebRTC hook for receiving live teacher screen broadcast.
 * Automatically monitors broadcast session status and establishes WebRTC peer connection
 * when the student joins the live view.
 */
export default function useTeacherScreenBroadcastStudent({ classId, studentUid, studentEmail }) {
  const [isBroadcastActive, setIsBroadcastActive] = useState(false);
  const [broadcastInfo, setBroadcastInfo] = useState(null);
  const [isViewing, setIsViewing] = useState(false);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('idle'); // 'idle' | 'connecting' | 'connected' | 'failed' | 'closed'
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [hasAudio, setHasAudio] = useState(false);
  const [error, setError] = useState(null);

  const peerConnectionRef = useRef(null);
  const unsubscribeViewerRef = useRef(null);
  const remoteStreamRef = useRef(null);

  // 1. Listen to active broadcast session status in Firestore
  useEffect(() => {
    if (!classId) return;

    const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
    const unsubscribeSession = onSnapshot(sessionDocRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const active = Boolean(data.isBroadcasting);
        setIsBroadcastActive(active);
        setBroadcastInfo(active ? data : null);
        if (!active && isViewing) {
          leaveBroadcast();
        }
      } else {
        setIsBroadcastActive(false);
        setBroadcastInfo(null);
        if (isViewing) {
          leaveBroadcast();
        }
      }
    });

    return () => {
      unsubscribeSession();
    };
  }, [classId, isViewing]);

  // Clean up WebRTC connection and viewer record
  const leaveBroadcast = useCallback(async () => {
    if (unsubscribeViewerRef.current) {
      unsubscribeViewerRef.current();
      unsubscribeViewerRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('[Student Screen Broadcast] Error closing peer connection:', err);
      }
      peerConnectionRef.current = null;
    }

    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
      remoteStreamRef.current = null;
    }

    if (classId && studentUid) {
      try {
        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
        await deleteDoc(viewerDocRef);
      } catch {
        // Ignore deletion errors on exit
      }
    }

    setIsViewing(false);
    setRemoteStream(null);
    setConnectionState('idle');
    setHasAudio(false);
  }, [classId, studentUid]);

  // Join the teacher's live screen broadcast
  const joinBroadcast = useCallback(async () => {
    if (!classId || !studentUid) return;

    setError(null);
    setConnectionState('connecting');
    setIsViewing(true);

    try {
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }

      const pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
      peerConnectionRef.current = pc;

      const stream = new MediaStream();
      remoteStreamRef.current = stream;
      setRemoteStream(stream);

      // Handle incoming screen / audio tracks from teacher
      pc.ontrack = (event) => {
        const track = event.track;
        if (event.streams?.[0]) {
          event.streams[0].getTracks?.().forEach((t) => {
            if (!stream.getTracks().some((existing) => existing.id === t.id)) {
              stream.addTrack(t);
            }
          });
        } else if (track) {
          stream.addTrack(track);
        }

        if (track.kind === 'audio') {
          setHasAudio(true);
        }
        setRemoteStream(new MediaStream(stream.getTracks()));
      };

      pc.onicecandidate = (event) => {
        if (event.candidate && classId && studentUid) {
          const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
          updateDoc(viewerDocRef, {
            studentCandidates: arrayUnion(event.candidate.toJSON()),
          }).catch(() => {});
        }
      };

      const updateStudentConnectionState = () => {
        const s = pc.connectionState;
        const ice = pc.iceConnectionState;
        if (s === 'connected' || ice === 'connected' || ice === 'completed') {
          setConnectionState('connected');
          setError(null);
        } else if (s === 'failed' || ice === 'failed') {
          setConnectionState('failed');
          setError('WebRTC connection to teacher screen failed.');
        } else if (s === 'connecting' || ice === 'checking') {
          setConnectionState('connecting');
        }
      };

      pc.onconnectionstatechange = updateStudentConnectionState;
      pc.oniceconnectionstatechange = updateStudentConnectionState;

      // Register viewer in Firestore
      const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
      await setDoc(viewerDocRef, {
        studentUid,
        studentEmail: studentEmail || 'Student',
        status: 'requesting',
        joinedAt: serverTimestamp(),
      });

      // Listen for teacher's SDP Offer and ICE Candidates
      let hasAnswered = false;
      unsubscribeViewerRef.current = onSnapshot(viewerDocRef, async (snap) => {
        if (!snap.exists()) return;
        const data = snap.data();

        if (data.status === 'offered' && data.offer && !hasAnswered && pc.signalingState !== 'closed') {
          try {
            hasAnswered = true;
            const offerDesc = new (window.RTCSessionDescription || window.webkitRTCSessionDescription)(data.offer);
            await pc.setRemoteDescription(offerDesc);

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            await updateDoc(viewerDocRef, {
              status: 'answered',
              answer: { type: answer.type, sdp: answer.sdp },
              updatedAt: serverTimestamp(),
            });
          } catch (err) {
            console.error('[Student Screen Broadcast] Error answering offer:', err);
            setError('Failed to establish video connection with teacher.');
          }
        }

        // Continuously apply incoming teacher ICE candidates
        if (pc.remoteDescription && Array.isArray(data.teacherCandidates)) {
          for (const cand of data.teacherCandidates) {
            if (cand && cand.candidate) {
              try {
                pc.addIceCandidate(new (window.RTCIceCandidate || window.webkitRTCIceCandidate)(cand)).catch(() => {});
              } catch {}
            }
          }
        }
      });
    } catch (err) {
      console.error('[Student Screen Broadcast] Error joining broadcast:', err);
      setError(err.message || 'Failed to join screen broadcast.');
      setConnectionState('failed');
    }
  }, [classId, studentUid, studentEmail]);

  // Toggle local mute on incoming audio
  const toggleAudioMute = useCallback(() => {
    if (remoteStreamRef.current) {
      const audioTracks = remoteStreamRef.current.getAudioTracks();
      const nextMuted = !isAudioMuted;
      audioTracks.forEach((t) => {
        t.enabled = !nextMuted;
      });
      setIsAudioMuted(nextMuted);
    }
  }, [isAudioMuted]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      leaveBroadcast();
    };
  }, [leaveBroadcast]);

  return {
    isBroadcastActive,
    broadcastInfo,
    isViewing,
    remoteStream,
    connectionState,
    hasAudio,
    isAudioMuted,
    error,
    joinBroadcast,
    leaveBroadcast,
    toggleAudioMute,
  };
}
