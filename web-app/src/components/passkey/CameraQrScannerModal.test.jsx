import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import CameraQrScannerModal from './CameraQrScannerModal';

vi.mock('../../utils/qrCodeDecoder', () => ({
  decodeQrFromElement: vi.fn().mockResolvedValue(null),
  decodeQrFromImageFile: vi.fn().mockResolvedValue('https://example.com/decoded-qr'),
}));

describe('CameraQrScannerModal Component', () => {
  let mockStopTrack;
  let mockStream;
  let mockGetUserMedia;

  beforeEach(() => {
    vi.clearAllMocks();

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
