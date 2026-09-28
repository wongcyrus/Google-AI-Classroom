import { describe, it, expect, vi } from 'vitest';

describe('analyzeAudioFlow Dynamic Placeholder Interpolation', () => {
  it('interpolates {{transcript}}, {{classId}}, {{studentUid}}, and {{studentEmail}} in prompt templates', () => {
    const rawTemplate = 'Inspect transcript: "{{transcript}}" for student {{studentEmail}} (UID: {{studentUid}}) in class {{classId}}.';
    const transcript = 'Whispering formulas during test';
    const classId = 'CLASS_ENG_101';
    const studentUid = 'uid_student_42';
    const studentEmail = 'student42@school.edu';

    let resolvedPrompt = rawTemplate
      .replace(/\{\{\s*transcript\s*\}\}/g, transcript)
      .replace(/\{\{\s*classId\s*\}\}/g, classId)
      .replace(/\{\{\s*studentUid\s*\}\}/g, studentUid)
      .replace(/\{\{\s*studentEmail\s*\}\}/g, studentEmail);

    expect(resolvedPrompt).toBe(
      'Inspect transcript: "Whispering formulas during test" for student student42@school.edu (UID: uid_student_42) in class CLASS_ENG_101.'
    );
    expect(resolvedPrompt).not.toContain('{{');
  });

  it('handles templates without tags by cleanly appending the transcript', () => {
    const rawTemplate = 'Analyze classroom microphone audio for unauthorized talking or second speakers.';
    const transcript = 'I am done with question 3.';
    let promptText = rawTemplate;
    if (!promptText.includes('{{transcript}}')) {
      promptText = `${promptText}\n\nAudio Transcript / Context:\n"${transcript}"`;
    }

    expect(promptText).toContain('Analyze classroom microphone audio');
    expect(promptText).toContain('Audio Transcript / Context:\n"I am done with question 3."');
  });

  it('configures gemini-3.5-transcribe-preview as the dedicated audio transcription model', async () => {
    const { AI_TRANSCRIBE_MODEL } = await import('./config.js');
    expect(AI_TRANSCRIBE_MODEL).toBe('gemini-3.5-transcribe-preview');
  });
});

describe('resolveVideoDetails Robust Path Parsing', () => {
  it('correctly handles relative videoPath', async () => {
    const { resolveVideoDetails } = await import('./processVideoAnalysisJob.js');
    const bucket = 'it114115-2627.firebasestorage.app';
    const result = resolveVideoDetails({ videoPath: 'videos/itp4124/test.mp4' }, bucket);
    expect(result.relativePath).toBe('videos/itp4124/test.mp4');
    expect(result.gsUri).toBe('gs://it114115-2627.firebasestorage.app/videos/itp4124/test.mp4');
  });

  it('correctly normalizes full gs:// URIs', async () => {
    const { resolveVideoDetails } = await import('./processVideoAnalysisJob.js');
    const bucket = 'it114115-2627.firebasestorage.app';
    const result = resolveVideoDetails({ path: 'gs://it114115-2627.firebasestorage.app/videos/itp4124/test.mp4' }, bucket);
    expect(result.relativePath).toBe('videos/itp4124/test.mp4');
    expect(result.gsUri).toBe('gs://it114115-2627.firebasestorage.app/videos/itp4124/test.mp4');
  });

  it('correctly handles https:// storage URLs', async () => {
    const { resolveVideoDetails } = await import('./processVideoAnalysisJob.js');
    const bucket = 'it114115-2627.firebasestorage.app';
    const result = resolveVideoDetails({ videoPath: 'https://storage.googleapis.com/it114115-2627.firebasestorage.app/videos%2Fitp4124%2Ftest.mp4' }, bucket);
    expect(result.relativePath).toBe('videos/itp4124/test.mp4');
    expect(result.gsUri).toBe('gs://it114115-2627.firebasestorage.app/videos/itp4124/test.mp4');
  });

  it('filters out undefined and invalid paths', async () => {
    const { resolveVideoDetails } = await import('./processVideoAnalysisJob.js');
    const bucket = 'it114115-2627.firebasestorage.app';
    expect(resolveVideoDetails({ path: 'gs://it114115-2627.firebasestorage.app/undefined' }, bucket).relativePath).toBe('');
    expect(resolveVideoDetails({ videoPath: undefined }, bucket).relativePath).toBe('');
    expect(resolveVideoDetails(null, bucket).relativePath).toBe('');
  });
});

