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

  it('prevents duplicate submissions and disables buttons while login is in progress', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(true);
    let resolveLogin;
    signInWithEmailAndPassword.mockImplementationOnce(() => new Promise((resolve) => {
      resolveLogin = resolve;
    }));

    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'teacher@vtc.edu.hk' }
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'teacherpass123' }
    });

    const submitBtn = screen.getByRole('button', { name: /Sign In/i });
    fireEvent.click(submitBtn);

    // Immediately shows Signing In... and is disabled
    expect(screen.getByRole('button', { name: /Signing In\.\.\./i })).toBeDisabled();
    expect(screen.getByLabelText(/Email Address/i)).toBeDisabled();
    expect(screen.getByLabelText(/Password/i)).toBeDisabled();

    // Spam click the button 3 more times while in-flight
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    // Must have only been called once!
    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(1);

    // Resolve login
    resolveLogin({ user: { uid: 'teacher1' } });
  });

  it('displays a friendly rate-limit message when auth/too-many-requests occurs', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(true);
    const error = new Error('Too many attempts');
    error.code = 'auth/too-many-requests';
    signInWithEmailAndPassword.mockRejectedValueOnce(error);

    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), {
      target: { value: 'teacher@vtc.edu.hk' }
    });
    fireEvent.change(screen.getByLabelText(/Password/i), {
      target: { value: 'wrongpass' }
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    await waitFor(() => {
      expect(screen.getByText(/temporarily blocked by Firebase for security/i)).toBeInTheDocument();
    });

    // Button should be re-enabled after failure
    expect(screen.getByRole('button', { name: /Sign In/i })).not.toBeDisabled();
  });

  it('validates domain requirements for registration', () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(true);
    render(<AuthComponent />);

    // Try registering with non-vtc domain
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'user@gmail.com' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/i }));
    expect(screen.getByText(/Only emails ending with @stu\.vtc\.edu\.hk or @vtc\.edu\.hk are allowed\./i)).toBeInTheDocument();
  });

  it('blocks student registration on non-Chrome browser', () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(false);
    vi.spyOn(browserDetection, 'getBrowserName').mockReturnValue('Firefox');
    render(<AuthComponent />);

    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'student1@stu.vtc.edu.hk' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/i }));
    expect(screen.getByText(/Google Chrome is strictly required for students\. Detected: Firefox/i)).toBeInTheDocument();
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('allows registration on Chrome and sends verification email', async () => {
    vi.spyOn(browserDetection, 'isGoogleChrome').mockReturnValue(true);
    createUserWithEmailAndPassword.mockResolvedValueOnce({
      user: { email: 'student1@stu.vtc.edu.hk' },
    });

    render(<AuthComponent />);
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'student1@stu.vtc.edu.hk' } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /Register/i }));

    await waitFor(() => {
      expect(createUserWithEmailAndPassword).toHaveBeenCalled();
      expect(screen.getByText(/Registration successful\. A verification email has been sent/i)).toBeInTheDocument();
    });
  });

  it('handles forgot password workflow', async () => {
    const { sendPasswordResetEmail } = await import('firebase/auth');
    render(<AuthComponent />);

    // Click forgot password without email
    fireEvent.click(screen.getByRole('button', { name: /Forgot Password\?/i }));
    expect(screen.getByText(/Please enter your email address to reset your password\./i)).toBeInTheDocument();

    // With email
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'teacher@vtc.edu.hk' } });
    fireEvent.click(screen.getByRole('button', { name: /Forgot Password\?/i }));

    await waitFor(() => {
      expect(sendPasswordResetEmail).toHaveBeenCalledWith(expect.anything(), 'teacher@vtc.edu.hk');
      expect(screen.getByText(/Password reset email sent\. Please check your inbox\./i)).toBeInTheDocument();
    });
  });

  it('handles resend verification email for unverified user prop', async () => {
    const { sendEmailVerification } = await import('firebase/auth');
    const mockUnverified = { email: 'student1@stu.vtc.edu.hk' };

    render(<AuthComponent unverifiedUser={mockUnverified} />);

    const resendBtn = screen.getByRole('button', { name: /Resend Verification Email/i });
    expect(resendBtn).toBeInTheDocument();

    fireEvent.click(resendBtn);
    await waitFor(() => {
      expect(sendEmailVerification).toHaveBeenCalledWith(mockUnverified);
      expect(screen.getByText(/A new verification email has been sent\. Please check your inbox\./i)).toBeInTheDocument();
    });
  });
});
