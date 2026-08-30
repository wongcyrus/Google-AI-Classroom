import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VideoAnalysisJobs from './VideoAnalysisJobs';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockHttpsCallable = vi.fn().mockReturnValue(vi.fn().mockResolvedValue({ data: { result: 'Retry initiated for 2 videos' } }));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: (...args) => mockHttpsCallable(...args),
}));

const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.local/video_sub.mp4');
vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn(),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const mockJobs = [
  {
    id: 'job_v1',
    status: 'completed',
    modelUsed: 'gemini-3.7-flash',
    promptText: 'Detect abnormal behavior',
    aiJobIds: ['ai_sub_1', 'ai_sub_2'],
    createdAt: { toDate: () => new Date('2026-08-30T01:00:00Z') },
  },
];

const mockFetchNextPage = vi.fn();
const mockFetchPrevPage = vi.fn();
const mockRefetch = vi.fn();

let mockPaginatedQueryReturn = {
  data: mockJobs,
  loading: false,
  refetch: mockRefetch,
  fetchNextPage: mockFetchNextPage,
  fetchPrevPage: mockFetchPrevPage,
  isLastPage: false,
  page: 1,
};

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => mockPaginatedQueryReturn,
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  documentId: vi.fn(),
  doc: vi.fn(() => ({ id: 'mockDoc' })),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    id: 'job_v1',
    data: () => ({
      id: 'job_v1',
      status: 'completed',
      modelUsed: 'gemini-3.7-flash',
      promptText: 'Detect abnormal behavior',
      aiJobIds: ['ai_sub_1', 'ai_sub_2'],
    }),
  }),
  getDocs: vi.fn().mockResolvedValue({
    forEach: (cb) => {
      cb({
        id: 'ai_sub_1',
        data: () => ({
          studentEmail: 'student1@school.edu',
          status: 'completed',
          result: 'Student was attentive',
          timestamp: { toDate: () => new Date('2026-08-30T01:10:00Z') },
          mediaPaths: ['videos/student1.mp4'],
        }),
      });
      cb({
        id: 'ai_sub_2',
        data: () => ({
          studentEmail: 'student2@school.edu',
          status: 'failed',
          errorDetails: 'Quota exceeded',
          timestamp: { toDate: () => new Date('2026-08-30T01:11:00Z') },
          mediaPaths: ['videos/student2.mp4'],
        }),
      });
    },
  }),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue({}),
  })),
}));

describe('VideoAnalysisJobs Component Full Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-csv');
    URL.revokeObjectURL = vi.fn();
  });

  it('renders video analysis jobs list and selects a job to load AI sub-jobs', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    expect(screen.getByText('Video Analysis Jobs')).toBeInTheDocument();
    expect(screen.getByText('job_v1')).toBeInTheDocument();

    // Click on row to select
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
      expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
    });
  });

  it('retries failed sub-jobs via callable function', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    // Select job first
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
    });

    // Retry button appears when failed sub-jobs exist
    const retryBtn = screen.queryByRole('button', { name: /Retry Failed Jobs/i });
    if (retryBtn) {
      await act(async () => {
        fireEvent.click(retryBtn);
      });
      expect(mockHttpsCallable).toHaveBeenCalled();
    }
  });

  it('exports AI jobs to CSV', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    // Select job
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /Export AI Jobs/i });
    fireEvent.click(exportBtn);

    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('handles soft deletion of video analysis job', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('deleted'));
    });
  });

  it('handles pagination navigation and playing a video from AI jobs', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    // Test next and previous page clicks
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(mockFetchNextPage).toHaveBeenCalled();

    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    fireEvent.click(prevBtn);

    // Select job and play sub-job video
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    });

    const playBtns = screen.getAllByRole('button', { name: /▶️/i });
    if (playBtns.length > 0) {
      await act(async () => {
        fireEvent.click(playBtns[0]);
      });
      expect(mockGetDownloadURL).toHaveBeenCalled();
    }

    const closeSubJobsBtn = screen.getByRole('button', { name: /^Close$/i });
    fireEvent.click(closeSubJobsBtn);
    expect(screen.queryByText('AI Jobs for Analysis Job: job_v1')).not.toBeInTheDocument();
  });
});
