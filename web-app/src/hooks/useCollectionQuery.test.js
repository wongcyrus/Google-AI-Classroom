import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import usePaginatedQuery from './useCollectionQuery';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockGetDocs = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn((...args) => ({ _query: true, args })),
  where: vi.fn((field, op, value) => ({ type: 'where', field, op, value })),
  orderBy: vi.fn((field, direction) => ({ type: 'orderBy', field, direction })),
  limit: vi.fn((n) => ({ type: 'limit', n })),
  startAfter: vi.fn((doc) => ({ type: 'startAfter', doc })),
  getDocs: (...args) => mockGetDocs(...args),
}));

const testClauses = [{ field: 'status', op: '==', value: 'flagged' }];

describe('usePaginatedQuery Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
  });

  it('fetches first page of data with filters and pagination state', async () => {
    const fakeDocs = [
      { id: 'doc_1', data: () => ({ name: 'Item 1', timestamp: 100 }) },
      { id: 'doc_2', data: () => ({ name: 'Item 2', timestamp: 200 }) },
    ];
    mockGetDocs.mockResolvedValueOnce({
      docs: fakeDocs,
    });

    const { result } = renderHook(() =>
      usePaginatedQuery('irregularities', {
        classId: 'CLASS_1',
        startTime: '2026-08-30T00:00:00.000Z',
        endTime: '2026-08-30T01:00:00.000Z',
        pageSize: 2,
        extraClauses: testClauses,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data.length).toBe(2);
    expect(result.current.data[0].id).toBe('doc_1');
    expect(result.current.page).toBe(1);
    expect(result.current.isLastPage).toBe(false);

    // Fetch next page
    mockGetDocs.mockResolvedValueOnce({
      docs: [{ id: 'doc_3', data: () => ({ name: 'Item 3', timestamp: 300 }) }],
    });

    await act(async () => {
      result.current.fetchNextPage();
    });

    await waitFor(() => {
      expect(result.current.data.length).toBe(1);
      expect(result.current.isLastPage).toBe(true);
      expect(result.current.page).toBe(2);
    });

    // Fetch previous page
    mockGetDocs.mockResolvedValueOnce({
      docs: fakeDocs,
    });

    await act(async () => {
      result.current.fetchPrevPage();
    });

    await waitFor(() => {
      expect(result.current.page).toBe(1);
    });
  });

  it('handles query error and alerts user about missing indexes', async () => {
    const testError = new Error('Missing index');
    mockGetDocs.mockRejectedValueOnce(testError);

    const { result } = renderHook(() =>
      usePaginatedQuery('irregularities', {
        classId: 'CLASS_1',
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe(testError);
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('missing'));
  });

  it('handles empty collectionPath gracefully', () => {
    const { result } = renderHook(() =>
      usePaginatedQuery('', {
        classId: 'CLASS_1',
      })
    );

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual([]);
  });
});
