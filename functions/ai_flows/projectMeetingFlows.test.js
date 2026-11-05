import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDocGet = vi.fn();
const mockDocUpdate = vi.fn().mockResolvedValue(true);
const mockDocSet = vi.fn().mockResolvedValue(true);
const mockCollectionWhereGet = vi.fn().mockResolvedValue({ docs: [] });

vi.mock('./firebase.js', () => ({}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    projectId: 'it114115-dev-2026',
    doc: (path) => ({
      path,
      get: () => mockDocGet(path),
      update: (data) => mockDocUpdate(path, data),
      set: (data, opts) => mockDocSet(path, data, opts),
    }),
    collection: (path) => ({
      where: () => ({
        get: () => mockCollectionWhereGet(path),
      }),
    }),
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_SERVER_TIMESTAMP',
    delete: () => 'FIELD_DELETED',
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

const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'msg-123' });
const mockCreateTransport = vi.fn(() => ({
  sendMail: (...args) => mockSendMail(...args),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args) => mockCreateTransport(...args),
  },
}));

import {
  formatSecondsToMmSs,
  parseTimestampToSeconds,
  offsetTranscriptTimestamps,
  isLongClipTranscriptTruncated,
  resolveAudioMimeType,
  reconcileMeetingRosterResults,
  handlePrepareProjectLogQuestions,
  handleAnalyzeProjectMeeting,
  analyzeProjectMeeting,
  generateMeetingEmailHtml,
  handleEmailProjectMeetingReport,
  emailProjectMeetingReport,
  handleBatchEmailProjectMeetingReports,
  batchEmailProjectMeetingReports,
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

  it('handles edge cases in timestamp parsing, offsetting, truncation detection, and audio MIME types', () => {
    expect(parseTimestampToSeconds(95.8)).toBe(95);
    expect(parseTimestampToSeconds(null)).toBe(0);
    expect(parseTimestampToSeconds('invalid:ts')).toBe(0);
    expect(parseTimestampToSeconds('[01:02:05]')).toBe(3725);
    expect(parseTimestampToSeconds('45')).toBe(45);

    expect(offsetTranscriptTimestamps('', 100)).toBe('');
    expect(offsetTranscriptTimestamps('[00:10] Hello', 0)).toBe('[00:10] Hello');

    expect(isLongClipTranscriptTruncated('Too short', 600)).toBe(true);
    expect(isLongClipTranscriptTruncated('A'.repeat(150), 600)).toBe(false);

    expect(resolveAudioMimeType('clip.wav')).toBe('audio/wav');
    expect(resolveAudioMimeType('clip.ogg')).toBe('audio/ogg');
    expect(resolveAudioMimeType('clip.opus')).toBe('audio/ogg');
    expect(resolveAudioMimeType('clip.mp4')).toBe('audio/mp4');
  });

  it('validates arguments, markdown fences, JSON fallback, and meetingId persistence in handlePrepareProjectLogQuestions', async () => {
    await expect(handlePrepareProjectLogQuestions({ classId: '' })).rejects.toThrow(/classId/);
    await expect(handlePrepareProjectLogQuestions({ classId: 'c1', weeklyLogs: [] })).rejects.toThrow(/weeklyLogs/);

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '```json\n{"preMeetingLogAudit":[{"studentId":"1","logQualityStatus":"genuine","logQualityScore":9}]}\n```',
        usage: { promptTokenCount: 100, candidatesTokenCount: 50 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res1 = await handlePrepareProjectLogQuestions({
      classId: 'c1',
      meetingId: 'm1',
      weeklyLogs: [{ studentName: 'Alice', isDoingSomething: false, submitted: false, inactiveReason: 'Holiday' }],
    });
    expect(res1.preMeetingLogAudit).toHaveLength(1);
    expect(mockDocSet).toHaveBeenCalledWith(
      'classes/c1/projectMeetings/m1',
      expect.objectContaining({ preMeetingLogAudit: res1.preMeetingLogAudit }),
      { merge: true }
    );

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '```\nNOT_VALID_JSON\n```',
        usage: {},
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res2 = await handlePrepareProjectLogQuestions({
      classId: 'c1',
      weeklyLogs: [{ studentName: 'Bob', isDoingSomething: true, workDone: 'API' }],
    });
    expect(res2.preMeetingLogAudit).toEqual([]);
  });

  it('handles prior week context, long-clip truncation fallback, JSON parse fallback, and error recovery in handleAnalyzeProjectMeeting', async () => {
    await expect(handleAnalyzeProjectMeeting({ classId: 'c1', meetingId: '' })).rejects.toThrow(/required/);

    mockDocGet.mockResolvedValueOnce({ exists: false });
    await expect(handleAnalyzeProjectMeeting({ classId: 'c1', meetingId: 'missing' })).rejects.toThrow(/not found/);

    mockDocGet.mockResolvedValueOnce({ exists: true, data: () => ({ groupId: '' }) });
    await expect(handleAnalyzeProjectMeeting({ classId: 'c1', meetingId: 'no_audio' })).rejects.toThrow(
      /No voice recording clips/
    );

    // Full run with legacy audioStoragePath, prior week meetings, long-clip fallback, and non-JSON Stage 2 response
    mockDocGet.mockImplementation(async (path) => {
      if (path === 'classes/c1/projectMeetings/m_long') {
        return {
          exists: true,
          data: () => ({
            groupId: 'g1',
            weekNumber: 6,
            audioStoragePath: 'gs://test-bucket/clip_long.webm',
            durationSeconds: 1200,
            weeklyLogs: [
              {
                studentName: 'Alice',
                email: 'alice@stu.vtc.edu.hk',
                isDoingSomething: true,
                workDone: 'Built UI',
                priorHistory: [{ weekNumber: 5, workDone: 'Setup' }],
              },
            ],
          }),
        };
      }
      if (path === 'classes/c1/projectGroups/g1') {
        return {
          exists: true,
          data: () => ({
            name: 'Group 1',
            members: [{ uid: 'u1', email: 'alice@stu.vtc.edu.hk', name: 'Alice' }],
          }),
        };
      }
      return { exists: false };
    });

    mockCollectionWhereGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'm_prev',
          data: () => ({
            weekNumber: 5,
            status: 'ready',
            studentContributions: [
              { name: 'Alice', email: 'alice@stu.vtc.edu.hk', actionItemsNextWeek: ['Finish login page'] },
            ],
          }),
        },
      ],
    });

    // Stage 1 initial truncated transcript on 1200s clip
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        message: { content: [{ text: '[00:05] Speaker 1: Short cut off.' }] },
        usage: { promptTokenCount: 100, candidatesTokenCount: 20 },
      },
      modelUsed: 'gemini-3.5-transcribe-preview',
    });

    // Stage 1 long-clip recovery via gemini-3.8-flash
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '[00:05] Speaker 1: Full recovered transcript from start to [19:30] end of meeting.',
        usage: { promptTokenCount: 200, candidatesTokenCount: 100 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    // Stage 2 returns non-JSON text inside code fence to exercise fallback wrapper
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '```\nNon-JSON summary text from reasoning model\n```',
        usage: { promptTokenCount: 300, candidatesTokenCount: 80 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleAnalyzeProjectMeeting({
      classId: 'c1',
      meetingId: 'm_long',
      auth: { uid: 't1', token: { email: 't1@vtc.edu.hk', role: 'teacher' } },
    });
    expect(res.success).toBe(true);
    expect(res.keyInsights.executiveSummary).toContain('Non-JSON summary text');

    // Pipeline error handling branch
    mockGenerateWithResilience.mockRejectedValueOnce(new Error('Vertex quota exceeded'));
    await expect(
      handleAnalyzeProjectMeeting({
        classId: 'c1',
        meetingId: 'm_long',
        auth: { uid: 't1', token: { email: 't1@vtc.edu.hk', role: 'teacher' } },
      })
    ).rejects.toThrow(/Vertex quota exceeded/);
  });

  it('enforces authentication and teacher/supervisor authorization in analyzeProjectMeeting callable', async () => {
    await expect(analyzeProjectMeeting.run({ auth: null, data: {} })).rejects.toThrow(/Authentication is required/);

    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ teacherEmails: ['other@vtc.edu.hk'], ownerUid: 'owner_1' }),
    });
    await expect(
      analyzeProjectMeeting.run({
        auth: { uid: 'stu_1', token: { email: 'stu@stu.vtc.edu.hk', role: 'student' } },
        data: { classId: 'c1', meetingId: 'm1' },
      })
    ).rejects.toThrow(/Only class teachers and project supervisors/);

    // Authorized via class teacherEmails
    mockDocGet.mockImplementation(async (path) => {
      if (path === 'classes/c1') {
        return {
          exists: true,
          data: () => ({ teacherEmails: ['cosup@vtc.edu.hk'] }),
        };
      }
      return { exists: false };
    });
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: { text: JSON.stringify({ preMeetingLogAudit: [] }), usage: {} },
      modelUsed: 'gemini-3.8-flash',
    });

    const okRes = await analyzeProjectMeeting.run({
      auth: { uid: 'cosup_1', token: { email: 'cosup@vtc.edu.hk', role: 'student' } },
      data: {
        classId: 'c1',
        mode: 'prepare_log_questions',
        weeklyLogs: [{ studentName: 'Alice', isDoingSomething: true, workDone: 'Done API' }],
      },
    });
    expect(okRes.success).toBe(true);
  });

  describe('emailProjectMeetingReport and HTML generation', () => {
    it('generates HTML email report containing scores, attendance, and feedback', () => {
      const html = generateMeetingEmailHtml({
        meeting: {
          weekNumber: 10,
          title: 'Sprint Review',
          meetingDate: '2026-11-01T10:00:00Z',
          supervisorName: 'Dr. Alan Turing',
          keyInsights: { weeklyGroupFeedback: 'Group is making steady progress' },
        },
        group: {
          name: 'Group A10',
          projectTopic: 'AI Classroom Assistant',
        },
        student: {
          name: 'Alice Wong',
          email: 'alice@stu.vtc.edu.hk',
        },
        attendance: {
          status: 'late',
        },
        contribution: {
          realWorkScore: 9,
          logQualityScore: 8,
          weeklyFeedback: 'Excellent architecture diagrams and Dockerfile setup.',
          challengeQuestions: ['How will container scaling be handled?'],
          workCompleted: ['Configured Docker Compose', 'Integrated Auth'],
          actionItemsNextWeek: ['Deploy to Cloud Run'],
        },
      });

      expect(html).toContain('Week 10');
      expect(html).toContain('Sprint Review');
      expect(html).toContain('Group A10');
      expect(html).toContain('AI Classroom Assistant');
      expect(html).toContain('Alice Wong');
      expect(html).toContain('Dr. Alan Turing');
      expect(html).toContain('🕒 Late');
      expect(html).toContain('Real Work Score: 9/10');
      expect(html).toContain('Log Quality Score: 8/10');
      expect(html).toContain('Excellent architecture diagrams and Dockerfile setup.');
      expect(html).toContain('How will container scaling be handled?');
      expect(html).toContain('Configured Docker Compose');
      expect(html).toContain('Deploy to Cloud Run');
      expect(html).toContain('Group is making steady progress');
      expect(html).toContain('/student/records');
    });

    it('rejects handleEmailProjectMeetingReport when SMTP_PASSWORD is not configured', async () => {
      const origPass = process.env.SMTP_PASSWORD;
      delete process.env.SMTP_PASSWORD;

      mockDocGet.mockImplementation(async (path) => {
        if (path === 'classes/c1/projectMeetings/m1') {
          return {
            exists: true,
            data: () => ({ groupId: 'grp_1', weekNumber: 10 }),
          };
        }
        return { exists: false };
      });

      await expect(
        handleEmailProjectMeetingReport({
          classId: 'c1',
          meetingId: 'm1',
          auth: { uid: 'sup_1', token: { email: 'sup@vtc.edu.hk', role: 'teacher' } },
        })
      ).rejects.toThrow(/SMTP password is not configured/);

      if (origPass) process.env.SMTP_PASSWORD = origPass;
    });

    it('dispatches emails via nodemailer and records dispatch in meeting doc', async () => {
      process.env.SMTP_PASSWORD = 'mock-app-password';

      mockDocGet.mockImplementation(async (path) => {
        if (path === 'classes/c1/projectMeetings/m1') {
          return {
            exists: true,
            data: () => ({
              groupId: 'grp_1',
              weekNumber: 10,
              title: 'Sprint Review',
              attendanceRecord: [{ email: 'bob@stu.vtc.edu.hk', status: 'present' }],
              studentContributions: [{ email: 'bob@stu.vtc.edu.hk', realWorkScore: 9, weeklyFeedback: 'Great job!' }],
            }),
          };
        }
        if (path === 'classes/c1/projectGroups/grp_1') {
          return {
            exists: true,
            data: () => ({
              name: 'Group A10',
              members: [{ name: 'Bob', email: 'bob@stu.vtc.edu.hk' }],
            }),
          };
        }
        return { exists: false };
      });

      const res = await handleEmailProjectMeetingReport({
        classId: 'c1',
        meetingId: 'm1',
        auth: { uid: 'teacher_1', token: { email: 'teacher@vtc.edu.hk', role: 'teacher' } },
      });

      expect(res.success).toBe(true);
      expect(res.count).toBe(1);
      expect(mockCreateTransport).toHaveBeenCalled();
      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'bob@stu.vtc.edu.hk',
          subject: expect.stringContaining('Week 10'),
        })
      );
      expect(mockDocUpdate).toHaveBeenCalledWith(
        'classes/c1/projectMeetings/m1',
        expect.objectContaining({
          emailDispatch: expect.objectContaining({
            recipients: ['bob@stu.vtc.edu.hk'],
            totalSent: 1,
          }),
        })
      );

      delete process.env.SMTP_PASSWORD;
    });

    it('enforces authentication and authorization in emailProjectMeetingReport callable', async () => {
      await expect(emailProjectMeetingReport.run({ auth: null, data: {} })).rejects.toThrow(/User must be authenticated/);

      mockDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({ teacherEmails: ['teacher@vtc.edu.hk'], ownerUid: 'teacher_1' }),
      });

      await expect(
        emailProjectMeetingReport.run({
          auth: { uid: 'stu_1', token: { email: 'stu@stu.vtc.edu.hk', role: 'student' } },
          data: { classId: 'c1', meetingId: 'm1' },
        })
      ).rejects.toThrow(/Only teachers and project supervisors can email meeting reports/);
    });

    it('executes handleBatchEmailProjectMeetingReports across all meetings in an academic week', async () => {
      process.env.SMTP_PASSWORD = 'mock-password';

      // Mock meetings query for week 8
      mockCollectionWhereGet.mockResolvedValueOnce({
        docs: [
          {
            id: 'm_wk8_a',
            data: () => ({
              groupId: 'grp_a',
              groupName: 'Group Alpha',
              weekNumber: 8,
              status: 'ready',
              members: [{ uid: 'u1', email: 'u1@stu.vtc.edu.hk', name: 'User 1' }],
            }),
          },
          {
            id: 'm_wk8_b',
            data: () => ({
              groupId: 'grp_b',
              groupName: 'Group Beta',
              weekNumber: 8,
              status: 'ready',
              members: [{ uid: 'u2', email: 'u2@stu.vtc.edu.hk', name: 'User 2' }],
            }),
          },
        ],
      });

      mockDocGet.mockImplementation(async (path) => {
        if (path === 'classes/c1/projectMeetings/m_wk8_a') {
          return {
            exists: true,
            data: () => ({
              groupId: 'grp_a',
              weekNumber: 8,
              groupName: 'Group Alpha',
              attendanceRecord: [{ uid: 'u1', email: 'u1@stu.vtc.edu.hk', status: 'present' }],
            }),
          };
        }
        if (path === 'classes/c1/projectGroups/grp_a') {
          return {
            exists: true,
            data: () => ({
              name: 'Group Alpha',
              members: [{ uid: 'u1', email: 'u1@stu.vtc.edu.hk', name: 'User 1' }],
            }),
          };
        }
        if (path === 'classes/c1/projectMeetings/m_wk8_b') {
          return {
            exists: true,
            data: () => ({
              groupId: 'grp_b',
              weekNumber: 8,
              groupName: 'Group Beta',
              attendanceRecord: [{ uid: 'u2', email: 'u2@stu.vtc.edu.hk', status: 'present' }],
            }),
          };
        }
        if (path === 'classes/c1/projectGroups/grp_b') {
          return {
            exists: true,
            data: () => ({
              name: 'Group Beta',
              members: [{ uid: 'u2', email: 'u2@stu.vtc.edu.hk', name: 'User 2' }],
            }),
          };
        }
        return { exists: false };
      });

      const batchRes = await handleBatchEmailProjectMeetingReports({
        classId: 'c1',
        weekNumber: 8,
        customNote: 'Great sprint review this week!',
      });

      expect(batchRes.success).toBe(true);
      expect(batchRes.totalMeetingsProcessed).toBe(2);
      expect(batchRes.totalDelivered).toBe(2);
      expect(batchRes.results).toHaveLength(2);

      delete process.env.SMTP_PASSWORD;
    });

    it('sanitizes audio download URLs, falls back to gemini-3.8-flash on empty transcribe text, and deletes needsReanalysis', async () => {
      mockDocGet.mockImplementation(async (path) => {
        if (path === 'classes/c1/projectMeetings/m_moved') {
          return {
            exists: true,
            data: () => ({
              groupId: 'grp_a04',
              weekNumber: 10,
              needsReanalysis: true,
              audioClips: [
                {
                  clipId: 'c_moved_1',
                  label: 'Part 1',
                  storagePath: 'https://firebasestorage.googleapis.com/v0/b/test-bucket.firebasestorage.app/o/projectMeetings%2Fc1%2Fgrp_a01%2Fm_old%2Fvoice_c1.webm?alt=media&token=xyz',
                  durationSeconds: 180,
                  mimeType: 'audio/webm',
                },
              ],
            }),
          };
        }
        if (path === 'classes/c1/projectGroups/grp_a04') {
          return {
            exists: true,
            data: () => ({
              name: 'Group A04',
              members: [{ uid: 'stu_4', email: 'stu4@stu.vtc.edu.hk', name: 'Student 4' }],
            }),
          };
        }
        return { exists: false };
      });

      // Transcribe model returns empty text (e.g. low-volume or silence filter)
      mockGenerateWithResilience.mockResolvedValueOnce({
        response: { text: '', usage: { promptTokenCount: 50, candidatesTokenCount: 0 } },
        modelUsed: 'gemini-3.5-transcribe-preview',
      });

      // Fallback model gemini-3.8-flash captures the voice successfully
      mockGenerateWithResilience.mockResolvedValueOnce({
        response: { text: '[00:05] Speaker 1 (Student 4): We completed the backend module.', usage: { promptTokenCount: 100, candidatesTokenCount: 40 } },
        modelUsed: 'gemini-3.8-flash',
      });

      // Stage 2 reasoning analysis
      mockGenerateWithResilience.mockResolvedValueOnce({
        response: {
          text: JSON.stringify({
            attendanceRecord: [{ uid: 'stu_4', email: 'stu4@stu.vtc.edu.hk', status: 'present', speakingContribution: 'high' }],
            keyInsights: { executiveSummary: 'Backend module demonstrated successfully.', overallGroupProgress: 'on_track' },
            studentContributions: [{ uid: 'stu_4', email: 'stu4@stu.vtc.edu.hk', workCompleted: ['Backend module'] }],
            transcriptSegments: [{ startTime: '00:05', endTime: '00:20', speaker: 'Student 4', text: 'We completed the backend module.' }],
          }),
          usage: { promptTokenCount: 150, candidatesTokenCount: 80 },
        },
        modelUsed: 'gemini-3.8-flash',
      });

      const res = await handleAnalyzeProjectMeeting({
        classId: 'c1',
        meetingId: 'm_moved',
        auth: { uid: 'teacher_1', token: { email: 'teacher@vtc.edu.hk', role: 'teacher' } },
      });

      expect(res.success).toBe(true);
      expect(res.keyInsights.executiveSummary).toContain('Backend module demonstrated');
      expect(mockDocUpdate).toHaveBeenCalledWith(
        'classes/c1/projectMeetings/m_moved',
        expect.objectContaining({
          status: 'ready',
          needsReanalysis: 'FIELD_DELETED',
        })
      );
    });
  });
});
