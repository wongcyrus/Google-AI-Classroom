import { useState, useRef, useCallback, useEffect } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc, onSnapshot, updateDoc, serverTimestamp, arrayUnion, collection } from 'firebase/firestore';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Maximum simultaneous active WebRTC peer connections to prevent hardware encoder exhaustion and high CPU/memory hanging
export const MAX_ACTIVE_VIEWERS = 6;
// Clamped encoding settings: 350 kbps max bitrate, 12 fps, text/slides detail hint
export const MAX_VIDEO_BITRATE_BPS = 350000;
export const MAX_VIDEO_FPS = 12;

/**
 * Teacher-side WebRTC hook for live screen broadcasting to students.
 * Manages the screen capture stream and peer connections for connected student viewers,
 * enforcing hardware encoder limits (max 6 active viewers), bitrate clamping, and candidate deduplication.
 */
export default function useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [error, setError] = useState(null);

  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map<studentUid, RTCPeerConnection>
  const processedCandidatesRef = useRef(new Map()); // Map<studentUid, Set<string>>
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

    // 3. Close all RTCPeerConnections and clear candidate caches
    peerConnectionsRef.current.forEach((pc) => {
      try {
        pc.close();
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error closing peer connection:', err);
      }
    });
    peerConnectionsRef.current.clear();
    processedCandidatesRef.current.clear();

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

  // Handle a student viewer connection request with admission control
  const handleStudentViewer = useCallback(async (studentUid, viewerData) => {
    if (!screenStreamRef.current || isStoppingRef.current) return;

    let pc = peerConnectionsRef.current.get(studentUid);

    // Admission control: count currently active connections
    const activeViewersCount = Array.from(peerConnectionsRef.current.values()).filter((p) => {
      const s = p.connectionState;
      const ice = p.iceConnectionState;
      return s === 'connected' || s === 'connecting' || ice === 'connected' || ice === 'checking';
    }).length;

    // If new connection request and capacity reached, mark student as queued
    if (!peerConnectionsRef.current.has(studentUid) && activeViewersCount >= MAX_ACTIVE_VIEWERS) {
      if (classId && studentUid) {
        try {
          const viewerDocRef = doc(db, `classes/${classId}/screenBroadcastViewers/${studentUid}`);
          await updateDoc(viewerDocRef, {
            status: 'queued',
            queueMessage: `Teacher screen broadcast is currently at full capacity (${MAX_ACTIVE_VIEWERS} active viewers). Please wait...`,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          console.warn(`[Teacher Screen Broadcast] Error setting queued status for student ${studentUid}:`, err);
        }
      }
      return;
    }

    // If student is requesting a new connection, reset any old PC
    if (viewerData.status === 'requesting') {
      if (pc) {
        try {
          pc.close();
        } catch {}
        peerConnectionsRef.current.delete(studentUid);
        processedCandidatesRef.current.delete(studentUid);
      }

      pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
      peerConnectionsRef.current.set(studentUid, pc);
      processedCandidatesRef.current.set(studentUid, new Set());

      // Attach current screen stream tracks and clamp encoding parameters
      const tracks = screenStreamRef.current.getTracks();
      tracks.forEach((track) => {
        const sender = pc.addTrack(track, screenStreamRef.current);
        if (track.kind === 'video' && sender && sender.getParameters && sender.setParameters) {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE_BPS;
            params.encodings[0].maxFramerate = MAX_VIDEO_FPS;
            params.degradationPreference = 'maintain-resolution';
            sender.setParameters(params).catch(() => {});
          } catch {}
        }
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

      // Request screen stream from teacher with clamped resolution & framerate
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          width: { max: 1280 },
          height: { max: 720 },
          frameRate: { ideal: 10, max: MAX_VIDEO_FPS },
        },
        audio: options.audio !== false,
      });

      screenStreamRef.current = stream;
      setScreenStream(stream);
      const audioTracks = stream.getAudioTracks();
      const hasSystemAudio = audioTracks.length > 0;
      setHasAudio(hasSystemAudio);

      // Instruct video encoder to optimize for crisp detail/text with lower CPU overhead
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        if ('contentHint' in videoTrack) {
          try {
            videoTrack.contentHint = 'detail';
          } catch {}
        }
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
        const currentUidsInDoc = new Set();

        snapshot.forEach((docSnap) => {
          const vData = docSnap.data();
          const studentUid = docSnap.id;
          currentUidsInDoc.add(studentUid);

          const pc = peerConnectionsRef.current.get(studentUid);
          const currentIce = pc?.iceConnectionState;
          const currentConn = pc?.connectionState;
          const isConn = currentConn === 'connected' || currentIce === 'connected' || currentIce === 'completed';

          const connectionState = vData.status === 'queued'
            ? 'queued'
            : isConn
            ? 'connected'
            : (currentConn || 'connecting');

          currentViewers.push({
            studentUid,
            studentEmail: vData.studentEmail || 'Student',
            status: vData.status,
            connectionState,
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

          // Process deduplicated student ICE candidates
          if (pc && pc.remoteDescription && Array.isArray(vData.studentCandidates)) {
            let processedSet = processedCandidatesRef.current.get(studentUid);
            if (!processedSet) {
              processedSet = new Set();
              processedCandidatesRef.current.set(studentUid, processedSet);
            }

            for (const cand of vData.studentCandidates) {
              if (cand && cand.candidate) {
                const candKey = `${cand.candidate}_${cand.sdpMid}_${cand.sdpMLineIndex}`;
                if (!processedSet.has(candKey)) {
                  processedSet.add(candKey);
                  try {
                    pc.addIceCandidate(new (window.RTCIceCandidate || window.webkitRTCIceCandidate)(cand)).catch(() => {});
                  } catch {}
                }
              }
            }
          }
        });

        // Clean up peer connections for students that departed
        for (const [studentUid, pc] of peerConnectionsRef.current.entries()) {
          if (!currentUidsInDoc.has(studentUid)) {
            try {
              pc.close();
            } catch {}
            peerConnectionsRef.current.delete(studentUid);
            processedCandidatesRef.current.delete(studentUid);
          }
        }

        // Auto-admit queued students if active viewer slots freed up
        const activeCount = Array.from(peerConnectionsRef.current.values()).filter((p) => {
          const s = p.connectionState;
          const ice = p.iceConnectionState;
          return s === 'connected' || s === 'connecting' || ice === 'connected' || ice === 'checking';
        }).length;

        if (activeCount < MAX_ACTIVE_VIEWERS) {
          const queuedViewer = currentViewers.find((v) => v.status === 'queued' && !peerConnectionsRef.current.has(v.studentUid));
          if (queuedViewer) {
            handleStudentViewer(queuedViewer.studentUid, { ...queuedViewer, status: 'requesting' });
          }
        }

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

  const activeViewerCount = viewers.filter((v) => v.connectionState === 'connected' || v.connectionState === 'connecting').length;
  const queuedViewerCount = viewers.filter((v) => v.status === 'queued').length;

  return {
    isBroadcasting,
    screenStream,
    hasAudio,
    viewers,
    viewerCount: viewers.length,
    activeViewerCount,
    queuedViewerCount,
    maxActiveViewers: MAX_ACTIVE_VIEWERS,
    error,
    startBroadcast,
    stopBroadcast,
  };
}
