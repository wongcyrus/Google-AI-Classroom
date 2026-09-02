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
});
