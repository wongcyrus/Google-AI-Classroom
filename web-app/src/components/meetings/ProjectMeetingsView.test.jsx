import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockUpdateDoc = vi.fn().mockResolvedValue(true);
const mockSetDoc = vi.fn().mockResolvedValue(true);
const mockDeleteDoc = vi.fn().mockResolvedValue(true);
const mockBatchSet = vi.fn();
const mockBatchDelete = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(true);
const mockHttpsCallable = vi.fn().mockResolvedValue({
  data: {
    preMeetingLogAudit: [
      {
        studentId: '250105348',
        email: '250105348@stu.vtc.edu.hk',
        name: 'Chan Tai Man',
        logQualityStatus: 'suspected_ai_fake',
        logQualityScore: 3,
        logAuditSummary: 'Sudden buzzword leap detected by Gemini.',
        challengeQuestions: ['Explain how Flask RBAC decorator validates session tokens.'],
      },
    ],
  },
});

let mockGroupsSnapshotDocs = [];
let mockMeetingsSnapshotDocs = [];
let mockProfilesSnapshotDocs = [];
let mockPcCaptureState = 'recording_screen';

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
        exists: () => Boolean(mockPcCaptureState),
        data: () => ({
          studentName: 'Alice Chan',
          studentPcState: mockPcCaptureState,
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
    on: (_evt, prog, _err, complete) => {
      if (prog) prog({ bytesTransferred: 50, totalBytes: 100 });
      if (complete) complete();
    },
  }),
  getDownloadURL: () => Promise.resolve('https://storage.example.com/voice.webm'),
  deleteObject: vi.fn(() => Promise.resolve()),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockHttpsCallable,
}));

vi.mock('../../hooks/useLectureRecorder', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getSupportedAudioMimeType: () => 'audio/webm',
    injectWebmDuration: vi.fn((blob) => Promise.resolve(blob)),
  };
});

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
import ProjectGroupEditorModal from './ProjectGroupEditorModal';

const SAMPLE_FORM_RESPONSES_2_CSV = `Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done & findings since last recording,State which part of the last plan not yet finished (leave it blank if you finished all the work of the last plan,Plan of work before the next recording,Description
10/15/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,done,,do website,
10/22/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,done,,do website,
10/29/2026 10:00:00,A11,Chan Tai Man,250105348,Kitson Cheung,Yes,"Completed frontend and backend integration using Flask. Implemented real-time dashboards, history pages, mock AI chatbot, and basic role-based access control (Doctor/Patient).",Swagger docs pending,Deploy to cloud,
10/15/2026 11:00:00,A09,Leung Chun Ho Jason,250231955,Elka Leung,Yes,Designed ER diagram and normalized 6 tables for booking module,Payment table pending,Implement SQL migrations and seed script,
10/22/2026 11:00:00,A09,Leung Chun Ho Jason,20231955,Elka Leung,No,,,,sick`;

