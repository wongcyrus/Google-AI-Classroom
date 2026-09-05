import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioTranscriptModal from './AudioTranscriptModal';

describe('AudioTranscriptModal Component', () => {
  const mockTranscriptSegments = [
    {
      id: 'turn_1',
      startTime: '00:04',
      endTime: '00:09',
      speaker: 'Speaker 1 (Student)',
      text: 'What is the answer for question 4?',
    },
    {
      id: 'turn_2',
      startTime: '00:11',
      endTime: '00:15',
      speaker: 'Speaker 2 (Unauthorized Assistant)',
      text: 'The answer is option C.',
    },
  ];

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <AudioTranscriptModal
        isOpen={false}
        onClose={vi.fn()}
        studentUid="student_123"
        studentName="John Doe"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders student name, classification and dialogue turns when open', () => {
    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={vi.fn()}
        studentUid="student_123"
        studentName="John Doe"
        riskLevel="high"
        classification="unauthorized_collaboration"
        explanation="Two distinct voices discussing exam questions."
        transcriptSegments={mockTranscriptSegments}
      />
    );

    expect(screen.getByText(/Audio Diarization & Transcript: John Doe/i)).toBeInTheDocument();
    expect(screen.getByText(/unauthorized collaboration/i)).toBeInTheDocument();
    expect(screen.getByText(/Risk: high/i)).toBeInTheDocument();
    expect(screen.getByText(/"What is the answer for question 4\?"/i)).toBeInTheDocument();
    expect(screen.getByText(/"The answer is option C\."/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const handleClose = vi.fn();
    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={handleClose}
        studentUid="student_123"
        transcriptSegments={mockTranscriptSegments}
      />
    );

    const closeBtn = screen.getByTitle('Close');
    fireEvent.click(closeBtn);
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('renders snapshot image and audio player when URLs are provided', () => {
    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={vi.fn()}
        studentUid="student_123"
        audioUrl="https://example.com/audio.webm"
        snapshotUrl="https://example.com/snapshot.webp"
        transcriptSegments={[
          {
            id: 'whisper_1',
            startTime: '00:02',
            endTime: '00:05',
            speaker: 'Whisper',
            text: 'whispering something',
          },
        ]}
      />
    );

    expect(screen.getByAltText(/Student webcam snapshot during speech/i)).toBeInTheDocument();
    expect(screen.getByText(/whispering something/i)).toBeInTheDocument();
  });

  it('handles timestamp seek button click gracefully', () => {
    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={vi.fn()}
        studentUid="student_123"
        audioUrl="https://example.com/audio.webm"
        transcriptSegments={mockTranscriptSegments}
      />
    );

    const seekButtons = screen.getAllByRole('button', { name: /▶/i });
    expect(seekButtons.length).toBeGreaterThan(0);
    fireEvent.click(seekButtons[0]);
  });

  it('renders empty state when transcriptSegments is empty', () => {
    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={vi.fn()}
        studentUid="student_123"
        transcriptSegments={[]}
      />
    );

    expect(screen.getByText(/No speech detected or transcript empty/i)).toBeInTheDocument();
  });

  it('handles exporting transcript as CSV and TXT', () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-transcript');

    render(
      <AudioTranscriptModal
        isOpen={true}
        onClose={vi.fn()}
        studentUid="student_123"
        studentName="John Doe"
        transcriptSegments={mockTranscriptSegments}
      />
    );

    const csvBtn = screen.getByRole('button', { name: /CSV/i });
    fireEvent.click(csvBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(1);

    const txtBtn = screen.getByRole('button', { name: /TXT/i });
    fireEvent.click(txtBtn);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2);

    window.URL.createObjectURL = originalCreateObjectURL;
  });
});
