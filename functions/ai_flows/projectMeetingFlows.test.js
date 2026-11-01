import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocGet = vi.fn();
const mockDocUpdate = vi.fn().mockResolvedValue(true);
const mockCollectionWhereGet = vi.fn().mockResolvedValue({ docs: [] });

vi.mock('./firebase.js', () => ({}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    projectId: 'it114115-dev-2026',
    doc: (path) => ({
      path,
      get: () => mockDocGet(path),
      update: (data) => mockDocUpdate(path, data),
    }),
    collection: (path) => ({
      where: () => ({
        get: () => mockCollectionWhereGet(path),
      }),
    }),
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP',
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    app: { options: { storageBucket: 'test-bucket.firebasestorage.app' } },
    bucket: () => ({ name: 'test-bucket.firebasestorage.app' }),
  }),
}));

const mockGenerateWithResilience = vi.fn();
vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: (...args) => mockGenerateWithResilience(...args),
}));

vi.mock('./jobLogger.js', () => ({
  logJob: vi.fn().mockResolvedValue(true),
}));

import {
  formatSecondsToMmSs,
  parseTimestampToSeconds,
  offsetTranscriptTimestamps,
  isLongClipTranscriptTruncated,
  resolveAudioMimeType,
  reconcileMeetingRosterResults,
  handleAnalyzeProjectMeeting,
} from './projectMeetingFlows.js';

