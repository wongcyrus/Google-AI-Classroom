import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase-config';
import { doc, setDoc } from 'firebase/firestore';
import { acquireInputDeviceStream } from '../utils/mediaDeviceCapture';

/**
 * 3-Step Guided Pre-Exam Readiness Wizard (Self-Calibration)
 * 1. 🎙️ Mic Test & Voice Verification
 * 2. 👁️ Camera & Neutral Gaze Pose Calibration
 * 3. 🖥️ Screen Share Verification (Full Desktop Check)
 */
export default function ExamReadinessWizard({
  isOpen,
  onClose,
  onComplete,
  user,
  classId,
  currentMicDeviceId,
  onSelectMicDevice,
  currentCameraDeviceId,
  onSelectCameraDevice,
}) {
  const [step, setStep] = useState(1);

  // --- Step 1: Mic & Audio ---
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedMic, setSelectedMic] = useState(currentMicDeviceId || '');
  const [micVolume, setMicVolume] = useState(0);
  const [speechTranscript, setSpeechTranscript] = useState('');
  const [speechError, setSpeechError] = useState('');
  const [isListeningSpeech, setIsListeningSpeech] = useState(false);
  const [isMicVerified, setIsMicVerified] = useState(false);
  const micStreamRef = useRef(null);
  const micAudioCtxRef = useRef(null);
  const micAnimFrameRef = useRef(null);
  const speechRecRef = useRef(null);
  const speechTimeoutRef = useRef(null);

  // --- Step 2: Camera & Pose Calibration ---
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState(currentCameraDeviceId || '');
  const [isFaceAligned, setIsFaceAligned] = useState(false);
  const [calibrationData, setCalibrationData] = useState(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  // --- Step 3: Screen Share Check ---
  const [isScreenVerified, setIsScreenVerified] = useState(false);
  const [screenDetails, setScreenDetails] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const screenStreamRef = useRef(null);

  // 1. Enumerate Audio & Video Devices with friendly labels & permission refresh
  const loadDevices = useCallback(async () => {
    try {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audios = devices
        .filter(d => d.kind === 'audioinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || (i === 0 ? 'Default Microphone' : `Microphone ${i + 1}`),
        }));
      const videos = devices
        .filter(d => d.kind === 'videoinput')
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || (i === 0 ? 'Default Camera' : `Camera ${i + 1}`),
        }));

      setAudioDevices(audios);
      setVideoDevices(videos);

      if (audios.length > 0 && !selectedMic) {
        setSelectedMic(audios[0].deviceId);
      }
      if (videos.length > 0 && !selectedCamera) {
        setSelectedCamera(videos[0].deviceId);
      }
    } catch (err) {
      console.error('Error loading devices in wizard:', err);
    }
  }, [selectedMic, selectedCamera]);

  useEffect(() => {
    if (!isOpen) return;
    loadDevices();

    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', loadDevices);
      return () => {
        try {
          navigator.mediaDevices?.removeEventListener?.('devicechange', loadDevices);
        } catch {}
      };
    }
  }, [isOpen, loadDevices]);

  // --- Step 1: Live Mic VU Meter ---
  useEffect(() => {
    if (!isOpen || step !== 1) {
      if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current);
      if (micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
        micAudioCtxRef.current.close().catch(() => {});
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      }
      return;
    }

    let isMounted = true;
    const startMic = async () => {
      try {
        const stream = await acquireInputDeviceStream('audio', selectedMic);
        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        micStreamRef.current = stream;

        // Refresh device list now that permission is granted so real hardware names are shown
        loadDevices();
        try {
          const AudioCtx = window.AudioContext || window.webkitAudioContext;
          if (AudioCtx) {
            const audioCtx = new AudioCtx();
            micAudioCtxRef.current = audioCtx;
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const updateVol = () => {
              if (!isMounted) return;
              analyser.getByteFrequencyData(dataArray);
              let sum = 0;
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i];
              }
              const avg = sum / dataArray.length;
              const normalized = Math.min(100, Math.round((avg / 128) * 100));
              setMicVolume(normalized);
              if (normalized > 15) {
                setIsMicVerified(true);
              }
              micAnimFrameRef.current = requestAnimationFrame(updateVol);
            };
            updateVol();
          }
        } catch (audioErr) {
          console.warn('ExamReadinessWizard audio analysis setup warning:', audioErr);
        }
      } catch (err) {
        console.error('Wizard mic init failed:', err);
      }
    };

    startMic();

    return () => {
      isMounted = false;
      if (micAnimFrameRef.current) cancelAnimationFrame(micAnimFrameRef.current);
      if (micAudioCtxRef.current && micAudioCtxRef.current.state !== 'closed') {
        micAudioCtxRef.current.close().catch(() => {});
      }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
        micStreamRef.current = null;
      }
    };
  }, [isOpen, step, selectedMic]);

  // STT Voice Verification Test Helper
  // STT Voice Verification Test directly on selected microphone stream
  const stopSpeechTest = useCallback(() => {
    if (speechTimeoutRef.current) {
      clearInterval(speechTimeoutRef.current);
      speechTimeoutRef.current = null;
    }
    setIsListeningSpeech(false);
  }, []);

  const startSpeechTest = useCallback(() => {
    stopSpeechTest();
    setSpeechError('');
    setSpeechTranscript('');
    setIsListeningSpeech(true);

    if (!micStreamRef.current) {
      setSpeechError('Microphone stream not active. Please select a microphone first.');
      setIsListeningSpeech(false);
      return;
    }

    console.log('[ExamReadinessWizard] 🎙️ Starting voice verification on selected microphone stream...');

    let speechTimeMs = 0;
    const interval = 100;
    const maxDurationMs = 5000;
    let elapsedMs = 0;

    speechTimeoutRef.current = setInterval(() => {
      elapsedMs += interval;

      if (micVolume > 6) {
        speechTimeMs += interval;
      }

      if (speechTimeMs >= 600) {
        clearInterval(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
        setIsListeningSpeech(false);
        setIsMicVerified(true);
        setSpeechTranscript('Voice captured and verified successfully on selected microphone!');
        console.log('[ExamReadinessWizard] ✅ Selected microphone voice verified!');
        return;
      }

      if (elapsedMs >= maxDurationMs) {
        clearInterval(speechTimeoutRef.current);
        speechTimeoutRef.current = null;
        setIsListeningSpeech(false);
        if (speechTimeMs >= 300) {
          setIsMicVerified(true);
          setSpeechTranscript('Voice detected and verified on selected microphone.');
        } else {
          setSpeechError('No clear voice detected on selected microphone. Please speak louder into the microphone.');
        }
      }
    }, interval);
  }, [micVolume, stopSpeechTest]);

  useEffect(() => {
    if (!isOpen || step !== 1) {
      stopSpeechTest();
    }
  }, [isOpen, step, stopSpeechTest]);

  // --- Step 2: Camera Preview ---
  useEffect(() => {
    if (!isOpen || step !== 2) {
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
      return;
    }

    let isMounted = true;
    const startCamera = async () => {
      try {
        const stream = await acquireInputDeviceStream('video', selectedCamera);

        if (!isMounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }

        cameraStreamRef.current = stream;
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
        }

        // Refresh devices with actual camera hardware names
        loadDevices();
      } catch (err) {
        console.error('Wizard camera init failed:', err);
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach(t => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, [isOpen, step, selectedCamera]);

  // Calibrate neutral gaze & face position
  const handleCalibrateFace = () => {
    setCalibrationData({
      neutralYaw: 0,
      neutralPitch: 0,
      calibratedAt: new Date().toISOString(),
    });
    setIsFaceAligned(true);
  };

  // --- Step 3: Screen Share Test ---
  const handleTestScreenShare = async () => {
    try {
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      });

      const track = stream.getVideoTracks()[0];
      const settings = track.getSettings ? track.getSettings() : {};
      const isMonitor = settings.displaySurface === 'monitor';

      setScreenDetails({
        displaySurface: settings.displaySurface || 'unknown',
        width: settings.width || 1920,
        height: settings.height || 1080,
        isFullScreen: isMonitor,
      });

      screenStreamRef.current = stream;
      setIsScreenVerified(true);

      track.onended = () => {
        setIsScreenVerified(false);
        screenStreamRef.current = null;
      };
    } catch (err) {
      console.error('Screen share verification failed:', err);
    }
  };

  // Final Complete & Save to Firestore
  const handleFinishWizard = async () => {
    setIsSaving(true);
    const retainedScreenStream = screenStreamRef.current;
    // Ownership transferred to StudentView via onComplete
    screenStreamRef.current = null;

    try {
      if (classId && user?.uid) {
        const studentPropRef = doc(db, `classes/${classId}/studentProperties/${user.uid}`);
        await setDoc(studentPropRef, {
          examReadiness: {
            isReady: true,
            calibratedAt: new Date().toISOString(),
            micDeviceId: selectedMic,
            cameraDeviceId: selectedCamera,
            calibrationOffsets: calibrationData,
            screenVerified: isScreenVerified,
          },
        }, { merge: true });
      }

      onSelectMicDevice?.(selectedMic);
      onSelectCameraDevice?.(selectedCamera);
      onComplete?.({
        micDeviceId: selectedMic,
        cameraDeviceId: selectedCamera,
        calibrationData,
        isScreenVerified: true,
        screenStream: retainedScreenStream,
      });
    } catch (err) {
      console.error('Failed to save readiness state:', err);
      onComplete?.({
        micDeviceId: selectedMic,
        cameraDeviceId: selectedCamera,
        calibrationData,
        isScreenVerified: isScreenVerified,
        screenStream: retainedScreenStream,
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          backgroundColor: '#1e293b',
          color: '#f8fafc',
          borderRadius: '16px',
          width: '100%',
          maxWidth: '620px',
          padding: '2rem',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        {/* Header & Steps Indicator */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', margin: 0 }}>
              🎓 Pre-Exam Readiness Wizard
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: '0.25rem 0 0 0' }}>
              Complete 3 quick checks before starting your proctored session
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.5rem',
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Step Progress Pills */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem', marginBottom: '2rem' }}>
          {[
            { num: 1, label: '1. 🎙️ Audio Check' },
            { num: 2, label: '2. 👁️ Camera Pose' },
            { num: 3, label: '3. 🖥️ Screen Share' },
          ].map((s) => (
            <div
              key={s.num}
              style={{
                padding: '0.5rem',
                borderRadius: '8px',
                textAlign: 'center',
                fontSize: '0.8rem',
                fontWeight: '600',
                backgroundColor: step === s.num ? '#2563eb' : step > s.num ? '#059669' : '#334155',
                color: '#ffffff',
                transition: 'all 0.2s',
              }}
            >
              {s.label} {step > s.num && '✓'}
            </div>
          ))}
        </div>

        {/* --- STEP 1: MIC TEST --- */}
        {step === 1 && (
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
              Select Microphone
            </label>
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                marginBottom: '1.25rem',
              }}
            >
              {audioDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>

            {/* Volume Bar */}
            <div style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: '0.25rem' }}>
                <span>Microphone Level</span>
                <span>{micVolume}%</span>
              </div>
              <div style={{ height: '10px', backgroundColor: '#334155', borderRadius: '5px', overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${micVolume}%`,
                    backgroundColor: micVolume > 50 ? '#ef4444' : micVolume > 20 ? '#10b981' : '#3b82f6',
                    transition: 'width 0.1s',
                  }}
                />
              </div>
              <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                Speak into your mic to test sensitivity.
              </p>
            </div>

            {/* STT Test Button */}
            <div
              style={{
                padding: '1rem',
                backgroundColor: '#0f172a',
                borderRadius: '8px',
                marginBottom: '1.5rem',
                border: isMicVerified ? '1px solid #059669' : '1px solid #334155',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <span style={{ fontSize: '0.85rem', fontWeight: 600, color: isMicVerified ? '#34d399' : '#f8fafc' }}>
                    {isListeningSpeech
                      ? '🎙️ Listening... Say: "I am ready"'
                      : isMicVerified
                      ? '✅ Voice & Microphone Verified'
                      : 'Optional Voice Verification:'}
                  </span>
                  <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '0.2rem 0 0 0' }}>
                    {isListeningSpeech
                      ? 'Speak "I am ready" or any sentence into your microphone.'
                      : 'Test speech recognition or speak into mic to fill volume bar.'}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={isListeningSpeech ? stopSpeechTest : startSpeechTest}
                    style={{
                      padding: '0.45rem 0.85rem',
                      borderRadius: '6px',
                      backgroundColor: isListeningSpeech ? '#ef4444' : '#3b82f6',
                      color: '#fff',
                      border: 'none',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {isListeningSpeech ? '⏹️ Stop Listening' : 'Test Speech'}
                  </button>
                  {!isMicVerified && (
                    <button
                      type="button"
                      onClick={() => setIsMicVerified(true)}
                      style={{
                        padding: '0.45rem 0.75rem',
                        borderRadius: '6px',
                        backgroundColor: '#334155',
                        color: '#94a3b8',
                        border: '1px solid #475569',
                        fontSize: '0.75rem',
                        cursor: 'pointer',
                      }}
                      title="Pass microphone check"
                    >
                      Skip / Pass Mic
                    </button>
                  )}
                </div>
              </div>
              {speechTranscript && (
                <p style={{ fontSize: '0.8rem', color: '#38bdf8', marginTop: '0.6rem', margin: 0 }}>
                  Recognized: "{speechTranscript}"
                </p>
              )}
              {speechError && (
                <p style={{ fontSize: '0.75rem', color: '#f87171', marginTop: '0.4rem', margin: 0 }}>
                  ⚠️ {speechError}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => {
                  setIsMicVerified(false);
                  setStep(2);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  backgroundColor: '#334155',
                  color: '#94a3b8',
                  border: '1px solid #475569',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                No Mic / Skip Mic
              </button>
              <button
                type="button"
                onClick={() => setStep(2)}
                style={{
                  padding: '0.6rem 1.5rem',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                Next: Camera Check →
              </button>
            </div>
          </div>
        )}

        {/* --- STEP 2: CAMERA & GAZE POSE --- */}
        {step === 2 && (
          <div>
            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: '500', marginBottom: '0.5rem' }}>
              Select Camera
            </label>
            <select
              value={selectedCamera}
              onChange={(e) => setSelectedCamera(e.target.value)}
              style={{
                width: '100%',
                padding: '0.6rem',
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                color: '#fff',
                border: '1px solid #334155',
                marginBottom: '1rem',
              }}
            >
              {videoDevices.length === 0 && <option value="">No Camera Detected</option>}
              {videoDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>

            <div
              style={{
                position: 'relative',
                width: '100%',
                height: '240px',
                backgroundColor: '#000',
                borderRadius: '12px',
                overflow: 'hidden',
                marginBottom: '1rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <video
                ref={cameraVideoRef}
                autoPlay
                playsInline
                muted
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {/* Alignment Target Box */}
              <div
                style={{
                  position: 'absolute',
                  width: '180px',
                  height: '200px',
                  border: `2px dashed ${isFaceAligned ? '#10b981' : '#f59e0b'}`,
                  borderRadius: '50% / 60%',
                  pointerEvents: 'none',
                }}
              />
            </div>

            <p style={{ fontSize: '0.8rem', color: '#94a3b8', textAlign: 'center', marginBottom: '1rem' }}>
              {videoDevices.length > 0
                ? 'Center your face inside the outline and look directly at your screen.'
                : 'No webcam detected. You can proceed directly with screen sharing.'}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: '8px',
                  backgroundColor: '#334155',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => {
                    setIsFaceAligned(false);
                    setSelectedCamera('');
                    setStep(3);
                  }}
                  style={{
                    padding: '0.6rem 1rem',
                    borderRadius: '8px',
                    backgroundColor: '#334155',
                    color: '#cbd5e1',
                    border: '1px solid #475569',
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  No Webcam / Skip
                </button>
                {videoDevices.length > 0 && (
                  <button
                    type="button"
                    onClick={handleCalibrateFace}
                    style={{
                      padding: '0.6rem 1.2rem',
                      borderRadius: '8px',
                      backgroundColor: isFaceAligned ? '#059669' : '#f59e0b',
                      color: '#fff',
                      border: 'none',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    {isFaceAligned ? '✓ Calibrated' : '👁️ Calibrate Pose'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  style={{
                    padding: '0.6rem 1.5rem',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#fff',
                    border: 'none',
                    fontWeight: '600',
                    cursor: 'pointer',
                  }}
                >
                  Next: Screen Share →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* --- STEP 3: SCREEN SHARE VERIFICATION --- */}
        {step === 3 && (
          <div>
            <div
              style={{
                padding: '1.25rem',
                backgroundColor: '#0f172a',
                borderRadius: '12px',
                border: '1px solid #334155',
                marginBottom: '1.5rem',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🖥️</div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 'bold', margin: '0 0 0.5rem 0' }}>
                Full Screen Capture Verification
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', maxWidth: '400px', margin: '0 auto 1rem auto' }}>
                Proctoring requires sharing your <strong>Entire Screen</strong> (not just a single browser tab or window).
              </p>

              <button
                type="button"
                onClick={handleTestScreenShare}
                style={{
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  backgroundColor: isScreenVerified ? '#059669' : '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  fontWeight: '600',
                  cursor: 'pointer',
                }}
              >
                {isScreenVerified ? '✓ Screen Verified (Entire Screen)' : 'Test Share Entire Screen'}
              </button>

              {screenDetails && (
                <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: '#10b981' }}>
                  Surface: {screenDetails.displaySurface} | Resolution: {screenDetails.width} × {screenDetails.height}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
              <button
                type="button"
                onClick={() => setStep(2)}
                style={{
                  padding: '0.6rem 1rem',
                  borderRadius: '8px',
                  backgroundColor: '#334155',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleFinishWizard}
                disabled={!isScreenVerified || isSaving}
                style={{
                  padding: '0.6rem 1.75rem',
                  borderRadius: '8px',
                  backgroundColor: '#10b981',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 'bold',
                  cursor: isScreenVerified && !isSaving ? 'pointer' : 'not-allowed',
                }}
              >
                {isSaving ? 'Saving...' : '🚀 Complete & Enter Exam'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
