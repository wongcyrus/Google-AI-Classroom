import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSession = vi.fn();

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((functions, name) => {
    if (name === 'createLectureBingoSession') return mockCreateSession;
    return vi.fn();
  }),
}));

vi.mock('../../firebase-config', () => ({
  functions: {},
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  onSnapshot: vi.fn((ref, callback) => {
    callback({
      exists: () => true,
      data: () => ({
        responses: {
          s1: {
            studentUid: 's1',
            studentEmail: 'student1@vtc.edu.hk',
            responseTimeSec: 1.8,
            rank: 1,
            passkeyVerified: true,
          },
        },
      }),
    });
    return () => {};
  }),
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockQrCode'),
  },
}));

vi.mock('../../utils/lectureQrCrypto', () => ({
  computeClientLectureQrToken: vi.fn().mockResolvedValue('tok1234567890123'),
  DEFAULT_LECTURE_QR_ROTATION_INTERVAL_SEC: 15,
  DEFAULT_LECTURE_QR_ROTATION_INTERVAL_MS: 15000,
  LECTURE_QR_ROTATION_INTERVAL_MS: 15000,
}));

import LectureQrBingoModal from './LectureQrBingoModal';

describe('LectureQrBingoModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes lecture session, displays QR code, rotation interval selector, and live attendee', async () => {
    mockCreateSession.mockResolvedValueOnce({
      data: {
        bingoId: 'bingo_lecture_100',
        roundId: 'round_lecture_100',
        sessionSecret: 'secret_123',
        expiresAtMillis: Date.now() + 60000,
        timeLimitSeconds: 60,
      },
    });

    await act(async () => {
      render(
        <LectureQrBingoModal
          show={true}
          onClose={vi.fn()}
          classId="class_cloud_101"
          className="Cloud Computing & DevOps"
          totalStudentsCount={40}
        />
      );
    });

    expect(mockCreateSession).toHaveBeenCalledWith(
      expect.objectContaining({ classId: 'class_cloud_101', rotationIntervalSeconds: 15 })
    );

    expect(screen.getByText('Lecture Hall Dynamic QR Check-In')).toBeInTheDocument();
    expect(screen.getByText(/Cloud Computing & DevOps/i)).toBeInTheDocument();
    expect(screen.getByAltText('Lecture Hall Dynamic Attendance QR Code')).toBeInTheDocument();
    expect(screen.getByText(/Anti-Spoofing Token/i)).toBeInTheDocument();
    expect(screen.getByTestId('lecture-rotation-select')).toHaveValue('15');
    expect(screen.getByText('student1')).toBeInTheDocument();
    expect(screen.getByText('⚡ 1.8s')).toBeInTheDocument();
  });

  it('renders nothing when show is false', () => {
    const { container } = render(
      <LectureQrBingoModal
        show={false}
        onClose={vi.fn()}
        classId="class_cloud_101"
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
