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
        studentId: '990000101',
        email: '990000101@stu.vtc.edu.hk',
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
  deleteField: () => 'MOCK_DELETE_FIELD',
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
import ProjectMeetingsView, {
  isMeetingPendingAnalysis,
  compressPhotoBlob,
  isAudioClipValid,
  hasMeetingValidAudio,
  getMeetingValidAudioDuration,
  getMeetingValidClipCount,
  computeWeekGroupAiStats,
  getMeetingPipelineAndHealth,
  aggregateGroupWeekSessions,
} from './ProjectMeetingsView';
import ProjectGroupEditorModal from './ProjectGroupEditorModal';

const SAMPLE_FORM_RESPONSES_2_CSV = `Timestamp,Group ID,Student Name,Student ID,Supervisor,I am doing something this week,Work done & findings since last recording,State which part of the last plan not yet finished (leave it blank if you finished all the work of the last plan,Plan of work before the next recording,Description
10/15/2026 10:00:00,A11,Chan Tai Man,990000101,Kitson Cheung,Yes,done,,do website,
10/22/2026 10:00:00,A11,Chan Tai Man,990000101,Kitson Cheung,Yes,done,,do website,
10/29/2026 10:00:00,A11,Chan Tai Man,990000101,Kitson Cheung,Yes,"Completed frontend and backend integration using Flask. Implemented real-time dashboards, history pages, mock AI chatbot, and basic role-based access control (Doctor/Patient).",Swagger docs pending,Deploy to cloud,
10/15/2026 11:00:00,A09,Alex Lee,990000202,Elka Leung,Yes,Designed ER diagram and normalized 6 tables for booking module,Payment table pending,Implement SQL migrations and seed script,
10/22/2026 11:00:00,A09,Alex Lee,99000202,Elka Leung,No,,,,sick`;

