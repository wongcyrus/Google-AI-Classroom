/**
 * Utility functions for evaluating student invigilation compliance,
 * filtering problem students, and generating targeted teacher interventions.
 */

/**
 * Evaluates the compliance of an individual student given class settings and streaming state.
 *
 * @param {Object} student - Student status object (id, email, isSharing, isWebcamSharing, isAudioSharing, faceStatus, etc.)
 * @param {Object} classSettings - Class configuration (captureMode, enableAudioCapture, isCapturing, etc.)
 * @param {Object} [screenshotData] - Most recent screenshot data (screen, webcam, timestamp)
 * @param {boolean} [isFresh=true] - Whether stream heartbeat/screenshot is within freshness threshold
 * @returns {Object} { isCompliant: boolean, issues: Array<{ type: string, label: string, severity: 'high' | 'medium' | 'low' }> }
 */
export function evaluateStudentCompliance(student, classSettings = {}, screenshotData = null, isFresh = true) {
  const issues = [];
  const safeSettings = classSettings || {};
  const captureMode = safeSettings.captureMode || 'screen'; // 'screen' | 'webcam' | 'dual'
  const enableAudioCapture = Boolean(safeSettings.enableAudioCapture);

  // 1. Screen sharing check
  const hasScreenActive = Boolean(student?.isSharing && (isFresh || screenshotData?.screen?.url || screenshotData?.url));
  if (!hasScreenActive) {
    issues.push({
      type: 'no_screen',
      label: 'Not Sharing Screen / Offline',
      severity: 'high',
    });
  }

  // 2. Webcam check (required if class captureMode is 'dual' or 'webcam')
  const isWebcamRequired = captureMode === 'dual' || captureMode === 'webcam';
  const hasWebcamActive = Boolean(student?.isWebcamSharing && (screenshotData?.webcam?.url || isFresh));
  if (isWebcamRequired && !hasWebcamActive) {
    issues.push({
      type: 'no_cam',
      label: 'Webcam Inactive / Missing',
      severity: 'high',
    });
  }

  // 3. Microphone check (required if audio capture is enabled)
  const hasMicActive = Boolean(student?.isAudioSharing && !student?.audioError);
  if (enableAudioCapture && !hasMicActive) {
    issues.push({
      type: 'no_mic',
      label: student?.audioError ? `Mic Error: ${student.audioError}` : 'Microphone Inactive',
      severity: 'medium',
    });
  }

  // 4. AI Invigilation & Face/Gaze Alerts
  const faceStatus = student?.faceStatus;
  const isFaceAnomaly = faceStatus && !['normal', 'disabled', 'cloud_fallback', 'initializing'].includes(faceStatus);
  const isAudioAnomaly = Boolean(student?.isMultiSpeaker || (student?.speakerCount > 1));
  const hasActiveViolation = Boolean(student?.activeViolation);

  if (isFaceAnomaly || isAudioAnomaly || hasActiveViolation) {
    let alertLabel = 'AI Flag Active';
    if (faceStatus === 'no_face') alertLabel = 'No Face in Frame';
    else if (faceStatus === 'looking_away') alertLabel = `Looking Away (${student.yawAngle > 0 ? '+' : ''}${student.yawAngle || 0}°)`;
    else if (faceStatus === 'multiple_faces') alertLabel = 'Multiple Faces in Frame';
    else if (isAudioAnomaly) alertLabel = 'Multiple Speakers Detected';
    else if (hasActiveViolation) alertLabel = `Active Violation: ${student.activeViolation}`;

    issues.push({
      type: 'ai_alert',
      label: alertLabel,
      severity: 'high',
    });
  }

  return {
    isCompliant: issues.length === 0,
    issues,
    issueCount: issues.length,
    hasSevereIssue: issues.some((i) => i.severity === 'high'),
  };
}

/**
 * Computes real-time compliance counts for badge dropdowns.
 *
 * @param {Array<Object>} students - Array of student status objects
 * @param {Object} classSettings - Class configuration
 * @param {Object} [screenshots={}] - Map of student UID to screenshot data
 * @returns {Object} { total: number, problems: number, noCam: number, noMic: number, noScreen: number, aiAlert: number }
 */
export function getComplianceSummary(students = [], classSettings = {}, screenshots = {}) {
  let problems = 0;
  let noCam = 0;
  let noMic = 0;
  let noScreen = 0;
  let aiAlert = 0;

  for (const student of students) {
    const screenshotData = screenshots[student.id];
    const { issues } = evaluateStudentCompliance(student, classSettings, screenshotData, true);

    if (issues.length > 0) {
      problems += 1;
    }
    for (const issue of issues) {
      if (issue.type === 'no_cam') noCam += 1;
      if (issue.type === 'no_mic') noMic += 1;
      if (issue.type === 'no_screen') noScreen += 1;
      if (issue.type === 'ai_alert') aiAlert += 1;
    }
  }

  return {
    total: students.length,
    problems,
    noCam,
    noMic,
    noScreen,
    aiAlert,
  };
}

