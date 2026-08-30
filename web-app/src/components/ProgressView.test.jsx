import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ProgressView from './ProgressView';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDocs: (...args) => mockGetDocs(...args),
}));

let mockUsePaginatedQueryReturn = {
  data: [],
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

describe('ProgressView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders summary view with student list and latest progress', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        students: {
          s1: 'alice@example.com',
          s2: 'bob@example.com',
        },
      }),
    });

    mockGetDocs
      .mockResolvedValueOnce({
        empty: false,
        docs: [
          {
            id: 'prog_1',
            data: () => ({
              studentEmail: 'alice@example.com',
              studentUid: 's1',
              progress: 'Question 5/10 answered',
              timestamp: { toDate: () => new Date('2026-08-30T00:10:00Z') },
            }),
          },
        ],
      })
      .mockResolvedValueOnce({
        empty: true,
        docs: [],
      });

    render(<ProgressView classId="CLASS_1" />);

    expect(screen.getByText(/Student Progress Summary/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      expect(screen.getByText('Question 5/10 answered')).toBeInTheDocument();
      expect(screen.getByText('bob@example.com')).toBeInTheDocument();
      expect(screen.getByText('No progress recorded')).toBeInTheDocument();
    });
  });

  it('switches to detail view when student row is clicked, and allows navigating back', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        students: { s1: 'alice@example.com' },
      }),
    });

    mockGetDocs.mockResolvedValueOnce({
      empty: false,
      docs: [
        {
          id: 'prog_1',
          data: () => ({
            studentEmail: 'alice@example.com',
            studentUid: 's1',
            progress: 'Starting test',
            timestamp: { toDate: () => new Date('2026-08-30T00:00:00Z') },
          }),
        },
      ],
    });

    mockUsePaginatedQueryReturn = {
      data: [
        {
          id: 'item_1',
          progress: 'Step 1 complete',
          studentEmail: 'alice@example.com',
          timestamp: { toDate: () => new Date('2026-08-30T00:05:00Z') },
        },
      ],
      loading: false,
      page: 1,
      isLastPage: false,
      fetchNextPage: vi.fn(),
      fetchPrevPage: vi.fn(),
      refetch: vi.fn(),
    };

    render(<ProgressView classId="CLASS_1" />);

    await waitFor(() => {
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    });

    // Click student row to open detail view
    fireEvent.click(screen.getByText('alice@example.com'));

    await waitFor(() => {
      expect(screen.getByText(/Progress for alice@example.com/i)).toBeInTheDocument();
      expect(screen.getByText(/Step 1 complete/i)).toBeInTheDocument();
    });

    // Back to summary
    const backBtn = screen.getByText('Back to Summary');
    fireEvent.click(backBtn);

    expect(screen.getByText(/Student Progress Summary/i)).toBeInTheDocument();
  });

  it('renders empty message when no classId or class has no students', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    render(<ProgressView classId="EMPTY_CLASS" />);

    await waitFor(() => {
      expect(screen.getByText(/No students in this class/i)).toBeInTheDocument();
    });
  });
});
