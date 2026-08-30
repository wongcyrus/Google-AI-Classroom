import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoTable from './VideoTable';
import VideoPlayerModal from './VideoPlayerModal';
import VideoPromptSelector from './VideoPromptSelector';
import AiJobsTable from './AiJobsTable';
import VideoAnalysisJobsTable from './VideoAnalysisJobsTable';

vi.mock('../hooks/useVideoPrompts', () => ({
  useVideoPrompts: vi.fn(() => [
    { id: 'p1', name: 'Summarize Engagement', accessLevel: 'public', content: 'Summarize how students interacted' },
    { id: 'p2', name: 'Detect Cheating', accessLevel: 'private', owner: 'u1', content: 'Detect irregularities' },
  ]),
}));

describe('Video & AI Analysis Sub-components', () => {
  describe('VideoTable Component', () => {
    const mockVideos = [
      {
        id: 'v1',
        studentEmail: 'student1@school.edu',
        startTime: { toDate: () => new Date('2026-08-29T10:00:00Z') },
        endTime: { toDate: () => new Date('2026-08-29T10:30:00Z') },
        duration: 1800,
        size: 1024 * 1024 * 10,
        createdAt: { toDate: () => new Date('2026-08-29T10:35:00Z') },
        videoPath: 'videos/v1.mp4',
      },
    ];

    it('renders video rows with play and download buttons', () => {
      const onPlayVideo = vi.fn();
      const onDownloadVideo = vi.fn();
      const onSelectVideo = vi.fn();

      render(
        <VideoTable
          videos={mockVideos}
          selectedVideos={new Set()}
          onSelectVideo={onSelectVideo}
          onPlayVideo={onPlayVideo}
          onDownloadVideo={onDownloadVideo}
          onSelectAll={vi.fn()}
        />
      );

      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
      expect(screen.getByText('10.00 MB')).toBeInTheDocument();

      const playBtn = screen.getByRole('button', { name: '▶️' });
      fireEvent.click(playBtn);
      expect(onPlayVideo).toHaveBeenCalledWith(mockVideos[0]);

      const downloadBtn = screen.getByRole('button', { name: 'Download' });
      fireEvent.click(downloadBtn);
      expect(onDownloadVideo).toHaveBeenCalledWith(mockVideos[0]);
    });
  });

  describe('VideoPlayerModal Component', () => {
    it('returns null when show is false', () => {
      const { container } = render(<VideoPlayerModal show={false} onClose={vi.fn()} videoUrl="" />);
      expect(container.firstChild).toBeNull();
    });

    it('renders video element when show is true', () => {
      const onClose = vi.fn();
      render(<VideoPlayerModal show={true} onClose={onClose} videoUrl="https://video.mp4" loading={false} />);
      const closeBtn = screen.getByRole('button', { name: '×' });
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('VideoPromptSelector Component', () => {
    it('renders filter radio buttons and prompt options', () => {
      const onSelectPrompt = vi.fn();
      const onTextChange = vi.fn();

      render(
        <VideoPromptSelector
          user={{ uid: 'u1' }}
          selectedPrompt={null}
          onSelectPrompt={onSelectPrompt}
          promptText=""
          onTextChange={onTextChange}
        />
      );

      expect(screen.getByText('All')).toBeInTheDocument();
      expect(screen.getByText('Summarize Engagement')).toBeInTheDocument();

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'p1' } });
      expect(onSelectPrompt).toHaveBeenCalled();

      // Test radio filters
      const publicRadio = screen.getByLabelText(/Public/i);
      fireEvent.click(publicRadio);

      const privateRadio = screen.getByLabelText(/Private/i);
      fireEvent.click(privateRadio);

      const sharedRadio = screen.getByLabelText(/Shared/i);
      fireEvent.click(sharedRadio);

      const textarea = screen.getByPlaceholderText(/Select a prompt or enter text here/i);
      fireEvent.change(textarea, { target: { value: 'Updated prompt content' } });
      expect(onTextChange).toHaveBeenCalledWith('Updated prompt content');
    });

    it('handles null user gracefully', () => {
      render(
        <VideoPromptSelector
          user={null}
          selectedPrompt={null}
          onSelectPrompt={vi.fn()}
          promptText=""
          onTextChange={vi.fn()}
        />
      );
      expect(screen.getByText('-- Select a prompt --')).toBeInTheDocument();
    });
  });

  describe('AiJobsTable Component', () => {
    const mockJobs = [
      {
        id: 'job_1',
        studentEmail: 'alice@school.edu',
        modelUsed: 'gemini-3.7-pro',
        status: 'completed',
        result: 'Student was attentive throughout.',
        timestamp: { toDate: () => new Date('2026-08-29T11:00:00Z') },
        mediaPaths: ['videos/alice.mp4'],
      },
    ];

    it('renders job status, model badge, and result', () => {
      const onPlayVideo = vi.fn();
      render(<AiJobsTable aiJobs={mockJobs} onPlayVideo={onPlayVideo} />);
      expect(screen.getByText('alice@school.edu')).toBeInTheDocument();
      expect(screen.getByText('gemini-3.7-pro')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('Student was attentive throughout.')).toBeInTheDocument();
    });
  });

  describe('VideoAnalysisJobsTable Component', () => {
    const mockJobs = [
      {
        id: 'analysis_101',
        modelUsed: 'gemini-3.7-flash',
        createdAt: { toDate: () => new Date('2026-08-29T11:30:00Z') },
        status: 'completed',
        prompt: 'Check compliance with exam rules',
        aiJobIds: ['job_1'],
      },
    ];

    it('renders analysis jobs list with delete action', () => {
      const onDeleteJob = vi.fn();
      const onSelectJob = vi.fn();

      render(
        <VideoAnalysisJobsTable
          jobs={mockJobs}
          selectedJob={null}
          onSelectJob={onSelectJob}
          onDeleteJob={onDeleteJob}
        />
      );

      expect(screen.getByText('analysis_101')).toBeInTheDocument();
      expect(screen.getByText('gemini-3.7-flash')).toBeInTheDocument();

      const deleteBtn = screen.getByRole('button', { name: 'Delete' });
      fireEvent.click(deleteBtn);
      expect(onDeleteJob).toHaveBeenCalledWith('analysis_101', ['job_1']);
    });
  });
});
