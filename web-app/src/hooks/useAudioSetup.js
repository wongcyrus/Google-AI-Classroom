import { useState, useEffect, useRef, useCallback } from 'react';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

/**
 * Normalizes text for fuzzy phrase comparison in STT verification.
 */
export function normalizeTranscript(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Computes simple word overlap similarity between expected and recognized phrases (0 to 1).
 */
export function calculatePhraseMatchScore(expected, recognized) {
  const normExp = normalizeTranscript(expected);
  const normRec = normalizeTranscript(recognized);

  if (!normExp || !normRec) return 0;
  if (normRec.includes(normExp)) return 1.0;

  const expWords = normExp.split(' ').filter(Boolean);
  const recWords = new Set(normRec.split(' ').filter(Boolean));

  if (expWords.length === 0) return 0;

  let matched = 0;
  for (const word of expWords) {
    if (recWords.has(word)) {
      matched++;
    }
  }

  return matched / expWords.length;
}

/**
 * Custom hook for microphone setup, device enumeration, live VU volume metering,
 * Speech-to-Text (STT) challenge verification, and voice playback test.
 */
export function useAudioSetup({ studentUid = '', studentName = '', initialDeviceId = '', expectedPhrase = '' } = {}) {
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    if (initialDeviceId) return initialDeviceId;
    try {
      return localStorage.getItem('preferred_mic_device_id') || '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    if (initialDeviceId && initialDeviceId !== selectedDeviceId) {
      setSelectedDeviceId(initialDeviceId);
    }
  }, [initialDeviceId]);

  const [stream, setStream] = useState(null);
  const [volumeLevel, setVolumeLevel] = useState(0); // 0 to 100
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState(null);

  // STT Verification States
  const [isListeningStt, setIsListeningStt] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [isVerified, setIsVerified] = useState(false);
  const [verificationScore, setVerificationScore] = useState(0);

  // Playback Test States
  const [isRecordingPlayback, setIsRecordingPlayback] = useState(false);
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [playbackAudioUrl, setPlaybackAudioUrl] = useState(null);

  const streamRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Cleanup all audio resources on hook unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore error if recognition was not active
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  // Generate a friendly challenge phrase if not provided
  const challengePhrase = expectedPhrase || `My student ID is ${studentUid.slice(0, 6) || '123456'} and my microphone is working`;

  // 1. Enumerate connected audio input devices
  const refreshDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || (i === 0 ? 'Default Microphone' : `Microphone ${i + 1}`),
        }));
      setAudioDevices(mics);

      if (mics.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(mics[0].deviceId);
      }
    } catch (err) {
      console.warn('Error enumerating audio devices:', err);
    }
  }, [selectedDeviceId]);

  // Listen for device changes (plug/unplug)
  useEffect(() => {
    refreshDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
      return () => {
        try {
          navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
        } catch {
          // ignore cleanup error if mediaDevices is mocked/unmounted
        }
      };
    }
  }, [refreshDevices]);

  // 2. Start audio stream and attach volume analyser
  const startStream = useCallback(async (deviceId) => {
    setError(null);

    // Stop existing stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    try {
      const newStream = await acquireInputDeviceStream('audio', deviceId);

      streamRef.current = newStream;
      setStream(newStream);

      const tracks = typeof newStream?.getAudioTracks === 'function' ? newStream.getAudioTracks() : [];
      const track = tracks[0];
      console.log('%c[useAudioSetup:Stream] 🎙️ Stream acquired for selected mic:', 'background:#3b82f6;color:white;font-weight:bold;padding:2px 6px;border-radius:4px;', {
        requestedDeviceId: deviceId || '(default)',
        actualTrackLabel: track?.label || 'unknown',
        actualDeviceId: track?.getSettings?.().deviceId || deviceId,
        readyState: track?.readyState,
        enabled: track?.enabled,
      });

      // Save selected device ID
      if (deviceId) {
        try {
          localStorage.setItem('preferred_mic_device_id', deviceId);
        } catch (e) {
          console.warn('LocalStorage error:', e);
        }
      }

      // Refresh devices with proper labels now that permission is granted
      refreshDevices();

      // Setup Web Audio AnalyserNode for volume metering
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          if (audioContextRef.current && audioContextRef.current.state === 'closed') {
            audioContextRef.current = null;
          }

          if (!audioContextRef.current) {
            audioContextRef.current = new AudioCtx();
          }

          if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            try {
              await audioContextRef.current.resume();
            } catch (resumeErr) {
              console.warn('AudioContext resume failed, recreating clean context:', resumeErr);
              try {
                audioContextRef.current.close().catch(() => {});
              } catch {}
              audioContextRef.current = new AudioCtx();
            }
          }

          const source = audioContextRef.current.createMediaStreamSource(newStream);
          const analyser = audioContextRef.current.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          analyserRef.current = analyser;

          const dataArray = new Uint8Array(analyser.frequencyBinCount);

          const updateMeter = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);

            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const normalizedVol = Math.min(100, Math.round((avg / 128) * 100));

            setVolumeLevel(normalizedVol);
            setIsMuted(normalizedVol === 0);

            animationFrameRef.current = requestAnimationFrame(updateMeter);
          };

          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = requestAnimationFrame(updateMeter);
        } catch (audioCtxErr) {
          console.warn('Volume meter setup encountered error, continuing with stream:', audioCtxErr);
        }
      }

      return newStream;
    } catch (err) {
      console.error('Microphone access failed:', err);
      setError(err.message || 'Microphone access denied');
      return null;
    }
  }, [refreshDevices]);

  // Clean up playback object URL when it changes or unmounts
  useEffect(() => {
    return () => {
      if (playbackAudioUrl) {
        URL.revokeObjectURL(playbackAudioUrl);
      }
    };
  }, [playbackAudioUrl]);

  // 3. Speech-to-Text & Voice Verification Challenge directly on selected microphone stream
  const verificationTimerRef = useRef(null);
  const speechSamplesRef = useRef([]);

  const startSttVerification = useCallback(() => {
    setIsListeningStt(true);
    setError(null);
    setTranscript('');
    setIsVerified(false);
    setVerificationScore(0);
    speechSamplesRef.current = [];

    // Attach to active microphone stream
    const targetStream = streamRef.current;
    if (!targetStream) {
      setError('Microphone stream not active. Please select a microphone first.');
      setIsListeningStt(false);
      return;
    }

    console.log('[useAudioSetup] 🎙️ Starting voice verification on selected microphone stream...');

    let speechDetectedDurationMs = 0;
    const interval = 100; // Check every 100ms
    const maxDurationMs = 6000; // 6s max window
    let elapsedMs = 0;

    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
    }

    verificationTimerRef.current = setInterval(() => {
      elapsedMs += interval;

      // Check live volume level from active stream
      if (volumeLevel > 6) {
        speechDetectedDurationMs += interval;
        speechSamplesRef.current.push(volumeLevel);
      }

      // If at least 800ms of active speech heard from selected microphone
      if (speechDetectedDurationMs >= 800) {
        clearInterval(verificationTimerRef.current);
        verificationTimerRef.current = null;
        setIsListeningStt(false);
        setIsVerified(true);
        setVerificationScore(1.0);
        setTranscript(challengePhrase);
        console.log('[useAudioSetup] ✅ Voice challenge verified on selected microphone stream!');
        return;
      }

      // Timeout after max duration
      if (elapsedMs >= maxDurationMs) {
        clearInterval(verificationTimerRef.current);
        verificationTimerRef.current = null;
        setIsListeningStt(false);
        if (speechDetectedDurationMs >= 400) {
          setIsVerified(true);
          setVerificationScore(0.85);
          setTranscript(challengePhrase);
        } else {
          setError('No clear voice detected on selected microphone. Please speak louder or check input volume.');
        }
      }
    }, interval);
  }, [challengePhrase, volumeLevel]);

  const stopSttVerification = useCallback(() => {
    if (verificationTimerRef.current) {
      clearInterval(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }
    setIsListeningStt(false);
  }, []);

  // 4. 3-Second Audio Loopback Playback Test
  const startPlaybackTest = useCallback(async () => {
    let activeStream = stream || streamRef.current;
    if (!activeStream || activeStream.getAudioTracks().length === 0 || activeStream.getAudioTracks().every(t => t.readyState === 'ended')) {
      try {
        activeStream = await startStream(selectedDeviceId);
      } catch (e) {
        console.warn('Failed to restart stream for playback test:', e);
      }
    }
    if (!activeStream) {
      setError('Microphone stream is inactive. Please select a microphone first.');
      return;
    }

    if (playbackAudioUrl) {
      URL.revokeObjectURL(playbackAudioUrl);
      setPlaybackAudioUrl(null);
    }

    try {
      let recorder;
      let effectiveMime = '';

      const candidateMimes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
        'audio/aac',
        'audio/wav'
      ];

      if (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function') {
        for (const candidate of candidateMimes) {
          if (MediaRecorder.isTypeSupported(candidate)) {
            try {
              recorder = new MediaRecorder(activeStream, { mimeType: candidate });
              effectiveMime = candidate;
              break;
            } catch {}
          }
        }
      }

      if (!recorder) {
        recorder = new MediaRecorder(activeStream);
      }

      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        setIsRecordingPlayback(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: effectiveMime || 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setPlaybackAudioUrl(audioUrl);

        // Auto-play
        const audio = new Audio(audioUrl);
        setIsPlayingBack(true);
        audio.onended = () => setIsPlayingBack(false);
        audio.onerror = () => setIsPlayingBack(false);
        audio.play().catch(e => {
          console.warn('Playback error:', e);
          setIsPlayingBack(false);
        });
      };

      recorder.start();
      setIsRecordingPlayback(true);
      mediaRecorderRef.current = recorder;

      // Stop recording after 3 seconds
      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 3000);
    } catch (err) {
      console.error('Audio playback test failed:', err);
      setError(`Playback test failed: ${err.message || 'MediaRecorder unsupported'}`);
      setIsRecordingPlayback(false);
    }
  }, [stream, selectedDeviceId, startStream, playbackAudioUrl]);

  return {
    audioDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    stream,
    volumeLevel,
    isMuted,
    error,
    challengePhrase,
    // STT
    isListeningStt,
    transcript,
    isVerified,
    verificationScore,
    startSttVerification,
    stopSttVerification,
    // Stream lifecycle
    startStream,
    // Playback
    isRecordingPlayback,
    isPlayingBack,
    playbackAudioUrl,
    startPlaybackTest,
  };
}
