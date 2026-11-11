import fs from 'node:fs';
import path from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const explicitProjectArg = process.argv.slice(2).find((arg) => !arg.startsWith('-'));
const projectId = (explicitProjectArg || 'it114115-2627').trim();

// Sanitize ambient environment variables so Google SDKs never touch system default project
delete process.env.GCLOUD_PROJECT;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.CLOUDSDK_CORE_PROJECT;
process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;

const app = initializeApp({ projectId }, `seed-fyp-${Date.now()}`);
const auth = getAuth(app);
const db = getFirestore(app);

const CLASS_ID = 'it114115-fyp-2627';

// Load private roster & sheet URLs from git-ignored local JSON file or environment variables
// Never commit real student IDs, full names, or private Google Sheet URLs to source control.
const rosterJsonPath =
  process.env.FYP_ROSTER_JSON_PATH ||
  path.resolve(process.cwd(), 'admin/backups/fyp_roster.local.json');
const localRosterConfig = fs.existsSync(rosterJsonPath)
  ? JSON.parse(fs.readFileSync(rosterJsonPath, 'utf8'))
  : {};

const GROUPING_SHEET_URL =
  process.env.FYP_GROUPING_SHEET_URL ||
  localRosterConfig.groupingSheetUrl ||
  'https://docs.google.com/spreadsheets/d/EXAMPLE_GROUPING_SHEET_ID/edit?gid=0#gid=0';
const WEEKLY_LOG_SHEET_URL =
  process.env.FYP_WEEKLY_LOG_SHEET_URL ||
  localRosterConfig.weeklyLogSheetUrl ||
  'https://docs.google.com/spreadsheets/d/EXAMPLE_WEEKLY_LOG_SHEET_ID/edit?gid=0#gid=0';
const WEEKLY_LOG_CSV_EXPORT_URL =
  process.env.FYP_WEEKLY_LOG_CSV_EXPORT_URL ||
  localRosterConfig.weeklyLogCsvExportUrl ||
  '';

const isDevProject = projectId.includes('dev');

const TEACHERS = localRosterConfig.teachers || [
  { email: 'cywong@vtc.edu.hk', displayName: 'Cyrus Wong' },
  { email: 'kcheung@vtc.edu.hk', displayName: 'Kitson Cheung' },
  { email: 'kakaleung@vtc.edu.hk', displayName: 'Elka Leung' },
  { email: 'james.chan@vtc.edu.hk', displayName: 'James Chan' },
  { email: 'hli852@vtc.edu.hk', displayName: 'Harry Li' },
  ...(isDevProject
    ? [
        { email: 'teacher1@vtc.edu.hk', displayName: 'Demo Teacher 1' },
        { email: 'teacher2@vtc.edu.hk', displayName: 'Demo Teacher 2' },
        { email: 'teacher3@vtc.edu.hk', displayName: 'Demo Teacher 3' },
      ]
    : []),
];

const CHINESE_NAME_BY_SID = localRosterConfig.chineseNameBySid || {};

const FYP_GROUPS = localRosterConfig.fypGroups || [
  {
    id: 'grp_a01',
    name: 'A01',
    cohort: 'IT114115 Year 2',
    projectTopic: 'Cloud-Native AI Classroom Assistant (Synthetic Demo Group)',
    supervisorEmail: 'kcheung@vtc.edu.hk',
    supervisorName: 'Kitson Cheung / Elka Leung',
    coSupervisorEmails: ['kakaleung@vtc.edu.hk', 'cywong@vtc.edu.hk'],
    assessorEmail: 'cywong@vtc.edu.hk',
    assessorName: 'Cyrus Wong',
    students: [
      { sid: '990000101', name: 'Demo Student A01-1', classCode: 'IT114115/2A', role: 'Leader' },
      { sid: '990000102', name: 'Demo Student A01-2', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '990000103', name: 'Demo Student A01-3', classCode: 'IT114115/2A', role: 'Member' },
      { sid: '990000104', name: 'Demo Student A01-4', classCode: 'IT114115/2A', role: 'Member' },
    ],
  },
];

