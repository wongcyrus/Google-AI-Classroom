import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { db, storage } from '../firebase-config';
import { doc, onSnapshot, updateDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { ref as storageRef, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import { injectWebmDuration, getSupportedMimeType } from './useLectureRecorder';

/**
 * Student-side PC Screen Recorder hook for Dual-Device Project Group Meetings.
 * Coordinates with the Supervisor's Mobile Phone via `classes/{classId}/activeMeetingCaptures/{studentUid}`.
 * Works at any period across all enrolled classes so parallel/off-schedule project meetings are always detected.
 */
export default function useStudentProjectMeetingScreenRecorder({
  activeClass,
  userClasses = [],
  studentUid,
  studentEmail = '',
  studentName = '',
  screenStreamRef,
  isScreenSharing = false,
}) {
  const [activeMeetingCapture, setActiveMeetingCapture] = useState(null);
  const [meetingScreenState, setMeetingScreenState] = useState('idle'); // 'idle' | 'waiting_for_screen_share' | 'recording_screen' | 'uploading' | 'completed' | 'error'
  const [uploadProgress, setUploadProgress] = useState(0);

  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recordingStartMsRef = useRef(0);
  const activeCaptureMetaRef = useRef(null);
  const isFinalizingRef = useRef(false);

  const monitoredClassIds = useMemo(() => {
    const ids = new Set();
    if (activeClass && typeof activeClass === 'string') ids.add(activeClass);
    (Array.isArray(userClasses) ? userClasses : []).forEach((c) => {
      const id = typeof c === 'string' ? c : c?.id;
      if (id) ids.add(id);
    });
    return [...ids];
  }, [activeClass, userClasses]);

  const finalizeAndUploadScreenClip = useCallback(
    async (captureMeta, rawChunks, durationMs) => {
      if (!captureMeta || !captureMeta.classId || !captureMeta.meetingId || isFinalizingRef.current) {
        return;
      }
      isFinalizingRef.current = true;
      setMeetingScreenState('uploading');
      setUploadProgress(0);

      const {
        classId,
        groupId = 'default_group',
        meetingId,
        clipId = `clip_${Date.now()}`,
        label = 'Student PC Screen',
      } = captureMeta;

      const docKey = captureMeta.captureDocKey || studentUid;
      const captureDocRef = doc(db, `classes/${classId}/activeMeetingCaptures/${docKey}`);

      try {
        await updateDoc(captureDocRef, {
          studentPcState: 'uploading',
          updatedAt: serverTimestamp(),
        }).catch(() => {});

        if (!rawChunks || rawChunks.length === 0) {
          await updateDoc(captureDocRef, {
            studentPcState: 'completed',
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          setMeetingScreenState('completed');
          isFinalizingRef.current = false;
          return;
        }

        const mimeType = getSupportedMimeType() || 'video/webm';
        let blob = new Blob(rawChunks, { type: mimeType });
        if (durationMs > 0) {
          blob = await injectWebmDuration(blob, durationMs);
        }

        const fileName = `screen_${studentUid}_${clipId}.webm`;
        const storagePath = `projectMeetings/${classId}/${groupId}/${meetingId}/${fileName}`;
        const fileRef = storageRef(storage, storagePath);

        const uploadTask = uploadBytesResumable(fileRef, blob, {
          contentType: 'video/webm',
          customMetadata: {
            classId,
            groupId,
            meetingId,
            studentUid,
            studentEmail: studentEmail || '',
          },
        });

        await new Promise((resolve, reject) => {
          uploadTask.on(
            'state_changed',
            (snap) => {
              if (snap.totalBytes > 0) {
                setUploadProgress(Math.round((snap.bytesTransferred / snap.totalBytes) * 100));
              }
            },
            (err) => reject(err),
            () => resolve()
          );
        });

        const downloadUrl = await getDownloadURL(fileRef);
        const durationSeconds = Math.max(1, Math.round(durationMs / 1000));

        const screenClipEntry = {
          clipId,
          label: label || `${studentName || studentEmail || 'Student'}'s PC Screen`,
          studentUid,
          studentEmail: studentEmail || '',
          studentName: studentName || studentEmail || 'Student',
          storagePath,
          downloadUrl,
          durationSeconds,
          fileSize: blob.size,
          mimeType: 'video/webm',
          startedAt: captureMeta.startedAt || new Date(recordingStartMsRef.current || Date.now()).toISOString(),
        };

        const meetingDocRef = doc(db, `classes/${classId}/projectMeetings/${meetingId}`);
        await updateDoc(meetingDocRef, {
          screenClips: arrayUnion(screenClipEntry),
          hasVideo: true,
          videoDownloadUrl: downloadUrl,
          videoStoragePath: storagePath,
          updatedAt: serverTimestamp(),
        });

        await updateDoc(captureDocRef, {
          studentPcState: 'completed',
          lastScreenClipUrl: downloadUrl,
          lastScreenStoragePath: storagePath,
          updatedAt: serverTimestamp(),
        }).catch(() => {});

        setMeetingScreenState('completed');
      } catch (err) {
        console.error('[useStudentProjectMeetingScreenRecorder] Failed to upload student PC screen clip:', err);
        setMeetingScreenState('error');
        await updateDoc(captureDocRef, {
          studentPcState: 'error',
          errorMessage: err.message || String(err),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } finally {
        isFinalizingRef.current = false;
      }
    },
    [studentUid, studentEmail, studentName]
  );

  const stopLocalScreenRecorder = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (err) {
        console.warn('[useStudentProjectMeetingScreenRecorder] Error stopping recorder:', err);
      }
    } else if (recordedChunksRef.current.length > 0 && activeCaptureMetaRef.current) {
      const chunks = [...recordedChunksRef.current];
      recordedChunksRef.current = [];
      const durationMs = Math.max(1000, Date.now() - (recordingStartMsRef.current || Date.now()));
      finalizeAndUploadScreenClip(activeCaptureMetaRef.current, chunks, durationMs);
    }
  }, [finalizeAndUploadScreenClip]);

  const startLocalScreenRecorder = useCallback(
    async (captureData) => {
      const stream = screenStreamRef?.current;
      const videoTracks = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks() : [];
      const hasLiveScreen = videoTracks.some((t) => t.readyState === 'live');

      const docKey = captureData.captureDocKey || studentUid;
      const captureDocRef = doc(db, `classes/${captureData.classId}/activeMeetingCaptures/${docKey}`);

      if (!hasLiveScreen) {
        setMeetingScreenState('waiting_for_screen_share');
        await updateDoc(captureDocRef, {
          studentPcState: 'waiting_for_screen_share',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        return;
      }

      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        return;
      }

      try {
        recordedChunksRef.current = [];
        recordingStartMsRef.current = Date.now();
        activeCaptureMetaRef.current = captureData;

        const mimeType = getSupportedMimeType();
        const options = mimeType ? { mimeType, videoBitsPerSecond: 2000000 } : {};
        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;

        recorder.ondataavailable = (evt) => {
          if (evt.data && evt.data.size > 0) {
            recordedChunksRef.current.push(evt.data);
          }
        };

        recorder.onstop = () => {
          const chunks = [...recordedChunksRef.current];
          recordedChunksRef.current = [];
          const durationMs = Math.max(1000, Date.now() - (recordingStartMsRef.current || Date.now()));
          mediaRecorderRef.current = null;
          finalizeAndUploadScreenClip(activeCaptureMetaRef.current, chunks, durationMs);
        };

        recorder.start(5000);
        setMeetingScreenState('recording_screen');

        await updateDoc(captureDocRef, {
          studentPcState: 'recording_screen',
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      } catch (err) {
        console.error('[useStudentProjectMeetingScreenRecorder] Could not start MediaRecorder on PC screen:', err);
        setMeetingScreenState('error');
      }
    },
    [screenStreamRef, studentUid, finalizeAndUploadScreenClip]
  );

  // Subscribe to `activeMeetingCaptures/{studentUid}` and `activeMeetingCaptures/{studentEmail}` across all enrolled classes
  useEffect(() => {
    const cleanEmail = String(studentEmail || '').trim().toLowerCase();
    const candidateKeys = [...new Set([studentUid, cleanEmail].filter(Boolean))];
    if (candidateKeys.length === 0 || monitoredClassIds.length === 0) return;

    const unsubs = [];
    monitoredClassIds.forEach((clsId) => {
      candidateKeys.forEach((docKey) => {
        const ref = doc(db, `classes/${clsId}/activeMeetingCaptures/${docKey}`);
        const unsub = onSnapshot(
          ref,
          (snap) => {
            if (!snap.exists()) {
              setActiveMeetingCapture((prev) =>
                prev?.classId === clsId && prev?.captureDocKey === docKey ? null : prev
              );
              return;
            }
            const data = { classId: clsId, captureDocKey: docKey, ...snap.data() };
            if (data.status === 'recording') {
              setActiveMeetingCapture(data);
              activeCaptureMetaRef.current = data;
              startLocalScreenRecorder(data);
            } else if (data.status === 'stopping') {
              setActiveMeetingCapture(data);
              stopLocalScreenRecorder();
            } else if (data.status === 'idle' || data.status === 'completed') {
              setActiveMeetingCapture(null);
              setMeetingScreenState('idle');
            }
          },
          (err) => {
            console.debug(`[useStudentProjectMeetingScreenRecorder] Listener note for ${clsId}:`, err.message);
          }
        );
        unsubs.push(unsub);
      });
    });

    return () => {
      unsubs.forEach((u) => u && u());
    };
  }, [studentUid, studentEmail, monitoredClassIds, startLocalScreenRecorder, stopLocalScreenRecorder]);

  // If the student starts sharing their PC screen while a meeting capture is waiting for screen share, start recording immediately!
  useEffect(() => {
    if (
      isScreenSharing &&
      activeMeetingCapture &&
      activeMeetingCapture.status === 'recording' &&
      meetingScreenState === 'waiting_for_screen_share'
    ) {
      startLocalScreenRecorder(activeMeetingCapture);
    }
  }, [isScreenSharing, activeMeetingCapture, meetingScreenState, startLocalScreenRecorder]);

  return {
    activeMeetingCapture,
    meetingScreenState,
    uploadProgress,
  };
}
