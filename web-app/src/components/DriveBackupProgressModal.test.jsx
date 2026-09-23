import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import DriveBackupProgressModal from './DriveBackupProgressModal';

describe('DriveBackupProgressModal Component', () => {
  it('does not render when show is false', () => {
    const { container } = render(
      <DriveBackupProgressModal
        show={false}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal with progress and video list when open', () => {
    const mockStatuses = [
      { id: 'v1', studentEmail: 'student1@school.edu', status: 'success', percentage: 100, webViewLink: 'https://drive.google.com/view/1' },
      { id: 'v2', studentEmail: 'student2@school.edu', status: 'uploading', percentage: 45 },
      { id: 'v3', studentEmail: 'student3@school.edu', status: 'pending', percentage: 0 },
    ];

    render(
      <DriveBackupProgressModal
        show={true}
        onClose={vi.fn()}
        onCancel={vi.fn()}
        isProcessing={true}
        totalVideos={3}
        completedCount={1}
        failedCount={0}
        currentPercentage={45}
        baseFolderName="Classroom Archives"
        videoStatuses={mockStatuses}
      />
    );

    expect(screen.getByText(/Google Drive Student Video Backup/i)).toBeInTheDocument();
    expect(screen.getByText(/student1@school.edu/i)).toBeInTheDocument();
    expect(screen.getByText(/student2@school.edu/i)).toBeInTheDocument();
    expect(screen.getByText(/student3@school.edu/i)).toBeInTheDocument();
    expect(screen.getByText(/View in Drive ↗/i)).toBeInTheDocument();
  });

  it('triggers onCancel when Cancel Backup button is clicked', () => {
    const handleCancel = vi.fn();
    render(
      <DriveBackupProgressModal
        show={true}
        onClose={vi.fn()}
        onCancel={handleCancel}
        isProcessing={true}
        totalVideos={5}
        completedCount={2}
        failedCount={0}
        videoStatuses={[]}
      />
    );

    const cancelBtn = screen.getByText(/Cancel Backup/i);
    fireEvent.click(cancelBtn);
    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it('triggers onClose when Close button is clicked when not processing', () => {
    const handleClose = vi.fn();
    render(
      <DriveBackupProgressModal
        show={true}
        onClose={handleClose}
        onCancel={vi.fn()}
        isProcessing={false}
        totalVideos={2}
        completedCount={2}
        failedCount={0}
        videoStatuses={[]}
      />
    );

    const closeBtn = screen.getByRole('button', { name: /Done \/ Close/i });
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
