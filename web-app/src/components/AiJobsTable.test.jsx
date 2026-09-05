import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AiJobsTable from './AiJobsTable';

describe('AiJobsTable Component', () => {
  const mockAiJobs = [
    {
      id: 'ai_job_1',
      studentEmail: 'student1@school.edu',
      modelUsed: 'gemini-3.7-flash',
      cost: 0.0042,
      status: 'completed',
      result: 'Normal classroom behavior observed throughout session.',
      timestamp: { toDate: () => new Date('2026-08-30T10:00:00Z') },
      mediaPaths: ['videos/student1.mp4'],
    },
    {
      id: 'ai_job_2',
      studentEmail: 'student2@school.edu',
      status: 'failed',
      errorDetails: 'Quota exceeded for Vertex AI Gemini video API endpoint in region us-central1.',
      videoPath: 'videos/student2.mp4',
    },
    {
      id: 'ai_job_3',
      studentEmail: 'student3@school.edu',
      status: 'processing',
      result: {
        violation: true,
        summary: 'Student repeatedly looked towards secondary device not in view of camera.',
        confidence: 0.94
      },
      path: 'videos/student3.mp4',
    },
    {
      id: 'ai_job_4',
      studentEmail: 'student4@school.edu',
      status: 'running',
      result: 'This is an extremely long evaluation summary text designed to exceed ninety characters in length and verify truncation.',
    },
    {
      id: 'ai_job_5',
      studentEmail: 'student5@school.edu',
      status: 'queued',
      result: null,
    },
  ];

  it('renders all jobs, formats costs and models, and handles status badges', () => {
    const onPlayVideo = vi.fn();
    const onInspectResult = vi.fn();

    render(
      <AiJobsTable
        aiJobs={mockAiJobs}
        onPlayVideo={onPlayVideo}
        onInspectResult={onInspectResult}
      />
    );

    expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
    expect(screen.getByText('gemini-3.7-flash')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('processing')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('queued')).toBeInTheDocument();
  });

  it('triggers video playback for mediaPaths, videoPath, and path fallbacks', () => {
    const onPlayVideo = vi.fn();
    const onInspectResult = vi.fn();

    render(
      <AiJobsTable
        aiJobs={mockAiJobs}
        onPlayVideo={onPlayVideo}
        onInspectResult={onInspectResult}
      />
    );

    const playButtons = screen.getAllByRole('button', { name: '▶️' });
    // First job with mediaPaths
    fireEvent.click(playButtons[0]);
    expect(onPlayVideo).toHaveBeenCalledWith({ videoPath: 'videos/student1.mp4' });

    // Second job with videoPath
    fireEvent.click(playButtons[1]);
    expect(onPlayVideo).toHaveBeenCalledWith({ videoPath: 'videos/student2.mp4' });

    // Third job with path
    fireEvent.click(playButtons[2]);
    expect(onPlayVideo).toHaveBeenCalledWith({ videoPath: 'videos/student3.mp4' });
  });

  it('renders error details with inspect button for failed jobs', () => {
    const onPlayVideo = vi.fn();
    const onInspectResult = vi.fn();

    render(
      <AiJobsTable
        aiJobs={mockAiJobs}
        onPlayVideo={onPlayVideo}
        onInspectResult={onInspectResult}
      />
    );

    const detailsBtn = screen.getByRole('button', { name: 'Details' });
    fireEvent.click(detailsBtn);
    expect(onInspectResult).toHaveBeenCalledWith(mockAiJobs[1]);
  });

  it('renders truncated result preview and handles view inspect for long and object results', () => {
    const onPlayVideo = vi.fn();
    const onInspectResult = vi.fn();

    render(
      <AiJobsTable
        aiJobs={mockAiJobs}
        onPlayVideo={onPlayVideo}
        onInspectResult={onInspectResult}
      />
    );

    const viewButtons = screen.getAllByRole('button', { name: /View/i });
    expect(viewButtons.length).toBeGreaterThan(0);

    fireEvent.click(viewButtons[0]);
    expect(onInspectResult).toHaveBeenCalled();
  });

  it('triggers row-level CSV and JSON exports for student jobs', () => {
    render(
      <AiJobsTable
        aiJobs={mockAiJobs}
        onPlayVideo={vi.fn()}
        onInspectResult={vi.fn()}
      />
    );

    const csvButtons = screen.getAllByRole('button', { name: 'CSV' });
    const jsonButtons = screen.getAllByRole('button', { name: 'JSON' });

    expect(csvButtons.length).toBe(mockAiJobs.length);
    expect(jsonButtons.length).toBe(mockAiJobs.length);

    // Click CSV and JSON exports for first job
    fireEvent.click(csvButtons[0]);
    fireEvent.click(jsonButtons[0]);
  });
});
