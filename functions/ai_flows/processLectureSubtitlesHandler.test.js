import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocGet,
  mockDocUpdate,
  mockDocSet,
  mockDocRef,
  mockCollectionGet,
  mockCollectionRef,
  mockSave,
  mockDownload,
  mockUpload,
  mockDelete,
  mockSetMetadata,
  mockGetMetadata,
  mockExists,
  mockGetSignedUrl,
  mockFile,
  mockBucket,
  mockGenerateWithResilience,
  mockLogJob,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocUpdate = vi.fn();
  const mockDocSet = vi.fn().mockResolvedValue();
  const mockDocRef = vi.fn(() => ({
    get: mockDocGet,
    update: mockDocUpdate,
    set: mockDocSet,
  }));
  const mockCollectionGet = vi.fn();
  const mockCollectionRef = vi.fn(() => ({
    get: mockCollectionGet,
  }));
  const mockSave = vi.fn().mockResolvedValue();
  const mockDownload = vi.fn().mockResolvedValue();
  const mockUpload = vi.fn().mockResolvedValue();
  const mockDelete = vi.fn().mockResolvedValue();
  const mockSetMetadata = vi.fn().mockResolvedValue();
  const mockGetMetadata = vi.fn().mockResolvedValue([{ size: 1048576, metadata: {} }]);
  const mockExists = vi.fn().mockResolvedValue([true]);
  const mockGetSignedUrl = vi.fn().mockResolvedValue(['https://signed.url/file']);
  const mockFile = vi.fn(() => ({
    save: mockSave,
    download: mockDownload,
    delete: mockDelete,
    setMetadata: mockSetMetadata,
    getMetadata: mockGetMetadata,
    exists: mockExists,
    getSignedUrl: mockGetSignedUrl,
  }));
  const mockBucket = vi.fn(() => ({
    name: 'test-bucket',
    file: mockFile,
    upload: mockUpload,
  }));
  const mockGenerateWithResilience = vi.fn();
  const mockLogJob = vi.fn().mockResolvedValue('ai_job_id');

  return {
    mockDocGet,
    mockDocUpdate,
    mockDocSet,
    mockDocRef,
    mockCollectionGet,
    mockCollectionRef,
    mockSave,
    mockDownload,
    mockUpload,
    mockDelete,
    mockSetMetadata,
    mockGetMetadata,
    mockExists,
    mockGetSignedUrl,
    mockFile,
    mockBucket,
    mockGenerateWithResilience,
    mockLogJob,
  };
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: mockDocRef,
    collection: mockCollectionRef,
  }),
  FieldValue: {
    serverTimestamp: () => 'MOCK_TIMESTAMP',
  },
}));

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: mockBucket,
  }),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (opts, handler) => handler || opts,
  HttpsError: class HttpsError extends Error {
    constructor(code, message) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: mockGenerateWithResilience,
}));

vi.mock('./jobLogger.js', () => ({
  logJob: mockLogJob,
}));

vi.mock('./cost.js', () => ({
  calculateCost: vi.fn(() => 0.042),
}));

import { processLectureSubtitles, handleReconcileLectureRecordings } from './processLectureSubtitles.js';

