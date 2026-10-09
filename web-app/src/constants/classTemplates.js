/**
 * Class Creation Concept Templates Configuration
 * 
 * Defines standard pedagogical presets for classes:
 * 1. Lecture: Auditorium / classroom lecture (recording studio & live CC on, student proctoring off)
 * 2. Lab: Hands-on practical computer lab (dual-screen capture on, task evaluation on, relaxed windowing)
 * 3. Lecture in Lab: Lecture inside computer room (focus mode on, anti-distraction full-screen lock, high attention tracking, 5-min bingo presence)
 */

export const CLASS_TEMPLATES = {
  lecture: {
    id: 'lecture',
    name: 'Lecture',
    tag: 'Lecture',
    icon: '🏛️',
    badge: 'Auditorium / Classroom Lecture',
    description: 'Optimized for instructor presentations. Auto-records the whole lecture with bilingual AI subtitles (CC), broadcast slides, and audio translation. Student screen recording and proctoring are turned off.',
    bestFor: 'Classroom lectures, seminars, keynote presentations, guest talks',
    highlights: [
      '🎬 Whole-Lecture Recording Studio enabled',
      '🌐 Real-time Bilingual Subtitles & Translation (CC)',
      '🚫 Student screen recording & proctoring disabled',
      '📱 Students can follow slides & live CC on laptops or mobile',
    ],
    settings: {
      classType: 'lecture',
      automaticCapture: false,
      captureMode: 'single',
      automaticCombine: false,
      requireFullScreenOnly: false,
      aiMonitoringMode: 'off',
      enableClientAi: false,
      enableCloudFallback: false,
      gazeSensitivity: 'standard',
      faceDebounceSeconds: 5,
      enableAudioCapture: false,
      defaultLectureRecording: true,
      isLectureSubtitlesEnabled: true,
      teacherRecordingsPolicy: 'selective',
      allowShareTeacherRecordings: true,
      consolidateLessonVideo: true,
      purgeScreenshotsAfterVideoCombine: true,
      lectureAiModel: 'gemini-3.8-flash',
      autoBingoEnabled: false,
      autoBingoIntervalMinutes: 15,
      autoBingoMode: 'question_bank',
      studentRecordingsPolicy: 'always_enabled',
    },
  },
  lab: {
    id: 'lab',
    name: 'Lab',
    tag: 'Lab',
    icon: '💻',
    badge: 'Hands-on Computer Lab',
    description: 'Optimized for computer laboratory sessions. Students actively code, complete lab tasks, and practice exercises. Dual-screen capture & live grid monitoring help instructors supervise and assist students.',
    bestFor: 'Programming labs, IT practicals, design workshops, software exercises',
    highlights: [
      '🖥️ Dual-Screen student capture & live monitor grid',
      '🪟 Relaxed windowing (multi-monitor, IDE, terminal allowed)',
      '📊 Student task workspace & automatic rubric grading',
      '👨‍🏫 Instructor can view live progress and assist struggling students',
    ],
    settings: {
      classType: 'lab',
      automaticCapture: true,
      captureMode: 'dual',
      automaticCombine: true,
      requireFullScreenOnly: false,
      aiMonitoringMode: 'hybrid',
      enableClientAi: true,
      enableCloudFallback: true,
      gazeSensitivity: 'standard',
      faceDebounceSeconds: 5,
      enableAudioCapture: false,
      defaultLectureRecording: false,
      isLectureSubtitlesEnabled: false,
      teacherRecordingsPolicy: 'private',
      allowShareTeacherRecordings: false,
      consolidateLessonVideo: false,
      purgeScreenshotsAfterVideoCombine: true,
      lectureAiModel: 'gemini-3.8-flash',
      autoBingoEnabled: false,
      autoBingoIntervalMinutes: 10,
      autoBingoMode: 'question_bank',
      studentRecordingsPolicy: 'always_enabled',
    },
  },
  lecture_in_lab: {
    id: 'lecture_in_lab',
    name: 'Lecture in Lab',
    tag: 'Lecture in Lab',
    icon: '🖥️🎧',
    badge: 'Anti-Distraction Focus Mode',
    description: 'Designed specifically for lecturing inside a computer lab. Keeps students focused on listening and watching the demonstration rather than getting distracted by games, social media, or other apps on their monitors.',
    bestFor: 'Lab demonstrations, lecture hours scheduled in computer rooms, hybrid theory/demo sessions',
    highlights: [
      '🔒 Focus Mode: Fullscreen required (detects tab switching & off-task apps)',
      '👀 Active attention & gaze tracking (alerts if looking away from teacher)',
      '🎯 Periodic Bingo checks (verifies students are actively listening)',
      '🎬 Whole-Lecture Recording + Bilingual Subtitles broadcast to student screens',
    ],
    settings: {
      classType: 'lecture_in_lab',
      automaticCapture: true,
      captureMode: 'dual',
      automaticCombine: true,
      requireFullScreenOnly: true,
      aiMonitoringMode: 'hybrid',
      enableClientAi: true,
      enableCloudFallback: true,
      gazeSensitivity: 'high',
      faceDebounceSeconds: 3,
      enableAudioCapture: false,
      defaultLectureRecording: true,
      isLectureSubtitlesEnabled: true,
      teacherRecordingsPolicy: 'selective',
      allowShareTeacherRecordings: true,
      consolidateLessonVideo: true,
      purgeScreenshotsAfterVideoCombine: true,
      lectureAiModel: 'gemini-3.8-flash',
      autoBingoEnabled: true,
      autoBingoIntervalMinutes: 5,
      autoBingoMode: 'question_bank',
      studentRecordingsPolicy: 'always_enabled',
    },
  },
};

export const DEFAULT_CLASS_TEMPLATE_ID = 'lecture_in_lab';
export const TEMPLATE_TAG_NAMES = ['Lecture', 'Lab', 'Lecture in Lab'];

/**
 * Returns the template definition for a given template ID, with fallback.
 */
export function getClassTemplate(templateId) {
  return CLASS_TEMPLATES[templateId] || CLASS_TEMPLATES[DEFAULT_CLASS_TEMPLATE_ID];
}

/**
 * Returns the template definition that matches a given tag string (if any).
 */
export function getTemplateByTag(tag) {
  if (!tag || typeof tag !== 'string') return null;
  const clean = tag.trim().toLowerCase();
  return Object.values(CLASS_TEMPLATES).find((t) => (t.tag && t.tag.toLowerCase() === clean) || t.name.toLowerCase() === clean) || null;
}

/**
 * Returns preset settings dictionary for a given template ID.
 */
export function getTemplateSettings(templateId) {
  const template = getClassTemplate(templateId);
  return { ...template.settings };
}
