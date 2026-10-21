import React, { useRef, useState, useEffect } from 'react';
import { ref, getDownloadURL } from 'firebase/storage';
import { storage } from '../../firebase-config';
import { isFeedbackReleased } from '../../utils/taskConstraintUtils';
import './tasks.css';

const StudentTaskFeedbackView = ({
  task,
  submission,
  onBack,
  videoPlaybackUrl = null,
}) => {
  const videoRef = useRef(null);
  const [resolvedVideoUrl, setResolvedVideoUrl] = useState(videoPlaybackUrl);

  const storageVideoPath =
    submission?.compiledVideoPath ||
    submission?.latestAttempt?.compiledVideoPath ||
    submission?.videoPath ||
    null;

  useEffect(() => {
    if (videoPlaybackUrl) {
      setResolvedVideoUrl(videoPlaybackUrl);
      return;
    }
    if (!storageVideoPath || !storage) {
      setResolvedVideoUrl(null);
      return;
    }
    let cancelled = false;
    getDownloadURL(ref(storage, storageVideoPath))
      .then((url) => {
        if (!cancelled) setResolvedVideoUrl(url);
      })
      .catch((err) => {
        console.warn('Could not resolve feedback video playback URL:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [videoPlaybackUrl, storageVideoPath]);

  if (!task || !submission) {
    return (
      <div className="p-8 text-center text-gray-500">
        No task or evaluation details found.
      </div>
    );
  }

  if (!isFeedbackReleased(task, submission)) {
    const releaseMode = task?.constraints?.attempts?.feedbackRelease;
    return (
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-gray-200 text-center space-y-3">
        {onBack && (
          <div className="text-left">
            <button
              onClick={onBack}
              className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1 mb-2"
            >
              ← Back to My Tasks
            </button>
          </div>
        )}
        <div className="text-4xl">🔒</div>
        <h3 className="text-lg font-bold text-gray-900">
          Feedback Pending Release
        </h3>
        <p className="text-xs text-gray-600 max-w-md mx-auto">
          {releaseMode === 'after_deadline'
            ? 'Your submission has been graded! Detailed rubric feedback and scores will unlock automatically after the task deadline passes.'
            : 'Your submission has been recorded. Detailed rubric feedback and scores will be visible once released by your instructor.'}
        </p>
      </div>
    );
  }

  const evalData = submission.evaluation || {};
  const maxScore = task.maxScore || 100;
  const effectiveScore = typeof submission.teacherOverride?.manualScore === 'number'
    ? submission.teacherOverride.manualScore
    : (typeof submission.effectiveScore === 'number' ? submission.effectiveScore : (evalData.finalScore ?? 0));

  const percentage = Math.round((effectiveScore / maxScore) * 100);
  const rawStepResults = evalData.stepResults || evalData.rubricScores || [];
  const stepOverrides = submission.teacherOverride?.stepOverrides || {};
  const taskRubric = Array.isArray(task.rubricSteps) ? task.rubricSteps : [];

  const stepResults =
    taskRubric.length > 0
      ? taskRubric.map((rStep, idx) => {
          const stepNum = Number(rStep.stepNumber ?? idx + 1);
          const maxPoints = Number(rStep.points ?? rStep.weight ?? 0);
          const matchedEval =
            rawStepResults.find((s) => Number(s?.stepNumber) === stepNum) ||
            rawStepResults.find(
              (s) =>
                s?.title &&
                rStep.title &&
                String(s.title).trim().toLowerCase() === String(rStep.title).trim().toLowerCase()
            ) ||
            rawStepResults[idx] ||
            {};
          const override = stepOverrides[stepNum] || stepOverrides[String(stepNum)] || null;
          const scoreAwarded =
            override?.scoreAwarded !== undefined &&
            override?.scoreAwarded !== null &&
            override?.scoreAwarded !== ''
              ? Number(override.scoreAwarded)
              : matchedEval.scoreAwarded !== undefined && matchedEval.scoreAwarded !== null
              ? Number(matchedEval.scoreAwarded)
              : 0;
          const status =
            override?.status ||
            matchedEval.status ||
            (maxPoints > 0 && scoreAwarded >= maxPoints
              ? 'completed'
              : scoreAwarded > 0
              ? 'partial'
              : 'missing');

          return {
            stepNumber: stepNum,
            title: rStep.title || matchedEval.title || `Step ${stepNum}`,
            description: rStep.description || '',
            expectedEvidence: matchedEval.expectedEvidence || rStep.expectedEvidence || '',
            gradingCriteria: matchedEval.gradingCriteria || rStep.gradingCriteria || '',
            maxPoints,
            scoreAwarded,
            status,
            timestampInVideo: matchedEval.timestampInVideo || matchedEval.timestamp || null,
            evidenceObserved: matchedEval.evidenceObserved || matchedEval.evidence || '',
            feedback:
              override?.teacherFeedback ||
              matchedEval.feedback ||
              matchedEval.rationale ||
              matchedEval.explanation ||
              '',
            teacherFeedback: override?.teacherFeedback || '',
          };
        })
      : rawStepResults.map((s, idx) => {
          const stepNum = Number(s.stepNumber ?? idx + 1);
          const override = stepOverrides[stepNum] || stepOverrides[String(stepNum)] || null;
          const maxPoints = Number(s.maxPoints ?? s.points ?? 0);
          const scoreAwarded =
            override?.scoreAwarded !== undefined &&
            override?.scoreAwarded !== null &&
            override?.scoreAwarded !== ''
              ? Number(override.scoreAwarded)
              : Number(s.scoreAwarded ?? 0);
          return {
            ...s,
            stepNumber: stepNum,
            title: s.title || `Step ${stepNum}`,
            maxPoints,
            scoreAwarded,
            status:
              override?.status ||
              s.status ||
              (maxPoints > 0 && scoreAwarded >= maxPoints
                ? 'completed'
                : scoreAwarded > 0
                ? 'partial'
                : 'missing'),
            feedback: override?.teacherFeedback || s.feedback || '',
            teacherFeedback: override?.teacherFeedback || '',
          };
        });

  const activeVideoUrl = videoPlaybackUrl || resolvedVideoUrl;

  const handleSeekVideo = (timestampStr) => {
    if (!videoRef.current || !timestampStr) return;
    const parts = timestampStr.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    } else if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    }
    videoRef.current.currentTime = seconds;
    try {
      const playPromise = videoRef.current.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {});
      }
    } catch {
      // Ignored for testing and unmuted autoplay policies
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          {onBack && (
            <button
              onClick={onBack}
              className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1 mb-2"
            >
              ← Back to My Tasks
            </button>
          )}
          <h2 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <span>📋</span> {task.title}
          </h2>
          <p className="text-xs text-gray-500 mt-1">
            Attempt #{submission.attemptsCount || 1} • {task.scheduleMode === 'retroactive' ? '⏪ Extracted from Class Video • ' : ''}Evaluated by Gemini 3.8 Flash
          </p>
        </div>

        {/* Score Pill */}
        <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
          <div className="text-right">
            <span className="text-xs text-gray-500 font-bold block uppercase">Your Grade</span>
            <span className="text-3xl font-black text-blue-600">
              {effectiveScore} <span className="text-sm font-normal text-gray-500">/ {maxScore}</span>
            </span>
          </div>
          <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center font-black text-sm text-blue-700">
            {percentage}%
          </div>
        </div>
      </div>

      {/* AI Summary Card */}
      {evalData.overallSummary && (
        <div className="bg-blue-50 p-5 rounded-2xl border border-blue-200 shadow-sm space-y-1">
          <span className="text-xs font-bold text-blue-900 uppercase tracking-wider flex items-center gap-1.5">
            <span>✨</span> AI Assessment Verdict
          </span>
          <p className="text-sm text-blue-950 leading-relaxed font-sans">
            {evalData.overallSummary}
          </p>
        </div>
      )}

      {/* Teacher Override Note if present */}
      {submission.teacherOverride?.teacherComment && (
        <div className="bg-purple-50 p-4 rounded-2xl border border-purple-200 text-xs text-purple-900">
          <strong>👨‍🏫 Instructor Note:</strong> {submission.teacherOverride.teacherComment}
        </div>
      )}

      {/* Synchronized Video Playback if available */}
      {activeVideoUrl && (
        <div className="bg-black rounded-2xl overflow-hidden shadow-lg border border-gray-800">
          <video
            ref={videoRef}
            src={activeVideoUrl}
            controls
            className="w-full max-h-96 object-contain"
          />
        </div>
      )}

      {/* Rubric Step-by-Step Breakdown */}
      <div className="space-y-3">
        <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
          <span>🎯</span> Rubric Mark Breakdown & Step Explanations
        </h3>

        {stepResults.map((step, idx) => (
          <div
            key={idx}
            className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col sm:flex-row sm:items-start justify-between gap-3"
          >
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm text-gray-900">
                  Step {step.stepNumber}: {step.title}
                </span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    step.status === 'completed'
                      ? 'bg-green-100 text-green-800'
                      : step.status === 'partial'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-red-100 text-red-800'
                  }`}
                >
                  {step.status}
                </span>
                {step.timestampInVideo && (
                  <button
                    onClick={() => handleSeekVideo(step.timestampInVideo)}
                    className="text-[11px] font-mono text-blue-600 hover:underline bg-blue-50 px-2 py-0.5 rounded flex items-center gap-1"
                  >
                    <span>⏱️ Jump to {step.timestampInVideo}</span>
                  </button>
                )}
              </div>

              {(step.description || step.expectedEvidence || step.gradingCriteria) && (
                <div className="text-[11px] text-gray-500 space-y-0.5">
                  {step.description && <p>Rubric Criterion: {step.description}</p>}
                  {step.expectedEvidence && (
                    <p className="font-mono text-[10px] text-gray-600">
                      Expected Proof: {step.expectedEvidence}
                    </p>
                  )}
                  {step.gradingCriteria && (
                    <p className="text-[10px] text-gray-600">
                      Marking Criteria: {step.gradingCriteria}
                    </p>
                  )}
                </div>
              )}

              {step.evidenceObserved && (
                <p className="text-xs text-slate-700 bg-slate-50 px-2.5 py-1.5 rounded border border-slate-200">
                  <span className="font-semibold text-slate-900">Observed on Screen: </span>
                  {step.evidenceObserved}
                </p>
              )}

              <p className="text-xs text-gray-700 leading-normal">
                <span className="font-semibold text-gray-900">Mark Explanation: </span>
                {step.feedback || 'No detailed explanation provided.'}
              </p>
            </div>

            <div className="text-right sm:pl-4 whitespace-nowrap">
              <span className="text-base font-black text-gray-900">
                {step.maxPoints > 0
                  ? `${step.scoreAwarded} / ${step.maxPoints} pts`
                  : `${step.scoreAwarded} pts`}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Strengths & Areas to Improve */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {evalData.strengths && evalData.strengths.length > 0 && (
          <div className="bg-emerald-50 p-5 rounded-2xl border border-emerald-200 space-y-2">
            <h4 className="text-xs font-bold text-emerald-900 uppercase flex items-center gap-1.5">
              <span>🌟</span> Strengths Demonstrated
            </h4>
            <ul className="text-xs text-emerald-900 space-y-1 list-disc list-inside">
              {evalData.strengths.map((str, i) => (
                <li key={i}>{str}</li>
              ))}
            </ul>
          </div>
        )}

        {evalData.deviationsOrErrors && evalData.deviationsOrErrors.length > 0 && (
          <div className="bg-amber-50 p-5 rounded-2xl border border-amber-200 space-y-2">
            <h4 className="text-xs font-bold text-amber-900 uppercase flex items-center gap-1.5">
              <span>💡</span> Constructive Feedback
            </h4>
            <ul className="text-xs text-amber-900 space-y-1 list-disc list-inside">
              {evalData.deviationsOrErrors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentTaskFeedbackView;
