import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExportToExcel = vi.fn().mockResolvedValue(true);
const mockReadExcelFile = vi.fn();

vi.mock('./exportUtils', () => ({
  exportToExcel: (...args) => mockExportToExcel(...args),
  readExcelFile: (...args) => mockReadExcelFile(...args),
}));

import {
  splitDelimitedRow,
  clusterRowsIntoProjectGroups,
  parseProjectGroupsText,
  parseProjectGroupsFile,
  downloadProjectGroupTemplateExcel,
  exportProjectGroupsExcel,
  autoSplitStudentsIntoGroups,
  exportProjectMeetingsMatrixExcel,
  generateMeetingMarkdownMinutes,
  buildGoogleSheetCsvExportUrl,
  parseCsvGrid,
  evaluateWeeklyLogQuality,
  extractVtcStudentId,
  toVtcStudentEmail,
  resolveSemesterStartMondayFromClass,
  formatWeekDateRange,
  parseProjectWeeklyLogCsv,
  rehydrateWeeklyLogDataFromPersistedProfiles,
  buildStudentContributionProfiles,
  bootstrapProjectGroupsFromWeeklyLogs,
  mergeIncrementalStudentProfiles,
  exportStudentContributionProfilesExcel,
} from './projectGroupUtils';

describe('projectGroupUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits delimited CSV/TSV rows respecting escaped double quotes', () => {
    expect(splitDelimitedRow('Group 1,"Topic ""A""",alice@stu.vtc.edu.hk', ',')).toEqual([
      'Group 1',
      'Topic "A"',
      'alice@stu.vtc.edu.hk',
    ]);
    expect(splitDelimitedRow('G1\tTopic B\tbob@stu.vtc.edu.hk', '\t')).toEqual([
      'G1',
      'Topic B',
      'bob@stu.vtc.edu.hk',
    ]);
  });

  it('clusters rows with and without headers, fallback email scanning, and invalid rows', () => {
    expect(clusterRowsIntoProjectGroups([])).toEqual({
      groups: [],
      totalStudents: 0,
      invalidRows: [],
    });

    // Without headers + fallback email detection with 2 emails on a row (supervisor + student)
    const noHeaderRes = clusterRowsIntoProjectGroups([
      ['# comment row'],
      ['', 'AI Vision', 'sup@vtc.edu.hk', 'no-at-symbol', 'Alice', 'Leader', 'alice@stu.vtc.edu.hk'],
      ['Group 1', 'AI Vision', '', 'invalid_email_row', 'No Email', 'Member'],
      ['Group 2', '', '', 'onlyone@stu.vtc.edu.hk', 'Only One', 'Member'],
    ]);
    expect(noHeaderRes.groups).toHaveLength(2);
    expect(noHeaderRes.groups[0].name).toBe('Group 1');
    expect(noHeaderRes.groups[0].supervisorEmail).toBe('sup@vtc.edu.hk');
    expect(noHeaderRes.groups[0].members[0].role).toBe('Leader');
    expect(noHeaderRes.invalidRows).toHaveLength(1);
  });

  it('parses text and files (.csv and .xlsx) into project groups', async () => {
    expect(parseProjectGroupsText('')).toEqual({ groups: [], totalStudents: 0, invalidRows: [] });
    expect(parseProjectGroupsText('# only comment\n   ')).toEqual({
      groups: [],
      totalStudents: 0,
      invalidRows: [],
    });

    const tsvText =
      'Group\tTopic\tSupervisor\tStudentEmail\tStudentName\tRole\nG1\tIoT\tt@vtc.edu.hk\ts1@stu.vtc.edu.hk\tStu 1\tLeader';
    const parsedTsv = parseProjectGroupsText(tsvText);
    expect(parsedTsv.groups).toHaveLength(1);
    expect(parsedTsv.totalStudents).toBe(1);

    const csvFile = {
      name: 'groups.csv',
      text: vi.fn().mockResolvedValue('Group,Email\nG1,s1@stu.vtc.edu.hk'),
    };
    const resCsv = await parseProjectGroupsFile(csvFile);
    expect(resCsv.groups).toHaveLength(1);

    mockReadExcelFile.mockResolvedValueOnce([
      ['GroupName', 'StudentEmail'],
      ['G2', 's2@stu.vtc.edu.hk'],
    ]);
    const xlsxFile = { name: 'groups.xlsx' };
    const resXlsx = await parseProjectGroupsFile(xlsxFile);
    expect(resXlsx.groups).toHaveLength(1);
    expect(resXlsx.groups[0].name).toBe('G2');
  });

  it('exports templates, group rosters, and meeting matrices to Excel', async () => {
    // 1. Template with enrolled students & existing groups
    await downloadProjectGroupTemplateExcel({
      classId: 'c1',
      enrolledStudents: [{ email: 's1@stu.vtc.edu.hk', name: 'Stu 1' }, 's2@stu.vtc.edu.hk'],
      existingGroups: [
        {
          name: 'Group A',
          projectTopic: 'Topic A',
          supervisorEmail: 'sup@vtc.edu.hk',
          members: [{ email: 's1@stu.vtc.edu.hk', name: 'Stu 1', role: 'Leader' }],
        },
      ],
      defaultSupervisorEmail: 'def@vtc.edu.hk',
    });
    expect(mockExportToExcel).toHaveBeenCalledTimes(1);

    // 2. Template with empty enrolledStudents (default sample rows)
    await downloadProjectGroupTemplateExcel({ classId: 'c1', enrolledStudents: [] });
    expect(mockExportToExcel).toHaveBeenCalledTimes(2);

    // 3. Export Project Groups Roster (with empty group and populated group)
    await exportProjectGroupsExcel({
      classId: 'c1',
      groups: [
        { name: 'Empty Group', members: [] },
        {
          name: 'Populated Group',
          projectTopic: 'AI',
          supervisorEmail: 't@vtc.edu.hk',
          supervisorName: 'Dr. T',
          members: [{ email: 's1@stu.vtc.edu.hk', name: 'Stu 1', role: 'Leader' }],
        },
      ],
    });
    expect(mockExportToExcel).toHaveBeenCalledTimes(3);

    // 4. Auto-split students into groups
    const split = autoSplitStudentsIntoGroups({
      unassignedStudents: [
        { uid: 'u1', email: 's1@stu.vtc.edu.hk', name: 'S1' },
        { uid: 'u2', email: 's2@stu.vtc.edu.hk', name: 'S2' },
        { uid: 'u3', email: 's3@stu.vtc.edu.hk', name: 'S3' },
      ],
      existingGroupsCount: 1,
      groupSize: 2,
      supervisorEmail: 'sup@vtc.edu.hk',
      supervisorName: 'Sup',
    });
    expect(split).toHaveLength(2);
    expect(split[0].name).toBe('Group 2');
    expect(split[0].members).toHaveLength(2);

    // 5. Export Project Meetings Matrix (including multi-supervisor same-week meetings)
    await exportProjectMeetingsMatrixExcel({
      classId: 'c1',
      groups: [
        {
          id: 'g1',
          name: 'G1',
          projectTopic: 'Topic',
          supervisorEmail: 'sup@vtc.edu.hk',
          members: [{ uid: 'u1', email: 's1@stu.vtc.edu.hk', name: 'S1', role: 'Leader' }],
        },
      ],
      meetings: [
        {
          groupId: 'g1',
          weekNumber: 1,
          supervisorName: 'Dr. Main',
          attendanceRecord: [{ uid: 'u1', email: 's1@stu.vtc.edu.hk', status: 'present' }],
          studentContributions: [
            {
              uid: 'u1',
              email: 's1@stu.vtc.edu.hk',
              workCompleted: ['Task 1'],
              actionItemsNextWeek: ['Next 1'],
            },
          ],
        },
        {
          groupId: 'g1',
          weekNumber: 1,
          supervisorName: 'Mr. CoSup',
          attendanceRecord: [{ uid: 'u1', email: 's1@stu.vtc.edu.hk', status: 'late' }],
          studentContributions: [{ uid: 'u1', email: 's1@stu.vtc.edu.hk', workCompleted: [] }],
        },
        {
          groupId: 'other',
          weekNumber: 2,
        },
      ],
    });
    expect(mockExportToExcel).toHaveBeenCalledTimes(4);
  });

  it('generates full Markdown meeting minutes with insights, scores, and challenge questions', () => {
    const md = generateMeetingMarkdownMinutes({
      groupName: 'Group A11',
      weekNumber: 4,
      title: 'Week 4 Review',
      meetingDate: '2026-10-01T10:00:00Z',
      supervisorName: 'Dr. Wong',
      supervisorEmail: 'cywong@vtc.edu.hk',
      attendanceRecord: [
        {
          name: 'Alice',
          email: 'alice@stu.vtc.edu.hk',
          status: 'present',
          speakingContribution: 'high',
          evidence: '[00:20] Demoed',
        },
      ],
      keyInsights: {
        overallGroupProgress: 'ahead',
        executiveSummary: 'Great progress.',
        keyDecisions: ['Use Firestore'],
        blockersAndRisks: ['None'],
        supervisorFeedback: ['Add tests'],
        weeklyGroupFeedback: 'Keep up the good work.',
      },
      studentContributions: [
        {
          name: 'Alice',
          email: 'alice@stu.vtc.edu.hk',
          logQualityScore: 9,
          logQualityAssessment: 'genuine_verified',
          realWorkScore: 9,
          workCompleted: ['Built API'],
          currentChallenges: ['CORS'],
          actionItemsNextWeek: ['Deploy'],
          aiContributionAssessment: 'Strong.',
          challengeQuestions: ['How is auth handled?'],
          weeklyFeedback: 'Well done.',
        },
      ],
    });
    expect(md).toContain('# 📋 Group A11 — Week 4: Week 4 Review');
    expect(md).toContain('Keep up the good work.');
    expect(md).toContain('Log Quality Score**: 9/10');
    expect(md).toContain('How is auth handled?');

    // Empty fallback branches
    const emptyMd = generateMeetingMarkdownMinutes({});
    expect(emptyMd).toContain('- None recorded');
  });

  it('converts Google Sheet URLs, parses CSV grids, and evaluates weekly log quality', () => {
    expect(buildGoogleSheetCsvExportUrl('')).toBe('');
    expect(buildGoogleSheetCsvExportUrl('https://example.com/data.csv')).toBe('https://example.com/data.csv');
    expect(buildGoogleSheetCsvExportUrl('https://example.com/custom')).toBe('https://example.com/custom');
    expect(
      buildGoogleSheetCsvExportUrl(
        'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit?gid=1412264552#gid=1412264552'
      )
    ).toBe('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/export?format=csv&gid=1412264552');

    expect(parseCsvGrid('')).toEqual([]);
    const grid = parseCsvGrid('\uFEFF"Col 1","Col ""2"""\r\n"Line 1\nLine 2",Val2\r\n');
    expect(grid).toHaveLength(2);
    expect(grid[0][1]).toBe('Col "2"');
    expect(grid[1][0]).toBe('Line 1\nLine 2');

    // 1. Inactive log
    const inactiveEval = evaluateWeeklyLogQuality(
      { isDoingSomething: false, inactiveReason: 'Sick leave' },
      [{ weekNumber: 1, isDoingSomething: true, nextPlan: 'Build DB' }]
    );
    expect(inactiveEval.qualityStatus).toBe('inactive');
    expect(inactiveEval.qualityScore).toBe(2);

    // 2. Duplicate copy-pasted log
    const dupEval = evaluateWeeklyLogQuality(
      {
        isDoingSomething: true,
        workDone: 'Designed the PostgreSQL database schema for user accounts',
        nextPlan: 'Write unit tests for login endpoints',
      },
      [
        {
          weekNumber: 1,
          isDoingSomething: true,
          workDone: 'Designed the PostgreSQL database schema for user accounts',
          nextPlan: 'Write unit tests',
        },
      ]
    );
    expect(dupEval.qualityStatus).toBe('vague_useless');
    expect(dupEval.qualityReason).toContain('Copied identical');

    // 3. Vague work vs vague plan
    const vaguePlanOnly = evaluateWeeklyLogQuality({
      isDoingSomething: true,
      workDone: 'Implemented the login form validation and tested error states on mobile',
      nextPlan: 'thinking',
    });
    expect(vaguePlanOnly.qualityStatus).toBe('vague_useless');
    expect(vaguePlanOnly.qualityReason).toContain('Plan of work');

    // 4. Genuine high-quality log with unfinished item
    const genuineEval = evaluateWeeklyLogQuality({
      isDoingSomething: true,
      workDone:
        'Designed the Firestore schema and fixed the token refresh bug in the API route after testing on Android',
      unfinished: 'OAuth callback error page',
      nextPlan: 'Complete the OAuth callback error page and write integration tests',
    });
    expect(genuineEval.qualityStatus).toBe('genuine');
    expect(genuineEval.qualityScore).toBeGreaterThanOrEqual(8);
  });

  it('normalizes VTC student emails/IDs and resolves semester start Mondays', () => {
    expect(extractVtcStudentId('')).toBe('');
    expect(extractVtcStudentId('250105348@stu.vtc.edu.hk')).toBe('250105348');
    expect(extractVtcStudentId('alice@gmail.com')).toBe('alice');

    expect(toVtcStudentEmail('250105348')).toBe('250105348@stu.vtc.edu.hk');
    expect(toVtcStudentEmail('250105348@vtc.edu.hk')).toBe('250105348@stu.vtc.edu.hk');
    expect(toVtcStudentEmail('teacher@vtc.edu.hk')).toBe('teacher@vtc.edu.hk');
    expect(toVtcStudentEmail('', 'Chan Tai Man')).toBe('chantaiman@stu.vtc.edu.hk');

    expect(
      resolveSemesterStartMondayFromClass({
        schedule: { startDate: '2026-09-09' }, // Wednesday -> snaps to 2026-09-07
        scheduleHistory: [{ startDate: '2026-09-02' }], // Wednesday -> snaps to 2026-08-31
        projectLogSemesterStartMonday: '2026-09-07',
      })
    ).toBe('2026-08-31');

    expect(formatWeekDateRange(1, 'invalid-date')).toBe('');
    expect(formatWeekDateRange(2, '2026-09-07')).toContain('Sep 14');
  });

  it('rehydrates persisted profiles, merges incremental profiles, bootstraps groups, and exports profiles Excel', async () => {
    expect(parseProjectWeeklyLogCsv('only_header_row').entries).toEqual([]);

    const csv = [
      'Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done,Unfinished,Plan,Description',
      '9/14/2026 10:00:00,A01,Chan Tai Man,250105348,Cyrus Wong,Yes,Built the Firestore database schema and tested login API routes,No,Build dashboard UI and connect charts,',
      '9/14/2026 11:00:00,A01,Chan Tai Man,250105348,Cyrus Wong,Yes,Built the Firestore database schema and tested login API routes v2,No,Build dashboard UI and connect charts,',
      '9/21/2026 10:00:00,A02,Chan Tai Man,20105348,Cyrus Wong,No,,,,Exam week',
    ].join('\n');

    const parsed = parseProjectWeeklyLogCsv(csv, {
      enrolledStudents: [{ uid: 'uid_chan', email: '250105348@stu.vtc.edu.hk', name: 'Chan Tai Man' }],
      existingGroups: [
        {
          id: 'grp_a01',
          name: 'Group A01',
          projectTopic: 'Smart Campus',
          supervisorName: 'Cyrus Wong',
          supervisorEmail: 'cywong@vtc.edu.hk',
          members: [{ uid: 'uid_chan', email: '250105348@stu.vtc.edu.hk', name: 'Chan Tai Man', role: 'Leader' }],
        },
      ],
      semesterStartMonday: '2026-09-07',
    });

    expect(parsed.entries).toHaveLength(3);
    expect(parsed.entries[2].studentId).toBe('250105348'); // healed 8-digit typo
    expect(parsed.entries[2].hadIdTypo).toBe(true);
    expect(parsed.entries[2].groupDriftNote).toContain('A01');

    // Bootstrap groups
    const bootstrapped = bootstrapProjectGroupsFromWeeklyLogs({
      logData: parsed,
      existingGroups: [],
      enrolledStudents: [{ uid: 'uid_chan', email: '250105348@stu.vtc.edu.hk' }],
      classTeachers: ['cywong@vtc.edu.hk'],
      currentUserEmail: 'cywong@vtc.edu.hk',
      currentUserName: 'Cyrus Wong',
    });
    expect(bootstrapped).toHaveLength(1);
    expect(bootstrapped[0].name).toBe('GROUP A01');
    expect(bootstrapped[0].members[0].uid).toBe('uid_chan');

    // Build student contribution profiles
    const profiles = buildStudentContributionProfiles({
      logData: parsed,
      groups: bootstrapped,
      meetings: [
        {
          id: 'm1',
          groupId: bootstrapped[0].id,
          groupName: 'A01',
          weekNumber: 2,
          supervisorName: 'Cyrus Wong',
          attendanceRecord: [{ email: '250105348@stu.vtc.edu.hk', status: 'present', speakingContribution: 'high' }],
          studentContributions: [
            {
              email: '250105348@stu.vtc.edu.hk',
              workCompleted: ['Schema v2'],
              actionItemsNextWeek: ['Charts'],
              logQualityAssessment: 'genuine_verified',
              logQualityScore: 9,
              realWorkScore: 9,
              weeklyFeedback: 'Great job.',
              challengeQuestions: ['How does index scale?'],
            },
          ],
        },
      ],
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].hadIdTypo).toBe(true);
    expect(profiles[0].riskFlags.some((f) => f.includes('Healed Student ID Typo'))).toBe(true);

    // Rehydrate from persisted profiles
    const rehydrated = rehydrateWeeklyLogDataFromPersistedProfiles(profiles);
    expect(rehydrated.entries).toHaveLength(3);
    expect(rehydrated.weeks).toEqual([2, 3]);

    // Incremental merge: initial backfill vs unchanged vs new log added
    const initialMerge = mergeIncrementalStudentProfiles({
      incomingProfiles: profiles,
      existingProfiles: [],
    });
    expect(initialMerge.isInitialBackfill).toBe(true);
    expect(initialMerge.deltaProfiles).toHaveLength(1);

    const secondMergeUnchanged = mergeIncrementalStudentProfiles({
      incomingProfiles: profiles,
      existingProfiles: profiles,
    });
    expect(secondMergeUnchanged.isInitialBackfill).toBe(false);
    expect(secondMergeUnchanged.deltaProfiles).toHaveLength(0);
    expect(secondMergeUnchanged.unchangedProfilesCount).toBe(1);

    const updatedProfile = {
      ...profiles[0],
      meetingsAttended: 2,
      ingestedWeeklyLogs: [
        ...profiles[0].ingestedWeeklyLogs,
        { weekNumber: 4, timestamp: '9/28/2026 10:00:00', workDone: 'New week work', isDoingSomething: true },
      ],
    };
    const thirdMergeDelta = mergeIncrementalStudentProfiles({
      incomingProfiles: [updatedProfile],
      existingProfiles: profiles,
    });
    expect(thirdMergeDelta.deltaProfiles).toHaveLength(1);
    expect(thirdMergeDelta.newLogEntriesCount).toBe(1);

    // Export profiles to Excel
    await exportStudentContributionProfilesExcel({
      classId: 'it114115',
      profiles,
    });
    expect(mockExportToExcel).toHaveBeenCalled();
  });
});
