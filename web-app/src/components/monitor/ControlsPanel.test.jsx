import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import ControlsPanel from './ControlsPanel';

describe('ControlsPanel Component', () => {
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
      { label: '0.5MB', value: 0.5 * 1024 * 1024 }
    ],
    isCapturing: false,
    toggleCapture: vi.fn(),
    isPaused: false,
    setIsPaused: vi.fn(),
    setShowPromptModal: vi.fn(),
    notSharingStudents: [],
    setShowNotSharingModal: vi.fn(),
    handleDownloadAttendance: vi.fn(),
    editablePromptText: '',
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
    aiUsedQuota: 2.5
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

  it('renders frameRate and maxImageSize select dropdowns', () => {
    const handleFrameRateChange = vi.fn();
    const handleMaxImageSizeChange = vi.fn();
    const setSelectedChannel = vi.fn();

    render(
      <ControlsPanel 
        {...defaultProps} 
        setSelectedChannel={setSelectedChannel}
        handleFrameRateChange={handleFrameRateChange}
        handleMaxImageSizeChange={handleMaxImageSizeChange}
      />
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(4);

    // Channel select (selects[0])
    fireEvent.change(selects[0], { target: { value: 'screen' } });
    expect(setSelectedChannel).toHaveBeenCalledWith('screen');

    // Frame rate select (selects[1])
    fireEvent.change(selects[1], { target: { value: '5' } });
    expect(handleFrameRateChange).toHaveBeenCalled();

    // Max image size select (selects[2])
    fireEvent.change(selects[2], { target: { value: String(500 * 1024) } });
    expect(handleMaxImageSizeChange).toHaveBeenCalled();
  });

  it('renders quota and usage indicators correctly', () => {
    render(<ControlsPanel {...defaultProps} />);

    // Check that storage text is rendered
    expect(screen.getByText(/50 MB of 500 MB/i)).toBeInTheDocument();
    // Check that AI text is rendered
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
    expect(screen.getByText(/Client AI/i)).toBeInTheDocument();
    
    // Open the modal
    const configButton = screen.getByRole('button', { name: /Configure Gaze & Mode/i });
    expect(configButton).toBeInTheDocument();
    fireEvent.click(configButton);

    // Check modal contents
    expect(screen.getByText(/Gaze & Invigilation AI Configuration/i)).toBeInTheDocument();
    expect(screen.getByText(/Gaze & Head Orientation Sensitivity Mode:/i)).toBeInTheDocument();

    // Click Save & Apply
    const saveButton = screen.getByRole('button', { name: /Save & Apply to Live Class/i });
    fireEvent.click(saveButton);

    expect(handleSaveGazeSettings).toHaveBeenCalledWith(expect.objectContaining({
      enableClientAi: true,
      gazeSensitivity: 'standard',
      faceDebounceSeconds: 3,
    }));
  });
});
