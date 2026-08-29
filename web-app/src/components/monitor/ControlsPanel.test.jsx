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
    frameRate: 10,
    handleFrameRateChange: vi.fn(),
    frameRateOptions: [1, 5, 10, 15, 20],
    maxImageSize: 250 * 1024,
    handleMaxImageSizeChange: vi.fn(),
    maxImageSizeOptions: [
      { label: '0.1MB', value: 100 * 1024 },
      { label: '0.25MB', value: 250 * 1024 },
      { label: '0.5MB', value: 500 * 1024 }
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

    render(
      <ControlsPanel 
        {...defaultProps} 
        handleFrameRateChange={handleFrameRateChange}
        handleMaxImageSizeChange={handleMaxImageSizeChange}
      />
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThanOrEqual(3);

    // Frame rate select (selects[1] following template dropdown selects[0])
    fireEvent.change(selects[1], { target: { value: '5' } });
    expect(handleFrameRateChange).toHaveBeenCalled();

    // Max image size select
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
});
