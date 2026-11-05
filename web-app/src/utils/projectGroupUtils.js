import { exportToExcel, readExcelFile } from './exportUtils';
import { normalizeStudentEmail, getStudentProfile } from './studentDisplayUtils';

/**
 * Normalizes a header column name for fuzzy matching.
 */
function normalizeHeaderKey(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Splits a single CSV or TSV line respecting quoted fields.
 */
export function splitDelimitedRow(line, delimiter = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Clusters a 2D array of rows ([headers, ...dataRows]) into structured Project Groups.
 * Supports columns: GroupName, ProjectTopic, SupervisorEmail, SupervisorName, StudentEmail, StudentName, Role.
 */
export function clusterRowsIntoProjectGroups(rows = [], { existingProfiles = {}, defaultSupervisorEmail = '', defaultSupervisorName = '' } = {}) {
  const cleanRows = (Array.isArray(rows) ? rows : []).filter(
    (r) => Array.isArray(r) && r.some((cell) => String(cell ?? '').trim() !== '')
  );

  if (cleanRows.length === 0) {
    return { groups: [], totalStudents: 0, invalidRows: [] };
  }

  const firstRow = cleanRows[0].map((c) => String(c ?? '').trim());
  const normalizedHeaders = firstRow.map(normalizeHeaderKey);

  const hasHeaderRow = normalizedHeaders.some((h) =>
    [
      'group',
      'groupname',
      'team',
      'teamname',
      'studentemail',
      'email',
      'projecttopic',
      'topic',
      'supervisoremail',
      'supervisor',
    ].includes(h)
  );

  const colMap = {
    groupName: 0,
    projectTopic: 1,
    supervisorEmail: 2,
    studentEmail: 3,
    studentName: 4,
    role: 5,
  };

  if (hasHeaderRow) {
    colMap.groupName = -1;
    colMap.projectTopic = -1;
    colMap.supervisorEmail = -1;
    colMap.studentEmail = -1;
    colMap.studentName = -1;
    colMap.role = -1;

    normalizedHeaders.forEach((h, idx) => {
      if (['group', 'groupname', 'groupno', 'groupid', 'team', 'teamname'].includes(h) && colMap.groupName === -1) {
        colMap.groupName = idx;
      } else if (['projecttopic', 'topic', 'projecttitle', 'title', 'project'].includes(h) && colMap.projectTopic === -1) {
        colMap.projectTopic = idx;
      } else if (['supervisoremail', 'supervisor', 'teacheremail', 'teacher', 'advisor'].includes(h) && colMap.supervisorEmail === -1) {
        colMap.supervisorEmail = idx;
      } else if (['studentemail', 'email', 'mail', 'useremail', 'studentid'].includes(h) && colMap.studentEmail === -1) {
        colMap.studentEmail = idx;
      } else if (['studentname', 'name', 'fullname', 'displayname'].includes(h) && colMap.studentName === -1) {
        colMap.studentName = idx;
      } else if (['role', 'memberrole', 'position'].includes(h) && colMap.role === -1) {
        colMap.role = idx;
      }
    });
  }

  const dataRows = hasHeaderRow ? cleanRows.slice(1) : cleanRows;
  const groupsByKey = new Map();
  const invalidRows = [];
  let totalStudents = 0;

  dataRows.forEach((row, idx) => {
    const cells = row.map((c) => String(c ?? '').trim());
    if (cells.every((c) => !c || c.startsWith('#'))) return;

    let groupName = colMap.groupName >= 0 ? cells[colMap.groupName] || '' : '';
    let projectTopic = colMap.projectTopic >= 0 ? cells[colMap.projectTopic] || '' : '';
    let supervisorEmail = colMap.supervisorEmail >= 0 ? normalizeStudentEmail(cells[colMap.supervisorEmail]) : '';
    let studentEmail = colMap.studentEmail >= 0 ? normalizeStudentEmail(cells[colMap.studentEmail]) : '';
    let studentName = colMap.studentName >= 0 ? cells[colMap.studentName] || '' : '';
    let role = colMap.role >= 0 ? cells[colMap.role] || 'Member' : 'Member';

    // Fallback: if studentEmail column wasn't matched or doesn't contain '@', scan row for an email
    if (!studentEmail || !studentEmail.includes('@')) {
      const emailCandidates = cells.filter((c) => c.includes('@'));
      if (emailCandidates.length === 1) {
        studentEmail = normalizeStudentEmail(emailCandidates[0]);
      } else if (emailCandidates.length >= 2) {
        // If two emails on row, stu.* is student, teacher domain is supervisor
        const stuCandidate = emailCandidates.find((e) => e.toLowerCase().includes('@stu.'));
        const supCandidate = emailCandidates.find((e) => !e.toLowerCase().includes('@stu.'));
        studentEmail = normalizeStudentEmail(stuCandidate || emailCandidates[emailCandidates.length - 1]);
        if (!supervisorEmail && supCandidate) {
          supervisorEmail = normalizeStudentEmail(supCandidate);
        }
      }
    }

    if (!groupName) {
      groupName = 'Group 1';
    }

    const groupKey = groupName.toLowerCase().trim();
    if (!groupsByKey.has(groupKey)) {
      groupsByKey.set(groupKey, {
        name: groupName.trim(),
        projectTopic: projectTopic.trim(),
        supervisorEmail: supervisorEmail || defaultSupervisorEmail || '',
        supervisorName: defaultSupervisorName || '',
        members: [],
      });
    }

    const grp = groupsByKey.get(groupKey);
    if (projectTopic && !grp.projectTopic) {
      grp.projectTopic = projectTopic.trim();
    }
    if (supervisorEmail && (!grp.supervisorEmail || grp.supervisorEmail === defaultSupervisorEmail)) {
      grp.supervisorEmail = supervisorEmail;
    }

    if (studentEmail && studentEmail.includes('@')) {
      const profile = getStudentProfile(studentEmail, existingProfiles);
      const resolvedName = studentName || profile?.studentName || studentEmail.split('@')[0];
      const resolvedUid = existingProfiles[studentEmail]?.uid || profile?.uid || studentEmail;
      const normalizedRole =
        String(role || '').toLowerCase().includes('lead') ? 'Leader' : 'Member';

      if (!grp.members.some((m) => normalizeStudentEmail(m.email) === studentEmail)) {
        grp.members.push({
          uid: resolvedUid,
          email: studentEmail,
          name: resolvedName,
          role: normalizedRole,
        });
        totalStudents++;
      }
    } else {
      invalidRows.push({
        rowNumber: idx + (hasHeaderRow ? 2 : 1),
        raw: cells.join(', '),
        reason: 'Missing or invalid StudentEmail',
      });
    }
  });

  return {
    groups: [...groupsByKey.values()],
    totalStudents,
    invalidRows,
  };
}

/**
 * Parses CSV/TSV/pasted text into clustered Project Groups.
 */
export function parseProjectGroupsText(text = '', options = {}) {
  if (!text || !String(text).trim()) {
    return { groups: [], totalStudents: 0, invalidRows: [] };
  }
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));

  if (lines.length === 0) {
    return { groups: [], totalStudents: 0, invalidRows: [] };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const rows = lines.map((line) => splitDelimitedRow(line, delimiter));
  return clusterRowsIntoProjectGroups(rows, options);
}

/**
 * Parses an uploaded Excel (.xlsx) or CSV (.csv) file into clustered Project Groups.
 */
export async function parseProjectGroupsFile(file, options = {}) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const text = await file.text();
    return parseProjectGroupsText(text, options);
  }
  const rows = await readExcelFile(file);
  return clusterRowsIntoProjectGroups(rows, options);
}

/**
 * Generates and downloads a pre-filled Excel (.xlsx) template containing all currently enrolled class students
 * so the course coordinator can simply fill in GroupName, ProjectTopic, and SupervisorEmail.
 */
export async function downloadProjectGroupTemplateExcel({
  classId = 'class',
  enrolledStudents = [],
  existingGroups = [],
  defaultSupervisorEmail = '',
} = {}) {
  const headers = [
    'GroupName',
    'ProjectTopic',
    'SupervisorEmail',
    'StudentEmail',
    'StudentName',
    'Role',
  ];

  // Map existing group assignments by student email
  const assignedByEmail = new Map();
  (Array.isArray(existingGroups) ? existingGroups : []).forEach((g) => {
    (Array.isArray(g.members) ? g.members : []).forEach((m) => {
      const email = normalizeStudentEmail(m.email);
      if (email) {
        assignedByEmail.set(email, {
          groupName: g.name || '',
          projectTopic: g.projectTopic || '',
          supervisorEmail: g.supervisorEmail || defaultSupervisorEmail || '',
          name: m.name || '',
          role: m.role || 'Member',
        });
      }
    });
  });

  const rows = [];
  if (Array.isArray(enrolledStudents) && enrolledStudents.length > 0) {
    enrolledStudents.forEach((stu, idx) => {
      const email = normalizeStudentEmail(stu.email || stu);
      const existing = assignedByEmail.get(email);
      const suggestedGroup = existing?.groupName || `Group ${Math.floor(idx / 4) + 1}`;
      rows.push([
        suggestedGroup,
        existing?.projectTopic || '',
        existing?.supervisorEmail || defaultSupervisorEmail || '',
        email,
        stu.name || stu.studentName || existing?.name || email.split('@')[0],
        existing?.role || (idx % 4 === 0 ? 'Leader' : 'Member'),
      ]);
    });
  } else {
    rows.push(
      ['Group 1', 'AI Smart Inventory Tracker', defaultSupervisorEmail || 'supervisor@vtc.edu.hk', 'alice@stu.vtc.edu.hk', 'Alice Chan', 'Leader'],
      ['Group 1', 'AI Smart Inventory Tracker', defaultSupervisorEmail || 'supervisor@vtc.edu.hk', 'bob@stu.vtc.edu.hk', 'Bob Lee', 'Member'],
      ['Group 2', 'Cloud FinOps Dashboard', defaultSupervisorEmail || 'supervisor@vtc.edu.hk', 'charlie@stu.vtc.edu.hk', 'Charlie Wong', 'Leader']
    );
  }

  return await exportToExcel(headers, rows, `${classId}_project_groups_template.xlsx`);
}

