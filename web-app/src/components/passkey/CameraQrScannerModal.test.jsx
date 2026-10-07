import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CameraQrScannerModal from './CameraQrScannerModal';

let mockIsAndroid = false;
let mockIsIOS = false;

vi.mock('../../utils/browserDetection', () => ({
  isAndroidDevice: () => mockIsAndroid,
  isIOSDevice: () => mockIsIOS,
  getAndroidCameraAppIntentUrl: () => 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end',
}));

describe('CameraQrScannerModal Component', () => {
  let mockStopTrack;
  let mockStream;
  let mockGetUserMedia;

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsAndroid = false;
    mockIsIOS = false;

    mockStopTrack = vi.fn();
    mockStream = {
      getTracks: vi.fn(() => [{ stop: mockStopTrack, getVideoTracks: () => [] }]),
      getVideoTracks: vi.fn(() => [{ stop: mockStopTrack, getCapabilities: () => ({ torch: true }), applyConstraints: vi.fn() }]),
    };

    mockGetUserMedia = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(global.navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: mockGetUserMedia,
      },
    });

    // Mock HTMLMediaElement.prototype.play
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CameraQrScannerModal
        isOpen={false}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(mockGetUserMedia).not.toHaveBeenCalled();
  });

  it('initializes camera stream when opened', async () => {
    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: /Scan Classroom QR Code/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalledWith(
        expect.objectContaining({
          audio: false,
          video: expect.objectContaining({
            facingMode: { ideal: 'environment' },
          }),
        })
      );
    });
  });

  it('calls onClose when close button or Cancel is clicked', async () => {
    const handleClose = vi.fn();

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={handleClose}
      />
    );

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('displays permission denied error if camera is blocked', async () => {
    const permErr = new Error('Permission denied');
    permErr.name = 'NotAllowedError';
    mockGetUserMedia.mockRejectedValueOnce(permErr);

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Camera access was denied/i)).toBeInTheDocument();
    });
  });

  it('displays Open Phone Camera App button on Android when camera error occurs', async () => {
    mockIsAndroid = true;
    const permErr = new Error('Permission denied');
    permErr.name = 'NotAllowedError';
    mockGetUserMedia.mockRejectedValueOnce(permErr);

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      const androidLinks = screen.getAllByRole('link', { name: /Camera App/i });
      expect(androidLinks.length).toBeGreaterThan(0);
      expect(androidLinks[0]).toHaveAttribute('href', 'intent:#Intent;action=android.media.action.STILL_IMAGE_CAMERA;end');
    });
  });

  it('stops video tracks on unmount', async () => {
    const { unmount } = render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(mockGetUserMedia).toHaveBeenCalled();
    });

    unmount();

    expect(mockStopTrack).toHaveBeenCalled();
  });
});
