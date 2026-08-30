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

vi.mock('firebase-admin/firestore', () => {
  return {
    getFirestore: () => ({
      doc: vi.fn(() => ({
        get: vi.fn().mockResolvedValue({ exists: true, data: () => ({ name: 'CS101 Final Exam' }) }),
      })),
      collection: vi.fn((collPath) => {
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
              } else if (collPath.includes('irregularities')) {
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
});
