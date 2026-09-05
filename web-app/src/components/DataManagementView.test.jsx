import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DataManagementView from './DataManagementView';

const mockDeleteDoc = vi.fn().mockResolvedValue();
const mockGetDoc = vi.fn().mockResolvedValue({
  exists: () => true,
  data: () => ({ zipPath: 'zips/archive1.zip' }),
});
const mockDeleteObject = vi.fn().mockResolvedValue();
const mockGetDownloadURL = vi.fn().mockResolvedValue('https://storage.mock/archive1.zip');
const mockDeleteScreenshotsByDateRange = vi.fn().mockResolvedValue({
  data: { message: 'Deletion completed successfully' },
});

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
  functions: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  getDoc: (...args) => mockGetDoc(...args),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  deleteObject: (...args) => mockDeleteObject(...args),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockDeleteScreenshotsByDateRange,
}));

const mockRefetch = vi.fn();
const mockFetchNextPage = vi.fn();
const mockFetchPrevPage = vi.fn();

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => ({
    data: [
      {
        id: 'zip1',
        createdAt: { toDate: () => new Date('2026-08-30T09:00:00Z') },
        status: 'completed',
        zipPath: 'zips/archive1.zip',
      },
      {
        id: 'zip2',
        createdAt: { toDate: () => new Date('2026-08-30T10:00:00Z') },
        status: 'failed',
        error: 'Storage quota exceeded',
      },
    ],
    loading: false,
    page: 1,
    isLastPage: false,
    fetchNextPage: mockFetchNextPage,
    fetchPrevPage: mockFetchPrevPage,
    refetch: mockRefetch,
  }),
}));

describe('DataManagementView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'open').mockImplementation(() => {});
  });

  it('renders zip jobs list and status tags', () => {
    render(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );

    expect(screen.getByText('Data Management')).toBeInTheDocument();
    expect(screen.getByText('Video Archives (ZIP Jobs)')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('Failed: Storage quota exceeded')).toBeInTheDocument();
  });

  it('handles downloading completed zip archives', async () => {
    render(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );

    const downloadBtn = screen.getByRole('button', { name: /Download/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(mockGetDownloadURL).toHaveBeenCalled();
      expect(window.open).toHaveBeenCalledWith('https://storage.mock/archive1.zip', '_blank');
    });
  });

  it('handles selecting and deleting zip jobs', async () => {
    render(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // select first job

    const deleteSelectedBtn = screen.getByRole('button', { name: /Delete Selected \(1\)/i });
    fireEvent.click(deleteSelectedBtn);

    await waitFor(() => {
      expect(mockDeleteDoc).toHaveBeenCalled();
      expect(mockRefetch).toHaveBeenCalled();
    });
  });

  it('handles date range deletion trigger', async () => {
    render(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete Screenshots in Range/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(mockDeleteScreenshotsByDateRange).toHaveBeenCalledWith({
        classId: 'CLASS_101',
        startDate: '2026-08-30T00:00',
        endDate: '2026-08-30T23:59',
        timezone: 'UTC',
      });
    });
  });

  it('handles select all checkbox, pagination, and error branch during deletion', async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error('Firestore error'));

    render(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );

    // Select all
    const selectAllCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(selectAllCheckbox);

    // Deselect all
    fireEvent.click(selectAllCheckbox);

    // Re-select all and delete (triggers error branch)
    fireEvent.click(selectAllCheckbox);
    const deleteSelectedBtn = screen.getByRole('button', { name: /Delete Selected \(2\)/i });
    fireEvent.click(deleteSelectedBtn);

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Failed to delete'));
    });

    // Pagination buttons
    const nextBtn = screen.getByRole('button', { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(mockFetchNextPage).toHaveBeenCalled();

    const prevBtn = screen.getByRole('button', { name: /Previous/i });
    expect(prevBtn).toBeDisabled();
  });

  it('validates missing dates or cancellation for date range deletion', () => {
    const { rerender } = render(
      <DataManagementView
        classId="CLASS_101"
        startTime=""
        endTime=""
        filterField="createdAt"
        timezone="UTC"
      />
    );

    const deleteBtn = screen.getByRole('button', { name: /Delete Screenshots in Range/i });
    fireEvent.click(deleteBtn);
    expect(window.alert).toHaveBeenCalledWith('Please select a start and end date.');

    // User cancels confirmation
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    rerender(
      <DataManagementView
        classId="CLASS_101"
        startTime="2026-08-30T00:00"
        endTime="2026-08-30T23:59"
        filterField="createdAt"
        timezone="UTC"
      />
    );
    fireEvent.click(deleteBtn);
    expect(mockDeleteScreenshotsByDateRange).not.toHaveBeenCalled();
  });
});
