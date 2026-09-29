import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockGetOptions = vi.fn();
const mockVerify = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'getDesktopLoginPasskeyOptions') return mockGetOptions;
    if (name === 'verifyDesktopLoginPasskey') return mockVerify;
    return vi.fn();
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
}));

const mockStartAuthentication = vi.fn();
const mockBrowserSupportsWebAuthn = vi.fn(() => true);
const mockIsHandheldPhone = vi.fn(() => true);

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: (...args) => mockStartAuthentication(...args),
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
}));

vi.mock('../../utils/browserDetection', () => ({
  isHandheldPhone: () => mockIsHandheldPhone(),
  isMobileDevice: () => mockIsHandheldPhone(),
}));

import PasskeyMobileLoginView from './PasskeyMobileLoginView';

describe('PasskeyMobileLoginView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockIsHandheldPhone.mockReturnValue(true);
  });

  it('blocks desktop access with strict prohibition notice', () => {
    mockIsHandheldPhone.mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=test-session-123']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    expect(screen.getByText('Shared PC Detected')).toBeInTheDocument();
    expect(screen.getByText(/Desktop Passkeys Strictly Prohibited/i)).toBeInTheDocument();
    expect(screen.getByText(/Desktop and tablet passkey logins are strictly prohibited/i)).toBeInTheDocument();
  });

  it('displays error if mobile browser lacks WebAuthn support', () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=test-session-123']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    expect(screen.getByText(/This mobile browser does not support biometric passkeys/i)).toBeInTheDocument();
  });

  it('displays error when session parameter is missing', () => {
    render(
      <MemoryRouter initialEntries={['/mobile-login']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    expect(screen.getByText(/Missing login session ID/i)).toBeInTheDocument();
  });

  it('successfully executes biometric passkey login on mobile', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'test-challenge', rpId: 'localhost' },
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-123',
      rawId: 'cred-123',
      response: { clientDataJSON: 'xyz', authenticatorData: 'abc' },
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'alex@vtc.edu.hk',
        deviceModel: 'iPhone 15 Pro',
      },
    });

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-abc']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Desktop Signed In!')).toBeInTheDocument();
    });

    expect(screen.getByText('alex@vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('iPhone 15 Pro')).toBeInTheDocument();
    expect(screen.getByText('Unlocked & Authorized')).toBeInTheDocument();
  });

  it('handles cancellation and allows manual retry', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'test-challenge' },
      },
    });

    const notAllowedErr = new Error('User cancelled');
    notAllowedErr.name = 'NotAllowedError';
    mockStartAuthentication.mockRejectedValueOnce(notAllowedErr);

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-cancel']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Unlock Lab Desktop')).toBeInTheDocument();
    });

    expect(screen.getByText(/Biometric scan was cancelled/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Sign In with Biometrics/i })).toBeInTheDocument();
  });

  it('forwards dynamic rotating token parameter to cloud functions', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'test-challenge', rpId: 'localhost' },
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-123',
      rawId: 'cred-123',
      response: { clientDataJSON: 'xyz', authenticatorData: 'abc' },
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'bob@vtc.edu.hk',
        deviceModel: 'Pixel 9',
      },
    });

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-dynamic&token=tok1234567890abc']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockGetOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-dynamic',
          token: 'tok1234567890abc',
        })
      );
      expect(mockVerify).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'sess-dynamic',
          token: 'tok1234567890abc',
        })
      );
    });
  });
});
