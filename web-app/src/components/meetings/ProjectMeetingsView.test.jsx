import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUpdateDoc = vi.fn().mockResolvedValue(true);
const mockSetDoc = vi.fn().mockResolvedValue(true);
const mockDeleteDoc = vi.fn().mockResolvedValue(true);
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(true);
const mockHttpsCallable = vi.fn();

let mockGroupsSnapshotDocs = [];
let mockMeetingsSnapshotDocs = [];
let mockProfilesSnapshotDocs = [];

vi.mock('../../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db, path) => ({ path }),
  doc: (_db, path) => ({ path }),
  onSnapshot: (target, callback) => {
    const path = target?.path || '';
    if (path.includes('projectGroups')) {
      callback({ docs: mockGroupsSnapshotDocs });
    } else if (path.includes('projectMeetings')) {
      callback({ docs: mockMeetingsSnapshotDocs });
    } else if (path.includes('projectStudentProfiles')) {
      callback({ docs: mockProfilesSnapshotDocs });
    } else if (path.includes('activeMeetingCaptures')) {
      callback({
        exists: () => true,
        data: () => ({
          studentName: 'Alice Chan',
          studentPcState: 'recording_screen',
        }),
      });
    }
    return () => {};
  },
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  writeBatch: () => ({
    set: (...args) => mockBatchSet(...args),
    delete: (...args) => mockBatchDelete(...args),
    commit: () => mockBatchCommit(),
  }),
  serverTimestamp: () => 'MOCK_TS',
  arrayUnion: (val) => val,
}));

vi.mock('firebase/storage', () => ({
  ref: (_s, path) => ({ path }),
  uploadBytesResumable: () => ({
    on: (_evt, _prog, _err, complete) => complete(),
  }),
  getDownloadURL: () => Promise.resolve('https://storage.example.com/voice.webm'),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockHttpsCallable,
}));

import {
  parseProjectGroupsText,
  autoSplitStudentsIntoGroups,
  generateMeetingMarkdownMinutes,
  buildGoogleSheetCsvExportUrl,
  parseProjectWeeklyLogCsv,
  resolveSemesterStartMondayFromClass,
  formatWeekDateRange,
  rehydrateWeeklyLogDataFromPersistedProfiles,
  buildStudentContributionProfiles,
  mergeIncrementalStudentProfiles,
  bootstrapProjectGroupsFromWeeklyLogs,
} from '../../utils/projectGroupUtils';
import ProjectMeetingsView from './ProjectMeetingsView';

const SAMPLE_FORM_RESPONSES_2_CSV = `Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done & findings since last recording,State which part of the last plan not yet finished (leave it blank if you finished all the work of the last plan,Plan of work before the next recording,Description
10/15/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,done,,do website,
10/22/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,done,,do website,
10/29/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,"Completed frontend and backend integration using Flask. Implemented real-time dashboards, history pages, mock AI chatbot, and basic role-based access control (Doctor/Patient).",,Deploy to cloud,
10/15/2026 11:00:00,A09,Leung Chun Ho Jason,250231955,Elka Leung,Yes,Designed ER diagram and normalized 6 tables for booking module,Payment table pending,Implement SQL migrations and seed script,
10/22/2026 11:00:00,A09,Leung Chun Ho Jason,20231955,Elka Leung,No,,,,sick`;

