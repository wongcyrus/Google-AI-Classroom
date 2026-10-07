import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSignInWithEmailAndPassword = vi.fn();
const mockGetRegistrationOptions = vi.fn();
const mockVerifyRegistration = vi.fn();
const mockStartRegistration = vi.fn();
const mockCheckPlatformAuthenticatorAvailable = vi.fn(() => Promise.resolve(true));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args) => mockSignInWithEmailAndPassword(...args),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'getPasskeyRegistrationOptions') return mockGetRegistrationOptions;
    if (name === 'verifyPasskeyRegistration') return mockVerifyRegistration;
    return vi.fn();
  }),
}));

vi.mock('../../firebase-config', () => ({
  auth: { currentUser: null },
  functions: {},
}));

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args) => mockStartRegistration(...args),
  browserSupportsWebAuthn: () => true,
}));

vi.mock('../../utils/passkeyErrorUtils', async () => {
  const actual = await vi.importActual('../../utils/passkeyErrorUtils');
  return {
    ...actual,
    checkPlatformAuthenticatorAvailable: () => mockCheckPlatformAuthenticatorAvailable(),
  };
});

vi.mock('../../utils/deviceFingerprint', () => ({
  getOrCreateDeviceFingerprint: () => 'mock_device_fp_phone_99',
}));

import PasskeyPasswordFallbackForm from './PasskeyPasswordFallbackForm';

describe('PasskeyPasswordFallbackForm Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckPlatformAuthenticatorAvailable.mockResolvedValue(true);
  });

  it('renders form with email, password fields and pre-fills initialEmail', () => {
    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={vi.fn()}
      />
    );

    expect(screen.getByText('Register Phone Passkey')).toBeInTheDocument();
    expect(screen.getByDisplayValue('student99@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter your classroom password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log In & Register Passkey/i })).toBeInTheDocument();
  });

  it('toggles password visibility when eye button is clicked', () => {
    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={vi.fn()}
      />
    );

    const passwordInput = screen.getByPlaceholderText(/Enter your classroom password/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', { name: /Show password/i });
    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'text');

    fireEvent.click(toggleBtn);
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('completes sign-in, passkey registration, and triggers onSuccess', async () => {
    const mockOnSuccess = vi.fn();

    mockSignInWithEmailAndPassword.mockResolvedValueOnce({
      user: { uid: 'auth_uid_99', email: 'student99@stu.vtc.edu.hk' },
    });

    mockGetRegistrationOptions.mockResolvedValueOnce({
      data: { challenge: 'reg_chal_123', rp: { name: 'Classroom' } },
    });

    mockStartRegistration.mockResolvedValueOnce({
      id: 'hardware-cred-xyz',
      rawId: 'hardware-cred-xyz',
      response: { clientDataJSON: 'xyz' },
      type: 'public-key',
    });

    mockVerifyRegistration.mockResolvedValueOnce({
      data: { verified: true, deviceModel: 'Mobile Phone' },
    });

    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={mockOnSuccess}
      />
    );

    const passwordInput = screen.getByPlaceholderText(/Enter your classroom password/i);
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } });

    const submitBtn = screen.getByRole('button', { name: /Log In & Register Passkey/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(mockSignInWithEmailAndPassword).toHaveBeenCalledWith(
        expect.anything(),
        'student99@stu.vtc.edu.hk',
        'SecretPassword123!'
      );
      expect(mockGetRegistrationOptions).toHaveBeenCalled();
      expect(mockStartRegistration).toHaveBeenCalledWith({
        optionsJSON: { challenge: 'reg_chal_123', rp: { name: 'Classroom' } },
      });
      expect(mockVerifyRegistration).toHaveBeenCalledWith(
        expect.objectContaining({
          attestationResponse: expect.objectContaining({ id: 'hardware-cred-xyz' }),
          deviceFingerprint: 'mock_device_fp_phone_99',
        })
      );
      expect(mockOnSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          studentUid: 'auth_uid_99',
          studentEmail: 'student99@stu.vtc.edu.hk',
        })
      );
    });
  });

  it('displays user-friendly error message on incorrect password', async () => {
    const authError = new Error('Incorrect credentials');
    authError.code = 'auth/wrong-password';
    mockSignInWithEmailAndPassword.mockRejectedValueOnce(authError);

    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={vi.fn()}
      />
    );

    const passwordInput = screen.getByPlaceholderText(/Enter your classroom password/i);
    fireEvent.change(passwordInput, { target: { value: 'WrongPassword' } });

    const submitBtn = screen.getByRole('button', { name: /Log In & Register Passkey/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Incorrect email or password/i)).toBeInTheDocument();
    });
  });

  it('displays hardware lock warning if phone is already bound to another student', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValueOnce({
      user: { uid: 'auth_uid_99', email: 'student99@stu.vtc.edu.hk' },
    });

    mockGetRegistrationOptions.mockResolvedValueOnce({
      data: { challenge: 'reg_chal_123' },
    });

    mockStartRegistration.mockResolvedValueOnce({
      id: 'hardware-cred-xyz',
    });

    mockVerifyRegistration.mockRejectedValueOnce(
      new Error('Hardware Lock: This physical phone is already bound to student account (other@stu.vtc.edu.hk).')
    );

    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={vi.fn()}
      />
    );

    const passwordInput = screen.getByPlaceholderText(/Enter your classroom password/i);
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } });

    const submitBtn = screen.getByRole('button', { name: /Log In & Register Passkey/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Phone Already Registered/i)).toBeInTheDocument();
    });
  });

  it('handles user cancellation of biometric enrollment without crashing', async () => {
    mockSignInWithEmailAndPassword.mockResolvedValueOnce({
      user: { uid: 'auth_uid_99', email: 'student99@stu.vtc.edu.hk' },
    });

    mockGetRegistrationOptions.mockResolvedValueOnce({
      data: { challenge: 'reg_chal_123' },
    });

    const cancelErr = new Error('User cancelled biometric verification');
    cancelErr.name = 'NotAllowedError';
    mockStartRegistration.mockRejectedValueOnce(cancelErr);

    render(
      <PasskeyPasswordFallbackForm
        initialEmail="student99@stu.vtc.edu.hk"
        onSuccess={vi.fn()}
      />
    );

    const passwordInput = screen.getByPlaceholderText(/Enter your classroom password/i);
    fireEvent.change(passwordInput, { target: { value: 'SecretPassword123!' } });

    const submitBtn = screen.getByRole('button', { name: /Log In & Register Passkey/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Biometric enrollment prompt was cancelled/i)).toBeInTheDocument();
    });
  });
});