describe('projectGroupUtils & ProjectMeetingsView & ProjectGroupEditorModal', () => {
  const originalFetch = global.fetch;
  const originalMediaDevices = navigator.mediaDevices;
  const originalMediaRecorder = global.MediaRecorder;
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage?.clear?.();
    localStorage.setItem('teacher_privacy_mode', 'false');
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
            { uid: '990000101@stu.vtc.edu.hk', email: '990000101@stu.vtc.edu.hk', name: 'Chan Tai Man', role: 'Member' },
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
              uid: '990000101@stu.vtc.edu.hk',
              email: '990000101@stu.vtc.edu.hk',
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
    fireEvent.change(profileSearch, { target: { value: 'Alex Lee' } });
    expect(screen.getAllByText(/Alex Lee/i).length).toBeGreaterThan(0);
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

    // Select Presenting Member & set Meeting Title & Force separate meeting doc
    fireEvent.change(screen.getByLabelText(/👤 Presenting Member/i), {
      target: { value: 'stu_1' },
    });

    fireEvent.change(screen.getByLabelText(/📝 Meeting Title \/ Agenda:/i), {
      target: { value: 'Custom Demo Session' },
    });
    fireEvent.click(screen.getByLabelText(/Separate meeting entry/i));

    // Start Recording
    fireEvent.click(screen.getByRole('button', { name: /🔴 Start Meeting Recording/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /⏸️ Pause/i })).toBeInTheDocument();
    });

    // Switch Presenting Member mid-recording
    fireEvent.change(screen.getByLabelText(/👤 Presenting Member/i), {
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
    // Verify sessions under Group A09 remain permanently visible without collapsible hiding
    expect(screen.getAllByText(/Week 3: Week 3 Prototype Demo/i).length).toBeGreaterThanOrEqual(1);

    // 6c. Open and close Manage / Import Groups modal from main view
    fireEvent.click(screen.getByRole('button', { name: /👥 Manage \/ Import Groups/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    // 7. Toggle mobile sessions accordion, move clip part to another group, and delete clip
    fireEvent.click(screen.getByLabelText(/Toggle meeting sessions list/i));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    fireEvent.change(screen.getByLabelText(/Move clip part to another group/i), {
      target: { value: 'grp_2' },
    });
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: /🗑️ Delete Part 1/i }));
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();

    // 8. Select meeting session directly from sidebar
    const sessionCard = screen.getByText(/Week 2: Week 2 Architecture Check/i);
    fireEvent.click(sessionCard);
    expect(screen.getAllByText(/Group A09/i).length).toBeGreaterThanOrEqual(1);

    // 9. Switch to Weekly Matrix & Export, click a week cell to jump back to Studio
    fireEvent.click(screen.getByRole('button', { name: /📊 Weekly Matrix & Export/i }));
    fireEvent.click(screen.getByRole('button', { name: /📥 Export Full Matrix/i }));
    const presentCells = screen.getAllByText(/1 done/i);
    fireEvent.click(presentCells[0]);
    expect(screen.getByText(/1\. 📋 Meeting Attendance Record/i)).toBeInTheDocument();
  });

  it('supports Batch Gemini Analysis modal for the selected week with Mode 1 and Mode 2', async () => {
    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          teacherEmails: ['cywong@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk'],
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // Switch to Week 2 where mtg_2_wk2 exists
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: 2 } });

    // Open Batch AI modal via Studio trigger (single source of truth)
    fireEvent.click(screen.getByRole('button', { name: /⚡ Batch AI/i }));

    // Modal should be visible with week title
    expect(screen.getByText(/⚡ Batch Gemini Analysis — Week 2/i)).toBeInTheDocument();
    expect(screen.getByText(/Mode 1: Run Missing Only/i)).toBeInTheDocument();
    expect(screen.getByText(/Mode 2: Re-Run All/i)).toBeInTheDocument();

    // Verify in-modal week selector exists
    const modalWeekSelect = screen.getByLabelText(/📅 Select Supervision Week:/i);
    expect(modalWeekSelect).toBeInTheDocument();
    expect(modalWeekSelect.value).toBe('2');

    // Trigger Mode 2: Re-Run All
    fireEvent.click(screen.getByRole('button', { name: /🔄 Re-Analyze All/i }));
    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalled();
    });
  });

  it('supports emailing supervision report via Cloud Function and mail client fallback', async () => {
    const mockWindowOpen = vi.fn();
    window.open = mockWindowOpen;

    mockHttpsCallable.mockResolvedValueOnce({
      data: { success: true, count: 2, recipients: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk'] },
    });

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

    // Select Group 1
    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });

    // Click "📧 Email Report" button
    const emailBtns = screen.getAllByRole('button', { name: /📧 Email Report/i });
    expect(emailBtns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(emailBtns[0]);

    // Verify modal is open
    expect(screen.getByText(/📧 Email Supervision Minutes & Feedback/i)).toBeInTheDocument();
    expect(screen.getByText(/Select Recipients/i)).toBeInTheDocument();

    // Click Open in Mail Client (mailto:)
    fireEvent.click(screen.getByRole('button', { name: /Open in Mail Client/i }));
    expect(mockWindowOpen).toHaveBeenCalledWith(
      expect.stringContaining('mailto:'),
      '_blank'
    );

    // Click Send Email Report
    fireEvent.click(screen.getByRole('button', { name: /Send Email Report \(SMTP\)/i }));

    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'it114115',
          meetingId: 'mtg_1_wk3',
        })
      );
    });

    expect(screen.getByText(/Successfully sent email reports to 2 student\(s\)/i)).toBeInTheDocument();
  });

  it('supports emailing supervision reports to the whole class of the week in batch with supervisor note', async () => {
    const mockWindowOpen = vi.fn();
    window.open = mockWindowOpen;

    const mockClipboardWrite = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: mockClipboardWrite },
      configurable: true,
      writable: true,
    });

    mockHttpsCallable.mockResolvedValue({
      data: { success: true, count: 2 },
    });

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

    // Switch Studio week to Week 3 (which has mtg_1_wk3 in our mocks)
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: '3' } });

    // Click "📧 Email Whole Class (Week 3)" button
    const batchEmailBtn = screen.getByRole('button', { name: /📧 Email Whole Class \(Week 3\)/i });
    expect(batchEmailBtn).toBeInTheDocument();
    fireEvent.click(batchEmailBtn);

    // Verify Modal opens
    expect(screen.getByText(/📧 Email Weekly Reports to Whole Class \(Week 3\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Select Academic Week:/i)).toBeInTheDocument();

    // Type an overarching supervisor note
    const noteTextarea = screen.getByPlaceholderText(/Great progress in this sprint review/i);
    fireEvent.change(noteTextarea, {
      target: { value: 'Milestone 2 presentation is due next Tuesday at 23:59.' },
    });

    // Test Select All / Deselect All / View Report preview
    const deselectBtn = screen.getByRole('button', { name: /✕ Deselect All/i });
    fireEvent.click(deselectBtn);
    expect(screen.getByText(/0 of 1 selected/i)).toBeInTheDocument();

    const selectAllBtn = screen.getByRole('button', { name: /☑️ Select All/i });
    fireEvent.click(selectAllBtn);
    expect(screen.getByText(/1 of 1 selected/i)).toBeInTheDocument();

    // Toggle inline report preview
    const viewBtn = screen.getByRole('button', { name: /👁️ View/i });
    fireEvent.click(viewBtn);
    expect(screen.getByText(/📋 Report Preview:/i)).toBeInTheDocument();

    // Test copy student emails button
    const copyEmailsBtn = screen.getByRole('button', { name: /Copy All Student Emails \(Week 3\)/i });
    fireEvent.click(copyEmailsBtn);
    expect(mockClipboardWrite).toHaveBeenCalled();

    // Test open mail draft button
    const mailDraftBtn = screen.getByRole('button', { name: /Open Whole-Class Draft \(Mail Client\)/i });
    fireEvent.click(mailDraftBtn);
    expect(mockWindowOpen).toHaveBeenCalledWith(
      expect.stringContaining('mailto:'),
      '_blank'
    );

    // Click dispatch button
    const sendBatchBtn = screen.getByRole('button', { name: /🚀 Send Reports to Selected/i });
    fireEvent.click(sendBatchBtn);

    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        expect.objectContaining({
          classId: 'it114115',
          customNote: 'Milestone 2 presentation is due next Tuesday at 23:59.',
          sendToAllTeammates: true,
        })
      );
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Successfully dispatched reports to/i).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('correctly identifies meetings pending AI analysis or re-analysis when clips are moved or previous analysis had no speech', () => {
    // 1. Meeting with audio clips but no analysis done yet
    expect(
      isMeetingPendingAnalysis({
        id: 'm_fresh',
        audioClips: [{ clipId: 'c1', storagePath: 'voice.webm' }],
      })
    ).toBe(true);

    // 2. Meeting without audio clips
    expect(
      isMeetingPendingAnalysis({
        id: 'm_empty',
        audioClips: [],
      })
    ).toBe(false);

    // 3. Meeting successfully analyzed without error or dirty flag
    expect(
      isMeetingPendingAnalysis({
        id: 'm_done',
        audioClips: [{ clipId: 'c1', storagePath: 'voice.webm' }],
        analyzedAt: '2026-11-05T00:00:00Z',
        rawDiarizedTranscript: '[00:05] Speaker 1: Technical discussion...',
        keyInsights: { executiveSummary: 'Progress was evaluated.' },
      })
    ).toBe(false);

    // 4. Meeting where clips were moved or added, flagged with needsReanalysis
    expect(
      isMeetingPendingAnalysis({
        id: 'm_moved_clip',
        audioClips: [{ clipId: 'c1', storagePath: 'voice.webm' }],
        analyzedAt: '2026-11-05T00:00:00Z',
        rawDiarizedTranscript: '[00:05] Speaker 1: Technical discussion...',
        needsReanalysis: true,
      })
    ).toBe(true);

    // 5. Meeting where previous analysis produced "No intelligible speech was recorded" but audio now exists
    expect(
      isMeetingPendingAnalysis({
        id: 'm_a04_wk10',
        audioClips: [{ clipId: 'c_moved_from_a01', storagePath: 'voice_a01.webm', durationSeconds: 300 }],
        analyzedAt: '2026-11-05T00:00:00Z',
        aiModelUsed: 'gemini-3.8-flash',
        rawDiarizedTranscript: '=== Clip 1: Part 1 ===\n[No intelligible speech detected in this clip]',
        keyInsights: {
          executiveSummary:
            'No intelligible speech was recorded for this Week 10 supervision session. Consequently, no verbal technical discussions, screen demonstrations, or progress updates could be evaluated.',
        },
      })
    ).toBe(true);
  });

  it('correctly validates audio clips and filters out 0-byte or corrupted recording stubs', () => {
    // 0-byte clip
    expect(isAudioClipValid({ clipId: 'c_empty', fileSize: 0, durationSeconds: 1, storagePath: 'voice.webm' })).toBe(false);
    // <= 2s stub with tiny size <= 256 bytes
    expect(isAudioClipValid({ clipId: 'c_stub', fileSize: 120, durationSeconds: 2, storagePath: 'voice.webm' })).toBe(false);
    // <= 2s stub without size specified
    expect(isAudioClipValid({ clipId: 'c_stub2', durationSeconds: 1, storagePath: 'voice.webm' })).toBe(false);
    // Valid clip with duration
    expect(isAudioClipValid({ clipId: 'c_valid', durationSeconds: 300, storagePath: 'voice.webm' })).toBe(true);
    // Valid clip with fileSize
    expect(isAudioClipValid({ clipId: 'c_valid2', fileSize: 35193, durationSeconds: 3, storagePath: 'voice.webm' })).toBe(true);
    // Legacy clip without duration/size
    expect(isAudioClipValid({ clipId: 'c_legacy', storagePath: 'voice.webm' })).toBe(true);

    // Meeting with multiple clips where one is 0-byte and others are valid (e.g. Group A04 Week 11)
    const multiPartMeeting = {
      id: 'mtg_a04',
      audioClips: [
        { clipId: 'c1', durationSeconds: 2, fileSize: 0, storagePath: 'c1.webm' },
        { clipId: 'c2', durationSeconds: 705, fileSize: 8629749, storagePath: 'c2.webm' },
        { clipId: 'c3', durationSeconds: 1005, fileSize: 12085739, storagePath: 'c3.webm' },
      ],
    };
    expect(hasMeetingValidAudio(multiPartMeeting)).toBe(true);
    expect(getMeetingValidAudioDuration(multiPartMeeting)).toBe(1710);
    expect(getMeetingValidClipCount(multiPartMeeting)).toBe(2);

    // Meeting with ONLY 0-byte failed clips
    const emptyFailedMeeting = {
      id: 'mtg_a04_failed',
      status: 'analysis_failed',
      audioClips: [
        { clipId: 'c1', durationSeconds: 1, fileSize: 0, storagePath: 'c1.webm' },
      ],
    };
    expect(hasMeetingValidAudio(emptyFailedMeeting)).toBe(false);
    // Critical: empty failed meeting must NOT be considered pending AI analysis!
    expect(isMeetingPendingAnalysis(emptyFailedMeeting)).toBe(false);
  });

  it('aggregates week meetings by Project Group, correctly handling multi-part recordings, multi-session documents, and empty stubs without duplicate group chips', () => {
    const testGroups = [
      { id: 'grp_a01', name: 'A01' },
      { id: 'grp_a04', name: 'A04' },
      { id: 'grp_a02', name: 'A02' },
    ];

    const testMeetings = [
      // A01: 1 meeting, 2 clips, analyzed
      {
        id: 'm_a01_1',
        groupId: 'grp_a01',
        groupName: 'A01',
        weekNumber: 11,
        status: 'ready',
        analyzedAt: '2026-11-12T03:50:00Z',
        rawDiarizedTranscript: '[00:05] Speaker 1: Done',
        audioClips: [
          { clipId: 'c1', durationSeconds: 1029, storagePath: 'a01_1.webm' },
          { clipId: 'c2', durationSeconds: 1328, storagePath: 'a01_2.webm' },
        ],
      },
      // A04: 4 sessions in Week 11 (2 analyzed, 2 empty 0-byte failed stubs)
      {
        id: 'm_a04_main_analyzed',
        groupId: 'grp_a04',
        groupName: 'A04',
        weekNumber: 11,
        status: 'ready',
        analyzedAt: '2026-11-12T04:00:00Z',
        rawDiarizedTranscript: '[00:02] Speaker 1: 3 parts analysis',
        audioClips: [
          { clipId: 'c1', durationSeconds: 2, fileSize: 0, storagePath: 'a04_1.webm' },
          { clipId: 'c2', durationSeconds: 705, fileSize: 8629749, storagePath: 'a04_2.webm' },
          { clipId: 'c3', durationSeconds: 1005, fileSize: 12085739, storagePath: 'a04_3.webm' },
        ],
      },
      {
        id: 'm_a04_short_analyzed',
        groupId: 'grp_a04',
        groupName: 'A04',
        weekNumber: 11,
        status: 'ready',
        analyzedAt: '2026-11-12T02:13:00Z',
        rawDiarizedTranscript: '[00:01] Hello',
        audioClips: [
          { clipId: 'c1', durationSeconds: 3, fileSize: 35193, storagePath: 'a04_s.webm' },
        ],
      },
      {
        id: 'm_a04_empty_failed_1',
        groupId: 'grp_a04',
        groupName: 'A04',
        weekNumber: 11,
        status: 'analysis_failed',
        audioClips: [
          { clipId: 'c1', durationSeconds: 1, fileSize: 0, storagePath: 'a04_f1.webm' },
        ],
      },
      {
        id: 'm_a04_empty_failed_2',
        groupId: 'grp_a04',
        groupName: 'A04',
        weekNumber: 11,
        status: 'analysis_failed',
        audioClips: [
          { clipId: 'c1', durationSeconds: 1, fileSize: 0, storagePath: 'a04_f2.webm' },
        ],
      },
      // A02: 1 meeting, 1 clip, pending analysis
      {
        id: 'm_a02_pending',
        groupId: 'grp_a02',
        groupName: 'A02',
        weekNumber: 11,
        status: 'ready',
        audioClips: [
          { clipId: 'c1', durationSeconds: 236, storagePath: 'a02.webm' },
        ],
      },
    ];

    const stats = computeWeekGroupAiStats(testMeetings, 11, testGroups);

    // 1. Group level counts
    expect(stats.recordedGroupsCount).toBe(3); // A01, A04, A02
    expect(stats.analyzedGroupsCount).toBe(2); // A01 and A04
    expect(stats.pendingGroupsCount).toBe(1); // Only A02 is pending!
    expect(stats.emptySessionsCount).toBe(2); // The 2 0-byte stubs of A04

    // 2. Already Analyzed Groups must contain A04 ONCE (no duplicate tags)
    expect(stats.analyzedGroups.length).toBe(2);
    const a04Analyzed = stats.analyzedGroups.find((g) => g.groupId === 'grp_a04');
    expect(a04Analyzed).toBeDefined();
    expect(a04Analyzed.groupName).toBe('A04');
    expect(a04Analyzed.validMeetingsCount).toBe(2);
    expect(a04Analyzed.emptySessionsCount).toBe(2);
    expect(a04Analyzed.isFullyAnalyzed).toBe(true);

    // 3. Pending Groups must NOT contain A04
    expect(stats.pendingGroups.length).toBe(1);
    expect(stats.pendingGroups[0].groupName).toBe('A02');
    expect(stats.pendingGroups.some((g) => g.groupId === 'grp_a04')).toBe(false);

    // 4. Valid and Pending session targets for batch runners
    expect(stats.validSessions.length).toBe(4); // m_a01_1, m_a04_main_analyzed, m_a04_short_analyzed, m_a02_pending
    expect(stats.pendingSessions.length).toBe(1); // Only m_a02_pending (0-byte stubs excluded!)
    expect(stats.pendingSessions[0].id).toBe('m_a02_pending');
  });

  it('supports moving entire meeting to another group, deleting screen clip, and toggling attendance override', async () => {
    mockGroupsSnapshotDocs = [
      {
        id: 'grp_1',
        data: () => ({
          id: 'grp_1',
          name: 'Group A01',
          projectTopic: 'Healthcare Bot',
          supervisorUid: 'sup_1',
          supervisorEmail: 'sup1@vtc.edu.hk',
          supervisorName: 'Supervisor 1',
          members: [{ uid: 'u1', email: 'u1@stu.vtc.edu.hk', name: 'User 1' }],
        }),
      },
      {
        id: 'grp_2',
        data: () => ({
          id: 'grp_2',
          name: 'Group A04',
          projectTopic: 'Smart Campus',
          supervisorUid: 'sup_2',
          supervisorEmail: 'sup2@vtc.edu.hk',
          supervisorName: 'Supervisor 2',
          members: [{ uid: 'u2', email: 'u2@stu.vtc.edu.hk', name: 'User 2' }],
        }),
      },
    ];

    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_move_test',
        data: () => ({
          id: 'mtg_move_test',
          groupId: 'grp_1',
          groupName: 'Group A01',
          weekNumber: 10,
          title: 'Week 10 Supervision Meeting',
          status: 'ready',
          needsReanalysis: true,
          audioClips: [
            { clipId: 'clip_1', label: 'Part 1', durationSeconds: 120, storagePath: 'voice.webm' },
          ],
          screenClips: [
            { clipId: 'scr_1', label: 'Screen 1', studentName: 'User 1', storagePath: 'screen.webm' },
          ],
          attendanceRecord: [
            { uid: 'u1', email: 'u1@stu.vtc.edu.hk', name: 'User 1', status: 'present', speakingContribution: 'high' },
          ],
          rawDiarizedTranscript: '[00:05] Speaker 1: Discussion...',
          keyInsights: { executiveSummary: 'Meeting summary' },
        }),
      },
    ];

    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{ name: 'IT114115 Capstone', teacherEmails: ['sup1@vtc.edu.hk'] }}
        user={{ uid: 'sup_1', email: 'sup1@vtc.edu.hk', displayName: 'Supervisor 1' }}
      />
    );

    // Verify amber banner for needsReanalysis renders
    expect(screen.getByText(/Audio Recordings Modified \(Re-analysis Recommended\)/i)).toBeInTheDocument();

    // Click Re-analysis button on banner
    fireEvent.click(screen.getByRole('button', { name: /✨ Run Gemini Analysis Now/i }));
    await waitFor(() => {
      expect(mockHttpsCallable).toHaveBeenCalled();
    });

    // 1-Click attendance toggle override
    const absentChip = screen.getByRole('button', { name: /Absent/i });
    fireEvent.click(absentChip);
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_move_test' }),
        expect.objectContaining({
          attendanceRecord: expect.arrayContaining([
            expect.objectContaining({ status: 'absent' }),
          ]),
        })
      );
    });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Delete screen clip
    const delScreenBtn = screen.getByRole('button', { name: /🗑️ Delete Screen/i });
    fireEvent.click(delScreenBtn);
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    // Move entire meeting to Group A04
    const moveMeetingSelect = screen.getByLabelText(/Move entire session to another group/i);
    fireEvent.change(moveMeetingSelect, { target: { value: 'grp_2' } });
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_move_test' }),
        expect.objectContaining({
          groupId: 'grp_2',
          groupName: 'Group A04',
          needsReanalysis: true,
        })
      );
    });

    confirmSpy.mockRestore();
  });

  it('supports photo artifact capture, member attribution, canvas compression, gallery preview, lightbox zoom, and deletion', async () => {
    // 1. Verify compressPhotoBlob utility
    const mockFile = new Blob(['fake-image-bytes'], { type: 'image/jpeg' });
    const compressed = await compressPhotoBlob(mockFile, 1280, 0.85);
    expect(compressed).toBeDefined();
    expect(compressed.blob).toBeDefined();
    expect(compressed.width).toBeGreaterThanOrEqual(100);

    // 2. Setup mock meeting with existing photo artifact
    const mockPhoto1 = {
      photoId: 'photo_101',
      label: 'Whiteboard Architecture (Alice Chan)',
      caption: 'Drafted 5 collections',
      downloadUrl: 'https://storage.example.com/photos/photo_101.jpg',
      storagePath: 'projectMeetings/it114115/grp_1/mtg_photo_test/photos/photo_101.jpg',
      studentUid: 'u_alice',
      studentName: 'Alice Chan',
      studentEmail: 'alice@stu.vtc.edu.hk',
      takenAt: '2026-10-15T10:30:00Z',
      fileSize: 250000,
      width: 1280,
      height: 960,
      mimeType: 'image/jpeg',
    };

    mockGroupsSnapshotDocs = [
      {
        id: 'grp_1',
        data: () => ({
          name: 'Group A01',
          projectTopic: 'IoT Smart Clinic',
          supervisorEmail: 'cywong@vtc.edu.hk',
          members: [
            { uid: 'u_alice', name: 'Alice Chan', email: 'alice@stu.vtc.edu.hk', role: 'Leader' },
            { uid: 'u_bob', name: 'Bob Lee', email: 'bob@stu.vtc.edu.hk', role: 'Dev' },
          ],
        }),
      },
    ];

    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_photo_test',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group A01',
          weekNumber: 1,
          title: 'Week 1 Supervision Meeting',
          supervisorEmail: 'cywong@vtc.edu.hk',
          audioClips: [
            {
              clipId: 'c1',
              label: 'Part 1',
              downloadUrl: 'https://storage.example.com/voice1.webm',
              durationSeconds: 120,
            },
          ],
          photos: [mockPhoto1],
          status: 'ready',
        }),
      },
    ];

    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          teacherEmails: ['cywong@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk'],
        }}
        user={{ email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong', uid: 'u_teacher' }}
      />
    );

    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });

    // Verify Inspector photos gallery is rendered
    expect(await screen.findByText(/Meeting Photos & Visual Evidence/i)).toBeInTheDocument();
    expect(screen.getByText('Whiteboard Architecture (Alice Chan)')).toBeInTheDocument();
    expect(screen.getByText('Drafted 5 collections')).toBeInTheDocument();

    // Test Lightbox Zoom
    const zoomTrigger = screen.getByTitle(/Click to Zoom \/ Lightbox/i);
    fireEvent.click(zoomTrigger);

    // Lightbox modal should appear
    expect(screen.getAllByText(/Drafted 5 collections/i).length).toBeGreaterThanOrEqual(1);
    const closeLightboxBtn = screen.getByRole('button', { name: '✕' });
    fireEvent.click(closeLightboxBtn);

    // Open Photo Capture Modal
    const snapPhotoBtn = screen.getByRole('button', { name: /📸 Snap Photo/i });
    fireEvent.click(snapPhotoBtn);

    // Modal title should be visible
    expect(screen.getByText(/📸 Snap Meeting Photo \/ Artifact/i)).toBeInTheDocument();

    // Select category and member attribution
    const categoryBtn = screen.getByRole('button', { name: 'IoT / Hardware Wiring' });
    fireEvent.click(categoryBtn);

    const captionInput = screen.getByPlaceholderText(/Drafted database ERD/i);
    fireEvent.change(captionInput, { target: { value: 'Breadboard circuit wiring for ESP32' } });

    // Simulate uploading photo file via camera input
    const cameraInput = screen.getByTestId('photo-camera-input');
    const testFile = new File(['mock-photo-content'], 'test_circuit.jpg', { type: 'image/jpeg' });
    fireEvent.change(cameraInput, { target: { files: [testFile] } });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_photo_test' }),
        expect.objectContaining({
          photos: expect.objectContaining({
            photoId: expect.stringContaining('photo_'),
            caption: 'Breadboard circuit wiring for ESP32',
            mimeType: 'image/jpeg',
          }),
        })
      );
    });

    // Delete photo artifact
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const deletePhotoBtn = screen.getByTitle('Delete this photo');
    fireEvent.click(deletePhotoBtn);

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_photo_test' }),
        expect.objectContaining({
          photos: [],
        })
      );
    });

    confirmSpy.mockRestore();
  });

  it('supports 720p mobile demo video recording with seamless voice auto-slicing and legacy backward compatibility', async () => {
    const mockStopTrack = vi.fn();
    let capturedConstraints = null;

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockImplementation((constraints) => {
          capturedConstraints = constraints;
          return Promise.resolve({
            getTracks: () => [{ stop: mockStopTrack, readyState: 'live' }],
          });
        }),
      },
    });

    class MockVideoAndAudioRecorder {
      constructor(stream, options) {
        this.stream = stream;
        this.options = options;
        this.mimeType = options?.mimeType || 'video/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
      }
      static isTypeSupported(type) {
        return true;
      }
      start() {
        this.state = 'recording';
        if (this.ondataavailable) {
          this.ondataavailable({ data: new Blob(['video-720p-bytes'], { type: 'video/webm' }) });
        }
      }
      stop() {
        this.state = 'inactive';
        if (this.onstop) this.onstop();
      }
    }
    global.MediaRecorder = MockVideoAndAudioRecorder;

    // Legacy meeting session with ONLY audio clips (no photos, no screenClips)
    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_legacy_voice_only',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group A01',
          weekNumber: 1,
          title: 'Week 1 Legacy Voice Meeting',
          supervisorEmail: 'cywong@vtc.edu.hk',
          audioClips: [
            {
              clipId: 'voice_legacy',
              label: 'Voice Part 1',
              downloadUrl: 'https://storage.example.com/legacy_voice.webm',
              durationSeconds: 180,
            },
          ],
          // Notice: photos and screenClips are completely undefined/absent!
          status: 'ready',
        }),
      },
    ];

    render(
      <ProjectMeetingsView
        classId="it114115"
        classInfo={{
          name: 'Capstone Project',
          teacherEmails: ['cywong@vtc.edu.hk'],
          studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk'],
        }}
        user={{ email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong', uid: 'u_teacher' }}
      />
    );

    fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });

    // Verify backward compatibility: renders legacy meeting cleanly without crash
    expect(await screen.findByText(/1 Voice Part\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText(/0 Demo\/Screen Clip\(s\)/i)).toBeInTheDocument();
    expect(screen.getByText(/0 Photo\(s\)/i)).toBeInTheDocument();

    // 1. Start continuous voice recording in Studio
    const startRecBtn = screen.getByRole('button', { name: /Record Next Clip in Meeting/i });
    fireEvent.click(startRecBtn);

    await waitFor(() => {
      expect(screen.getByText(/REC 00:00/i)).toBeInTheDocument();
    });

    // 2. Teacher clicks 📹 Record Demo (720p) while voice recording is actively running
    const recDemoBtn = screen.getByRole('button', { name: /📹 Record Demo \(720p\)/i });
    fireEvent.click(recDemoBtn);

    // Voice recording should auto-slice Part 1, saving it first
    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    // 3. Viewfinder opens with 720p resolution indicator
    expect(screen.getByText(/720p @ 24\/30 FPS/i)).toBeInTheDocument();
    expect(capturedConstraints?.video?.width?.ideal).toBe(1280);
    expect(capturedConstraints?.video?.height?.ideal).toBe(720);
    expect(capturedConstraints?.video?.facingMode?.ideal).toBe('environment');

    // 4. Start 720p video demo recording
    const start720pBtn = screen.getByRole('button', { name: /🔴 Start 720p Recording/i });
    fireEvent.click(start720pBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /⏹️ Finish & Save Demo Video/i })).toBeInTheDocument();
    });

    // 5. Finish and save video demo
    const finishVideoBtn = screen.getByRole('button', { name: /⏹️ Finish & Save Demo Video/i });
    fireEvent.click(finishVideoBtn);

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'classes/it114115/projectMeetings/mtg_legacy_voice_only' }),
        expect.objectContaining({
          screenClips: expect.objectContaining({
            clipId: expect.stringContaining('demo_'),
            type: 'mobile_camera',
            resolution: '720p',
          }),
        })
      );
    });

    // 6. Voice recording automatically resumed as Part 2!
    await waitFor(() => {
      expect(screen.getByText(/REC 00:00/i)).toBeInTheDocument();
    });
  });

  it('defaults studio week to current calendar week from class schedule and does not lock back to previous week when switching groups', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-12T10:00:00Z'));
    try {
      render(
        <ProjectMeetingsView
          classId="it114115-fyp-2627"
          classInfo={{
            name: 'Final Year Project',
            schedule: {
              startDate: '2026-09-01',
              endDate: '2027-05-04',
            },
            teacherEmails: ['cywong@vtc.edu.hk'],
            studentEmails: ['alice@stu.vtc.edu.hk', 'bob@stu.vtc.edu.hk'],
          }}
          user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
        />
      );

      const weekSelect = screen.getByLabelText(/📅 Week #:/i);
      // Fixed date (Nov 12, 2026) is Week 11 based on startDate 2026-09-01 (Monday Aug 31)
      expect(Number(weekSelect.value)).toBe(11);

      // Switching to a group that has no meeting in Week 11 must NOT lock or snap back to Week 10
      fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_1' } });
      expect(Number(weekSelect.value)).toBe(11);

      // Teacher can also explicitly switch weeks and it remains on the selected week
      fireEvent.change(weekSelect, { target: { value: '12' } });
      expect(Number(weekSelect.value)).toBe(12);

      fireEvent.change(screen.getByLabelText(/📁 Project Group:/i), { target: { value: 'grp_2' } });
      expect(Number(weekSelect.value)).toBe(12);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders analysis_failed status badge, error banner, and retry button for failed AI meeting analysis', () => {
    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_failed_1',
        data: () => ({
          id: 'mtg_failed_1',
          groupId: 'grp_1',
          groupName: 'Group A11',
          weekNumber: 3,
          title: 'Week 3 Supervision Meeting',
          status: 'analysis_failed',
          analysisError: 'FAILED_PRECONDITION: Generation blocked.',
          audioClips: [{ clipId: 'c1', label: 'Part 1', durationSeconds: 120, storagePath: 'test.webm' }],
          supervisorEmail: 'cywong@vtc.edu.hk',
        }),
      },
    ];

    render(
      <ProjectMeetingsView
        classId="it114115-fyp-2627"
        classInfo={{
          name: 'Final Year Project',
          schedule: { startDate: '2026-09-01', endDate: '2027-05-04' },
          teacherEmails: ['cywong@vtc.edu.hk'],
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // Select Week 3
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: '3' } });

    // Verify session badge displays '❌ Failed'
    const failedBadge = screen.getByText(/❌ Failed/i);
    expect(failedBadge).toBeInTheDocument();

    // Click meeting card to open inspector panel
    fireEvent.click(failedBadge);

    // Verify Error Banner displays the specific error details
    expect(screen.getByText(/AI Analysis Encountered an Error/i)).toBeInTheDocument();
    expect(screen.getByText(/FAILED_PRECONDITION: Generation blocked/i)).toBeInTheDocument();

    // Verify action button shows '🔄 Retry Gemini Analysis'
    expect(screen.getAllByRole('button', { name: /🔄 Retry Gemini Analysis/i }).length).toBeGreaterThanOrEqual(1);
  });

  it('masks student names and emails across studio, attendance, matrix, and profiles when privacy mode is active', async () => {
    mockProfilesSnapshotDocs = [
      {
        id: 'prof_1',
        data: () => ({
          studentId: '260047062',
          studentName: 'Chan Tai Man',
          email: '260047062@stu.vtc.edu.hk',
          groupCode: 'A11',
          groupName: 'Group A11',
          avgLogQualityScore: 8.5,
          totalWeeksSubmitted: 3,
          activeYesWeeks: 3,
          inactiveNoWeeks: 0,
          genuineLogsCount: 3,
          vagueLogsCount: 0,
          suspectedAiLogsCount: 0,
          meetingsAttended: 3,
          meetingsTotal: 3,
          weeklyTimeline: [],
        }),
      },
    ];

    mockMeetingsSnapshotDocs = [
      {
        id: 'mtg_privacy_test',
        data: () => ({
          groupId: 'grp_1',
          groupName: 'Group A11',
          weekNumber: 3,
          title: 'Week 3 Sprint Review',
          status: 'ready',
          supervisorEmail: 'cywong@vtc.edu.hk',
          supervisorName: 'Dr. Wong',
          attendanceRecord: [
            { uid: 'stu_1', name: 'Alice Chan', email: 'alice@stu.vtc.edu.hk', status: 'present', speakingContribution: 'high' },
          ],
          studentContributions: [
            { uid: 'stu_1', name: 'Alice Chan', email: 'alice@stu.vtc.edu.hk', workCompleted: ['Firestore schema'], logQualityScore: 9, realWorkScore: 9, weeklyFeedback: 'Outstanding work' },
          ],
        }),
      },
    ];

    render(
      <ProjectMeetingsView
        classId="it114115-fyp-2627"
        classInfo={{
          name: 'Final Year Project',
          schedule: { startDate: '2026-09-01', endDate: '2027-05-04' },
          teacherEmails: ['cywong@vtc.edu.hk'],
        }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
        isPrivacyMode={true}
      />
    );

    // 1. Studio presenter select has masked student names
    const presenterSelect = screen.getByLabelText(/👤 Presenting Member/i);
    expect(presenterSelect.textContent).toContain('C****** W***');
    expect(presenterSelect.textContent).not.toContain('Charlie Wong');

    // 2. Select Week 3 meeting to open inspector
    fireEvent.change(screen.getByLabelText(/📅 Week #:/i), { target: { value: '3' } });
    const meetingCard = screen.getByText(/Week 3: Week 3 Sprint Review/i);
    fireEvent.click(meetingCard);

    // 3. Attendance card has masked name and masked email
    expect(screen.getByText('A**** C***')).toBeInTheDocument();
    expect(screen.getByText('al***@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.queryByText('alice@stu.vtc.edu.hk')).toBeNull();

    // 4. Switch to Student Contribution Profiles tab
    fireEvent.click(screen.getByRole('button', { name: /👤 Student Contribution Profiles/i }));
    expect(screen.getAllByText((content) => content.includes('C*** T** M**')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Chan Tai Man')).toBeNull();

    // 5. Switch to Weekly Matrix & Export tab
    fireEvent.click(screen.getByRole('button', { name: /📊 Weekly Matrix & Export/i }));
    expect(screen.getAllByText('A**** C***').length).toBeGreaterThan(0);
  });

  it('persists selected group in localStorage across reloads and supports 4-column Quick Group Picker with stream filtering and explicit group name on the record button', () => {
    window.localStorage.clear();
    mockGroupsSnapshotDocs = [
      { id: 'grp_a01', data: () => ({ id: 'grp_a01', name: 'A01', projectTopic: 'Alpha Bot', members: [{ uid: 's1', name: 'S1' }] }) },
      { id: 'grp_a04', data: () => ({ id: 'grp_a04', name: 'A04', projectTopic: 'Smart IoT', members: [{ uid: 's2', name: 'S2' }] }) },
      { id: 'grp_e01', data: () => ({ id: 'grp_e01', name: 'E01', projectTopic: 'Edge AI', members: [{ uid: 's3', name: 'S3' }] }) },
    ];
    mockMeetingsSnapshotDocs = [];

    const { unmount } = render(
      <ProjectMeetingsView
        classId="it114115-mobile-test"
        classInfo={{ name: 'FYP', teacherEmails: ['cywong@vtc.edu.hk'] }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // Initially defaults to first group A01, reflected explicitly on the record button
    expect(screen.getByRole('button', { name: /Start Meeting Recording — A01/i })).toBeInTheDocument();

    // Open Quick Group Picker modal via the inline grid trigger
    fireEvent.click(screen.getByRole('button', { name: /⊞ Quick Grid \(3\)/i }));
    const pickerDialog = screen.getByRole('dialog', { name: /Select Project Group/i });
    expect(pickerDialog).toBeInTheDocument();

    // Stream tabs (Stream A, Stream E) should be dynamically extracted
    expect(within(pickerDialog).getByRole('button', { name: /Stream A \(2\)/i })).toBeInTheDocument();
    expect(within(pickerDialog).getByRole('button', { name: /Stream E \(1\)/i })).toBeInTheDocument();

    // Filter by Stream E and verify A04 is filtered out inside the modal, then switch back to All
    fireEvent.click(within(pickerDialog).getByRole('button', { name: /Stream E \(1\)/i }));
    expect(within(pickerDialog).queryByRole('button', { name: /A04/i })).toBeNull();
    fireEvent.click(within(pickerDialog).getByRole('button', { name: /All \(3\)/i }));

    // Select A04 from the grid
    fireEvent.click(within(pickerDialog).getByRole('button', { name: /A04/i }));
    expect(screen.queryByRole('dialog', { name: /Select Project Group/i })).toBeNull();

    // Record button now explicitly states A04!
    expect(screen.getByRole('button', { name: /Start Meeting Recording — A04/i })).toBeInTheDocument();

    // Verify localStorage persisted grp_a04
    expect(window.localStorage.getItem('agy_studio_group_it114115-mobile-test_cywong@vtc.edu.hk')).toBe('grp_a04');

    // Unmount and remount (simulating mobile Safari tab reload after screen unlock)
    unmount();
    render(
      <ProjectMeetingsView
        classId="it114115-mobile-test"
        classInfo={{ name: 'FYP', teacherEmails: ['cywong@vtc.edu.hk'] }}
        user={{ uid: 't_1', email: 'cywong@vtc.edu.hk', displayName: 'Dr. Wong' }}
      />
    );

    // Restores A04 instead of resetting to A01!
    expect(screen.getByRole('button', { name: /Start Meeting Recording — A04/i })).toBeInTheDocument();
    window.localStorage.clear();
  });

  it('aggregates duplicate/failed/empty takes per week in the redesigned sidebar, separates Analyzed from At Risk, and supports Week Overview mode', () => {
    // Unit-check getMeetingPipelineAndHealth separation
    const analyzedAtRisk = getMeetingPipelineAndHealth({
      analyzedAt: '2026-11-18T00:00:00Z',
      audioClips: [{ clipId: 'c1', durationSeconds: 1712, storagePath: 'a.webm' }],
      keyInsights: { overallGroupProgress: 'at_risk' },
    });
    expect(analyzedAtRisk.pipelineKey).toBe('analyzed');
    expect(analyzedAtRisk.pipelineLabel).toBe('✨ Analyzed');
    expect(analyzedAtRisk.healthLabel).toBe('⚠️ At Risk');

    // Unit-check aggregateGroupWeekSessions on A04 (5 Week 11 docs + 1 Week 10 doc => 2 distinct weeks)
    const a04Docs = [
      { id: 'w11_rec', groupId: 'grp_a04', weekNumber: 11, status: 'recording', audioClips: [] },
      { id: 'w11_fail1', groupId: 'grp_a04', weekNumber: 11, status: 'analysis_failed', audioClips: [] },
      { id: 'w11_fail2', groupId: 'grp_a04', weekNumber: 11, status: 'analysis_failed', audioClips: [] },
      {
        id: 'w11_main',
        groupId: 'grp_a04',
        weekNumber: 11,
        analyzedAt: '2026-11-18T01:00:00Z',
        audioClips: [{ clipId: 'c1', durationSeconds: 1712, storagePath: 'main.webm' }],
        keyInsights: { overallGroupProgress: 'at_risk' },
      },
      {
        id: 'w11_short',
        groupId: 'grp_a04',
        weekNumber: 11,
        analyzedAt: '2026-11-18T01:00:00Z',
        audioClips: [{ clipId: 'c2', durationSeconds: 3, storagePath: 'short.webm' }],
      },
      {
        id: 'w10_main',
        groupId: 'grp_a04',
        weekNumber: 10,
        analyzedAt: '2026-11-11T01:00:00Z',
        audioClips: [{ clipId: 'c3', durationSeconds: 309, storagePath: 'w10.webm' }],
        keyInsights: { overallGroupProgress: 'at_risk' },
      },
    ];
    const agg = aggregateGroupWeekSessions(a04Docs);
    expect(agg.distinctWeeksCount).toBe(2);
    expect(agg.weekSlots).toHaveLength(2);
    expect(agg.weekSlots[0].primary.id).toBe('w11_main');
    expect(agg.weekSlots[0].extraTakes).toHaveLength(4);

    // Render component with A04 (expanded) and A07 (no recordings, collapsed)
    mockGroupsSnapshotDocs = [
      { id: 'grp_a04', data: () => ({ id: 'grp_a04', name: 'A04', supervisorEmail: 'kcheung@vtc.edu.hk' }) },
      { id: 'grp_a07', data: () => ({ id: 'grp_a07', name: 'A07', supervisorEmail: 'hli852@vtc.edu.hk' }) },
    ];
    mockMeetingsSnapshotDocs = a04Docs.map((d) => ({ id: d.id, data: () => d }));

    render(
      <ProjectMeetingsView
        classId="it114115-sidebar-test"
        classInfo={{ name: 'FYP', teacherEmails: ['kcheung@vtc.edu.hk'] }}
        user={{ uid: 't_1', email: 'kcheung@vtc.edu.hk', displayName: 'Kitson' }}
      />
    );

    // A04 header should say '2 wks', NOT '6 wk(s)'
    expect(screen.getByText('2 wks')).toBeInTheDocument();
    // Both '✨ Analyzed' and '⚠️ At Risk' should be visible independently
    expect(screen.getAllByText('✨ Analyzed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('⚠️ At Risk').length).toBeGreaterThanOrEqual(2);

    // The 4 duplicate/failed/0s Week 11 takes are collapsed under '+4 other takes'
    const extraToggle = screen.getByRole('button', { name: /\+4 other takes/i });
    expect(extraToggle).toBeInTheDocument();
    fireEvent.click(extraToggle);
    expect(screen.getByText('Take #2')).toBeInTheDocument();

    // Switch to 'Wk 11' overview tab and verify week summary bar renders
    fireEvent.click(screen.getByRole('tab', { name: /Wk 11/i }));
    expect(screen.getByText(/Week 11 Overview/i)).toBeInTheDocument();
    expect(screen.getByText(/⚪ Not recorded/i)).toBeInTheDocument();
  });
});
