import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockGetAuthOptions = vi.fn();
const mockVerifyAuth = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'getPasskeyAuthOptions') return mockGetAuthOptions;
    if (name === 'verifyPasskeyAuth') return mockVerifyAuth;
    return vi.fn();
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
}));

const mockStartAuthentication = vi.fn();
const mockBrowserSupportsWebAuthn = vi.fn(() => true);
const mockIsMobileDevice = vi.fn(() => true);

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: (...args) => mockStartAuthentication(...args),
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
}));

vi.mock('../../utils/browserDetection', () => ({
  isMobileDevice: () => mockIsMobileDevice(),
}));

import PasskeyVerifyView from './PasskeyVerifyView';

describe('PasskeyVerifyView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockIsMobileDevice.mockReturnValue(true);
  });

  it('blocks desktop verification with clear mobile required notice', async () => {
    mockIsMobileDevice.mockReturnValue(false);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Mobile Phone Required')).toBeInTheDocument();
    expect(screen.getByText(/Attendance verification must be performed using your paired smartphone/i)).toBeInTheDocument();
    expect(mockGetAuthOptions).not.toHaveBeenCalled();
  });

  it('automatically triggers Face ID / Fingerprint on mount and shows success screen', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'auth-challenge' },
        studentEmail: 'student1@stu.vtc.edu.hk',
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-123',
      rawId: 'cred-123',
      response: { authenticatorData: 'data' },
      type: 'public-key',
    });

    mockVerifyAuth.mockResolvedValueOnce({
      data: {
        verified: true,
        responseTimeSec: 1.8,
      },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(mockGetAuthOptions).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'class_101', bingoId: 'bingo_999' })
    );
    expect(mockStartAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        optionsJSON: expect.objectContaining({ challenge: 'auth-challenge' }),
      })
    );
    expect(mockVerifyAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class_101',
        bingoId: 'bingo_999',
        assertionResponse: expect.objectContaining({ id: 'cred-123' }),
      })
    );

    expect(screen.getByText('Verified Present!')).toBeInTheDocument();
    expect(screen.getByText('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('1.8s')).toBeInTheDocument();
  });

  it('displays friendly message when student has not paired phone yet', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: {
        error: 'no_passkey',
        message: 'No paired phone found for this student account.',
      },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_unpaired']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/No paired phone found/i)).toBeInTheDocument();
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  it('displays error if browser does not support WebAuthn', async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/does not support biometric passkeys/i)).toBeInTheDocument();
    expect(mockGetAuthOptions).not.toHaveBeenCalled();
  });

  it('displays error if classId or bingoId query parameters are missing', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Missing attendance challenge parameters/i)).toBeInTheDocument();
  });

  it('renders already confirmed screen if data.alreadyPassed is true', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: {
        alreadyPassed: true,
      },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Your attendance has already been confirmed/i)).toBeInTheDocument();
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  it('handles user cancellation (NotAllowedError) and allows manual retry click', async () => {
    const notAllowedErr = new Error('User cancelled prompt');
    notAllowedErr.name = 'NotAllowedError';

    mockGetAuthOptions.mockResolvedValue({
      data: {
        options: { challenge: 'challenge-cancel' },
      },
    });

    mockStartAuthentication
      .mockRejectedValueOnce(notAllowedErr)
      .mockResolvedValueOnce({
        id: 'cred-retry',
        rawId: 'cred-retry',
        response: { authenticatorData: 'data' },
        type: 'public-key',
      });

    mockVerifyAuth.mockResolvedValueOnce({
      data: { verified: true, responseTimeSec: 2.1 },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Biometric check was cancelled\. Tap "Verify Biometric Passkey" to try again\./i)).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /Verify Biometric Passkey/i });
    await act(async () => {
      retryBtn.click();
    });

    expect(mockVerifyAuth).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Verified Present!')).toBeInTheDocument();
  });

  it('displays specific credential mismatch message when assertion belongs to wrong student', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'challenge-mismatch' } },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-other',
      rawId: 'cred-other',
      response: { authenticatorData: 'data' },
      type: 'public-key',
    });

    mockVerifyAuth.mockRejectedValueOnce(new Error('Credential mismatch: credential belongs to student B'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Credential mismatch: This phone does not belong to the student account active on the PC\./i)).toBeInTheDocument();
  });

  it('displays challenge expired message if challenge is not found', async () => {
    mockGetAuthOptions.mockRejectedValueOnce(new Error('Bingo round not found or already closed'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/This attendance challenge has already expired or ended\./i)).toBeInTheDocument();
  });
});
