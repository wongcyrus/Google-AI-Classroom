import { describe, it, expect, vi } from 'vitest';
import { executeMergeLectureRecordings } from './mergeLectureRecordings.js';

describe('mergeLectureRecordings Cloud Function', () => {
  const createMockDb = ({
    classExists = true,
    classData = {
      teachers: { 'teacher-1': 'teacher@vtc.edu.hk' },
      teacherUid: 'teacher-1',
    },
    recordings = [],
  } = {}) => {
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
      collection: vi.fn(() => ({
        doc: vi.fn((id) => {
          const rec = recordings.find((r) => r.id === id);
          return {
            get: vi.fn().mockResolvedValue({
              exists: !!rec,
              id: id,
              data: () => rec,
            }),
            set: vi.fn().mockResolvedValue({}),
            update: vi.fn().mockResolvedValue({}),
          };
        }),
        where: vi.fn(() => ({
          get: vi.fn().mockResolvedValue({
            docs: recordings.map((r) => ({
              id: r.id,
              data: () => r,
            })),
          }),
        })),
      })),
      batch: vi.fn(() => ({
        update: vi.fn(),
        commit: vi.fn().mockResolvedValue({}),
      })),
    };
  };

  const createMockStorage = () => {
    return {
      bucket: vi.fn(() => ({
        name: 'test-bucket',
        file: vi.fn(() => ({
          download: vi.fn().mockResolvedValue({}),
        })),
        upload: vi.fn().mockResolvedValue({}),
      })),
    };
  };

  it('throws invalid-argument if classId is missing', async () => {
    await expect(
      executeMergeLectureRecordings({ classId: null, auth: { uid: 'teacher-1' } })
    ).rejects.toThrow(/classId is required/);
  });

  it('throws unauthenticated if caller is not authenticated', async () => {
    await expect(
      executeMergeLectureRecordings({ classId: 'CLASS-1', auth: null })
    ).rejects.toThrow(/User must be authenticated/);
  });

  it('throws permission-denied if caller is neither teacher nor admin', async () => {
    const db = createMockDb({
      classData: { teachers: { 'teacher-1': 'teacher@vtc.edu.hk' } },
    });
    await expect(
      executeMergeLectureRecordings(
        { classId: 'CLASS-1', auth: { uid: 'student-intruder', token: { email: 'student@stu.vtc.edu.hk' } } },
        { db }
      )
    ).rejects.toThrow(/Only teachers of this class can merge lecture recordings/);
  });

  it('returns insufficient_clips if 0 valid clips exist to merge', async () => {
    const db = createMockDb({
      recordings: [],
    });
    const result = await executeMergeLectureRecordings(
      { classId: 'CLASS-1', sessionGroupId: 'grp_1', auth: { uid: 'teacher-1' } },
      { db }
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('insufficient_clips');
  });

  it('returns single_valid_clip if only 1 clip exists to merge', async () => {
    const db = createMockDb({
      recordings: [
        { id: 'rec_1', storagePath: 'recordings/CLASS-1/rec_1/lecture.webm', startedAt: 1000 },
      ],
    });
    const result = await executeMergeLectureRecordings(
      { classId: 'CLASS-1', sessionGroupId: 'grp_1', auth: { uid: 'teacher-1' } },
      { db }
    );
    expect(result.success).toBe(false);
    expect(result.reason).toBe('single_valid_clip');
  });

  it('successfully merges multiple clips and writes combined record', async () => {
    const recordings = [
      {
        id: 'rec_1',
        storagePath: 'recordings/CLASS-1/rec_1/lecture.webm',
        startedAt: { toMillis: () => 1789957711308 },
        durationSeconds: 66,
      },
      {
        id: 'rec_2',
        storagePath: 'recordings/CLASS-1/rec_2/lecture.webm',
        startedAt: { toMillis: () => 1789957830040 },
        durationSeconds: 3116,
      },
    ];

    const db = createMockDb({ recordings });
    const storage = createMockStorage();
    const durationProber = vi.fn().mockResolvedValue(3182);
    const ffmpegRunner = vi.fn().mockResolvedValue();

    // Mock fs operations for local temp files
    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_1', 'rec_2'],
        customTitle: 'Combined Full Lecture',
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db, storage, durationProber, ffmpegRunner }
    );

    expect(result.success).toBe(true);
    expect(result.combinedSessionId).toMatch(/^rec_combined_/);
    expect(result.durationSeconds).toBe(3182);
    expect(result.clipCount).toBe(2);
    expect(result.videoUrl).toContain('firebasestorage.googleapis.com');
    expect(result.normalizedAudioStoragePath).toContain('lecture_audio_normalized.mp3');
    expect(result.normalizedAudioUrl).toContain('lecture_audio_normalized.mp3');
  });

  it('ignores trailing interrupted segment and merges valid clips successfully', async () => {
    const recordings = [
      {
        id: 'rec_1',
        storagePath: 'recordings/CLASS-1/rec_1/lecture.webm',
        startedAt: { toMillis: () => 1789957711308 },
        durationSeconds: 60,
        status: 'ready',
      },
      {
        id: 'rec_2',
        storagePath: 'recordings/CLASS-1/rec_2/lecture.webm',
        startedAt: { toMillis: () => 1789957830040 },
        durationSeconds: 120,
        status: 'ready',
      },
      {
        id: 'rec_3_interrupted',
        storagePath: null,
        startedAt: { toMillis: () => 1789958000000 },
        status: 'recording',
      },
    ];

    const db = createMockDb({ recordings });
    const storage = createMockStorage();
    const durationProber = vi.fn().mockResolvedValue(180);
    const ffmpegRunner = vi.fn().mockResolvedValue();

    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_1', 'rec_2', 'rec_3_interrupted'],
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db, storage, durationProber, ffmpegRunner }
    );

    expect(result.success).toBe(true);
    expect(result.clipCount).toBe(2);
    expect(result.ignoredIncompleteCount).toBe(1);
  });

  it('handles 1 valid clip and 1 incomplete clip gracefully by preserving valid clip and remarking crash interruption', async () => {
    const recordings = [
      {
        id: 'rec_1',
        storagePath: 'recordings/CLASS-1/rec_1/lecture.webm',
        startedAt: { toMillis: () => 1789957711308 },
        durationSeconds: 60,
        status: 'ready',
      },
      {
        id: 'rec_interrupted',
        storagePath: null,
        startedAt: { toMillis: () => 1789957000000 },
        status: 'recording',
      },
    ];

    const db = createMockDb({ recordings });
    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_1', 'rec_interrupted'],
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db }
    );

    expect(result.success).toBe(true);
    expect(result.combinedSessionId).toBe('rec_1');
    expect(result.hasMissingSegment).toBe(true);
    expect(result.interruptionRemarks).toMatch(/Recording interrupted/);
    expect(result.clipCount).toBe(1);
    expect(result.crashedClipsCount).toBe(1);
  });

  it('calculates gap between clips and stamps interruptionRemarks onto combined master lecture', async () => {
    const recordings = [
      {
        id: 'rec_part1',
        storagePath: 'recordings/CLASS-1/rec_part1/lecture.webm',
        startedAt: { toMillis: () => 1700000000000 },
        durationSeconds: 300,
      },
      {
        id: 'rec_part2',
        storagePath: 'recordings/CLASS-1/rec_part2/lecture.webm',
        startedAt: { toMillis: () => 1700000420000 }, // 120s gap
        durationSeconds: 600,
      },
    ];

    const db = createMockDb({ recordings });
    const storage = createMockStorage();
    const durationProber = vi.fn().mockResolvedValue(900);
    const ffmpegRunner = vi.fn().mockResolvedValue();

    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_part1', 'rec_part2'],
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db, storage, durationProber, ffmpegRunner }
    );

    expect(result.success).toBe(true);
    expect(result.hasMissingSegment).toBe(true);
    expect(result.lostDurationSeconds).toBe(120);
    expect(result.interruptionRemarks).toMatch(/gap between/);
  });

  it('prevents duplicate merge if all clips have already been merged into an existing session', async () => {
    const recordings = [
      {
        id: 'rec_1',
        storagePath: 'recordings/CLASS-1/rec_1/lecture.webm',
        mergedIntoSessionId: 'rec_combined_prev_full',
        startedAt: 1000,
      },
      {
        id: 'rec_2',
        storagePath: 'recordings/CLASS-1/rec_2/lecture.webm',
        mergedIntoSessionId: 'rec_combined_prev_full',
        startedAt: 2000,
      },
    ];

    const db = createMockDb({ recordings });
    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_1', 'rec_2'],
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db }
    );

    expect(result.success).toBe(true);
    expect(result.alreadyMerged).toBe(true);
    expect(result.combinedSessionId).toBe('rec_combined_prev_full');
  });

  it('writes decoupled subtitle job to lectureSubtitleJobs collection upon successful merge', async () => {
    const recordings = [
      {
        id: 'rec_a',
        storagePath: 'recordings/CLASS-1/rec_a/lecture.webm',
        startedAt: { toMillis: () => 1700000000000 },
        durationSeconds: 100,
      },
      {
        id: 'rec_b',
        storagePath: 'recordings/CLASS-1/rec_b/lecture.webm',
        startedAt: { toMillis: () => 1700000100000 },
        durationSeconds: 200,
      },
    ];

    const subtitleJobSetSpy = vi.fn().mockResolvedValue({});
    const db = {
      ...createMockDb({ recordings }),
      collection: vi.fn((colName) => {
        if (colName === 'lectureSubtitleJobs') {
          return {
            doc: vi.fn(() => ({
              set: subtitleJobSetSpy,
            })),
          };
        }
        return createMockDb({ recordings }).collection(colName);
      }),
    };

    const storage = createMockStorage();
    const durationProber = vi.fn().mockResolvedValue(300);
    const ffmpegRunner = vi.fn().mockResolvedValue();

    const result = await executeMergeLectureRecordings(
      {
        classId: 'CLASS-1',
        recordingIds: ['rec_a', 'rec_b'],
        auth: { uid: 'teacher-1', token: { email: 'teacher@vtc.edu.hk' } },
      },
      { db, storage, durationProber, ffmpegRunner }
    );

    expect(result.success).toBe(true);
    expect(subtitleJobSetSpy).toHaveBeenCalledTimes(1);
    const jobPayload = subtitleJobSetSpy.mock.calls[0][0];
    expect(jobPayload.classId).toBe('CLASS-1');
    expect(jobPayload.sessionId).toBe(result.combinedSessionId);
    expect(jobPayload.status).toBe('pending');
    expect(jobPayload.audioStoragePath).toContain('lecture_audio_normalized.mp3');
  });
});
