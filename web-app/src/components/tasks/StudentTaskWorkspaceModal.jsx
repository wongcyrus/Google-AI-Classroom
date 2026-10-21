import React, { useState, useEffect, useRef, useCallback } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../../firebase-config';
import {
  canStartTask,
  calculateRemainingTime,
  formatRemainingTime,
} from '../../utils/taskConstraintUtils';
import './tasks.css';

const StudentTaskWorkspaceModal = ({
  isOpen,
  onClose,
  task,
  submission,
  classId = null,
  user = null,
  captureInterval = 15,
  existingScreenStream = null,
  onStartAttempt,
  onFinishAttempt,
}) => {
  const [sessionState, setSessionState] = useState('preflight'); // 'preflight' | 'active' | 'submitting' | 'submitted'
  const [activeAttempt, setActiveAttempt] = useState(null);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [isExpired, setIsExpired] = useState(false);
  const [screenStream, setScreenStream] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionResult, setSubmissionResult] = useState(null);
  const [demoPlaybackUrl, setDemoPlaybackUrl] = useState(null);

  const videoPreviewRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const captureIntervalRef = useRef(null);
  const ownedStreamRef = useRef(null);
  const isSubmittingRef = useRef(false);

  const stopOwnedStream = useCallback(() => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (ownedStreamRef.current) {
      try {
        ownedStreamRef.current.getTracks?.().forEach((t) => t.stop?.());
      } catch {}
      ownedStreamRef.current = null;
    }
  }, []);

  // Resolve Cloud Storage demo video playback URL when demoVideoPath is not a YouTube video
  useEffect(() => {
    if (!isOpen || !task?.demoVideoPath || task.youtubeVideoId) {
      setDemoPlaybackUrl(null);
      return;
    }
    if (task.demoVideoPath.startsWith('http://') || task.demoVideoPath.startsWith('https://')) {
      setDemoPlaybackUrl(task.demoVideoPath);
      return;
    }
    let cancelled = false;
    try {
      const fileRef = ref(storage, task.demoVideoPath);
      getDownloadURL(fileRef)
        .then((url) => {
          if (!cancelled) setDemoPlaybackUrl(url);
        })
        .catch(() => {
          if (!cancelled) setDemoPlaybackUrl(null);
        });
    } catch {
      setDemoPlaybackUrl(null);
    }
    return () => {
      cancelled = true;
    };
  }, [isOpen, task?.demoVideoPath, task?.youtubeVideoId]);

  // Capture a single frame from videoPreviewRef when operating standalone (without StudentView capture loop)
  const captureStandaloneFrame = useCallback(async (attemptObj) => {
    if (existingScreenStream || !classId || !user?.uid || !task?.id) return;
    const videoEl = videoPreviewRef.current;
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) return;

    try {
      const canvas = document.createElement('canvas');
      const maxWidth = 1280;
      const scale = videoEl.videoWidth > maxWidth ? maxWidth / videoEl.videoWidth : 1;
      canvas.width = Math.max(2, Math.floor(videoEl.videoWidth * scale));
      canvas.height = Math.max(2, Math.floor(videoEl.videoHeight * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) return;

      const tsMs = Date.now();
      const imagePath = `screenshots/${classId}/${user.uid}/${tsMs}-screen.jpg`;
      const storageRef = ref(storage, imagePath);
      await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' });

      const docId = `screenshot_${classId}_${user.uid}_${tsMs}_screen`;
      await setDoc(
        doc(db, 'screenshots', docId),
        {
          classId,
          studentUid: user.uid,
          email: user.email?.toLowerCase() || '',
          imagePath,
          timestamp: new Date(tsMs),
          channel: 'screen',
          deleted: false,
          activeTaskId: task.id,
          activeAttemptNumber: attemptObj?.attemptNumber || 1,
        },
        { merge: true }
      );
    } catch (err) {
      console.debug('[StudentTaskWorkspaceModal] Standalone frame capture skipped:', err);
    }
  }, [existingScreenStream, classId, user?.uid, user?.email, task?.id]);

  // Check pre-flight eligibility
  const eligibility = canStartTask(task, submission);

  useEffect(() => {
    if (!isOpen) {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      stopOwnedStream();
      return;
    }

    if (eligibility.isResume && eligibility.activeAttempt) {
      setActiveAttempt(eligibility.activeAttempt);
      if (existingScreenStream) {
        setScreenStream(existingScreenStream);
      }
      setSessionState('active');
    } else {
      setSessionState('preflight');
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      stopOwnedStream();
    };
  }, [isOpen, task?.id]);

  // Autonomous screenshot capture loop when operating standalone (e.g., from StudentRecordsView or when StudentView isn't already capturing)
  useEffect(() => {
    if (sessionState !== 'active' || !screenStream || existingScreenStream || !classId || !user?.uid) {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
      return;
    }

    const initialTimer = setTimeout(() => {
      captureStandaloneFrame(activeAttempt);
    }, 600);

    const intervalMs = Math.max(5, Number(captureInterval) || 15) * 1000;
    captureIntervalRef.current = setInterval(() => {
      captureStandaloneFrame(activeAttempt);
    }, intervalMs);

    return () => {
      clearTimeout(initialTimer);
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };
  }, [sessionState, screenStream, existingScreenStream, classId, user?.uid, captureInterval, activeAttempt, captureStandaloneFrame]);

  // Live Timer Countdown Loop
  useEffect(() => {
    if (sessionState !== 'active' || !activeAttempt) return;

    const timeLimit = task?.constraints?.timing?.timeLimitMinutes || 0;
    if (timeLimit <= 0) return;

    const tick = () => {
      const calc = calculateRemainingTime(activeAttempt, timeLimit);
      setRemainingSeconds(calc.remainingSeconds);
      setIsExpired(calc.isExpired);

      if (calc.isExpired && task?.constraints?.timing?.autoSubmitOnExpiry) {
        if (timerIntervalRef.current) {
          clearInterval(timerIntervalRef.current);
          timerIntervalRef.current = null;
        }
        handleAutoSubmit();
      }
    };

    tick();
    timerIntervalRef.current = setInterval(tick, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [sessionState, activeAttempt, task]);

  // Handle Video Stream for Preview
  useEffect(() => {
    if (videoPreviewRef.current && screenStream) {
      videoPreviewRef.current.srcObject = screenStream;
    }
  }, [screenStream, sessionState]);

  if (!isOpen || !task) return null;

  const handleStartTask = async () => {
    try {
      let stream = existingScreenStream;
      if (!stream) {
        stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        ownedStreamRef.current = stream;
      }
      setScreenStream(stream);

      const attemptNumber = eligibility.isResume && eligibility.activeAttempt?.attemptNumber
        ? eligibility.activeAttempt.attemptNumber
        : (submission?.attemptsCount || 0) + 1;
      const startedAttempt = eligibility.isResume && eligibility.activeAttempt
        ? eligibility.activeAttempt
        : {
            attemptNumber,
            startedAt: new Date(),
            status: 'in_progress',
          };

      setActiveAttempt(startedAttempt);
      setSessionState('active');

      if (onStartAttempt) {
        await onStartAttempt(task.id, startedAttempt);
      }
    } catch (err) {
      console.error('Failed to start task screen sharing:', err);
      alert('Screen sharing is required to start this practical task: ' + err.message);
    }
  };

  const handleFinishTask = async () => {
    if (isSubmitting || isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSessionState('submitting');

    try {
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }

      // Capture final frame before sealing attempt if running standalone
      await captureStandaloneFrame(activeAttempt);
      stopOwnedStream();

      let evalResult = null;
      if (onFinishAttempt) {
        evalResult = await onFinishAttempt(task.id, activeAttempt);
      }

      setSubmissionResult(evalResult);
      setSessionState('submitted');
    } catch (err) {
      console.error('Failed to submit task attempt:', err);
      alert('Error submitting attempt: ' + err.message);
      setSessionState('active');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleAutoSubmit = async () => {
    console.warn('Task time limit expired! Triggering automated auto-submit.');
    await handleFinishTask();
  };

  const isLowTime = remainingSeconds > 0 && remainingSeconds <= 300; // < 5 mins
  const isCriticalTime = remainingSeconds > 0 && remainingSeconds <= 60; // < 1 min

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-70 backdrop-blur-md p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[94vh] flex flex-col border border-gray-200 overflow-hidden">
        {/* PREFLIGHT STATE */}
        {sessionState === 'preflight' && (
          <div className="p-8 space-y-6">
            <div className="flex justify-between items-start border-b border-gray-100 pb-4">
              <div>
                <span className="text-xs font-bold text-blue-600 uppercase tracking-wider">
                  Practical Task Challenge
                </span>
                <h2 className="text-2xl font-black text-gray-900 mt-1">
                  {task.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="task-btn-close"
                aria-label="Close modal"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Constraints Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-center">
                <span className="text-[11px] text-gray-500 block font-semibold">Time Limit</span>
                <span className="text-sm font-bold text-gray-800">
                  {task.constraints?.timing?.timeLimitMinutes
                    ? `${task.constraints.timing.timeLimitMinutes} Mins`
                    : 'Unlimited'}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-center">
                <span className="text-[11px] text-gray-500 block font-semibold">Attempts</span>
                <span className="text-sm font-bold text-gray-800">
                  {(submission?.attemptsCount || 0)} / {task.constraints?.attempts?.maxAttempts || 1}
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-center">
                <span className="text-[11px] text-gray-500 block font-semibold">Max Score</span>
                <span className="text-sm font-bold text-blue-600">
                  {task.maxScore || 100} Points
                </span>
              </div>
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-center">
                <span className="text-[11px] text-gray-500 block font-semibold">Proctoring</span>
                <span className="text-sm font-bold text-gray-800">
                  {task.constraints?.proctoring?.requiredChannel === 'dual_screen_webcam'
                    ? 'Screen + Webcam'
                    : 'Screen Sharing'}
                </span>
              </div>
            </div>

            {/* Reference Demonstration Video (if attached) */}
            {(task.youtubeVideoId || task.youtubeUrl || task.demoVideoPath) && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-blue-900 flex items-center gap-1.5 uppercase tracking-wide">
                    <span>🎥</span> Instructor Reference Demonstration
                  </h4>
                  {task.youtubeVideoId && (
                    <a
                      href={`https://www.youtube.com/watch?v=${task.youtubeVideoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-700 hover:text-blue-900 font-bold hover:underline inline-flex items-center gap-1"
                    >
                      <span>Watch on YouTube</span>
                      <span>↗</span>
                    </a>
                  )}
                </div>
                {task.youtubeVideoId ? (
                  <div className="aspect-video w-full rounded-lg overflow-hidden bg-black shadow-sm">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${task.youtubeVideoId}`}
                      title="Instructor Demo Video"
                      className="w-full h-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : demoPlaybackUrl ? (
                  <div className="aspect-video w-full rounded-lg overflow-hidden bg-black shadow-sm">
                    <video
                      src={demoPlaybackUrl}
                      controls
                      className="w-full h-full object-contain"
                    />
                  </div>
                ) : (
                  <p className="text-xs font-mono text-gray-700 bg-white p-2 rounded-lg border border-gray-200 truncate">
                    📹 Reference clip: {task.demoVideoPath}
                  </p>
                )}
              </div>
            )}

            {/* Description & Overview */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-gray-700 uppercase">
                Task Requirements
              </h4>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-800 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                {task.description || 'Follow instructions and complete all steps.'}
              </div>
            </div>

            {/* Checklist of Expected Milestones */}
            {task.rubricSteps && task.rubricSteps.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-700 uppercase">
                  Milestones to Complete ({task.rubricSteps.length})
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {task.rubricSteps.map((step, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-gray-50 border border-gray-200 rounded-lg text-xs flex items-center justify-between"
                    >
                      <span className="font-semibold text-gray-800">
                        {step.stepNumber}. {step.title}
                      </span>
                      <span className="font-bold text-blue-600">{step.points} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Eligibility Block or Start Button */}
            <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
              <button
                type="button"
                onClick={onClose}
                className="task-btn-cancel"
              >
                <span>✕</span>
                <span>Back to Dashboard</span>
              </button>

              {task.scheduleMode === 'retroactive' ? (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-1 text-right max-w-md">
                  <div className="font-bold flex items-center justify-end gap-1.5">
                    <span>⏪</span>
                    <span>Post-Class Practical Challenge</span>
                  </div>
                  <p>
                    This assignment is automatically extracted from your in-class screen recording. Your instructor processes submissions and grades them using AI evaluation without requiring a manual attempt.
                  </p>
                </div>
              ) : eligibility.allowed ? (
                <button
                  onClick={handleStartTask}
                  className="px-8 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-black text-base rounded-xl shadow-lg flex items-center gap-2 transform active:scale-95 transition-all"
                >
                  <span>▶</span>
                  <span>{eligibility.isResume ? 'Resume Attempt' : 'Start Task Challenge'}</span>
                </button>
              ) : (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 font-semibold">
                  ⚠️ {eligibility.reason}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ACTIVE ATTEMPT STATE */}
        {sessionState === 'active' && (
          <div className="flex-1 flex flex-col h-full">
            {/* Top HUD Bar */}
            <div className="px-6 py-3 bg-gray-900 text-white flex justify-between items-center border-b border-gray-700">
              <div className="flex items-center gap-3">
                <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <h3 className="font-bold text-sm tracking-wide">{task.title}</h3>
                <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-300">
                  Attempt #{activeAttempt?.attemptNumber || 1}
                </span>
              </div>

              {/* Timer HUD */}
              {task.constraints?.timing?.timeLimitMinutes > 0 && (
                <div
                  className={`flex items-center gap-2 px-3 py-1 rounded-lg font-mono text-sm font-bold tracking-wider ${
                    isCriticalTime
                      ? 'bg-red-600 text-white animate-bounce'
                      : isLowTime
                      ? 'bg-amber-500 text-black'
                      : 'bg-gray-800 text-emerald-400'
                  }`}
                >
                  <span>⏱️</span>
                  <span>{formatRemainingTime(remainingSeconds)}</span>
                </div>
              )}

              <button
                onClick={handleFinishTask}
                className="px-5 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold text-xs rounded-lg shadow flex items-center gap-1.5 transition-colors"
              >
                <span>🏁</span>
                <span>Finish & Submit</span>
              </button>
            </div>

            {/* Split Workspace */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4 p-6 overflow-y-auto">
              {/* Left Panel: Instructions & Milestones */}
              <div className="space-y-4">
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase">Instructions</h4>
                  <p className="text-xs text-gray-700 font-mono whitespace-pre-wrap">
                    {task.description}
                  </p>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-500 uppercase">Required Milestones</h4>
                  {(task.rubricSteps || []).map((step, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-white border border-gray-200 rounded-xl space-y-1"
                    >
                      <div className="flex justify-between items-center text-xs font-bold text-gray-800">
                        <span>
                          {step.stepNumber}. {step.title}
                        </span>
                        <span className="text-blue-600">{step.points} pts</span>
                      </div>
                      <p className="text-[11px] text-gray-500">{step.description}</p>
                      {step.expectedEvidence && (
                        <p className="text-[10px] text-gray-400 font-mono">
                          🔍 Proof: {step.expectedEvidence}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Panel: Screen Share Preview & Status */}
              <div className="space-y-4 flex flex-col">
                <div className="flex-1 bg-black rounded-xl border border-gray-800 overflow-hidden relative flex items-center justify-center min-h-[260px]">
                  <video
                    ref={videoPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Live Screen Recording Active</span>
                  </div>
                </div>

                <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900">
                  💡 <strong>Tip:</strong> Keep sharing your screen while completing the exercise in your IDE, terminal, or browser. When finished, return to this tab and click <strong>Finish & Submit</strong>.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* SUBMITTING STATE */}
        {sessionState === 'submitting' && (
          <div className="p-12 text-center space-y-4 my-auto">
            <div className="text-4xl animate-spin inline-block">🔄</div>
            <h3 className="text-xl font-bold text-gray-900">
              Submitting Task Attempt...
            </h3>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              Sealing attempt buffers and registering for automated class video combination and grading.
            </p>
          </div>
        )}

        {/* SUBMITTED / FEEDBACK PREVIEW STATE */}
        {sessionState === 'submitted' && (
          <div className="p-8 space-y-6 text-center my-auto">
            <div className="text-5xl">🎉</div>
            <h3 className="text-2xl font-black text-gray-900">
              Attempt Submitted Successfully!
            </h3>
            <p className="text-sm text-gray-600 max-w-md mx-auto">
              Your screen recording for <strong>{task.title}</strong> has been sealed. Your submission clip will be compiled and evaluated by Gemini once the class video combines.
            </p>
            <div className="pt-4">
              <button
                onClick={onClose}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentTaskWorkspaceModal;