describe('projectMeetingFlows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects prematurely truncated transcripts on 20-minute (1200s) clips', () => {
    expect(isLongClipTranscriptTruncated('[00:10] Speaker 1: Short clip.', 180)).toBe(false);
    // 20-min (1200s) clip that stopped at [03:15] (195s < 540s) due to a silence pause
    const cutEarly =
      '[00:05] Speaker 1: Welcome to our 20-minute project supervision meeting.\n[01:40] Speaker 2: I am presenting the database schema and API routes today.\n[03:15] Speaker 1: Let me check your code.';
    expect(isLongClipTranscriptTruncated(cutEarly, 1200)).toBe(true);
    // 20-min (1200s) clip that continued through [18:45] (1125s >= 540s)
    const full20Min = `${cutEarly}\n[12:30] Speaker 3: Here is my frontend demo.\n[18:45] Speaker 1: Great job everyone, see you next week.`;
    expect(isLongClipTranscriptTruncated(full20Min, 1200)).toBe(false);
  });

  it('formats and shifts multi-clip timestamps accurately', () => {
    expect(formatSecondsToMmSs(125)).toBe('02:05');
    expect(parseTimestampToSeconds('[02:05]')).toBe(125);
    const shifted = offsetTranscriptTimestamps(
      '[00:10] Speaker 1: Welcome back to Part 2.\n[01:20] Speaker 2: Here is the backend demo.',
      300
    );
    expect(shifted).toContain('[05:10] Speaker 1: Welcome back to Part 2.');
    expect(shifted).toContain('[06:20] Speaker 2: Here is the backend demo.');
  });

  it('resolves audio MIME types for Android WebM and iOS Safari M4A/MP4', () => {
    expect(resolveAudioMimeType('clip_1.webm')).toBe('audio/webm');
    expect(resolveAudioMimeType('clip_1.m4a')).toBe('audio/mp4');
    expect(resolveAudioMimeType('clip_1.mp3')).toBe('audio/mpeg');
    expect(resolveAudioMimeType('clip_1.bin', 'audio/mp4; codecs=mp4a.40.2')).toBe('audio/mp4');
  });

  it('reconciles roster attendance honoring 1-tap voiceAnchors, Student PC screenClips, and manual supervisor overrides', () => {
    const members = [
      { uid: 'stu_1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan', role: 'Leader' },
      { uid: 'stu_2', email: 'bob@stu.vtc.edu.hk', name: 'Bob Lee', role: 'Member' },
      { uid: 'stu_3', email: 'charlie@stu.vtc.edu.hk', name: 'Charlie Wong', role: 'Member' },
    ];

    const { attendanceRecord, studentContributions } = reconcileMeetingRosterResults({
      members,
      existingAttendance: [
        { uid: 'stu_3', email: 'charlie@stu.vtc.edu.hk', status: 'late', teacherVerified: true },
      ],
      aiAttendance: [
        {
          uid: 'stu_1',
          email: 'alice@stu.vtc.edu.hk',
          name: 'Alice Chan',
          status: 'present',
          speakingContribution: 'high',
          evidence: '[00:35] Presented React UI.',
          firstHeardTimestamp: '00:35',
        },
      ],
      aiContributions: [
        {
          email: 'alice@stu.vtc.edu.hk',
          workCompleted: ['Built ProjectMeetingsView UI'],
          currentChallenges: ['CSS responsive layout'],
          actionItemsNextWeek: ['Add unit tests'],
          aiContributionAssessment: 'Strong progress.',
          timestamps: ['00:35'],
        },
      ],
      // Bob didn't get matched by AI name, but Supervisor tapped Speaking Now AND Bob shared his PC screen!
      voiceAnchors: [
        { timeSeconds: 140, timestamp: '02:20', studentUid: 'stu_2', email: 'bob@stu.vtc.edu.hk', name: 'Bob Lee' },
      ],
      screenClips: [
        { studentUid: 'stu_2', studentEmail: 'bob@stu.vtc.edu.hk', studentName: 'Bob Lee', label: 'Part 2 — Bob PC' },
      ],
    });

    expect(attendanceRecord).toHaveLength(3);
    const alice = attendanceRecord.find((a) => a.uid === 'stu_1');
    const bob = attendanceRecord.find((a) => a.uid === 'stu_2');
    const charlie = attendanceRecord.find((a) => a.uid === 'stu_3');

    expect(alice.status).toBe('present');
    expect(bob.status).toBe('present');
    expect(bob.teacherVerified).toBe(true);
    expect(bob.evidence).toContain('02:20');
    expect(charlie.status).toBe('late');
    expect(charlie.teacherVerified).toBe(true);

    const bobContrib = studentContributions.find((c) => c.uid === 'stu_2');
    expect(bobContrib.timestamps).toContain('02:20');
  });

  it('executes Two-Stage gemini-3.5-transcribe-preview diarization + gemini-3.8-flash reasoning across grouped audioClips', async () => {
    mockDocGet.mockImplementation(async (path) => {
      if (path === 'classes/it114115/projectMeetings/m_wk5') {
        return {
          exists: true,
          data: () => ({
            groupId: 'grp_1',
            groupName: 'Group 1 - AI Smart Inventory',
            weekNumber: 5,
            title: 'Week 5 Progress Review',
            supervisorEmail: 'cywong@vtc.edu.hk',
            supervisorName: 'Dr. Wong',
            audioClips: [
              {
                clipId: 'c1',
                label: 'Part 1',
                storagePath: 'projectMeetings/it114115/grp_1/m_wk5/clip_1.webm',
                durationSeconds: 120,
                mimeType: 'audio/webm',
                presenterStudentName: 'Alice Chan',
              },
              {
                clipId: 'c2',
                label: 'Part 2',
                storagePath: 'projectMeetings/it114115/grp_1/m_wk5/clip_2.m4a',
                durationSeconds: 180,
                mimeType: 'audio/mp4',
                presenterStudentName: 'Bob Lee',
              },
            ],
            voiceAnchors: [
              { timeSeconds: 15, timestamp: '00:15', studentUid: 'stu_1', email: 'alice@stu.vtc.edu.hk', name: 'Alice Chan', clipIndex: 0 },
            ],
            screenClips: [
              { studentUid: 'stu_1', studentEmail: 'alice@stu.vtc.edu.hk', studentName: 'Alice Chan', label: 'Alice PC Screen', durationSeconds: 115 },
            ],
          }),
        };
      }
      if (path === 'classes/it114115/projectGroups/grp_1') {
        return {
          exists: true,
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
        };
      }
      return { exists: false };
    });

    // Stage 1 Clip 1 (gemini-3.5-transcribe-preview)
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '[00:00] Speaker 1: Let us start Week 5.\n[00:15] Speaker 2: I am Alice, I completed the Firestore rules.',
        usage: { inputTokens: 300, outputTokens: 80 },
      },
      modelUsed: 'gemini-3.5-transcribe-preview',
    });

    // Stage 1 Clip 2 (gemini-3.5-transcribe-preview)
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '[00:10] Speaker 3: I am Bob, I built the PC screen recorder hook.',
        usage: { inputTokens: 350, outputTokens: 70 },
      },
      modelUsed: 'gemini-3.5-transcribe-preview',
    });

    // Stage 2 Reasoning (gemini-3.8-flash)
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          attendanceRecord: [
            {
              uid: 'stu_1',
              email: 'alice@stu.vtc.edu.hk',
              name: 'Alice Chan',
              status: 'present',
              speakingContribution: 'high',
              evidence: '[00:15] Completed Firestore security rules.',
              firstHeardTimestamp: '00:15',
            },
            {
              uid: 'stu_2',
              email: 'bob@stu.vtc.edu.hk',
              name: 'Bob Lee',
              status: 'present',
              speakingContribution: 'high',
              evidence: '[02:10] Built PC screen recorder hook.',
              firstHeardTimestamp: '02:10',
            },
          ],
          keyInsights: {
            executiveSummary: 'Both Alice and Bob delivered their assigned Week 5 modules on schedule.',
            overallGroupProgress: 'ahead',
            keyDecisions: ['Use Firestore activeMeetingCaptures for dual-device sync'],
            blockersAndRisks: [],
            supervisorFeedback: ['Ready for next week prototype demo'],
          },
          studentContributions: [
            {
              uid: 'stu_1',
              email: 'alice@stu.vtc.edu.hk',
              name: 'Alice Chan',
              workCompleted: ['Firestore security rules for projectGroups and projectMeetings'],
              currentChallenges: [],
              actionItemsNextWeek: ['Prepare integration test'],
              aiContributionAssessment: 'Excellent delivery.',
              timestamps: ['00:15'],
            },
            {
              uid: 'stu_2',
              email: 'bob@stu.vtc.edu.hk',
              name: 'Bob Lee',
              workCompleted: ['Student PC screen recorder hook'],
              currentChallenges: [],
              actionItemsNextWeek: ['Add WebM duration header injection'],
              aiContributionAssessment: 'Solid technical implementation.',
              timestamps: ['02:10'],
            },
          ],
          transcriptSegments: [
            { startTime: '00:00', endTime: '00:14', speaker: 'Supervisor (Dr. Wong)', text: 'Let us start Week 5.' },
            { startTime: '00:15', endTime: '01:55', speaker: 'Alice Chan', text: 'I completed the Firestore rules.' },
            { startTime: '02:10', endTime: '04:50', speaker: 'Bob Lee', text: 'I built the PC screen recorder hook.' },
          ],
        }),
        usage: { inputTokens: 900, outputTokens: 450 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const result = await handleAnalyzeProjectMeeting({
      classId: 'it114115',
      meetingId: 'm_wk5',
      auth: { uid: 'teacher_1', token: { email: 'cywong@vtc.edu.hk', role: 'teacher' } },
    });

    expect(result.success).toBe(true);
    expect(result.aiModelUsed).toBe('gemini-3.5-transcribe-preview + gemini-3.8-flash');
    expect(result.attendanceRecord).toHaveLength(2);
    expect(result.keyInsights.overallGroupProgress).toBe('ahead');
    expect(result.studentContributions[0].workCompleted[0]).toContain('Firestore security rules');
    expect(result.studentContributions[1].workCompleted[0]).toContain('Student PC screen recorder');
    expect(mockGenerateWithResilience).toHaveBeenCalledTimes(3);
  });

  it('supports pre-meeting AI Log Audit & Fake-Log Challenge Question generation (mode === "prepare_log_questions")', async () => {
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          preMeetingLogAudit: [
            {
              studentId: '250105348',
              email: '250105348@stu.vtc.edu.hk',
              name: 'Chan Tai Man',
              logQualityStatus: 'suspected_ai_fake',
              logQualityScore: 4,
              logAuditSummary: 'Sudden jump from writing "done" to claiming full Flask backend, RBAC, and mock AI chatbot.',
              challengeQuestions: [
                'Open your Flask route file right now and explain how the Doctor/Patient RBAC check works line by line.',
                'Which database table stores the chatbot history, and what bug did you hit while connecting it?',
              ],
            },
          ],
        }),
        usage: { inputTokens: 450, outputTokens: 210 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleAnalyzeProjectMeeting({
      classId: 'it114115',
      mode: 'prepare_log_questions',
      groupId: 'grp_a11',
      groupName: 'A11',
      weekNumber: 8,
      weeklyLogs: [
        {
          studentId: '250105348',
          email: '250105348@stu.vtc.edu.hk',
          studentName: 'Chan Tai Man',
          isDoingSomething: true,
          workDone: 'Completed frontend and backend integration using Flask. Implemented real-time dashboards, history pages, mock AI chatbot, and basic role-based access control (Doctor/Patient).',
          nextPlan: 'Deploy',
          priorHistory: [
            { weekNumber: 6, isDoingSomething: true, workDone: 'done', nextPlan: 'do website' },
            { weekNumber: 7, isDoingSomething: true, workDone: 'done', nextPlan: 'do website' },
          ],
        },
      ],
      auth: { uid: 'teacher_1', token: { email: 'cywong@vtc.edu.hk', role: 'teacher' } },
    });

    expect(res.success).toBe(true);
    expect(res.mode).toBe('prepare_log_questions');
    expect(res.preMeetingLogAudit).toHaveLength(1);
    expect(res.preMeetingLogAudit[0].logQualityStatus).toBe('suspected_ai_fake');
    expect(res.preMeetingLogAudit[0].challengeQuestions).toHaveLength(2);
  });
});