/**
 * Filters students by specific compliance issue type.
 *
 * @param {Array<Object>} students - Array of student status objects
 * @param {string} filterType - 'all' | 'problems' | 'no_cam' | 'no_mic' | 'no_screen' | 'ai_alert'
 * @param {Object} classSettings - Class configuration
 * @param {Object} [screenshots={}] - Map of student UID to screenshot data
 * @returns {Array<Object>} Filtered students
 */
export function filterStudentsByCompliance(students = [], filterType = 'all', classSettings = {}, screenshots = {}) {
  if (!filterType || filterType === 'all') {
    return students;
  }

  return students.filter((student) => {
    const screenshotData = screenshots[student.id];
    const { issues } = evaluateStudentCompliance(student, classSettings, screenshotData, true);

    if (filterType === 'problems') {
      return issues.length > 0;
    }

    return issues.some((issue) => issue.type === filterType);
  });
}

/**
 * Returns a targeted direct/broadcast nudge message string based on the active filter.
 *
 * @param {string} filterType - 'problems' | 'no_cam' | 'no_mic' | 'no_screen' | 'ai_alert'
 * @returns {string} Suggested nudge text
 */
export function getNudgeMessageForFilter(filterType) {
  switch (filterType) {
    case 'no_cam':
      return '⚠️ Invigilation Notice: Your webcam feed is required for this session. Please turn on your camera immediately.';
    case 'no_mic':
      return '⚠️ Invigilation Notice: Microphone monitoring is required. Please check and enable your microphone permissions.';
    case 'no_screen':
      return '⚠️ Invigilation Notice: You are not currently sharing your screen. Please start sharing your entire screen.';
    case 'ai_alert':
      return '⚠️ Invigilation Notice: Please ensure you are looking directly at your monitor and your face remains centered in the camera.';
    case 'problems':
    default:
      return '⚠️ Invigilation Notice: Please ensure your screen share, webcam, and microphone are active and compliant with class rules.';
  }
}

/**
 * Generates and downloads a CSV of the current filtered student compliance audit results.
 *
 * @param {Array<Object>} filteredStudents - Currently filtered students
 * @param {string} filterType - Active filter key ('all', 'problems', 'no_cam', etc.)
 * @param {Object} classSettings - Class configuration
 * @param {Object} screenshots - Map of student ID to screenshot data
 * @param {string} classId - Class ID for the file naming
 * @returns {string} CSV content string
 */
export function exportComplianceResultsToCsv(filteredStudents = [], filterType = 'all', classSettings = {}, screenshots = {}, classId = 'CLASS') {
  const headers = [
    'Student ID',
    'Student Email',
    'Filter Category',
    'Compliance Status',
    'Detected Issues',
    'Screen Sharing',
    'Webcam Sharing',
    'Audio Sharing',
    'Face / Gaze Status',
    'Yaw Angle',
    'Snapshot Time'
  ];

  const escape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = filteredStudents.map((student) => {
    const screenshotData = screenshots[student.id];
    const { isCompliant, issues } = evaluateStudentCompliance(student, classSettings, screenshotData, true);
    const issuesText = issues.map((i) => i.label).join('; ') || 'None';
    
    let timestampStr = '';
    if (screenshotData?.timestamp?.toDate) {
      timestampStr = screenshotData.timestamp.toDate().toISOString();
    } else if (screenshotData?.timestamp) {
      timestampStr = new Date(screenshotData.timestamp).toISOString();
    } else {
      timestampStr = new Date().toISOString();
    }

    return [
      escape(student.id),
      escape(student.email || student.id),
      escape(filterType),
      escape(isCompliant ? 'Compliant' : 'Non-Compliant'),
      escape(issuesText),
      escape(student.isSharing ? 'Active' : 'Inactive'),
      escape(student.isWebcamSharing ? 'Active' : 'Inactive'),
      escape(student.isAudioSharing ? 'Active' : 'Inactive'),
      escape(student.faceStatus || 'normal'),
      escape(student.yawAngle !== undefined ? student.yawAngle : '0'),
      escape(timestampStr)
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\n');

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.setAttribute('download', `compliance-filter-${filterType}-${classId}-${timestamp}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return csvContent;
}

