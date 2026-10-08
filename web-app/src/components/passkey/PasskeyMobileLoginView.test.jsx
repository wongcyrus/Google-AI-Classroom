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
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/mobile-login#Intent;scheme=https;package=com.android.chrome;end',
  getAndroidCameraAppIntentUrl: () => 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end',
}));

import PasskeyMobileLoginView from './PasskeyMobileLoginView';

describe('PasskeyMobileLoginView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockIsHandheldPhone.mockReturnValue(true);
    mockIsSupportedBrowser.mockReturnValue(true);
    mockBrowserName = 'Google Chrome';
    mockIsAndroid = true;
    mockIsIOS = false;
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

  it('blocks unsupported browsers like Samsung Internet and provides Open in Google Chrome button', () => {
    mockIsSupportedBrowser.mockReturnValue(false);
    mockBrowserName = 'Samsung Internet';
    mockIsAndroid = true;

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=test-session-123']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    expect(screen.getByText('Unsupported Browser')).toBeInTheDocument();
    expect(screen.getAllByText(/Samsung Internet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();
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

  it('displays error if sessionId query param is missing', () => {
    render(
      <MemoryRouter initialEntries={['/mobile-login']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    expect(screen.getByText(/Missing login session ID/i)).toBeInTheDocument();
  });

  it('auto-executes login on load and displays success screen on valid biometric verify', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'server-challenge-xyz' },
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-123',
      rawId: 'cred-123',
      response: { clientDataJSON: 'mockData' },
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'student@example.com',
        deviceModel: 'Apple iPhone',
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

    expect(screen.getByText('student@example.com')).toBeInTheDocument();
    expect(screen.getByText('Apple iPhone')).toBeInTheDocument();
    expect(screen.getByText('Unlocked & Authorized')).toBeInTheDocument();
  });

  it('handles cancellation and allows manual retry', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'challenge-cancel' } },
    });

    const cancelError = new Error('User cancelled');
    cancelError.name = 'NotAllowedError';
    mockStartAuthentication.mockRejectedValueOnce(cancelError);

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

  it('passes dynamic token to getDesktopLoginPasskeyOptions and verifyDesktopLoginPasskey', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        options: { challenge: 'dynamic-challenge' },
      },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-dynamic',
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'dynamic@example.com',
        deviceModel: 'Pixel 8',
      },
    });

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-dynamic&token=tok1234567890abc']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Desktop Signed In!')).toBeInTheDocument();
    });

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

  it('translates credential mismatch ("wrong key") into clear browser/phone mismatch guidance', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'challenge-err' } },
    });

    mockStartAuthentication.mockResolvedValueOnce({
      id: 'cred-mismatch',
      type: 'public-key',
    });

    mockVerify.mockRejectedValueOnce(
      new Error('Credential mismatch: This phone does not match the paired hardware key for this student.')
    );

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-mismatch']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    });

    expect(screen.getByText(/Browser or Phone Mismatch/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Google Chrome/i).length).toBeGreaterThan(0);
  });

  it('renders Open Camera App to Rescan button and Live Scanner button on error screen', async () => {
    mockIsAndroid = true;
    mockIsIOS = false;

    mockGetOptions.mockRejectedValueOnce(new Error('This QR code has expired or was already used.'));

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-expired&token=old-tok']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    });

    expect(screen.getByText('QR Code Expired')).toBeInTheDocument();
    const cameraBtn = screen.getByRole('button', { name: /Open Camera App to Rescan/i });
    expect(cameraBtn).toBeInTheDocument();

    const liveScanBtn = screen.getByRole('button', { name: /Scan QR Code \(Live Camera\)/i });
    expect(liveScanBtn).toBeInTheDocument();

    const fileInput = screen.getByTestId('native-camera-input');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('capture', 'environment');
    expect(fileInput).toHaveAttribute('accept', 'image/*');

    // Clicking Open Camera App clicks the hidden native camera input
    const clickSpy = vi.spyOn(fileInput, 'click');
    fireEvent.click(cameraBtn);
    expect(clickSpy).toHaveBeenCalled();
  });

  it('renders Scan QR Code with Camera and iOS hint on iOS error screen', async () => {
    mockIsAndroid = false;
    mockIsIOS = true;

    mockGetOptions.mockRejectedValueOnce(new Error('This QR code has expired or was already used.'));

    render(
      <MemoryRouter initialEntries={['/mobile-login?session=sess-expired-ios&token=old-tok']}>
        <PasskeyMobileLoginView />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Sign-In Failed')).toBeInTheDocument();
    });

    const liveScanBtn = screen.getByRole('button', { name: /Scan QR Code \(Live Camera\)/i });
    expect(liveScanBtn).toBeInTheDocument();
    const cameraBtn = screen.getByRole('button', { name: /Open Camera App to Rescan/i });
    expect(cameraBtn).toBeInTheDocument();
    expect(screen.getByText(/swipe up to Home/i)).toBeInTheDocument();
  });
});
