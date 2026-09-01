import { useEffect, useRef } from 'react';
import { db } from '../firebase-config';
import { doc, onSnapshot, updateDoc, arrayUnion } from 'firebase/firestore';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

/**
 * Student-side WebRTC hook.
 * Listens for incoming Live Peek offers from the teacher,
 * attaches existing screen, webcam, and audio streams,
 * and handles 2-way audio if the teacher talks.
 */
export default function useWebRTCPeekStudent({
  classId,
  studentUid,
  screenStreamRef,
  webcamStreamRef,
  audioStreamRef,
}) {
  const peerConnectionRef = useRef(null);
  const audioOutputRef = useRef(null);
  const audioSenderRef = useRef(null);

  useEffect(() => {
    if (!classId || !studentUid) return;

    // Create hidden audio element for playing teacher talkback voice if sent
    if (!audioOutputRef.current && typeof document !== 'undefined') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.playsInline = true;
      audioEl.style.display = 'none';
      document.body.appendChild(audioEl);
      audioOutputRef.current = audioEl;
    }

    const peekDocRef = doc(db, `classes/${classId}/livePeeks/${studentUid}`);

    const unsubscribe = onSnapshot(peekDocRef, async (snapshot) => {
      if (!snapshot.exists()) {
        if (peerConnectionRef.current) {
          console.log('[Student WebRTC] Peek session removed in Firestore, closing PeerConnection');
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
        return;
      }

      const data = snapshot.data();

      // Incoming offer from teacher
      if (data.status === 'offered' && data.offer) {
        console.log('[Student WebRTC] Teacher initiated Live Peek offer. Initializing responder...');
        try {
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
          }

          const pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
          peerConnectionRef.current = pc;

          // Attach active student tracks (screen, webcam, mic)
          if (screenStreamRef?.current) {
            screenStreamRef.current.getTracks().forEach((track) => {
              console.log('[Student WebRTC] Attaching screen track:', track.id, 'readyState:', track.readyState);
              pc.addTrack(track, screenStreamRef.current);
            });
          }
          if (webcamStreamRef?.current) {
            webcamStreamRef.current.getTracks().forEach((track) => {
              console.log('[Student WebRTC] Attaching webcam track:', track.id, 'readyState:', track.readyState);
              pc.addTrack(track, webcamStreamRef.current);
            });
          }

          // Ensure student audio track is attached
          let currentAudioStream = audioStreamRef?.current;
          const getTracksFromStream = (s) => {
            if (!s) return [];
            if (typeof s.getAudioTracks === 'function') return s.getAudioTracks();
            if (typeof s.getTracks === 'function') return s.getTracks();
            return [];
          };

          let audioTracks = getTracksFromStream(currentAudioStream);
          if (audioTracks.length === 0 && navigator.mediaDevices?.getUserMedia) {
            console.log('[Student WebRTC Audio] audioStreamRef is empty. Requesting live microphone for teacher...');
            try {
              currentAudioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
              if (audioStreamRef) {
                audioStreamRef.current = currentAudioStream;
              }
              audioTracks = getTracksFromStream(currentAudioStream);
            } catch (micErr) {
              console.warn('[Student WebRTC Audio] Could not acquire fallback mic stream:', micErr);
            }
          }

          if (audioTracks.length > 0) {
            console.log(`[Student WebRTC Audio] Attaching ${audioTracks.length} student mic track(s) to WebRTC:`, audioTracks.map(t => ({ id: t.id, label: t.label, enabled: t.enabled, readyState: t.readyState })));
            audioTracks.forEach((track) => {
              const sender = pc.addTrack(track, currentAudioStream);
              audioSenderRef.current = sender;
            });
          } else {
            console.warn('[Student WebRTC Audio] ⚠️ No microphone stream attached! Teacher will not hear student audio.');
          }

          // Handle incoming teacher voice track (intercom talkback)
          pc.ontrack = (event) => {
            console.log('[Student WebRTC Audio] Received incoming track from teacher:', event.track?.kind, event.track?.id, event.track?.label);
            if (event.track?.kind === 'audio' && audioOutputRef.current) {
              let stream = event.streams[0];
              if (!stream && event.track) {
                stream = new MediaStream([event.track]);
              }
              if (stream) {
                audioOutputRef.current.srcObject = stream;
                audioOutputRef.current.muted = false;
                audioOutputRef.current.volume = 1.0;
                try {
                  const playPromise = audioOutputRef.current.play();
                  if (playPromise && typeof playPromise.catch === 'function') {
                    playPromise.catch((err) => {
                      console.warn('[Student WebRTC Audio] Teacher talkback playback prevented by autoplay policy:', err);
                    });
                  }
                } catch (err) {
                  console.warn('[Student WebRTC Audio] Error playing teacher talkback:', err);
                }
              }
            }
          };

          // Send ICE candidates to Firestore
          pc.onicecandidate = (event) => {
            if (event.candidate) {
              updateDoc(peekDocRef, {
                studentCandidates: arrayUnion(event.candidate.toJSON()),
              }).catch(() => {});
            }
          };

          pc.onconnectionstatechange = () => {
            console.log('[Student WebRTC] Peer connection state changed to:', pc.connectionState);
          };

          // Handle remote offer & create answer
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          const streamMetadata = {
            screenStreamId: screenStreamRef?.current?.id || null,
            webcamStreamId: webcamStreamRef?.current?.id || null,
            audioStreamId: currentAudioStream?.id || null,
          };

          console.log('[Student WebRTC] Sending answer with stream metadata:', streamMetadata);

          // Update Firestore doc with answer
          await updateDoc(peekDocRef, {
            answer: { type: answer.type, sdp: answer.sdp },
            status: 'connected',
            streamMetadata,
          });
        } catch (err) {
          console.error('[Student WebRTC] Responder error:', err);
        }
      }

      // Add teacher ICE candidates
      if (data.teacherCandidates && Array.isArray(data.teacherCandidates) && peerConnectionRef.current) {
        for (const cand of data.teacherCandidates) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(cand));
          } catch {
            // Ignore
          }
        }
      }
    });

    return () => {
      unsubscribe();
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
        peerConnectionRef.current = null;
      }
      if (audioOutputRef.current) {
        audioOutputRef.current.srcObject = null;
        if (audioOutputRef.current.parentNode) {
          audioOutputRef.current.parentNode.removeChild(audioOutputRef.current);
        }
        audioOutputRef.current = null;
      }
    };
  }, [classId, studentUid, screenStreamRef, webcamStreamRef, audioStreamRef]);
}
