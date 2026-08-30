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

  useEffect(() => {
    if (!classId || !studentUid) return;

    // Create hidden audio element for playing teacher talkback voice if sent
    if (!audioOutputRef.current && typeof document !== 'undefined') {
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioOutputRef.current = audioEl;
    }

    const peekDocRef = doc(db, `classes/${classId}/livePeeks/${studentUid}`);

    const unsubscribe = onSnapshot(peekDocRef, async (snapshot) => {
      if (!snapshot.exists()) {
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
        }
        return;
      }

      const data = snapshot.data();

      // Incoming offer from teacher
      if (data.status === 'offered' && data.offer) {
        try {
          if (peerConnectionRef.current) {
            peerConnectionRef.current.close();
          }

          const pc = new (window.RTCPeerConnection || window.webkitRTCPeerConnection)(RTC_CONFIG);
          peerConnectionRef.current = pc;

          // Attach active student tracks (screen, webcam, mic)
          if (screenStreamRef?.current) {
            screenStreamRef.current.getTracks().forEach((track) => {
              pc.addTrack(track, screenStreamRef.current);
            });
          }
          if (webcamStreamRef?.current) {
            webcamStreamRef.current.getTracks().forEach((track) => {
              pc.addTrack(track, webcamStreamRef.current);
            });
          }
          if (audioStreamRef?.current) {
            audioStreamRef.current.getTracks().forEach((track) => {
              pc.addTrack(track, audioStreamRef.current);
            });
          }

          // Handle incoming teacher voice track (intercom talkback)
          pc.ontrack = (event) => {
            if (audioOutputRef.current && event.streams[0]) {
              audioOutputRef.current.srcObject = event.streams[0];
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

          // Handle remote offer & create answer
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          // Update Firestore doc with answer
          await updateDoc(peekDocRef, {
            answer: { type: answer.type, sdp: answer.sdp },
            status: 'connected',
          });
        } catch (err) {
          console.error('Student WebRTC responder error:', err);
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
      }
    };
  }, [classId, studentUid, screenStreamRef, webcamStreamRef, audioStreamRef]);
}
