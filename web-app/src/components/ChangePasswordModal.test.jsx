import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordModal from './ChangePasswordModal';
import { updatePassword, reauthenticateWithCredential } from 'firebase/auth';

vi.mock('../firebase-config', () => ({
  auth: {
    currentUser: {
      email: 'user@example.com',
      uid: 'user123',
    },
  },
}));

vi.mock('firebase/auth', () => ({
  updatePassword: vi.fn(),
  EmailAuthProvider: {
    credential: vi.fn((email, pwd) => ({ email, pwd })),
  },
  reauthenticateWithCredential: vi.fn(),
}));

describe('ChangePasswordModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when show is false', () => {
    const { container } = render(<ChangePasswordModal show={false} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders modal inputs and handles close button', () => {
    const onClose = vi.fn();
    render(<ChangePasswordModal show={true} onClose={onClose} />);

    expect(screen.getByText('Change Password')).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: '✕' });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows validation error when new password is too short', async () => {
    render(<ChangePasswordModal show={true} onClose={vi.fn()} />);

    const currentPwdInput = screen.getByLabelText(/Current Password/i);
    const newPwdInput = screen.getByLabelText(/^New Password/i);
    const confirmPwdInput = screen.getByLabelText(/Confirm New Password/i);

    fireEvent.change(currentPwdInput, { target: { value: 'oldpass123' } });
    fireEvent.change(newPwdInput, { target: { value: '123' } });
    fireEvent.change(confirmPwdInput, { target: { value: '123' } });

    const submitBtn = screen.getByRole('button', { name: /Update Password/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/New password must be at least 6 characters long/i)).toBeInTheDocument();
  });

  it('shows error when new password and confirm password do not match', async () => {
    render(<ChangePasswordModal show={true} onClose={vi.fn()} />);

    const currentPwdInput = screen.getByLabelText(/Current Password/i);
    const newPwdInput = screen.getByLabelText(/^New Password/i);
    const confirmPwdInput = screen.getByLabelText(/Confirm New Password/i);

    fireEvent.change(currentPwdInput, { target: { value: 'oldpass123' } });
    fireEvent.change(newPwdInput, { target: { value: 'newpassword1' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'differentpass' } });

    const submitBtn = screen.getByRole('button', { name: /Update Password/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/New passwords do not match/i)).toBeInTheDocument();
  });

  it('shows error when new password is the same as current password', async () => {
    render(<ChangePasswordModal show={true} onClose={vi.fn()} />);

    const currentPwdInput = screen.getByLabelText(/Current Password/i);
    const newPwdInput = screen.getByLabelText(/^New Password/i);
    const confirmPwdInput = screen.getByLabelText(/Confirm New Password/i);

    fireEvent.change(currentPwdInput, { target: { value: 'samepassword123' } });
    fireEvent.change(newPwdInput, { target: { value: 'samepassword123' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'samepassword123' } });

    const submitBtn = screen.getByRole('button', { name: /Update Password/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/New password must be different from current password/i)).toBeInTheDocument();
  });

  it('handles successful password update', async () => {
    reauthenticateWithCredential.mockResolvedValueOnce();
    updatePassword.mockResolvedValueOnce();

    const onClose = vi.fn();
    render(<ChangePasswordModal show={true} onClose={onClose} />);

    const currentPwdInput = screen.getByLabelText(/Current Password/i);
    const newPwdInput = screen.getByLabelText(/^New Password/i);
    const confirmPwdInput = screen.getByLabelText(/Confirm New Password/i);

    fireEvent.change(currentPwdInput, { target: { value: 'oldpassword123' } });
    fireEvent.change(newPwdInput, { target: { value: 'newsecurepass456' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'newsecurepass456' } });

    const submitBtn = screen.getByRole('button', { name: /Update Password/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Password updated successfully!/i)).toBeInTheDocument();
    expect(reauthenticateWithCredential).toHaveBeenCalled();
    expect(updatePassword).toHaveBeenCalled();
  });

  it('handles wrong current password error', async () => {
    const error = new Error('Wrong password');
    error.code = 'auth/wrong-password';
    reauthenticateWithCredential.mockRejectedValueOnce(error);

    render(<ChangePasswordModal show={true} onClose={vi.fn()} />);

    const currentPwdInput = screen.getByLabelText(/Current Password/i);
    const newPwdInput = screen.getByLabelText(/^New Password/i);
    const confirmPwdInput = screen.getByLabelText(/Confirm New Password/i);

    fireEvent.change(currentPwdInput, { target: { value: 'wrongpass' } });
    fireEvent.change(newPwdInput, { target: { value: 'newsecurepass456' } });
    fireEvent.change(confirmPwdInput, { target: { value: 'newsecurepass456' } });

    const submitBtn = screen.getByRole('button', { name: /Update Password/i });
    fireEvent.click(submitBtn);

    expect(await screen.findByText(/Current password is incorrect/i)).toBeInTheDocument();
  });
});
