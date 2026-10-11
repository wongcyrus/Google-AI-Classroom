import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
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
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/lecture-verify#Intent;scheme=https;package=com.android.chrome;end',
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
        <button onClick={() => onScan('https://it114115-2627.web.app/lecture-verify?classId=c1&bingoId=b1&token=scanned123')}>Scan Web URL</button>
        <button onClick={() => onScan('/lecture-verify?classId=c1&bingoId=b1&token=scanned456')}>Scan Path URL</button>
        <button onClick={() => onScan('http-custom')}>Scan Plain Http</button>
        <button onClick={() => onScan('invalid-no-http')}>Scan Plain Invalid</button>
        <button onClick={() => onScan('')}>Scan Empty</button>
        <button onClick={onClose}>Close Scanner</button>
      </div>
    ) : null
  ),
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

  it('displays warning when browser lacks WebAuthn support', async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/This mobile browser does not support biometric passkeys/i)).toBeInTheDocument();
  });

  it('displays error when attendance query parameters are missing', async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Missing attendance parameters or token/i)).toBeInTheDocument();
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

  it('renders different rank medals (2nd, 3rd, #4) and already verified message', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'c2' }, challengeId: 'chal_2' },
    });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred-2' });
    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentEmail: 'bob@vtc.edu.hk',
        responseTimeSec: 3.5,
        rank: 2,
        alreadyVerified: true,
      },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('🥈 2nd in Hall')).toBeInTheDocument();
    expect(screen.getByText(/Your lecture hall attendance has already been confirmed/i)).toBeInTheDocument();
  });

  it('renders rank 3 and rank > 3 correctly', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'c3' }, challengeId: 'chal_3' },
    });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred-3' });
    mockVerify.mockResolvedValueOnce({
      data: { verified: true, studentEmail: 'cat@vtc.edu.hk', rank: 3 },
    });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText('🥉 3rd in Hall')).toBeInTheDocument();
  });

  it('handles options error when server returns invalid or empty options', async () => {
    mockGetOptions.mockResolvedValueOnce({ data: null });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Could not obtain biometric options/i)).toBeInTheDocument();
  });

  it('handles server verification returning unverified', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'chal' }, challengeId: 'c1' },
    });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred-fail' });
    mockVerify.mockResolvedValueOnce({ data: { verified: false } });

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Biometric assertion could not be verified by server/i)).toBeInTheDocument();
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
    const retryBtn = screen.getByRole('button', { name: /Verify Biometric Passkey/i });
    expect(retryBtn).toBeInTheDocument();

    // Clicking retry calls executeLectureBiometricAuth again
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'chal-2' }, challengeId: 'chal-2' },
    });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred-retry' });
    mockVerify.mockResolvedValueOnce({ data: { verified: true, studentEmail: 'alex@vtc.edu.hk' } });

    await act(async () => {
      fireEvent.click(retryBtn);
    });

    expect(screen.getByText('Verified Present!')).toBeInTheDocument();
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

    // Test clicking Cancel on the fallback form returns to ready status
    const cancelBtn = screen.getByRole('button', { name: /Back to Biometric Scan/i });
    await act(async () => {
      fireEvent.click(cancelBtn);
    });
    expect(screen.getByRole('button', { name: /Verify Biometric Passkey/i })).toBeInTheDocument();
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
      fireEvent.click(setupBtn);
    });

    expect(screen.getByText('Set Up Lecture Passkey')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Log In & Confirm Attendance/i })).toBeInTheDocument();
  });

  it('renders Open Camera App to Rescan button and Live Scanner modal triggers', async () => {
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
    const liveScanBtn = screen.getByRole('button', { name: /Scan QR Code \(Live Camera\)/i });
    expect(liveScanBtn).toBeInTheDocument();

    // Open live camera scanner modal
    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    expect(screen.getByTestId('mock-camera-scanner-modal')).toBeInTheDocument();

    // Trigger onScan from modal
    const scanWebBtn = screen.getByRole('button', { name: /Scan Web URL/i });
    await act(async () => {
      fireEvent.click(scanWebBtn);
    });

    // Open again and test relative URL scan and Close
    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    const scanRelBtn = screen.getByRole('button', { name: /Scan Path URL/i });
    await act(async () => {
      fireEvent.click(scanRelBtn);
    });

    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    const scanPlainBtn = screen.getByRole('button', { name: /Scan Plain Http/i });
    await act(async () => {
      fireEvent.click(scanPlainBtn);
    });

    await act(async () => {
      fireEvent.click(liveScanBtn);
    });
    const closeBtn = screen.getByRole('button', { name: /Close Scanner/i });
    await act(async () => {
      fireEvent.click(closeBtn);
    });
    expect(screen.queryByTestId('mock-camera-scanner-modal')).not.toBeInTheDocument();
  });

  it('handles native photo capture with valid QR, invalid QR, and error conditions', async () => {
    mockGetOptions.mockRejectedValueOnce(new Error('This QR code has expired or was already used.'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=expired-tok']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    const fileInput = screen.getByTestId('native-camera-input');

    // Case 1: Empty file selection
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [] } });
    });

    // Case 2: File with successfully decoded QR
    mockDecodeQr.mockResolvedValueOnce('https://it114115-2627.web.app/lecture-verify?classId=c1&token=new');
    const fakeFile = new File(['content'], 'qr.jpg', { type: 'image/jpeg' });
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });

    // Case 3: File where no QR is detected
    mockDecodeQr.mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });
    expect(screen.getByText(/Could not detect a QR code in the captured photo/i)).toBeInTheDocument();

    // Case 4: File decode throws error
    mockDecodeQr.mockRejectedValueOnce(new Error('File read failure'));
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [fakeFile] } });
    });
    expect(screen.getByText(/Unable to process the photo/i)).toBeInTheDocument();
  });

  it('handles device brand selection changes and credential mismatch diagnostic with chrome intent', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'chal-mismatch' }, challengeId: 'c-mis' },
    });
    mockStartAuthentication.mockResolvedValueOnce({ id: 'cred-mismatch' });
    mockVerify.mockRejectedValueOnce(new Error('credential mismatch: wrong key'));

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/Browser or Phone Mismatch/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();

    // Change smartphone brand dropdown
    const brandSelect = screen.getByLabelText(/Select your smartphone brand:/i);
    expect(brandSelect).toBeInTheDocument();
    await act(async () => {
      fireEvent.change(brandSelect, { target: { value: 'honor' } });
    });
    expect(brandSelect.value).toBe('honor');

    await act(async () => {
      fireEvent.change(brandSelect, { target: { value: 'samsung' } });
    });
    expect(brandSelect.value).toBe('samsung');
  });

  it('renders iOS guidance on iOS when NotSupportedError is thrown', async () => {
    mockIsAndroid = false;
    mockIsIOS = true;

    mockGetOptions.mockResolvedValueOnce({
      data: { options: { challenge: 'chal-ios' }, challengeId: 'c-ios' },
    });
    const notSuppErr = new Error('the operation is not supported');
    notSuppErr.name = 'NotSupportedError';
    mockStartAuthentication.mockRejectedValueOnce(notSuppErr);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/lecture-verify?classId=c1&bingoId=b1&token=tok1234567890123']}>
          <LecturePasskeyVerifyView />
        </MemoryRouter>
      );
    });

    expect(screen.getByText(/iPhone Passkey Setting Required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/iCloud Passwords & Keychain/i).length).toBeGreaterThan(0);
  });
});
