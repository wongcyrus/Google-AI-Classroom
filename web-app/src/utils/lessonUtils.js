/**
 * Utilities for defining, formatting, and resolving lesson names across
 * timetables, recordings, and cloud backup hierarchies.
 */

/**
 * Sanitizes a string to be a clean, valid folder or file path segment.
 * Removes characters invalid in most filesystems and cloud storage: / \ : * ? " < > |
 *
 * @param {string} str - Raw string
 * @param {string} [fallback='General'] - Fallback if str is empty
 * @returns {string} Sanitized string
 */
export const sanitizeFolderName = (str, fallback = 'General') => {
  if (!str || typeof str !== 'string') return fallback;
  const cleaned = str
    .replace(/[/\\:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
};

/**
 * Formats a 1-based index with zero padding (e.g. 1 -> "01", 12 -> "12").
 * @param {number} index
 * @returns {string}
 */
export const padLessonIndex = (index) => {
  const num = parseInt(index, 10);
  if (isNaN(num) || num <= 0) return '01';
  return String(num).padStart(2, '0');
};

/**
 * Generates a stable ISO key for a lesson's start date (used to index custom lesson titles).
 * @param {Date|string} dateOrLesson
 * @returns {string} ISO string
 */
export const getLessonKey = (dateOrLesson) => {
  if (!dateOrLesson) return '';
  if (dateOrLesson.start) {
    const d = dateOrLesson.start instanceof Date ? dateOrLesson.start : new Date(dateOrLesson.start);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const d = dateOrLesson instanceof Date ? dateOrLesson : new Date(dateOrLesson);
  return isNaN(d.getTime()) ? '' : d.toISOString();
};

/**
 * Formats a lesson title based on index and optional custom titles dictionary.
 * Example outputs:
 * - "Lesson 01: Docker Setup" (if custom title exists)
 * - "Lesson 01" (if no custom title)
 *
 * @param {Object} params
 * @param {Object} params.lesson - Lesson object with { start, end }
 * @param {number} [params.index=1] - 1-based chronological index
 * @param {Object} [params.customTitles={}] - Map of { [lessonStartIso]: "Topic Title" }
 * @returns {string} Formatted lesson title
 */
export const formatLessonTitle = ({ lesson, index = 1, customTitles = {} }) => {
  const padIdx = padLessonIndex(index);
  const key = getLessonKey(lesson);
  const custom = customTitles?.[key] || lesson?.title;

  if (custom && typeof custom === 'string' && custom.trim()) {
    const trimmed = custom.trim();
    // If teacher already prefixed with "Lesson X", don't double-prefix
    if (/^lesson\s+\d+/i.test(trimmed)) {
      return trimmed;
    }
    return `Lesson ${padIdx}: ${trimmed}`;
  }
  return `Lesson ${padIdx}`;
};

/**
 * Formats a lesson display name for UI select dropdowns and header bars.
 * Example outputs:
 * - "Lesson 01: Docker Setup (2026-09-04 09:00 - 11:00)"
 * - "Lesson 01 (2026-09-04 09:00 - 11:00)"
 *
 * @param {Object} params
 * @param {Object} params.lesson
 * @param {number} [params.index=1]
 * @param {Object} [params.customTitles={}]
 * @returns {string} Formatted dropdown label
 */
export const formatLessonDisplayName = ({ lesson, index = 1, customTitles = {} }) => {
  if (!lesson || !lesson.start) return `Lesson ${padLessonIndex(index)}`;

  const startDate = lesson.start instanceof Date ? lesson.start : new Date(lesson.start);
  const endDate = lesson.end instanceof Date ? lesson.end : (lesson.end ? new Date(lesson.end) : null);

  if (isNaN(startDate.getTime())) return `Lesson ${padLessonIndex(index)}`;

  const title = formatLessonTitle({ lesson, index, customTitles });
  const dateStr = startDate.toLocaleDateString();

  let timeStr = '';
  try {
    const startTimeStr = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = endDate && !isNaN(endDate.getTime())
      ? endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '';
    timeStr = endTimeStr ? `${startTimeStr} - ${endTimeStr}` : startTimeStr;
  } catch {
    timeStr = '';
  }

  return timeStr ? `${title} (${dateStr} ${timeStr})` : `${title} (${dateStr})`;
};

/**
 * Generates a clean folder name for Google Drive based on lesson title and date.
 * Example outputs:
 * - "Lesson 01 - Docker Setup (2026-09-04)"
 * - "Lesson 01 (2026-09-04)"
 *
 * @param {Object} params
 * @param {Object} params.lesson
 * @param {number} [params.index=1]
 * @param {Object} [params.customTitles={}]
 * @returns {string} Folder-safe lesson name
 */
export const formatLessonFolderName = ({ lesson, index = 1, customTitles = {} }) => {
  if (!lesson || !lesson.start) return sanitizeFolderName(`Lesson ${padLessonIndex(index)}`);

  const startDate = lesson.start instanceof Date ? lesson.start : new Date(lesson.start);
  if (isNaN(startDate.getTime())) return sanitizeFolderName(`Lesson ${padLessonIndex(index)}`);

  const dateIso = startDate.toISOString().slice(0, 10);
  const title = formatLessonTitle({ lesson, index, customTitles });

  // Replace colon with dash for folder safety e.g. "Lesson 01: Docker" -> "Lesson 01 - Docker"
  const safeTitle = title.replace(':', ' -');
  return sanitizeFolderName(`${safeTitle} (${dateIso})`);
};

/**
 * Finds which scheduled lesson a timestamp belongs to, allowing for a configurable buffer.
 *
 * @param {Date|string|number} timestamp
 * @param {Array<Object>} [lessons=[]]
 * @param {number} [bufferMinutes=30]
 * @returns {Object|null} Matched lesson with { ...lesson, index } or null
 */
export const findLessonForTimestamp = (timestamp, lessons = [], bufferMinutes = 30) => {
  if (!timestamp || !Array.isArray(lessons) || lessons.length === 0) return null;

  const targetDate = timestamp?.toDate && typeof timestamp.toDate === 'function'
    ? timestamp.toDate()
    : (timestamp instanceof Date ? timestamp : new Date(timestamp));

  const targetMs = targetDate.getTime();
  if (isNaN(targetMs)) return null;

  const bufferMs = bufferMinutes * 60 * 1000;

  for (let i = 0; i < lessons.length; i++) {
    const l = lessons[i];
    const s = l.start instanceof Date ? l.start : new Date(l.start);
    const e = l.end instanceof Date ? l.end : (l.end ? new Date(l.end) : s);

    if (isNaN(s.getTime())) continue;

    const startMs = s.getTime() - bufferMs;
    const endMs = e.getTime() + bufferMs;

    if (targetMs >= startMs && targetMs <= endMs) {
      return {
        ...l,
        index: l.index || (i + 1),
      };
    }
  }

  return null;
};

/**
 * Resolves the appropriate lesson or task folder name for any video.
 *
 * @param {Object} params
 * @param {Object} params.video - VideoJob or submission object
 * @param {Array<Object>} [params.lessons=[]] - Scheduled lessons
 * @param {Object} [params.customTitles={}] - Map of custom titles
 * @param {string} [params.selectedLesson=''] - Active selected lesson key
 * @param {Object} [params.task=null] - Linked practical task (if task submission)
 * @returns {string} Clean folder name
 */
export const resolveVideoLessonName = ({
  video,
  lessons = [],
  customTitles = {},
  selectedLesson = '',
  task = null,
}) => {
  // 1. If it's a practical task submission
  if (task || video?.isTaskSubmission || video?.taskId) {
    const taskTitle = task?.title || video?.taskTitle || video?.taskId || 'Practical Task';
    return sanitizeFolderName(`Task - ${taskTitle}`, 'Task - Practical Task');
  }

  // 2. If video explicitly has a lessonTitle
  if (video?.lessonTitle && typeof video.lessonTitle === 'string' && video.lessonTitle.trim()) {
    return sanitizeFolderName(video.lessonTitle.trim());
  }

  // 3. If selectedLesson is explicitly active and matches a scheduled lesson
  if (selectedLesson && Array.isArray(lessons) && lessons.length > 0) {
    const match = lessons.find((l) => getLessonKey(l) === selectedLesson);
    if (match) {
      return formatLessonFolderName({ lesson: match, index: match.index || 1, customTitles });
    }
  }

  // 4. Match video startTime against scheduled lessons
  const vidTime = video?.startTime || video?.startedAt || video?.createdAt;
  if (vidTime && Array.isArray(lessons) && lessons.length > 0) {
    const matchedLesson = findLessonForTimestamp(vidTime, lessons);
    if (matchedLesson) {
      return formatLessonFolderName({
        lesson: matchedLesson,
        index: matchedLesson.index,
        customTitles,
      });
    }
  }

  // 5. Fallback with Date
  if (vidTime) {
    try {
      const d = vidTime?.toDate && typeof vidTime.toDate === 'function'
        ? vidTime.toDate()
        : (vidTime instanceof Date ? vidTime : new Date(vidTime));
      if (!isNaN(d.getTime())) {
        return sanitizeFolderName(`Session ${d.toISOString().slice(0, 10)}`);
      }
    } catch {}
  }

  return 'General Recordings';
};
