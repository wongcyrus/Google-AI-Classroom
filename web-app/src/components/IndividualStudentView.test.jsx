import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import IndividualStudentView from './IndividualStudentView';

vi.mock('../firebase-config', () => ({
  db: {},
  storage: {},
}));

const mockAddDoc = vi.fn().mockResolvedValue({ id: 'msg_1' });
let mockOnSnapshotCallback = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: (...args) => mockAddDoc(...args),
  serverTimestamp: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: vi.fn((q, cb) => {
    mockOnSnapshotCallback = cb;
    return vi.fn();
  }),
  doc: vi.fn(),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://example.com/audio_resolved.webm'),
}));

const mockStartPeek = vi.fn();
const mockStopPeek = vi.fn();
const mockToggleTalkback = vi.fn();

let mockHookReturn = {
  isPeeking: false,
  connectionState: 'idle',
  remoteStream: null,
  isTalkbackActive: false,
  error: null,
  startPeek: mockStartPeek,
  stopPeek: mockStopPeek,
  toggleTalkback: mockToggleTalkback,
};

vi.mock('../hooks/useWebRTCPeekTeacher', () => ({
  default: () => mockHookReturn,
}));

describe('IndividualStudentView Component', () => {
  const mockStudent = {
    id: 's_1',
    email: 'student@example.com',
    name: 'Alice Student',
  };

  const mockScreenshotData = {
    screen: { url: 'https://example.com/screen.jpg' },
    webcam: { url: 'https://example.com/webcam.jpg' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockHookReturn = {
      isPeeking: false,
      connectionState: 'idle',
      remoteStream: null,
      isTalkbackActive: false,
      error: null,
      startPeek: mockStartPeek,
      stopPeek: mockStopPeek,
      toggleTalkback: mockToggleTalkback,
    };
    window.alert = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      blob: vi.fn().mockResolvedValue(new Blob(['test-img'], { type: 'image/png' })),
    });
    navigator.share = vi.fn().mockResolvedValue();
    navigator.clipboard = {
      writeText: vi.fn().mockResolvedValue(),
    };
    navigator.mediaDevices = {
      enumerateDevices: vi.fn().mockResolvedValue([
        { kind: 'audioinput', deviceId: 'mic_1', label: 'Default Mic' },
        { kind: 'audioinput', deviceId: 'mic_2', label: 'External Mic' },
      ]),
    };
  });

  it('renders student name, tabs and triggers live peek start and stop', () => {
    const { rerender } = render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('Alice Student')).toBeInTheDocument();
    expect(screen.getByText('student@example.com')).toBeInTheDocument();

    const livePeekBtn = screen.getByText(/Live WebRTC Peek/i);
    expect(livePeekBtn).toBeInTheDocument();

    fireEvent.click(livePeekBtn);
    expect(mockStartPeek).toHaveBeenCalled();

    // Now peeking state
    mockHookReturn.isPeeking = true;
    mockHookReturn.connectionState = 'connected';
    rerender(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    const stopPeekBtn = screen.getByText(/Stop Live Peek/i);
    fireEvent.click(stopPeekBtn);
    expect(mockStopPeek).toHaveBeenCalled();
  });

  it('allows tab switching between Dual, Screen, and Webcam views', () => {
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    const screenTabBtn = screen.getAllByText('🖥️ Screen')[0];
    fireEvent.click(screenTabBtn);

    const webcamTabBtn = screen.getAllByText('📷 Webcam')[0];
    fireEvent.click(webcamTabBtn);

    const dualTabBtn = screen.getByText('Dual View');
    fireEvent.click(dualTabBtn);
  });

  it('sends direct text message to student on button click or enter key and handles errors', async () => {
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    // Empty message should not send
    const sendBtn = screen.getByText('Send');
    fireEvent.click(sendBtn);
    expect(mockAddDoc).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText(/Send direct message to student/i);
    fireEvent.change(input, { target: { value: 'Please adjust your camera angle' } });

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(mockAddDoc).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('student@example.com'));
    });

    // Handle send message rejection
    mockAddDoc.mockRejectedValueOnce(new Error('Network error'));
    fireEvent.change(input, { target: { value: 'Another message' } });
    fireEvent.click(sendBtn);
  });

  it('shares screenshot via navigator.share API when available', async () => {
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    const shareBtn = screen.getByText('Share');
    await act(async () => {
      fireEvent.click(shareBtn);
    });

    expect(navigator.share).toHaveBeenCalled();
  });

  it('handles clipboard share fallback when navigator.share is unavailable', () => {
    navigator.share = undefined;

    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    const shareBtn = screen.getByText('Share');
    fireEvent.click(shareBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/screen.jpg');
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('copied to clipboard'));

    // Share individual screen button
    const shareScreenBtn = screen.getByText('Share Screen');
    fireEvent.click(shareScreenBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/screen.jpg');

    // Share individual webcam button
    const shareWebcamBtn = screen.getByText('Share Webcam');
    fireEvent.click(shareWebcamBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/webcam.jpg');
  });

  it('displays live peek status banner and handles talkback and mic change', async () => {
    mockHookReturn.isPeeking = true;
    mockHookReturn.connectionState = 'connected';
    mockHookReturn.isTalkbackActive = true;
    mockHookReturn.remoteStream = { getTracks: () => [] };

    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText(/Live P2P Stream Active/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/External Mic/i)).toBeInTheDocument();
    });

    const micSelect = screen.getByRole('combobox');
    fireEvent.change(micSelect, { target: { value: 'mic_2' } });

    const talkbackBtn = screen.getByText(/Intercom Active/i);
    fireEvent.click(talkbackBtn);
    expect(mockToggleTalkback).toHaveBeenCalledWith(false, 'mic_2');
  });

  it('calls stopPeek and onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={onClose}
      />
    );

    const closeBtn = screen.getByText('✕');
    fireEvent.click(closeBtn);
    expect(mockStopPeek).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('sends direct quick intervention reminders when chips are clicked', async () => {
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    const screenChip = screen.getByTitle('Send Screen Share Reminder');
    fireEvent.click(screenChip);
    expect(mockAddDoc).toHaveBeenCalled();

    const camChip = screen.getByTitle('Send Webcam Reminder');
    fireEvent.click(camChip);
    expect(mockAddDoc).toHaveBeenCalled();

    const micChip = screen.getByTitle('Send Mic Reminder');
    fireEvent.click(micChip);
    expect(mockAddDoc).toHaveBeenCalled();

    const faceChip = screen.getByTitle('Send Face Centering Reminder');
    fireEvent.click(faceChip);
    expect(mockAddDoc).toHaveBeenCalled();
  });

  it('returns null if no student is provided', () => {
    const { container } = render(
      <IndividualStudentView
        student={null}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders audio player when recent recordings exist and allows opening full transcript modal', async () => {
    render(
      <IndividualStudentView
        student={mockStudent}
        screenshotData={mockScreenshotData}
        classId="CLASS_1"
        teacherUid="teacher_1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('🎙️ Recent Voice Recording')).toBeInTheDocument();

    // Trigger audio snapshot with mock audios
    act(() => {
      if (mockOnSnapshotCallback) {
        mockOnSnapshotCallback({
          docs: [
            {
              id: 'audio_1',
              data: () => ({
                audioUrl: 'https://example.com/audio1.webm',
                duration: 30,
                peakVolume: 55,
                hasVoiceActivity: true,
                transcript: 'Can you help me with question 3?',
                transcriptSegments: [{ speaker: 'student', text: 'Can you help me with question 3?', startSec: 2, endSec: 5 }],
                timestamp: { toDate: () => new Date('2026-08-31T10:00:00Z') },
              }),
            },
            {
              id: 'audio_2',
              data: () => ({
                audioUrl: 'https://example.com/audio2.webm',
                duration: 30,
                peakVolume: 10,
                hasVoiceActivity: false,
                transcript: '',
                timestamp: { toDate: () => new Date('2026-08-31T09:59:30Z') },
              }),
            },
          ],
        });
      }
    });

    await waitFor(() => {
      expect(screen.getByTestId('student-audio-player')).toBeInTheDocument();
      expect(screen.getByText(/Can you help me with question 3\?/i)).toBeInTheDocument();
      expect(screen.getByText('📜 View Full Transcript')).toBeInTheDocument();
    });

    // Open full transcript modal
    const viewTranscriptBtn = screen.getByText('📜 View Full Transcript');
    fireEvent.click(viewTranscriptBtn);

    await waitFor(() => {
      expect(screen.getByText(/Audio Diarization & Transcript/i)).toBeInTheDocument();
    });
  });
});
