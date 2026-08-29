import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StudentView from './StudentView';

vi.mock('../firebase-config', () => ({
  storage: {},
  db: {},
  auth: {}
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  onSnapshot: vi.fn(() => vi.fn()),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn()
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  uploadBytes: vi.fn(() => Promise.resolve())
}));

vi.mock('firebase/auth', () => ({
  signOut: vi.fn()
}));

vi.mock('../hooks/useStudentClassSchedule', () => ({
  useStudentClassSchedule: () => ({ currentActiveClassId: 'TEST-CLASS-101' })
}));

describe('StudentView Component', () => {
  const mockUser = {
    uid: 'student-123',
    email: 'student1@stu.vtc.edu.hk',
    displayName: 'Student One'
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders student controls and active class name', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam1', label: 'Integrated Camera' }
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true,
      configurable: true
    });

    render(<StudentView user={mockUser} />);

    expect(screen.getByText(/TEST-CLASS-101/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Share Screen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Webcam/i })).toBeInTheDocument();
  });

  it('renders webcam selection dropdown when multiple webcams are detected', async () => {
    const mockDevices = [
      { kind: 'videoinput', deviceId: 'cam1', label: 'Built-in FaceTime HD Camera' },
      { kind: 'videoinput', deviceId: 'cam2', label: 'Logitech C920 Pro HD' }
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true,
      configurable: true
    });

    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      const select = screen.getByLabelText(/Select Webcam/i);
      expect(select).toBeInTheDocument();
      expect(screen.getByText(/Built-in FaceTime HD Camera/i)).toBeInTheDocument();
      expect(screen.getByText(/Logitech C920 Pro HD/i)).toBeInTheDocument();
    });
  });

  it('does not render camera dropdown when only one camera is detected', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: 'videoinput', deviceId: 'cam1', label: 'Default Web Camera' }
        ]),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true,
      configurable: true
    });

    render(<StudentView user={mockUser} />);

    await waitFor(() => {
      expect(screen.queryByLabelText(/Select Webcam/i)).not.toBeInTheDocument();
    });
  });

  it('allows changing the selected webcam from the dropdown', async () => {
    const mockDevices = [
      { kind: 'videoinput', deviceId: 'cam1', label: 'Camera 1' },
      { kind: 'videoinput', deviceId: 'cam2', label: 'Camera 2' }
    ];

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        enumerateDevices: vi.fn().mockResolvedValue(mockDevices),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      },
      writable: true,
      configurable: true
    });

    render(<StudentView user={mockUser} />);

    const select = await screen.findByLabelText(/Select Webcam/i);
    fireEvent.change(select, { target: { value: 'cam2' } });

    expect(select.value).toBe('cam2');
  });
});
