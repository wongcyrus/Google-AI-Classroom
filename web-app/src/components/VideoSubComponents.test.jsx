import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VideoTable from './VideoTable';
import VideoPlayerModal, { formatDuration } from './VideoPlayerModal';
import VideoPromptSelector from './VideoPromptSelector';
import AiJobsTable from './AiJobsTable';
import VideoAnalysisJobsTable from './VideoAnalysisJobsTable';
import NativeDialog from './NativeDialog';
import NativeModalDialog from './meetings/NativeModalDialog';
import TimelineSlider from './TimelineSlider';

const mockGetDocs = vi.fn();
const mockMergeAudioCallable = vi.fn();
const mockGetDownloadURL = vi.fn();

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    collection: vi.fn((_db, ...path) => ({ path: path.join('/') })),
    query: vi.fn((col) => col),
    where: vi.fn(),
    limit: vi.fn(),
    getDocs: (...args) => mockGetDocs(...args),
  };
});

vi.mock('firebase/functions', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    httpsCallable: vi.fn(() => (...args) => mockMergeAudioCallable(...args)),
  };
});

vi.mock('firebase/storage', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    ref: vi.fn((_st, path) => ({ path })),
    getDownloadURL: (...args) => mockGetDownloadURL(...args),
  };
});

vi.mock('../hooks/useVideoPrompts', () => ({
  useVideoPrompts: vi.fn(() => [
    { id: 'p1', name: 'Summarize Engagement', accessLevel: 'public', content: 'Summarize how students interacted' },
    { id: 'p2', name: 'Detect Cheating', accessLevel: 'private', owner: 'u1', content: 'Detect irregularities' },
  ]),
}));

