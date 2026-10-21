import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PresentationQrModal, { openProjectorQrPopup } from './PresentationQrModal';
import QRCode from 'qrcode';

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mockqrcode123'),
  },
}));

describe('PresentationQrModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <PresentationQrModal isOpen={false} onClose={vi.fn()} classId="CLASS_TEST" pin="8492" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders QR code modal with title, pin, and direct link when open', async () => {
    const onClose = vi.fn();
    render(
      <PresentationQrModal
        isOpen={true}
        onClose={onClose}
        classId="IT114115-TALK"
        pin="8492"
      />
    );

    expect(screen.getByText('📱 Presentation Screen & Subtitles QR Code')).toBeInTheDocument();
    expect(screen.getByText('ACCESS PIN:')).toBeInTheDocument();
    expect(screen.getByText('8492')).toBeInTheDocument();

    await waitFor(() => {
      const img = screen.getByAltText('Scan QR code to join live presentation');
      expect(img).toBeInTheDocument();
      expect(img.getAttribute('src')).toBe('data:image/png;base64,mockqrcode123');
    });

    const input = screen.getByDisplayValue(/IT114115-TALK\?pin=8492/);
    expect(input).toBeInTheDocument();

    const doneBtn = screen.getByRole('button', { name: /Done/i });
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('allows copying link to clipboard with visual feedback', async () => {
    const mockWriteText = vi.fn().mockResolvedValue();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });

    render(
      <PresentationQrModal
        isOpen={true}
        onClose={vi.fn()}
        classId="IT114115-TALK"
        pin="5521"
      />
    );

    const copyBtn = screen.getByRole('button', { name: /Copy Link/i });
    fireEvent.click(copyBtn);

    expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('/live/IT114115-TALK?pin=5521'));
    await waitFor(() => {
      expect(screen.getByText(/Copied!/i)).toBeInTheDocument();
    });
  });

  it('opens a dedicated popup window via openProjectorQrPopup with QR code and PIN', async () => {
    const mockImg = { src: '', style: { display: 'none' } };
    const mockLoading = { style: { display: 'flex' } };
    const mockPopupWin = {
      closed: false,
      focus: vi.fn(),
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        getElementById: vi.fn((id) => {
          if (id === 'qr-img') return mockImg;
          if (id === 'qr-loading') return mockLoading;
          return null;
        }),
      },
    };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(mockPopupWin);

    const win = openProjectorQrPopup({
      classId: 'AWS26-AUD-0945',
      className: 'AWS Community Day Opening',
      pin: '1234',
    });

    expect(win).toBe(mockPopupWin);
    expect(openSpy).toHaveBeenCalledWith(
      '',
      'ProjectorQR_AWS26-AUD-0945',
      expect.stringContaining('width=580,height=760')
    );
    expect(mockPopupWin.document.write).toHaveBeenCalledWith(expect.stringContaining('1234'));
    expect(mockPopupWin.focus).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockImg.src).toBe('data:image/png;base64,mockqrcode123');
      expect(mockImg.style.display).toBe('block');
      expect(mockLoading.style.display).toBe('none');
    });

    openSpy.mockRestore();
  });
});
