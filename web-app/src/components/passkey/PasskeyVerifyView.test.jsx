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
const mockIsHandheldPhone = vi.fn(() => true);
const mockIsSupportedBrowser = vi.fn(() => true);
let mockBrowserName = 'Google Chrome';
let mockIsAndroid = true;
let mockIsIOS = false;

vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: (...args) => mockStartAuthentication(...args),
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
}));

vi.mock('../../utils/browserDetection', () => ({
  isHandheldPhone: () => mockIsHandheldPhone(),
  isMobileDevice: () => mockIsHandheldPhone(),
  isSupportedBrowser: () => mockIsSupportedBrowser(),
  getBrowserName: () => mockBrowserName,
  isAndroidDevice: () => mockIsAndroid,
  isIOSDevice: () => mockIsIOS,
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/verify-passkey#Intent;scheme=https;package=com.android.chrome;end',
}));

import PasskeyVerifyView from './PasskeyVerifyView';

describe('PasskeyVerifyView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockIsHandheldPhone.mockReturnValue(true);
    mockIsSupportedBrowser.mockReturnValue(true);
    mockBrowserName = 'Google Chrome';
    mockIsAndroid = true;
    mockIsIOS = false;
  });

  it('blocks desktop verification with clear mobile required notice', async () => {
    mockIsHandheldPhone.mockReturnValue(false);

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

  it('blocks unsupported browsers like Samsung Internet and provides Open in Google Chrome button', async () => {
    mockIsSupportedBrowser.mockReturnValue(false);
    mockBrowserName = 'Samsung Internet';
    mockIsAndroid = true;

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Unsupported Browser')).toBeInTheDocument();
    expect(screen.getAllByText(/Samsung Internet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();
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
      data: { verified: true, responseTimeSec: 1.4 },
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
    expect(screen.getByText('1.4s')).toBeInTheDocument();
  });

  it('handles already passed state gracefully', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: { alreadyPassed: true },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Verified Present!')).toBeInTheDocument();
    expect(screen.getByText(/Your attendance has already been confirmed/i)).toBeInTheDocument();
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  it('shows error if student account has no paired passkey', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: { error: 'no_passkey', message: 'No paired phone found for this student account.' },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Browser or Phone Mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/No paired phone found/i)).toBeInTheDocument();
    expect(mockStartAuthentication).not.toHaveBeenCalled();
  });

  it('shows error if classId or bingoId params are missing', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Missing attendance challenge parameters/i)).toBeInTheDocument();
    expect(mockGetAuthOptions).not.toHaveBeenCalled();
  });

  it('allows manual retry when biometric prompt was cancelled', async () => {
    const notAllowedErr = new Error('User cancelled biometric verification');
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

    expect(screen.getByText(/Browser or Phone Mismatch/i)).toBeInTheDocument();
    expect(screen.getByText(/This phone does not match the paired hardware passkey/i)).toBeInTheDocument();
  });

  it('displays challenge expired message if challenge is not found or expired', async () => {
    mockGetAuthOptions.mockRejectedValueOnce(new Error('Bingo round not found or already closed (expired)'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/QR Code Expired/i)).toBeInTheDocument();
  });
});