function splitCsvRow(line) {
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
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseFormResponses2Csv(csvText, semesterStartMondayStr, hydratedGroups) {
  const lines = String(csvText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return {
      entries: [],
      weeks: [],
      groupNames: [],
      summary: { totalEntries: 0, genuineCount: 0, vagueCount: 0, suspectedAiCount: 0, inactiveNoCount: 0 },
    };
  }

  const startMonday = new Date(`${semesterStartMondayStr}T00:00:00+08:00`);
  const groupBySid = new Map();
  const nameBySid = new Map();
  const supervisorByGroup = new Map();

  for (const grp of hydratedGroups) {
    supervisorByGroup.set(grp.name.toUpperCase(), {
      email: grp.supervisorEmail,
      name: grp.supervisorName,
    });
    for (const m of grp.members) {
      groupBySid.set(m.studentId, grp.name.toUpperCase());
      nameBySid.set(m.studentId, m.name);
    }
  }

  const rawRows = lines.slice(1).map((line) => splitCsvRow(line));
  const entries = [];
  const weekSet = new Set();
  const groupSet = new Set(hydratedGroups.map((g) => g.name.toUpperCase()));

  let genuineCount = 0;
  let vagueCount = 0;
  let suspectedAiCount = 0;
  let inactiveNoCount = 0;

  for (const cells of rawRows) {
    const timestamp = cells[0] || '';
    const rawGroup = String(cells[1] || '').trim().toUpperCase();
    const rawName = String(cells[2] || '').trim();
    const rawSidDigits = String(cells[3] || '').replace(/\D/g, '');
    const rawSup = String(cells[4] || '').trim();
    const doingStr = String(cells[5] || '').trim().toLowerCase();
    const workDone = String(cells[6] || '').trim();
    const unfinished = String(cells[7] || '').trim();
    const nextPlan = String(cells[8] || '').trim();
    const inactiveReason = String(cells[9] || '').trim();

    if (!timestamp && !rawSidDigits && !rawName) continue;

    // Heal 8-digit or 9-digit typo if a known 9-digit SID matches by name
    let sid = rawSidDigits;
    if (!groupBySid.has(sid) && rawName) {
      for (const [knownSid, knownName] of nameBySid.entries()) {
        if (knownName.toLowerCase().includes(rawName.toLowerCase())) {
          sid = knownSid;
          break;
        }
      }
    }
    if (!sid) continue;

    const email = `${sid}@stu.vtc.edu.hk`;
    const groupId = groupBySid.get(sid) || (rawGroup.match(/^[ALE]\d{2}$/) ? rawGroup : 'UNASSIGNED');
    if (groupId !== 'UNASSIGNED') groupSet.add(groupId);

    const parsedDate = new Date(timestamp);
    let weekNumber = 1;
    if (!Number.isNaN(parsedDate.getTime()) && !Number.isNaN(startMonday.getTime())) {
      const diffDays = Math.floor((parsedDate.getTime() - startMonday.getTime()) / (1000 * 60 * 60 * 24));
      weekNumber = Math.max(1, Math.min(40, Math.floor(diffDays / 7) + 1));
    }
    weekSet.add(weekNumber);

    const isDoingSomething = doingStr === 'yes' || doingStr === 'true' || doingStr === 'y';
    let qualityStatus = 'genuine';
    let qualityScore = 8;
    let qualityReason = 'Specific technical progress and next-week plan recorded.';
    let suggestedChallengeQuestions = [
      `Can you demonstrate the working implementation of "${workDone.slice(0, 80)}" on your screen right now?`,
    ];

    if (!isDoingSomething) {
      qualityStatus = 'inactive_no';
      qualityScore = 2;
      qualityReason = `Student reported "No" work this week (${inactiveReason || 'no reason given'}).`;
      inactiveNoCount++;
      suggestedChallengeQuestions = [
        `You reported "No" progress in Week ${weekNumber} (${inactiveReason || 'no reason'}). What concrete task will you complete and demo by next week?`,
      ];
    } else if (workDone.length < 15 || /^(done|ok|yes|nothing|same|n\/a|nil|finish|finished|working)$/i.test(workDone)) {
      qualityStatus = 'vague_useless';
      qualityScore = 2;
      qualityReason = `Vague or one-word log ("${workDone}") without verifiable technical detail.`;
      vagueCount++;
      suggestedChallengeQuestions = [
        `[Challenge Vague Log] Your Week ${weekNumber} log only states "${workDone}". Please open your IDE/Git history and show the exact files you modified.`,
      ];
    } else {
      genuineCount++;
    }

    entries.push({
      timestamp,
      weekNumber,
      groupId,
      studentId: sid,
      email,
      studentName: nameBySid.get(sid) || rawName || sid,
      supervisor: supervisorByGroup.get(groupId)?.name || rawSup || '',
      isDoingSomething,
      workDone,
      unfinished,
      nextPlan,
      inactiveReason,
      qualityStatus,
      qualityScore,
      qualityReason,
      suggestedChallengeQuestions,
    });
  }

  const weeks = [...weekSet].sort((a, b) => a - b);
  const groupNames = [...groupSet].sort();

  return {
    entries,
    weeks,
    groupNames,
    summary: {
      totalEntries: entries.length,
      genuineCount,
      vagueCount,
      suspectedAiCount,
      inactiveNoCount,
    },
  };
}

function buildProfilesForFirestore(parsedLogData, hydratedGroups) {
  const entriesByEmail = new Map();
  for (const e of parsedLogData.entries) {
    if (!entriesByEmail.has(e.email)) {
      entriesByEmail.set(e.email, []);
    }
    entriesByEmail.get(e.email).push(e);
  }

  const allStudentsMap = new Map();
  for (const grp of hydratedGroups) {
    for (const m of grp.members) {
      allStudentsMap.set(m.email, {
        key: m.email,
        uid: m.uid,
        email: m.email,
        studentId: m.studentId,
        name: m.name,
        groupId: grp.id,
        groupName: grp.name,
        groupCode: grp.name,
        supervisorEmail: grp.supervisorEmail,
        supervisorName: grp.supervisorName,
      });
    }
  }

  for (const e of parsedLogData.entries) {
    if (!allStudentsMap.has(e.email)) {
      allStudentsMap.set(e.email, {
        key: e.email,
        uid: e.email,
        email: e.email,
        studentId: e.studentId,
        name: e.studentName,
        groupId: `grp_${e.groupId.toLowerCase()}`,
        groupName: e.groupId,
        groupCode: e.groupId,
        supervisorEmail: 'cywong@vtc.edu.hk',
        supervisorName: e.supervisor || 'Supervisor',
      });
    }
  }

  const activeWeeksCount = parsedLogData.weeks.length;
  const profiles = [];

  for (const [email, stu] of allStudentsMap.entries()) {
    const stuEntries = (entriesByEmail.get(email) || []).sort((a, b) => a.weekNumber - b.weekNumber);
    // Keep latest entry per week
    const latestByWeek = new Map();
    for (const e of stuEntries) {
      latestByWeek.set(e.weekNumber, e);
    }

    const weeklyTimeline = parsedLogData.weeks.map((wk) => {
      const logEntry = latestByWeek.get(wk) || null;
      return {
        weekNumber: wk,
        submitted: Boolean(logEntry),
        logEntry,
        logQualityStatus: logEntry ? logEntry.qualityStatus : 'missing',
        logQualityScore: logEntry ? logEntry.qualityScore : 0,
        challengeQuestions: logEntry ? logEntry.suggestedChallengeQuestions : [],
        attendanceStatus: 'no_meeting',
        meetingsCount: 0,
      };
    });

    const submittedLogs = [...latestByWeek.values()];
    const totalWeeksSubmitted = submittedLogs.length;
    const activeYesWeeks = submittedLogs.filter((l) => l.isDoingSomething).length;
    const inactiveNoWeeks = submittedLogs.filter((l) => !l.isDoingSomething).length;
    const genuineLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'genuine').length;
    const vagueLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'vague_useless').length;
    const suspectedAiLogsCount = submittedLogs.filter((l) => l.qualityStatus === 'suspected_ai_fake').length;
    const missingWeeksCount = Math.max(0, activeWeeksCount - totalWeeksSubmitted);
    const submissionRatePct =
      activeWeeksCount > 0 ? Math.round((totalWeeksSubmitted / activeWeeksCount) * 100) : 0;

    const avgLogQualityScore =
      totalWeeksSubmitted > 0
        ? Number(
            (
              submittedLogs.reduce((sum, l) => sum + (Number(l.qualityScore) || 0), 0) /
              totalWeeksSubmitted
            ).toFixed(1)
          )
        : 0;

    const logQualityGrade =
      avgLogQualityScore >= 8
        ? 'A (High-Quality Logs)'
        : avgLogQualityScore >= 6.5
        ? 'B (Good)'
        : avgLogQualityScore >= 5
        ? 'C (Needs Detail)'
        : totalWeeksSubmitted > 0
        ? 'D (Low / Vague Logs)'
        : 'N/A (No Logs Yet)';

    const riskFlags = [];
    if (vagueLogsCount > 0) riskFlags.push(`🔴 ${vagueLogsCount} Vague Log(s)`);
    if (inactiveNoWeeks >= 2) riskFlags.push(`⚪ ${inactiveNoWeeks} Inactive ("No") Weeks`);
    if (missingWeeksCount >= 2) riskFlags.push(`⚠️ ${missingWeeksCount} Missing Weeks`);

    profiles.push({
      ...stu,
      totalWeeksSubmitted,
      activeYesWeeks,
      inactiveNoWeeks,
      genuineLogsCount,
      vagueLogsCount,
      suspectedAiLogsCount,
      missingWeeksCount,
      submissionRatePct,
      avgLogQualityScore,
      logQualityGrade,
      meetingsHeld: 0,
      meetingsAttended: 0,
      meetingAttendancePct: null,
      verifiedTasksCount: 0,
      riskFlags,
      weeklyTimeline,
      ingestedWeeklyLogs: stuEntries,
    });
  }

  return profiles;
}