/**
 * Exports all current Project Groups and their members to an Excel (.xlsx) file.
 */
export async function exportProjectGroupsExcel({ classId = 'class', groups = [] } = {}) {
  const headers = [
    'GroupName',
    'ProjectTopic',
    'SupervisorEmail',
    'SupervisorName',
    'StudentEmail',
    'StudentName',
    'Role',
  ];

  const rows = [];
  (Array.isArray(groups) ? groups : []).forEach((g) => {
    const members = Array.isArray(g.members) ? g.members : [];
    if (members.length === 0) {
      rows.push([
        g.name || '',
        g.projectTopic || '',
        g.supervisorEmail || '',
        g.supervisorName || '',
        '',
        '',
        '',
      ]);
    } else {
      members.forEach((m) => {
        rows.push([
          g.name || '',
          g.projectTopic || '',
          g.supervisorEmail || '',
          g.supervisorName || '',
          m.email || '',
          m.name || '',
          m.role || 'Member',
        ]);
      });
    }
  });

  return await exportToExcel(headers, rows, `${classId}_project_groups_roster.xlsx`);
}

/**
 * Automatically splits unassigned students into groups of `groupSize`.
 */
export function autoSplitStudentsIntoGroups({
  unassignedStudents = [],
  existingGroupsCount = 0,
  groupSize = 4,
  supervisorEmail = '',
  supervisorName = '',
}) {
  const size = Math.max(1, Number(groupSize) || 4);
  const newGroups = [];
  let currentGroupIndex = existingGroupsCount + 1;

  for (let i = 0; i < unassignedStudents.length; i += size) {
    const chunk = unassignedStudents.slice(i, i + size);
    newGroups.push({
      name: `Group ${currentGroupIndex}`,
      projectTopic: '',
      supervisorEmail,
      supervisorName,
      members: chunk.map((stu, idx) => ({
        uid: stu.uid || stu.email,
        email: normalizeStudentEmail(stu.email),
        name: stu.name || stu.studentName || stu.email,
        role: idx === 0 ? 'Leader' : 'Member',
      })),
    });
    currentGroupIndex++;
  }

  return newGroups;
}

/**
 * Exports the Cross-Week Project Meetings Attendance & Individual Work Matrix to Excel (.xlsx).
 */
export async function exportProjectMeetingsMatrixExcel({
  classId = 'class',
  groups = [],
  meetings = [],
} = {}) {
  const weeks = [...new Set((meetings || []).map((m) => Number(m.weekNumber) || 1))].sort((a, b) => a - b);
  const weekHeaders = weeks.map((w) => `Week ${w}`);

  const headers = [
    'Group Name',
    'Project Topic',
    'Supervisor',
    'Student Name',
    'Student Email',
    'Role',
    'Attendance Rate (%)',
    'Total Tasks Completed',
    ...weekHeaders,
    'Latest Action Items (Next Week)',
  ];

  const rows = [];
  (Array.isArray(groups) ? groups : []).forEach((grp) => {
    const groupMeetings = (meetings || []).filter((m) => m.groupId === grp.id);
    (Array.isArray(grp.members) ? grp.members : []).forEach((member) => {
      const email = normalizeStudentEmail(member.email);
      let attendedCount = 0;
      let totalTasks = 0;
      let latestActionItems = '';

      const weekCells = weeks.map((wk) => {
        const weekMeetings = groupMeetings.filter((gm) => Number(gm.weekNumber) === wk);
        if (weekMeetings.length === 0) return '—';

        const cellParts = weekMeetings.map((m) => {
          const att = (m.attendanceRecord || []).find(
            (a) => normalizeStudentEmail(a.email) === email || a.uid === member.uid
          );
          const contrib = (m.studentContributions || []).find(
            (c) => normalizeStudentEmail(c.email) === email || c.uid === member.uid
          );
          const status = att?.status || 'absent';
          if (status === 'present' || status === 'late') attendedCount++;
          const tasksDone = Array.isArray(contrib?.workCompleted) ? contrib.workCompleted : [];
          totalTasks += tasksDone.length;
          if (Array.isArray(contrib?.actionItemsNextWeek) && contrib.actionItemsNextWeek.length > 0) {
            latestActionItems = contrib.actionItemsNextWeek.join('; ');
          }
          const statusBadge = status === 'present' ? 'Present' : status === 'late' ? 'Late' : 'Absent';
          const supPrefix =
            weekMeetings.length > 1 && m.supervisorName
              ? `[${m.supervisorName}] `
              : '';
          return tasksDone.length > 0
            ? `${supPrefix}${statusBadge}: ${tasksDone.join('; ')}`
            : `${supPrefix}${statusBadge}`;
        });

        return cellParts.join(' | ');
      });

      const rate = groupMeetings.length > 0 ? Math.round((attendedCount / groupMeetings.length) * 100) : 0;
      rows.push([
        grp.name || '',
        grp.projectTopic || '',
        grp.supervisorEmail || '',
        member.name || '',
        email,
        member.role || 'Member',
        rate,
        totalTasks,
        ...weekCells,
        latestActionItems,
      ]);
    });
  });

  return await exportToExcel(headers, rows, `${classId}_project_meetings_report.xlsx`);
}

/**
 * Generates clean Markdown meeting minutes for a single Project Group Meeting.
 */
export function generateMeetingMarkdownMinutes(meeting = {}) {
  const lines = [
    `# 📋 ${meeting.groupName || 'Project Group'} — Week ${meeting.weekNumber || 1}: ${meeting.title || 'Supervision Meeting'}`,
    `- **Date**: ${meeting.meetingDate ? new Date(meeting.meetingDate).toLocaleString() : 'N/A'}`,
    `- **Supervisor**: ${meeting.supervisorName || ''} (${meeting.supervisorEmail || 'N/A'})`,
    `- **Overall Progress**: \`${(meeting.keyInsights?.overallGroupProgress || 'on_track').toUpperCase()}\``,
    '',
    '## 1. Attendance Record',
    '| Student | Email | Status | Speaking Level | Evidence |',
    '| :--- | :--- | :--- | :--- | :--- |',
    ...(meeting.attendanceRecord || []).map(
      (a) =>
        `| ${a.name || ''} | ${a.email || ''} | **${(a.status || 'absent').toUpperCase()}** | ${a.speakingContribution || 'none'} | ${a.evidence || ''} |`
    ),
    '',
    '## 2. Key Meeting Insights',
    `**Executive Summary**: ${meeting.keyInsights?.executiveSummary || 'N/A'}`,
    '',
    '### Key Decisions',
    ...((meeting.keyInsights?.keyDecisions || []).length > 0
      ? meeting.keyInsights.keyDecisions.map((d) => `- ${d}`)
      : ['- None recorded']),
    '',
    '### Blockers & Risks',
    ...((meeting.keyInsights?.blockersAndRisks || []).length > 0
      ? meeting.keyInsights.blockersAndRisks.map((b) => `- ${b}`)
      : ['- None recorded']),
    '',
    '### Supervisor Feedback',
    ...((meeting.keyInsights?.supervisorFeedback || []).length > 0
      ? meeting.keyInsights.supervisorFeedback.map((f) => `- ${f}`)
      : ['- None recorded']),
    ...(meeting.keyInsights?.weeklyGroupFeedback
      ? ['', '### Weekly Group Feedback (Post-Meeting)', meeting.keyInsights.weeklyGroupFeedback]
      : []),
    '',
    '## 3. Work Done, Log Quality Audit & Weekly Feedback Per Student',
    ...(meeting.studentContributions || []).flatMap((sc) => [
      `### 👤 ${sc.name} (${sc.email})`,
      ...(sc.logQualityScore !== undefined && sc.logQualityScore !== null
        ? [
            `- **Log Quality Score**: ${sc.logQualityScore}/10 (${sc.logQualityAssessment || 'evaluated'})`,
          ]
        : []),
      ...(sc.realWorkScore !== undefined && sc.realWorkScore !== null
        ? [`- **Verified Real Work Score**: ${sc.realWorkScore}/10`]
        : []),
      `- **Work Completed**: ${(sc.workCompleted || []).join('; ') || 'None reported'}`,
      `- **Current Challenges**: ${(sc.currentChallenges || []).join('; ') || 'None'}`,
      `- **Action Items (Next Week)**: ${(sc.actionItemsNextWeek || []).join('; ') || 'None assigned'}`,
      `- **AI Assessment**: ${sc.aiContributionAssessment || 'N/A'}`,
      ...((sc.challengeQuestions || []).length > 0
        ? [`- **Challenge / Verification Questions**: ${(sc.challengeQuestions || []).join(' | ')}`]
        : []),
      ...(sc.weeklyFeedback ? [`- **Weekly Feedback**: ${sc.weeklyFeedback}`] : []),
      '',
    ]),
    ...((meeting.photos || []).length > 0
      ? [
          '## 4. Visual Artifacts & Photos Captured Live',
          ...meeting.photos.map(
            (p, idx) =>
              `- **Photo ${idx + 1}**: ${p.label || 'Artifact'}${p.caption ? ` — "${p.caption}"` : ''}${p.studentName ? ` (${p.studentName})` : ''}`
          ),
          '',
        ]
      : []),
    ...((meeting.screenClips || []).length > 0
      ? [
          '## 5. Demonstrations & Video Clips',
          ...meeting.screenClips.map(
            (sc, idx) =>
              `- **${sc.type === 'mobile_camera' ? 'Mobile Camera Demo (720p)' : 'Student PC Screencast'}**: ${sc.label || `Clip ${idx + 1}`} (${sc.durationSeconds || 0}s)`
          ),
          '',
        ]
      : []),
  ];
  return lines.join('\n');
}

