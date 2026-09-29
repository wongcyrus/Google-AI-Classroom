import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestToken = vi.fn();
const mockStartRegistration = vi.fn();
const mockBrowserSupportsWebAuthn = vi.fn(() => true);

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args) => mockStartRegistration(...args),
  browserSupportsWebAuthn: () => mockBrowserSupportsWebAuthn(),
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'requestPasskeyPairingToken') return mockRequestToken;
    return vi.fn();
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqr'),
  },
}));

let mockSnapshotCb = null;
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  onSnapshot: vi.fn((ref, cb) => {
    mockSnapshotCb = cb;
    return () => {};
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
  db: {},
}));

import PasskeyPairModal from './PasskeyPairModal';

describe('PasskeyPairModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates pairing token, renders QR code, and shows instructions', async () => {
    mockRequestToken.mockResolvedValueOnce({
      data: { tokenId: 'token-abc-789', expiresAtMillis: Date.now() + 600000 },
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    expect(screen.getByText('Pair Your Smartphone')).toBeInTheDocument();
    expect(screen.getByAltText('Pair Phone QR Code')).toBeInTheDocument();
    expect(screen.getByText(/Open Camera/i)).toBeInTheDocument();
    expect(screen.getByText(/Face ID \/ Fingerprint/i)).toBeInTheDocument();
  });

  it('updates to paired state when Firestore snapshot indicates registration completed', async () => {
    mockRequestToken.mockResolvedValueOnce({
      data: { tokenId: 'token-abc-789' },
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    // Simulate Firestore listener notifying completion
    act(() => {
      if (mockSnapshotCb) {
        mockSnapshotCb({
          exists: () => true,
          data: () => ({ deviceModel: 'Apple iPhone 15 Pro' }),
        });
      }
    });

    expect(screen.getByText('Passkey Registered!')).toBeInTheDocument();
    expect(screen.getByText(/Apple iPhone 15 Pro/i)).toBeInTheDocument();
    // Regular students must not see the unlink button
    expect(screen.queryByText(/🔄 Unlink \/ Switch Phone/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Please ask your course instructor to reset your passkey registration/i)).toBeInTheDocument();
  });

  it('renders unlink button for teacher accounts', async () => {
    mockRequestToken.mockResolvedValueOnce({
      data: { tokenId: 'token-teacher-123' },
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'teacher_1', email: 'instructor@vtc.edu.hk' }}
          classId="class_101"
        />
      );
    });

    act(() => {
      if (mockSnapshotCb) {
        mockSnapshotCb({
          exists: () => true,
          data: () => ({ deviceModel: 'Google Pixel 8' }),
        });
      }
    });

    expect(screen.getByText('Passkey Registered!')).toBeInTheDocument();
    expect(screen.getByText(/🔄 Unlink \/ Switch Phone/i)).toBeInTheDocument();
    expect(screen.queryByText(/Please ask your course instructor/i)).not.toBeInTheDocument();
  });

  it('renders unlink button for whitelisted testing accounts', async () => {
    mockRequestToken.mockResolvedValueOnce({
      data: { tokenId: 'token-white-123' },
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_tester', email: 't-cywong@stu.vtc.edu.hk' }}
          classId="class_101"
        />
      );
    });

    act(() => {
      if (mockSnapshotCb) {
        mockSnapshotCb({
          exists: () => true,
          data: () => ({ deviceModel: 'Samsung Galaxy S24' }),
        });
      }
    });

    expect(screen.getByText('Passkey Registered!')).toBeInTheDocument();
    expect(screen.getByText(/🔄 Unlink \/ Switch Phone/i)).toBeInTheDocument();
    expect(screen.queryByText(/Please ask your course instructor/i)).not.toBeInTheDocument();
  });

  it('renders direct mobile registration UI without QR code when on mobile device', async () => {
    // Mock userAgent for mobile
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      configurable: true,
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    expect(screen.getByText('Register Mobile Passkey')).toBeInTheDocument();
    expect(screen.getByText(/Touch Face ID \/ Fingerprint to Register/i)).toBeInTheDocument();
    expect(screen.queryByAltText('Pair Phone QR Code')).not.toBeInTheDocument();

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('handles direct mobile registration execution', async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });

    const mockGetOptions = vi.fn().mockResolvedValue({ data: { challenge: 'abc' } });
    const mockVerify = vi.fn().mockResolvedValue({ data: { verified: true, deviceModel: 'Apple iPhone' } });

    const { httpsCallable } = await import('firebase/functions');
    httpsCallable.mockImplementation((functions, name) => {
      if (name === 'requestPasskeyPairingToken') return mockRequestToken;
      if (name === 'getPasskeyRegistrationOptions') return mockGetOptions;
      if (name === 'verifyPasskeyRegistration') return mockVerify;
      return vi.fn();
    });

    mockRequestToken.mockResolvedValueOnce({ data: { tokenId: 'token-123' } });
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockStartRegistration.mockResolvedValueOnce({ id: 'cred-1' });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    const registerBtn = screen.getByText(/Touch Face ID \/ Fingerprint to Register/i);
    await act(async () => {
      registerBtn.click();
    });

    expect(mockGetOptions).toHaveBeenCalled();
    expect(mockVerify).toHaveBeenCalled();
    expect(screen.getByText('Passkey Registered!')).toBeInTheDocument();

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('handles biometric cancellation error gracefully', async () => {
    const originalUA = navigator.userAgent;
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });

    const mockGetOptions = vi.fn().mockResolvedValue({ data: { challenge: 'abc' } });

    const { httpsCallable } = await import('firebase/functions');
    httpsCallable.mockImplementation((functions, name) => {
      if (name === 'requestPasskeyPairingToken') return mockRequestToken;
      if (name === 'getPasskeyRegistrationOptions') return mockGetOptions;
      return vi.fn();
    });

    mockRequestToken.mockResolvedValueOnce({ data: { tokenId: 'token-123' } });
    mockBrowserSupportsWebAuthn.mockReturnValue(true);

    const cancelErr = new Error('User cancelled');
    cancelErr.name = 'NotAllowedError';
    mockStartRegistration.mockRejectedValueOnce(cancelErr);

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    const registerBtn = screen.getByText(/Touch Face ID \/ Fingerprint to Register/i);
    await act(async () => {
      registerBtn.click();
    });

    expect(screen.getByText(/Biometric registration was cancelled/i)).toBeInTheDocument();

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
  });

  it('renders QR code modal on iPad / tablet instead of direct registration button', async () => {
    const originalUA = navigator.userAgent;
    const originalTouch = navigator.maxTouchPoints;

    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: 5,
      configurable: true,
    });

    mockRequestToken.mockResolvedValueOnce({
      data: { tokenId: 'token-ipad-123' },
    });

    await act(async () => {
      render(
        <PasskeyPairModal
          show={true}
          onClose={vi.fn()}
          user={{ uid: 'student_1' }}
          classId="class_101"
        />
      );
    });

    // Tablets must show the QR code to scan from a handheld smartphone
    expect(screen.getByAltText('Pair Phone QR Code')).toBeInTheDocument();
    expect(screen.queryByText(/Touch Face ID \/ Fingerprint to Register/i)).not.toBeInTheDocument();

    Object.defineProperty(navigator, 'userAgent', {
      value: originalUA,
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', {
      value: originalTouch,
      configurable: true,
    });
  });
});


