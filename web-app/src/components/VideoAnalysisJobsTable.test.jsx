import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoAnalysisJobsTable from './VideoAnalysisJobsTable';

describe('VideoAnalysisJobsTable Component', () => {
  const mockJobs = [
    {
      id: 'job_1',
      modelUsed: 'gemini-3.7-flash',
      createdAt: { toDate: () => new Date('2026-08-30T10:00:00Z') },
      videos: ['v1', 'v2'],
      status: 'completed',
      prompt: 'Check for unauthorized device usage during the coding exam.',
      aiJobIds: ['sub_1', 'sub_2'],
    },
    {
      id: 'job_2',
      model: 'gemini-3.5-flash-lite',
      createdAt: null,
      videos: [],
      status: 'failed',
      prompt: '',
      aiJobIds: ['sub_3'],
    },
    {
      id: 'job_3',
      status: 'partial_failure',
      prompt: 'Assess cheating probability',
    },
    {
      id: 'job_4',
      status: 'processing',
      prompt: 'Analyze screen layout',
    },
    {
      id: 'job_5',
      status: 'pending',
      prompt: 'Pending check',
    },
  ];

  it('renders all jobs and displays appropriate status badges and fallbacks', () => {
    const onSelectJob = vi.fn();
    const onDeleteJob = vi.fn();
    const onViewPrompt = vi.fn();

    render(
      <VideoAnalysisJobsTable
        jobs={mockJobs}
        selectedJob={mockJobs[0]}
        onSelectJob={onSelectJob}
        onDeleteJob={onDeleteJob}
        onViewPrompt={onViewPrompt}
      />
    );

    expect(screen.getByText('job_1')).toBeInTheDocument();
    expect(screen.getByText('job_2')).toBeInTheDocument();
    expect(screen.getByText('2 videos')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('partial_failure')).toBeInTheDocument();
    expect(screen.getByText('processing')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
    expect(screen.getByText('Default rubric')).toBeInTheDocument();
  });

  it('handles row selection to view job details without duplicated action buttons', () => {
    const onSelectJob = vi.fn();
    const onDeleteJob = vi.fn();
    const onViewPrompt = vi.fn();

    render(
      <VideoAnalysisJobsTable
        jobs={mockJobs}
        selectedJob={null}
        onSelectJob={onSelectJob}
        onDeleteJob={onDeleteJob}
        onViewPrompt={onViewPrompt}
      />
    );

    // Verify Action column and duplicated buttons are removed
    expect(screen.queryByText('Actions')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View Details/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    // Click row navigates to job details
    fireEvent.click(screen.getByText('job_1'));
    expect(onSelectJob).toHaveBeenCalledWith(mockJobs[0]);

    fireEvent.click(screen.getByText('job_2'));
    expect(onSelectJob).toHaveBeenCalledWith(mockJobs[1]);
  });

  it('handles prompt modal triggers from prompt cell and modal link without inline expansion', () => {
    const onSelectJob = vi.fn();
    const onDeleteJob = vi.fn();
    const onViewPrompt = vi.fn();

    render(
      <VideoAnalysisJobsTable
        jobs={mockJobs}
        selectedJob={null}
        onSelectJob={onSelectJob}
        onDeleteJob={onDeleteJob}
        onViewPrompt={onViewPrompt}
      />
    );

    // Verify inline expand button is not present
    expect(screen.queryByRole('button', { name: /Expand inline/i })).not.toBeInTheDocument();

    // Click "🔍 Modal" button
    const modalButtons = screen.getAllByRole('button', { name: /🔍 Modal/i });
    fireEvent.click(modalButtons[0]);
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);

    // Click prompt cell directly
    const promptSnippet = screen.getByText(/Check for unauthorized device usage/i);
    fireEvent.click(promptSnippet);
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);
  });
});
