import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeMergeStudentSessionAudio,
  mergeStudentSessionAudio,
} from './mergeStudentSessionAudio.js';

describe('mergeStudentSessionAudio Cloud Function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockDb = ({
    classExists = true,
    classData = {
      teacherEmails: ['teacher@school.edu'],
      teachers: { 'teacher-1': 'teacher@school.edu' },
    },
    audioDocs = [],
  } = {}) => {
    const mockCreatedDoc = {
      id: 'combined-audio-doc-123',
      set: vi.fn().mockResolvedValue({}),
    };

    return {
      doc: vi.fn((path) => {
        if (path.startsWith('classes/')) {
          return {
            get: vi.fn().mockResolvedValue({
              exists: classExists,
              data: () => classData,
            }),
          };
        }
        return {
          get: vi.fn().mockResolvedValue({ exists: false }),
        };
      }),
      batch: vi.fn(() => ({
        delete: vi.fn(),
        commit: vi.fn().mockResolvedValue({}),
      })),
      collection: vi.fn((collName) => {
        if (collName.includes('combinedAudios')) {
          return {
            doc: vi.fn(() => mockCreatedDoc),
          };
        }
        return {
          where: vi.fn().mockReturnThis(),
          orderBy: vi.fn().mockReturnThis(),
          get: vi.fn().mockResolvedValue({
            docs: audioDocs.map((a) => ({
              id: a.id,
              data: () => a,
            })),
          }),
        };
      }),
    };
  };

  const createMockStorage = () => {
    return {
      bucket: vi.fn(() => ({
        name: 'test-bucket',
        file: vi.fn((filePath) => ({
          name: filePath,
          exists: vi.fn().mockResolvedValue([true]),
          download: vi.fn().mockResolvedValue(),
          delete: vi.fn().mockResolvedValue({}),
        })),
        upload: vi.fn().mockResolvedValue([{}]),
      })),
    };
  };

  it('rejects when classId or studentUid is missing', async () => {
    await expect(
      executeMergeStudentSessionAudio({ classId: '', studentUid: 's1', auth: { uid: 'teacher-1' } })
    ).rejects.toThrow(/classId is required/);

    await expect(
      executeMergeStudentSessionAudio({ classId: 'CLASS_1', studentUid: '', auth: { uid: 'teacher-1' } })
    ).rejects.toThrow(/studentUid is required/);
  });

  it('rejects unauthenticated caller', async () => {
    await expect(
      executeMergeStudentSessionAudio({ classId: 'CLASS_1', studentUid: 's1', auth: null })
    ).rejects.toThrow(/User must be authenticated/);
  });

  it('rejects student callers who are not teachers of the class', async () => {
    const mockDb = createMockDb({
      classData: { teacherEmails: ['teacher@school.edu'], teachers: { 'teacher-1': 'teacher@school.edu' } },
    });
    const mockStorage = createMockStorage();

    await expect(
      executeMergeStudentSessionAudio(
        {
          classId: 'CLASS_1',
          studentUid: 's1',
          auth: { uid: 'student-99', token: { email: 'student99@school.edu', role: 'student' } },
        },
        { db: mockDb, storage: mockStorage }
      )
    ).rejects.toThrow(/Only teachers assigned to this class/);
  });

  it('returns no_clips status when no audio clips exist for the session', async () => {
    const mockDb = createMockDb({ audioDocs: [] });
    const mockStorage = createMockStorage();

    const res = await executeMergeStudentSessionAudio(
      {
        classId: 'CLASS_1',
        studentUid: 's1',
        startTime: '2026-08-01T09:00:00Z',
        endTime: '2026-08-01T11:00:00Z',
        auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
      },
      { db: mockDb, storage: mockStorage }
    );

    expect(res.status).toBe('no_clips');
    expect(res.clipCount).toBe(0);
  });

  it('concatenates audio clips and returns unified audio result', async () => {
    const mockAudioDocs = [
      { id: 'a1', audioPath: 'audio/CLASS_1/2026-08-01/s1/clip1.webm', timestamp: new Date('2026-08-01T09:10:00Z') },
      { id: 'a2', audioPath: 'audio/CLASS_1/2026-08-01/s1/clip2.webm', timestamp: new Date('2026-08-01T09:25:00Z') },
    ];
    const mockDb = createMockDb({ audioDocs: mockAudioDocs });
    const mockStorage = createMockStorage();
    const mockFfmpegRunner = vi.fn().mockResolvedValue();
    const mockDurationProber = vi.fn().mockResolvedValue(45.5);

    const res = await executeMergeStudentSessionAudio(
      {
        classId: 'CLASS_1',
        studentUid: 's1',
        startTime: '2026-08-01T09:00:00Z',
        endTime: '2026-08-01T11:00:00Z',
        auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
      },
      {
        db: mockDb,
        storage: mockStorage,
        ffmpegRunner: mockFfmpegRunner,
        durationProber: mockDurationProber,
      }
    );

    expect(res.status).toBe('success');
    expect(res.clipCount).toBe(2);
    expect(res.durationSeconds).toBe(46);
    expect(res.audioUrl).toContain('https://firebasestorage.googleapis.com');
  });

  it('purges routine unflagged raw audio clips while preserving flagged incident clips', async () => {
    const mockAudioDocs = [
      { id: 'a1', audioPath: 'audio/CLASS_1/2026-08-01/s1/clip1.webm', isFlagged: false },
      { id: 'a2', audioPath: 'audio/CLASS_1/2026-08-01/s1/clip2.webm', isViolation: true },
    ];
    const mockDb = createMockDb({ audioDocs: mockAudioDocs });
    const mockStorage = createMockStorage();
    const mockFfmpegRunner = vi.fn().mockResolvedValue();
    const mockDurationProber = vi.fn().mockResolvedValue(30);

    const res = await executeMergeStudentSessionAudio(
      {
        classId: 'CLASS_1',
        studentUid: 's1',
        auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
      },
      {
        db: mockDb,
        storage: mockStorage,
        ffmpegRunner: mockFfmpegRunner,
        durationProber: mockDurationProber,
      }
    );

    expect(res.status).toBe('success');
    expect(mockDb.batch).toHaveBeenCalled();
  });

  it('fails fast and throws when Firestore audio query throws an error', async () => {
    const mockDb = createMockDb({});
    mockDb.collection = vi.fn((collName) => {
      if (collName.includes('combinedAudios')) {
        return { doc: vi.fn(() => ({ set: vi.fn() })) };
      }
      return {
        where: vi.fn().mockReturnThis(),
        orderBy: vi.fn().mockReturnThis(),
        get: vi.fn().mockRejectedValue(new Error('FAILED_PRECONDITION: The query requires an index')),
      };
    });
    const mockStorage = createMockStorage();

    await expect(
      executeMergeStudentSessionAudio(
        {
          classId: 'CLASS_1',
          studentUid: 's1',
          startTime: '2026-08-01T09:00:00Z',
          endTime: '2026-08-01T11:00:00Z',
          auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
        },
        { db: mockDb, storage: mockStorage }
      )
    ).rejects.toThrow(/FAILED_PRECONDITION/);
  });

  it('throws not-found when class document does not exist', async () => {
    const mockDb = createMockDb({ classExists: false });
    const mockStorage = createMockStorage();

    await expect(
      executeMergeStudentSessionAudio(
        {
          classId: 'MISSING_CLASS',
          studentUid: 's1',
          auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
        },
        { db: mockDb, storage: mockStorage }
      )
    ).rejects.toThrow(/Class "MISSING_CLASS" does not exist/);
  });

  it('returns no_clips status when speech records exist in db but storage files do not exist', async () => {
    const audioDocs = [
      { id: 'a1', storagePath: 'audio/missing1.webm', timestamp: '2026-08-01T09:10:00Z' },
    ];
    const mockDb = createMockDb({ audioDocs });
    const mockStorage = {
      bucket: vi.fn(() => ({
        file: vi.fn(() => ({
          exists: vi.fn().mockResolvedValue([false]),
        })),
      })),
    };

    const res = await executeMergeStudentSessionAudio(
      {
        classId: 'CLASS_1',
        studentUid: 's1',
        auth: { uid: 'teacher-1', token: { email: 'teacher@school.edu', role: 'teacher' } },
      },
      { db: mockDb, storage: mockStorage }
    );

    expect(res.status).toBe('no_clips');
    expect(res.clipCount).toBe(0);
  });

  it('calls mergeStudentSessionAudio onCall wrapper', async () => {
    const handler = mergeStudentSessionAudio.run || mergeStudentSessionAudio;
    await expect(
      handler({
        data: { classId: 'CLASS_1', studentUid: 's1' },
        auth: null,
      })
    ).rejects.toThrow(/User must be authenticated/);
  });
});