describe('projectGroupUtils & ProjectMeetingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupsSnapshotDocs = [
      {
        id: 'grp_1',
        data: () => ({
          name: 'Group 1 - AI Smart Inventory',
          projectTopic: 'Edge Vision Tracker',
          supervisorEmail: 'cywong@vtc.edu.hk',
          supervisorName: 'Dr. Wong',
          members: [
            { uid: 'stu_1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan', role: 'Leader' },
            { uid: 'stu_2', email: 'bob@stu.vtc.edu.hk', name: 'Bob Lee', role: 'Member' },
          ],
        }),
      },
      {
        id: 'grp_2',
        data: () => ({
          name: 'Group 2 - Cloud FinOps',
          projectTopic: 'Serverless Cost Monitor',
          supervisorEmail: 'other@vtc.edu.hk',
          supervisorName: 'Ir. Chan',
          members: [
            { uid: 'stu_3', email: 'charlie@stu.vtc.edu.hk', name: 'Charlie Wong', role: 'Leader' },
          ],
        }),
      },
    ];

    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_1_wk5',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group 1 - AI Smart Inventory',
          weekNumber: 5,
          title: 'Week 5 Prototype Demo',
          meetingDate: '2026-10-29T10:15:00.000Z',
          supervisorEmail: 'cywong@vtc.edu.hk',
          durationSeconds: 820,
          status: 'ready',
          aiModelUsed: 'gemini-3.5-transcribe-preview + gemini-3.8-flash',
          aiCost: 0.0042,
          audioClips: [
            {
              clipId: 'c1',
              label: 'Part 1 (Alice Chan)',
              storagePath: 'projectMeetings/it114115/grp_1/mtg_1_wk5/voice_1.webm',
              downloadUrl: 'https://storage.example.com/voice_1.webm',
              durationSeconds: 500,
            },
            {
              clipId: 'c2',
              label: 'Part 2 (Bob Lee)',
              storagePath: 'projectMeetings/it114115/grp_1/mtg_1_wk5/voice_2.webm',
              downloadUrl: 'https://storage.example.com/voice_2.webm',
              durationSeconds: 320,
            },
          ],
          screenClips: [
            {
              clipId: 'sc1',
              label: "Alice Chan's PC Screen",
              studentUid: 'stu_1',
              studentName: 'Alice Chan',
              downloadUrl: 'https://storage.example.com/screen_1.webm',
            },
          ],
          attendanceRecord: [
            {
              uid: 'stu_1',
              email: 'alice@stu.vtc.edu.hk',
              name: 'Alice Chan',
              status: 'present',
              speakingContribution: 'high',
              evidence: '[00:35] Demonstrated UI.',
              firstHeardTimestamp: '00:35',
            },
            {
              uid: 'stu_2',
              email: 'bob@stu.vtc.edu.hk',
              name: 'Bob Lee',
              status: 'absent',
              speakingContribution: 'none',
              evidence: 'No spoken turn.',
              firstHeardTimestamp: '',
            },
          ],
          keyInsights: {
            executiveSummary: 'Group 1 completed the frontend prototype and Firestore rules.',
            overallGroupProgress: 'on_track',
            keyDecisions: ['Use dual-device mobile voice + PC screen sync'],
            blockersAndRisks: ['Need more test data'],
            supervisorFeedback: ['Add unit tests before Week 6'],
          },
          studentContributions: [
            {
              uid: 'stu_1',
              email: 'alice@stu.vtc.edu.hk',
              name: 'Alice Chan',
              workCompleted: ['Built ProjectMeetingsView UI'],
              currentChallenges: [],
              actionItemsNextWeek: ['Write unit tests'],
              aiContributionAssessment: 'Strong technical ownership.',
              timestamps: ['00:35', '03:10'],
            },
            {
              uid: 'stu_2',
              email: 'bob@stu.vtc.edu.hk',
              name: 'Bob Lee',
              workCompleted: [],
              currentChallenges: [],
              actionItemsNextWeek: ['Complete API endpoint'],
              aiContributionAssessment: 'Absent this week.',
              timestamps: [],
            },
          ],
          transcriptSegments: [
            { startTime: '00:35', endTime: '01:20', speaker: 'Alice Chan', text: 'Here is our Week 5 prototype.' },
          ],
        }),
      },
    ];
  });

  it('parses CSV/pasted group rows and clusters students by GroupName', () => {
    const csv = `GroupName,ProjectTopic,SupervisorEmail,StudentEmail,StudentName,Role
Group 1,AI Smart Inventory,cywong@vtc.edu.hk,alice@stu.vtc.edu.hk,Alice Chan,Leader
Group 1,AI Smart Inventory,cywong@vtc.edu.hk,bob@stu.vtc.edu.hk,Bob Lee,Member
Group 2,Cloud FinOps,other@vtc.edu.hk,charlie@stu.vtc.edu.hk,Charlie Wong,Leader`;

    const parsed = parseProjectGroupsText(csv);
    expect(parsed.groups).toHaveLength(2);
    expect(parsed.totalStudents).toHaveLength === undefined;
    expect(parsed.totalStudents).toBe(3);
    expect(parsed.groups[0].name).toBe('Group 1');
    expect(parsed.groups[0].members).toHaveLength(2);
    expect(parsed.groups[0].members[0].role).toBe('Leader');
    expect(parsed.groups[1].supervisorEmail).toBe('other@vtc.edu.hk');
  });

  it('auto-splits unassigned students into sequential groups of N', () => {
    const unassigned = [
      { uid: 's1', email: 's1@stu.vtc.edu.hk', name: 'S1' },
      { uid: 's2', email: 's2@stu.vtc.edu.hk', name: 'S2' },
      { uid: 's3', email: 's3@stu.vtc.edu.hk', name: 'S3' },
    ];
    const groups = autoSplitStudentsIntoGroups({
      unassignedStudents: unassigned,
      existingGroupsCount: 2,
      groupSize: 2,
      supervisorEmail: 'cywong@vtc.edu.hk',
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('Group 3');
    expect(groups[0].members).toHaveLength(2);
    expect(groups[1].name).toBe('Group 4');
    expect(groups[1].members).toHaveLength(1);
  });

  it('generates Markdown meeting minutes with attendance, insights, and per-student work', () => {
    const md = generateMeetingMarkdownMinutes(mockMeetingsSnapshotDocs[0].data());
    expect(md).toContain('Group 1 - AI Smart Inventory — Week 5');
    expect(md).toContain('Alice Chan');
    expect(md).toContain('Built ProjectMeetingsView UI');
  });

  it('converts Google Sheet URLs to CSV export URLs and audits Form Responses 2 weekly logs (vague vs suspected AI vs genuine + ID typo healing)', () => {
    const exportUrl = buildGoogleSheetCsvExportUrl(
      'https://docs.google.com/spreadsheets/d/1mKWVAkdM0RedTQ2wjk1GMmh6bxNQ6S-A4YP-85s77Ps/edit?gid=1601202239#gid=1601202239'
    );
    expect(exportUrl).toBe(
      'https://docs.google.com/spreadsheets/d/1mKWVAkdM0RedTQ2wjk1GMmh6bxNQ6S-A4YP-85s77Ps/export?format=csv&gid=1601202239'
    );

    const parsed = parseProjectWeeklyLogCsv(SAMPLE_FORM_RESPONSES_2_CSV);
    expect(parsed.entries).toHaveLength(5);
    expect(parsed.summary.vagueCount).toBe(2);
    expect(parsed.summary.suspectedAiCount).toBe(1);
    expect(parsed.summary.genuineCount).toBe(1);
    expect(parsed.summary.inactiveNoCount).toBe(1);

    // Check that 250105348's Week 8 sudden buzzword leap after weeks of "done" is flagged as suspected_ai_fake
    const stuA11Logs = parsed.entries.filter((e) => e.studentId === '250105348');
    expect(stuA11Logs).toHaveLength(3);
    expect(stuA11Logs[0].qualityStatus).toBe('vague_useless');
    expect(stuA11Logs[2].qualityStatus).toBe('suspected_ai_fake');
    expect(stuA11Logs[2].suggestedChallengeQuestions[0]).toContain('Challenge Fake/AI Log');

    // Check that 1-digit Student ID typo (20231955 -> 250231955) for Leung Chun Ho Jason is healed automatically
    const jasonLogs = parsed.entries.filter((e) => e.studentName === 'Leung Chun Ho Jason');
    expect(jasonLogs).toHaveLength(2);
    expect(jasonLogs[1].studentId).toBe('250231955');
    expect(jasonLogs[1].hadIdTypo).toBe(true);

    // Build longitudinal Individual Student Contribution Profiles (even with 0 weekly meetings!)
    const profiles = buildStudentContributionProfiles({ logData: parsed, groups: [], meetings: [] });
    expect(profiles).toHaveLength(2);
    const chanProfile = profiles.find((p) => p.studentId === '250105348');
    expect(chanProfile.vagueLogsCount).toBe(2);
    expect(chanProfile.suspectedAiLogsCount).toBe(1);
    expect(chanProfile.logQualityGrade).toContain('D');
    expect(chanProfile.ingestedWeeklyLogs).toHaveLength(3);

    // Rehydrate Weekly Log Data directly from persisted Firestore profiles (0 meetings, no live CSV needed)
    const rehydrated = rehydrateWeeklyLogDataFromPersistedProfiles(profiles);
    expect(rehydrated.entries).toHaveLength(5);
    expect(rehydrated.summary.suspectedAiCount).toBe(1);
    expect(rehydrated.summary.vagueCount).toBe(2);
    expect(rehydrated.groupNames).toEqual(['A09', 'A11']);

    // Verify 1st run is Full Backfill (deltaProfiles = 2), 2nd identical run is 0 delta writes
    const firstBackfill = mergeIncrementalStudentProfiles({
      incomingProfiles: profiles,
      existingProfiles: [],
    });
    expect(firstBackfill.isInitialBackfill).toBe(true);
    expect(firstBackfill.deltaProfiles).toHaveLength(2);
    expect(firstBackfill.newLogEntriesCount).toBe(5);

    const secondNoChange = mergeIncrementalStudentProfiles({
      incomingProfiles: profiles,
      existingProfiles: profiles,
    });
    expect(secondNoChange.isInitialBackfill).toBe(false);
    expect(secondNoChange.deltaProfiles).toHaveLength(0);
    expect(secondNoChange.unchangedProfilesCount).toBe(2);
    expect(secondNoChange.newLogEntriesCount).toBe(0);

    // Bootstrap Project Groups directly from Weekly Log Sheet
    const syncedGroups = bootstrapProjectGroupsFromWeeklyLogs({ logData: parsed, existingGroups: [] });
    expect(syncedGroups).toHaveLength(2);
    expect(syncedGroups.map((g) => g.name)).toEqual(['A09', 'A11']);
  });

  it('defines weeks from Class Schedule startDate, skips holiday weeks without penalty, and aggregates multiple co-supervisor meetings in the same week', () => {
    // 1. Class schedule startDate on Wednesday 2026-09-09 snaps to Monday 2026-09-07 (Week 1)
    const classInfo = {
      schedule: { startDate: '2026-09-09' },
    };
    const monday = resolveSemesterStartMondayFromClass(classInfo);
    expect(monday).toBe('2026-09-07');
    expect(formatWeekDateRange(1, monday)).toBe('Sep 7 – Sep 13');
    expect(formatWeekDateRange(3, monday)).toBe('Sep 21 – Sep 27');

    // 2. Holiday skipped week: Student submits in Week 1 (Sep 10) and Week 3 (Sep 24); Week 2 is a holiday with 0 logs/meetings
    const holidayCsv = `Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done & findings since last recording,State which part of the last plan not yet finished (leave it blank if you finished all the work of the last plan,Plan of work before the next recording,Description
9/10/2026 10:00:00,A01,Alice Chan,250111222,Dr. Wong,Yes,Designed database schema and ER diagram for inventory tables,,Implement REST API endpoints for inventory CRUD,
9/24/2026 10:00:00,A01,Alice Chan,250111222,Dr. Wong,Yes,Implemented REST API endpoints for inventory CRUD and tested with Postman,,Connect React table to inventory API,`;

    const parsed = parseProjectWeeklyLogCsv(holidayCsv, { classInfo });
    expect(parsed.weeks).toEqual([1, 3]); // Week 2 holiday skipped

    // 3. Multiple meetings in Week 3: Primary Supervisor + Co-Supervisor both hold meetings in Week 3
    const multiMeetings = [
      {
        id: 'mtg_wk3_main',
        groupId: 'grp_a01',
        groupName: 'A01',
        weekNumber: 3,
        supervisorName: 'Dr. Wong',
        supervisorEmail: 'cywong@vtc.edu.hk',
        attendanceRecord: [
          { uid: '250111222@stu.vtc.edu.hk', email: '250111222@stu.vtc.edu.hk', status: 'present' },
        ],
        studentContributions: [
          {
            uid: '250111222@stu.vtc.edu.hk',
            email: '250111222@stu.vtc.edu.hk',
            workCompleted: ['Demonstrated Postman CRUD tests'],
            weeklyFeedback: 'Good API design.',
            realWorkScore: 9,
          },
        ],
      },
      {
        id: 'mtg_wk3_cosup',
        groupId: 'grp_a01',
        groupName: 'A01',
        weekNumber: 3,
        supervisorName: 'Ir. CoSup',
        supervisorEmail: 'cosup@vtc.edu.hk',
        attendanceRecord: [
          { uid: '250111222@stu.vtc.edu.hk', email: '250111222@stu.vtc.edu.hk', status: 'present' },
        ],
        studentContributions: [
          {
            uid: '250111222@stu.vtc.edu.hk',
            email: '250111222@stu.vtc.edu.hk',
            workCompleted: ['Reviewed SQL indexing with Co-Supervisor'],
            weeklyFeedback: 'Add composite index on SKU.',
            realWorkScore: 8,
          },
        ],
      },
    ];

    const profiles = buildStudentContributionProfiles({
      logData: parsed,
      groups: [
        {
          id: 'grp_a01',
          name: 'A01',
          supervisorName: 'Dr. Wong',
          members: [{ uid: '250111222@stu.vtc.edu.hk', email: '250111222@stu.vtc.edu.hk', name: 'Alice Chan' }],
        },
      ],
      meetings: multiMeetings,
    });

    expect(profiles).toHaveLength(1);
    const alice = profiles[0];
    // Holiday Week 2 is NOT counted as a missing week!
    expect(alice.missingWeeksCount).toBe(0);
    expect(alice.submissionRatePct).toBe(100);
    // Both Week 3 meetings (Primary Supervisor + Co-Supervisor) are counted & aggregated!
    expect(alice.meetingsHeld).toBe(2);
    expect(alice.meetingsAttended).toBe(2);
    expect(alice.meetingAttendancePct).toBe(100);
    expect(alice.verifiedTasksCount).toBe(2);

    const wk3Item = alice.weeklyTimeline.find((w) => w.weekNumber === 3);
    expect(wk3Item.meetingsCount).toBe(2);
    expect(wk3Item.supervisorsLabel).toContain('Dr. Wong');
    expect(wk3Item.supervisorsLabel).toContain('Ir. CoSup');
    expect(wk3Item.weeklyFeedback).toContain('Good API design.');
    expect(wk3Item.weeklyFeedback).toContain('Add composite index on SKU.');
  });

  it('renders grouped recordings, supports My Supervised Groups filter, 1-tap Speaking Now anchors, and attendance override', async () => {
    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          teacherEmails: ['cywong@vtc.edu.hk', 'other@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk', 'charlie@stu.vtc.edu.hk', 'david@stu.vtc.edu.hk'],
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // Verify grouped folder and multi-clip pills render
    expect(screen.getByText(/Project Group Meetings & Supervision Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/2 Voice Clips/i)).toBeInTheDocument();
    expect(screen.getByText(/1 PC Screen/i)).toBeInTheDocument();
    expect(screen.getByText(/Group 1 completed the frontend prototype/i)).toBeInTheDocument();
    expect(screen.getByText(/Built ProjectMeetingsView UI/i)).toBeInTheDocument();

    // Test 1-Tap "Speaking Now" anchor chip for Alice Chan
    const aliceAnchorBtn = screen.getByRole('button', { name: /🗣️ Alice Chan/i });
    fireEvent.click(aliceAnchorBtn);
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    // Test 1-Click Attendance Override (mark Bob Present)
    const presentButtons = screen.getAllByRole('button', { name: /✅ Present/i });
    fireEvent.click(presentButtons[1]);
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_1_wk5' }),
        expect.objectContaining({
          attendanceRecord: expect.arrayContaining([
            expect.objectContaining({ uid: 'stu_2', status: 'present', teacherVerified: true }),
          ]),
        })
      );
    });

    // Switch to Weekly Matrix view
    fireEvent.click(screen.getByRole('button', { name: /📊 Weekly Matrix & Export/i }));
    expect(screen.getByText(/Weekly Project Group Attendance & Individual Contribution Matrix/i)).toBeInTheDocument();

    // Open Manage / Import Groups modal
    fireEvent.click(screen.getByRole('button', { name: /👥 Manage \/ Import Groups/i }));
    expect(screen.getByRole('dialog', { name: /Manage and Import Project Groups/i })).toBeInTheDocument();
    expect(screen.getByText(/Unassigned Students \(1\)/i)).toBeInTheDocument();
  });
});
