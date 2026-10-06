import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const mockGetOptions = vi.fn();
const mockVerify = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'getPasskeyRegistrationOptions') return mockGetOptions;
    if (name === 'verifyPasskeyRegistration') return mockVerify;
    return vi.fn();
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
}));

const mockStartRegistration = vi.fn();
const mockBrowserSupportsWebAuthn = vi.fn(() => true);
const mockIsHandheldPhone = vi.fn(() => true);
const mockIsSupportedBrowser = vi.fn(() => true);
let mockBrowserName = 'Google Chrome';
let mockIsAndroid = true;
let mockIsIOS = false;

vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: (...args) => mockStartRegistration(...args),
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
  getAndroidChromeIntentUrl: (url) => 'intent://it114115-2627.web.app/pair-phone#Intent;scheme=https;package=com.android.chrome;end',
}));

import PasskeyPairView from './PasskeyPairView';

describe('PasskeyPairView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    mockIsHandheldPhone.mockReturnValue(true);
    mockIsSupportedBrowser.mockReturnValue(true);
    mockBrowserName = 'Google Chrome';
    mockIsAndroid = true;
    mockIsIOS = false;
  });

  it('blocks desktop access with clear mobile required message', () => {
    mockIsHandheldPhone.mockReturnValue(false);

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=test-pair-token']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    expect(screen.getByText('Mobile Phone Required')).toBeInTheDocument();
    expect(screen.getByText(/Shared desktop computers and tablets\/iPads cannot be registered/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pair This Phone/i })).not.toBeInTheDocument();
  });

  it('blocks unsupported browsers like Samsung Internet and provides Open in Google Chrome button', () => {
    mockIsSupportedBrowser.mockReturnValue(false);
    mockBrowserName = 'Samsung Internet';
    mockIsAndroid = true;

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=test-pair-token']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    expect(screen.getByText('Unsupported Browser')).toBeInTheDocument();
    expect(screen.getAllByText(/Samsung Internet/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /Open in Google Chrome/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pair This Phone/i })).not.toBeInTheDocument();
  });

  it('renders initial view with pair phone button on supported mobile browser', () => {
    render(
      <MemoryRouter initialEntries={['/pair-phone?token=test-pair-token']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    expect(screen.getByText('Pair Your Phone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pair This Phone/i })).toBeInTheDocument();
  });

  it('shows error when token is missing', async () => {
    render(
      <MemoryRouter initialEntries={['/pair-phone']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    const pairBtn = screen.getByRole('button', { name: /Pair This Phone/i });
    await act(async () => {
      fireEvent.click(pairBtn);
    });

    expect(screen.getByText(/Missing pairing token/i)).toBeInTheDocument();
  });

  it('successfully pairs phone through WebAuthn registration and displays success screen', async () => {
    mockGetOptions.mockResolvedValueOnce({
      data: {
        challenge: 'test-challenge',
        rp: { name: 'Gemini Assistant', id: 'localhost' },
      },
    });

    mockStartRegistration.mockResolvedValueOnce({
      id: 'cred-123',
      rawId: 'cred-123',
      response: { transports: ['internal'] },
      type: 'public-key',
    });

    mockVerify.mockResolvedValueOnce({
      data: {
        verified: true,
        studentUid: 'student_1',
        deviceModel: 'Apple iPhone',
      },
    });

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=valid-token-123']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    const pairBtn = screen.getByRole('button', { name: /Pair This Phone/i });
    await act(async () => {
      fireEvent.click(pairBtn);
    });

    expect(mockGetOptions).toHaveBeenCalledWith(
      expect.objectContaining({ pairingToken: 'valid-token-123' })
    );
    expect(mockStartRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        optionsJSON: expect.objectContaining({ challenge: 'test-challenge' }),
      })
    );
    expect(mockVerify).toHaveBeenCalledWith(
      expect.objectContaining({
        pairingToken: 'valid-token-123',
        attestationResponse: expect.objectContaining({ id: 'cred-123' }),
      })
    );

    expect(screen.getByText('Phone Paired!')).toBeInTheDocument();
    expect(screen.getByText('Apple iPhone')).toBeInTheDocument();
  });

  it('displays clear error when phone is already registered to another student', async () => {
    mockGetOptions.mockResolvedValueOnce({ data: { challenge: 'test' } });
    mockStartRegistration.mockResolvedValueOnce({ id: 'cred-already-used' });
    mockVerify.mockRejectedValueOnce(
      new Error('This physical phone is already registered to another student. Each phone can only be paired with one student account.')
    );

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=token-456']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    const pairBtn = screen.getByRole('button', { name: /Pair This Phone/i });
    await act(async () => {
      fireEvent.click(pairBtn);
    });

    expect(screen.getByText(/already registered to another student/i)).toBeInTheDocument();
  });

  it('translates Android "provider not found" into clear Screen Lock & Biometrics guidance', async () => {
    mockGetOptions.mockResolvedValueOnce({ data: { challenge: 'test' } });
    mockStartRegistration.mockRejectedValueOnce(
      new Error('The operation failed because no credential provider was found.')
    );

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=token-no-provider']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    const pairBtn = screen.getByRole('button', { name: /Pair This Phone/i });
    await act(async () => {
      fireEvent.click(pairBtn);
    });

    expect(screen.getByText(/Screen Lock & Biometrics Required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Google Password Manager/i).length).toBeGreaterThan(0);
  });

  it('translates iOS NotSupportedError into clear Microsoft Authenticator guidance', async () => {
    mockIsAndroid = false;
    mockIsIOS = true;
    mockBrowserName = 'Apple Safari';

    mockGetOptions.mockResolvedValueOnce({ data: { challenge: 'test' } });
    const notSupportedErr = new Error('The operation is not supported.');
    notSupportedErr.name = 'NotSupportedError';
    mockStartRegistration.mockRejectedValueOnce(notSupportedErr);

    render(
      <MemoryRouter initialEntries={['/pair-phone?token=token-ios-msauth']}>
        <PasskeyPairView />
      </MemoryRouter>
    );

    const pairBtn = screen.getByRole('button', { name: /Pair This Phone/i });
    await act(async () => {
      fireEvent.click(pairBtn);
    });

    expect(screen.getByText(/iPhone Passkey Setting Required/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Microsoft Authenticator/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/iCloud Passwords & Keychain/i).length).toBeGreaterThan(0);
  });
});
