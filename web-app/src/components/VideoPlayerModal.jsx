import React, { useState, useEffect } from 'react';
import { db, functions, storage } from '../firebase-config';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { ref, getDownloadURL } from 'firebase/storage';

export function formatDuration(seconds) {
  if (!seconds || isNaN(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

const VideoPlayerModal = ({ show, onClose, videoUrl, loading, video, classId: propClassId, audioUrl = null }) => {
  const [resolvedAudioUrl, setResolvedAudioUrl] = useState(audioUrl || null);
  const [audioMeta, setAudioMeta] = useState(null);
  const [rawAudioCount, setRawAudioCount] = useState(0);
  const [isSearchingAudio, setIsSearchingAudio] = useState(false);
  const [isMergingAudio, setIsMergingAudio] = useState(false);
  const [mergeFeedback, setMergeFeedback] = useState('');

  const classId = video?.classId || propClassId;
  const studentUid = video?.studentUid || video?.uid || video?.userId;
  const studentEmail = video?.studentEmail || video?.email;
  const startTime = video?.startTime;
  const endTime = video?.endTime;

  useEffect(() => {
    if (!show) {
      setResolvedAudioUrl(null);
      setAudioMeta(null);
      setRawAudioCount(0);
      setMergeFeedback('');
      return;
    }

    // Direct audio URL provided
    if (audioUrl || video?.audioUrl || video?.combinedAudioUrl) {
      const url = audioUrl || video?.audioUrl || video?.combinedAudioUrl;
      setResolvedAudioUrl(url);
      setAudioMeta({
        durationSeconds: video?.audioDuration || video?.durationSeconds || null,
        clipCount: video?.audioClipCount || video?.clipCount || null,
      });
      return;
    }

    const studentUid = video?.studentUid || video?.uid || video?.userId;
    const studentEmail = video?.studentEmail || video?.email;

    if (!classId || (!studentUid && !studentEmail) || !db) return;

    let isMounted = true;
    setIsSearchingAudio(true);

    const lookupAudio = async () => {
      try {
        // 1. Look for pre-compiled combined audio in classes/{classId}/combinedAudios
        if (studentUid) {
          try {
            const combinedRef = collection(db, 'classes', classId, 'combinedAudios');
            const combinedQ = query(
              combinedRef,
              where('studentUid', '==', studentUid),
              limit(10)
            );

            const combinedSnap = await getDocs(combinedQ);
            if (!isMounted) return;

            if (!combinedSnap.empty) {
              const combinedDocs = combinedSnap.docs.map(d => ({ id: d.id, ...d.data() }));
              // Sort by createdAt desc in JS to avoid index requirement
              combinedDocs.sort((a, b) => {
                const timeA = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : (a.createdAt?._seconds ? a.createdAt._seconds * 1000 : 0);
                const timeB = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : (b.createdAt?._seconds ? b.createdAt._seconds * 1000 : 0);
                return timeB - timeA;
              });

              const docData = combinedDocs[0];
              if (docData.audioUrl) {
                setResolvedAudioUrl(docData.audioUrl);
                setAudioMeta({
                  id: docData.id,
                  durationSeconds: docData.durationSeconds,
                  clipCount: docData.clipCount,
                  audioPath: docData.audioPath,
                  isCombined: true,
                });
                setIsSearchingAudio(false);
                return;
              } else if (docData.audioPath && storage) {
                try {
                  const url = await getDownloadURL(ref(storage, docData.audioPath));
                  if (isMounted) {
                    setResolvedAudioUrl(url);
                    setAudioMeta({
                      id: docData.id,
                      durationSeconds: docData.durationSeconds,
                      clipCount: docData.clipCount,
                      audioPath: docData.audioPath,
                      isCombined: true,
                    });
                    setIsSearchingAudio(false);
                    return;
                  }
                } catch (err) {
                  console.debug('[VideoPlayerModal] Could not resolve combined audioPath:', err);
                }
              }
            }
          } catch (combErr) {
            console.debug('[VideoPlayerModal] Combined audio lookup note:', combErr);
          }
        }

        // 2. Check raw audio collection for this student session
        const audioRef = collection(db, 'audio');
        let rawSnap = null;
        if (studentUid) {
          try {
            const rawQ = query(
              audioRef,
              where('classId', '==', classId),
              where('studentUid', '==', studentUid),
              limit(50)
            );
            rawSnap = await getDocs(rawQ);
          } catch (qErr) {
            console.debug('[VideoPlayerModal] Error in rawQ query:', qErr);
          }
        }
        if ((!rawSnap || rawSnap.empty) && studentEmail) {
          try {
            const emailQ = query(
              audioRef,
              where('classId', '==', classId),
              where('studentEmail', '==', studentEmail),
              limit(50)
            );
            rawSnap = await getDocs(emailQ);
          } catch (qErr) {
            console.debug('[VideoPlayerModal] Error in emailQ query:', qErr);
          }
        }
        if ((!rawSnap || rawSnap.empty) && studentUid) {
          try {
            const fallbackUidQ = query(
              audioRef,
              where('studentUid', '==', studentUid),
              limit(50)
            );
            rawSnap = await getDocs(fallbackUidQ);
          } catch (qErr) {
            console.debug('[VideoPlayerModal] Error in fallbackUidQ query:', qErr);
          }
        }

          if (isMounted && rawSnap && !rawSnap.empty) {
            const rawDocs = rawSnap.docs.map(d => ({ id: d.id, ...d.data() }));
            setRawAudioCount(rawDocs.length);
            
            // Aggregate all speech transcripts across session clips
            const transcripts = rawDocs
              .map(d => d.transcript)
              .filter(t => t && typeof t === 'string' && t.trim().length > 0);
            const fullSessionTranscript = transcripts.length > 0 ? transcripts.join(' ... ') : null;

            setAudioMeta(prev => ({
              ...prev,
              clipCount: rawDocs.length,
              transcript: fullSessionTranscript || prev?.transcript,
              isCombined: false,
            }));

            // Automatically trigger background audio merge for all raw clips to produce clean normalized MP3
            if (functions) {
              try {
                setIsMergingAudio(true);
                const mergeFn = httpsCallable(functions, 'mergeStudentSessionAudio');
                mergeFn({
                  classId,
                  studentUid,
                  startTime: startTime?.toDate ? startTime.toDate().toISOString() : (startTime?._seconds ? new Date(startTime._seconds * 1000).toISOString() : (startTime || null)),
                  endTime: endTime?.toDate ? endTime.toDate().toISOString() : (endTime?._seconds ? new Date(endTime._seconds * 1000).toISOString() : (endTime || null)),
                }).then((res) => {
                  if (isMounted && res.data?.status === 'success' && res.data?.audioUrl) {
                    setResolvedAudioUrl(res.data.audioUrl);
                    setAudioMeta({
                      id: res.data.jobId,
                      durationSeconds: res.data.durationSeconds,
                      clipCount: res.data.clipCount || rawDocs.length,
                      transcript: res.data.transcript || fullSessionTranscript,
                      isCombined: true,
                    });
                    setMergeFeedback(`✅ Full session audio track automatically combined (${res.data.durationSeconds || 0}s).`);
                  }
                }).catch((mErr) => {
                  console.debug('[VideoPlayerModal] Background auto audio merge note:', mErr);
                }).finally(() => {
                  if (isMounted) setIsMergingAudio(false);
                });
              } catch (mergeInitErr) {
                console.debug('[VideoPlayerModal] Auto merge init note:', mergeInitErr);
                if (isMounted) setIsMergingAudio(false);
              }
            }
          }
      } catch (err) {
        console.debug('[VideoPlayerModal] Audio lookup note:', err);
      } finally {
        if (isMounted) setIsSearchingAudio(false);
      }
    };

    lookupAudio();

    return () => {
      isMounted = false;
    };
  }, [show, classId, studentUid, startTime, endTime, audioUrl, video]);

  const handleMergeAudio = async () => {
    if (!classId || !studentUid || isMergingAudio) return;
    setIsMergingAudio(true);
    setMergeFeedback('');

    try {
      const mergeFn = httpsCallable(functions, 'mergeStudentSessionAudio');
      const res = await mergeFn({
        classId,
        studentUid,
        startTime: startTime?.toDate ? startTime.toDate().toISOString() : (startTime?._seconds ? new Date(startTime._seconds * 1000).toISOString() : (startTime || null)),
        endTime: endTime?.toDate ? endTime.toDate().toISOString() : (endTime?._seconds ? new Date(endTime._seconds * 1000).toISOString() : (endTime || null)),
      });

      const data = res.data || {};
      if (data.status === 'success' && data.audioUrl) {
        setResolvedAudioUrl(data.audioUrl);
        setAudioMeta({
          durationSeconds: data.durationSeconds,
          clipCount: data.clipCount,
        });
        setMergeFeedback(`✅ Merged ${data.clipCount || rawAudioCount} audio clip(s) (${data.durationSeconds || 0}s).`);
      } else if (data.status === 'no_clips') {
        setMergeFeedback('⚠️ No audio clips available for this student session.');
      } else {
        setMergeFeedback(data.message || 'Audio merge completed.');
      }
    } catch (err) {
      console.error('[VideoPlayerModal] Error merging student audio:', err);
      setMergeFeedback(`❌ Failed to merge audio: ${err.message}`);
    } finally {
      setIsMergingAudio(false);
    }
  };

  if (!show) return null;

  const durationSec = typeof video?.duration === 'number' ? video.duration : null;
  const captureInterval = typeof video?.captureInterval === 'number' ? video.captureInterval : 15;
  const estimatedActiveMinutes = durationSec ? Math.max(1, Math.round((durationSec * captureInterval) / 60)) : null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(0,0,0,0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1050,
      }}
      onClick={onClose}
    >
      <div
        style={{
          position: 'relative',
          padding: '24px',
          background: 'white',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '860px',
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '12px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            fontSize: '1.5rem',
            cursor: 'pointer',
            zIndex: 10,
            color: '#64748b',
          }}
        >
          &times;
        </button>

        {/* Time-lapse screencast banner */}
        {estimatedActiveMinutes !== null && (
          <div
            style={{
              marginBottom: '14px',
              padding: '10px 14px',
              background: '#eff6ff',
              borderRadius: '8px',
              border: '1px solid #bfdbfe',
              fontSize: '0.85rem',
              color: '#1e40af',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>⏩</span>
            <span>
              <strong>Time-Lapse Screencast:</strong> Encoded at 1 frame/sec (~{captureInterval}s screen time per frame). 
              Video playback duration: <strong>{durationSec}s</strong> represents ~<strong>{estimatedActiveMinutes} minutes</strong> of active lab screen share.
            </span>
          </div>
        )}

        {/* Main Video Player */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
            <p>Loading video playback stream...</p>
          </div>
        ) : (
          <video
            controls
            autoPlay
            src={videoUrl}
            style={{
              width: '100%',
              maxHeight: '52vh',
              borderRadius: '8px',
              backgroundColor: '#000',
              marginBottom: '16px',
            }}
          >
            Your browser does not support the video tag.
          </video>
        )}

        {/* Dedicated Student Audio Recording Section */}
        <div
          style={{
            marginTop: '4px',
            padding: '14px 16px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>🎙️</span>
              <strong style={{ fontSize: '0.92rem', color: '#1e293b' }}>
                Student Session Audio Track
              </strong>
              {resolvedAudioUrl && (
                <span
                  style={{
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '9999px',
                    background: '#dcfce7',
                    color: '#15803d',
                    border: '1px solid #bbf7d0',
                  }}
                >
                  🎧 Audio Available
                </span>
              )}
            </div>

            {resolvedAudioUrl && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {audioMeta?.durationSeconds && (
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>
                    Length: <strong>{formatDuration(audioMeta.durationSeconds)}</strong>
                    {audioMeta.clipCount ? ` (${audioMeta.clipCount} clips)` : ''}
                  </span>
                )}
                {(() => {
                  const audioExt = resolvedAudioUrl.includes('.mp3') ? 'mp3' : (resolvedAudioUrl.includes('.m4a') ? 'm4a' : 'mp3');
                  return (
                    <a
                      href={resolvedAudioUrl}
                      download={`student_session_audio_${studentUid || 'track'}.${audioExt}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        padding: '4px 10px',
                        background: '#059669',
                        color: '#ffffff',
                        borderRadius: '6px',
                        fontSize: '0.78rem',
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      ⬇ Download Audio (.{audioExt})
                    </a>
                  );
                })()}
              </div>
            )}
          </div>

          {/* Unified Session Audio Player */}
          {resolvedAudioUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <audio
                controls
                preload="auto"
                src={resolvedAudioUrl}
                data-testid="student-session-audio-player"
                style={{ width: '100%', height: '38px' }}
              >
                Your browser does not support HTML5 audio.
              </audio>
              {audioMeta?.transcript && (
                <div style={{ fontSize: '0.8rem', color: '#475569', background: '#f1f5f9', padding: '6px 10px', borderRadius: '6px', borderLeft: '3px solid #3b82f6' }}>
                  <strong>🎙️ Speech Transcript:</strong> <em>"{audioMeta.transcript}"</em>
                </div>
              )}
              {isMergingAudio && (
                <div style={{ fontSize: '0.78rem', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '0.75rem', height: '0.75rem' }} />
                  <span>Auto-combining latest speech audio into single continuous track...</span>
                </div>
              )}
            </div>
          ) : isMergingAudio || (rawAudioCount > 0 && isSearchingAudio) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#2563eb' }}>
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '0.85rem', height: '0.85rem' }} />
              <span>Auto-combining session speech audio into continuous track...</span>
            </div>
          ) : rawAudioCount > 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
              <span style={{ fontSize: '0.82rem', color: '#2563eb', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" style={{ width: '0.85rem', height: '0.85rem' }} />
                Processing session speech track...
              </span>
            </div>
          ) : isSearchingAudio ? (
            <span style={{ fontSize: '0.82rem', color: '#64748b', fontStyle: 'italic' }}>
              🔍 Checking for student voice recordings...
            </span>
          ) : (
            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic' }}>
              🔇 No student microphone audio recorded for this session.
            </span>
          )}

          {mergeFeedback && (
            <div style={{ fontSize: '0.8rem', color: mergeFeedback.startsWith('❌') ? '#dc2626' : '#15803d', fontWeight: 600 }}>
              {mergeFeedback}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoPlayerModal;