export const DEFAULT_PROJECT_LOG_SHEET_URL = '';

/**
 * Converts a Google Sheets view/edit URL into a direct CSV export URL.
 * Returns empty string if no sheetUrl is configured on the class.
 */
export function buildGoogleSheetCsvExportUrl(sheetUrl = '') {
  const raw = String(sheetUrl || '').trim();
  if (!raw) return '';
  if (raw.includes('/export?format=csv') || raw.endsWith('.csv')) {
    return raw;
  }
  const idMatch = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return raw;
  const spreadsheetId = idMatch[1];
  const gidMatch = raw.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

/**
 * Parses a full RFC-4180 CSV string (supporting multi-line quoted cells) into a 2D array of rows.
 */
export function parseCsvGrid(csvText = '') {
  const text = String(csvText || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return [];

  const rows = [];
  let currentRow = [];
  let currentCell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        currentCell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      currentRow.push(currentCell.trim());
      currentCell = '';
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') {
        i++;
      }
      currentRow.push(currentCell.trim());
      if (currentRow.some((c) => c !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentCell = '';
    } else {
      currentCell += ch;
    }
  }

  if (currentCell !== '' || currentRow.length > 0) {
    currentRow.push(currentCell.trim());
    if (currentRow.some((c) => c !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

const VAGUE_LOG_EXACT_SET = new Set([
  'done',
  'finish',
  'finished',
  'ok',
  'yes',
  'no',
  'nil',
  'na',
  'n/a',
  'nothing',
  'same',
  'thinking',
  'website',
  'do website',
  'proposal',
  'coding',
  'test',
  'testing',
  'study',
  'research',
  'working',
  'in progress',
]);

const AI_BUZZWORD_PATTERNS = [
  /\bimplemented\s+real[- ]time\b/i,
  /\brole[- ]based\s+access\s+control\b/i,
  /\bfrontend\s+and\s+backend\s+integration\b/i,
  /\bseamless(?:ly)?\s+integrat/i,
  /\bcomprehensive\b/i,
  /\bleveraging\b/i,
  /\bscalable\s+architecture\b/i,
  /\bend[- ]to[- ]end\b/i,
  /\bstreamlined\b/i,
  /\bfacilitating\b/i,
  /\boptimizing\s+performance\b/i,
  /\brobust\s+and\s+scalable\b/i,
  /\bmock\s+ai\s+chatbot\b/i,
  /\buser[- ]friendly\s+interface\b/i,
  /\bdata\s+visualization\s+dashboards?\b/i,
];

function countMeaningfulWords(str = '') {
  return String(str || '')
    .trim()
    .split(/\s+/)
    .filter((w) => w.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '').length > 0).length;
}

/**
 * Evaluates a student's weekly log entry for quality, usefulness, and suspected AI / fake patterns,
 * and prepares concrete supervisor challenge questions for the weekly meeting.
 */
export function evaluateWeeklyLogQuality(entry = {}, priorEntries = []) {
  const isDoing = Boolean(entry.isDoingSomething);
  const workDone = String(entry.workDone || '').trim();
  const unfinished = String(entry.unfinished || '').trim();
  const nextPlan = String(entry.nextPlan || '').trim();
  const inactiveReason = String(entry.inactiveReason || '').trim();

  const sortedPriors = [...(Array.isArray(priorEntries) ? priorEntries : [])].sort(
    (a, b) => (Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0)
  );
  const lastActivePrior = [...sortedPriors].reverse().find((p) => p.isDoingSomething && p.nextPlan);
  const priorPlan = lastActivePrior?.nextPlan || '';

  if (!isDoing) {
    const score = inactiveReason.length >= 4 ? 2 : 1;
    return {
      qualityStatus: 'inactive',
      qualityLabel: '⚪ Inactive (No Work)',
      qualityScore: score,
      priorWeekPlan: priorPlan,
      qualityReason: inactiveReason
        ? `Student selected "No" work this week (Reason: "${inactiveReason}").`
        : 'Student selected "No" work this week without providing a concrete reason.',
      suggestedChallengeQuestions: [
        `You reported "No" work this week (${inactiveReason || 'no reason stated'}). What concrete task from the group plan will you complete and demonstrate by next week?`,
        priorPlan
          ? `Your previous plan was "${priorPlan}". When will this delayed deliverable be completed so it does not block your teammates?`
          : 'Which specific component or module are you taking ownership of for the upcoming week?',
      ],
    };
  }

  const normalizedWork = workDone.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const normalizedPlan = nextPlan.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const workWords = countMeaningfulWords(workDone);
  const planWords = countMeaningfulWords(nextPlan);

  // Check if duplicate copy-paste of an earlier week's workDone
  const duplicatePrior = sortedPriors.find(
    (p) =>
      p.isDoingSomething &&
      String(p.workDone || '').trim().toLowerCase() === workDone.toLowerCase() &&
      workDone.length > 0
  );

  // Check AI / Fake signals:
  // 1. Multiple AI/resume buzzword patterns or polished multi-sentence feature dump
  const buzzwordHits = AI_BUZZWORD_PATTERNS.filter((re) => re.test(workDone) || re.test(nextPlan)).length;
  const featureListCount = (workDone.match(/,|and\s+basic|implemented|completed|integrated|dashboards/gi) || []).length;

  // 2. Sudden jump from prior vague/short logs ("done", "do website", "No") to a long polished multi-feature claim
  const recentPriors = sortedPriors.slice(-2);
  const hadVagueRecentPriors =
    recentPriors.length > 0 &&
    recentPriors.every(
      (p) =>
        !p.isDoingSomething ||
        countMeaningfulWords(p.workDone) <= 4 ||
        VAGUE_LOG_EXACT_SET.has(String(p.workDone || '').toLowerCase().trim())
    );

  const isSuddenPolishedJump =
    hadVagueRecentPriors &&
    workWords >= 14 &&
    (buzzwordHits >= 1 || featureListCount >= 3 || /\b(implemented|completed|integrated|developed)\b/i.test(workDone));

  const isHighBuzzwordAiStyle =
    (buzzwordHits >= 2 && workWords >= 12) ||
    (buzzwordHits >= 1 && featureListCount >= 4 && !/\b(bug|error|fix|issue|table|line|file|\.py|\.js|\.jsx|sql|port)\b/i.test(workDone));

  if (isSuddenPolishedJump || isHighBuzzwordAiStyle) {
    const priorSample = recentPriors
      .map((p) => (p.isDoingSomething ? `"${p.workDone}"` : '"No work"'))
      .join(', ');
    const reasons = [];
    if (isSuddenPolishedJump) {
      reasons.push(`Sudden leap from brief prior logs (${priorSample}) to a polished multi-feature paragraph.`);
    }
    if (buzzwordHits > 0) {
      reasons.push('Contains generic AI/resume-style phrasing without concrete commit/bug details.');
    }

    return {
      qualityStatus: 'suspected_ai_fake',
      qualityLabel: '🟠 Suspected AI / Fake Log',
      qualityScore: 4,
      priorWeekPlan: priorPlan,
      qualityReason: reasons.join(' ') || 'Polished multi-feature claim requires live code & screen verification.',
      suggestedChallengeQuestions: [
        `Challenge Fake/AI Log (Live Code Walkthrough): Your log claims "${workDone}". Please share your screen right now, open the exact source file(s) you wrote this week, and explain how one core function or route works line by line.`,
        `Challenge Implementation Depth: While building "${workDone.slice(0, 80)}${workDone.length > 80 ? '...' : ''}", what specific technical error, schema issue, or edge case did you encounter, and how did you debug it?`,
        priorSample
          ? `Continuity Challenge: Your previous logs were very brief (${priorSample}), yet this week lists multiple completed modules at once. Which specific parts did you code yourself vs. generate with AI?`
          : `Verification Challenge: Can you run the feature live now and modify one small parameter on screen to prove it is working and not a static/mock template?`,
      ],
    };
  }

  // Check Vague / Useless log
  const isVagueWork =
    workWords <= 3 ||
    workDone.length < 15 ||
    VAGUE_LOG_EXACT_SET.has(normalizedWork);
  const isVaguePlan =
    planWords <= 2 ||
    VAGUE_LOG_EXACT_SET.has(normalizedPlan);

  if (isVagueWork || isVaguePlan || duplicatePrior) {
    let reason = '';
    if (duplicatePrior) {
      reason = `Copied identical "Work done" text ("${workDone}") from Week ${duplicatePrior.weekNumber}.`;
    } else if (isVagueWork && isVaguePlan) {
      reason = `Both "Work done" ("${workDone || 'empty'}") and "Next plan" ("${nextPlan || 'empty'}") are too vague to reflect real work.`;
    } else if (isVagueWork) {
      reason = `"Work done" ("${workDone || 'empty'}") is a vague filler entry with no technical detail or findings.`;
    } else {
      reason = `"Plan of work" ("${nextPlan || 'empty'}") is vague ("thinking" / 1-word filler) with no measurable deliverable.`;
    }

    const score = isVagueWork && isVaguePlan ? 2 : duplicatePrior ? 2 : 4;

    return {
      qualityStatus: 'vague_useless',
      qualityLabel: '🔴 Vague / Useless Log',
      qualityScore: score,
      priorWeekPlan: priorPlan,
      qualityReason: reason,
      suggestedChallengeQuestions: [
        `Challenge Vague Log: Writing "${workDone || 'N/A'}" (and next plan "${nextPlan || 'N/A'}") does not explain what you actually built or found. Show your screen now: what exact files, database tables, or documents did you produce this week?`,
        priorPlan
          ? `Plan vs. Actual Check: Last week your plan was "${priorPlan}". Which exact part of that plan is finished and testable right now?`
          : `Next-Week Accountability: "Plan = ${nextPlan || 'N/A'}" is not measurable. State 2 concrete deliverables you will demo in next week's meeting.`,
      ],
    };
  }

  // Genuine / Constructive log
  let score = 7;
  if (workWords >= 10 && planWords >= 5) score += 1;
  if (unfinished && unfinished.toLowerCase() !== 'no' && unfinished.toLowerCase() !== 'nil') score += 1;
  if (/\b(found|finding|tested|fixed|api|table|schema|ui|page|function|model|dataset|error|bug|compare|design|diagram)\b/i.test(workDone)) {
    score += 1;
  }
  score = Math.min(10, score);

  return {
    qualityStatus: 'genuine',
    qualityLabel: '🟢 High-Quality Log',
    qualityScore: score,
    priorWeekPlan: priorPlan,
    qualityReason: 'Specific description of work done, findings, and concrete next-week plan.',
    suggestedChallengeQuestions: [
      `Technical Demo & Verification: Please demonstrate "${workDone.slice(0, 90)}${workDone.length > 90 ? '...' : ''}" and walk us through the key design decision or finding you discovered.`,
      unfinished
        ? `Unfinished Plan Follow-up: You noted "${unfinished}" is not yet finished from the last plan. What is blocking it and how will you resolve it alongside "${nextPlan}"?`
        : `Next Sprint Readiness: For your upcoming plan ("${nextPlan}"), what is the biggest technical risk or dependency on your teammates?`,
    ],
  };
}

function parseFormTimestamp(tsStr = '') {
  const raw = String(tsStr || '').trim();
  if (!raw) return null;
  // Format M/D/YYYY H:mm:ss
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    const month = Number(match[1]) - 1;
    const day = Number(match[2]);
    const year = Number(match[3]);
    const hr = Number(match[4] || 0);
    const min = Number(match[5] || 0);
    const sec = Number(match[6] || 0);
    const d = new Date(year, month, day, hr, min, sec);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const fallback = new Date(raw);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function normalizePersonNameKey(name = '') {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]/g, '');
}

/**
 * Extracts the numeric VTC Student ID (e.g. "250105348") from either a raw ID ("250105348")
 * or a VTC student email ("250105348@stu.vtc.edu.hk").
 */
export function extractVtcStudentId(studentIdOrEmail = '') {
  const raw = String(studentIdOrEmail || '').trim().toLowerCase();
  if (!raw) return '';
  const localPart = raw.includes('@') ? raw.split('@')[0] : raw;
  const digits = localPart.replace(/\D/g, '');
  return digits || localPart;
}

/**
 * Canonicalizes a VTC Student ID or email into the system-standard `@stu.vtc.edu.hk` email
 * (e.g. "250105348" -> "250105348@stu.vtc.edu.hk").
 */
export function toVtcStudentEmail(studentIdOrEmail = '', fallbackSlug = '') {
  const raw = String(studentIdOrEmail || '').trim().toLowerCase();
  if (raw.includes('@')) {
    const [local, domain] = raw.split('@');
    const cleanDigits = local.replace(/\D/g, '');
    if (cleanDigits.length >= 7 && (!domain || domain.includes('vtc.edu.hk'))) {
      return `${cleanDigits}@stu.vtc.edu.hk`;
    }
    return normalizeStudentEmail(raw);
  }
  const cleanDigits = raw.replace(/\D/g, '');
  if (cleanDigits) {
    return `${cleanDigits}@stu.vtc.edu.hk`;
  }
  const slug = normalizePersonNameKey(raw || fallbackSlug);
  return slug ? `${slug}@stu.vtc.edu.hk` : '';
}

/**
 * Checks whether two numeric Student IDs are within 1 edit operation
 * (1 digit substituted, 1 digit omitted, or 1 extra digit typed, e.g. "20231955" vs "250231955").
 */
function isWithinOneDigitTypo(idA = '', idB = '') {
  if (!idA || !idB) return false;
  if (idA === idB) return true;
  if (Math.abs(idA.length - idB.length) > 1) return false;

  if (idA.length === idB.length) {
    let diffs = 0;
    for (let i = 0; i < idA.length; i++) {
      if (idA[i] !== idB[i]) {
        diffs++;
        if (diffs > 1) return false;
      }
    }
    return diffs === 1;
  }

  const shorter = idA.length < idB.length ? idA : idB;
  const longer = idA.length < idB.length ? idB : idA;
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
    } else {
      if (skipped) return false;
      skipped = true;
      j++;
    }
  }
  return true;
}

/**
 * Snaps any YYYY-MM-DD or Date to the Monday (00:00:00) of that calendar week.
 */
function snapToMondayIso(dateStr = '') {
  if (!dateStr) return '';
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diffToMonday);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/**
 * Resolves the Week 1 Monday (`YYYY-MM-DD`) directly from the Class Schedule
 * (`classInfo.schedule.startDate` or earliest `classInfo.scheduleHistory[].startDate`),
 * falling back to `fallbackMonday` ('2026-09-07').
 */
export function resolveSemesterStartMondayFromClass(
  classInfo = {},
  fallbackMonday = '2026-09-07'
) {
  const candidates = [];
  if (classInfo?.schedule?.startDate) {
    candidates.push(classInfo.schedule.startDate);
  }
  if (Array.isArray(classInfo?.scheduleHistory)) {
    classInfo.scheduleHistory.forEach((seg) => {
      if (seg?.startDate) candidates.push(seg.startDate);
    });
  }
  if (classInfo?.projectLogSemesterStartMonday) {
    candidates.push(classInfo.projectLogSemesterStartMonday);
  }
  const sorted = candidates
    .map((c) => snapToMondayIso(c))
    .filter(Boolean)
    .sort();
  return sorted[0] || snapToMondayIso(fallbackMonday) || '2026-09-07';
}

/**
 * Resolves the total number of project weeks from the Class Schedule
 * (`classInfo.schedule.startDate` -> `classInfo.schedule.endDate` or `classInfo.scheduleHistory`),
 * defaulting to 16 if no endDate is configured, and supporting full-year schedules (e.g. 36 weeks from Sep 2026 to May 2027).
 */
export function resolveTotalProjectWeeksFromClass(
  classInfo = {},
  semesterStartMonday = ''
) {
  const startMonday =
    semesterStartMonday || resolveSemesterStartMondayFromClass(classInfo, '2026-09-07');
  const startMs = new Date(`${startMonday}T00:00:00`).getTime();

  const endCandidates = [];
  if (classInfo?.schedule?.endDate) {
    endCandidates.push(String(classInfo.schedule.endDate).slice(0, 10));
  }
  if (classInfo?.endDate) {
    endCandidates.push(String(classInfo.endDate).slice(0, 10));
  }
  if (Array.isArray(classInfo?.scheduleHistory)) {
    classInfo.scheduleHistory.forEach((seg) => {
      if (seg?.endDate) endCandidates.push(String(seg.endDate).slice(0, 10));
    });
  }
  const latestEndIso = endCandidates.filter(Boolean).sort().pop();
  if (!latestEndIso || Number.isNaN(startMs)) {
    return 16;
  }

  const endMs = new Date(`${latestEndIso}T00:00:00`).getTime();
  if (Number.isNaN(endMs) || endMs < startMs) {
    return 16;
  }

  const diffDays = Math.floor((endMs - startMs) / 86400000);
  const computedWeeks = Math.floor(diffDays / 7) + 1;
  return Math.max(16, Math.min(52, computedWeeks));
}

/**
 * Formats the Monday–Sunday date range label for a given 1-based project Week Number
 * (e.g. `Sep 7 – Sep 13` or `Jan 4 – Jan 10, 2027` when crossing into the next calendar year).
 */
export function formatWeekDateRange(weekNumber = 1, semesterStartMonday = '2026-09-07') {
  const base = new Date(`${semesterStartMonday}T00:00:00`);
  if (Number.isNaN(base.getTime())) return '';
  const wkStart = new Date(base.getTime() + (Math.max(1, Number(weekNumber) || 1) - 1) * 7 * 86400000);
  const wkEnd = new Date(wkStart.getTime() + 6 * 86400000);
  const fmt = (d) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const yearSuffix =
    wkEnd.getFullYear() !== base.getFullYear() ? `, ${wkEnd.getFullYear()}` : '';
  return `${fmt(wkStart)} – ${fmt(wkEnd)}${yearSuffix}`;
}

/**
 * Parses the public Google Form Weekly Log CSV (`Form Responses 2`) into structured entries,
 * healing 1-digit Student ID typos, resolving Group ID drift, computing academic week numbers
 * from the Class Schedule (`semesterStartMonday` / `classInfo.schedule.startDate`),
 * and running log quality + fake-log challenge question analysis.
 */
export function parseProjectWeeklyLogCsv(
  csvText = '',
  {
    enrolledStudents = [],
    existingGroups = [],
    classInfo = null,
    semesterStartMonday = '2026-09-07',
  } = {}
) {
  const effectiveStartMonday = classInfo
    ? resolveSemesterStartMondayFromClass(classInfo, semesterStartMonday)
    : semesterStartMonday;
  const grid = parseCsvGrid(csvText);
  if (grid.length <= 1) {
    return {
      entries: [],
      byGroupAndWeek: {},
      byStudentKey: {},
      weeks: [],
      groupNames: [],
      supervisors: [],
      summary: {
        totalEntries: 0,
        activeYesCount: 0,
        inactiveNoCount: 0,
        genuineCount: 0,
        vagueCount: 0,
        suspectedAiCount: 0,
      },
    };
  }

  const headers = grid[0].map((h) => String(h || '').trim().toLowerCase());
  const dataRows = grid.slice(1);

  // Detect column indices (defaulting to the exact 10 columns of Form Responses 2)
  const findIdx = (pred, fallback) => {
    const idx = headers.findIndex(pred);
    return idx >= 0 ? idx : fallback;
  };

  const colIdx = {
    timestamp: findIdx((h) => h.includes('timestamp'), 0),
    groupId: findIdx((h) => h.includes('group'), 1),
    studentName: findIdx((h) => h.includes('student name') || h === 'name', 2),
    studentId: findIdx((h) => h.includes('student id'), 3),
    supervisor: findIdx((h) => h.includes('supervisor'), 4),
    isDoing: findIdx((h) => h.includes('doing something'), 5),
    workDone: findIdx((h) => h.includes('work done'), 6),
    unfinished: findIdx((h) => h.includes('not yet finished') || h.includes('unfinished'), 7),
    nextPlan: findIdx((h) => h.includes('plan of work') || h.includes('next recording'), 8),
    inactiveReason: findIdx((h) => h === 'description' || h.includes('reason'), 9),
  };

  // Build Student ID & @stu.vtc.edu.hk Email healing lookup by normalized student name & class roster
  const idCountsByName = new Map();
  const groupCountsByStudentId = new Map();
  const knownEmailByName = new Map();
  const knownEmailById = new Map();
  const knownGroupByEmail = new Map();
  const authoritativeNineDigitIds = new Set();

  const registerKnownRosterMember = (rawEmail = '', rawName = '', groupName = '') => {
    const em = toVtcStudentEmail(rawEmail);
    const stuId = extractVtcStudentId(em);
    const nk = normalizePersonNameKey(rawName);
    if (em) {
      if (stuId) {
        knownEmailById.set(stuId, em);
        if (/^\d{9}$/.test(stuId)) authoritativeNineDigitIds.add(stuId);
      }
      if (nk) knownEmailByName.set(nk, em);
      if (groupName) knownGroupByEmail.set(em, groupName);
    }
    if (nk && stuId) {
      if (!idCountsByName.has(nk)) idCountsByName.set(nk, new Map());
      const mapForName = idCountsByName.get(nk);
      // Give class-enrolled @stu.vtc.edu.hk roster IDs high weight
      mapForName.set(stuId, (mapForName.get(stuId) || 0) + 50);
    }
  };

  (Array.isArray(enrolledStudents) ? enrolledStudents : []).forEach((s) => {
    registerKnownRosterMember(s?.email, s?.name || s?.studentName);
  });
  (Array.isArray(existingGroups) ? existingGroups : []).forEach((g) => {
    (Array.isArray(g?.members) ? g.members : []).forEach((m) => {
      registerKnownRosterMember(m?.email, m?.name, g?.name);
    });
  });

  // First pass: collect frequency of Student IDs per normalized Student Name across CSV rows
  const csvIdFreq = new Map();
  dataRows.forEach((row) => {
    const rawName = String(row[colIdx.studentName] || '').trim();
    const rawId = extractVtcStudentId(row[colIdx.studentId]);
    const nameKey = normalizePersonNameKey(rawName);
    if (rawId) {
      csvIdFreq.set(rawId, (csvIdFreq.get(rawId) || 0) + 1);
      if (/^\d{9}$/.test(rawId) && (csvIdFreq.get(rawId) || 0) >= 2) {
        authoritativeNineDigitIds.add(rawId);
      }
    }
    if (!nameKey || !rawId) return;
    if (!idCountsByName.has(nameKey)) idCountsByName.set(nameKey, new Map());
    const mapForName = idCountsByName.get(nameKey);
    mapForName.set(rawId, (mapForName.get(rawId) || 0) + 1);
  });

  const resolveCanonicalStudentId = (rawId, rawName) => {
    const cleanId = extractVtcStudentId(rawId);
    const nameKey = normalizePersonNameKey(rawName);
    if (nameKey && idCountsByName.has(nameKey)) {
      const candidates = [...idCountsByName.get(nameKey).entries()].sort((a, b) => {
        // Prefer 9-digit VTC IDs and higher frequency
        const aLenScore = a[0].length === 9 ? 100 : 0;
        const bLenScore = b[0].length === 9 ? 100 : 0;
        return bLenScore + b[1] - (aLenScore + a[1]);
      });
      if (candidates.length > 0) {
        return candidates[0][0];
      }
    }
    // If cleanId is not a known 9-digit ID (e.g. 8-digit typo "20231955" or 1-digit typo), check 1-digit edit distance against authoritative 9-digit VTC IDs
    if (cleanId && !authoritativeNineDigitIds.has(cleanId)) {
      for (const authId of authoritativeNineDigitIds) {
        if (isWithinOneDigitTypo(cleanId, authId)) {
          return authId;
        }
      }
    }
    return cleanId || nameKey;
  };

  const baseMonday = new Date(`${effectiveStartMonday}T00:00:00`);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;

  const rawEntries = [];
  dataRows.forEach((row, idx) => {
    const tsRaw = String(row[colIdx.timestamp] || '').trim();
    const rawGroup = String(row[colIdx.groupId] || '').trim().toUpperCase();
    const rawName = String(row[colIdx.studentName] || '').trim();
    const rawStudentId = String(row[colIdx.studentId] || '').trim();
    const supervisor = String(row[colIdx.supervisor] || '').trim();
    const doingStr = String(row[colIdx.isDoing] || '').trim().toLowerCase();
    const workDone = String(row[colIdx.workDone] || '').trim();
    const unfinished = String(row[colIdx.unfinished] || '').trim();
    const nextPlan = String(row[colIdx.nextPlan] || '').trim();
    const inactiveReason = String(row[colIdx.inactiveReason] || '').trim();

    if (!rawName && !rawStudentId) return;

    const canonicalId = resolveCanonicalStudentId(rawStudentId, rawName);
    const nameKey = normalizePersonNameKey(rawName);
    const email =
      knownEmailById.get(canonicalId) ||
      knownEmailByName.get(nameKey) ||
      toVtcStudentEmail(canonicalId || rawStudentId, rawName || `student_${idx}`);
    const resolvedStudentId = extractVtcStudentId(email) || canonicalId;
    const rawExtractedId = extractVtcStudentId(rawStudentId);

    const parsedDate = parseFormTimestamp(tsRaw);
    let weekNumber = 1;
    if (parsedDate && !Number.isNaN(baseMonday.getTime())) {
      const diffMs = parsedDate.getTime() - baseMonday.getTime();
      weekNumber = Math.max(1, Math.floor(diffMs / msPerWeek) + 1);
    }

    if (resolvedStudentId && rawGroup) {
      if (!groupCountsByStudentId.has(resolvedStudentId)) {
        groupCountsByStudentId.set(resolvedStudentId, new Map());
      }
      const gMap = groupCountsByStudentId.get(resolvedStudentId);
      gMap.set(rawGroup, (gMap.get(rawGroup) || 0) + 1);
    }

    rawEntries.push({
      rowNumber: idx + 2,
      timestamp: tsRaw,
      timestampMs: parsedDate ? parsedDate.getTime() : idx,
      weekNumber,
      rawGroupId: rawGroup || 'UNASSIGNED',
      studentName: rawName,
      rawStudentId,
      studentId: resolvedStudentId,
      hadIdTypo: Boolean(rawExtractedId && resolvedStudentId && rawExtractedId !== resolvedStudentId),
      email,
      supervisor,
      isDoingSomething: doingStr === 'yes' || doingStr === 'true' || doingStr === '1',
      workDone,
      unfinished,
      nextPlan,
      inactiveReason,
    });
  });

  // Resolve canonical Group ID per student (majority/latest group or existing group assignment)
  const canonicalGroupByStudentId = new Map();
  const groupDriftByStudentId = new Map();
  groupCountsByStudentId.forEach((gMap, stuId) => {
    const entries = [...gMap.entries()].sort((a, b) => b[1] - a[1]);
    canonicalGroupByStudentId.set(stuId, entries[0][0]);
    if (entries.length > 1) {
      groupDriftByStudentId.set(
        stuId,
        entries.map(([g, cnt]) => `${g} (${cnt}x)`).join(' vs ')
      );
    }
  });

  // Group chronologically by student and evaluate log quality + fake-log challenge questions
  const entriesByStudent = new Map();
  rawEntries
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .forEach((entry) => {
      const key = entry.studentId || entry.email;
      const canonicalGroup =
        knownGroupByEmail.get(entry.email) ||
        canonicalGroupByStudentId.get(entry.studentId) ||
        entry.rawGroupId;
      entry.groupId = canonicalGroup;
      entry.groupDriftNote = groupDriftByStudentId.get(entry.studentId) || '';

      if (!entriesByStudent.has(key)) {
        entriesByStudent.set(key, []);
      }
      const priors = entriesByStudent.get(key);
      const evaluation = evaluateWeeklyLogQuality(entry, priors);
      Object.assign(entry, evaluation);
      priors.push(entry);
    });

  const byGroupAndWeek = {};
  const byStudentKey = {};
  const weekSet = new Set();
  const groupSet = new Set();
  const supervisorSet = new Set();

  let activeYesCount = 0;
  let inactiveNoCount = 0;
  let genuineCount = 0;
  let vagueCount = 0;
  let suspectedAiCount = 0;

  rawEntries.forEach((entry) => {
    weekSet.add(entry.weekNumber);
    if (entry.groupId) groupSet.add(entry.groupId);
    if (entry.supervisor) supervisorSet.add(entry.supervisor);

    if (entry.isDoingSomething) activeYesCount++;
    else inactiveNoCount++;

    if (entry.qualityStatus === 'genuine') genuineCount++;
    else if (entry.qualityStatus === 'vague_useless') vagueCount++;
    else if (entry.qualityStatus === 'suspected_ai_fake') suspectedAiCount++;

    const gwKey = `${entry.groupId.toUpperCase()}__wk${entry.weekNumber}`;
    if (!byGroupAndWeek[gwKey]) byGroupAndWeek[gwKey] = [];
    // If student submitted twice in the same week, keep latest submission as primary for that week
    const existingIdx = byGroupAndWeek[gwKey].findIndex(
      (e) => e.studentId === entry.studentId || e.email === entry.email
    );
    if (existingIdx >= 0) {
      byGroupAndWeek[gwKey][existingIdx] = entry;
    } else {
      byGroupAndWeek[gwKey].push(entry);
    }

    const stuKey = entry.email || entry.studentId;
    if (!byStudentKey[stuKey]) byStudentKey[stuKey] = [];
    byStudentKey[stuKey].push(entry);
  });

  return {
    entries: rawEntries,
    byGroupAndWeek,
    byStudentKey,
    weeks: [...weekSet].sort((a, b) => a - b),
    groupNames: [...groupSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    supervisors: [...supervisorSet].sort(),
    summary: {
      totalEntries: rawEntries.length,
      activeYesCount,
      inactiveNoCount,
      genuineCount,
      vagueCount,
      suspectedAiCount,
    },
  };
}

/**
 * Rehydrates the structured weeklyLogData object directly from persisted Firestore
 * `classes/{classId}/projectStudentProfiles` documents (populated by the Cron Job or Ingest action),
 * so all historical logs and student profiles work even without re-fetching CSV or having weekly meetings.
 */
export function rehydrateWeeklyLogDataFromPersistedProfiles(persistedProfiles = []) {
  const entries = [];
  const byGroupAndWeek = {};
  const byStudentKey = {};
  const weekSet = new Set();
  const groupSet = new Set();
  const supervisorSet = new Set();

  let activeYesCount = 0;
  let inactiveNoCount = 0;
  let genuineCount = 0;
  let vagueCount = 0;
  let suspectedAiCount = 0;

  (Array.isArray(persistedProfiles) ? persistedProfiles : []).forEach((prof) => {
    const logs = Array.isArray(prof.ingestedWeeklyLogs) ? prof.ingestedWeeklyLogs : [];
    const stuEmail = normalizeStudentEmail(prof.email || '');
    const stuId = prof.studentId || stuEmail.split('@')[0];
    const grpCode = String(prof.groupCode || prof.groupId || '').toUpperCase();
    if (grpCode && grpCode !== 'UNASSIGNED') groupSet.add(grpCode);
    if (prof.supervisorName) supervisorSet.add(prof.supervisorName);

    logs.forEach((rawLog) => {
      const entry = {
        ...rawLog,
        studentId: rawLog.studentId || stuId,
        email: normalizeStudentEmail(rawLog.email || stuEmail),
        studentName: rawLog.studentName || prof.name || stuId,
        groupId: String(rawLog.groupId || grpCode || 'UNASSIGNED').toUpperCase(),
        supervisor: rawLog.supervisor || prof.supervisorName || '',
      };
      entries.push(entry);
      if (entry.weekNumber) weekSet.add(Number(entry.weekNumber));
      if (entry.groupId && entry.groupId !== 'UNASSIGNED') groupSet.add(entry.groupId);
      if (entry.supervisor) supervisorSet.add(entry.supervisor);

      if (entry.isDoingSomething) activeYesCount++;
      else inactiveNoCount++;

      if (entry.qualityStatus === 'genuine' || entry.qualityStatus === 'genuine_verified') genuineCount++;
      else if (entry.qualityStatus === 'vague_useless') vagueCount++;
      else if (entry.qualityStatus === 'suspected_ai_fake' || entry.qualityStatus === 'suspected_ai_unverified') {
        suspectedAiCount++;
      }

      const gwKey = `${entry.groupId}__wk${entry.weekNumber}`;
      if (!byGroupAndWeek[gwKey]) byGroupAndWeek[gwKey] = [];
      const existingIdx = byGroupAndWeek[gwKey].findIndex(
        (e) => e.studentId === entry.studentId || e.email === entry.email
      );
      if (existingIdx >= 0) {
        byGroupAndWeek[gwKey][existingIdx] = entry;
      } else {
        byGroupAndWeek[gwKey].push(entry);
      }

      const stuKey = entry.email || entry.studentId;
      if (!byStudentKey[stuKey]) byStudentKey[stuKey] = [];
      byStudentKey[stuKey].push(entry);
    });
  });

  return {
    entries,
    byGroupAndWeek,
    byStudentKey,
    weeks: [...weekSet].sort((a, b) => a - b),
    groupNames: [...groupSet].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    supervisors: [...supervisorSet].sort(),
    summary: {
      totalEntries: entries.length,
      activeYesCount,
      inactiveNoCount,
      genuineCount,
      vagueCount,
      suspectedAiCount,
    },
  };
}

/**
 * Builds longitudinal Individual Student Contribution & Log Quality Profiles across all active weeks.
 *
 * - Holiday-resilient: only evaluates active project weeks where logs or meetings occurred, so skipped
 *   holiday weeks never penalize a student's submission rate or attendance rate.
 * - Multi-supervisor aware: aggregates all meetings (`weekMeetings`) recorded in the same week (e.g.
 *   Primary Supervisor + Co-Supervisor meetings in Week N).
 */
export function buildStudentContributionProfiles({
  logData = {},
  groups = [],
  meetings = [],
} = {}) {
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  const logWeeks = Array.isArray(logData?.weeks) ? logData.weeks.map(Number).filter(Boolean) : [];
  const meetingWeeks = (meetings || []).map((m) => Number(m.weekNumber) || 1).filter(Boolean);
  const activeWeekSet = new Set([...logWeeks, ...meetingWeeks]);
  const weekNumbers =
    activeWeekSet.size > 0
      ? [...activeWeekSet].sort((a, b) => a - b)
      : [1];
  const expectedLogWeeksCount = logWeeks.length > 0 ? logWeeks.length : weekNumbers.length;

  // Build map of students from both configured Project Groups and the Weekly Log Sheet
  const studentMap = new Map();

  (Array.isArray(groups) ? groups : []).forEach((grp) => {
    const cleanGroupCode = String(grp.name || '')
      .replace(/^group\s+/i, '')
      .trim()
      .toUpperCase();
    (Array.isArray(grp.members) ? grp.members : []).forEach((m) => {
      const email = normalizeStudentEmail(m.email || '');
      const studentId = email.split('@')[0];
      const key = email || studentId;
      if (!key) return;
      studentMap.set(key, {
        key,
        studentId,
        email,
        name: m.name || studentId,
        role: m.role || 'Member',
        groupId: grp.id,
        groupCode: cleanGroupCode || grp.name,
        groupName: grp.name || cleanGroupCode,
        projectTopic: grp.projectTopic || '',
        supervisorName: grp.supervisorName || '',
        supervisorEmail: grp.supervisorEmail || '',
        hadIdTypo: false,
        groupDriftNote: '',
      });
    });
  });

  entries.forEach((e) => {
    const email = normalizeStudentEmail(e.email || '');
    const key = email || e.studentId;
    if (!key) return;

    // Match existing group by code (e.g. "A01" or "Group A01")
    const matchedGroup = (Array.isArray(groups) ? groups : []).find((g) => {
      const code = String(g.name || '')
        .replace(/^group\s+/i, '')
        .trim()
        .toUpperCase();
      return code === String(e.groupId || '').toUpperCase() || g.id === e.groupId;
    });

    if (!studentMap.has(key)) {
      studentMap.set(key, {
        key,
        studentId: e.studentId || email.split('@')[0],
        email,
        name: e.studentName || email.split('@')[0],
        role: 'Member',
        groupId: matchedGroup?.id || e.groupId,
        groupCode: String(e.groupId || '').toUpperCase(),
        groupName: matchedGroup?.name || e.groupId || 'Unassigned',
        projectTopic: matchedGroup?.projectTopic || '',
        supervisorName: e.supervisor || matchedGroup?.supervisorName || '',
        supervisorEmail: matchedGroup?.supervisorEmail || '',
        hadIdTypo: Boolean(e.hadIdTypo),
        groupDriftNote: e.groupDriftNote || '',
      });
    } else {
      const cur = studentMap.get(key);
      if (!cur.supervisorName && e.supervisor) cur.supervisorName = e.supervisor;
      if (e.hadIdTypo) cur.hadIdTypo = true;
      if (e.groupDriftNote && !cur.groupDriftNote) cur.groupDriftNote = e.groupDriftNote;
    }
  });

  const profiles = [];

  studentMap.forEach((stu) => {
    const stuLogs = entries
      .filter(
        (e) =>
          normalizeStudentEmail(e.email) === stu.email ||
          (e.studentId && e.studentId === stu.studentId)
      )
      .sort((a, b) => a.timestampMs - b.timestampMs);

    const grpMeetings = (Array.isArray(meetings) ? meetings : []).filter((m) => {
      if (stu.groupId && m.groupId === stu.groupId) return true;
      const mCode = String(m.groupName || '')
        .replace(/^group\s+/i, '')
        .trim()
        .toUpperCase();
      return mCode && mCode === stu.groupCode;
    });

    let totalWeeksSubmitted = 0;
    let activeYesWeeks = 0;
    let inactiveNoWeeks = 0;
    let genuineLogsCount = 0;
    let vagueLogsCount = 0;
    let suspectedAiLogsCount = 0;
    let qualityScoreSum = 0;
    let qualityScoreCount = 0;

    let meetingsAttended = 0;
    let totalTasksVerifiedInMeetings = 0;
    let realWorkScoreSum = 0;
    let realWorkScoreCount = 0;

    const weeklyTimeline = weekNumbers.map((wk) => {
      const weekLogs = stuLogs.filter((l) => Number(l.weekNumber) === wk);
      const logEntry = weekLogs.length > 0 ? weekLogs[weekLogs.length - 1] : null;

      // Support 1 or multiple meetings in the same week (e.g. Supervisor + Co-Supervisor)
      const weekMeetings = grpMeetings.filter((m) => Number(m.weekNumber) === wk);
      const primaryMtg = weekMeetings[0] || null;

      const matchStuRecord = (rec) =>
        normalizeStudentEmail(rec?.email) === stu.email ||
        rec?.uid === stu.studentId ||
        rec?.studentId === stu.studentId ||
        normalizePersonNameKey(rec?.name) === normalizePersonNameKey(stu.name);

      const attList = weekMeetings
        .map((m) => ({
          mtg: m,
          att: (m.attendanceRecord || []).find(matchStuRecord),
        }))
        .filter((x) => x.att);

      const contribList = weekMeetings
        .map((m) => ({
          mtg: m,
          contrib: (m.studentContributions || []).find(matchStuRecord),
        }))
        .filter((x) => x.contrib);

      const preAuditList = weekMeetings
        .map((m) => (m.preMeetingLogAudit || []).find(matchStuRecord))
        .filter(Boolean);

      const primaryContrib = contribList[contribList.length - 1]?.contrib || null;
      const primaryPreAudit = preAuditList[preAuditList.length - 1] || null;

      if (logEntry) {
        totalWeeksSubmitted++;
        if (logEntry.isDoingSomething) activeYesWeeks++;
        else inactiveNoWeeks++;

        const effectiveStatus =
          primaryContrib?.logQualityAssessment ||
          primaryPreAudit?.logQualityStatus ||
          logEntry.qualityStatus;
        const effectiveScore =
          typeof primaryContrib?.logQualityScore === 'number'
            ? primaryContrib.logQualityScore
            : typeof primaryPreAudit?.logQualityScore === 'number'
            ? primaryPreAudit.logQualityScore
            : logEntry.qualityScore;

        qualityScoreSum += Number(effectiveScore) || 0;
        qualityScoreCount++;

        if (effectiveStatus === 'genuine' || effectiveStatus === 'genuine_verified') {
          genuineLogsCount++;
        } else if (effectiveStatus === 'vague_useless') {
          vagueLogsCount++;
        } else if (
          effectiveStatus === 'suspected_ai_fake' ||
          effectiveStatus === 'suspected_ai_unverified' ||
          effectiveStatus === 'contradicted_in_meeting'
        ) {
          suspectedAiLogsCount++;
        }
      }

      let weekPresentCount = 0;
      let weekLateCount = 0;
      weekMeetings.forEach((m) => {
        const att = (m.attendanceRecord || []).find(matchStuRecord);
        const status = att?.status || 'absent';
        if (status === 'present') {
          meetingsAttended++;
          weekPresentCount++;
        } else if (status === 'late') {
          meetingsAttended++;
          weekLateCount++;
        }
        const contrib = (m.studentContributions || []).find(matchStuRecord);
        const tasksDone = Array.isArray(contrib?.workCompleted) ? contrib.workCompleted.length : 0;
        totalTasksVerifiedInMeetings += tasksDone;
        if (typeof contrib?.realWorkScore === 'number') {
          realWorkScoreSum += contrib.realWorkScore;
          realWorkScoreCount++;
        }
      });

      const combinedWorkCompleted = contribList.flatMap(({ mtg, contrib }) => {
        const prefix =
          weekMeetings.length > 1 && mtg.supervisorName ? `[${mtg.supervisorName}] ` : '';
        return (contrib.workCompleted || []).map((w) => `${prefix}${w}`);
      });

      const combinedActionItems = contribList.flatMap(({ mtg, contrib }) => {
        const prefix =
          weekMeetings.length > 1 && mtg.supervisorName ? `[${mtg.supervisorName}] ` : '';
        return (contrib.actionItemsNextWeek || []).map((a) => `${prefix}${a}`);
      });

      const combinedWeeklyFeedback = contribList
        .map(({ mtg, contrib }) => {
          if (!contrib?.weeklyFeedback) return '';
          const prefix =
            weekMeetings.length > 1 && mtg.supervisorName ? `[${mtg.supervisorName}] ` : '';
          return `${prefix}${contrib.weeklyFeedback}`;
        })
        .filter(Boolean)
        .join(' | ');

      const challengeQuestions =
        (Array.isArray(primaryContrib?.challengeQuestions) && primaryContrib.challengeQuestions.length > 0
          ? primaryContrib.challengeQuestions
          : null) ||
        (Array.isArray(primaryPreAudit?.challengeQuestions) && primaryPreAudit.challengeQuestions.length > 0
          ? primaryPreAudit.challengeQuestions
          : null) ||
        logEntry?.suggestedChallengeQuestions ||
        [];

      const attendanceStatus =
        weekMeetings.length === 0
          ? 'no_meeting'
          : weekPresentCount > 0
          ? 'present'
          : weekLateCount > 0
          ? 'late'
          : 'absent';

      const supervisorsLabel = [
        ...new Set(
          weekMeetings
            .map((m) => m.supervisorName || (m.supervisorEmail ? m.supervisorEmail.split('@')[0] : ''))
            .filter(Boolean)
        ),
      ].join(', ');

      return {
        weekNumber: wk,
        submitted: Boolean(logEntry),
        logEntry,
        meetingId: primaryMtg?.id || null,
        meetingsCount: weekMeetings.length,
        meetingsCountInWeek: weekMeetings.length,
        supervisorsLabel,
        attendanceStatus,
        speakingContribution: attList[0]?.att?.speakingContribution || 'none',
        workCompletedInMeeting: combinedWorkCompleted,
        actionItemsNextWeek: combinedActionItems,
        logQualityStatus:
          primaryContrib?.logQualityAssessment ||
          primaryPreAudit?.logQualityStatus ||
          logEntry?.qualityStatus ||
          'missing',
        logQualityScore:
          typeof primaryContrib?.logQualityScore === 'number'
            ? primaryContrib.logQualityScore
            : typeof primaryPreAudit?.logQualityScore === 'number'
            ? primaryPreAudit.logQualityScore
            : logEntry?.qualityScore ?? null,
        realWorkScore:
          typeof primaryContrib?.realWorkScore === 'number' ? primaryContrib.realWorkScore : null,
        weeklyFeedback: combinedWeeklyFeedback,
        aiContributionAssessment:
          primaryContrib?.aiContributionAssessment || primaryPreAudit?.logAuditSummary || '',
        challengeQuestions,
      };
    });

    const missingWeeksCount = Math.max(0, expectedLogWeeksCount - totalWeeksSubmitted);
    const submissionRatePct =
      expectedLogWeeksCount > 0 ? Math.round((totalWeeksSubmitted / expectedLogWeeksCount) * 100) : 0;
    const avgLogQualityScore =
      qualityScoreCount > 0 ? Number((qualityScoreSum / qualityScoreCount).toFixed(1)) : 0;
    const meetingAttendancePct =
      grpMeetings.length > 0 ? Math.round((meetingsAttended / grpMeetings.length) * 100) : 0;
    const avgRealWorkScore =
      realWorkScoreCount > 0 ? Number((realWorkScoreSum / realWorkScoreCount).toFixed(1)) : null;

    // Compute Log Quality Grade
    let logQualityGrade = 'C (Needs Detail)';
    if (totalWeeksSubmitted === 0) {
      logQualityGrade = 'F (No Logs)';
    } else if (avgLogQualityScore >= 8 && suspectedAiLogsCount === 0 && vagueLogsCount === 0) {
      logQualityGrade = 'A (High Quality & Authentic)';
    } else if (avgLogQualityScore >= 6.5 && suspectedAiLogsCount === 0) {
      logQualityGrade = 'B (Good Log Quality)';
    } else if (suspectedAiLogsCount > 0 || vagueLogsCount >= 2 || avgLogQualityScore < 4.5) {
      logQualityGrade = 'D (Vague / Suspected Fake)';
    }

    const riskFlags = [];
    if (suspectedAiLogsCount > 0) {
      riskFlags.push(`🟠 ${suspectedAiLogsCount} Suspected AI/Fake Log(s)`);
    }
    if (vagueLogsCount > 0) {
      riskFlags.push(`🔴 ${vagueLogsCount} Vague/Useless Log(s)`);
    }
    if (inactiveNoWeeks >= 2) {
      riskFlags.push(`⚪ ${inactiveNoWeeks} Inactive ("No") Weeks`);
    }
    if (missingWeeksCount >= 3) {
      riskFlags.push(`⚠️ ${missingWeeksCount} Missing Weekly Logs`);
    }
    if (stu.groupDriftNote) {
      riskFlags.push(`🔀 Group Drift: ${stu.groupDriftNote}`);
    }
    if (stu.hadIdTypo) {
      riskFlags.push('✏️ Healed Student ID Typo');
    }

    const latestSubmittedTimeline = [...weeklyTimeline].reverse().find((w) => w.submitted);

    profiles.push({
      ...stu,
      totalWeeksSubmitted,
      activeYesWeeks,
      inactiveNoWeeks,
      missingWeeksCount,
      submissionRatePct,
      avgLogQualityScore,
      genuineLogsCount,
      vagueLogsCount,
      suspectedAiLogsCount,
      logQualityGrade,
      meetingsAttended,
      meetingsTotal: grpMeetings.length,
      meetingsHeld: grpMeetings.length,
      meetingAttendancePct,
      totalTasksVerifiedInMeetings,
      verifiedTasksCount: totalTasksVerifiedInMeetings,
      avgRealWorkScore,
      riskFlags,
      ingestedWeeklyLogs: stuLogs,
      latestTimeline: latestSubmittedTimeline || null,
      weeklyTimeline,
    });
  });

  profiles.sort((a, b) => {
    const grpCmp = (a.groupCode || '').localeCompare(b.groupCode || '', undefined, { numeric: true });
    if (grpCmp !== 0) return grpCmp;
    return (a.name || '').localeCompare(b.name || '');
  });

  return profiles;
}

/**
 * Creates or merges Project Groups (`A01`..`A11`, `E01`, `L01`..`L04`) directly from the parsed Weekly Log Sheet,
 * anchoring every student on their canonical `@stu.vtc.edu.hk` email and resolving class UIDs when available.
 */
export function bootstrapProjectGroupsFromWeeklyLogs({
  logData = {},
  existingGroups = [],
  enrolledStudents = [],
  classTeachers = [],
  currentUserEmail = '',
  currentUserName = '',
} = {}) {
  const entries = Array.isArray(logData?.entries) ? logData.entries : [];
  if (entries.length === 0) return existingGroups;

  const uidByEmail = new Map();
  (Array.isArray(enrolledStudents) ? enrolledStudents : []).forEach((s) => {
    const em = toVtcStudentEmail(s?.email || '');
    if (em && s?.uid) uidByEmail.set(em, s.uid);
  });

  const groupsByCode = new Map();
  (Array.isArray(existingGroups) ? existingGroups : []).forEach((g) => {
    const code = String(g.name || '')
      .replace(/^group\s+/i, '')
      .trim()
      .toUpperCase();
    const normalizedMembers = (Array.isArray(g.members) ? g.members : []).map((m) => {
      const em = toVtcStudentEmail(m?.email || m?.uid || '');
      const stuId = extractVtcStudentId(em);
      const resolvedUid =
        uidByEmail.get(em) ||
        (m?.uid && !/^\d+$/.test(String(m.uid)) ? m.uid : em);
      return {
        ...m,
        uid: resolvedUid,
        email: em,
        studentId: stuId,
      };
    });
    groupsByCode.set(code, {
      ...g,
      members: normalizedMembers,
    });
  });

  // Match supervisor display name (e.g. "Cyrus Wong") to a class teacher email if possible
  const matchSupervisorEmail = (supName = '') => {
    const clean = String(supName || '').toLowerCase().trim();
    if (!clean) return currentUserEmail;
    const firstToken = clean.split(/\s+/)[0];
    const matchedTeacher = (Array.isArray(classTeachers) ? classTeachers : []).find((em) =>
      em.toLowerCase().includes(firstToken)
    );
    return matchedTeacher || currentUserEmail;
  };

  entries.forEach((e) => {
    const code = String(e.groupId || '').trim().toUpperCase();
    if (!code || code === 'UNASSIGNED') return;

    if (!groupsByCode.has(code)) {
      groupsByCode.set(code, {
        id: `grp_${code.toLowerCase()}`,
        name: code,
        projectTopic: '',
        supervisorName: e.supervisor || currentUserName || '',
        supervisorEmail: matchSupervisorEmail(e.supervisor),
        members: [],
      });
    }

    const grp = groupsByCode.get(code);
    if (e.supervisor && !grp.supervisorName) {
      grp.supervisorName = e.supervisor;
      grp.supervisorEmail = matchSupervisorEmail(e.supervisor);
    }

    const email = toVtcStudentEmail(e.email || e.studentId);
    const stuId = extractVtcStudentId(email) || e.studentId;
    const exists = grp.members.some(
      (m) =>
        toVtcStudentEmail(m.email) === email ||
        extractVtcStudentId(m.email || m.uid) === stuId
    );
    if (!exists && email) {
      grp.members.push({
        uid: uidByEmail.get(email) || email,
        email,
        studentId: stuId,
        name: e.studentName || stuId || email,
        role: grp.members.length === 0 ? 'Leader' : 'Member',
      });
    }
  });

  return [...groupsByCode.values()].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, { numeric: true })
  );
}

