import './firebase.js';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  CORS_ORIGINS,
  FUNCTION_REGION,
  AI_TRANSCRIBE_MODEL,
  DEFAULT_LECTURE_AI_MODEL,
} from './config.js';
import { generateWithResilience } from './analysisFlows.js';
import { calculateCost } from './cost.js';
import { logJob } from './jobLogger.js';

const db = getFirestore();
const storage = getStorage();

export const DEFAULT_PROJECT_MEETING_PROMPT = `You are an expert academic project supervisor and technical meeting analyst for higher education Capstone / Final Year Project (FYP) weekly supervision meetings in Hong Kong.
Speakers in the meeting code-switch naturally between Cantonese, Mandarin, and English technical terminology (e.g., React, Firestore, Docker, Cloud Run, CI/CD, API, Git, PR).`;

/**
 * Formats seconds (integer or float) into MM:SS string.
 */
export function formatSecondsToMmSs(seconds) {
  const totalSecs = Math.max(0, Math.floor(Number(seconds) || 0));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Parses an MM:SS or HH:MM:SS timestamp string into total seconds.
 */
export function parseTimestampToSeconds(ts) {
  if (typeof ts === 'number') return Math.max(0, Math.floor(ts));
  if (!ts || typeof ts !== 'string') return 0;
  const clean = ts.replace(/[\[\]]/g, '').trim();
  const parts = clean.split(':').map((n) => parseFloat(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) {
    return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (parts.length === 2) {
    return Math.floor(parts[0] * 60 + parts[1]);
  }
  return Math.floor(parts[0] || 0);
}

/**
 * Shifts [MM:SS] timestamps in a diarized transcript by offsetSeconds for multi-clip meetings.
 */
export function offsetTranscriptTimestamps(transcriptText, offsetSeconds = 0) {
  if (!transcriptText || !offsetSeconds || offsetSeconds <= 0) {
    return transcriptText || '';
  }
  return String(transcriptText).replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (_match, ts) => {
    const secs = parseTimestampToSeconds(ts) + Math.floor(offsetSeconds);
    return `[${formatSecondsToMmSs(secs)}]`;
  });
}

/**
 * Detects whether `gemini-3.5-transcribe-preview` prematurely stopped (e.g. due to a 15s silence pause
 * or unary audio token ceiling) on a long meeting clip (>= 360s / 6+ minutes).
 */
export function isLongClipTranscriptTruncated(transcriptText, durationSeconds = 0) {
  const dur = Number(durationSeconds) || 0;
  if (dur < 360) return false;
  const clean = String(transcriptText || '').trim();
  if (clean.length < 120) return true;
  const matches = [...clean.matchAll(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g)];
  if (matches.length === 0) return false;
  let maxTsSecs = 0;
  for (const m of matches) {
    const secs = parseTimestampToSeconds(m[1]);
    if (secs > maxTsSecs) maxTsSecs = secs;
  }
  return maxTsSecs > 0 && maxTsSecs < dur * 0.45;
}

/**
 * Resolves the MIME contentType for an audio storage path or clip metadata.
 */
export function resolveAudioMimeType(storagePath = '', explicitMime = '') {
  if (explicitMime && typeof explicitMime === 'string' && explicitMime.startsWith('audio/')) {
    return explicitMime.split(';')[0].trim();
  }
  const lower = String(storagePath || '').toLowerCase();
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'audio/mp4';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.ogg') || lower.endsWith('.opus')) return 'audio/ogg';
  return 'audio/webm';
}

/**
 * Reconciles AI-extracted attendance and student contributions against the authoritative group member roster,
 * honoring manual supervisor overrides, 1-tap voice anchors, and Student PC screen presenter clips.
 */
export function reconcileMeetingRosterResults({
  members = [],
  existingAttendance = [],
  aiAttendance = [],
  aiContributions = [],
  voiceAnchors = [],
  screenClips = [],
}) {
  const existingByKey = new Map();
  (Array.isArray(existingAttendance) ? existingAttendance : []).forEach((entry) => {
    const key = (entry.email || entry.uid || '').toLowerCase().trim();
    if (key) existingByKey.set(key, entry);
  });

  const aiAttByKey = new Map();
  (Array.isArray(aiAttendance) ? aiAttendance : []).forEach((entry) => {
    const emailKey = (entry.email || '').toLowerCase().trim();
    const uidKey = (entry.uid || '').toLowerCase().trim();
    const nameKey = (entry.name || '').toLowerCase().trim();
    if (emailKey) aiAttByKey.set(emailKey, entry);
    if (uidKey) aiAttByKey.set(uidKey, entry);
    if (nameKey) aiAttByKey.set(nameKey, entry);
  });

  const aiContribByKey = new Map();
  (Array.isArray(aiContributions) ? aiContributions : []).forEach((entry) => {
    const emailKey = (entry.email || '').toLowerCase().trim();
    const uidKey = (entry.uid || '').toLowerCase().trim();
    const nameKey = (entry.name || '').toLowerCase().trim();
    if (emailKey) aiContribByKey.set(emailKey, entry);
    if (uidKey) aiContribByKey.set(uidKey, entry);
    if (nameKey) aiContribByKey.set(nameKey, entry);
  });

  const normalizedMembers = Array.isArray(members) ? members : [];

  const attendanceRecord = normalizedMembers.map((member) => {
    const email = (member.email || '').toLowerCase().trim();
    const uid = member.uid || email;
    const name = member.name || member.studentName || email;
    const existing = existingByKey.get(email) || existingByKey.get(uid.toLowerCase());
    const aiAtt =
      aiAttByKey.get(email) ||
      aiAttByKey.get(uid.toLowerCase()) ||
      aiAttByKey.get(name.toLowerCase()) ||
      null;

    const studentAnchors = (Array.isArray(voiceAnchors) ? voiceAnchors : []).filter(
      (a) =>
        (a.email && a.email.toLowerCase().trim() === email) ||
        (a.studentUid && a.studentUid === uid) ||
        (a.name && a.name.toLowerCase().trim() === name.toLowerCase())
    );

    const studentScreens = (Array.isArray(screenClips) ? screenClips : []).filter(
      (s) =>
        (s.studentEmail && s.studentEmail.toLowerCase().trim() === email) ||
        (s.studentUid && s.studentUid === uid) ||
        (s.studentName && s.studentName.toLowerCase().trim() === name.toLowerCase())
    );

    const hasAnchorOrScreen = studentAnchors.length > 0 || studentScreens.length > 0;
    const firstAnchorTs =
      studentAnchors.length > 0
        ? studentAnchors[0].timestamp || formatSecondsToMmSs(studentAnchors[0].timeSeconds || 0)
        : '';

    let status = aiAtt?.status || (hasAnchorOrScreen ? 'present' : 'absent');
    if (!['present', 'late', 'absent'].includes(status)) {
      status = hasAnchorOrScreen ? 'present' : 'absent';
    }
    if (hasAnchorOrScreen && status === 'absent') {
      status = 'present';
    }

    let teacherVerified = false;
    if (existing && existing.teacherVerified) {
      status = existing.status || status;
      teacherVerified = true;
    } else if (studentAnchors.length > 0) {
      teacherVerified = true;
    }

    const defaultEvidenceParts = [];
    if (studentAnchors.length > 0) {
      defaultEvidenceParts.push(`Supervisor tapped Speaking Now at [${firstAnchorTs}].`);
    }
    if (studentScreens.length > 0) {
      defaultEvidenceParts.push(`Presented PC screen (${studentScreens.map((s) => s.label || 'Screen Clip').join(', ')}).`);
    }

    const evidence =
      aiAtt?.evidence ||
      defaultEvidenceParts.join(' ') ||
      (status === 'present' ? 'Detected in meeting discussion.' : 'No spoken turn or screen demo detected.');

    const speakingContribution =
      aiAtt?.speakingContribution && ['high', 'moderate', 'low', 'none'].includes(aiAtt.speakingContribution)
        ? aiAtt.speakingContribution
        : status === 'present'
        ? hasAnchorOrScreen
          ? 'high'
          : 'moderate'
        : 'none';

    return {
      uid,
      email,
      name,
      role: member.role || 'Member',
      status,
      detectedByAi: Boolean(aiAtt?.status === 'present' || aiAtt?.status === 'late' || hasAnchorOrScreen),
      teacherVerified,
      speakingContribution,
      evidence,
      firstHeardTimestamp: aiAtt?.firstHeardTimestamp || firstAnchorTs || '',
    };
  });

  const studentContributions = normalizedMembers.map((member) => {
    const email = (member.email || '').toLowerCase().trim();
    const uid = member.uid || email;
    const name = member.name || member.studentName || email;
    const aiContrib =
      aiContribByKey.get(email) ||
      aiContribByKey.get(uid.toLowerCase()) ||
      aiContribByKey.get(name.toLowerCase()) ||
      {};

    const studentAnchors = (Array.isArray(voiceAnchors) ? voiceAnchors : []).filter(
      (a) =>
        (a.email && a.email.toLowerCase().trim() === email) ||
        (a.studentUid && a.studentUid === uid)
    );
    const anchorTimestamps = studentAnchors.map(
      (a) => a.timestamp || formatSecondsToMmSs(a.timeSeconds || 0)
    );

    const rawTimestamps = Array.isArray(aiContrib.timestamps) ? aiContrib.timestamps : [];
    const mergedTimestamps = [...new Set([...anchorTimestamps, ...rawTimestamps.map((t) => String(t).replace(/[\[\]]/g, '').trim())])].filter(Boolean);

    const validLogQualityStatuses = [
      'genuine_verified',
      'genuine',
      'vague_useless',
      'suspected_ai_unverified',
      'suspected_ai_fake',
      'contradicted_in_meeting',
      'inactive',
      'not_submitted',
    ];
    const logQualityAssessment = validLogQualityStatuses.includes(aiContrib.logQualityAssessment)
      ? aiContrib.logQualityAssessment
      : 'not_submitted';

    const logQualityScore =
      typeof aiContrib.logQualityScore === 'number' && !Number.isNaN(aiContrib.logQualityScore)
        ? Math.max(0, Math.min(10, Math.round(aiContrib.logQualityScore * 10) / 10))
        : null;

    const realWorkScore =
      typeof aiContrib.realWorkScore === 'number' && !Number.isNaN(aiContrib.realWorkScore)
        ? Math.max(0, Math.min(10, Math.round(aiContrib.realWorkScore * 10) / 10))
        : null;

    const weeklyFeedback =
      typeof aiContrib.weeklyFeedback === 'string' && aiContrib.weeklyFeedback.trim()
        ? aiContrib.weeklyFeedback.trim()
        : '';

    const challengeQuestions = Array.isArray(aiContrib.challengeQuestions)
      ? aiContrib.challengeQuestions.map((q) => String(q || '').trim()).filter(Boolean)
      : [];

    return {
      uid,
      email,
      name,
      role: member.role || 'Member',
      workCompleted: Array.isArray(aiContrib.workCompleted) ? aiContrib.workCompleted.filter(Boolean) : [],
      currentChallenges: Array.isArray(aiContrib.currentChallenges) ? aiContrib.currentChallenges.filter(Boolean) : [],
      actionItemsNextWeek: Array.isArray(aiContrib.actionItemsNextWeek) ? aiContrib.actionItemsNextWeek.filter(Boolean) : [],
      aiContributionAssessment:
        typeof aiContrib.aiContributionAssessment === 'string' && aiContrib.aiContributionAssessment.trim()
          ? aiContrib.aiContributionAssessment.trim()
          : 'No specific update extracted from audio.',
      logQualityAssessment,
      logQualityScore,
      realWorkScore,
      weeklyFeedback,
      challengeQuestions,
      timestamps: mergedTimestamps,
    };
  });

  return { attendanceRecord, studentContributions };
}

/**
 * Pre-Meeting AI Log Quality Audit & Challenge Question Generator (`mode === 'prepare_log_questions'`).
 * Audits students' submitted Weekly Logs (and prior weeks' log history) to detect useless/vague logs
 * and AI-generated/fake logs, and prepares sharp challenge questions for the supervisor to ask in the meeting.
 */
export async function handlePrepareProjectLogQuestions({
  classId,
  meetingId,
  groupId,
  groupName,
  projectTopic,
  weekNumber = 1,
  weeklyLogs = [],
  preferredModel,
  auth,
}) {
  if (!classId) {
    throw new HttpsError('invalid-argument', '"classId" is required.');
  }
  if (!Array.isArray(weeklyLogs) || weeklyLogs.length === 0) {
    throw new HttpsError('invalid-argument', 'At least one student weekly log entry is required in "weeklyLogs".');
  }

  const reasoningModel = preferredModel || DEFAULT_LECTURE_AI_MODEL || 'gemini-3.8-flash';

  const logsFormatted = weeklyLogs
    .map((l, idx) => {
      const priorSummary = Array.isArray(l.priorHistory) && l.priorHistory.length > 0
        ? l.priorHistory
            .map(
              (p) =>
                `  * Week ${p.weekNumber}: Doing=${p.isDoingSomething ? 'Yes' : 'No'} | WorkDone="${p.workDone || p.inactiveReason || ''}" | Plan="${p.nextPlan || ''}"`
            )
            .join('\n')
        : '  * No prior weekly logs submitted.';
      return `### Student ${idx + 1}: ${l.studentName || l.name || 'Student'} (ID: ${l.studentId || 'N/A'}, Email: ${l.email || 'N/A'})
- Week ${weekNumber} Submitted: ${l.submitted === false ? 'NO LOG SUBMITTED THIS WEEK' : 'Yes'}
- "I am doing something this week": ${l.isDoingSomething ? 'Yes' : 'No'}
- "Work done & findings since last recording": "${l.workDone || ''}"
- "Part of last plan not yet finished": "${l.unfinished || ''}"
- "Plan of work before next recording": "${l.nextPlan || ''}"
- "Reason if No work": "${l.inactiveReason || ''}"
- Prior Weeks Log History (for Continuity & Sudden-Jump Fake Detection):
${priorSummary}`;
    })
    .join('\n\n');

  const prompt = `${DEFAULT_PROJECT_MEETING_PROMPT}

## Pre-Meeting Weekly Log Audit & Fake-Log Challenge Question Task
You are helping the project supervisor prepare for **${groupName || groupId || 'Project Group'} — Week ${weekNumber}** supervision meeting (Project Topic: ${projectTopic || 'Capstone Project'}).

In this course, **writing a high-quality weekly log that accurately reflects real engineering work is an explicit grading criterion**.
However, two common student problems occur in the weekly log sheet:
1. **Useless / Vague Logs (\`vague_useless\`)**: 1-to-4 word filler like "done", "finish", "thinking", "do website", "proposal", or copy-pasting previous weeks' logs without concrete technical findings or deliverables.
2. **Fake / AI-Generated Logs (\`suspected_ai_fake\`)**: Logs that appear written by ChatGPT/AI to sound impressive (buzzword-heavy corporate prose like "Implemented real-time dashboards, mock AI chatbot, and role-based access control" or sudden massive multi-module claims right after weeks of writing "done" or "No"), without specific file names, bugs encountered, or continuity with last week's plan.

## Students' Week ${weekNumber} Logs & Prior History
${logsFormatted}

## Instructions
For EVERY student listed above:
1. Classify \`logQualityStatus\` as one of:
   - \`"genuine"\`: Specific, honest, technically grounded log that connects logically to prior plans.
   - \`"vague_useless"\`: Too brief, generic ("done", "thinking"), or copy-pasted to evaluate real work.
   - \`"suspected_ai_fake"\`: Overly polished AI buzzword dump, suspicious sudden leap from prior "done"/"No" logs, or claims too many unverified subsystems at once.
   - \`"inactive"\`: Answered "No" to doing work this week or did not submit a log.
2. Assign \`logQualityScore\` from \`0\` to \`10\` (e.g., 8-10 for genuine detailed logs; 3-5 for suspected AI/fake logs pending verification; 1-4 for vague/useless logs; 0-2 for inactive/missing).
3. Write a concise \`logAuditSummary\` (1-2 sentences explaining why the log received this score and what looks genuine, vague, or AI-faked).
4. Generate 2 to 3 sharp, specific \`challengeQuestions\` for the supervisor to ask the student live during the meeting:
   - If \`suspected_ai_fake\`: Ask live code-walkthrough & debugging challenge questions that a student who faked the log with AI cannot answer without showing real code (e.g., "Open the exact Flask route / database table on screen now and show how X handles Y", "What specific error did you hit when integrating X and how did you fix it?").
   - If \`vague_useless\`: Demand immediate screen demonstration of concrete artifacts and measurable next-week deliverables.
   - If \`genuine\`: Ask constructive technical design & edge-case verification questions about their reported findings.

Respond strictly with valid JSON matching this structure:
{
  "preMeetingLogAudit": [
    {
      "studentId": "250105348",
      "email": "250105348@stu.vtc.edu.hk",
      "name": "Student Name",
      "logQualityStatus": "suspected_ai_fake",
      "logQualityScore": 4,
      "logAuditSummary": "Sudden leap from 'done' in Weeks 6-7 to claiming full Flask backend, real-time dashboards, mock AI chatbot, and RBAC in one week.",
      "challengeQuestions": [
        "Share your screen and open your Flask route file: walk us through how the Doctor/Patient role-based access control check is implemented in code.",
        "Which database tables back your real-time dashboard and history page, and can you trigger a live state update right now?",
        "What was the hardest bug you fixed while connecting the frontend to Flask this week?"
      ]
    }
  ]
}`;

  const { response, modelUsed } = await generateWithResilience(
    {
      prompt: [{ text: prompt }],
      config: {
        temperature: 0.2,
        maxOutputTokens: 16384,
        responseMimeType: 'application/json',
      },
    },
    reasoningModel
  );

  const usage = response.usage || {};
  const inputTokens = usage.inputTokens ?? usage.promptTokenCount ?? 0;
  const outputTokens = usage.outputTokens ?? usage.candidatesTokenCount ?? 0;
  const cost = calculateCost(usage, modelUsed);

  let rawJsonText = (response.text || '').trim();
  if (rawJsonText.startsWith('```json')) {
    rawJsonText = rawJsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
  } else if (rawJsonText.startsWith('```')) {
    rawJsonText = rawJsonText.replace(/^```\s*/, '').replace(/```\s*$/i, '');
  }

  let parsed = {};
  try {
    parsed = JSON.parse(rawJsonText);
  } catch (err) {
    console.warn('[handlePrepareProjectLogQuestions] JSON parse fallback:', err.message);
    parsed = { preMeetingLogAudit: [] };
  }

  const preMeetingLogAudit = Array.isArray(parsed.preMeetingLogAudit) ? parsed.preMeetingLogAudit : [];

  if (meetingId) {
    const meetingRef = db.doc(`classes/${classId}/projectMeetings/${meetingId}`);
    await meetingRef
      .set(
        {
          preMeetingLogAudit,
          weeklyLogs,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      )
      .catch((e) => console.warn('[handlePrepareProjectLogQuestions] Could not save to meeting doc:', e.message));
  }

  await logJob({
    classId,
    studentUid: auth?.uid || 'teacher',
    studentEmail: auth?.token?.email || '',
    jobType: 'prepareProjectLogQuestions',
    status: 'completed',
    promptText: prompt.slice(0, 2000),
    mediaPaths: [],
    usage: { inputTokens, outputTokens },
    cost,
    modelUsed,
    result: JSON.stringify({
      groupId,
      weekNumber,
      auditedCount: preMeetingLogAudit.length,
    }),
  }).catch(() => {});

  return {
    success: true,
    mode: 'prepare_log_questions',
    preMeetingLogAudit,
    aiModelUsed: modelUsed,
    aiCost: cost,
  };
}

/**
 * Core handler for Two-Stage Project Group Meeting Analysis:
 * Stage 1: Speaker Diarization via `gemini-3.5-transcribe-preview` (`AI_TRANSCRIBE_MODEL`) across all grouped `audioClips[]`.
 * Stage 2: Roster Attribution, Attendance, Key Insights, Log Quality vs. Real Work Verification & Weekly Feedback via `gemini-3.8-flash` (or `preferredModel`).
 */
export async function handleAnalyzeProjectMeeting({
  classId,
  meetingId,
  preferredModel,
  customPromptText,
  weeklyLogs,
  mode,
  groupId: reqGroupId,
  groupName: reqGroupName,
  projectTopic: reqProjectTopic,
  weekNumber: reqWeekNumber,
  auth,
}) {
  if (mode === 'prepare_log_questions') {
    return await handlePrepareProjectLogQuestions({
      classId,
      meetingId,
      groupId: reqGroupId,
      groupName: reqGroupName,
      projectTopic: reqProjectTopic,
      weekNumber: reqWeekNumber,
      weeklyLogs,
      preferredModel,
      auth,
    });
  }
  if (!classId || !meetingId) {
    throw new HttpsError('invalid-argument', 'Both "classId" and "meetingId" are required.');
  }

  const meetingRef = db.doc(`classes/${classId}/projectMeetings/${meetingId}`);
  const meetingSnap = await meetingRef.get();
  if (!meetingSnap.exists) {
    throw new HttpsError('not-found', `Project meeting ${meetingId} not found in class ${classId}.`);
  }

  const meetingData = meetingSnap.data() || {};
  const groupId = meetingData.groupId || '';

  // Load Project Group roster
  let groupData = {
    name: meetingData.groupName || 'Project Group',
    projectTopic: meetingData.projectTopic || '',
    supervisorEmail: meetingData.supervisorEmail || auth?.token?.email || '',
    supervisorName: meetingData.supervisorName || '',
    members: Array.isArray(meetingData.members) ? meetingData.members : [],
  };

  if (groupId) {
    const groupSnap = await db.doc(`classes/${classId}/projectGroups/${groupId}`).get();
    if (groupSnap.exists) {
      const g = groupSnap.data() || {};
      groupData = {
        name: g.name || groupData.name,
        projectTopic: g.projectTopic || groupData.projectTopic,
        supervisorEmail: g.supervisorEmail || groupData.supervisorEmail,
        supervisorName: g.supervisorName || groupData.supervisorName,
        members: Array.isArray(g.members) && g.members.length > 0 ? g.members : groupData.members,
      };
    }
  }

  // Fetch prior week's meeting for action-item continuity check
  let priorWeekContext = 'None (First recorded meeting for this group).';
  if (groupId) {
    try {
      const priorSnap = await db
        .collection(`classes/${classId}/projectMeetings`)
        .where('groupId', '==', groupId)
        .get();
      const priorDocs = priorSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((m) => m.id !== meetingId && m.status === 'ready' && Array.isArray(m.studentContributions))
        .sort((a, b) => (Number(b.weekNumber) || 0) - (Number(a.weekNumber) || 0));

      if (priorDocs.length > 0) {
        const prev = priorDocs[0];
        const prevSummaryLines = (prev.studentContributions || []).map((sc) => {
          const items = Array.isArray(sc.actionItemsNextWeek) && sc.actionItemsNextWeek.length > 0
            ? sc.actionItemsNextWeek.join('; ')
            : 'No specific action items';
          return `- ${sc.name} (${sc.email}): Assigned Action Items from Week ${prev.weekNumber || '?'}: ${items}`;
        });
        if (prevSummaryLines.length > 0) {
          priorWeekContext = prevSummaryLines.join('\n');
        }
      }
    } catch (priorErr) {
      console.warn('[analyzeProjectMeeting] Could not fetch prior meetings context:', priorErr.message);
    }
  }

  // Collect grouped audio clips in chronological order
  const rawClips = Array.isArray(meetingData.audioClips) && meetingData.audioClips.length > 0
    ? meetingData.audioClips
    : meetingData.audioStoragePath
    ? [
        {
          clipId: 'clip_1',
          label: 'Part 1',
          storagePath: meetingData.audioStoragePath,
          durationSeconds: meetingData.durationSeconds || 0,
          mimeType: meetingData.mimeType || 'audio/webm',
        },
      ]
    : [];

  if (rawClips.length === 0 && !meetingData.rawDiarizedTranscript) {
    throw new HttpsError(
      'failed-precondition',
      'No voice recording clips found on this meeting. Please record or upload at least one voice clip before analyzing.'
    );
  }

  await meetingRef.update({
    status: 'analyzing',
    analysisStartedAt: FieldValue.serverTimestamp(),
  });

  const bucketName =
    process.env.STORAGE_BUCKET_NAME ||
    storage.app?.options?.storageBucket ||
    `${db.projectId || 'it114115-dev-2026'}.firebasestorage.app`;

  const transcribeModel = AI_TRANSCRIBE_MODEL || 'gemini-3.5-transcribe-preview';
  const reasoningModel = preferredModel || meetingData.aiModel || DEFAULT_LECTURE_AI_MODEL || 'gemini-3.8-flash';

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const modelsUsedSet = new Set();

  try {
    // =========================================================================
    // STAGE 1: Acoustic Speaker Diarization with `gemini-3.5-transcribe-preview`
    // =========================================================================
    const clipTranscripts = [];
    let cumulativeOffsetSeconds = 0;

    for (let i = 0; i < rawClips.length; i++) {
      const clip = rawClips[i];
      const storagePath = clip.storagePath || clip.audioStoragePath || '';
      if (!storagePath) continue;

      const gsUri = storagePath.startsWith('gs://')
        ? storagePath
        : `gs://${bucketName}/${storagePath.replace(/^\/+/, '')}`;
      const contentType = resolveAudioMimeType(storagePath, clip.audioMimeType || clip.mimeType);
      const presenterHint = clip.presenterStudentName
        ? ` Note: Student "${clip.presenterStudentName}" (${clip.presenterStudentEmail || ''}) was selected as the presenter during this clip.`
        : '';

      const diarizePrompt = `Transcribe this project supervision meeting audio clip (${clip.label || `Part ${i + 1}`}) verbatim in its original spoken language (Cantonese, Mandarin, or English, preserving English technical terms like React, Firestore, Docker, API).
Identify distinct voices using speaker diarization labels with [MM:SS] timestamps (e.g., [00:05] Speaker 1: ..., [00:42] Speaker 2: ...).${presenterHint}
If a speaker states their name or is addressed by name, include their name next to the speaker label (e.g., [00:42] Speaker 2 (Alice): ...).`;

      const { response: sttResponse, modelUsed: sttModelUsed } = await generateWithResilience(
        {
          config: {
            temperature: 0.1,
            maxOutputTokens: 65536,
          },
          prompt: [
            { text: diarizePrompt },
            { media: { url: gsUri, contentType } },
          ],
        },
        transcribeModel,
        DEFAULT_LECTURE_AI_MODEL
      );

      modelsUsedSet.add(sttModelUsed);
      const sttUsage = sttResponse.usage || {};
      totalInputTokens += sttUsage.inputTokens ?? sttUsage.promptTokenCount ?? 0;
      totalOutputTokens += sttUsage.outputTokens ?? sttUsage.candidatesTokenCount ?? 0;
      totalCost += calculateCost(sttUsage, sttModelUsed);

      let clipText = (sttResponse.text || '').trim();
      if (!clipText && sttResponse.message?.content) {
        clipText = sttResponse.message.content
          .map((p) => p.text || '')
          .filter(Boolean)
          .join(' ')
          .trim();
      }

      // Long-meeting safeguard (e.g. 20-60 min single clip): if gemini-3.5-transcribe-preview
      // prematurely cut off on a mid-meeting silence pause, recover full-length diarization via gemini-3.8-flash
      const clipDurationSecs = Number(clip.durationSeconds) || 0;
      if (
        sttModelUsed === transcribeModel &&
        isLongClipTranscriptTruncated(clipText, clipDurationSecs)
      ) {
        const longFallbackModel = DEFAULT_LECTURE_AI_MODEL || 'gemini-3.8-flash';
        const { response: fullSttResponse, modelUsed: fullSttModel } = await generateWithResilience(
          {
            config: {
              temperature: 0.1,
              maxOutputTokens: 65536,
              thinkingConfig: { thinkingBudget: 0 },
            },
            prompt: [
              {
                text: `${diarizePrompt}\nIMPORTANT: This meeting recording is ${formatSecondsToMmSs(clipDurationSecs)} long. Do NOT stop early on pauses; transcribe the entire recording from [00:00] through [${formatSecondsToMmSs(clipDurationSecs)}].`,
              },
              { media: { url: gsUri, contentType } },
            ],
          },
          longFallbackModel
        );
        modelsUsedSet.add(fullSttModel);
        const fullUsage = fullSttResponse.usage || {};
        totalInputTokens += fullUsage.inputTokens ?? fullUsage.promptTokenCount ?? 0;
        totalOutputTokens += fullUsage.outputTokens ?? fullUsage.candidatesTokenCount ?? 0;
        totalCost += calculateCost(fullUsage, fullSttModel);

        const recoveredText = (fullSttResponse.text || '').trim();
        if (recoveredText.length > clipText.length) {
          clipText = recoveredText;
        }
      }

      const shiftedText = offsetTranscriptTimestamps(clipText, cumulativeOffsetSeconds);
      clipTranscripts.push(
        `=== Clip ${i + 1}: ${clip.label || `Part ${i + 1}`} (Starts at [${formatSecondsToMmSs(cumulativeOffsetSeconds)}]) ===\n${shiftedText || '[No intelligible speech detected in this clip]'}`
      );

      cumulativeOffsetSeconds += Number(clip.durationSeconds) || 0;
    }

    const combinedDiarizedTranscript =
      clipTranscripts.length > 0
        ? clipTranscripts.join('\n\n')
        : meetingData.rawDiarizedTranscript || '';

    // =========================================================================
    // STAGE 2: Roster Speaker Mapping, Attendance, Key Insights & Work Done
    // =========================================================================
    const rosterLines = (groupData.members || []).map(
      (m, idx) =>
        `${idx + 1}. Name: "${m.name || m.studentName || m.email}" | Email: "${m.email}" | UID: "${m.uid || m.email}" | Role: "${m.role || 'Member'}"`
    );

    const voiceAnchors = Array.isArray(meetingData.voiceAnchors) ? meetingData.voiceAnchors : [];
    const voiceAnchorLines =
      voiceAnchors.length > 0
        ? voiceAnchors.map(
            (a) =>
              `- At [${a.timestamp || formatSecondsToMmSs(a.timeSeconds || 0)}] (Clip ${(a.clipIndex || 0) + 1}): Supervisor tapped "Speaking Now" for ${a.name} (${a.email || a.studentUid})`
          )
        : ['None recorded.'];

    const screenClips = Array.isArray(meetingData.screenClips) ? meetingData.screenClips : [];
    const screenClipLines =
      screenClips.length > 0
        ? screenClips.map(
            (s, idx) =>
              `- Screen Clip ${idx + 1} (${s.label || 'PC Screen'}): Student ${s.studentName} (${s.studentEmail || s.studentUid}) shared their PC screen (${s.durationSeconds || 0}s)`
          )
        : ['None recorded.'];

    const baseSystemPrompt = customPromptText || DEFAULT_PROJECT_MEETING_PROMPT;

    const effectiveWeeklyLogs =
      Array.isArray(weeklyLogs) && weeklyLogs.length > 0
        ? weeklyLogs
        : Array.isArray(meetingData.weeklyLogs)
        ? meetingData.weeklyLogs
        : [];

    const weeklyLogsLines =
      effectiveWeeklyLogs.length > 0
        ? effectiveWeeklyLogs.map((l, idx) => {
            const priorHist =
              Array.isArray(l.priorHistory) && l.priorHistory.length > 0
                ? ` | Prior Logs: ${l.priorHistory
                    .slice(-2)
                    .map((p) => `Wk${p.weekNumber}="${p.workDone || p.inactiveReason || 'No'}"`)
                    .join(', ')}`
                : '';
            return `${idx + 1}. ${l.studentName || l.name || 'Student'} (${l.email || l.studentId || ''}): DoingWork=${l.isDoingSomething ? 'Yes' : 'No'} | WorkDone="${l.workDone || ''}" | Unfinished="${l.unfinished || ''}" | NextPlan="${l.nextPlan || ''}" | ReasonIfNo="${l.inactiveReason || ''}"${priorHist}`;
          })
        : ['No weekly log sheet entries attached for this week.'];

    const reasoningPrompt = `${baseSystemPrompt}

## Meeting Metadata
- Class ID: ${classId}
- Project Group: ${groupData.name}
- Project Topic: ${groupData.projectTopic || 'General Capstone Project'}
- Week Number: Week ${meetingData.weekNumber || 1}
- Meeting Title: ${meetingData.title || `Week ${meetingData.weekNumber || 1} Supervision Meeting`}
- Supervisor: ${groupData.supervisorName || 'Supervisor'} (${groupData.supervisorEmail || 'teacher'})

## Enrolled Group Student Roster (${rosterLines.length} members)
${rosterLines.length > 0 ? rosterLines.join('\n') : 'No pre-assigned group members listed; infer student names from the transcript.'}

## Deterministic Speaker Anchors (1-Tap Supervisor Voice Tags & Student PC Screen Recordings)
### 1-Tap Supervisor "Speaking Now" Anchors (100% Ground Truth Speaker Identity at Timestamp):
${voiceAnchorLines.join('\n')}

### Student PC Screen Demonstration Clips (100% Ground Truth Presenter Identity):
${screenClipLines.join('\n')}

## Prior Week's Assigned Action Items (for Continuity Check)
${priorWeekContext}

## Students' Submitted Weekly Log Sheet Entries for Week ${meetingData.weekNumber || 1} (for Log Quality Grading & Fake-Log Verification)
${weeklyLogsLines.join('\n')}

## Stage 1 Diarized Audio Transcript (from gemini-3.5-transcribe-preview)
"""
${combinedDiarizedTranscript}
"""

## Task Instructions
Using the Stage 1 Diarized Audio Transcript, the Deterministic Speaker Anchors, and the Students' Submitted Weekly Logs above:
1. Resolve anonymous speaker labels (Speaker 1, Speaker 2, etc.) to the exact students in the Enrolled Group Student Roster or the Supervisor.
2. Determine the Attendance Record for every student in the roster ('present', 'late', or 'absent'), their speakingContribution ('high', 'moderate', 'low', 'none'), a concise evidence string with [MM:SS] timestamp, and firstHeardTimestamp ('MM:SS').
3. Extract Key Meeting Insights (executiveSummary, overallGroupProgress: 'on_track' | 'ahead' | 'at_risk' | 'behind', keyDecisions[], blockersAndRisks[], supervisorFeedback[], and weeklyGroupFeedback: a 2-4 sentence constructive post-meeting weekly feedback message for the group).
4. Cross-verify each student's **Submitted Weekly Log** against what they **actually discussed/demonstrated in the meeting**:
   - High-quality weekly logs that reflect real work are an explicit grading criterion.
   - Flag **vague/useless logs** (e.g. "done", "thinking") as \`"vague_useless"\` and **AI-generated/fake logs** that were NOT backed up by real understanding or code in the meeting as \`"suspected_ai_unverified"\` or \`"contradicted_in_meeting"\`. If verified by their spoken explanation/demo, mark \`"genuine_verified"\`.
   - Grade \`logQualityScore\` (0 to 10) and \`realWorkScore\` (0 to 10).
   - Provide 1-2 \`challengeQuestions\` (to challenge fake/vague log claims or verify next week's work) and a constructive 2-3 sentence \`weeklyFeedback\` for the student covering both their real project work and how to improve their weekly log quality.
5. Output speaker-attributed transcriptSegments[] with startTime ('MM:SS'), endTime ('MM:SS'), speaker (resolved student name or Supervisor), and text.

Respond strictly with valid JSON matching this exact structure:
{
  "attendanceRecord": [
    {
      "uid": "student_uid",
      "email": "student@stu.vtc.edu.hk",
      "name": "Student Name",
      "status": "present",
      "speakingContribution": "high",
      "evidence": "[00:42] Reported completion of backend API and demonstrated screen.",
      "firstHeardTimestamp": "00:42"
    }
  ],
  "keyInsights": {
    "executiveSummary": "2-4 sentence summary of the group meeting...",
    "overallGroupProgress": "on_track",
    "keyDecisions": ["Decision 1"],
    "blockersAndRisks": ["Blocker 1"],
    "supervisorFeedback": ["Feedback 1"],
    "weeklyGroupFeedback": "Constructive weekly summary feedback for the entire group after this meeting..."
  },
  "studentContributions": [
    {
      "uid": "student_uid",
      "email": "student@stu.vtc.edu.hk",
      "name": "Student Name",
      "workCompleted": ["Completed task A"],
      "currentChallenges": ["Challenge B"],
      "actionItemsNextWeek": ["Next week task C"],
      "aiContributionAssessment": "Clear technical progress...",
      "logQualityAssessment": "genuine_verified",
      "logQualityScore": 8,
      "realWorkScore": 8,
      "weeklyFeedback": "Good progress on the backend API and clear weekly log. For next week, complete the authentication middleware and include specific endpoint test results in your log.",
      "challengeQuestions": ["How will your API handle expired JWT tokens during a live session?"],
      "timestamps": ["00:42", "05:10"]
    }
  ],
  "transcriptSegments": [
    {
      "startTime": "00:00",
      "endTime": "00:41",
      "speaker": "Supervisor",
      "text": "..."
    }
  ]
}`;

    const { response: reasoningResponse, modelUsed: reasoningModelUsed } = await generateWithResilience(
      {
        prompt: [{ text: reasoningPrompt }],
        config: {
          temperature: 0.1,
          maxOutputTokens: 65536,
          responseMimeType: 'application/json',
        },
      },
      reasoningModel
    );

    modelsUsedSet.add(reasoningModelUsed);
    const reasoningUsage = reasoningResponse.usage || {};
    totalInputTokens += reasoningUsage.inputTokens ?? reasoningUsage.promptTokenCount ?? 0;
    totalOutputTokens += reasoningUsage.outputTokens ?? reasoningUsage.candidatesTokenCount ?? 0;
    totalCost += calculateCost(reasoningUsage, reasoningModelUsed);

    let rawJsonText = (reasoningResponse.text || '').trim();
    if (rawJsonText.startsWith('```json')) {
      rawJsonText = rawJsonText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
    } else if (rawJsonText.startsWith('```')) {
      rawJsonText = rawJsonText.replace(/^```\s*/, '').replace(/```\s*$/i, '');
    }

    let parsed = {};
    try {
      parsed = JSON.parse(rawJsonText);
    } catch (parseErr) {
      console.warn('[analyzeProjectMeeting] Could not parse Stage 2 JSON cleanly, using fallback wrapper:', parseErr.message);
      parsed = {
        keyInsights: {
          executiveSummary: rawJsonText.slice(0, 600) || 'Meeting transcript processed.',
          overallGroupProgress: 'on_track',
          keyDecisions: [],
          blockersAndRisks: [],
          supervisorFeedback: [],
          weeklyGroupFeedback: '',
        },
        attendanceRecord: [],
        studentContributions: [],
        transcriptSegments: [],
      };
    }

    // Reconcile against authoritative group roster
    const effectiveMembers =
      Array.isArray(groupData.members) && groupData.members.length > 0
        ? groupData.members
        : Array.isArray(parsed.attendanceRecord)
        ? parsed.attendanceRecord.map((a) => ({
            uid: a.uid || a.email || a.name,
            email: a.email || '',
            name: a.name || a.email || 'Student',
            role: 'Member',
          }))
        : [];

    const { attendanceRecord, studentContributions } = reconcileMeetingRosterResults({
      members: effectiveMembers,
      existingAttendance: meetingData.attendanceRecord || [],
      aiAttendance: parsed.attendanceRecord || [],
      aiContributions: parsed.studentContributions || [],
      voiceAnchors,
      screenClips,
    });

    const keyInsights = {
      executiveSummary: parsed.keyInsights?.executiveSummary || 'Weekly project group meeting completed.',
      overallGroupProgress: ['on_track', 'ahead', 'at_risk', 'behind'].includes(parsed.keyInsights?.overallGroupProgress)
        ? parsed.keyInsights.overallGroupProgress
        : 'on_track',
      keyDecisions: Array.isArray(parsed.keyInsights?.keyDecisions) ? parsed.keyInsights.keyDecisions : [],
      blockersAndRisks: Array.isArray(parsed.keyInsights?.blockersAndRisks) ? parsed.keyInsights.blockersAndRisks : [],
      supervisorFeedback: Array.isArray(parsed.keyInsights?.supervisorFeedback) ? parsed.keyInsights.supervisorFeedback : [],
      weeklyGroupFeedback:
        typeof parsed.keyInsights?.weeklyGroupFeedback === 'string'
          ? parsed.keyInsights.weeklyGroupFeedback.trim()
          : '',
    };

    const transcriptSegments = Array.isArray(parsed.transcriptSegments)
      ? parsed.transcriptSegments.map((seg) => ({
          startTime: String(seg.startTime || '00:00').replace(/[\[\]]/g, ''),
          endTime: String(seg.endTime || seg.startTime || '00:05').replace(/[\[\]]/g, ''),
          speaker: String(seg.speaker || 'Speaker'),
          text: String(seg.text || ''),
        }))
      : [];

    const combinedModelLabel = [...modelsUsedSet].join(' + ');

    await meetingRef.update({
      status: 'ready',
      rawDiarizedTranscript: combinedDiarizedTranscript,
      attendanceRecord,
      keyInsights,
      studentContributions,
      transcriptSegments,
      ...(effectiveWeeklyLogs.length > 0 ? { weeklyLogs: effectiveWeeklyLogs } : {}),
      aiModelUsed: combinedModelLabel,
      aiCost: totalCost,
      analyzedAt: FieldValue.serverTimestamp(),
      analysisError: null,
    });

    await logJob({
      classId,
      studentUid: auth?.uid || meetingData.supervisorUid || 'teacher',
      studentEmail: auth?.token?.email || meetingData.supervisorEmail || '',
      jobType: 'analyzeProjectMeeting',
      status: 'completed',
      promptText: reasoningPrompt.slice(0, 2000),
      mediaPaths: rawClips.map((c) => c.storagePath).filter(Boolean),
      usage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
      },
      cost: totalCost,
      modelUsed: combinedModelLabel,
      result: JSON.stringify({
        groupId,
        meetingId,
        presentCount: attendanceRecord.filter((a) => a.status === 'present' || a.status === 'late').length,
        overallGroupProgress: keyInsights.overallGroupProgress,
      }),
    });

    return {
      success: true,
      meetingId,
      aiModelUsed: combinedModelLabel,
      aiCost: totalCost,
      attendanceRecord,
      keyInsights,
      studentContributions,
      transcriptSegments,
    };
  } catch (err) {
    console.error('[analyzeProjectMeeting] Pipeline failed:', err);
    await meetingRef.update({
      status: 'analysis_failed',
      analysisError: err.message || String(err),
    }).catch(() => {});

    await logJob({
      classId,
      studentUid: auth?.uid || meetingData.supervisorUid || 'teacher',
      studentEmail: auth?.token?.email || meetingData.supervisorEmail || '',
      jobType: 'analyzeProjectMeeting',
      status: 'failed',
      promptText: 'analyzeProjectMeeting',
      mediaPaths: rawClips.map((c) => c.storagePath).filter(Boolean),
      cost: totalCost,
      modelUsed: [...modelsUsedSet].join(' + ') || reasoningModel,
      errorDetails: err.message || String(err),
    }).catch(() => {});

    throw new HttpsError('internal', `Project meeting AI analysis failed: ${err.message}`);
  }
}

export const analyzeProjectMeeting = onCall(
  {
    region: FUNCTION_REGION,
    cors: CORS_ORIGINS,
    enforceAppCheck: false,
    memory: '2GiB',
    timeoutSeconds: 300,
  },
  async (request) => {
    if (!request.auth?.uid) {
      throw new HttpsError('unauthenticated', 'Authentication is required to analyze project meetings.');
    }

    const {
      classId,
      meetingId,
      preferredModel,
      customPromptText,
      weeklyLogs,
      mode,
      groupId,
      groupName,
      projectTopic,
      weekNumber,
    } = request.data || {};
    let isAuthorized = request.auth.token?.role === 'teacher' || request.auth.token?.role === 'admin';

    if (!isAuthorized && classId) {
      const classSnap = await db.doc(`classes/${classId}`).get();
      if (classSnap.exists) {
        const cData = classSnap.data() || {};
        const userEmail = (request.auth.token?.email || '').toLowerCase();
        if (
          (Array.isArray(cData.teacherEmails) && cData.teacherEmails.map((e) => e.toLowerCase()).includes(userEmail)) ||
          (cData.teachers && cData.teachers[request.auth.uid]) ||
          cData.ownerUid === request.auth.uid ||
          cData.teacherUid === request.auth.uid
        ) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      throw new HttpsError('permission-denied', 'Only class teachers and project supervisors can run meeting analysis.');
    }

    return await handleAnalyzeProjectMeeting({
      classId,
      meetingId,
      preferredModel,
      customPromptText,
      weeklyLogs,
      mode,
      groupId,
      groupName,
      projectTopic,
      weekNumber,
      auth: request.auth,
    });
  }
);
