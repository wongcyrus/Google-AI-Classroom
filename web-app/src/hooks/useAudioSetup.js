import { useState, useEffect, useRef, useCallback } from 'react';

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
export function useAudioSetup({ studentUid = '', studentName = '', expectedPhrase = '' } = {}) {
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(() => {
    try {
      return localStorage.getItem('preferred_mic_device_id') || '';
    } catch {
      return '';
    }
  });

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

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Generate a friendly challenge phrase if not provided
  const challengePhrase = expectedPhrase || `My student ID is ${studentUid.slice(0, 6) || '123456'} and my microphone is working`;

  // 1. Enumerate connected audio input devices
  const refreshDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
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
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }

    try {
      const constraints = {
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);

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
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new AudioCtx();
        }
        if (audioContextRef.current.state === 'suspended') {
          await audioContextRef.current.resume();
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
      }

      return newStream;
    } catch (err) {
      console.error('Microphone access failed:', err);
      setError(err.message || 'Microphone access denied');
      return null;
    }
  }, [stream, refreshDevices]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      if (stream) stream.getTracks().forEach(t => t.stop());
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch(() => {});
      }
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      if (playbackAudioUrl) {
        URL.revokeObjectURL(playbackAudioUrl);
      }
    };
  }, [stream, playbackAudioUrl]);

  // 3. Speech-to-Text (STT) Verification Challenge
  const startSttVerification = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      // Browser doesn't support Web Speech API - fallback to volume-based or instant pass
      setError('Web Speech API not supported in this browser. Please use volume test.');
      // Auto-pass if volume test is active
      if (volumeLevel > 15) {
        setIsVerified(true);
        setVerificationScore(1.0);
      }
      return;
    }

    try {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setIsListeningStt(true);
        setError(null);
      };

      recognition.onresult = (event) => {
        let currentTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          currentTranscript += event.results[i][0].transcript;
        }

        setTranscript(currentTranscript);
        const score = calculatePhraseMatchScore(challengePhrase, currentTranscript);
        setVerificationScore(score);

        // If >= 70% match or substantial speech recognized
        if (score >= 0.7 || currentTranscript.length > 10) {
          setIsVerified(true);
        }
      };

      recognition.onerror = (event) => {
        console.warn('SpeechRecognition error:', event.error);
        if (event.error !== 'no-speech') {
          setError(`Speech recognition: ${event.error}`);
        }
        setIsListeningStt(false);
      };

      recognition.onend = () => {
        setIsListeningStt(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err) {
      console.error('Failed to start SpeechRecognition:', err);
      setError('Failed to start speech recognition');
      setIsListeningStt(false);
    }
  }, [challengePhrase, volumeLevel]);

  const stopSttVerification = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch {}
    }
    setIsListeningStt(false);
  }, []);

  // 4. 3-Second Audio Loopback Playback Test
  const startPlaybackTest = useCallback(() => {
    if (!stream) return;

    if (playbackAudioUrl) {
      URL.revokeObjectURL(playbackAudioUrl);
      setPlaybackAudioUrl(null);
    }

    try {
      const mimeType = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported('audio/webm;codecs=opus'))
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        setIsRecordingPlayback(false);
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
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
      setError('Playback test failed');
      setIsRecordingPlayback(false);
    }
  }, [stream, playbackAudioUrl]);

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