/**
 * Incrementally merges newly parsed student contribution profiles against existing persisted
 * Firestore profiles (`classes/{classId}/projectStudentProfiles`):
 *  - First-time backfill (`existingProfiles.length === 0` or `forceFull === true`): returns all
 *    profiles as changed (`deltaProfiles = mergedProfiles`).
 *  - Incremental runs: preserves any historical `ingestedWeeklyLogs` already stored in Firestore,
 *    merges new/updated weekly log entries by `(weekNumber, timestamp)`, and returns only the
 *    `deltaProfiles` whose logs actually changed so unchanged student docs are not re-written.
 */
export function mergeIncrementalStudentProfiles({
  incomingProfiles = [],
  existingProfiles = [],
  forceFull = false,
} = {}) {
  const existingByKey = new Map();
  (Array.isArray(existingProfiles) ? existingProfiles : []).forEach((p) => {
    const k1 = String(p.studentId || '').trim();
    const k2 = String(p.key || '').trim();
    const k3 = normalizeStudentEmail(p.email || '');
    if (k1) existingByKey.set(k1, p);
    if (k2) existingByKey.set(k2, p);
    if (k3) existingByKey.set(k3, p);
  });

  const makeLogSignature = (l) =>
    `${Number(l?.weekNumber) || 1}__${String(l?.timestamp || '').trim()}__${String(
      l?.workDone || ''
    ).trim()}__${String(l?.nextPlan || '').trim()}__${String(l?.inactiveReason || '').trim()}`;

  const mergedProfiles = [];
  const deltaProfiles = [];
  let newLogEntriesCount = 0;
  let unchangedProfilesCount = 0;

  (Array.isArray(incomingProfiles) ? incomingProfiles : []).forEach((inc) => {
    const existing =
      existingByKey.get(String(inc.studentId || '').trim()) ||
      existingByKey.get(String(inc.key || '').trim()) ||
      existingByKey.get(normalizeStudentEmail(inc.email || '')) ||
      null;

    if (!existing || forceFull) {
      const incLogs = Array.isArray(inc.ingestedWeeklyLogs) ? inc.ingestedWeeklyLogs : [];
      newLogEntriesCount += incLogs.length;
      mergedProfiles.push(inc);
      deltaProfiles.push(inc);
      return;
    }

    const existingLogs = Array.isArray(existing.ingestedWeeklyLogs)
      ? existing.ingestedWeeklyLogs
      : [];
    const existingSigSet = new Set(existingLogs.map(makeLogSignature));

    // Merge historical logs (by weekNumber + timestamp) so older weeks are never lost even if trimmed from sheet
    const mergedLogMap = new Map();
    existingLogs.forEach((l) => {
      const wkKey = `${Number(l.weekNumber) || 1}__${String(l.timestamp || '').trim()}`;
      mergedLogMap.set(wkKey, l);
    });

    let addedForStudent = 0;
    (Array.isArray(inc.ingestedWeeklyLogs) ? inc.ingestedWeeklyLogs : []).forEach((l) => {
      const sig = makeLogSignature(l);
      if (!existingSigSet.has(sig)) {
        addedForStudent++;
      }
      const wkKey = `${Number(l.weekNumber) || 1}__${String(l.timestamp || '').trim()}`;
      mergedLogMap.set(wkKey, l);
    });

    const combinedLogs = [...mergedLogMap.values()].sort(
      (a, b) => (Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0)
    );

    const mergedProfile = {
      ...existing,
      ...inc,
      ingestedWeeklyLogs: combinedLogs,
    };
    mergedProfiles.push(mergedProfile);

    const meetingsChanged =
      Number(existing.meetingsTotal || 0) !== Number(inc.meetingsTotal || 0) ||
      Number(existing.meetingsAttended || 0) !== Number(inc.meetingsAttended || 0);

    if (addedForStudent > 0 || meetingsChanged) {
      newLogEntriesCount += addedForStudent;
      deltaProfiles.push(mergedProfile);
    } else {
      unchangedProfilesCount++;
    }
  });

  return {
    mergedProfiles,
    deltaProfiles,
    newLogEntriesCount,
    unchangedProfilesCount,
    isInitialBackfill: existingProfiles.length === 0 || forceFull,
  };
}