async function getOrCreateUserPreservingPassword(email, role, displayName) {
  try {
    const existing = await auth.getUserByEmail(email);
    const currentClaims = existing.customClaims || {};
    if (currentClaims.role !== role) {
      await auth.setCustomUserClaims(existing.uid, { ...currentClaims, role });
    }
    return existing;
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      const defaultPassword = process.env.DEFAULT_STUDENT_PASSWORD || 'IT114115';
      console.log(`✨ Creating new Auth user: ${email} (${role}) — ${displayName}`);
      const created = await auth.createUser({
        email,
        password: defaultPassword,
        emailVerified: true,
        displayName,
      });
      await auth.setCustomUserClaims(created.uid, { role });
      return created;
    }
    throw err;
  }
}

async function main() {
  console.log(`\n===================================================================`);
  console.log(`🚀 Provisioning Final Year Project Class in Project: ${projectId}`);
  console.log(`   Class ID: ${CLASS_ID}`);
  console.log(`   Schedule: 2026-09-01 to 2027-05-04 (Wed 08:30–12:30 HKT)`);
  console.log(`===================================================================\n`);

  // 1. Resolve Teachers
  const teacherMap = {};
  const teacherUidByEmail = {};
  const teacherEmails = [];
  for (const t of TEACHERS) {
    const email = t.email.toLowerCase();
    teacherEmails.push(email);
    const tUser = await getOrCreateUserPreservingPassword(email, 'teacher', t.displayName);
    teacherMap[tUser.uid] = email;
    teacherUidByEmail[email] = tUser.uid;
    console.log(`👨‍🏫 Teacher ready: ${t.displayName} <${email}> (UID: ${tUser.uid})`);
  }

  // 2. Resolve All 65 Students & Build Group Member Rosters
  const studentMap = {};
  const studentEmails = [];
  const studentProfilesMap = {};
  const studentAuthRecords = [];
  const hydratedGroups = [];

  for (const grp of FYP_GROUPS) {
    const hydratedMembers = [];
    for (const stu of grp.students) {
      const sid = String(stu.sid).trim();
      const email = `${sid}@stu.vtc.edu.hk`;
      const zhName = CHINESE_NAME_BY_SID[sid] || '';
      const fullDisplayName = zhName ? `${stu.name} (${zhName})` : stu.name;
      const programme = stu.classCode.startsWith('IT314115')
        ? 'HD in Cloud and Data Centre Administration (Earn & Learn IT314115)'
        : 'HD in Cloud and Data Centre Administration (IT114115)';

      const sUser = await getOrCreateUserPreservingPassword(email, 'student', fullDisplayName);
      studentMap[sUser.uid] = email;
      if (!studentEmails.includes(email)) {
        studentEmails.push(email);
      }

      studentProfilesMap[email] = {
        uid: sUser.uid,
        email,
        studentId: sid,
        studentName: fullDisplayName,
        nickname: zhName || stu.name,
        programme,
        studentClass: stu.classCode,
        projectGroup: grp.name,
      };

      studentAuthRecords.push({
        uid: sUser.uid,
        email,
        studentId: sid,
        studentName: fullDisplayName,
        nickname: zhName || stu.name,
        programme,
        studentClass: stu.classCode,
        projectGroup: grp.name,
      });

      hydratedMembers.push({
        uid: sUser.uid,
        email,
        studentId: sid,
        name: fullDisplayName,
        studentClass: stu.classCode,
        role: stu.role || 'Member',
      });
    }

    hydratedGroups.push({
      ...grp,
      supervisorUid: teacherUidByEmail[grp.supervisorEmail] || '',
      members: hydratedMembers,
    });
  }

  console.log(`\n✅ Resolved ${hydratedGroups.length} Project Groups and ${studentEmails.length} Students.`);

  // 3. Fetch & Parse Live Weekly Log Sheet (Form Responses 2) to Backfill Student Contribution Profiles
  // Start date 2026-09-01 (Tuesday) -> Week 1 Monday is 2026-08-31
  const semesterStartMonday = '2026-08-31';

  console.log(`\n📥 Fetching Weekly Log Sheet CSV from Form Responses 2...`);
  const csvRes = await fetch(WEEKLY_LOG_CSV_EXPORT_URL);
  if (!csvRes.ok) {
    throw new Error(`Failed to fetch Weekly Log CSV: HTTP ${csvRes.status}`);
  }
  const rawCsvText = await csvRes.text();

  const parsedLogData = parseFormResponses2Csv(rawCsvText, semesterStartMonday, hydratedGroups);
  const builtProfiles = buildProfilesForFirestore(parsedLogData, hydratedGroups);

  const lastEntryTimestamp =
    parsedLogData.entries.length > 0
      ? parsedLogData.entries[parsedLogData.entries.length - 1].timestamp || ''
      : '';
  const csvSignature = `${parsedLogData.entries.length}__${lastEntryTimestamp}`;

  console.log(
    `📊 Parsed ${parsedLogData.summary.totalEntries} Weekly Logs across Weeks [${parsedLogData.weeks.join(', ')}] for ${builtProfiles.length} Student Profiles.`
  );

  // 4. Write Class Document to Firestore
  const classPayload = {
    name: 'IT114115 / IT314115 Final Year Project (AY2026-27)',
    programme: 'HD in Cloud and Data Centre Administration (IT114115 Year 2 & IT314115 Year 2&3)',
    ownerEmail: 'cywong@vtc.edu.hk',
    teacherEmail: 'cywong@vtc.edu.hk',
    teacherEmails,
    studentEmails,
    teachers: teacherMap,
    students: studentMap,
    studentProfiles: studentProfilesMap,
    retentionDays: 180,
    videoRetentionDays: 365,
    storageQuota: 20 * 1024 * 1024 * 1024,
    aiQuota: 200,
    schedule: {
      startDate: '2026-09-01',
      endDate: '2027-05-04',
      timeZone: 'Asia/Hong_Kong',
      timeSlots: [{ startTime: '08:30', endTime: '12:30', days: ['Wed'] }],
    },
    ipRestrictions: [],
    automaticCapture: false,
    automaticCombine: false,
    isCapturing: false,
    frameRate: 15,
    imageQuality: 50,
    maxImageSize: 0.1 * 1024 * 1024,
    captureMode: 'dual',
    aiModel: 'gemini-3.5-flash-lite',
    requireFullScreenOnly: false,
    enableAudioInvigilation: false,
    projectGroupingSheetUrl: GROUPING_SHEET_URL,
    projectLogSheetUrl: WEEKLY_LOG_SHEET_URL,
    projectLogLastSyncedAt: new Date().toISOString(),
    projectLogSummary: {
      ...parsedLogData.summary,
      weeks: parsedLogData.weeks,
      groupCount: hydratedGroups.length,
      studentProfileCount: builtProfiles.length,
      lastEntryTimestamp,
      csvSignature,
    },
    updatedAt: FieldValue.serverTimestamp(),
  };

  await db.collection('classes').doc(CLASS_ID).set(classPayload, { merge: true });
  console.log(`✅ Saved Class Document: classes/${CLASS_ID}`);

  // 5. Link Class to teacherProfiles & studentProfiles
  const profileBatch = db.batch();
  for (const tUid of Object.keys(teacherMap)) {
    profileBatch.set(
      db.collection('teacherProfiles').doc(tUid),
      {
        classes: FieldValue.arrayUnion(CLASS_ID),
        email: teacherMap[tUid],
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  for (const s of studentAuthRecords) {
    profileBatch.set(
      db.collection('studentProfiles').doc(s.uid),
      {
        classes: FieldValue.arrayUnion(CLASS_ID),
        email: s.email,
        studentId: s.studentId,
        studentName: s.studentName,
        nickname: s.nickname,
        programme: s.programme,
        studentClass: s.studentClass,
        projectGroup: s.projectGroup,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await profileBatch.commit();
  console.log(`✅ Linked ${Object.keys(teacherMap).length} teachers and ${studentAuthRecords.length} students to ${CLASS_ID}.`);

  // 6. Write 17 Project Groups into classes/{CLASS_ID}/projectGroups/{groupId}
  const groupsBatch = db.batch();
  for (const grp of hydratedGroups) {
    groupsBatch.set(
      db.collection(`classes/${CLASS_ID}/projectGroups`).doc(grp.id),
      {
        name: grp.name,
        cohort: grp.cohort,
        projectTopic: grp.projectTopic,
        supervisorEmail: grp.supervisorEmail,
        supervisorName: grp.supervisorName,
        supervisorUid: grp.supervisorUid,
        coSupervisorEmails: [
          ...new Set([
            ...(grp.coSupervisorEmails || []),
            ...(isDevProject
              ? ['teacher1@vtc.edu.hk', 'teacher2@vtc.edu.hk', 'teacher3@vtc.edu.hk']
              : []),
          ]),
        ],
        assessorEmail: grp.assessorEmail || 'cywong@vtc.edu.hk',
        assessorName: grp.assessorName || 'Cyrus Wong',
        members: grp.members,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }
  await groupsBatch.commit();
  console.log(`✅ Created ${hydratedGroups.length} Project Groups in classes/${CLASS_ID}/projectGroups.`);

  // 7. Write Backfilled Student Contribution Profiles into classes/{CLASS_ID}/projectStudentProfiles/{email}
  const studentProfilesBatch = db.batch();
  let backfilledCount = 0;
  for (const prof of builtProfiles) {
    studentProfilesBatch.set(
      db.collection(`classes/${CLASS_ID}/projectStudentProfiles`).doc(prof.email),
      {
        ...prof,
        lastSyncedAt: new Date().toISOString(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    backfilledCount++;
  }
  await studentProfilesBatch.commit();
  console.log(
    `✅ Backfilled ${backfilledCount} Student Contribution Profiles in classes/${CLASS_ID}/projectStudentProfiles.\n`
  );
}

main()
  .then(() => {
    console.log('🎉 Final Year Project Class provisioning in Production complete!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Error provisioning FYP Class:', err);
    process.exit(1);
  });
