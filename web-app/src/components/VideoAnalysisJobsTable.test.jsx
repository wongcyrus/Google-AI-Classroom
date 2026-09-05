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

  it('handles row selection, details view, and deletion', () => {
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

    // Click row
    fireEvent.click(screen.getByText('job_1'));
    expect(onSelectJob).toHaveBeenCalledWith(mockJobs[0]);

    // Click View Details button
    const detailButtons = screen.getAllByRole('button', { name: /View Details/i });
    fireEvent.click(detailButtons[1]);
    expect(onSelectJob).toHaveBeenCalledWith(mockJobs[1]);

    // Click Delete button
    const deleteButtons = screen.getAllByRole('button', { name: /Delete/i });
    fireEvent.click(deleteButtons[0]);
    expect(onDeleteJob).toHaveBeenCalledWith('job_1', ['sub_1', 'sub_2']);
  });

  it('handles prompt modal triggers from prompt cell, action button, and modal link', () => {
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

    // Click "📜 View Prompt" button
    const viewPromptButtons = screen.getAllByRole('button', { name: /View Prompt/i });
    fireEvent.click(viewPromptButtons[0]);
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);

    // Click "🔍 Modal" link button
    const modalButtons = screen.getAllByRole('button', { name: /🔍 Modal/i });
    fireEvent.click(modalButtons[0]);
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);

    // Click prompt cell directly
    const promptSnippet = screen.getByText(/Check for unauthorized device usage/i);
    fireEvent.click(promptSnippet);
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);
  });

  it('expands and collapses inline prompt preview and handles open modal from inline view', () => {
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

    const expandButtons = screen.getAllByRole('button', { name: /👁️ Expand inline/i });
    fireEvent.click(expandButtons[0]);

    // Inline view should now be visible
    expect(screen.getByText(/📝 Prompt for Job/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /🔍 Open in Modal/i })).toBeInTheDocument();

    // Click open in modal from inline expansion
    fireEvent.click(screen.getByRole('button', { name: /🔍 Open in Modal/i }));
    expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);

    // Collapse with close button
    fireEvent.click(screen.getByRole('button', { name: /✕ Close/i }));
    expect(screen.queryByText(/📝 Prompt for Job/i)).not.toBeInTheDocument();

    // Re-expand and collapse using toggle button
    fireEvent.click(screen.getAllByRole('button', { name: /👁️ Expand inline/i })[0]);
    expect(screen.getByText(/📝 Prompt for Job/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /🔼 Collapse/i }));
    expect(screen.queryByText(/📝 Prompt for Job/i)).not.toBeInTheDocument();
  });
});