describe('processLectureSubtitles Callable Cloud Function Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws invalid-argument error if classId or sessionId is missing', async () => {
    await expect(processLectureSubtitles({ data: { sessionId: 's1' } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
    await expect(processLectureSubtitles({ data: { classId: 'c1' } })).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('throws not-found error if session document does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({ exists: false });

    await expect(
      processLectureSubtitles({ data: { classId: 'c1', sessionId: 's1' } })
    ).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('throws invalid-argument error if session document has no storagePath', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({ title: 'Test Session' }),
    });

    await expect(
      processLectureSubtitles({ data: { classId: 'c1', sessionId: 's1' } })
    ).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('processes lecture subtitles successfully, saves VTT/SRT, and updates session to ready', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'React Fundamentals',
        topic: 'Hooks',
        storagePath: 'recordings/c1/s1/lecture.webm',
      }),
    });

    const mockAiResponse = {
      response: {
        usage: { promptTokens: 1000, completionTokens: 200 },
        text: JSON.stringify({
          chapters: [{ timeSeconds: 0, title: 'Introduction' }],
          segments: [
            {
              start: 1.0,
              end: 5.0,
              original: 'Hello class',
              translations: {
                en: 'Hello class',
                'zh-Hant': '同學們好',
              },
            },
          ],
        }),
      },
      modelUsed: 'gemini-3.8-flash',
    };

    mockGenerateWithResilience.mockResolvedValueOnce(mockAiResponse);

    const result = await processLectureSubtitles({
      data: {
        classId: 'c1',
        sessionId: 's1',
        targetLanguages: ['en', 'zh-Hant'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.chapters).toHaveLength(1);
    expect(result.vttUrls).toHaveProperty('en');
    expect(result.srtUrls).toHaveProperty('zh-Hant');

    // Verify storage saves were called for each language
    expect(mockSave).toHaveBeenCalled();

    // Verify Firestore updates
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        segmentCount: 1,
        aiCost: 0.042,
        aiModelUsed: 'gemini-3.8-flash',
      })
    );

    expect(mockLogJob).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'c1',
        status: 'completed',
      })
    );
  });

  it('processes lecture subtitles prioritizing audioStoragePath when available', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'React Fundamentals',
        storagePath: 'recordings/c1/s1/lecture.webm',
        audioStoragePath: 'recordings/c1/s1/lecture_audio.webm',
      }),
    });

    const mockAiResponse = {
      response: {
        usage: { promptTokens: 300, completionTokens: 80 },
        text: JSON.stringify({
          chapters: [{ timeSeconds: 0, title: 'Audio Intro' }],
          segments: [
            {
              start: 0.5,
              end: 3.0,
              original: 'Audio track transcription',
              translations: { en: 'Audio track transcription' },
            },
          ],
        }),
      },
      modelUsed: 'gemini-3.8-flash',
    };

    mockGenerateWithResilience.mockResolvedValueOnce(mockAiResponse);

    const result = await processLectureSubtitles({
      data: {
        classId: 'c1',
        sessionId: 's1',
        targetLanguages: ['en'],
      },
    });

    expect(result.success).toBe(true);
    // Verify Gemini was called with the pure audio URI
    expect(mockGenerateWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.arrayContaining([
          expect.objectContaining({ media: { url: 'gs://test-bucket/recordings/c1/s1/lecture_audio_normalized.mp3', contentType: 'audio/mpeg' } }),
        ]),
      }),
      expect.any(String)
    );

    // Verify transcriptionSource is stamped in Firestore
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'generating_subtitles',
        transcriptionSource: 'audio_only',
      })
    );
  });

  it('handles JSON parse errors and marks status as subtitles_failed', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'React Fundamentals',
        storagePath: 'recordings/c1/s1/lecture.webm',
      }),
    });

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: 'This is not valid JSON at all!',
      },
      modelUsed: 'gemini-3.8-flash',
    });

    await expect(
      processLectureSubtitles({
        data: {
          classId: 'c1',
          sessionId: 's1',
          transcriptionMode: 'flash_lite',
        },
      })
    ).rejects.toMatchObject({
      code: 'internal',
    });

    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'subtitles_failed',
      })
    );

    expect(mockLogJob).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
      })
    );
  });

  it('processes long audio with single-pass whole-audio ingestion via gemini-3.8-flash', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Full 1-Hour Lecture',
        storagePath: 'recordings/c1/s1/lecture.webm',
        audioStoragePath: 'recordings/c1/s1/lecture_audio.webm',
        durationSeconds: 3600,
      }),
    });

    const mockAiResponse = {
      response: {
        usage: { promptTokens: 3500, completionTokens: 1200 },
        text: JSON.stringify({
          chapters: [
            { timeSeconds: 0, title: 'Introduction & Setup' },
            { timeSeconds: 1800, title: 'Deep Dive Architecture' },
          ],
          segments: [
            {
              start: 1.0,
              end: 4.5,
              original: '今日我哋會講 Cloud Architecture。',
              translations: {
                en: 'Today we will discuss Cloud Architecture.',
                'zh-Hant': '今天我們將討論雲端架構。',
                'zh-Hans': '今天我们将讨论云端架构。',
              },
            },
            {
              start: 5.0,
              end: 9.0,
              original: '請確保已經登入 GCP Console。',
              translations: {
                en: 'Please ensure you are logged into GCP Console.',
                'zh-Hant': '請確保已經登入 GCP 控制台。',
                'zh-Hans': '请确保已经登录 GCP 控制台。',
              },
            },
          ],
        }),
      },
      modelUsed: 'gemini-3.8-flash',
    };

    mockGenerateWithResilience.mockResolvedValueOnce(mockAiResponse);

    const result = await processLectureSubtitles({
      data: {
        classId: 'c1',
        sessionId: 's1',
        targetLanguages: ['en', 'zh-Hant', 'zh-Hans'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('ready');
    expect(result.chapters).toHaveLength(2);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        segmentCount: 2,
        aiModelUsed: 'gemini-3.8-flash',
      })
    );
    expect(mockGenerateWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 65536,
        }),
        prompt: expect.arrayContaining([
          expect.objectContaining({ media: { url: 'gs://test-bucket/recordings/c1/s1/lecture_audio_normalized.mp3', contentType: 'audio/mpeg' } }),
        ]),
      }),
      'gemini-3.8-flash'
    );
  });

  it('translates missing languages in batches when master cues lack target translations', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Database Systems',
        storagePath: 'recordings/c1/s1/lecture.webm',
        audioStoragePath: 'recordings/c1/s1/lecture_audio.webm',
        durationSeconds: 600,
      }),
    });

    // Primary AI response contains segments with only original text (missing zh-Hans)
    const mockPrimaryResponse = {
      response: {
        usage: { promptTokens: 1000, completionTokens: 150 },
        text: JSON.stringify({
          chapters: [
            { timeSeconds: 0, title: 'Intro' },
            { timeSeconds: 300, title: 'Trade-offs' },
          ],
          segments: [
            {
              start: 0.5,
              end: 3.5,
              original: 'SQL vs NoSQL trade-offs',
              translations: {
                en: 'SQL vs NoSQL trade-offs',
                'zh-Hant': 'SQL 與 NoSQL 的權衡',
              },
            },
          ],
        }),
      },
      modelUsed: 'gemini-3.5-flash-lite',
    };

    // Translation fallback response providing zh-Hans
    const mockTranslationResponse = {
      response: {
        usage: { promptTokens: 100, completionTokens: 40 },
        text: JSON.stringify([
          {
            'zh-Hans': 'SQL 与 NoSQL 的权衡',
          },
        ]),
      },
      modelUsed: 'gemini-3.5-flash-lite',
    };

    mockGenerateWithResilience
      .mockResolvedValueOnce(mockPrimaryResponse)
      .mockResolvedValueOnce(mockTranslationResponse);

    const result = await processLectureSubtitles({
      data: {
        classId: 'c1',
        sessionId: 's1',
        targetLanguages: ['en', 'zh-Hant', 'zh-Hans'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('ready');
    expect(mockGenerateWithResilience).toHaveBeenCalledTimes(2);
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        segmentCount: 1,
      })
    );
  });

  it('synthesizes YouTube chapters when AI model output lacks chapters', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Microservices Design',
        storagePath: 'recordings/c1/s1/lecture.webm',
        audioStoragePath: 'recordings/c1/s1/lecture_audio.webm',
        durationSeconds: 1200,
      }),
    });

    // Primary response with empty chapters array
    const mockPrimaryResponse = {
      response: {
        usage: { promptTokens: 800, completionTokens: 100 },
        text: JSON.stringify({
          chapters: [],
          segments: [
            {
              start: 0.0,
              end: 10.0,
              original: 'First topic overview',
              translations: { en: 'First topic overview' },
            },
            {
              start: 600.0,
              end: 610.0,
              original: 'Docker containers',
              translations: { en: 'Docker containers' },
            },
          ],
        }),
      },
      modelUsed: 'gemini-3.5-flash-lite',
    };

    // Chapter fallback synthesis response
    const mockChapterResponse = {
      response: {
        usage: { promptTokens: 200, completionTokens: 50 },
        text: JSON.stringify({
          chapters: [
            { timeSeconds: 0, title: 'Introduction' },
            { timeSeconds: 600, title: 'Containers Deep Dive' },
          ],
        }),
      },
      modelUsed: 'gemini-3.5-flash-lite',
    };

    mockGenerateWithResilience
      .mockResolvedValueOnce(mockPrimaryResponse)
      .mockResolvedValueOnce(mockChapterResponse);

    const result = await processLectureSubtitles({
      data: {
        classId: 'c1',
        sessionId: 's1',
        targetLanguages: ['en'],
      },
    });

    expect(result.success).toBe(true);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[1].title).toBe('Containers Deep Dive');
    expect(mockDocUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        chapters: expect.arrayContaining([
          expect.objectContaining({ timeSeconds: 600, title: 'Containers Deep Dive' }),
        ]),
      })
    );
  });
});