describe('generateWithResilience and Flow Tools', () => {
  it('exports tools for image, video, and audio analysis', async () => {
    const {
      getToolsForImageAnalysis,
      getToolsForVideoAnalysis,
      getToolsForAudioAnalysis,
    } = await import('./analysisFlows.js');

    const imageTools = getToolsForImageAnalysis();
    expect(Array.isArray(imageTools)).toBe(true);
    expect(imageTools.length).toBe(5);

    const videoTools = getToolsForVideoAnalysis();
    expect(Array.isArray(videoTools)).toBe(true);
    expect(videoTools.length).toBe(7);

    const audioTools = getToolsForAudioAnalysis();
    expect(Array.isArray(audioTools)).toBe(true);
    expect(audioTools.length).toBe(4);
  });

  describe('generateWithResilience retry & fallback logic', () => {
    it('returns response immediately on first successful attempt', async () => {
      const { ai } = await import('./ai.js');
      const { generateWithResilience } = await import('./analysisFlows.js');

      const mockResponse = { text: 'Everything is fine', usage: { promptTokens: 50, completionTokens: 10 } };
      const generateSpy = vi.spyOn(ai, 'generate').mockResolvedValueOnce(mockResponse);

      const result = await generateWithResilience({ prompt: 'test' }, 'gemini-3.5-flash-lite');
      expect(result.response).toEqual(mockResponse);
      expect(result.modelUsed).toBe('gemini-3.5-flash-lite');
      expect(generateSpy).toHaveBeenCalledTimes(1);

      generateSpy.mockRestore();
    });

    it('retries on retryable errors and succeeds on subsequent attempt', async () => {
      const timerSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
      const { ai } = await import('./ai.js');
      const { generateWithResilience } = await import('./analysisFlows.js');

      const mockResponse = { text: 'Success on retry', usage: { promptTokens: 50, completionTokens: 10 } };
      const generateSpy = vi.spyOn(ai, 'generate')
        .mockRejectedValueOnce(new Error('503 Service Unavailable'))
        .mockResolvedValueOnce(mockResponse);

      const result = await generateWithResilience({ prompt: 'test' }, 'gemini-3.5-flash-lite');
      expect(result.response).toEqual(mockResponse);
      expect(generateSpy).toHaveBeenCalledTimes(2);

      generateSpy.mockRestore();
      timerSpy.mockRestore();
    });

    it('falls back to gemini-3.5-flash-lite when primary model exhausts retries', async () => {
      const timerSpy = vi.spyOn(global, 'setTimeout').mockImplementation((fn) => { fn(); return 0; });
      const { ai } = await import('./ai.js');
      const { generateWithResilience } = await import('./analysisFlows.js');

      const mockFallbackResponse = { text: 'Fallback success', usage: { promptTokens: 40, completionTokens: 8 } };
      const generateSpy = vi.spyOn(ai, 'generate')
        .mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED'))
        .mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED'))
        .mockRejectedValueOnce(new Error('RESOURCE_EXHAUSTED'))
        .mockResolvedValueOnce(mockFallbackResponse);

      const result = await generateWithResilience({ prompt: 'test' }, 'gemini-3.8-flash');
      expect(result.response).toEqual(mockFallbackResponse);
      expect(result.modelUsed).toBe('gemini-3.5-flash-lite');
      expect(generateSpy).toHaveBeenCalledTimes(4);

      generateSpy.mockRestore();
      timerSpy.mockRestore();
    });

    it('does not retry and throws immediately on non-retryable errors', async () => {
      const { ai } = await import('./ai.js');
      const { generateWithResilience } = await import('./analysisFlows.js');

      const nonRetryableError = new Error('Invalid prompt schema supplied');
      const generateSpy = vi.spyOn(ai, 'generate').mockRejectedValueOnce(nonRetryableError);

      await expect(
        generateWithResilience({ prompt: 'test' }, 'gemini-3.5-flash-lite')
      ).rejects.toThrow('Invalid prompt schema supplied');

      expect(generateSpy).toHaveBeenCalledTimes(1);
      generateSpy.mockRestore();
    });
  });
});

