import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRequestToken = vi.fn();
const mockRequestBypass = vi.fn();
const mockVerifyPin = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'requestPasskeyPairingToken') return mockRequestToken;
    if (name === 'requestTeacherPasskeyBypass') return mockRequestBypass;
    if (name === 'verifyTeacherPasskeyBypassPin') return mockVerifyPin;
    return vi.fn();
  }),
}));

const mockDoc = vi.fn((db, path) => ({ path }));
let mockPasskeySnapshotCallback = null;
let mockBypassSnapshotCallback = null;
let mockWhitelistSnapshotCallback = null;

vi.mock('firebase/firestore', () => ({
  doc: (...args) => mockDoc(...args),
  onSnapshot: vi.fn((docRef, cb) => {
    if (docRef.path.startsWith('studentPasskeys/')) {
      mockPasskeySnapshotCallback = cb;
    } else if (docRef.path.includes('/studentProperties/')) {
      mockBypassSnapshotCallback = cb;
    } else if (docRef.path.includes('system_config/loginPolicy')) {
      mockWhitelistSnapshotCallback = cb;
    }
    return vi.fn(); // unsubscribe
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
  db: {},
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockQrCode'),
  },
}));

vi.mock('../../utils/browserDetection', () => ({
  isMobileDevice: vi.fn(() => false),
}));

import PasskeyEnforcementGate from './PasskeyEnforcementGate';

describe('PasskeyEnforcementGate Component', () => {
  const mockUser = {
    uid: 'student-alex-123',
    email: 'alex@stu.vtc.edu.hk',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPasskeySnapshotCallback = null;
    mockBypassSnapshotCallback = null;
    mockRequestToken.mockResolvedValue({ data: { tokenId: 'token-xyz-789' } });
  });

  it('bypasses gate immediately for teachers and renders protected children', () => {
    render(
      <PasskeyEnforcementGate user={{ uid: 'teacher-1', email: 'teacher@vtc.edu.hk' }} role="teacher" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    expect(screen.getByTestId('protected-content')).toBeInTheDocument();
  });

  it('renders loading state initially while checking passkey security', () => {
    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    expect(screen.getByText('Checking passkey security status...')).toBeInTheDocument();
  });

  it('renders locked barrier with anti-desktop warning when no passkey exists', async () => {
    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    // Simulate snapshot callback with no passkey document
    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({ exists: () => false });
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Personal Mobile Passkey Required')).toBeInTheDocument();
    });

    expect(screen.getByText(/Shared Lab PC Detected — Desktop Passkeys Prohibited/i)).toBeInTheDocument();
    expect(screen.getByText(/Point your phone camera at this QR code/i)).toBeInTheDocument();
    expect(screen.queryByTestId('protected-content')).not.toBeInTheDocument();
  });

  it('unlocks and renders protected content when student has paired mobile passkey', async () => {
    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    // Simulate snapshot callback with existing passkey
    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({
          exists: () => true,
          data: () => ({ deviceModel: 'iPhone 15' }),
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });

  it('unlocks and renders protected content when teacher granted active bypass', async () => {
    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    // Simulate no passkey, but active bypass
    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({ exists: () => false });
      }
      if (mockBypassSnapshotCallback) {
        mockBypassSnapshotCallback({
          exists: () => true,
          data: () => ({
            passkeyBypass: {
              active: true,
              expiresAtMillis: Date.now() + 60000,
            },
          }),
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
    });
  });

  it('allows requesting podium bypass with desk number and reason', async () => {
    mockRequestBypass.mockResolvedValueOnce({
      data: { success: true, requestId: 'req-1' },
    });

    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({ exists: () => false });
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/Phone Unavailable/i)).toBeInTheDocument();
    });

    // Open bypass modal
    fireEvent.click(screen.getByText(/Phone Unavailable/i));

    expect(screen.getByText('Teacher Manual Bypass')).toBeInTheDocument();

    // Fill in desk number
    fireEvent.change(screen.getByLabelText(/Your Desk \/ Seat Number/i), {
      target: { value: 'Desk #14' },
    });

    // Select reason
    fireEvent.change(screen.getByLabelText(/Reason Phone is Unavailable/i), {
      target: { value: 'Battery Depleted' },
    });

    // Submit request
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Send Request to Teacher Podium/i }));
    });

    expect(mockRequestBypass).toHaveBeenCalledWith(
      expect.objectContaining({
        studentUid: mockUser.uid,
        classId: 'class-1',
        deskNumber: 'Desk #14',
        reason: 'Battery Depleted',
      })
    );

    expect(screen.getByText(/Request submitted to Teacher Podium/i)).toBeInTheDocument();
  });

  it('allows verifying emergency PIN directly in the bypass modal', async () => {
    mockVerifyPin.mockResolvedValueOnce({
      data: { success: true, message: 'Emergency PIN verified!' },
    });

    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({ exists: () => false });
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/Phone Unavailable/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Phone Unavailable/i));

    // Switch to PIN tab
    fireEvent.click(screen.getByRole('button', { name: /Teacher Emergency PIN/i }));

    fireEvent.change(screen.getByLabelText(/Teacher 6-Digit Emergency PIN/i), {
      target: { value: '654321' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Verify Emergency PIN/i }));
    });

    expect(mockVerifyPin).toHaveBeenCalledWith(
      expect.objectContaining({
        classId: 'class-1',
        studentUid: mockUser.uid,
        pin: '654321',
      })
    );

    expect(screen.getByText(/Emergency PIN verified/i)).toBeInTheDocument();
  });

  it('unlocks access and renders banner when student is on the global password whitelist', async () => {
    render(
      <PasskeyEnforcementGate user={mockUser} role="student" classId="class-1">
        <div data-testid="protected-content">Classroom Content</div>
      </PasskeyEnforcementGate>
    );

    act(() => {
      if (mockPasskeySnapshotCallback) {
        mockPasskeySnapshotCallback({ exists: () => false });
      }
      if (mockWhitelistSnapshotCallback) {
        mockWhitelistSnapshotCallback({
          exists: () => true,
          data: () => ({
            passwordWhitelist: ['alex@stu.vtc.edu.hk'],
          }),
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('protected-content')).toBeInTheDocument();
      expect(screen.getByText(/Password Whitelist Active/i)).toBeInTheDocument();
    });
  });
});
