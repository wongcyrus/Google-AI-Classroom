import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
  auth: { currentUser: null },
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
  startRegistration: vi.fn(),
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
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/verify-passkey#Intent;scheme=https;package=com.android.chrome;end',
  getAndroidCameraAppIntentUrl: () => 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end',
}));

const mockDecodeQr = vi.fn();
vi.mock('../../utils/qrCodeDecoder', () => ({
  decodeQrFromImageFile: (...args) => mockDecodeQr(...args),
}));

vi.mock('./CameraQrScannerModal', () => ({
  default: ({ isOpen, onScan, onClose }) => (
    isOpen ? (
      <div data-testid="mock-camera-scanner-modal">
        <button onClick={() => onScan('https://it114115-2627.web.app/verify-passkey?classId=c1&bingoId=b1')}>Scan Web URL</button>
        <button onClick={() => onScan('/verify-passkey?classId=c1&bingoId=b1')}>Scan Path URL</button>
        <button onClick={() => onScan('plain-url-http')}>Scan Plain Http</button>
        <button onClick={() => onScan('plain-invalid')}>Scan Plain Invalid</button>
        <button onClick={() => onScan('')}>Scan Empty</button>
        <button onClick={onClose}>Close Scanner</button>
      </div>
    ) : null
  ),
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

  it('displays warning when browser lacks WebAuthn support', async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/does not support biometric passkeys/i)).toBeInTheDocument();
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

  it('seamlessly transitions to password fallback form if student account has no paired passkey', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: { error: 'no_passkey', studentEmail: 'student1@stu.vtc.edu.hk', message: 'No paired phone found for this student account.' },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=class_101&bingoId=bingo_999']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('Set Up Attendance Passkey')).toBeInTheDocument();
    expect(screen.getByDisplayValue('student1@stu.vtc.edu.hk')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log In & Verify Attendance/i })).toBeInTheDocument();
    expect(mockStartAuthentication).not.toHaveBeenCalled();

    // Clicking cancel returns to ready state
    const cancelBtn = screen.getByRole('button', { name: /Back to Biometric Scan/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    expect(screen.getByRole('button', { name: /Verify Biometric Passkey/i })).toBeInTheDocument();
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
      fireEvent.click(retryBtn);
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
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();

    // Test changing brand
    const brandSelect = screen.getByLabelText(/Select your smartphone brand:/i);
    await act(async () => {
      fireEvent.change(brandSelect, { target: { value: 'samsung' } });
    });
    expect(brandSelect.value).toBe('samsung');
  });

  it('handles options rejection from server', async () => {
    mockGetAuthOptions.mockRejectedValueOnce(new Error('Server error obtaining challenge'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=c1&bingoId=b1']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Server error obtaining challenge/i)).toBeInTheDocument();
  });

  it('handles failed server verification', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({ data: { options: { challenge: 'c' } } });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred' });
    mockVerifyAuth.mockResolvedValueOnce({ data: { verified: false } });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=c1&bingoId=b1']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Biometric assertion could not be verified by server/i)).toBeInTheDocument();
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

    expect(screen.getAllByText(/QR Code Expired/i).length).toBeGreaterThan(0);
    const cameraBtn = screen.getByRole('button', { name: /Open Camera App to Rescan/i });
    expect(cameraBtn).toBeInTheDocument();

    const liveScanBtn = screen.getByRole('button', { name: /Scan QR Code \(Live Camera\)/i });
    expect(liveScanBtn).toBeInTheDocument();

    const fileInput = screen.getByTestId('native-camera-input');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('capture', 'environment');
    expect(fileInput).toHaveAttribute('accept', 'image/*');

    const clickSpy = vi.spyOn(fileInput, 'click');
    fireEvent.click(cameraBtn);
    expect(clickSpy).toHaveBeenCalled();

    // Trigger live scanner modal
    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    expect(screen.getByTestId('mock-camera-scanner-modal')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Scan Web URL/i }));
    });

    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Scan Path URL/i }));
    });

    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Scan Plain Http/i }));
    });

    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Close Scanner/i }));
    });
  });

  it('handles native photo input and decode outcomes', async () => {
    mockGetAuthOptions.mockRejectedValueOnce(new Error('Bingo round not found or already closed (expired)'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=c1&bingoId=b1']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    const fileInput = screen.getByTestId('native-camera-input');

    // Empty files
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [] } });
    });

    // Valid decode
    mockDecodeQr.mockResolvedValueOnce('https://it114115-2627.web.app/verify-passkey?classId=c1&bingoId=b1');
    const fakeFile = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });

    // Null decode (no QR detected)
    mockDecodeQr.mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });
    expect(screen.getByText(/Could not detect a QR code in the captured photo/i)).toBeInTheDocument();

    // Decode error
    mockDecodeQr.mockRejectedValueOnce(new Error('Decode error'));
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });
    expect(screen.getByText(/Unable to process the photo/i)).toBeInTheDocument();
  });

  it('allows manual transition to password setup button', async () => {
    mockGetAuthOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'c' } },
    });
    const cancelErr = new Error('User cancelled');
    cancelErr.name = 'NotAllowedError';
    mockStartAuthentication.mockRejectedValueOnce(cancelErr);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/verify-passkey?classId=c1&bingoId=b1']}>
          <PasskeyVerifyView />
        </MemoryRouter>
      );
    });

    const setupBtn = screen.getByRole('button', { name: /First time on this phone\? Set up with password/i });
    await act(async () => {
      fireEvent.click(setupBtn);
    });

    expect(screen.getByText('Set Up Attendance Passkey')).toBeInTheDocument();
  });
});
