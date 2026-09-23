import React, { useState, useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { ref, uploadBytesResumable } from 'firebase/storage';
import { functions, storage, auth } from '../../firebase-config';
import { extractYouTubeVideoId } from '../LectureRecordingsView';
import { useRubricPrompts } from '../../hooks/useRubricPrompts';
import './tasks.css';

const TaskEditorModal = ({
  isOpen,
  onClose,
  onSave,
  initialTask = null,
  classId,
  classSchedule = null,
  availableVideos = [],
}) => {
  const [activeTab, setActiveTab] = useState('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  // Tab 1: Basic Info
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [maxScore, setMaxScore] = useState(100);
  const [scheduleMode, setScheduleMode] = useState('homework'); // 'homework' | 'in_class' | 'flexible'
  const [lessonId, setLessonId] = useState('');
  const [availableFrom, setAvailableFrom] = useState('');
  const [deadline, setDeadline] = useState('');

  // Tab 2: Reference Demo Video & AI Extraction
  const [videoSourceMode, setVideoSourceMode] = useState('youtube'); // 'youtube' | 'upload' | 'library'
  const [demoVideoPath, setDemoVideoPath] = useState('');
  const [youtubeInput, setYoutubeInput] = useState('');
  const [youtubeVideoId, setYoutubeVideoId] = useState('');

  // Upload state
  const [selectedFile, setSelectedFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);

  // AI Prompt Library Integration
  const rubricPrompts = useRubricPrompts(auth?.currentUser);
  const [selectedPromptId, setSelectedPromptId] = useState('');
  const [selectedPromptText, setSelectedPromptText] = useState('');
  const [showPromptPreview, setShowPromptPreview] = useState(false);
  const [promptGuidelines, setPromptGuidelines] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionSuccess, setExtractionSuccess] = useState(null);

  // Tab 3: Rubric Steps (No hardcoded dummy steps - generated from video & prompt or added manually)
  const [rubricSteps, setRubricSteps] = useState(
    Array.isArray(initialTask?.rubricSteps) && initialTask.rubricSteps.length > 0
      ? initialTask.rubricSteps
      : []
  );

  // Tab 4: Constraints & Policies
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(45);
  const [autoSubmitOnExpiry, setAutoSubmitOnExpiry] = useState(true);
  const [maxAttempts, setMaxAttempts] = useState(2);
  const [scoringStrategy, setScoringStrategy] = useState('highest');
  const [retryCooldownMinutes, setRetryCooldownMinutes] = useState(15);
  const [latePolicy, setLatePolicy] = useState('allow_with_flag');
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [requiredChannel, setRequiredChannel] = useState('screen_only');
  const [feedbackReleasePolicy, setFeedbackReleasePolicy] = useState('immediate');

  useEffect(() => {
    if (initialTask) {
      setTitle(initialTask.title || '');
      setDescription(initialTask.description || '');
      setMaxScore(initialTask.maxScore ?? 100);
      setScheduleMode(initialTask.scheduleMode || 'homework');
      setLessonId(initialTask.lessonId || '');
      
      const toIsoDateString = (ts) => {
        if (!ts) return '';
        const d = ts.toDate ? ts.toDate() : new Date(ts);
        return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16);
      };

      setAvailableFrom(toIsoDateString(initialTask.constraints?.timing?.availableFrom));
      setDeadline(toIsoDateString(initialTask.constraints?.timing?.deadline));

      const vPath = initialTask.demoVideoPath || initialTask.youtubeUrl || '';
      setDemoVideoPath(vPath);
      const ytId = extractYouTubeVideoId(vPath) || initialTask.youtubeVideoId || '';
      if (ytId) {
        setYoutubeVideoId(ytId);
        setYoutubeInput(vPath.includes('youtube.com') || vPath.includes('youtu.be') ? vPath : `https://www.youtube.com/watch?v=${ytId}`);
        setVideoSourceMode('youtube');
      } else if (vPath.startsWith('classes/') && vPath.includes('/demos/')) {
        setVideoSourceMode('upload');
      } else if (vPath) {
        setVideoSourceMode('library');
      }
      
      if (Array.isArray(initialTask.rubricSteps) && initialTask.rubricSteps.length > 0) {
        setRubricSteps(initialTask.rubricSteps);
      }

      const c = initialTask.constraints || {};
      const t = c.timing || {};
      const a = c.attempts || {};
      const p = c.proctoring || {};
      const f = c.feedbackRelease || {};

      setTimeLimitMinutes(t.timeLimitMinutes ?? 45);
      setAutoSubmitOnExpiry(t.autoSubmitOnExpiry ?? true);
      setMaxAttempts(a.maxAttempts ?? 2);
      setScoringStrategy(a.scoringStrategy || 'highest');
      setRetryCooldownMinutes(a.retryCooldownMinutes ?? 15);
      setLatePolicy(t.latePolicy || 'allow_with_flag');
      setGracePeriodMinutes(t.gracePeriodMinutes ?? 15);
      setRequiredChannel(p.requiredChannel || 'screen_only');
      setFeedbackReleasePolicy(f.policy || 'immediate');
    } else {
      // Default dates: available now, deadline in 7 days
      const now = new Date();
      const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      setAvailableFrom(now.toISOString().slice(0, 16));
      setDeadline(inAWeek.toISOString().slice(0, 16));
      setDemoVideoPath('');
      setYoutubeInput('');
      setYoutubeVideoId('');
      setSelectedFile(null);
      setUploadProgress(0);
      setUploadError(null);
      setVideoSourceMode('youtube');
    }
  }, [initialTask, isOpen]);

  const handleYoutubeChange = (val) => {
    setYoutubeInput(val);
    const id = extractYouTubeVideoId(val);
    if (id) {
      setYoutubeVideoId(id);
      const fullUrl = `https://www.youtube.com/watch?v=${id}`;
      setDemoVideoPath(fullUrl);
    } else {
      setYoutubeVideoId('');
      if (!val.trim()) {
        if (demoVideoPath.includes('youtube.com') || demoVideoPath.includes('youtu.be')) {
          setDemoVideoPath('');
        }
      }
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a valid video file (MP4, WebM, MOV).');
      return;
    }
    if (file.size > 500 * 1024 * 1024) {
      setUploadError('Video file size exceeds 500MB limit.');
      return;
    }
    setSelectedFile(file);
    setUploadError(null);
  };

  const handleStartUpload = () => {
    if (!selectedFile || !classId) return;
    setIsUploading(true);
    setUploadProgress(0);
    setUploadError(null);

    try {
      const cleanName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `classes/${classId}/tasks/demos/${Date.now()}_${cleanName}`;
      const fileRef = ref(storage, storagePath);

      const uploadTask = uploadBytesResumable(fileRef, selectedFile, {
        contentType: selectedFile.type,
      });

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = Math.round(
            (snapshot.bytesTransferred / snapshot.totalBytes) * 100
          );
          setUploadProgress(progress);
        },
        (error) => {
          console.error('[TaskEditorModal] Upload error:', error);
          setUploadError(`Upload failed: ${error.message}`);
          setIsUploading(false);
        },
        () => {
          setDemoVideoPath(storagePath);
          setYoutubeVideoId('');
          setYoutubeInput('');
          setIsUploading(false);
          setUploadProgress(100);
        }
      );
    } catch (err) {
      console.error('[TaskEditorModal] Failed to initiate upload:', err);
      setUploadError(err.message);
      setIsUploading(false);
    }
  };

  const handleClearVideo = () => {
    setDemoVideoPath('');
    setYoutubeInput('');
    setYoutubeVideoId('');
    setSelectedFile(null);
    setUploadProgress(0);
    setUploadError(null);
  };

  if (!isOpen) return null;

  const totalRubricPoints = rubricSteps.reduce((sum, s) => sum + (Number(s.points) || 0), 0);

  const handleAddStep = () => {
    const nextNum = rubricSteps.length + 1;
    setRubricSteps([
      ...rubricSteps,
      {
        stepNumber: nextNum,
        title: `Milestone ${nextNum}`,
        description: '',
        expectedEvidence: '',
        points: 10,
      },
    ]);
  };

  const handleRemoveStep = (index) => {
    const filtered = rubricSteps.filter((_, idx) => idx !== index);
    const reindexed = filtered.map((step, idx) => ({ ...step, stepNumber: idx + 1 }));
    setRubricSteps(reindexed);
  };

  const handleStepChange = (index, field, value) => {
    const updated = [...rubricSteps];
    updated[index] = { ...updated[index], [field]: field === 'points' ? Number(value) : value };
    setRubricSteps(updated);
  };

  const handlePromptSelect = (e) => {
    const pId = e.target.value;
    setSelectedPromptId(pId);
    if (!pId) {
      setSelectedPromptText('');
    } else {
      const found = rubricPrompts.find(p => p.id === pId);
      if (found) {
        setSelectedPromptText(found.promptText || '');
      }
    }
  };

  const handleExtractRubricWithGemini = async () => {
    if (!demoVideoPath) {
      setErrorMessage('Please select or specify a reference demo video first.');
      return;
    }

    setIsExtracting(true);
    setErrorMessage(null);
    setExtractionSuccess(null);

    try {
      const extractFn = httpsCallable(functions, 'extractTaskDemoSteps');
      const res = await extractFn({
        classId,
        demoVideoPath,
        promptGuidelines,
        promptText: selectedPromptText,
      });

      const data = res.data;
      if (data) {
        if (data.title && !title) setTitle(data.title);
        if (data.description && !description) setDescription(data.description);
        if (Array.isArray(data.steps) && data.steps.length > 0) {
          setRubricSteps(data.steps);
        }
        setExtractionSuccess(`✨ Gemini successfully extracted ${data.steps?.length || 0} rubric milestones!`);
      }
    } catch (err) {
      console.error('Failed to extract rubric steps:', err);
      setErrorMessage(`Gemini step extraction failed: ${err.message}`);
    } finally {
      setIsExtracting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage('Please provide a task title.');
      setActiveTab('basic');
      return;
    }

    if (rubricSteps.length === 0) {
      setErrorMessage('At least one rubric milestone is required.');
      setActiveTab('rubric');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const trimmedDemoPath = demoVideoPath.trim();
      const derivedYtId = extractYouTubeVideoId(trimmedDemoPath) || youtubeVideoId || null;

      const taskPayload = {
        title: title.trim(),
        description: description.trim(),
        maxScore: Number(maxScore) || 100,
        scheduleMode,
        lessonId: scheduleMode === 'in_class' ? lessonId : null,
        demoVideoPath: trimmedDemoPath,
        youtubeVideoId: derivedYtId,
        youtubeUrl: derivedYtId
          ? (trimmedDemoPath.includes('youtube.com') || trimmedDemoPath.includes('youtu.be')
              ? trimmedDemoPath
              : `https://www.youtube.com/watch?v=${derivedYtId}`)
          : null,
        rubricSteps,
        constraints: {
          timing: {
            availableFrom: availableFrom ? new Date(availableFrom) : new Date(),
            deadline: deadline ? new Date(deadline) : null,
            timeLimitMinutes: Number(timeLimitMinutes) || 0,
            autoSubmitOnExpiry: Boolean(autoSubmitOnExpiry),
            latePolicy,
            gracePeriodMinutes: Number(gracePeriodMinutes) || 0,
          },
          attempts: {
            maxAttempts: Number(maxAttempts),
            scoringStrategy,
            retryCooldownMinutes: Number(retryCooldownMinutes) || 0,
          },
          proctoring: {
            requiredChannel,
          },
          feedbackRelease: {
            policy: feedbackReleasePolicy,
          },
        },
      };

      await onSave(taskPayload);
      onClose();
    } catch (err) {
      console.error('Failed to save task:', err);
      setErrorMessage(`Failed to save task: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="task-modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="task-modal-dialog bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col border border-gray-200">
        {/* Header */}
        <div className="task-modal-header px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50 rounded-t-xl flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <span>📋</span> {initialTask ? 'Edit Practical Task' : 'Create Practical Task'}
            </h2>
            <p className="text-xs text-gray-600 mt-0.5">
              Configure hands-on challenges, reference demo clips, rubric milestones, and timing constraints.
            </p>
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

        {/* Tab Navigation */}
        <div className="task-modal-tab-bar flex border-b border-gray-200 bg-gray-100 text-sm font-medium flex-shrink-0">
          <button
            type="button"
            onClick={() => setActiveTab('basic')}
            className={`task-modal-tab-btn flex-1 py-3 px-4 text-center border-b-2 transition-colors ${
              activeTab === 'basic'
                ? 'active border-blue-600 text-blue-600 font-semibold bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            1. Basic & Schedule
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('demo')}
            className={`task-modal-tab-btn flex-1 py-3 px-4 text-center border-b-2 transition-colors ${
              activeTab === 'demo'
                ? 'active border-blue-600 text-blue-600 font-semibold bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            2. Demo Video & AI
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rubric')}
            className={`task-modal-tab-btn flex-1 py-3 px-4 text-center border-b-2 transition-colors ${
              activeTab === 'rubric'
                ? 'active border-blue-600 text-blue-600 font-semibold bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            3. Rubric Milestones ({rubricSteps.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('constraints')}
            className={`task-modal-tab-btn flex-1 py-3 px-4 text-center border-b-2 transition-colors ${
              activeTab === 'constraints'
                ? 'active border-blue-600 text-blue-600 font-semibold bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            4. Constraints & Policies
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800 flex items-center justify-between flex-shrink-0">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="w-6 h-6 rounded bg-red-100 hover:bg-red-200 text-red-800 font-bold flex items-center justify-center transition-all ml-2 flex-shrink-0"
              title="Dismiss error"
            >
              ✕
            </button>
          </div>
        )}

        {/* Form Container */}
        <form onSubmit={handleSubmit} className="task-modal-form flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Scrollable Form Body */}
          <div className="task-modal-body flex-1 overflow-y-auto p-6 space-y-6">
            {/* TAB 1: BASIC & SCHEDULE */}
            {activeTab === 'basic' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">
                    Task Title <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Dockerizing Node.js REST API with Redis"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-1">
                    Task Overview & Student Instructions
                  </label>
                  <textarea
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Explain the required steps, repository links, or testing commands..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="task-delivery-mode" className="block text-sm font-semibold text-gray-800 mb-1">
                      Scheduling Mode
                    </label>
                    <select
                      id="task-delivery-mode"
                      value={scheduleMode}
                      onChange={(e) => setScheduleMode(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="homework">🏠 Homework (Out of Schedule / 24/7)</option>
                      <option value="in_class">🏫 In-Class (Tied to Scheduled Lesson)</option>
                      <option value="flexible">🔄 Flexible (In-Class with Home Extension)</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="task-max-score" className="block text-sm font-semibold text-gray-800 mb-1">
                      Max Possible Score
                    </label>
                    <input
                      id="task-max-score"
                      type="number"
                      min="1"
                      max="1000"
                      value={maxScore}
                      onChange={(e) => setMaxScore(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {scheduleMode === 'in_class' && classSchedule && classSchedule.length > 0 && (
                  <div>
                    <label htmlFor="task-linked-lesson" className="block text-sm font-semibold text-gray-800 mb-1">
                      Linked Timetable Lesson
                    </label>
                    <select
                      id="task-linked-lesson"
                      value={lessonId}
                      onChange={(e) => setLessonId(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 text-sm"
                    >
                      <option value="">-- Select Linked Lesson --</option>
                      {classSchedule.map((lesson) => (
                        <option key={lesson.id} value={lesson.id}>
                          {lesson.title || `Lesson on ${lesson.date || lesson.day}`}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-1">
                      Available From
                    </label>
                    <input
                      type="datetime-local"
                      value={availableFrom}
                      onChange={(e) => setAvailableFrom(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-800 mb-1">
                      Submission Deadline
                    </label>
                    <input
                      type="datetime-local"
                      value={deadline}
                      onChange={(e) => setDeadline(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-blue-500 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: DEMO VIDEO & AI EXTRACTION */}
            {activeTab === 'demo' && (
              <div className="space-y-5">
                {/* Reference Information Banner */}
                <div className="task-callout-demo">
                  <h3 className="task-callout-demo-title">
                    <span>🎥</span> Reference Demonstration Video
                  </h3>
                  <p className="task-callout-demo-text">
                    Attach an instructor demonstration MP4. Gemini 3.8 Flash can automatically inspect the video and generate the step-by-step scoring rubric below!
                  </p>
                </div>

                {/* Video Selection Section */}
                <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-900 mb-2">
                      Choose Video Demonstration Source:
                    </label>
                    <div className="video-source-nav">
                      <button
                        type="button"
                        onClick={() => setVideoSourceMode('youtube')}
                        className={`video-source-tab-btn ${videoSourceMode === 'youtube' ? 'active' : ''}`}
                      >
                        <span>🔴</span>
                        <span>Public YouTube Link</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoSourceMode('upload')}
                        className={`video-source-tab-btn ${videoSourceMode === 'upload' ? 'active' : ''}`}
                      >
                        <span>📤</span>
                        <span>Upload Video File</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setVideoSourceMode('library')}
                        className={`video-source-tab-btn ${videoSourceMode === 'library' ? 'active' : ''}`}
                      >
                        <span>📁</span>
                        <span>Teacher Lectures / Cloud</span>
                      </button>
                    </div>
                  </div>

                  {/* Mode 1: YouTube Link */}
                  {videoSourceMode === 'youtube' && (
                    <div className="space-y-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-sm">
                      <label className="block text-xs font-bold text-gray-800">
                        Public or Unlisted YouTube Video URL
                      </label>
                      <input
                        type="url"
                        value={youtubeInput}
                        onChange={(e) => handleYoutubeChange(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=... or https://youtu.be/..."
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-xs focus:ring-2 focus:ring-blue-500 font-mono"
                      />
                      {youtubeVideoId ? (
                        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
                          <img
                            src={`https://img.youtube.com/vi/${youtubeVideoId}/mqdefault.jpg`}
                            alt="YouTube Thumbnail"
                            className="w-28 h-16 object-cover rounded-lg border border-red-200 flex-shrink-0 shadow-sm"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-[10px] font-bold text-red-700 uppercase tracking-wider block">
                              Valid YouTube Reference
                            </span>
                            <span className="text-xs font-mono font-bold text-gray-900 block truncate">
                              ID: {youtubeVideoId}
                            </span>
                            <a
                              href={`https://www.youtube.com/watch?v=${youtubeVideoId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold hover:underline inline-flex items-center gap-1 mt-0.5"
                            >
                              Watch on YouTube ↗
                            </a>
                          </div>
                        </div>
                      ) : youtubeInput.trim() ? (
                        <p className="text-xs text-amber-700 font-semibold bg-amber-50 p-2 rounded-lg border border-amber-200">
                          ⚠️ Please enter a valid YouTube video URL or ID (e.g., https://youtu.be/dQw4w9WgXcQ).
                        </p>
                      ) : (
                        <p className="text-[11px] text-gray-600">
                          💡 Paste any public or unlisted YouTube video URL demonstrating the lab steps.
                        </p>
                      )}
                    </div>
                  )}

                  {/* Mode 2: Upload Video File */}
                  {videoSourceMode === 'upload' && (
                    <div className="space-y-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-sm">
                      <label className="block text-xs font-bold text-gray-800">
                        Upload Instructor Demonstration File (MP4, WebM, MOV)
                      </label>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        <input
                          type="file"
                          accept="video/mp4,video/webm,video/quicktime"
                          onChange={handleFileSelect}
                          disabled={isUploading}
                          className="flex-1 text-xs text-gray-800 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border file:border-gray-300 file:text-xs file:font-semibold file:bg-gray-50 hover:file:bg-gray-100 cursor-pointer"
                        />
                        {selectedFile && !isUploading && (
                          <button
                            type="button"
                            onClick={handleStartUpload}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-all flex-shrink-0"
                          >
                            <span>⬆️</span>
                            <span>Upload ({(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)</span>
                          </button>
                        )}
                      </div>
                      {isUploading && (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex justify-between text-xs font-semibold text-blue-800">
                            <span>Uploading demonstration clip...</span>
                            <span>{uploadProgress}%</span>
                          </div>
                          <div className="video-upload-progress-track">
                            <div className="video-upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
                          </div>
                        </div>
                      )}
                      {uploadError && (
                        <p className="text-xs text-red-600 font-semibold bg-red-50 p-2 rounded-lg border border-red-200">
                          ❌ {uploadError}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Mode 3: Teacher Lecture Recordings & Storage Path */}
                  {videoSourceMode === 'library' && (
                    <div className="space-y-3 p-3.5 bg-white border border-gray-200 rounded-xl shadow-sm">
                      <div>
                        <label className="block text-xs font-bold text-gray-800 mb-1">
                          Teacher Lecture Recordings for this Class
                        </label>
                        {availableVideos.length > 0 ? (
                          <select
                            value={demoVideoPath}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDemoVideoPath(val);
                              const yt = extractYouTubeVideoId(val);
                              setYoutubeVideoId(yt || '');
                              if (yt) setYoutubeInput(val);
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 text-xs focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">📁 Select a teacher lecture recording...</option>
                            {availableVideos.map((v, i) => {
                              const val = typeof v === 'string' ? v : (v.videoPath || v.storagePath || v.youtubeUrl || v.url || '');
                              const label = typeof v === 'string' ? v : (v.title || v.fileName || val);
                              const isYt = val.includes('youtube.com') || val.includes('youtu.be');
                              return (
                                <option key={i} value={val}>
                                  {isYt ? '🔴 [YouTube] ' : '☁️ [Cloud] '}{label}
                                </option>
                              );
                            })}
                          </select>
                        ) : (
                          <p className="text-xs text-gray-500 italic p-2 bg-gray-50 rounded border border-gray-200">
                            No teacher lecture recordings found in this classroom yet.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-700 mb-1">
                          Or Direct Cloud Storage Path / URI
                        </label>
                        <input
                          type="text"
                          value={demoVideoPath}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDemoVideoPath(val);
                            const yt = extractYouTubeVideoId(val);
                            setYoutubeVideoId(yt || '');
                            if (yt) setYoutubeInput(val);
                          }}
                          placeholder="e.g., classes/class123/tasks/demos/demo.mp4 or gs://..."
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 font-mono text-xs focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                  )}

                  {/* Active Selected Video Card */}
                  {demoVideoPath ? (
                    <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900 shadow-sm">
                      <div className="flex items-center gap-2.5 min-w-0 pr-2">
                        <span className="px-2 py-0.5 rounded font-bold text-[10px] uppercase bg-blue-200 text-blue-900 flex-shrink-0">
                          {youtubeVideoId ? '🔴 YouTube' : demoVideoPath.startsWith('http') ? '🌐 Web Video' : '☁️ Cloud Video'}
                        </span>
                        <span className="font-mono truncate font-medium text-gray-900">{demoVideoPath}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleClearVideo}
                        className="task-btn-remove flex-shrink-0"
                        title="Remove selected video"
                      >
                        <span>✕</span>
                        <span>Remove</span>
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-600">
                      💡 Select a video source above to attach an instructor demonstration.
                    </p>
                  )}
                </div>

                {/* AI Rubric Prompt Selection from Prompts Library */}
                <div className="p-4 bg-purple-50/50 border border-purple-200 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <label htmlFor="rubric-prompt-select" className="text-sm font-bold text-purple-950 flex items-center gap-1.5">
                        <span>📚</span>
                        <span>AI Rubric Prompt (from AI Prompts Library)</span>
                      </label>
                      <p className="text-xs text-purple-800 mt-0.5">
                        Select a prompt template from your library or write custom extraction rules.
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-purple-700 bg-purple-100/80 px-2 py-0.5 rounded-full border border-purple-200">
                      {rubricPrompts.length} Prompts Available
                    </span>
                  </div>

                  <div>
                    <select
                      id="rubric-prompt-select"
                      value={selectedPromptId}
                      onChange={handlePromptSelect}
                      className="w-full px-3 py-2 border border-purple-300 rounded-lg bg-white text-gray-900 text-sm font-medium focus:ring-2 focus:ring-purple-500 shadow-sm"
                    >
                      <option value="">-- Custom / Ad-hoc Prompt (Free-form) --</option>
                      {rubricPrompts.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} {p.accessLevel ? `(${p.accessLevel})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedPromptText && (
                    <div className="bg-white border border-purple-200 rounded-lg p-3 text-xs space-y-2 shadow-sm">
                      <div className="flex items-center justify-between text-gray-700 font-semibold">
                        <span className="flex items-center gap-1 text-purple-900">
                          <span>📝</span> Prompt Template Details:
                        </span>
                        <button
                          type="button"
                          onClick={() => setShowPromptPreview(!showPromptPreview)}
                          className="text-purple-700 hover:text-purple-900 text-[11px] font-bold underline"
                        >
                          {showPromptPreview ? 'Collapse Preview ▲' : 'View Full Prompt ▼'}
                        </button>
                      </div>
                      {showPromptPreview ? (
                        <pre className="text-[11px] text-gray-700 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto bg-gray-50 p-2.5 rounded border border-gray-200">
                          {selectedPromptText}
                        </pre>
                      ) : (
                        <p className="text-gray-600 italic text-[11px] line-clamp-2">
                          {selectedPromptText.slice(0, 160)}...
                        </p>
                      )}
                    </div>
                  )}

                  <div>
                    <label htmlFor="task-prompt-guidelines" className="block text-xs font-semibold text-gray-700 mb-1">
                      {selectedPromptId ? 'Additional Specific Teacher Guidance / Focus (Optional):' : 'Custom Prompt / Instructions for Gemini:'}
                    </label>
                    <textarea
                      id="task-prompt-guidelines"
                      rows={selectedPromptId ? 2 : 4}
                      value={promptGuidelines}
                      onChange={(e) => setPromptGuidelines(e.target.value)}
                      placeholder={
                        selectedPromptId
                          ? "e.g., Pay special attention to terminal command flags, and ensure port 8080 verification is a separate step."
                          : "Describe how Gemini should break down the demonstration video into rubric milestones..."
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-purple-500 text-sm"
                    />
                  </div>
                </div>

                {/* Gemini AI Trigger Button */}
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleExtractRubricWithGemini}
                    disabled={isExtracting || !demoVideoPath}
                    className="w-full py-3 px-4 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white font-bold rounded-xl shadow-md flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isExtracting ? (
                      <>
                        <span className="animate-spin">🔄</span>
                        <span>Gemini 3.8 Flash is analyzing demo video & prompt...</span>
                      </>
                    ) : (
                      <>
                        <span>✨</span>
                        <span>Synthesize Rubric Milestones with Gemini</span>
                      </>
                    )}
                  </button>
                  {!demoVideoPath && (
                    <p className="text-center text-xs text-gray-500 mt-2">
                      ⚠️ Specify or select a reference video above to enable AI milestone extraction.
                    </p>
                  )}
                </div>

                {/* Extraction Success Card */}
                {extractionSuccess && (
                  <div className="task-callout-success flex flex-col gap-2">
                    <div className="flex items-center gap-2 font-bold text-sm text-green-900">
                      <span>✅</span>
                      <span>{extractionSuccess}</span>
                    </div>
                    <p className="text-xs text-green-800">
                      Gemini has populated milestone steps, point distributions, and expected visual proof. You can edit them in Tab 3.
                    </p>
                    <div>
                      <button
                        type="button"
                        onClick={() => setActiveTab('rubric')}
                        className="px-3.5 py-1.5 bg-green-700 hover:bg-green-800 text-white text-xs font-bold rounded-lg inline-flex items-center gap-1.5 transition-colors shadow-sm"
                      >
                        <span>📋 View & Edit Extracted Milestones (Tab 3)</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: RUBRIC STEPS */}
            {activeTab === 'rubric' && (
              <div className="space-y-4">
                <div className="flex justify-between items-center bg-gray-50 p-3 rounded-xl border border-gray-200">
                  <div>
                    <span className="text-sm font-bold text-gray-800">
                      Total Rubric Points: {totalRubricPoints} / {maxScore}
                    </span>
                    {totalRubricPoints !== maxScore && (
                      <span className="ml-2 text-xs font-semibold text-amber-600">
                        (⚠️ Suggested points do not sum to {maxScore})
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1 shadow-sm"
                  >
                    <span>+</span> Add Milestone
                  </button>
                </div>

                {rubricSteps.length === 0 ? (
                  <div className="p-8 text-center bg-blue-50/50 border-2 border-dashed border-blue-200 rounded-2xl space-y-4">
                    <div className="text-4xl">🎯</div>
                    <div className="max-w-md mx-auto space-y-1">
                      <h4 className="text-base font-bold text-gray-900">No Rubric Milestones Defined Yet</h4>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Milestones should be synthesized by Gemini from your reference demo video and an AI prompt from your library, or created manually.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setActiveTab('demo')}
                        className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center gap-2 transition-all"
                      >
                        <span>✨</span>
                        <span>Generate from Video & Prompt (Tab 2)</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleAddStep}
                        className="px-4 py-2 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 text-xs font-bold rounded-xl shadow-sm flex items-center gap-1.5 transition-colors"
                      >
                        <span>➕</span>
                        <span>Add Milestone Manually</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {rubricSteps.map((step, idx) => (
                      <div
                        key={idx}
                        className="p-4 bg-white border border-gray-200 rounded-xl shadow-sm space-y-3 relative group"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1">
                            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs flex-shrink-0">
                              {step.stepNumber}
                            </span>
                            <input
                              type="text"
                              value={step.title}
                              onChange={(e) => handleStepChange(idx, 'title', e.target.value)}
                              placeholder="Milestone Title"
                              className="flex-1 font-semibold text-sm px-2.5 py-1 border border-gray-300 rounded bg-white text-gray-900"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <label className="text-xs text-gray-600">Points:</label>
                            <input
                              type="number"
                              value={step.points}
                              onChange={(e) => handleStepChange(idx, 'points', e.target.value)}
                              min="1"
                              max="1000"
                              className="w-16 text-center text-sm font-bold px-2 py-1 border border-gray-300 rounded bg-white text-gray-900"
                            />
                            {rubricSteps.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveStep(idx)}
                                className="text-red-500 hover:text-red-700 p-1 text-sm"
                                title="Remove step"
                              >
                                🗑️
                              </button>
                            )}
                          </div>
                        </div>

                        <div>
                          <input
                            type="text"
                            value={step.description}
                            onChange={(e) => handleStepChange(idx, 'description', e.target.value)}
                            placeholder="Action description (e.g. clone repo, write code, run container)..."
                            className="w-full text-xs px-2.5 py-1 border border-gray-300 rounded bg-white text-gray-800"
                          />
                        </div>

                        <div>
                          <label className="block text-[11px] font-semibold text-gray-600 mb-0.5">
                            🔍 Expected Visual Proof for AI:
                          </label>
                          <input
                            type="text"
                            value={step.expectedEvidence}
                            onChange={(e) => handleStepChange(idx, 'expectedEvidence', e.target.value)}
                            placeholder="e.g., Terminal displaying 'Server listening on port 5000'..."
                            className="w-full text-xs px-2.5 py-1 border border-gray-300 rounded bg-white text-gray-800 font-mono"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: CONSTRAINTS & POLICIES */}
            {activeTab === 'constraints' && (
              <div className="space-y-4 text-sm">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                    <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                      <span>⏱️</span> Timing & Duration
                    </h4>
                    <div>
                      <label htmlFor="task-time-limit" className="block text-xs font-semibold text-gray-700 mb-1">
                        Time Limit (Minutes)
                      </label>
                      <input
                        id="task-time-limit"
                        type="number"
                        min="0"
                        max="300"
                        value={timeLimitMinutes}
                        onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-900"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">Set 0 for unlimited duration.</p>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoSubmitOnExpiry}
                        onChange={(e) => setAutoSubmitOnExpiry(e.target.checked)}
                        className="rounded text-blue-600"
                      />
                      <span className="text-xs text-gray-700">
                        Auto-submit attempt when countdown reaches 00:00
                      </span>
                    </label>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Late Submission Policy
                      </label>
                      <select
                        value={latePolicy}
                        onChange={(e) => setLatePolicy(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-gray-900 text-xs"
                      >
                        <option value="strictly_closed">Strictly Closed (Cannot submit after deadline)</option>
                        <option value="allow_with_flag">Allow with Late Flag (Teacher notified)</option>
                        <option value="grace_period">Grace Period Window (Upload tolerance)</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                    <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                      <span>🔄</span> Attempt & Retry Governance
                    </h4>
                    <div>
                      <label htmlFor="task-max-attempts" className="block text-xs font-semibold text-gray-700 mb-1">
                        Max Attempts Allowed
                      </label>
                      <input
                        id="task-max-attempts"
                        type="number"
                        min="1"
                        max="10"
                        value={maxAttempts}
                        onChange={(e) => setMaxAttempts(Number(e.target.value))}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-900"
                      />
                      <p className="text-[11px] text-gray-500 mt-1">1 for Exam/Quiz; 2-5 for Formative Labs.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Scoring Strategy Across Attempts
                      </label>
                      <select
                        value={scoringStrategy}
                        onChange={(e) => setScoringStrategy(e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-gray-900 text-xs"
                      >
                        <option value="highest">Keep Highest Score</option>
                        <option value="latest">Keep Latest Attempt</option>
                        <option value="average">Average Across Attempts</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">
                        Retry Cooldown (Minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="120"
                        value={retryCooldownMinutes}
                        onChange={(e) => setRetryCooldownMinutes(Number(e.target.value))}
                        className="w-full px-3 py-1.5 border border-gray-300 rounded bg-white text-gray-900"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                    <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                      <span>🔒</span> Proctoring & Invigilation
                    </h4>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Required Media Channels
                    </label>
                    <select
                      value={requiredChannel}
                      onChange={(e) => setRequiredChannel(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-gray-900 text-xs"
                    >
                      <option value="screen_only">Screen Share Only</option>
                      <option value="dual_screen_webcam">Dual (Screen Share + Webcam Facial Check)</option>
                    </select>
                  </div>

                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                    <h4 className="font-bold text-gray-900 flex items-center gap-1.5">
                      <span>📊</span> Grade & Feedback Release
                    </h4>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">
                      Release Policy
                    </label>
                    <select
                      value={feedbackReleasePolicy}
                      onChange={(e) => setFeedbackReleasePolicy(e.target.value)}
                      className="w-full px-2 py-1.5 border border-gray-300 rounded bg-white text-gray-900 text-xs"
                    >
                      <option value="immediate">Immediate (Student sees AI score right away)</option>
                      <option value="after_deadline">After Deadline (Hidden until class due date)</option>
                      <option value="manual_by_teacher">Manual Release (Teacher approval required)</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions (Pinned at bottom) */}
          <div className="task-modal-footer px-6 py-4 border-t border-gray-200 flex justify-between items-center bg-gray-50 rounded-b-xl flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="task-btn-cancel"
            >
              <span>✕</span>
              <span>Cancel</span>
            </button>
            <div className="flex gap-2">
              {activeTab !== 'basic' && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === 'constraints') setActiveTab('rubric');
                    else if (activeTab === 'rubric') setActiveTab('demo');
                    else if (activeTab === 'demo') setActiveTab('basic');
                  }}
                  className="px-4 py-2 text-sm font-bold text-gray-800 bg-white hover:bg-gray-100 border border-gray-300 rounded-lg shadow-sm transition-colors"
                >
                  ← Previous
                </button>
              )}
              {activeTab !== 'constraints' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === 'basic') setActiveTab('demo');
                    else if (activeTab === 'demo') setActiveTab('rubric');
                    else if (activeTab === 'rubric') setActiveTab('constraints');
                  }}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow"
                >
                  Next Step →
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2 text-sm font-bold text-white bg-green-600 hover:bg-green-700 rounded-lg shadow flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? 'Saving...' : initialTask ? 'Update Task' : 'Publish Task'}
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TaskEditorModal;