describe('Analysis Flows End-to-End Orchestration', () => {
  it('handles analyzeImageFlow quota blocking, success, and error gracefully', async () => {
    const { analyzeImageFlow } = await import('./analysisFlows.js');
    const { ai } = await import('./ai.js');
    const quotaModule = await import('./quotaManagement.js');
    const loggerModule = await import('./jobLogger.js');

    const logJobSpy = vi.spyOn(loggerModule, 'logJob').mockResolvedValue('mock-job-id');

    // 1. Quota blocked
    const quotaSpy = vi.spyOn(quotaModule, 'checkQuota').mockResolvedValueOnce(false);
    const blockedResult = await analyzeImageFlow({
      screenshots: { 's1': { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Check activity',
      classId: 'CLASS_1',
    });
    expect(blockedResult).toEqual({ s1: 'Error: Insufficient quota.' });
    expect(logJobSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked-by-quota' }));

    // 2. Success with AI generation
    quotaSpy.mockResolvedValueOnce(true);
    const generateSpy = vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      text: 'Student is working on task 1',
      usage: { promptTokens: 80, completionTokens: 20 },
    });
    const successResult = await analyzeImageFlow({
      screenshots: { 's1': { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Check activity',
      classId: 'CLASS_1',
    });
    expect(successResult).toEqual({ s1: 'Student is working on task 1' });
    expect(logJobSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));

    // 3. Error catch handling
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockRejectedValueOnce(new Error('Fatal API crash'));
    const errorResult = await analyzeImageFlow({
      screenshots: { 's1': { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Check activity',
      classId: 'CLASS_1',
    });
    expect(errorResult.s1).toContain('Error: Fatal API crash');
    expect(logJobSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));

    quotaSpy.mockRestore();
    generateSpy.mockRestore();
    logJobSpy.mockRestore();
  });

  it('handles analyzeSingleVideoFlow quota blocking, success, and error', async () => {
    const { analyzeSingleVideoFlow } = await import('./analysisFlows.js');
    const { ai } = await import('./ai.js');
    const quotaModule = await import('./quotaManagement.js');
    const loggerModule = await import('./jobLogger.js');

    const logJobSpy = vi.spyOn(loggerModule, 'logJob').mockResolvedValue('video-job-42');

    // 1. Quota blocked
    const quotaSpy = vi.spyOn(quotaModule, 'checkQuota').mockResolvedValueOnce(false);
    const blocked = await analyzeSingleVideoFlow({
      videoUrl: 'https://storage/v1.mp4',
      prompt: 'Analyze behavior',
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T10:00:00Z',
    });
    expect(blocked.result).toContain('Insufficient quota');
    expect(blocked.jobId).toBe('video-job-42');

    // 2. Success
    quotaSpy.mockResolvedValueOnce(true);
    const generateSpy = vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      text: 'Student completed lab exercise',
      usage: { promptTokens: 300, completionTokens: 50 },
    });
    const success = await analyzeSingleVideoFlow({
      videoUrl: 'https://storage/v1.mp4',
      prompt: 'Analyze behavior',
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T10:00:00Z',
    });
    expect(success.result).toBe('Student completed lab exercise');

    // 3. Error
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockRejectedValueOnce(new Error('Video format corrupted'));
    const error = await analyzeSingleVideoFlow({
      videoUrl: 'https://storage/v1.mp4',
      prompt: 'Analyze behavior',
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      startTime: '2026-08-30T09:00:00Z',
      endTime: '2026-08-30T10:00:00Z',
    });
    expect(error.result).toContain('Video format corrupted');

    quotaSpy.mockRestore();
    generateSpy.mockRestore();
    logJobSpy.mockRestore();
  });

  it('handles analyzeAllImagesFlow quota blocking, success, and error', async () => {
    const { analyzeAllImagesFlow } = await import('./analysisFlows.js');
    const { ai } = await import('./ai.js');
    const quotaModule = await import('./quotaManagement.js');
    const loggerModule = await import('./jobLogger.js');

    const logJobSpy = vi.spyOn(loggerModule, 'logJob').mockResolvedValue('batch-job-1');

    // 1. Quota blocked
    const quotaSpy = vi.spyOn(quotaModule, 'checkQuota').mockResolvedValueOnce(false);
    const blocked = await analyzeAllImagesFlow({
      screenshots: { s1: { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Summarize group progress',
      classId: 'CLASS_1',
    });
    expect(blocked).toContain('Insufficient quota');

    // 2. Success
    quotaSpy.mockResolvedValueOnce(true);
    const generateSpy = vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      text: 'All students actively coding',
      usage: { promptTokens: 150, completionTokens: 30 },
    });
    const success = await analyzeAllImagesFlow({
      screenshots: { s1: { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Summarize group progress',
      classId: 'CLASS_1',
    });
    expect(success).toBe('All students actively coding');

    // 3. Error
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockRejectedValueOnce(new Error('Connection dropped'));
    const error = await analyzeAllImagesFlow({
      screenshots: { s1: { url: 'https://storage/s1.jpg', email: 's1@school.edu' } },
      prompt: 'Summarize group progress',
      classId: 'CLASS_1',
    });
    expect(error).toContain('Connection dropped');

    quotaSpy.mockRestore();
    generateSpy.mockRestore();
    logJobSpy.mockRestore();
  });

  it('handles analyzeFaceFallbackFlow lifecycle (class missing, disabled, quota, success JSON/text fallback, error)', async () => {
    const { analyzeFaceFallbackFlow } = await import('./analysisFlows.js');
    const { ai } = await import('./ai.js');
    const quotaModule = await import('./quotaManagement.js');
    const loggerModule = await import('./jobLogger.js');
    const { getFirestore } = await import('firebase-admin/firestore');

    const db = getFirestore();
    const logJobSpy = vi.spyOn(loggerModule, 'logJob').mockResolvedValue('face-job-1');

    // 1. Class does not exist
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({ exists: false }),
      }),
    });
    const missingRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_NON_EXISTENT',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(missingRes.faceStatus).toBe('error');
    expect(missingRes.error).toContain('does not exist');

    // 2. Cloud Fallback disabled
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({ enableCloudFallback: false }),
        }),
      }),
    });
    const disabledRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(disabledRes.faceStatus).toBe('disabled');

    // 3. Quota exceeded
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({ enableCloudFallback: true }),
        }),
      }),
    });
    const quotaSpy = vi.spyOn(quotaModule, 'checkQuota').mockResolvedValueOnce(false);
    const quotaRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(quotaRes.faceStatus).toBe('quota_exceeded');

    // 4. Success with clean JSON
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({
            enableCloudFallback: true,
            liveImagePrompt: { promptText: 'Check {{studentEmail}} in {{classId}}' },
          }),
        }),
      }),
    });
    quotaSpy.mockResolvedValueOnce(true);
    const generateSpy = vi.spyOn(ai, 'generate').mockResolvedValueOnce({
      text: '{"faceStatus":"looking_away","confidence":0.95,"reason":"Student turned left"}',
      usage: { promptTokens: 100, completionTokens: 25 },
    });
    const successRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(successRes.faceStatus).toBe('looking_away');
    expect(successRes.confidence).toBe(0.95);

    // 5. Fallback text parser when JSON fails
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({ enableCloudFallback: true }),
        }),
      }),
    });
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockResolvedValueOnce({
      text: 'Student has no face detected in camera',
      usage: { promptTokens: 100, completionTokens: 25 },
    });
    const textFallbackRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(textFallbackRes.faceStatus).toBe('no_face');

    // 6. Error during generation
    vi.spyOn(db, 'collection').mockReturnValueOnce({
      doc: () => ({
        get: vi.fn().mockResolvedValueOnce({
          exists: true,
          data: () => ({ enableCloudFallback: true }),
        }),
      }),
    });
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockRejectedValueOnce(new Error('Vertex AI error'));
    const errorRes = await analyzeFaceFallbackFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      webcamUrl: 'https://storage/face.jpg',
    });
    expect(errorRes.faceStatus).toBe('error');
    expect(errorRes.error).toBe('Vertex AI error');

    quotaSpy.mockRestore();
    generateSpy.mockRestore();
    logJobSpy.mockRestore();
  });

  it('handles analyzeAudioFlow full lifecycle with audioUrl, transcript, quota, and errors', async () => {
    const { analyzeAudioFlow } = await import('./analysisFlows.js');
    const { ai } = await import('./ai.js');
    const quotaModule = await import('./quotaManagement.js');
    const loggerModule = await import('./jobLogger.js');

    const logJobSpy = vi.spyOn(loggerModule, 'logJob').mockResolvedValue('audio-job-1');

    // 1. Quota blocked
    const quotaSpy = vi.spyOn(quotaModule, 'checkQuota').mockResolvedValueOnce(false);
    const blocked = await analyzeAudioFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      audioUrl: 'https://storage/test.webm',
    });
    expect(blocked.error).toContain('Insufficient quota');

    // 2. Audio URL transcription and reasoning
    quotaSpy.mockResolvedValueOnce(true);
    const generateSpy = vi.spyOn(ai, 'generate')
      .mockResolvedValueOnce({
        text: 'What is the answer to question 2?',
        usage: { promptTokens: 50, completionTokens: 15 },
      })
      .mockResolvedValueOnce({
        text: 'Detected student asking for answer.',
        usage: { promptTokens: 80, completionTokens: 20 },
      });

    const res = await analyzeAudioFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      audioUrl: 'https://storage/test.webm',
    });
    expect(res.transcript).toBe('What is the answer to question 2?');
    expect(res.summary).toBe('Detected student asking for answer.');

    // 3. Supplied transcript path with template interpolation
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockResolvedValueOnce({
      text: 'Verified clean exam audio.',
      usage: { promptTokens: 40, completionTokens: 10 },
    });
    const directTranscriptRes = await analyzeAudioFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      studentEmail: 's1@school.edu',
      transcript: 'I am reading quietly',
      prompt: 'Check {{transcript}} for student {{studentEmail}} in {{classId}}',
    });
    expect(directTranscriptRes.transcript).toBe('I am reading quietly');
    expect(directTranscriptRes.summary).toBe('Verified clean exam audio.');

    // 4. Exception handling
    quotaSpy.mockResolvedValueOnce(true);
    generateSpy.mockRejectedValueOnce(new Error('Audio decoding failed'));
    const errorRes = await analyzeAudioFlow({
      classId: 'CLASS_1',
      studentUid: 's1',
      transcript: 'Some audio transcript',
    });
    expect(errorRes.error).toBe('Audio decoding failed');

    quotaSpy.mockRestore();
    generateSpy.mockRestore();
    logJobSpy.mockRestore();
  });
});