describe('projectGroupUtils & ProjectMeetingsView & ProjectGroupEditorModal', () => {
  const originalFetch = global.fetch;
  const originalMediaDevices = navigator.mediaDevices;
  const originalMediaRecorder = global.MediaRecorder;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPcCaptureState = 'recording_screen';
    mockProfilesSnapshotDocs = [];

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: {
        request: vi.fn().mockResolvedValue({
          release: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });

    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLMediaElement.prototype.pause = vi.fn();

    mockGroupsSnapshotDocs = [
      {
        id: 'grp_1',
        data: () => ({
          name: 'Group A11',
          projectTopic: 'Edge Vision Tracker',
          supervisorEmail: 'cywong@vtc.edu.hk',
          supervisorName: 'Dr. Wong',
          coSupervisorEmails: ['cosup@vtc.edu.hk'],
          members: [
            { uid: 'stu_1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan', role: 'Leader' },
            { uid: 'stu_2', email: 'bob@stu.vtc.edu.hk', name: 'Bob Lee', role: 'Member' },
            { uid: '250105348@stu.vtc.edu.hk', email: '250105348@stu.vtc.edu.hk', name: 'Chan Tai Man', role: 'Member' },
          ],
        }),
      },
      {
        id: 'grp_2',
        data: () => ({
          name: 'Group A09',
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
        id: 'mtg_1_wk3',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group A11',
          weekNumber: 3,
          title: 'Week 3 Prototype Demo',
          meetingDate: '2026-10-29T10:15:00.000Z',
          supervisorEmail: 'cywong@vtc.edu.hk',
          supervisorName: 'Dr. Wong',
          durationSeconds: 820,
          status: 'ready',
          aiModelUsed: 'gemini-3.5-transcribe-preview + gemini-3.8-flash',
          aiCost: 0.0042,
          audioClips: [
            {
              clipId: 'c1',
              label: 'Part 1 (Alice Chan)',
              storagePath: 'projectMeetings/it114115/grp_1/mtg_1_wk3/voice_1.webm',
              downloadUrl: 'https://storage.example.com/voice_1.webm',
              durationSeconds: 500,
            },
            {
              clipId: 'c2',
              label: 'Part 2 (Bob Lee)',
              storagePath: 'projectMeetings/it114115/grp_1/mtg_1_wk3/voice_2.webm',
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
            {
              clipId: 'sc2',
              label: "Bob Lee's PC Screen",
              studentUid: 'stu_2',
              studentName: 'Bob Lee',
              downloadUrl: 'https://storage.example.com/screen_2.webm',
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
            weeklyGroupFeedback: 'Great progress on the prototype, add unit tests next week.',
          },
          studentContributions: [
            {
              uid: 'stu_1',
              email: 'alice@stu.vtc.edu.hk',
              name: 'Alice Chan',
              workCompleted: ['Built ProjectMeetingsView UI'],
              currentChallenges: ['Need mock audio stream'],
              actionItemsNextWeek: ['Write unit tests'],
              aiContributionAssessment: 'Strong technical ownership.',
              weeklyFeedback: 'Excellent UI demo, Alice.',
              logQualityAssessment: 'genuine_verified',
              logQualityScore: 9,
              realWorkScore: 9.5,
              challengeQuestions: ['How did you handle WebM duration headers?'],
              timestamps: ['00:35', '01:02:10'],
            },
            {
              uid: '250105348@stu.vtc.edu.hk',
              email: '250105348@stu.vtc.edu.hk',
              name: 'Chan Tai Man',
              workCompleted: [],
              currentChallenges: [],
              actionItemsNextWeek: [],
              aiContributionAssessment: 'Unverified claims.',
              logQualityAssessment: 'not_submitted',
              timestamps: [],
            },
          ],
          transcriptSegments: [
            { startTime: '00:35', endTime: '01:20', speaker: 'Alice Chan', text: 'Here is our Week 3 prototype.' },
          ],
        }),
      },
      {
        id: 'mtg_2_wk2',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group A11',
          weekNumber: 2,
          title: 'Week 2 Architecture Check',
          meetingDate: '2026-10-22T10:15:00.000Z',
          supervisorEmail: 'cywong@vtc.edu.hk',
          durationSeconds: 300,
          status: 'ready',
          audioStoragePath: 'projectMeetings/it114115/grp_1/mtg_2_wk2/legacy.webm',
          audioDownloadUrl: 'https://storage.example.com/legacy.webm',
          attendanceRecord: [
            { uid: 'stu_1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan', status: 'late' },
          ],
          keyInsights: {
            overallGroupProgress: 'at_risk',
            keyDecisions: [],
            blockersAndRisks: [],
            supervisorFeedback: [],
          },
          studentContributions: [],
          transcriptSegments: [],
          rawDiarizedTranscript: '[00:10] Alice: Initial setup.',
        }),
      },
    ];
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
    global.MediaRecorder = originalMediaRecorder;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
  });

  it('parses CSV/pasted group rows and clusters students by GroupName', () => {
    const csv = `GroupName,ProjectTopic,SupervisorEmail,StudentEmail,StudentName,Role
Group 1,AI Smart Inventory,cywong@vtc.edu.hk,alice@stu.vtc.edu.hk,Alice Chan,Leader
Group 1,AI Smart Inventory,cywong@vtc.edu.hk,bob@stu.vtc.edu.hk,Bob Lee,Member
Group 2,Cloud FinOps,other@vtc.edu.hk,charlie@stu.vtc.edu.hk,Charlie Wong,Leader`;

    const parsed = parseProjectGroupsText(csv);
    expect(parsed.groups).toHaveLength(2);
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
    expect(md).toContain('Group A11 — Week 3');
    expect(md).toContain('Alice Chan');
    expect(md).toContain('Built ProjectMeetingsView UI');
  });

  it('converts Google Sheet URLs to CSV export URLs and audits Form Responses 2 weekly logs', () => {
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

    const profiles = buildStudentContributionProfiles({ logData: parsed, groups: [], meetings: [] });
    expect(profiles).toHaveLength(2);
    const rehydrated = rehydrateWeeklyLogDataFromPersistedProfiles(profiles);
    expect(rehydrated.entries).toHaveLength(5);

    const firstBackfill = mergeIncrementalStudentProfiles({
      incomingProfiles: profiles,
      existingProfiles: [],
    });
    expect(firstBackfill.isInitialBackfill).toBe(true);
    expect(firstBackfill.deltaProfiles).toHaveLength(2);

    const syncedGroups = bootstrapProjectGroupsFromWeeklyLogs({ logData: parsed, existingGroups: [] });
    expect(syncedGroups).toHaveLength(2);
  });

  it('defines weeks from Class Schedule startDate, skips holiday weeks without penalty, and aggregates multiple co-supervisor meetings in the same week', () => {
    const classInfo = { schedule: { startDate: '2026-09-09' } };
    const monday = resolveSemesterStartMondayFromClass(classInfo);
    expect(monday).toBe('2026-09-07');
    expect(formatWeekDateRange(1, monday)).toBe('Sep 7 – Sep 13');

    const holidayCsv = `Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done & findings since last recording,State which part of the last plan not yet finished (leave it blank if you finished all the work of the last plan,Plan of work before the next recording,Description
9/10/2026 10:00:00,A01,Alice Chan,250111222,Dr. Wong,Yes,Designed database schema and ER diagram for inventory tables,,Implement REST API endpoints for inventory CRUD,
9/24/2026 10:00:00,A01,Alice Chan,250111222,Dr. Wong,Yes,Implemented REST API endpoints for inventory CRUD and tested with Postman,,Connect React table to inventory API,`;

    const parsed = parseProjectWeeklyLogCsv(holidayCsv, { classInfo });
    expect(parsed.weeks).toEqual([1, 3]);

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

    expect(profiles[0].missingWeeksCount).toBe(0);
    expect(profiles[0].meetingsHeld).toBe(2);
  });

  it('exercises ProjectGroupEditorModal visual management, auto-split, CSV/file batch import, and save', async () => {
    const onSaveGroups = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const { rerender } = render(
      <ProjectGroupEditorModal
        isOpen={false}
        onClose={onClose}
        classId="it114115"
        existingGroups={[]}
        enrolledStudents={[]}
        onSaveGroups={onSaveGroups}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Render open with 0 existing groups first so assigning a student auto-creates Group 1
    rerender(
      <ProjectGroupEditorModal
        isOpen={true}
        onClose={onClose}
        classId="it114115"
        existingGroups={[]}
        enrolledStudents={[
          { uid: 's1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan' },
          { uid: 's2', email: 'bob@stu.vtc.edu.hk', name: 'Bob Lee' },
          { uid: 's3', email: 'charlie@stu.vtc.edu.hk', name: 'Charlie Wong' },
        ]}
        classTeachers={[]}
        currentUserEmail="cywong@vtc.edu.hk"
        currentUserName="Dr. Wong"
        onSaveGroups={onSaveGroups}
      />
    );

    // Search unassigned students
    const searchInput = screen.getByPlaceholderText(/Search unassigned student/i);
    fireEvent.change(searchInput, { target: { value: 'Alice' } });
    expect(screen.getByText('Alice Chan')).toBeInTheDocument();
    expect(screen.queryByText('Bob Lee')).not.toBeInTheDocument();

    // Click Alice to assign to a newly auto-created Group 1
    fireEvent.click(screen.getByText('Alice Chan'));
    fireEvent.change(searchInput, { target: { value: '' } });

    // Edit Group 1 name, topic, and supervisor email (input mode since classTeachers=[])
    fireEvent.change(screen.getByLabelText('Group 1 Name'), { target: { value: 'Group Alpha' } });
    fireEvent.change(screen.getByLabelText('Group 1 Project Topic'), { target: { value: 'Smart Campus' } });
    fireEvent.change(screen.getByPlaceholderText('supervisor@vtc.edu.hk'), {
      target: { value: 'lead@vtc.edu.hk' },
    });

    // Auto-split remaining 2 unassigned students into groups of size 1
    fireEvent.change(screen.getByLabelText(/Size:/i), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /⚡ Auto-Split into Groups/i }));
    expect(screen.getByText(/All enrolled students are assigned/i)).toBeInTheDocument();

    // Add a new group manually
    fireEvent.click(screen.getByRole('button', { name: /➕ Create New Group/i }));

    // Toggle Alice's Leader/Member role
    const leaderBtns = screen.getAllByRole('button', { name: /⭐ Leader/i });
    fireEvent.click(leaderBtns[0]);

    // Move Alice to Group 2
    const moveSelect = screen.getByLabelText(/Move Alice Chan to another group/i);
    fireEvent.change(moveSelect, { target: { value: '1' } });

    // Remove a member from a group
    const removeMemberBtns = screen.getAllByTitle('Remove from group');
    fireEvent.click(removeMemberBtns[0]);

    // Delete a group card
    const deleteGroupBtns = screen.getAllByTitle('Delete this group');
    fireEvent.click(deleteGroupBtns[deleteGroupBtns.length - 1]);

    // Export Groups (.xlsx)
    fireEvent.click(screen.getByRole('button', { name: /📤 Export Groups/i }));

    // Switch to Batch Import / Export tab
    fireEvent.click(screen.getByRole('button', { name: /📥 Batch Import \/ Export/i }));
    fireEvent.click(screen.getByRole('button', { name: /📄 Download Roster Template/i }));

    // Enter comment-only text so parsedPreview has 0 groups, then click Apply to trigger validation error
    const pasteArea = screen.getByLabelText(/Paste project groups CSV or Excel rows/i);
    fireEvent.change(pasteArea, { target: { value: '# comment only' } });
    fireEvent.click(screen.getByRole('button', { name: /📥 Apply 0 Group\(s\) to Editor/i }));
    expect(
      screen.getByText(/Please upload a valid Excel\/CSV file or paste group rows first/i)
    ).toBeInTheDocument();

    const validCsv = `GroupName,ProjectTopic,SupervisorEmail,StudentEmail,StudentName,Role
Group Alpha,Updated Topic,cywong@vtc.edu.hk,david@stu.vtc.edu.hk,David Ng,Member
Group Beta,New Beta Topic,other@vtc.edu.hk,eva@stu.vtc.edu.hk,Eva Ho,Leader`;
    fireEvent.change(pasteArea, { target: { value: validCsv } });
    expect(screen.getByText(/Preview: 2 Project Group\(s\)/i)).toBeInTheDocument();

    // Apply in 'merge' mode
    fireEvent.click(screen.getByRole('button', { name: /📥 Apply 2 Group\(s\) to Editor/i }));

    // Switch back to Import tab, test file upload & 'replace' mode
    fireEvent.click(screen.getByRole('button', { name: /📥 Batch Import \/ Export/i }));
    const fileInput = document.querySelector('input[type="file"]');
    const csvFile = new File([validCsv], 'groups.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [csvFile] } });
    await waitFor(() => {
      expect(screen.getByText(/📎 groups\.csv/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText(/Replace All Groups/i));
    fireEvent.click(screen.getByRole('button', { name: /📥 Apply 2 Group\(s\) to Editor/i }));

    // Save Project Groups
    fireEvent.click(screen.getByRole('button', { name: /💾 Save Project Groups/i }));
    await waitFor(() => {
      expect(onSaveGroups).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('syncs Weekly Log Google Sheet on-demand, prepares AI challenge questions, and filters Student Contribution Profiles', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(SAMPLE_FORM_RESPONSES_2_CSV),
    });

    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          schedule: { startDate: '2026-10-12' },
          teacherEmails: ['cywong@vtc.edu.hk', 'other@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk', 'charlie@stu.vtc.edu.hk', 'david@stu.vtc.edu.hk'],
          students: {
            stu_1: { email: 'alice@stu.vtc.edu.hk' },
          },
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // 1. Test empty URL validation
    fireEvent.click(screen.getByRole('button', { name: /💾 Save to Class & Backfill All Logs/i }));
    expect(screen.getByText(/Please paste this class’s public Weekly Log Google Sheet URL first/i)).toBeInTheDocument();

    // 2. Test HTTP 404 fetch error handling
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const urlInput = screen.getByLabelText(/Public Weekly Log Google Sheet URL/i);
    fireEvent.change(urlInput, { target: { value: 'https://example.com/broken.csv' } });
    fireEvent.click(screen.getByRole('button', { name: /💾 Save to Class & Backfill All Logs/i }));
    expect(await screen.findByText(/Google Sheet CSV fetch returned HTTP 404/i)).toBeInTheDocument();

    // 3. Valid Google Sheet URL sync & backfill
    fireEvent.change(urlInput, {
      target: {
        value: 'https://docs.google.com/spreadsheets/d/1mKWVAkdM0RedTQ2wjk1GMmh6bxNQ6S-A4YP-85s77Ps/edit?gid=1601202239',
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /💾 Save to Class & Backfill All Logs/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(mockBatchCommit).toHaveBeenCalled();
    });

    // 4. Sync Groups from Sheet button appears once log sheet is loaded
    const syncGroupsBtn = await screen.findByRole('button', { name: /👥 Sync 2 Groups from Sheet/i });
    fireEvent.click(syncGroupsBtn);
    await waitFor(() => {
      expect(mockBatchCommit).toHaveBeenCalled();
    });

    // 5. Click logged week chip on Group A09 first, then switch to Group A11 (grp_1)
    fireEvent.click(screen.getByRole('button', { name: 'Wk 2' }));
    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: '3' } });
    expect(screen.getByText(/Pre-Meeting Log Audit & Challenge Questions/i)).toBeInTheDocument();

    // Generate AI Challenge Questions via Gemini callable
    fireEvent.click(screen.getByRole('button', { name: /🎯 Generate AI Challenge Questions/i }));
    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'it114115',
          mode: 'prepare_log_questions',
        })
      );
    });
    expect(await screen.findByText(/Explain how Flask RBAC decorator validates session tokens/i)).toBeInTheDocument();

    // Toggle briefing collapse/expand
    fireEvent.click(screen.getByRole('button', { name: /📋 Pre-Meeting Log Audit/i }));

    // 6. Click metric pill to jump to Student Contribution Profiles view
    fireEvent.click(screen.getByTitle(/Click to inspect Suspected AI/i));
    expect(
      screen.getByText(/Individual Student Contribution & Weekly Log Quality Profiles/i)
    ).toBeInTheDocument();

    // Filter Student Profiles by quality states, group, and search query
    const qualitySelect = screen.getByLabelText(/Filter student profiles by log quality flag/i);
    fireEvent.change(qualitySelect, { target: { value: 'vague_useless' } });
    fireEvent.change(qualitySelect, { target: { value: 'inactive' } });
    fireEvent.change(qualitySelect, { target: { value: 'genuine' } });
    fireEvent.change(qualitySelect, { target: { value: 'all' } });

    const groupFilterSelect = screen.getByLabelText(/Filter student profiles by group/i);
    fireEvent.change(groupFilterSelect, { target: { value: 'A09' } });
    fireEvent.change(groupFilterSelect, { target: { value: 'all' } });

    const profileSearch = screen.getByLabelText(/Search student profile by name or student ID/i);
    fireEvent.change(profileSearch, { target: { value: 'Leung Chun Ho' } });
    expect(screen.getAllByText(/Leung Chun Ho Jason/i).length).toBeGreaterThan(0);
    fireEvent.change(profileSearch, { target: { value: '' } });

    // Export Student Profiles (.xlsx)
    fireEvent.click(screen.getByRole('button', { name: /📥 Export Student Profiles/i }));
  });

  it('handles full studio voice + student PC recording lifecycle, pause/resume, and upload', async () => {
    const mockStopTrack = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: mockStopTrack }],
        }),
      },
    });

    class MockMediaRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.mimeType = options?.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      start() {
        this.state = 'recording';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['audio-bytes'], { type: 'audio/webm' }) });
        }
      }
      pause() {
        this.state = 'paused';
      }
      resume() {
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
    }
    global.MediaRecorder = MockMediaRecorder;

    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          teacherEmails: ['cywong@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk'],
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });

    // Select Presenter Student PC Screen & set Meeting Title & Force separate meeting doc
    fireEvent.change(screen.getByLabelText(/💻 Presenter Student PC Screen:/i), {
      target: { value: 'stu_1' },
    });
    expect(await screen.findByText(/PC Screen Recording Active/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/📝 Meeting Title \/ Agenda:/i), {
      target: { value: 'Custom Demo Session' },
    });
    fireEvent.click(screen.getByLabelText(/Separate meeting entry/i));

    // Start Recording
    fireEvent.click(screen.getByRole('button', { name: /🔴 Start Meeting Recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /⏸️ Pause/i })).toBeInTheDocument();
    });

    // Switch Presenter Student PC mid-recording
    fireEvent.change(screen.getByLabelText(/💻 Presenter Student PC Screen:/i), {
      target: { value: 'stu_2' },
    });

    // Pause and Resume
    fireEvent.click(screen.getByRole('button', { name: /⏸️ Pause/i }));
    expect(screen.getByRole('button', { name: /▶️ Resume/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /▶️ Resume/i }));

    // Stop & Analyze with Gemini
    fireEvent.click(screen.getByRole('button', { name: /⏹️ Stop & Analyze with Gemini/i }));

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
      expect(mockHttpsCallable).toHaveBeenCalled();
    });

    // Also test recording into an existing meeting doc (Week 3 for grp_1 with forceNewMeetingDoc=false) + "Save Part"
    fireEvent.click(screen.getByLabelText(/Separate meeting entry/i));
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: /🔴 Record Next Clip in Meeting/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /💾 Save Part/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /💾 Save Part/i }));
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    // Also test microphone permission denial error handling
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    fireEvent.click(screen.getByRole('button', { name: /🔴 Record Next Clip in Meeting/i }));
    expect(await screen.findByText(/Could not access microphone: Permission denied/i)).toBeInTheDocument();
  });

  it('supports inspector editing (group feedback, student contribution, transcript drawer, media sync, merge clips, matrix navigation)', async () => {
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

    // 1. Toggle Supervisor Filter ('My Supervised Groups' vs 'All Class Groups')
    fireEvent.click(screen.getByRole('button', { name: /👤 My Supervised Groups/i }));
    fireEvent.click(screen.getByRole('button', { name: /🌐 All Class Groups/i }));

    // 1b. 1-Click Attendance Status Override
    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });
    const presentBtns = screen.getAllByRole('button', { name: /✅ Present/i });
    fireEvent.click(presentBtns[1]);
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    // 1c. Select preferred AI model and click Re-Run Gemini Analysis
    fireEvent.change(screen.getByLabelText(/Select Gemini reasoning model/i), {
      target: { value: 'gemini-4-argon' },
    });
    fireEvent.click(screen.getByRole('button', { name: /✨ Re-Run Gemini Analysis/i }));
    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalled();
    });

    // 2. Copy Markdown Minutes & Copy Weekly Group Feedback & Copy Student Weekly Feedback
    fireEvent.click(screen.getByRole('button', { name: /📋 Copy Minutes/i }));
    const copyBtns = screen.getAllByRole('button', { name: /📋 Copy$/i });
    copyBtns.forEach((btn) => fireEvent.click(btn));
    expect(navigator.clipboard.writeText).toHaveBeenCalled();

    // 3. Switch audio & screen clips, trigger audio play/pause/seeked events, and timestamp seek
    fireEvent.click(screen.getByRole('button', { name: /🎙️ Part 2 \(Bob Lee\)/i }));
    fireEvent.click(screen.getByRole('button', { name: /💻 Bob Lee's PC Screen/i }));
    const audioEl = document.querySelector('audio');
    if (audioEl) {
      fireEvent.play(audioEl);
      fireEvent.pause(audioEl);
      fireEvent.seeked(audioEl);
    }
    const seekBtns = screen.getAllByRole('button', { name: /▶ \[00:35\]/i });
    fireEvent.click(seekBtns[0]);
    fireEvent.click(screen.getByRole('button', { name: /▶ \[01:02:10\]/i }));

    // 4. Edit & Save Weekly Group Feedback
    fireEvent.click(screen.getByRole('button', { name: /✏️ Edit Group Feedback/i }));
    const grpFeedbackInput = screen.getByPlaceholderText(/Write weekly feedback for the project group/i);
    fireEvent.change(grpFeedbackInput, { target: { value: 'Updated group feedback for Week 3.' } });
    fireEvent.click(screen.getByRole('button', { name: /💾 Save Weekly Group Feedback/i }));
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_1_wk3' }),
        expect.objectContaining({
          keyInsights: expect.objectContaining({
            weeklyGroupFeedback: 'Updated group feedback for Week 3.',
          }),
        })
      );
    });

    // 5. Edit & Save Individual Student Contribution & Weekly Feedback
    const editStudentBtns = screen.getAllByRole('button', { name: '✏️ Edit' });
    fireEvent.click(editStudentBtns[0]);
    fireEvent.change(screen.getByLabelText(/📗 Log Quality Score/i), { target: { value: '8.5' } });
    fireEvent.change(screen.getByLabelText(/🛠️ Real Work Score/i), { target: { value: '9' } });
    fireEvent.change(
      screen.getByPlaceholderText(/Constructive weekly feedback on technical progress/i),
      { target: { value: 'Great job on WebM duration fix.' } }
    );
    fireEvent.click(screen.getByRole('button', { name: /💾 Save Student Record & Feedback/i }));
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_1_wk3' }),
        expect.objectContaining({
          studentContributions: expect.arrayContaining([
            expect.objectContaining({
              uid: 'stu_1',
              logQualityScore: 8.5,
              realWorkScore: 9,
              weeklyFeedback: 'Great job on WebM duration fix.',
            }),
          ]),
        })
      );
    });

    // 6. Toggle Diarized Transcript Drawer & seek from transcript segment
    fireEvent.click(screen.getByRole('button', { name: /📜 View Diarized Transcript/i }));
    expect(screen.getByText(/Here is our Week 3 prototype/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '[00:35]' }));

    // 6b. Select second meeting in sidebar, use master group and week selector, and toggle folder collapse
    fireEvent.click(screen.getByText(/Week 2: Week 2 Architecture Check/i));
    expect(screen.getByText(/\[00:10\] Alice: Initial setup\./i)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Week 3: Week 3 Prototype Demo/i));
    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), {
      target: { value: 'grp_1' },
    });
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), {
      target: { value: '3' },
    });
    fireEvent.click(screen.getByText(/📂 Group A09/i));

    // 6c. Open and close Manage / Import Groups modal from main view
    fireEvent.click(screen.getByRole('button', { name: /👥 Manage \/ Import Groups/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 7. Toggle mobile sessions accordion and delete a clip part / delete meeting session
    fireEvent.click(screen.getByLabelText(/Toggle meeting sessions list/i));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /🗑️ Delete Part 1/i }));
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();

    // 8. Group / Merge 2 clips in sidebar
    fireEvent.click(screen.getByRole('button', { name: /🔗 Group Clips/i }));
    fireEvent.click(screen.getByLabelText(/Select Week 3 Prototype Demo for grouping/i));
    fireEvent.click(screen.getByLabelText(/Select Week 2 Architecture Check for grouping/i));
    fireEvent.click(screen.getByRole('button', { name: /🔗 Combine into 1 Meeting \(2\)/i }));
    await waitFor(() => {
      expect(mockDeleteDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_1_wk3' })
      );
    });

    // 9. Switch to Weekly Matrix & Export, click a week cell to jump back to Studio
    fireEvent.click(screen.getByRole('button', { name: /📊 Weekly Matrix & Export/i }));
    fireEvent.click(screen.getByRole('button', { name: /📥 Export Full Matrix/i }));
    const presentCells = screen.getAllByText(/1 done/i);
    fireEvent.click(presentCells[0]);
    expect(screen.getByText(/1\. 📋 Meeting Attendance Record/i)).toBeInTheDocument();
  });
});
