import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuthComponent from './AuthComponent';
import * as browserDetection from '../utils/browserDetection';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';

vi.mock('../firebase-config', () => ({
  auth: { currentUser: null },
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn().mockResolvedValue(),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(),
}));

describe('AuthComponent Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders login form and inputs correctly', () => {
    render(<AuthComponent />);
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In/i })).toBeInTheDocument();
  });

  it('displays Chrome requirement warning if current browser is not Chrome', () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(false);
    vi.spyOn(browserDetection, 'getBrowserName').mockReturnValue('Apple Safari');

    render(<AuthComponent />);

    expect(screen.getByText(/Students: Google Chrome Required/i)).toBeInTheDocument();
    expect(screen.getByText(/You are currently using Apple Safari/i)).toBeInTheDocument();
  });

  it('blocks student login on non-Chrome browser with clear error message', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(false);
    vi.spyOn(browserDetection, 'getBrowserName').mockReturnValue('Mozilla Firefox');

    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'student1@stu.vtc.edu.hk' }
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'password123' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByText(/Google Chrome is strictly required for students/i)).toBeInTheDocument();
    });

    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('allows student login when using Google Chrome', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(true);
    signInWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'student1' } });

    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'student1@stu.vtc.edu.hk' }
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'password123' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        'student1@stu.vtc.edu.hk',
        'password123'
      );
    });
  });

  it('allows teacher login on any browser', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(false);
    signInWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'teacher1' } });

    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'teacher@vtc.edu.hk' }
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'teacherpass123' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(signInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        'teacher@vtc.edu.hk',
        'teacherpass123'
      );
    });
  });
});
