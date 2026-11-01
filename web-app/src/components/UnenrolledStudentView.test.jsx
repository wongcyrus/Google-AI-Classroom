import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import UnenrolledStudentView from './UnenrolledStudentView';

describe('UnenrolledStudentView Component', () => {
  const mockUser = {
    email: 'newstudent@school.edu',
    uid: 'student_xyz123'
  };

  it('renders student email and waiting status message', () => {
    render(<UnenrolledStudentView user={mockUser} />);

    expect(screen.getByText('Welcome to Google AI Classroom')).toBeInTheDocument();
    expect(screen.getByText(/You are signed in with your student account/i)).toBeInTheDocument();
    expect(screen.getByText('newstudent@school.edu')).toBeInTheDocument();
    expect(screen.getByText('Awaiting Instructor Enrollment')).toBeInTheDocument();
    expect(screen.getByText('Live Automatic Enrollment Active')).toBeInTheDocument();
  });

  it('allows copying email address to clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<UnenrolledStudentView user={mockUser} />);

    const copyBtn = screen.getByRole('button', { name: /Copy Email/i });
    fireEvent.click(copyBtn);

    expect(writeTextMock).toHaveBeenCalledWith('newstudent@school.edu');
    await waitFor(() => {
      expect(screen.getByText('✓ Copied!')).toBeInTheDocument();
    });
  });

  it('handles manual refresh check', async () => {
    const onRefreshMock = vi.fn().mockResolvedValue(undefined);
    render(<UnenrolledStudentView user={mockUser} onRefresh={onRefreshMock} />);

    const refreshBtn = screen.getByRole('button', { name: /Check Status Now/i });
    fireEvent.click(refreshBtn);

    expect(onRefreshMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText('🔄 Checking...')).toBeInTheDocument();
  });

  it('triggers onSignOut callback when sign out button is clicked', () => {
    const onSignOutMock = vi.fn();
    render(<UnenrolledStudentView user={mockUser} onSignOut={onSignOutMock} />);

    const signOutBtn = screen.getByRole('button', { name: /Sign Out \/ Switch Account/i });
    fireEvent.click(signOutBtn);

    expect(onSignOutMock).toHaveBeenCalledTimes(1);
  });

  it('uses document.execCommand copy fallback when clipboard API is unavailable', async () => {
    const originalClipboard = navigator.clipboard;
    // @ts-ignore
    delete navigator.clipboard;

    document.execCommand = vi.fn().mockReturnValue(true);

    render(<UnenrolledStudentView user={mockUser} />);
    const copyBtn = screen.getByRole('button', { name: /Copy Email/i });
    fireEvent.click(copyBtn);

    expect(document.execCommand).toHaveBeenCalledWith('copy');

    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
      writable: true,
    });
  });

  it('falls back to window.location.reload when onRefresh is omitted', async () => {
    const originalReload = window.location.reload;
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(<UnenrolledStudentView user={mockUser} />);
    const refreshBtn = screen.getByRole('button', { name: /Check Status Now/i });
    fireEvent.click(refreshBtn);

    expect(reloadMock).toHaveBeenCalled();

    Object.defineProperty(window, 'location', {
      value: { reload: originalReload },
      writable: true,
    });
  });

  it('calls signOut fallback when onSignOut is omitted', async () => {
    render(<UnenrolledStudentView user={mockUser} />);
    const signOutBtn = screen.getByRole('button', { name: /Sign Out \/ Switch Account/i });
    fireEvent.click(signOutBtn);
  });
});
