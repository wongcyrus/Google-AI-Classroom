import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockDocGet,
  mockDocUpdate,
  mockDocRef,
  mockSave,
  mockGetSignedUrl,
  mockFile,
  mockBucket,
  mockGenerateWithResilience,
  mockLogJob,
} = vi.hoisted(() => {
  const mockDocGet = vi.fn();
  const mockDocUpdate = vi.fn();
  const mockDocRef = vi.fn(() => ({
    get: mockDocGet,
    update: mockDocUpdate,
  }));
  const mockSave = vi.fn().mockResolvedValue();
  const mockGetSignedUrl = vi.fn().mockResolvedValue(['https://signed.url/file']);
  const mockFile = vi.fn(() => ({
    save: mockSave,
    getSignedUrl: mockGetSignedUrl,
  }));
  const mockBucket = vi.fn(() => ({
    name: 'test-bucket',
    file: mockFile,
  }));
  const mockGenerateWithResilience = vi.fn();
  const mockLogJob = vi.fn().mockResolvedValue('ai_job_id');

  return {
    mockDocGet,
    mockDocUpdate,
    mockDocRef,
    mockSave,
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

import { processLectureSubtitles } from './processLectureSubtitles.js';

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
          expect.objectContaining({ media: { url: 'gs://test-bucket/recordings/c1/s1/lecture_audio.webm', contentType: 'audio/webm' } }),
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
});