describe('Video & AI Analysis Sub-components', () => {
  beforeEach(() => {
    localStorage.setItem('teacher_privacy_mode', 'false');
  });

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

    it('renders friendly student name and cohort badge when studentProfiles is supplied', () => {
      const mockProfiles = {
        'student1@school.edu': {
          studentName: 'Alice Wong',
          nickname: 'Ally',
          studentClass: 'IT114115/1A',
          programme: 'HD in SE'
        }
      };

      render(
        <VideoTable
          videos={mockVideos}
          selectedVideos={new Set()}
          onSelectVideo={vi.fn()}
          onPlayVideo={vi.fn()}
          onDownloadVideo={vi.fn()}
          onSelectAll={vi.fn()}
          studentProfiles={mockProfiles}
        />
      );

      expect(screen.getByText('Ally (Alice Wong)')).toBeInTheDocument();
      expect(screen.getByText('IT114115/1A')).toBeInTheDocument();
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

    it('renders student audio player when audioUrl is present', () => {
      render(
        <VideoPlayerModal
          show={true}
          onClose={vi.fn()}
          videoUrl="https://video.mp4"
          audioUrl="https://audio.m4a"
          video={{ audioDuration: 180, audioClipCount: 12, studentUid: 'student_123' }}
        />
      );

      expect(screen.getByText(/Student Session Audio Track/i)).toBeInTheDocument();
      expect(screen.getByText(/🎧 Audio Available/i)).toBeInTheDocument();
      expect(screen.getByTestId('student-session-audio-player')).toHaveAttribute('src', 'https://audio.m4a');
      expect(screen.getByRole('link', { name: /Download Audio/i })).toHaveAttribute('href', 'https://audio.m4a');
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
        modelUsed: 'gemini-3.8-flash',
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
      expect(screen.getByText('gemini-3.8-flash')).toBeInTheDocument();
      expect(screen.getByText('completed')).toBeInTheDocument();
      expect(screen.getByText('Student was attentive throughout.')).toBeInTheDocument();
    });
  });

  describe('VideoAnalysisJobsTable Component', () => {
    const mockJobs = [
      {
        id: 'analysis_101',
        modelUsed: 'gemini-3.8-flash',
        createdAt: { toDate: () => new Date('2026-08-29T11:30:00Z') },
        status: 'completed',
        prompt: 'Check compliance with exam rules',
        aiJobIds: ['job_1'],
      },
    ];

    it('renders analysis jobs list and handles row selection', () => {
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
      expect(screen.getByText('gemini-3.8-flash')).toBeInTheDocument();
      expect(screen.queryByText('Actions')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('analysis_101'));
      expect(onSelectJob).toHaveBeenCalledWith(mockJobs[0]);
    });

    it('triggers onViewPrompt when prompt cell or Modal button is clicked', () => {
      const onViewPrompt = vi.fn();
      render(
        <VideoAnalysisJobsTable
          jobs={mockJobs}
          selectedJob={null}
          onSelectJob={vi.fn()}
          onDeleteJob={vi.fn()}
          onViewPrompt={onViewPrompt}
        />
      );

      const modalBtn = screen.getByRole('button', { name: /Modal/i });
      fireEvent.click(modalBtn);
      expect(onViewPrompt).toHaveBeenCalledWith(mockJobs[0]);
    });
  });

  describe('PromptViewModal Component', () => {
    it('renders full prompt text and allows copying', async () => {
      const mockJob = {
        id: 'job_xyz',
        modelUsed: 'gemini-3.8-flash',
        prompt: 'Track student progress across milestone 1 and milestone 2.',
        createdAt: { toDate: () => new Date('2026-09-01T10:00:00Z') },
      };
      const onClose = vi.fn();
      Object.assign(navigator, {
        clipboard: {
          writeText: vi.fn().mockResolvedValue(undefined),
        },
      });

      const { default: PromptViewModal } = await import('./PromptViewModal');
      render(<PromptViewModal show={true} onClose={onClose} job={mockJob} />);

      expect(screen.getByText('Video Analysis Prompt')).toBeInTheDocument();
      expect(screen.getByText('job_xyz')).toBeInTheDocument();
      expect(screen.getByText('gemini-3.8-flash')).toBeInTheDocument();
      expect(screen.getByText(/Track student progress across milestone 1/)).toBeInTheDocument();

      const copyBtn = screen.getByRole('button', { name: /Copy Prompt/i });
      fireEvent.click(copyBtn);
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockJob.prompt);
    });
  });

  describe('VideoPlayerModal Async Audio Lookup & Merging', () => {
    it('formats durations properly and resolves combinedAudios or merges raw session audio clips', async () => {
      expect(formatDuration(0)).toBe('0:00');
      expect(formatDuration(-5)).toBe('0:00');
      expect(formatDuration(125)).toBe('2:05');

      // Case 1: combinedAudios has audioPath resolved via getDownloadURL
      mockGetDocs.mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'comb_1',
            data: () => ({
              audioPath: 'classes/c1/combined/s1.mp3',
              durationSeconds: 95,
              clipCount: 4,
              createdAt: { _seconds: 1700000100 },
            }),
          },
        ],
      });
      mockGetDownloadURL.mockResolvedValueOnce('https://cdn.example.com/combined_s1.mp3');

      const { unmount } = render(
        <VideoPlayerModal
          show={true}
          onClose={vi.fn()}
          videoUrl="https://cdn.example.com/v1.mp4"
          classId="c1"
          video={{
            id: 'v1',
            studentUid: 's1',
            studentEmail: 's1@school.edu',
            duration: 40,
            captureInterval: 15,
            startTime: { _seconds: 1700000000 },
            endTime: { _seconds: 1700000600 },
          }}
        />
      );

      expect(screen.getByText(/Time-Lapse Screencast:/i)).toBeInTheDocument();
      await waitFor(() => {
        expect(screen.getByTestId('student-session-audio-player')).toHaveAttribute(
          'src',
          'https://cdn.example.com/combined_s1.mp3'
        );
      });
      expect(screen.getByText('1:35')).toBeInTheDocument();
      unmount();

      // Case 2: combinedAudios is empty, raw audio clips exist with transcript and trigger mergeStudentSessionAudio
      mockGetDocs
        .mockResolvedValueOnce({ empty: true, docs: [] }) // combinedAudios empty
        .mockResolvedValueOnce({
          empty: false,
          docs: [
            { id: 'raw_1', data: () => ({ transcript: 'Hello teacher' }) },
            { id: 'raw_2', data: () => ({ transcript: 'Testing Docker container' }) },
          ],
        });
      mockMergeAudioCallable.mockResolvedValueOnce({
        data: {
          status: 'success',
          jobId: 'merged_job_1',
          audioUrl: 'https://cdn.example.com/merged_session.mp3',
          durationSeconds: 42,
          clipCount: 2,
        },
      });

      render(
        <VideoPlayerModal
          show={true}
          onClose={vi.fn()}
          videoUrl="https://cdn.example.com/v2.mp4"
          classId="c1"
          video={{
            id: 'v2',
            studentUid: 's2',
            studentEmail: 's2@school.edu',
          }}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Full session audio track automatically combined/i)).toBeInTheDocument();
      });
      expect(screen.getByText(/Hello teacher \.\.\. Testing Docker container/i)).toBeInTheDocument();
    });
  });

  describe('NativeDialog, NativeModalDialog & TimelineSlider Components', () => {
    it('renders TimelineSlider buffered ranges and triggers onChange', () => {
      const onChange = vi.fn();
      const { container } = render(
        <TimelineSlider
          min={0}
          max={100}
          value={25}
          onChange={onChange}
          bufferedRanges={[
            { start: 0, end: 30 },
            { start: 50, end: 80 },
          ]}
        />
      );

      const bufferedBars = container.querySelectorAll('.timeline-slider-buffered');
      expect(bufferedBars).toHaveLength(2);
      const sliderInput = screen.getByRole('slider');
      fireEvent.change(sliderInput, { target: { value: '40' } });
      expect(onChange).toHaveBeenCalled();
    });

    it('handles NativeDialog backdrop click, inside drag guard, and Escape cancel event', () => {
      const onClose = vi.fn();
      const { container, rerender } = render(
        <NativeDialog isOpen={true} onClose={onClose} ariaLabel="Test Native Dialog">
          <div data-testid="inside-box">Dialog Body</div>
        </NativeDialog>
      );

      const dialog = container.querySelector('dialog');
      expect(dialog).toBeInTheDocument();

      // Pointer down inside, then click on dialog backdrop -> should NOT close (drag-out guard)
      const inside = screen.getByTestId('inside-box');
      fireEvent.pointerDown(inside);
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();

      // Pointer down directly on dialog backdrop, then click -> should close
      fireEvent.pointerDown(dialog);
      fireEvent.click(dialog);
      expect(onClose).toHaveBeenCalledTimes(1);

      // Cancel event triggers onClose when closeOnEscape is true
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
      expect(onClose).toHaveBeenCalledTimes(2);

      // Rerender with isOpen={false}
      rerender(
        <NativeDialog isOpen={false} onClose={onClose} ariaLabel="Test Native Dialog">
          <div>Hidden</div>
        </NativeDialog>
      );
      expect(container.querySelector('dialog')).toBeNull();
    });

    it('handles NativeModalDialog open/close lifecycle, cancel dismissal, and Safari pointer outside fallback', () => {
      const onClose = vi.fn();
      const { container, rerender } = render(
        <NativeModalDialog open={true} onClose={onClose} canDismiss={false} ariaLabel="Non-dismissible Modal">
          <div>Modal Content</div>
        </NativeModalDialog>
      );

      const dialog = container.querySelector('dialog');
      expect(dialog).toBeInTheDocument();

      // Cancel when canDismiss=false prevents default and does not call onClose
      const cancelEvt = new Event('cancel', { cancelable: true });
      fireEvent(dialog, cancelEvt);
      expect(onClose).not.toHaveBeenCalled();

      // Rerender with canDismiss=true
      rerender(
        <NativeModalDialog open={true} onClose={onClose} canDismiss={true} ariaLabel="Dismissible Modal">
          <div>Modal Content</div>
        </NativeModalDialog>
      );

      const dialog2 = container.querySelector('dialog');
      dialog2.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 300 });
      fireEvent.pointerDown(dialog2, { clientX: 20, clientY: 20 });
      fireEvent.pointerUp(dialog2, { clientX: 25, clientY: 25 });
      expect(onClose).toHaveBeenCalled();

      // Native close event
      fireEvent(dialog2, new Event('close'));
      expect(onClose).toHaveBeenCalledTimes(2);
    });
  });
});
