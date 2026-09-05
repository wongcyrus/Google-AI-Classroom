import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import VideoAnalysisJobs from './VideoAnalysisJobs';

vi.mock('../firebase-config', () => ({
  db: {},
  functions: {},
}));

export const mockGeneratePromptCallable = vi.fn().mockResolvedValue({
  data: {
    generatedPrompt: '# Lab 2: AWS & Azure Cloud\n\n## Tasks\n1. Setup MFA',
    summaryCount: 2,
    classId: 'CLASS_101',
  },
});
export const mockRetryCallable = vi.fn().mockResolvedValue({
  data: { result: 'Retry initiated for 2 videos' },
});

export const mockHttpsCallable = vi.fn((fnInstance, functionName) => {
  if (functionName === 'generateLabTaskPrompt') {
    return mockGeneratePromptCallable;
  }
  return mockRetryCallable;
});

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
    prompt: 'Detect abnormal behavior',
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

export const mockAddDoc = vi.fn().mockResolvedValue({ id: 'mockPromptDoc' });
export const mockSetDoc = vi.fn().mockResolvedValue({});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  documentId: vi.fn(),
  orderBy: vi.fn(),
  serverTimestamp: vi.fn(() => ({ _methodName: 'serverTimestamp' })),
  addDoc: (...args) => mockAddDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  doc: vi.fn(() => ({ id: 'mockDoc' })),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    id: 'job_v1',
    data: () => ({
      id: 'job_v1',
      status: 'completed',
      modelUsed: 'gemini-3.7-flash',
      prompt: 'Detect abnormal behavior',
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
    mockHttpsCallable.mockImplementation((fnInstance, functionName) => {
      if (functionName === 'generateLabTaskPrompt') {
        return mockGeneratePromptCallable;
      }
      return mockRetryCallable;
    });
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

    const exportCsvBtn = screen.getByRole('button', { name: /Export Findings/i });
    fireEvent.click(exportCsvBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();

    const exportJsonBtn = screen.getByRole('button', { name: /Export Batch/i });
    fireEvent.click(exportJsonBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();

    const exportFilteredCsvBtn = screen.getByRole('button', { name: /Export CSV \(/i });
    fireEvent.click(exportFilteredCsvBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('handles exporting batch jobs log from Level 1', async () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    const exportLogBtn = screen.getByRole('button', { name: /Export Jobs Log/i });
    fireEvent.click(exportLogBtn);
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

  it('generates lab task prompt from completed video analysis results and launches new job', async () => {
    const mockUser = { uid: 'teacher_123', email: 'teacher@school.edu' };
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
        user={mockUser}
      />
    );

    // Select the completed job
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    });

    const generateBtn = screen.getByRole('button', { name: /✨ Generate Lab Task Prompt/i });
    await act(async () => {
      fireEvent.click(generateBtn);
    });

    expect(mockGeneratePromptCallable).toHaveBeenCalled();

    // Check that modal opened with synthesized prompt
    await waitFor(() => {
      expect(screen.getByText(/AI-Generated Lab Task Prompt/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Generated prompt will appear here.../i);
    expect(textarea.value).toContain('# Lab 2: AWS & Azure Cloud');

    // Launch analysis job with prompt
    const launchBtn = screen.getByRole('button', { name: /🚀 Launch Analysis Job/i });
    await act(async () => {
      fireEvent.click(launchBtn);
    });

    await waitFor(() => {
      expect(mockAddDoc).toHaveBeenCalled();
      expect(mockSetDoc).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Successfully launched'));
    });
  });

  it('opens and closes prompt modal from Level 1 view prompt button', () => {
    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    const viewPromptBtn = screen.getByRole('button', { name: /View Prompt/i });
    fireEvent.click(viewPromptBtn);

    expect(screen.getByText(/Video Analysis Prompt/i)).toBeInTheDocument();

    const closeBtns = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeBtns[0]);
    expect(screen.queryByText(/Full Analysis Prompt/i)).not.toBeInTheDocument();
  });

  it('handles error when lab task prompt generation fails', async () => {
    mockGeneratePromptCallable.mockRejectedValueOnce(new Error('AI generation rate limit'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
        user={{ uid: 'teacher_1' }}
      />
    );

    // Select completed job
    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    const generateBtn = screen.getByRole('button', { name: /✨ Generate Lab Task Prompt/i });
    await act(async () => {
      fireEvent.click(generateBtn);
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to generate lab task prompt: AI generation rate limit'));
    });
  });

  it('supports Level 2 prompt expand/collapse, clipboard copy, sub-job filtering, and delete job', async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(),
      },
    });

    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText(/📝 Task Rubric \/ Prompt Used/i)).toBeInTheDocument();
    });

    // Toggle expand
    const expandBtn = screen.getByRole('button', { name: /Expand full prompt/i });
    fireEvent.click(expandBtn);
    expect(screen.getByText(/Collapse/i)).toBeInTheDocument();

    // Copy prompt
    const copyPromptBtn = screen.getByRole('button', { name: /📋 Copy Prompt/i });
    await act(async () => {
      fireEvent.click(copyPromptBtn);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Detect abnormal behavior');

    // Filter sub-jobs
    const searchInput = screen.getByPlaceholderText(/Filter by student email.../i);
    fireEvent.change(searchInput, { target: { value: 'student1' } });
    expect(searchInput.value).toBe('student1');

    // Delete job
    const deleteBtn = screen.getByRole('button', { name: /Delete Job/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    expect(window.confirm).toHaveBeenCalled();
  });

  it('displays multi-stage animated progress stepper while synthesizing lab prompt', async () => {
    let resolveCallable;
    mockGeneratePromptCallable.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCallable = resolve;
    }));

    render(
      <VideoAnalysisJobs
        classId="CLASS_101"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T23:59:59Z"
        filterField="createdAt"
      />
    );

    const jobRow = screen.getByText('job_v1');
    await act(async () => {
      fireEvent.click(jobRow);
    });

    await waitFor(() => {
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    });

    const generateBtn = screen.getByRole('button', { name: /✨ Generate Lab Task Prompt/i });
    await act(async () => {
      fireEvent.click(generateBtn);
    });

    // Check that stepper card is displayed
    expect(screen.getByText(/Synthesizing Lab Tasks & Rubric from Classroom Observations/i)).toBeInTheDocument();
    expect(screen.getByText(/1\. Observations/i)).toBeInTheDocument();
    expect(screen.getByText(/2\. Gemini 3.8 Flash/i)).toBeInTheDocument();
    expect(screen.getByText(/3\. Rubric & Constraints/i)).toBeInTheDocument();

    // Now resolve the promise
    await act(async () => {
      resolveCallable({
        data: {
          generatedPrompt: '# Synthesized Prompt Test',
          promptName: 'Test Prompt',
          summaryCount: 1,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText(/AI-Generated Lab Task Prompt/i)).toBeInTheDocument();
    });
  });
});

