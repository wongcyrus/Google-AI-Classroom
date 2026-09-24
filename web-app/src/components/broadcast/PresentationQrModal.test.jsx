import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PresentationQrModal from './PresentationQrModal';
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
});
