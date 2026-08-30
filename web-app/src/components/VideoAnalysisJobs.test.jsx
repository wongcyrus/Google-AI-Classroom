import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VideoAnalysisJobs from './VideoAnalysisJobs';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  documentId: vi.fn(),
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  writeBatch: vi.fn(() => ({ commit: vi.fn().mockResolvedValue() })),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(() => vi.fn().mockResolvedValue()),
}));

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(),
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.local/video.mp4'),
}));

const mockAnalysisJobs = [
  {
    id: 'job_anal_1',
    model: 'gemini-3.5-flash-lite',
    prompt: 'Check for cheating',
    status: 'completed',
    startTime: { toDate: () => new Date('2026-08-30T00:00:00Z') },
    endTime: { toDate: () => new Date('2026-08-30T01:00:00Z') },
    createdAt: { toDate: () => new Date('2026-08-30T01:10:00Z') },
    aiJobIds: ['ai_1'],
  },
];

let mockUsePaginatedQueryReturn = {
  data: mockAnalysisJobs,
  loading: false,
  page: 1,
  isLastPage: true,
  fetchNextPage: vi.fn(),
  fetchPrevPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => mockUsePaginatedQueryReturn,
}));

describe('VideoAnalysisJobs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders video analysis jobs and displays linked AI sub-jobs on row selection', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      id: 'job_anal_1',
      data: () => mockAnalysisJobs[0],
    });

    mockGetDocs.mockResolvedValueOnce({
      forEach: (cb) =>
        cb({
          id: 'ai_1',
          data: () => ({
            studentEmail: 'student1@school.edu',
            status: 'completed',
            irregularityDetected: true,
            timestamp: { toDate: () => new Date('2026-08-30T01:05:00Z') },
          }),
        }),
    });

    render(
      <VideoAnalysisJobs
        classId="CLASS_1"
        startTime="2026-08-30T00:00:00Z"
        endTime="2026-08-30T01:00:00Z"
        filterField="startTime"
      />
    );

    expect(screen.getByText(/Video Analysis Jobs/i)).toBeInTheDocument();
    expect(screen.getByText('Check for cheating')).toBeInTheDocument();

    // Select job row
    fireEvent.click(screen.getByText('Check for cheating'));

    await waitFor(() => {
      expect(screen.getByText(/AI Jobs for Analysis Job/i)).toBeInTheDocument();
      expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    });
  });
});
