import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockGetOptions = vi.fn();
const mockVerify = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'getLecturePasskeyAuthOptions') return mockGetOptions;
    if (name === 'verifyLecturePasskeyAuth') return mockVerify;
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
  isHonorDevice: () => false,
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/lecture-verify#Intent;scheme=https;package=com.android.chrome;end',
  getAndroidCameraAppIntentUrl: () => 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end',
}));

import LecturePasskeyVerifyView from './LecturePasskeyVerifyView';

describe('LecturePasskeyVerifyView Component', () => {
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
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Mobile Phone Required')).toBeInTheDocument();
    expect(screen.getByText(/Lecture hall attendance check-in must be performed from your personal handheld smartphone/i)).toBeInTheDocument();
    expect(mockGetOptions).not.toHaveBeenCalled();
  });

  it('blocks unsupported browsers like Samsung Internet and provides Open in Google Chrome button', async () => {
    mockIsSupportedBrowser.mockReturnValue(false);
    mockBrowserName = 'Samsung Internet';
    mockIsAndroid = true;

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Unsupported Browser')).toBeInTheDocument();
    expect(screen.getAllByText(/Samsung Internet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();
  });

  it('automatically triggers Face ID / Fingerprint on mount and shows success screen', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'lecture-challenge-123' },
        challengeId: 'chal_99',
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-hardware-123',
      rawId: 'cred-hardware-123',
      response: { authenticatorData: 'data' },
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'alex@vtc.edu.hk',
        responseTimeSec: 2.1,
        rank: 1,
      },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(mockGetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'c1', bingoId: 'b1', token: 'tok1234567890123' })
    );
    expect(mockStartAuthentication).toHaveBeenCalled();
    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'c1',
        bingoId: 'b1',
        challengeId: 'chal_99',
        token: 'tok1234567890123',
      })
    );

    expect(screen.getByText('Verified Present!')).toBeInTheDocument();
    expect(screen.getByText('alex@vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByText('🥇 1st in Hall')).toBeInTheDocument();
    expect(screen.getByText('2.1s')).toBeInTheDocument();
  });

  it('renders expired token error and hides verify button when token expired', async () => {
    mockGetOptions.mockRejectedValueOnce(new Error('The scanned QR token has expired. Please scan the current code on the screen.'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=old_token_123456']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/This QR token has expired/i)).toBeInTheDocument();
    expect(screen.getByText(/QR Code Expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Verify Biometric Passkey/i })).not.toBeInTheDocument();
  });

  it('keeps verify button visible when biometric check is cancelled by user', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'lecture-challenge-123' },
        challengeId: 'chal_99',
      },
    });

    const notAllowedErr = new Error('User cancelled');
    notAllowedErr.name = 'NotAllowedError';
    mockStartAuthentication.mockRejectedValueOnce(notAllowedErr);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Biometric check was cancelled\. Tap "Verify Biometric Passkey" below to try again\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Verify Biometric Passkey/i })).toBeInTheDocument();
  });

  it('seamlessly transitions to password fallback form when phone has no resident passkey (NotFoundError)', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'lecture-challenge-123' },
        challengeId: 'chal_99',
      },
    });

    const notFoundErr = new Error('No credentials found on this device');
    notFoundErr.name = 'NotFoundError';
    mockStartAuthentication.mockRejectedValueOnce(notFoundErr);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Set Up Lecture Passkey')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Enter your classroom password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log In & Confirm Attendance/i })).toBeInTheDocument();
  });

  it('allows manual transition to password setup form when button is clicked', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'lecture-challenge-123' },
        challengeId: 'chal_99',
      },
    });

    const notAllowedErr = new Error('User cancelled');
    notAllowedErr.name = 'NotAllowedError';
    mockStartAuthentication.mockRejectedValueOnce(notAllowedErr);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    const setupBtn = screen.getByRole('button', { name: /First time on this phone\? Set up with password/i });
    await act(async () => {
      setupBtn.click();
    });

    expect(screen.getByText('Set Up Lecture Passkey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log In & Confirm Attendance/i })).toBeInTheDocument();
  });

  it('renders Open Camera App to Rescan button when lecture QR code expires on Android', async () => {
    mockIsAndroid = true;
    mockIsIOS = false;

    mockGetOptions.mockRejectedValueOnce(new Error('This QR code has expired or was already used.'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=expired-tok']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('QR Code Expired')).toBeInTheDocument();
    const cameraLink = screen.getByRole('link', { name: /Open Camera App to Rescan/i });
    expect(cameraLink).toBeInTheDocument();
    expect(cameraLink).toHaveAttribute('href', 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end');
    expect(screen.getByRole('button', { name: /Scan with Camera in Browser/i })).toBeInTheDocument();
  });
});
