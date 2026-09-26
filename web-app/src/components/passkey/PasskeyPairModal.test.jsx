import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestToken = vi.fn();

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

    expect(screen.getByText('Phone Paired!')).toBeInTheDocument();
    expect(screen.getByText(/Apple iPhone 15 Pro/i)).toBeInTheDocument();
  });
});