/**
 * Exports Individual Student Contribution & Weekly Log Quality Profiles to Excel (.xlsx).
 */
export async function exportStudentContributionProfilesExcel({
  classId = 'class',
  profiles = [],
} = {}) {
  const maxWeek = profiles.reduce(
    (max, p) => Math.max(max, (p.weeklyTimeline || []).length),
    8
  );
  const weekHeaders = Array.from({ length: maxWeek }, (_, i) => `Week ${i + 1} Log & Quality`);

  const headers = [
    'Group',
    'Supervisor',
    'Student ID',
    'Student Name',
    'Student Email',
    'Submitted Weeks',
    'Active (Yes) Weeks',
    'Inactive (No) Weeks',
    'Avg Log Quality (/10)',
    'Log Quality Grade',
    'Genuine Logs',
    'Vague/Useless Logs',
    'Suspected AI/Fake Logs',
    'Meetings Attended',
    'Risk Flags',
    ...weekHeaders,
    'Latest Challenge Questions',
    'Latest Weekly Feedback',
  ];

  const rows = (Array.isArray(profiles) ? profiles : []).map((p) => {
    const weekCells = Array.from({ length: maxWeek }, (_, idx) => {
      const w = (p.weeklyTimeline || [])[idx];
      if (!w || !w.submitted || !w.logEntry) return 'Missing';
      const l = w.logEntry;
      if (!l.isDoingSomething) {
        return `[NO WORK - ${w.logQualityScore ?? 2}/10] Reason: ${l.inactiveReason || 'N/A'}`;
      }
      const statusTag =
        w.logQualityStatus === 'suspected_ai_fake' || w.logQualityStatus === 'suspected_ai_unverified'
          ? 'SUSPECTED AI/FAKE'
          : w.logQualityStatus === 'vague_useless'
          ? 'VAGUE/USELESS'
          : 'GENUINE';
      return `[${statusTag} ${w.logQualityScore ?? l.qualityScore}/10] Done: ${l.workDone} | Next: ${l.nextPlan}`;
    });

    const latest = p.latestTimeline;
    return [
      p.groupName || p.groupCode || '',
      p.supervisorName || p.supervisorEmail || '',
      p.studentId || '',
      p.name || '',
      p.email || '',
      p.totalWeeksSubmitted,
      p.activeYesWeeks,
      p.inactiveNoWeeks,
      p.avgLogQualityScore,
      p.logQualityGrade,
      p.genuineLogsCount,
      p.vagueLogsCount,
      p.suspectedAiLogsCount,
      `${p.meetingsAttended}/${p.meetingsTotal}`,
      (p.riskFlags || []).join('; '),
      ...weekCells,
      (latest?.challengeQuestions || []).join(' | '),
      latest?.weeklyFeedback || '',
    ];
  });

  return await exportToExcel(headers, rows, `${classId}_student_contribution_profiles.xlsx`);
}
