import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, updateDoc, deleteDoc, serverTimestamp, arrayUnion, collection } from 'firebase/firestore';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Teacher-side WebRTC hook for 1-to-Many live screen broadcasting to students.
 * Manages the screen capture stream and peer connections for all connected student viewers.
 */
export default function useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [error, setError] = useState(null);

  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map<studentUid, RTCPeerConnection>
  const viewerSubscribersRef = useRef(new Map()); // Map<studentUid, unsubscribeFn>
  const unsubscribeViewersCollectionRef = useRef(null);
  const isStoppingRef = useRef(false);

  // Clean up all peer connections, listeners, and Firestore broadcast records
  const stopBroadcast = useCallback(async () => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;

    // 1. Unsubscribe collection listener
    if (unsubscribeViewersCollectionRef.current) {
      unsubscribeViewersCollectionRef.current();
      unsubscribeViewersCollectionRef.current = null;
    }

    // 2. Unsubscribe individual viewer listeners
    viewerSubscribersRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error unsubscribing viewer listener:', err);
      }
    });
    viewerSubscribersRef.current.clear();

    // 3. Close all RTCPeerConnections
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error closing peer connection:', err);
      }
    });
    peerConnectionsRef.current.clear();

    // 4. Stop all screen media tracks
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (err) {
          console.warn('[Teacher Screen Broadcast] Error stopping track:', err);
        }
      });
      screenStreamRef.current = null;
    }

    // 5. Update Firestore session doc
    if (classId) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        await setDoc(sessionDocRef, {
          isBroadcasting: false,
          teacherUid: teacherUid || null,
          endedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error updating session doc on stop:', err);
      }
    }

    setIsBroadcasting(false);
    setScreenStream(null);
    setHasAudio(false);
    setViewers([]);
    isStoppingRef.current = false;
  }, [classId, teacherUid]);

  // Handle a new student viewer connection request
  const handleStudentViewer = useCallback(async (studentUid, viewerData) => {
    if (!screenStreamRef.current || isStoppingRef.current) return;

    let pc = peerConnectionsRef.current.get(studentUid);
    
    // If student is requesting a new connection, reset any old PC
    if (viewerData.status === 'requesting') {
      if (pc) {
        try {
          pc.close();
        } catch {}
        peerConnectionsRef.current.delete(studentUid);
      }

      pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
      peerConnectionsRef.current.set(studentUid, pc);

      // Attach current screen stream tracks
      const tracks = screenStreamRef.current.getTracks();
      tracks.forEach((track) => {
        pc.addTrack(track, screenStreamRef.current);
      });

      // Handle ICE candidates from Teacher to Student
      pc.onicecandidate = (event) => {
        if (event.candidate && classId && studentUid) {
          const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
          updateDoc(viewerDocRef, {
            teacherCandidates: arrayUnion(event.candidate.toJSON()),
          }).catch(() => {});
        }
      };

      const updateConnectionState = () => {
        const s = pc.connectionState;
        const ice = pc.iceConnectionState;
        const finalState = (s === 'connected' || ice === 'connected' || ice === 'completed') ? 'connected' : s;
        setViewers((prev) =>
          prev.map((v) => (v.studentUid === studentUid ? { ...v, connectionState: finalState } : v))
        );
      };

      pc.onconnectionstatechange = updateConnectionState;
      pc.oniceconnectionstatechange = updateConnectionState;

      // Create and set local SDP Offer
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
        await updateDoc(viewerDocRef, {
          status: 'offered',
          offer: { type: offer.type, sdp: offer.sdp },
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error(`[Teacher Screen Broadcast] Failed to create offer for student ${studentUid}:`, err);
      }
    }
  }, [classId]);

  // Start live screen broadcast
  const startBroadcast = useCallback(async (options = { audio: true }) => {
    if (!classId) {
      setError('Class ID is required to start broadcasting');
      return;
    }

    setError(null);
    try {
      if (!navigator.mediaDevices?.getDisplayMedia) {
        throw new Error('Screen sharing is not supported in this browser environment.');
      }

      // Request screen stream from teacher
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          frameRate: { ideal: 30, max: 30 },
        },
        audio: options.audio !== false,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      const audioTracks = stream.getAudioTracks();
      const hasSystemAudio = audioTracks.length > 0;
      setHasAudio(hasSystemAudio);

      // Listen for when teacher stops sharing via browser's native UI
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('[Teacher Screen Broadcast] Native screen track ended. Stopping broadcast.');
          stopBroadcast();
        };
      }

      // Initialize session document in Firestore
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      await setDoc(sessionDocRef, {
        isBroadcasting: true,
        teacherUid: teacherUid || null,
        teacherEmail: teacherEmail || null,
        hasAudio: hasSystemAudio,
        startedAt: serverTimestamp(),
        endedAt: null,
      });

      setIsBroadcasting(true);

      // Listen for student viewer requests
      const viewersCollectionRef = collection(db, `classes/${classId}/screenBroadcastViewers`);
      unsubscribeViewersCollectionRef.current = onSnapshot(viewersCollectionRef, (snapshot) => {
        const currentViewers = [];
        snapshot.forEach((docSnap) => {
          const vData = docSnap.data();
          const studentUid = docSnap.id;
          const pc = peerConnectionsRef.current.get(studentUid);
          const currentIce = pc?.iceConnectionState;
          const currentConn = pc?.connectionState;
          const isConn = currentConn === 'connected' || currentIce === 'connected' || currentIce === 'completed';

          currentViewers.push({
            studentUid,
            studentEmail: vData.studentEmail || 'Student',
            status: vData.status,
            connectionState: isConn ? 'connected' : (currentConn || 'connecting'),
            joinedAt: vData.joinedAt,
          });

          // If student requested connection
          if (vData.status === 'requesting') {
            handleStudentViewer(studentUid, vData);
          }

          // If student replied with answer
          if (vData.status === 'answered' && vData.answer && pc && pc.signalingState === 'have-local-offer') {
            (async () => {
              try {
                const desc = new (window.RTCSessionDescription || window.webkitRTCSessionDescription)(vData.answer);
                await pc.setRemoteDescription(desc);
              } catch (err) {
                console.warn(`[Teacher Screen Broadcast] Error applying answer from student ${studentUid}:`, err);
              }
            })();
          }

          // Continuously process any student ICE candidates
          if (pc && pc.remoteDescription && Array.isArray(vData.studentCandidates)) {
            for (const cand of vData.studentCandidates) {
              if (cand && cand.candidate) {
                try {
                  pc.addIceCandidate(new (window.RTCIceCandidate || window.webkitRTCIceCandidate)(cand)).catch(() => {});
                } catch {}
              }
            }
          }
        });

        setViewers(currentViewers);
      });
    } catch (err) {
      console.error('[Teacher Screen Broadcast] Failed to start broadcast:', err);
      setError(err.message || 'Failed to start screen broadcast.');
      await stopBroadcast();
    }
  }, [classId, teacherUid, teacherEmail, handleStudentViewer, stopBroadcast]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopBroadcast();
    };
  }, [stopBroadcast]);

  return {
    isBroadcasting,
    screenStream,
    hasAudio,
    viewers,
    viewerCount: viewers.length,
    error,
    startBroadcast,
    stopBroadcast,
  };
}
