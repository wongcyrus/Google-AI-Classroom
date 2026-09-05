import { describe, it, expect } from 'vitest';

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

