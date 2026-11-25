import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase.js', () => ({}));
vi.mock('./config.js', () => ({ FUNCTION_REGION: 'us-central1' }));

const mockSave = vi.fn().mockResolvedValue();
const mockGetSignedUrl = vi.fn().mockResolvedValue(['https://signedurl.local/report.docx']);

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      file: () => ({
        save: mockSave,
        getSignedUrl: mockGetSignedUrl,
      }),
    }),
  }),
}));

const mockDocUpdate = vi.fn().mockResolvedValue();
const mockMailsAdd = vi.fn().mockResolvedValue();
const { mockFirestoreState } = vi.hoisted(() => ({
  mockFirestoreState: {
    queriedCollections: [],
    classData: null,
    subIrregs: null,
    rootIrregs: null,
  },
}));

vi.mock('firebase-admin/firestore', () => {
  return {
    getFirestore: () => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({
          exists: true,
          data: () => mockFirestoreState.classData || { name: 'CS101 Final Exam' },
        }),
      })),
      collection: vi.fn((collPath) => {
        mockFirestoreState.queriedCollections.push(collPath);
        if (collPath === 'mails') {
          return { add: mockMailsAdd };
        }
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            forEach: vi.fn((cb) => {
              if (collPath.includes('students')) {
                cb({ id: 's1', data: () => ({ email: 'student1@example.com', name: 'Alice' }) });
              } else if (collPath === 'classes/CLASS_1/irregularities' || (collPath.includes('/irregularities') && mockFirestoreState.subIrregs)) {
                if (Array.isArray(mockFirestoreState.subIrregs)) {
                  mockFirestoreState.subIrregs.forEach(cb);
                } else {
                  cb({
                    id: 'ir1',
                    data: () => ({
                      studentUid: 's1',
                      type: 'gaze_deviation',
                      severity: 'high',
                      details: 'Looking away for 15 seconds',
                      timestamp: { toDate: () => new Date('2026-08-30T10:00:00Z') },
                    }),
                  });
                }
              } else if (collPath === 'irregularities') {
                if (Array.isArray(mockFirestoreState.rootIrregs)) {
                  mockFirestoreState.rootIrregs.forEach(cb);
                }
              } else if (collPath === 'audio') {
                cb({
                  id: 'a1',
                  data: () => ({
                    studentUid: 's1',
                    transcript: 'Can you hear me?',
                    timestamp: { toDate: () => new Date('2026-08-30T10:00:05Z') },
                  }),
                });
              }
            }),
          }),
        };
      }),
    }),
    Timestamp: {
      fromDate: (d) => ({ toDate: () => d }),
    },
  };
});

describe('processReportJob Cloud Function Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFirestoreState.queriedCollections = [];
    mockFirestoreState.classData = null;
    mockFirestoreState.subIrregs = null;
    mockFirestoreState.rootIrregs = null;
  });

  it('imports and initializes report job processor without errors', async () => {
    const { processReportJob } = await import('./processReportJob.js');
    expect(processReportJob).toBeDefined();
  });

  it('successfully processes report job for both docx and csv format and sends email', async () => {
    const { processReportJob } = await import('./processReportJob.js');
    const mockRef = { update: mockDocUpdate };
    const mockSnap = {
      ref: mockRef,
      data: () => ({
        classId: 'CLASS_1',
        startTime: '2026-08-30T09:00:00Z',
        endTime: '2026-08-30T11:00:00Z',
        requesterUid: 'teacher_1',
        requesterEmail: 'teacher@school.edu',
        format: 'both',
        includeScreenshots: false,
        includeAudioTranscripts: true,
        includeGazeLogs: true,
        studentUids: ['s1'],
      }),
    };

    const mockEvent = {
      data: mockSnap,
      params: { jobId: 'JOB_123' },
    };

    await processReportJob.run(mockEvent);

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        docxUrl: expect.stringContaining('https://signedurl.local/report.docx'),
        csvUrl: expect.stringContaining('https://signedurl.local/report.docx'),
      })
    );
    expect(mockMailsAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'teacher@school.edu',
      })
    );
  });

  it('handles processing when no event data is provided', async () => {
    const { processReportJob } = await import('./processReportJob.js');
    const mockEvent = {
      data: null,
      params: { jobId: 'JOB_EMPTY' },
    };

    await processReportJob.run(mockEvent);
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('aborts idempotently when jobData.status is already completed or processing', async () => {
    const { processReportJob } = await import('./processReportJob.js');
    await processReportJob.run({
      data: {
        ref: { update: mockDocUpdate },
        data: () => ({ status: 'completed', classId: 'CLASS_1' }),
      },
      params: { jobId: 'JOB_DONE' },
    });
    expect(mockDocUpdate).not.toHaveBeenCalled();
  });

  it('merges classInfo.students, deduplicates subcollection & root irregularities, and never scans screenshots', async () => {
    const { processReportJob } = await import('./processReportJob.js');
    mockFirestoreState.classData = {
      name: 'Exam Class',
      students: { s1: 's1@stu.vtc.edu.hk' },
    };
    mockFirestoreState.subIrregs = [
      {
        id: 'ir_dup',
        data: () => ({
          studentUid: 's1',
          type: 'looking_away',
          severity: 'medium',
          timestamp: { toDate: () => new Date('2026-08-30T10:05:00Z') },
        }),
      },
    ];
    mockFirestoreState.rootIrregs = [
      {
        id: 'ir_dup', // duplicate doc id across root & subcollection
        data: () => ({
          studentUid: 's1',
          type: 'looking_away',
          severity: 'medium',
          timestamp: { toDate: () => new Date('2026-08-30T10:05:00Z') },
        }),
      },
      {
        id: 'ir_root_only',
        data: () => ({
          studentUid: 's1',
          type: 'multiple_faces',
          severity: 'high',
          timestamp: { toDate: () => new Date('2026-08-30T10:01:00Z') },
        }),
      },
    ];

    await processReportJob.run({
      data: {
        ref: { update: mockDocUpdate },
        data: () => ({
          status: 'pending',
          classId: 'CLASS_1',
          startTime: '2026-08-30T09:00:00Z',
          endTime: '2026-08-30T11:00:00Z',
          requesterUid: 'teacher_1',
          format: 'csv',
          includeScreenshots: true,
          includeAudioTranscripts: false,
        }),
      },
      params: { jobId: 'JOB_DEDUP' },
    });

    expect(mockFirestoreState.queriedCollections).toContain('classes/CLASS_1/irregularities');
    expect(mockFirestoreState.queriedCollections).toContain('irregularities');
    expect(mockFirestoreState.queriedCollections).not.toContain('screenshots');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        summary: expect.objectContaining({
          totalStudents: 1,
          totalIrregularities: 2,
        }),
      })
    );
  });
});
