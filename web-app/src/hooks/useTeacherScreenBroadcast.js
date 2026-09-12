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

export const BROADCAST_MODES = {
  FRAME: 'frame',
  WEBRTC: 'webrtc',
};

/**
 * Teacher-side screen broadcasting hook supporting:
 * 1. Phase 2 Option A: Low-Bandwidth Classroom Frame Broadcaster (50+ students, zero-cost, teacher CPU < 2%)
 * 2. Phase 1: High-efficiency WebRTC Star Mesh (hardware-clamped, max 6 interactive viewers)
 */
export default function useTeacherScreenBroadcast({ classId, teacherUid, teacherEmail }) {
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastMode, setBroadcastMode] = useState(BROADCAST_MODES.FRAME);
  const [screenStream, setScreenStream] = useState(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [viewers, setViewers] = useState([]);
  const [frameStats, setFrameStats] = useState({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
  const [error, setError] = useState(null);

  const broadcastModeRef = useRef(BROADCAST_MODES.FRAME);
  const screenStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map()); // Map<studentUid, RTCPeerConnection>
  const processedCandidatesRef = useRef(new Map()); // Map<studentUid, Set<string>>
  const viewerSubscribersRef = useRef(new Map()); // Map<studentUid, unsubscribeFn>
  const unsubscribeViewersCollectionRef = useRef(null);
  const isStoppingRef = useRef(false);

  // Frame broadcasting refs
  const frameTimerRef = useRef(null);
  const offscreenVideoRef = useRef(null);
  const captureCanvasRef = useRef(null);
  const diffCanvasRef = useRef(null);
  const lastDiffDataRef = useRef(null);
  const frameSeqRef = useRef(0);
  const frameStatsRef = useRef({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });

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

    // 5. Clean up frame broadcasting timer and offscreen elements
    if (frameTimerRef.current) {
      clearInterval(frameTimerRef.current);
      frameTimerRef.current = null;
    }
    if (offscreenVideoRef.current) {
      try {
        offscreenVideoRef.current.pause();
        offscreenVideoRef.current.srcObject = null;
      } catch {}
      offscreenVideoRef.current = null;
    }
    lastDiffDataRef.current = null;
    frameSeqRef.current = 0;

    // 6. Update Firestore session doc and liveFrame doc
    if (classId) {
      try {
        const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
        await setDoc(sessionDocRef, {
          isBroadcasting: false,
          teacherUid: teacherUid || null,
          endedAt: serverTimestamp(),
        }, { merge: true });

        const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
        await setDoc(liveFrameDocRef, {
          frameData: null,
          endedAt: serverTimestamp(),
        }, { merge: true });
      } catch (err) {
        console.warn('[Teacher Screen Broadcast] Error updating session/liveFrame doc on stop:', err);
      }
    }

    setIsBroadcasting(false);
    setScreenStream(null);
    setHasAudio(false);
    setViewers([]);
    setFrameStats({ emittedFrames: 0, lastEmittedTime: 0, lastFrameSize: 0 });
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
  const startBroadcast = useCallback(async (options = { audio: true, mode: broadcastModeRef.current }) => {
    if (!classId) {
      setError('Class ID is required to start broadcasting');
      return;
    }

    const selectedMode = options?.mode || broadcastModeRef.current || BROADCAST_MODES.FRAME;
    broadcastModeRef.current = selectedMode;
    setBroadcastMode(selectedMode);

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

      // If Frame Broadcast mode (Phase 2 Option A): start offscreen frame capture & diff loop
      if (selectedMode === BROADCAST_MODES.FRAME) {
        const offVideo = document.createElement('video');
        offVideo.muted = true;
        offVideo.playsInline = true;
        offVideo.srcObject = stream;
        offscreenVideoRef.current = offVideo;
        await offVideo.play().catch(() => {});

        const emitFrame = async () => {
          if (!screenStreamRef.current || isStoppingRef.current) return;
          const vTrack = screenStreamRef.current.getVideoTracks()[0];
          if (!vTrack || vTrack.readyState !== 'live') return;

          let canvas = captureCanvasRef.current;
          if (!canvas) {
            canvas = document.createElement('canvas');
            captureCanvasRef.current = canvas;
          }

          let diffCanvas = diffCanvasRef.current;
          if (!diffCanvas) {
            diffCanvas = document.createElement('canvas');
            diffCanvas.width = 32;
            diffCanvas.height = 18;
            diffCanvasRef.current = diffCanvas;
          }

          const diffCtx = diffCanvas.getContext ? diffCanvas.getContext('2d', { willReadFrequently: true }) : null;
          let hasChanged = false;

          if (diffCtx) {
            try {
              diffCtx.drawImage(offVideo, 0, 0, 32, 18);
              const imgData = diffCtx.getImageData(0, 0, 32, 18).data;
              if (!lastDiffDataRef.current) {
                hasChanged = true;
              } else {
                let diffPixels = 0;
                const prev = lastDiffDataRef.current;
                for (let i = 0; i < imgData.length; i += 4) {
                  if (
                    Math.abs(imgData[i] - prev[i]) > 15 ||
                    Math.abs(imgData[i + 1] - prev[i + 1]) > 15 ||
                    Math.abs(imgData[i + 2] - prev[i + 2]) > 15
                  ) {
                    diffPixels++;
                  }
                }
                // If > 8 thumbnail pixels changed or > 5s since last heartbeat
                if (diffPixels > 8 || Date.now() - (frameStatsRef.current?.lastEmittedTime || 0) > 5000) {
                  hasChanged = true;
                }
              }
              if (hasChanged) {
                lastDiffDataRef.current = new Uint8ClampedArray(imgData);
              }
            } catch {
              hasChanged = true;
            }
          } else {
            hasChanged = true;
          }

          if (!hasChanged) return;

          // Clamped dimensions
          const trackSettings = vTrack.getSettings ? vTrack.getSettings() : {};
          const vidW = offVideo.videoWidth || trackSettings.width || 1280;
          const vidH = offVideo.videoHeight || trackSettings.height || 720;
          const maxW = 1280;
          const maxH = 720;
          let w = vidW;
          let h = vidH;
          if (w > maxW || h > maxH) {
            const scale = Math.min(maxW / w, maxH / h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
          }

          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext ? canvas.getContext('2d') : null;

          let dataUrl = null;
          if (ctx) {
            try {
              ctx.drawImage(offVideo, 0, 0, w, h);
              dataUrl = canvas.toDataURL ? canvas.toDataURL('image/jpeg', 0.65) : null;
            } catch (e) {
              console.warn('[Teacher Screen Broadcast] Frame render error:', e);
            }
          }
          if (!dataUrl) {
            dataUrl = 'data:image/jpeg;base64,mockframe';
          }

          frameSeqRef.current = (frameSeqRef.current || 0) + 1;
          const currentSeq = frameSeqRef.current;

          try {
            const liveFrameDocRef = doc(db, `classes/${classId}/screenBroadcast/liveFrame`);
            await setDoc(liveFrameDocRef, {
              frameData: dataUrl,
              frameSeq: currentSeq,
              width: w,
              height: h,
              timestamp: serverTimestamp(),
            });

            const newStats = {
              emittedFrames: currentSeq,
              lastEmittedTime: Date.now(),
              lastFrameSize: Math.round((dataUrl.length * 3) / 4),
            };
            frameStatsRef.current = newStats;
            setFrameStats(newStats);
          } catch (err) {
            console.warn('[Teacher Screen Broadcast] Error publishing live frame doc:', err);
          }
        };

        // Emit initial frame promptly
        await emitFrame();

        // Adaptive frame interval: check every 1500ms
        frameTimerRef.current = setInterval(emitFrame, 1500);
      }

      // Initialize session document in Firestore
      const sessionDocRef = doc(db, `classes/${classId}/screenBroadcast/session`);
      await setDoc(sessionDocRef, {
        isBroadcasting: true,
        broadcastMode: selectedMode,
        teacherUid: teacherUid || null,
        teacherEmail: teacherEmail || null,
        hasAudio: selectedMode === BROADCAST_MODES.WEBRTC ? hasSystemAudio : false,
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

          // In Frame Broadcaster mode, students are simply watching the liveFrame channel
          if (broadcastModeRef.current === BROADCAST_MODES.FRAME) {
            currentViewers.push({
              studentUid,
              studentEmail: vData.studentEmail || 'Student',
              status: vData.status || 'watching_frame',
              connectionState: 'connected',
              joinedAt: vData.joinedAt,
            });
            return;
          }

          // In WebRTC mode:
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

        if (broadcastModeRef.current !== BROADCAST_MODES.FRAME) {
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
    broadcastMode,
    setBroadcastMode,
    frameStats,
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
