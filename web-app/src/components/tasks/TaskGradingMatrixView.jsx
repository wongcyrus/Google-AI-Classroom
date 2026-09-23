import React, { useState, useMemo, useEffect, useRef } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../../firebase-config';
import StudentBadge from '../common/StudentBadge';
import { exportTaskGradingToExcel } from '../../utils/exportUtils';
import { getStudentDisplayName, getStudentProfile } from '../../utils/studentDisplayUtils';
import { useGoogleDrive } from '../../hooks/useGoogleDrive';
import DriveBackupProgressModal from '../DriveBackupProgressModal';
import './tasks.css';

const TaskGradingMatrixView = ({
  task,
  classId,
  className = '',
  lessons = [],
  submissions = [],
  enrolledStudents = [],
  studentProfiles = {},
  onBack,
  onSaveOverride,
  onTriggerEvaluation,
}) => {
  const {
    isConnected: isGdriveConnected,
    connect: connectGdrive,
    baseFolderName,
    backupTaskVideosToDrive,
  } = useGoogleDrive();

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [isExporting, setIsExporting] = useState(false);

  // Override edit states
  const [editingStudentUid, setEditingStudentUid] = useState(null);
  const [manualScoreInput, setManualScoreInput] = useState('');
  const [teacherCommentInput, setTeacherCommentInput] = useState('');
  const [evaluatingUids, setEvaluatingUids] = useState(new Set());
  const [isGradingAll, setIsGradingAll] = useState(false);

  // Google Drive & Video states
  const [videoJobs, setVideoJobs] = useState([]);
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupModalState, setBackupModalState] = useState({
    status: 'uploading',
    completedCount: 0,
    totalCount: 0,
    currentFileName: '',
    overallPercentage: 0,
    currentPercentage: 0,
    isAborted: false,
    error: null,
  });
  const backupAbortControllerRef = useRef(null);

  // Video preview player state
  const [previewVideoUrl, setPreviewVideoUrl] = useState(null);
  const [previewVideoTitle, setPreviewVideoTitle] = useState('');
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Subscribe to completed videoJobs for this task
  useEffect(() => {
    if (!classId || !task?.id) return;
    try {
      const q = query(
        collection(db, 'videoJobs'),
        where('classId', '==', classId),
        where('taskId', '==', task.id)
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setVideoJobs(jobs);
      }, (err) => {
        console.warn('Could not query videoJobs for task:', err);
      });
      return () => unsubscribe();
    } catch (e) {
      console.warn('videoJobs subscription error:', e);
    }
  }, [classId, task?.id]);

  // Map enrolled students to submission status
  const enrichedSubmissions = useMemo(() => {
    const subMap = new Map();
    submissions.forEach((sub) => {
      if (sub.studentUid) subMap.set(sub.studentUid, sub);
      if (sub.id) subMap.set(sub.id, sub);
      if (sub.email) subMap.set(sub.email.toLowerCase(), sub);
    });

    return enrolledStudents.map((emailOrObj) => {
      const email = typeof emailOrObj === 'string' ? emailOrObj : emailOrObj.email;
      const normalizedEmail = email ? email.toLowerCase() : '';
      const rawProfile = (studentProfiles && studentProfiles[normalizedEmail]) || (studentProfiles && studentProfiles[email]) || {};
      const profile = getStudentProfile(email, studentProfiles) || {};
      const uid = rawProfile.uid || profile.uid || email;
      const sub = subMap.get(uid) || subMap.get(normalizedEmail) || subMap.get(email) || {};

      const displayName = getStudentDisplayName(email, studentProfiles);

      // Match video job
      const matchedJob = videoJobs.find((v) =>
        (v.studentUid === uid || v.studentEmail?.toLowerCase() === normalizedEmail) &&
        (v.status === 'completed' || v.videoPath || v.videoUrl)
      );

      const videoPath = sub.compiledVideoPath || sub.latestAttempt?.compiledVideoPath || matchedJob?.videoPath || null;
      const videoUrl = sub.videoUrl || sub.latestAttempt?.videoUrl || matchedJob?.videoUrl || null;
      const driveWebViewLink = sub.driveWebViewLink || sub.latestAttempt?.driveWebViewLink || matchedJob?.driveWebViewLink || null;
      const driveFolderPath = sub.driveFolderPath || matchedJob?.driveFolderPath || null;
      const hasVideo = Boolean(videoPath || videoUrl || matchedJob);

      return {
        ...sub,
        studentUid: uid,
        email: email || sub.email,
        displayName: displayName || email,
        cohort: profile.studentClass || profile.cohort || 'Default',
        programme: profile.programme || '',
        status: sub.status || 'missing',
        attemptsCount: sub.attemptsCount || 0,
        effectiveScore: typeof sub.teacherOverride?.manualScore === 'number'
          ? sub.teacherOverride.manualScore
          : (typeof sub.effectiveScore === 'number' ? sub.effectiveScore : (sub.evaluation?.finalScore ?? null)),
        durationSeconds: sub.durationSeconds || sub.evaluation?.durationSeconds || 0,
        videoPath,
        videoUrl,
        driveWebViewLink,
        driveFolderPath,
        hasVideo,
        matchedJobId: matchedJob?.id,
      };
    });
  }, [enrolledStudents, submissions, studentProfiles, videoJobs]);

  const filteredSubmissions = useMemo(() => {
    return enrichedSubmissions.filter((s) => {
      const matchesSearch =
        !searchTerm ||
        s.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        s.cohort?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'evaluated' && s.status === 'evaluated') ||
        (statusFilter === 'in_progress' && (
          s.status === 'in_progress' ||
          s.status === 'compiling' ||
          s.status === 'compiling_complete' ||
          s.status === 'evaluating' ||
          evaluatingUids.has(s.studentUid)
        )) ||
        (statusFilter === 'missing' && (s.status === 'missing' || s.status === 'not_started'));

      return matchesSearch && matchesStatus;
    });
  }, [enrichedSubmissions, searchTerm, statusFilter, evaluatingUids]);

  // High-level statistics
  const stats = useMemo(() => {
    const total = enrichedSubmissions.length;
    const evaluated = enrichedSubmissions.filter((s) => s.status === 'evaluated');
    const evaluatedCount = evaluated.length;
    const avgScore =
      evaluatedCount > 0
        ? Math.round(
            evaluated.reduce((acc, curr) => acc + (Number(curr.effectiveScore) || 0), 0) /
              evaluatedCount
          )
        : 0;

    const totalSeconds = evaluated.reduce((acc, curr) => acc + (curr.durationSeconds || 0), 0);
    const avgDurationMins = evaluatedCount > 0 ? Math.round(totalSeconds / evaluatedCount / 60) : 0;

    return { total, evaluatedCount, avgScore, avgDurationMins };
  }, [enrichedSubmissions]);

  const handleExportExcel = async () => {
    setIsExporting(true);
    try {
      await exportTaskGradingToExcel(task, enrichedSubmissions);
    } catch (err) {
      console.error('Failed to export task results to Excel:', err);
      alert('Failed to export Excel report: ' + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleTriggerSingleEvaluation = async (sub) => {
    if (!onTriggerEvaluation) return;
    setEvaluatingUids((prev) => new Set(prev).add(sub.studentUid));
    try {
      await onTriggerEvaluation(sub.studentUid, sub.attemptsCount || 1);
    } catch (err) {
      alert(`Evaluation failed for ${sub.displayName}: ` + (err.message || err));
    } finally {
      setEvaluatingUids((prev) => {
        const next = new Set(prev);
        next.delete(sub.studentUid);
        return next;
      });
    }
  };

  const handleGradeAllPending = async () => {
    if (!onTriggerEvaluation) return;
    const pendingSubs = enrichedSubmissions.filter(
      (sub) =>
        sub.status === 'compiling_complete' ||
        (sub.attemptsCount > 0 &&
          sub.status !== 'evaluated' &&
          sub.status !== 'evaluating' &&
          !evaluatingUids.has(sub.studentUid))
    );

    if (pendingSubs.length === 0) {
      alert('No pending student submissions waiting for evaluation.');
      return;
    }

    if (
      !window.confirm(
        `Queue Gemini AI evaluation for ${pendingSubs.length} student submission(s)? Tasks will run safely through the Cloud Tasks rate-limited queue.`
      )
    ) {
      return;
    }

    setIsGradingAll(true);
    let queuedCount = 0;
    for (const sub of pendingSubs) {
      setEvaluatingUids((prev) => new Set(prev).add(sub.studentUid));
      try {
        await onTriggerEvaluation(sub.studentUid, sub.attemptsCount || 1);
        queuedCount++;
      } catch (err) {
        console.warn(`Failed to queue evaluation for ${sub.displayName}:`, err);
      }
    }
    setIsGradingAll(false);
    alert(`Successfully queued ${queuedCount} submission(s) for Gemini grading.`);
  };

  const handleStartEditOverride = (sub) => {
    setEditingStudentUid(sub.studentUid);
    setManualScoreInput(sub.teacherOverride?.manualScore ?? sub.effectiveScore ?? '');
    setTeacherCommentInput(sub.teacherOverride?.teacherComment || '');
  };

  const handleSaveOverride = async (studentUid) => {
    if (!onSaveOverride) return;
    await onSaveOverride(studentUid, {
      manualScore: manualScoreInput === '' ? null : Number(manualScoreInput),
      teacherComment: teacherCommentInput.trim(),
    });
    setEditingStudentUid(null);
  };

  const readyVideosCount = useMemo(() => {
    return enrichedSubmissions.filter((s) => s.hasVideo || s.status === 'compiling_complete' || s.status === 'evaluated').length;
  }, [enrichedSubmissions]);

  const handleBackupAllTaskVideos = async () => {
    if (!isGdriveConnected) {
      await connectGdrive();
      return;
    }

    const readySubs = enrichedSubmissions.filter(s => s.hasVideo || s.status === 'compiling_complete' || s.status === 'evaluated');
    if (readySubs.length === 0) {
      alert('No student task videos are compiled and ready for backup yet.');
      return;
    }

    setShowBackupModal(true);
    setBackupModalState({
      status: 'uploading',
      completedCount: 0,
      totalCount: readySubs.length,
      currentFileName: '',
      overallPercentage: 0,
      currentPercentage: 0,
      isAborted: false,
      error: null,
    });

    backupAbortControllerRef.current = new AbortController();

    const summary = await backupTaskVideosToDrive({
      classId,
      className: className || classId,
      task,
      submissions: readySubs,
      videoJobs,
      baseFolder: baseFolderName,
      abortSignal: backupAbortControllerRef.current.signal,
      onBatchProgress: ({ index, total, studentEmail, percentage, status, error }) => {
        const overallPct = Math.round(((index + (percentage / 100)) / total) * 100);
        setBackupModalState(prev => ({
          ...prev,
          completedCount: index + (status === 'success' ? 1 : 0),
          totalCount: total,
          currentFileName: `${studentEmail}`,
          overallPercentage: overallPct,
          currentPercentage: percentage,
          error: error || null,
        }));
      },
    });

    setBackupModalState(prev => ({
      ...prev,
      status: summary?.aborted ? 'cancelled' : 'completed',
      overallPercentage: 100,
    }));
  };

  const handleBackupSingleVideo = async (sub) => {
    if (!isGdriveConnected) {
      await connectGdrive();
      return;
    }

    setShowBackupModal(true);
    setBackupModalState({
      status: 'uploading',
      completedCount: 0,
      totalCount: 1,
      currentFileName: sub.email || sub.displayName,
      overallPercentage: 0,
      currentPercentage: 0,
      isAborted: false,
      error: null,
    });

    backupAbortControllerRef.current = new AbortController();

    const summary = await backupTaskVideosToDrive({
      classId,
      className: className || classId,
      task,
      submissions: [sub],
      videoJobs,
      baseFolder: baseFolderName,
      abortSignal: backupAbortControllerRef.current.signal,
      onBatchProgress: ({ percentage, status, error }) => {
        setBackupModalState(prev => ({
          ...prev,
          completedCount: status === 'success' ? 1 : 0,
          totalCount: 1,
          currentFileName: sub.email || sub.displayName,
          overallPercentage: percentage,
          currentPercentage: percentage,
          error: error || null,
        }));
      },
    });

    setBackupModalState(prev => ({
      ...prev,
      status: summary?.aborted ? 'cancelled' : 'completed',
      overallPercentage: 100,
    }));
  };

  const handlePlayPreview = async (sub) => {
    if (sub.driveWebViewLink) {
      window.open(sub.driveWebViewLink, '_blank', 'noopener,noreferrer');
      return;
    }

    if (sub.videoUrl) {
      setPreviewVideoTitle(`${sub.displayName} (${sub.email}) - Attempt Video`);
      setPreviewVideoUrl(sub.videoUrl);
      return;
    }

    if (!sub.videoPath) return;

    try {
      setIsLoadingPreview(true);
      setPreviewVideoTitle(`${sub.displayName} (${sub.email}) - Attempt Video`);
      const storage = getStorage();
      const videoRef = ref(storage, sub.videoPath);
      const url = await getDownloadURL(videoRef);
      setPreviewVideoUrl(url);
    } catch (err) {
      console.error('Could not load video preview URL:', err);
      alert('Unable to load video preview: ' + err.message);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl shadow-sm border border-gray-200">
        <div>
          <button
            onClick={onBack}
            className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1 mb-2"
          >
            ← Back to Tasks List
          </button>
          <h2 className="text-2xl font-black text-gray-900 flex items-center gap-2">
            <span>📊</span> {task.title || 'Task Grading Matrix'}
          </h2>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            {task.description || 'Hands-on practical assignment'} • Max Score: {task.maxScore || 100} pts
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[11px] text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md inline-flex items-center gap-1.5 border border-blue-200">
              <span>📁 Drive Destination:</span>
              <span className="font-mono font-medium">
                {baseFolderName || 'Classroom Archives'} / {className || classId} / Tasks / {task.title || 'Task'}
              </span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleBackupAllTaskVideos}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all"
            title={`Backup task videos to Google Drive folder: ${baseFolderName || 'Classroom Archives'} / ${className || classId} / Tasks / ${task.title || 'Task'}`}
          >
            <span>☁️</span>
            <span>
              {isGdriveConnected
                ? `Backup Task Videos (${readyVideosCount})`
                : 'Connect Drive & Backup'}
            </span>
          </button>
          {onTriggerEvaluation && (
            <button
              onClick={handleGradeAllPending}
              disabled={isGradingAll}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
              title="Queue all pending completed submissions for Gemini grading"
            >
              <span>{isGradingAll ? '⏳' : '🤖'}</span>
              <span>{isGradingAll ? 'Queueing...' : 'Grade All Pending'}</span>
            </button>
          )}
          <button
            onClick={handleExportExcel}
            disabled={isExporting}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
          >
            <span>{isExporting ? '⏳' : '📥'}</span>
            <span>Export to Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-500 uppercase">Submissions</span>
          <div className="text-2xl font-black text-gray-900 mt-1">
            {stats.evaluatedCount} / {stats.total}
          </div>
          <span className="text-[11px] text-gray-500">
            {stats.total > 0 ? Math.round((stats.evaluatedCount / stats.total) * 100) : 0}% Completion
          </span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-500 uppercase">Class Average</span>
          <div className="text-2xl font-black text-blue-600 mt-1">
            {stats.avgScore} <span className="text-sm font-normal text-gray-500">/ {task.maxScore || 100}</span>
          </div>
          <span className="text-[11px] text-gray-500">Evaluated by Gemini 3.7 Flash</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-500 uppercase">Avg Duration</span>
          <div className="text-2xl font-black text-purple-600 mt-1">
            {stats.avgDurationMins} <span className="text-sm font-normal text-gray-500">mins</span>
          </div>
          <span className="text-[11px] text-gray-500">Active screen time</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
          <span className="text-xs font-bold text-gray-500 uppercase">Rubric Milestones</span>
          <div className="text-2xl font-black text-amber-600 mt-1">
            {task.rubricSteps?.length || 0}
          </div>
          <span className="text-[11px] text-gray-500">Verification checkpoints</span>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="w-full sm:w-72">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search student, email, cohort..."
            className="w-full px-3 py-1.5 border border-gray-300 rounded-lg bg-white text-gray-900 text-sm focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2">
          {['all', 'evaluated', 'in_progress', 'missing'].map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {st.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Roster & Grading Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 border-b border-gray-200 text-xs font-bold text-gray-700 uppercase">
            <tr>
              <th className="py-3 px-4">Student</th>
              <th className="py-3 px-3">Cohort</th>
              <th className="py-3 px-3">Status</th>
              <th className="py-3 px-3">Attempts</th>
              <th className="py-3 px-3">Duration</th>
              <th className="py-3 px-3">Step Progress</th>
              <th className="py-3 px-3">Video / Drive</th>
              <th className="py-3 px-4 text-right">Score</th>
              <th className="py-3 px-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredSubmissions.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-400">
                  No submissions matching current filter.
                </td>
              </tr>
            ) : (
              filteredSubmissions.map((sub) => {
                const isEditing = editingStudentUid === sub.studentUid;
                const evalData = sub.evaluation || {};
                const stepResults = evalData.stepResults || [];
                const completedStepsCount = stepResults.filter((s) => s.status === 'completed').length;
                const totalSteps = task.rubricSteps?.length || stepResults.length || 0;

                return (
                  <tr key={sub.studentUid} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <StudentBadge
                        student={{
                          email: sub.email,
                          displayName: sub.displayName,
                          studentName: sub.displayName,
                          studentClass: sub.cohort,
                          programme: sub.programme,
                        }}
                        profileMap={studentProfiles}
                      />
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-600 font-mono">{sub.cohort}</td>
                    <td className="py-3 px-3">
                      {(() => {
                        const isEvaluating = evaluatingUids.has(sub.studentUid) || sub.status === 'evaluating';
                        if (isEvaluating) {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 animate-pulse">
                              <span>🤖</span> Evaluating...
                            </span>
                          );
                        }
                        if (sub.status === 'compiling') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 animate-pulse">
                              <span>⚙️</span> Compiling Video...
                            </span>
                          );
                        }
                        if (sub.status === 'compiling_complete') {
                          return (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-indigo-100 text-indigo-800">
                              <span>🎬</span> Ready to Grade
                            </span>
                          );
                        }
                        if (sub.status === 'evaluated') {
                          return (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800">
                              ✅ Evaluated
                            </span>
                          );
                        }
                        if (sub.status === 'in_progress') {
                          return (
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 animate-pulse">
                              ⏳ In Progress
                            </span>
                          );
                        }
                        return (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-600">
                            ❌ Missing
                          </span>
                        );
                      })()}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-700">
                      {sub.attemptsCount || 0}
                    </td>
                    <td className="py-3 px-3 text-xs text-gray-600 font-mono">
                      {sub.durationSeconds ? `${Math.round(sub.durationSeconds / 60)}m` : '-'}
                    </td>
                    <td className="py-3 px-3">
                      {totalSteps > 0 && sub.status === 'evaluated' ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 bg-gray-200 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-green-500 h-full rounded-full"
                              style={{ width: `${Math.round((completedStepsCount / totalSteps) * 100)}%` }}
                            />
                          </div>
                          <span className="text-[11px] font-semibold text-gray-700">
                            {completedStepsCount}/{totalSteps}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {sub.hasVideo && (
                          <button
                            type="button"
                            onClick={() => handlePlayPreview(sub)}
                            disabled={isLoadingPreview}
                            className="px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors"
                            title="Preview student attempt screencast"
                          >
                            <span>▶️</span> Watch
                          </button>
                        )}
                        {sub.driveWebViewLink ? (
                          <a
                            href={sub.driveWebViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 rounded text-[11px] font-bold"
                            title={`Backed up in Google Drive: ${sub.driveFolderPath || ''}`}
                          >
                            <span>📁</span> Drive ↗
                          </a>
                        ) : sub.hasVideo ? (
                          <button
                            type="button"
                            onClick={() => handleBackupSingleVideo(sub)}
                            className="px-2 py-0.5 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 rounded text-[11px] font-medium transition-colors"
                            title="Backup student video to Google Drive"
                          >
                            ☁️ Backup
                          </button>
                        ) : (
                          <span className="text-[11px] text-gray-400">No video</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min="0"
                            max={task.maxScore || 100}
                            value={manualScoreInput}
                            onChange={(e) => setManualScoreInput(e.target.value)}
                            className="w-16 px-1.5 py-0.5 text-right font-bold text-sm border rounded bg-white text-gray-900 border-gray-300"
                          />
                          <button
                            onClick={() => handleSaveOverride(sub.studentUid)}
                            className="p-1 bg-green-600 text-white rounded text-xs"
                            title="Save"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setEditingStudentUid(null)}
                            className="p-1 bg-gray-400 text-white rounded text-xs"
                            title="Cancel"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="group/score flex items-center justify-end gap-1.5">
                          <span
                            className={`font-black text-sm ${
                              sub.effectiveScore !== null && sub.effectiveScore !== undefined
                                ? sub.effectiveScore >= (task.maxScore || 100) * 0.8
                                  ? 'text-green-600'
                                  : sub.effectiveScore >= (task.maxScore || 100) * 0.5
                                  ? 'text-amber-600'
                                  : 'text-red-600'
                                : 'text-gray-400'
                            }`}
                          >
                            {sub.effectiveScore !== null && sub.effectiveScore !== undefined
                              ? `${sub.effectiveScore}`
                              : '-'}
                          </span>
                          {sub.teacherOverride?.manualScore !== undefined && (
                            <span className="text-[10px] text-purple-600 font-bold" title="Teacher Override">
                              ✏️
                            </span>
                          )}
                          <button
                            onClick={() => handleStartEditOverride(sub)}
                            className="opacity-0 group-hover/score:opacity-100 text-gray-400 hover:text-blue-600 text-xs transition-opacity"
                            title="Override score"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {evaluatingUids.has(sub.studentUid) || sub.status === 'evaluating' ? (
                          <span className="text-xs text-amber-600 font-bold flex items-center gap-1">
                            <span className="animate-spin">⏳</span>
                            <span className="text-[11px]">Grading...</span>
                          </span>
                        ) : sub.status === 'compiling' ? (
                          <span className="text-xs text-purple-500 font-semibold flex items-center gap-1">
                            <span className="animate-spin">⚙️</span>
                            <span className="text-[11px]">Compiling...</span>
                          </span>
                        ) : sub.status === 'compiling_complete' ? (
                          <button
                            onClick={() => handleTriggerSingleEvaluation(sub)}
                            className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1"
                            title="Grade with Gemini"
                          >
                            <span>🤖</span> Grade
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setSelectedSubmission(sub)}
                              disabled={sub.status !== 'evaluated'}
                              className="px-2 py-1 text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline disabled:opacity-30 disabled:no-underline"
                            >
                              Inspect 🔍
                            </button>
                            {sub.status === 'evaluated' && onTriggerEvaluation && (
                              <button
                                onClick={() => handleTriggerSingleEvaluation(sub)}
                                title="Re-grade submission with Gemini"
                                className="p-1 text-gray-400 hover:text-amber-600 rounded text-xs transition-colors"
                              >
                                🔄
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Submission Detail Modal */}
      {selectedSubmission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-2xl">
              <div>
                <h3 className="font-bold text-gray-900 flex items-center gap-2">
                  <span>🧑‍🎓</span> {selectedSubmission.displayName} ({selectedSubmission.email})
                </h3>
                <p className="text-xs text-gray-500">
                  Attempt {selectedSubmission.attemptsCount} • Final Score: {selectedSubmission.effectiveScore} /{' '}
                  {task.maxScore || 100}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="task-btn-close"
                aria-label="Close modal"
                title="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {/* Overall Summary */}
              <div className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                <span className="text-xs font-bold text-blue-900 uppercase">
                  AI Assessment Summary
                </span>
                <p className="text-sm text-blue-950 mt-1">
                  {selectedSubmission.evaluation?.overallSummary || 'No summary available.'}
                </p>
              </div>

              {/* Video & Google Drive Cloud Backup Status */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <span className="text-xs font-bold text-gray-700 uppercase flex items-center gap-1.5">
                    <span>🎬</span> Student Attempt Video
                  </span>
                  {selectedSubmission.driveWebViewLink ? (
                    <div className="text-xs text-green-700 mt-1 flex items-center gap-1">
                      <span>✅ Backed up to Google Drive:</span>
                      <span className="font-mono text-[11px] text-gray-600 truncate max-w-xs">{selectedSubmission.driveFolderPath}</span>
                    </div>
                  ) : selectedSubmission.hasVideo ? (
                    <div className="text-xs text-amber-700 mt-1">
                      ⚠️ Video compiled in Cloud Storage, not yet backed up to Drive
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 mt-1">
                      No video recording found for this attempt.
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedSubmission.hasVideo && (
                    <button
                      type="button"
                      onClick={() => handlePlayPreview(selectedSubmission)}
                      className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors"
                    >
                      <span>▶️</span> Watch Screencast
                    </button>
                  )}
                  {selectedSubmission.driveWebViewLink ? (
                    <a
                      href={selectedSubmission.driveWebViewLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                    >
                      <span>📁</span> View in Drive ↗
                    </a>
                  ) : selectedSubmission.hasVideo ? (
                    <button
                      type="button"
                      onClick={() => handleBackupSingleVideo(selectedSubmission)}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1.5"
                    >
                      <span>☁️</span> Backup to Drive
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Step By Step Breakdown */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-gray-800">
                  Rubric Milestones Evaluation
                </h4>
                {(selectedSubmission.evaluation?.stepResults || []).map((step, idx) => (
                  <div
                    key={idx}
                    className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex items-start justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-900">
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
                          <span className="text-[10px] text-gray-500 font-mono">
                            ⏱️ {step.timestampInVideo}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-700">{step.feedback}</p>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <span className="font-bold text-sm text-gray-900">
                        {step.scoreAwarded} pts
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="task-btn-cancel"
              >
                <span>✕</span>
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Google Drive Batch/Single Backup Modal */}
      {showBackupModal && (
        <DriveBackupProgressModal
          isOpen={showBackupModal}
          title={`Backing Up Task Videos: ${task.title || 'Practical Task'}`}
          baseFolderName={baseFolderName || 'Classroom Archives'}
          status={backupModalState.status}
          completedCount={backupModalState.completedCount}
          totalCount={backupModalState.totalCount}
          currentFileName={backupModalState.currentFileName}
          overallPercentage={backupModalState.overallPercentage}
          currentPercentage={backupModalState.currentPercentage}
          isAborted={backupModalState.isAborted}
          error={backupModalState.error}
          onCancel={() => {
            if (backupAbortControllerRef.current) {
              backupAbortControllerRef.current.abort();
            }
            setBackupModalState(prev => ({ ...prev, isAborted: true, status: 'cancelled' }));
          }}
          onClose={() => setShowBackupModal(false)}
        />
      )}

      {/* Video Preview Modal */}
      {previewVideoUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-4 overflow-hidden shadow-2xl flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
              <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                <span>🎬</span> {previewVideoTitle || 'Student Attempt Video'}
              </h3>
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="text-gray-400 hover:text-gray-700 text-lg font-bold px-2"
              >
                ✕
              </button>
            </div>
            <div className="py-4 bg-black rounded-xl overflow-hidden mt-2 flex items-center justify-center">
              <video
                src={previewVideoUrl}
                controls
                autoPlay
                className="max-h-[60vh] w-full object-contain"
              />
            </div>
            <div className="flex justify-end pt-3">
              <button
                onClick={() => setPreviewVideoUrl(null)}
                className="px-4 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TaskGradingMatrixView;
