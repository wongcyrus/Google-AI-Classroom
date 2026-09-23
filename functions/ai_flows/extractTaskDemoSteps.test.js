import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('firebase-admin/storage', () => ({
  getStorage: () => ({
    bucket: () => ({
      name: 'test-bucket',
    }),
  }),
}));

const mockGenerateWithResilience = vi.fn();
vi.mock('./analysisFlows.js', () => ({
  generateWithResilience: (...args) => mockGenerateWithResilience(...args),
}));

vi.mock('./jobLogger.js', () => ({
  logJob: vi.fn().mockResolvedValue(true),
}));

import { handleExtractTaskDemoSteps } from './extractTaskDemoSteps.js';

describe('extractTaskDemoSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws invalid-argument when classId is missing', async () => {
    await expect(
      handleExtractTaskDemoSteps({ demoVideoPath: 'demo.mp4' })
    ).rejects.toThrow(/classId/);
  });

  it('throws invalid-argument when demoVideoPath is missing', async () => {
    await expect(
      handleExtractTaskDemoSteps({ classId: 'c1' })
    ).rejects.toThrow(/demoVideoPath/);
  });

  it('successfully extracts structured rubric steps from demo video', async () => {
    const mockOutput = {
      title: 'Dockerizing Node.js Application',
      description: 'Follow the demo to containerize an Express app and expose port 3000.',
      suggestedMaxScore: 100,
      steps: [
        {
          stepNumber: 1,
          title: 'Write Dockerfile',
          description: 'Use node:alpine and copy package.json',
          expectedEvidence: 'Dockerfile in VS Code editor',
          points: 40,
        },
        {
          stepNumber: 2,
          title: 'Build and Run Container',
          description: 'Run docker build and docker run on port 3000',
          expectedEvidence: 'Terminal output showing container ID and port 3000 mapped',
          points: 60,
        },
      ],
    };

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify(mockOutput),
        usage: { inputTokens: 500, outputTokens: 200 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'demos/docker_demo.mp4',
      promptGuidelines: 'Focus on container build commands',
    });

    expect(res.title).toBe('Dockerizing Node.js Application');
    expect(res.steps).toHaveLength(2);
    expect(res.steps[0].points).toBe(40);
    expect(res.steps[1].points).toBe(60);
    expect(res.modelUsed).toBe('gemini-3.8-flash');
  });

  it('handles JSON parsing errors by returning safe fallback structure', async () => {
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: 'This is not valid JSON at all!',
        usage: { inputTokens: 100, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'demos/demo.mp4',
    });

    expect(res.title).toBe('Practical Lab Task');
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].points).toBe(100);
  });

  it('strips markdown code fence blocks if returned by the LLM', async () => {
    const payload = {
      title: 'Markdown Fenced Task',
      steps: [{ stepNumber: 1, title: 'Step 1', points: 100 }],
    };

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: '```json\n' + JSON.stringify(payload) + '\n```',
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'gs://test-bucket/video.mp4',
    });

    expect(res.title).toBe('Markdown Fenced Task');
  });

  it('handles logJob error gracefully without throwing', async () => {
    const { logJob } = await import('./jobLogger.js');
    vi.mocked(logJob).mockRejectedValueOnce(new Error('Logging failed'));

    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ title: 'Task with Log Error', steps: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'demo.mp4',
    });

    expect(res.title).toBe('Task with Log Error');
  });

  it('extractTaskDemoSteps onCall handler enforces authentication and handles payload', async () => {
    const { extractTaskDemoSteps } = await import('./extractTaskDemoSteps.js');

    // Unauthenticated
    await expect(
      extractTaskDemoSteps.run ? extractTaskDemoSteps.run({ auth: null, data: {} }) : extractTaskDemoSteps({ auth: null, data: {} })
    ).rejects.toThrow(/authenticated/);

    // Authenticated
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({ title: 'Auth Task', steps: [] }),
        usage: { inputTokens: 50, outputTokens: 20 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const runFn = extractTaskDemoSteps.run || extractTaskDemoSteps;
    const res = await runFn({
      auth: { uid: 'teacher_1' },
      data: { classId: 'c1', demoVideoPath: 'demo.mp4' },
    });

    expect(res.title).toBe('Auth Task');
  });

  it('supports YouTube URLs directly and passes url to generation', async () => {
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          title: 'YouTube Based Task',
          description: 'Task based on public YouTube tutorial',
          suggestedMaxScore: 100,
          steps: [{ stepNumber: 1, title: 'Step 1', points: 100 }],
        }),
        usage: { inputTokens: 100, outputTokens: 50 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      promptGuidelines: 'Focus on setup',
    });

    expect(mockGenerateWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.arrayContaining([
          expect.objectContaining({ text: expect.stringContaining('dQw4w9WgXcQ') }),
          expect.objectContaining({
            media: {
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              contentType: 'video/mp4',
            },
          }),
        ]),
      }),
      'gemini-3.8-flash'
    );
    expect(res.title).toBe('YouTube Based Task');
  });

  it('recovers with contextual prompt fallback if YouTube media URL generation fails', async () => {
    // First call with media fails
    mockGenerateWithResilience.mockRejectedValueOnce(new Error('Vertex AI video URL not accessible'));
    // Fallback call succeeds
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          title: 'Recovered YouTube Task',
          steps: [{ stepNumber: 1, title: 'Fallback Step', points: 100 }],
        }),
        usage: { inputTokens: 80, outputTokens: 40 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'https://youtu.be/dQw4w9WgXcQ',
    });

    expect(mockGenerateWithResilience).toHaveBeenCalledTimes(2);
    expect(res.title).toBe('Recovered YouTube Task');
  });

  it('incorporates promptText from AI Prompts library into multimodal prompt', async () => {
    mockGenerateWithResilience.mockResolvedValueOnce({
      response: {
        text: JSON.stringify({
          title: 'Rubric-Guided Lab',
          description: 'Task extracted using library prompt',
          steps: [
            { stepNumber: 1, title: 'Scaffold Project', points: 40 },
            { stepNumber: 2, title: 'Verify Output', points: 60 }
          ],
        }),
        usage: { inputTokens: 120, outputTokens: 60 },
      },
      modelUsed: 'gemini-3.8-flash',
    });

    const libraryPromptText = 'Extract rigorous Docker containerization milestones with terminal inspection.';
    const res = await handleExtractTaskDemoSteps({
      classId: 'c1',
      demoVideoPath: 'tasks/demo1.mp4',
      promptText: libraryPromptText,
      promptGuidelines: 'Focus on port 8080.',
    });

    expect(mockGenerateWithResilience).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.arrayContaining([
          expect.objectContaining({
            text: expect.stringContaining(libraryPromptText),
          }),
        ]),
      }),
      'gemini-3.8-flash'
    );
    expect(res.steps).toHaveLength(2);
    expect(res.title).toBe('Rubric-Guided Lab');
  });
});

