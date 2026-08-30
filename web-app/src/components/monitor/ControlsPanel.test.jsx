import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ControlsPanel from './ControlsPanel';

vi.mock('../AiCostReportView', () => ({
  default: () => <div>Mocked AI Cost Breakdown & Audit</div>,
}));

describe('ControlsPanel Full Component Suite', () => {
  const defaultProps = {
    message: '',
    setMessage: vi.fn(),
    handleSendMessage: vi.fn(),
    setShowControls: vi.fn(),
    frameRate: 15,
    handleFrameRateChange: vi.fn(),
    frameRateOptions: [1, 5, 10, 15, 20, 25, 30],
    maxImageSize: 0.1 * 1024 * 1024,
    handleMaxImageSizeChange: vi.fn(),
    maxImageSizeOptions: [
      { label: '0.1MB', value: 0.1 * 1024 * 1024 },
      { label: '0.25MB', value: 0.25 * 1024 * 1024 },
      { label: '0.5MB', value: 0.5 * 1024 * 1024 },
    ],
    isCapturing: false,
    toggleCapture: vi.fn(),
    isPaused: false,
    setIsPaused: vi.fn(),
    setShowPromptModal: vi.fn(),
    notSharingStudents: [],
    setShowNotSharingModal: vi.fn(),
    handleDownloadAttendance: vi.fn(),
    editablePromptText: 'Analyze classroom engagement',
    isPerImageAnalysisRunning: false,
    isAllImagesAnalysisRunning: false,
    setIsPerImageAnalysisRunning: vi.fn(),
    setIsAllImagesAnalysisRunning: vi.fn(),
    samplingRate: 10,
    setSamplingRate: vi.fn(),
    storageUsage: 50 * 1024 * 1024,
    storageQuota: 500 * 1024 * 1024,
    storageUsageScreenShots: 30 * 1024 * 1024,
    storageUsageVideos: 20 * 1024 * 1024,
    storageUsageZips: 0,
    aiQuota: 10,
    aiUsedQuota: 2.5,
  };

  it('renders broadcast section, template dropdown, input, and send button', () => {
    const setMessage = vi.fn();
    const handleSendMessage = vi.fn();
    render(<ControlsPanel {...defaultProps} setMessage={setMessage} handleSendMessage={handleSendMessage} />);

    expect(screen.getByPlaceholderText('Type message or pick template...')).toBeInTheDocument();
    const sendBtn = screen.getByText('Send');
    expect(sendBtn).toBeInTheDocument();

    // Select pre-defined template
    const templateSelect = screen.getByLabelText('Pre-defined message templates');
    fireEvent.change(templateSelect, { target: { value: '⏰ 15 minutes remaining in test/class.' } });
    expect(setMessage).toHaveBeenCalledWith('⏰ 15 minutes remaining in test/class.');

    // Click Send
    fireEvent.click(sendBtn);
    expect(handleSendMessage).toHaveBeenCalled();
  });

  it('renders capturing toggle button and switches state on click', () => {
    const toggleCapture = vi.fn();
    const { rerender } = render(<ControlsPanel {...defaultProps} isCapturing={false} toggleCapture={toggleCapture} />);

    const startBtn = screen.getByText(/Start Capture/i);
    expect(startBtn).toBeInTheDocument();
    fireEvent.click(startBtn);
    expect(toggleCapture).toHaveBeenCalled();

    rerender(<ControlsPanel {...defaultProps} isCapturing={true} toggleCapture={toggleCapture} />);
    expect(screen.getByText(/Stop Capture/i)).toBeInTheDocument();
  });

  it('renders frameRate, maxImageSize, channel, and audio select dropdowns', () => {
    const handleFrameRateChange = vi.fn();
    const handleMaxImageSizeChange = vi.fn();
    const setSelectedChannel = vi.fn();
    const handleAudioCaptureToggle = vi.fn();

    render(
      <ControlsPanel
        {...defaultProps}
        setSelectedChannel={setSelectedChannel}
        handleFrameRateChange={handleFrameRateChange}
        handleMaxImageSizeChange={handleMaxImageSizeChange}
        handleAudioCaptureToggle={handleAudioCaptureToggle}
      />
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(4);

    // Channel select
    fireEvent.change(selects[0], { target: { value: 'screen' } });
    expect(setSelectedChannel).toHaveBeenCalledWith('screen');

    // Audio stream select
    fireEvent.change(selects[1], { target: { value: 'on' } });
    expect(handleAudioCaptureToggle).toHaveBeenCalledWith(true);

    // Frame rate select
    fireEvent.change(selects[2], { target: { value: '5' } });
    expect(handleFrameRateChange).toHaveBeenCalled();

    // Max image size select
    fireEvent.change(selects[3], { target: { value: String(500 * 1024) } });
    expect(handleMaxImageSizeChange).toHaveBeenCalled();
  });

  it('renders quota and usage indicators correctly', () => {
    render(<ControlsPanel {...defaultProps} />);

    // Check storage & AI usage
    expect(screen.getByText(/50 MB of 500 MB/i)).toBeInTheDocument();
    expect(screen.getByText(/\$2.50 of \$10.00 used/i)).toBeInTheDocument();
  });

  it('renders Gaze & Invigilation controls and opens configuration modal', () => {
    const handleSaveGazeSettings = vi.fn();

    render(
      <ControlsPanel
        {...defaultProps}
        enableClientAi={true}
        gazeSensitivity="standard"
        faceDebounceSeconds={3}
        handleSaveGazeSettings={handleSaveGazeSettings}
      />
    );

    expect(screen.getByText(/AI & Invigilation/i)).toBeInTheDocument();

    // Open modal
    const configButton = screen.getByRole('button', { name: /Configure Gaze & Mode/i });
    expect(configButton).toBeInTheDocument();
    fireEvent.click(configButton);

    // Check modal contents
    expect(screen.getByText(/Gaze & Invigilation AI Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Gaze & Head Orientation Sensitivity Mode:/i)).toBeInTheDocument();

    // Click Save & Apply
    const saveButton = screen.getByRole('button', { name: /Save & Apply to Live Class/i });
    fireEvent.click(saveButton);

    expect(handleSaveGazeSettings).toHaveBeenCalled();
  });

  it('handles pause/resume toggle, prompt modal open, and attendance download', () => {
    const setIsPaused = vi.fn();
    const setShowPromptModal = vi.fn();
    const handleDownloadAttendance = vi.fn();
    const setShowNotSharingModal = vi.fn();

    const { rerender } = render(
      <ControlsPanel
        {...defaultProps}
        isCapturing={true}
        isPaused={false}
        setIsPaused={setIsPaused}
        setShowPromptModal={setShowPromptModal}
        handleDownloadAttendance={handleDownloadAttendance}
        notSharingStudents={[{ uid: 's1', email: 's1@test.local' }]}
        setShowNotSharingModal={setShowNotSharingModal}
      />
    );

    // Pause button
    const pauseBtn = screen.getByRole('button', { name: /Pause/i });
    fireEvent.click(pauseBtn);
    expect(setIsPaused).toHaveBeenCalledWith(true);

    // Resume
    rerender(
      <ControlsPanel
        {...defaultProps}
        isCapturing={true}
        isPaused={true}
        setIsPaused={setIsPaused}
        setShowPromptModal={setShowPromptModal}
        handleDownloadAttendance={handleDownloadAttendance}
        notSharingStudents={[{ uid: 's1', email: 's1@test.local' }]}
        setShowNotSharingModal={setShowNotSharingModal}
      />
    );
    const resumeBtn = screen.getByRole('button', { name: /Resume/i });
    fireEvent.click(resumeBtn);
    expect(setIsPaused).toHaveBeenCalledWith(false);

    // Attendance download
    const attendanceBtn = screen.getByRole('button', { name: /Download CSV/i });
    fireEvent.click(attendanceBtn);
    expect(handleDownloadAttendance).toHaveBeenCalled();

    // Not sharing modal
    const notSharingBtn = screen.getByRole('button', { name: /Not Sharing/i });
    fireEvent.click(notSharingBtn);
    expect(setShowNotSharingModal).toHaveBeenCalledWith(true);
  });

  it('toggles AI live analysis triggers (per-image & all-images)', () => {
    const setIsPerImageAnalysisRunning = vi.fn();
    const setIsAllImagesAnalysisRunning = vi.fn();
    const setSamplingRate = vi.fn();

    render(
      <ControlsPanel
        {...defaultProps}
        setIsPerImageAnalysisRunning={setIsPerImageAnalysisRunning}
        setIsAllImagesAnalysisRunning={setIsAllImagesAnalysisRunning}
        setSamplingRate={setSamplingRate}
      />
    );

    const perImageBtn = screen.getByRole('button', { name: /Start Per-Image Analysis/i });
    fireEvent.click(perImageBtn);
    expect(setIsPerImageAnalysisRunning).toHaveBeenCalledWith(true);

    const allImagesBtn = screen.getByRole('button', { name: /Start All-Images Analysis/i });
    fireEvent.click(allImagesBtn);
    expect(setIsAllImagesAnalysisRunning).toHaveBeenCalledWith(true);

    // Sampling rate slider
    const slider = screen.getByRole('slider');
    fireEvent.change(slider, { target: { value: '8' } });
    expect(setSamplingRate).toHaveBeenCalledWith(8);
  });

  it('opens AI cost breakdown audit modal on click View Breakdown', () => {
    render(<ControlsPanel {...defaultProps} classId="CLASS_101" />);

    const breakdownBtn = screen.getByRole('button', { name: /View Breakdown/i });
    fireEvent.click(breakdownBtn);

    expect(screen.getAllByText(/AI Cost Breakdown & Audit/i).length).toBeGreaterThan(0);
  });

  it('customizes pitch, yaw, and mode in Gaze configuration modal', () => {
    const handleSaveGazeSettings = vi.fn();
    render(
      <ControlsPanel
        {...defaultProps}
        enableClientAi={true}
        gazeSensitivity="custom"
        faceDebounceSeconds={3}
        customYawAngle={25}
        customPitchDownAngle={-20}
        customPitchUpAngle={25}
        handleSaveGazeSettings={handleSaveGazeSettings}
      />
    );

    const configButton = screen.getByRole('button', { name: /Configure Gaze & Mode/i });
    fireEvent.click(configButton);

    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.length).toBeGreaterThan(4);
    fireEvent.change(comboboxes[comboboxes.length - 4], { target: { value: 'client_only' } });

    const saveButton = screen.getByRole('button', { name: /Save & Apply to Live Class/i });
    fireEvent.click(saveButton);
    expect(handleSaveGazeSettings).toHaveBeenCalled();
  });

  it('handles template selection and audio capture toggle', () => {
    const handleMaxImageSizeChange = vi.fn();
    const handleFrameRateChange = vi.fn();
    const handleAudioCaptureToggle = vi.fn();
    const setMessage = vi.fn();

    render(
      <ControlsPanel
        {...defaultProps}
        handleMaxImageSizeChange={handleMaxImageSizeChange}
        handleFrameRateChange={handleFrameRateChange}
        handleAudioCaptureToggle={handleAudioCaptureToggle}
        setMessage={setMessage}
        enableAudioCapture={false}
      />
    );

    // Template selection
    const templateSelect = screen.getByRole('combobox', { name: /Pre-defined message templates/i });
    fireEvent.change(templateSelect, { target: { value: '⏰ 15 minutes remaining in test/class.' } });
    expect(setMessage).toHaveBeenCalledWith('⏰ 15 minutes remaining in test/class.');

    const comboboxes = screen.getAllByRole('combobox');
    // Channel select is [0], Audio is [1], Interval is [2], Max size is [3]
    const audioSelect = comboboxes.find(cb => cb.querySelector('option[value="on"]'));
    if (audioSelect) {
      fireEvent.change(audioSelect, { target: { value: 'on' } });
      expect(handleAudioCaptureToggle).toHaveBeenCalledWith(true);
    }

    const intervalSelect = comboboxes.find(cb => cb.querySelector('option[value="5"]'));
    if (intervalSelect) {
      fireEvent.change(intervalSelect, { target: { value: '5' } });
      expect(handleFrameRateChange).toHaveBeenCalled();
    }

    const maxSizeSelect = comboboxes.find(cb => cb.querySelector('option[value="262144"]'));
    if (maxSizeSelect) {
      fireEvent.change(maxSizeSelect, { target: { value: '262144' } });
      expect(handleMaxImageSizeChange).toHaveBeenCalled();
    }
  });
});
