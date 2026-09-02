import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StudentScreen from './StudentScreen';

describe('StudentScreen Component', () => {
  const mockStudent = { name: 'Alice Wong', email: 'alice@school.edu' };

  it('renders student name and "Not Sharing" placeholder when disconnected', () => {
    render(<StudentScreen student={mockStudent} isSharing={false} screenshotUrl={null} />);
    
    expect(screen.getByText('Alice Wong')).toBeInTheDocument();
    expect(screen.getByText('Not Sharing')).toBeInTheDocument();
  });

  it('renders "Connecting..." placeholder when isSharing is true but no image is yet received', () => {
    render(<StudentScreen student={mockStudent} isSharing={true} screenshotUrl={null} />);
    
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('renders screenshot image element when screenshotUrl is provided', () => {
    const url = 'https://storage.googleapis.com/test-bucket/test.jpg';
    render(<StudentScreen student={mockStudent} isSharing={true} screenshotUrl={url} />);
    
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', url);
    expect(img.getAttribute('alt')).toContain('alice@school.edu');
  });

  it('renders dual view when both screen and webcam streams are present', () => {
    const screenshotData = {
      screen: { url: 'https://storage.googleapis.com/test-bucket/screen.jpg' },
      webcam: { url: 'https://storage.googleapis.com/test-bucket/webcam.jpg' },
    };
    render(
      <StudentScreen
        student={mockStudent}
        isSharing={true}
        screenshotData={screenshotData}
        selectedChannel="both"
      />
    );

    expect(screen.getByText('🖥️ Screen')).toBeInTheDocument();
    expect(screen.getByText('📷 Webcam')).toBeInTheDocument();
    const images = screen.getAllByRole('img');
    expect(images).toHaveLength(2);
  });

  it('renders selectedChannel="screen" view and fallback placeholder correctly', () => {
    const screenshotData = {
      screen: { url: 'https://storage.googleapis.com/test-bucket/screen.jpg' },
    };
    const { rerender } = render(
      <StudentScreen
        student={mockStudent}
        isSharing={true}
        screenshotData={screenshotData}
        selectedChannel="screen"
      />
    );
    expect(screen.getByText('🖥️ Screen')).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={mockStudent}
        isSharing={true}
        screenshotData={{}}
        selectedChannel="screen"
      />
    );
    expect(screen.getByText('No Screen Stream')).toBeInTheDocument();
  });

  it('renders selectedChannel="webcam" view and fallback placeholder correctly', () => {
    const screenshotData = {
      webcam: { url: 'https://storage.googleapis.com/test-bucket/webcam.jpg' },
    };
    const { rerender } = render(
      <StudentScreen
        student={mockStudent}
        isSharing={true}
        screenshotData={screenshotData}
        selectedChannel="webcam"
      />
    );
    expect(screen.getByText('📷 Webcam')).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={mockStudent}
        isSharing={true}
        screenshotData={{}}
        selectedChannel="webcam"
      />
    );
    expect(screen.getByText('No Webcam Stream')).toBeInTheDocument();
  });

  it('renders face status alerts (looking away, no face, multiple faces)', () => {
    const studentWithAlert = {
      ...mockStudent,
      faceStatus: 'looking_away',
      yawAngle: 32,
    };
    const { rerender } = render(
      <StudentScreen student={studentWithAlert} isSharing={true} screenshotUrl="test.jpg" />
    );
    expect(screen.getByText(/Looking Away \(\+32°\)/i)).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={{ ...mockStudent, faceStatus: 'no_face' }}
        isSharing={true}
        screenshotUrl="test.jpg"
      />
    );
    expect(screen.getByText(/⚠️ No Face/i)).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={{ ...mockStudent, faceStatus: 'multiple_faces' }}
        isSharing={true}
        screenshotUrl="test.jpg"
      />
    );
    expect(screen.getByText(/⚠️ Multiple People/i)).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={{ ...mockStudent, faceStatus: 'eyes_closed' }}
        isSharing={true}
        screenshotUrl="test.jpg"
      />
    );
    expect(screen.getByText(/😴 Eyes Closed \/ Sleeping/i)).toBeInTheDocument();

    rerender(
      <StudentScreen
        student={{ ...mockStudent, faceStatus: 'talking' }}
        isSharing={true}
        screenshotUrl="test.jpg"
      />
    );
    expect(screen.getByText(/🗣️ Talking \/ Whispering/i)).toBeInTheDocument();
  });

  it('renders audio badges for speaking and multi-voice warnings', () => {
    const studentSpeaking = {
      ...mockStudent,
      isAudioSharing: true,
      audioStatus: 'speaking',
      audioLevel: 65,
      isMultiSpeaker: true,
    };
    render(
      <StudentScreen student={studentSpeaking} isSharing={true} screenshotUrl="test.jpg" />
    );

    expect(screen.getByText('👥⚠️')).toBeInTheDocument();
  });

  it('renders AI initializing loading indicator when model is downloading', () => {
    const studentLoading = {
      ...mockStudent,
      clientAiStatus: 'initializing',
      loadingProgress: 65,
    };
    render(
      <StudentScreen student={studentLoading} isSharing={true} screenshotUrl="test.jpg" />
    );

    expect(screen.getByText(/⏳ 65%/i)).toBeInTheDocument();
    expect(screen.getByText(/⏳ AI Loading \(65%\)/i)).toBeInTheDocument();
  });

  it('renders live Whisper speech bubble with language tag', () => {
    const studentWithTranscript = {
      ...mockStudent,
      liveTranscript: '點解 option B 係啱嘅？',
      speechLanguage: 'mixed',
      liveTranscriptTimestamp: Date.now(),
    };
    render(
      <StudentScreen student={studentWithTranscript} isSharing={true} screenshotUrl="test.jpg" />
    );

    expect(screen.getByText('💬 粵/普/EN')).toBeInTheDocument();
    expect(screen.getByText('"點解 option B 係啱嘅？"')).toBeInTheDocument();
  });

  it('renders on-device LiteRT Gemma violation alert badge', () => {
    const studentWithGemmaAlert = {
      ...mockStudent,
      gemmaAlert: 'COLLUSION_EXAM',
      gemmaSeverity: 'critical',
      gemmaConfidence: 0.98,
    };
    render(
      <StudentScreen student={studentWithGemmaAlert} isSharing={true} screenshotUrl="test.jpg" />
    );

    expect(screen.getByText('🚨 Collusion (Gemma)')).toBeInTheDocument();
  });

  it('shows the teacher whether Gemma is loading, ready, or unavailable', () => {
    const { rerender } = render(
      <StudentScreen
        student={{ ...mockStudent, gemmaModelStatus: 'loading', gemmaLoadingProgress: 40 }}
        isSharing={false}
      />
    );
    expect(screen.getByTitle('Student is loading Gemma 4 E2B (40%)')).toHaveTextContent('🤖 40%');

    rerender(
      <StudentScreen
        student={{ ...mockStudent, gemmaModelStatus: 'ready' }}
        isSharing={false}
      />
    );
    expect(screen.getByTitle('Gemma 4 E2B is loaded on this student device')).toHaveTextContent('🤖');

    rerender(
      <StudentScreen
        student={{
          ...mockStudent,
          gemmaModelStatus: 'unavailable',
          gemmaUnavailableReason: 'WebGPU is unavailable on this device',
        }}
        isSharing={false}
      />
    );
    expect(screen.getByTitle(
      'Gemma unavailable: WebGPU is unavailable on this device'
    )).toHaveTextContent('⛔🤖');
  });
});
