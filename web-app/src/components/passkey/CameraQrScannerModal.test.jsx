import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CameraQrScannerModal from './CameraQrScannerModal';

const mockDecodeQrFromElement = vi.fn().mockResolvedValue(null);
const mockDecodeQrFromImageFile = vi.fn().mockResolvedValue('https://example.com/decoded-qr');

vi.mock('../../utils/qrCodeDecoder', () => ({
  decodeQrFromElement: (...args) => mockDecodeQrFromElement(...args),
  decodeQrFromImageFile: (...args) => mockDecodeQrFromImageFile(...args),
}));

describe('CameraQrScannerModal Component', () => {
  let mockStopTrack;
  let mockApplyConstraints;
  let mockStream;
  let mockGetUserMedia;

  beforeEach(() => {
    vi.clearAllMocks();

    mockStopTrack = vi.fn();
    mockApplyConstraints = vi.fn().mockResolvedValue(undefined);
    mockStream = {
      getTracks: vi.fn(() => [{ stop: mockStopTrack, getVideoTracks: () => [] }]),
      getVideoTracks: vi.fn(() => [
        {
          stop: mockStopTrack,
          getCapabilities: () => ({ torch: true }),
          applyConstraints: mockApplyConstraints,
        },
      ]),
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

    // Also close icon button
    const closeIconBtn = screen.getByLabelText(/Close scanner/i);
    fireEvent.click(closeIconBtn);
    expect(handleClose).toHaveBeenCalledTimes(2);
  });

  it('displays permission denied error and photo capture button if camera is blocked', async () => {
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
      expect(screen.getByText(/Camera permission was blocked/i)).toBeInTheDocument();
    });

    const photoButtons = screen.getAllByRole('button', { name: /Camera App/i });
    expect(photoButtons.length).toBeGreaterThan(0);
  });

  it('displays NotFoundError when no camera is available', async () => {
    const notFoundErr = new Error('Device not found');
    notFoundErr.name = 'NotFoundError';
    mockGetUserMedia.mockRejectedValueOnce(notFoundErr);

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No camera found on this device/i)).toBeInTheDocument();
    });
  });

  it('displays generic error when camera initialization fails', async () => {
    mockGetUserMedia.mockRejectedValueOnce(new Error('Hardware sensor locked'));

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Hardware sensor locked/i)).toBeInTheDocument();
    });
  });

  it('renders file input with capture="environment" for native camera app fallback', async () => {
    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const fileInput = screen.getByTestId('camera-file-input');
    expect(fileInput).toBeInTheDocument();
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('accept', 'image/*');
    expect(fileInput).toHaveAttribute('capture', 'environment');
  });

  it('calls onScan when photo is selected via camera capture input', async () => {
    const handleScan = vi.fn();
    mockDecodeQrFromImageFile.mockResolvedValueOnce('https://example.com/decoded-qr');

    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={handleScan}
        onClose={vi.fn()}
      />
    );

    const fileInput = screen.getByTestId('camera-file-input');
    const dummyFile = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' });

    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [dummyFile] } });
    });

    await waitFor(() => {
      expect(handleScan).toHaveBeenCalledWith('https://example.com/decoded-qr');
    });
  });

  it('handles null QR detection or decode failure from file input', async () => {
    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    const fileInput = screen.getByTestId('camera-file-input');
    const dummyFile = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' });

    // Empty files
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [] } });
    });

    // Null returned
    mockDecodeQrFromImageFile.mockResolvedValueOnce(null);
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [dummyFile] } });
    });
    expect(screen.getByText(/Could not detect a QR code in the captured photo/i)).toBeInTheDocument();

    // Exception thrown
    mockDecodeQrFromImageFile.mockRejectedValueOnce(new Error('Corrupt photo'));
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [dummyFile] } });
    });
    expect(screen.getByText(/Unable to process the photo/i)).toBeInTheDocument();
  });

  it('toggles torch flashlight on and off', async () => {
    render(
      <CameraQrScannerModal
        isOpen={true}
        onScan={vi.fn()}
        onClose={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Flashlight On/i })).toBeInTheDocument();
    });

    const torchBtn = screen.getByRole('button', { name: /Flashlight On/i });
    await act(async () => {
      fireEvent.click(torchBtn);
    });

    expect(mockApplyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(screen.getByRole('button', { name: /Flashlight Off/i })).toBeInTheDocument();

    // Toggle off
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flashlight Off/i }));
    });
    expect(mockApplyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: false }] });

    // Error in toggle
    mockApplyConstraints.mockRejectedValueOnce(new Error('Torch hardware error'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Flashlight On/i }));
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
