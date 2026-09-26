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
});