describe('handleReconcileLectureRecordings Function Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws invalid-argument if classId is missing', async () => {
    await expect(handleReconcileLectureRecordings({})).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('scans candidate recordings and reconciles missing videoUrl from Cloud Storage', async () => {
    const mockUpdate = vi.fn().mockResolvedValue();
    mockCollectionGet.mockResolvedValueOnce({
      docs: [
        {
          id: 'rec_candidate_1',
          data: () => ({
            status: 'recording',
            startedAt: { toMillis: () => 1700000000000 },
          }),
          ref: {
            update: mockUpdate,
          },
        },
        {
          id: 'rec_already_ready',
          data: () => ({
            status: 'ready',
            videoUrl: 'https://video.url',
            vttUrls: { original: 'https://vtt.url' },
          }),
          ref: {
            update: vi.fn(),
          },
        },
      ],
    });

    mockExists.mockResolvedValue([true]);
    mockGetMetadata.mockResolvedValue([
      {
        size: 52428800,
        metadata: {
          durationSeconds: '120',
          firebaseStorageDownloadTokens: 'token_abc',
        },
      },
    ]);

    const result = await handleReconcileLectureRecordings({ classId: 'c1' });

    expect(result.success).toBe(true);
    expect(result.reconciledCount).toBe(1);
    expect(result.reconciledSessions[0].sessionId).toBe('rec_candidate_1');
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ready',
        durationSeconds: 120,
        fileSize: 52428800,
      })
    );
  });
});

