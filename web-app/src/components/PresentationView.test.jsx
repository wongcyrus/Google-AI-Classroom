import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import PresentationView from './PresentationView';

describe('PresentationView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(document, 'fullscreenElement', {
      writable: true,
      configurable: true,
      value: null,
    });
  });

  it('renders toolbar, title, action buttons, and iframe', () => {
    render(<PresentationView />);

    expect(screen.getByText('📽️ SLIDE DECK')).toBeInTheDocument();
    expect(screen.getByText('Google AI Classroom Architecture Presentation')).toBeInTheDocument();
    expect(screen.getByText('Google Cloud Tech Talk · ISATE 2026')).toBeInTheDocument();

    const iframe = screen.getByTitle('Google AI Classroom Interactive Presentation');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', '/google-cloud-slides.html');

    expect(screen.getByLabelText('Toggle Fullscreen')).toBeInTheDocument();
    expect(screen.getByLabelText('Open in New Tab')).toHaveAttribute('href', '/google-cloud-slides.html');
    expect(screen.getByLabelText('Download PDF')).toHaveAttribute('href', '/google-cloud-slides.pdf');
    expect(screen.getByLabelText('Download PPTX')).toHaveAttribute('href', '/google-cloud-slides.pptx');
  });

  it('displays loading indicator initially and hides it when iframe loads', () => {
    render(<PresentationView />);

    expect(screen.getByText('Loading interactive slide deck...')).toBeInTheDocument();

    const iframe = screen.getByTitle('Google AI Classroom Interactive Presentation');
    fireEvent.load(iframe);

    expect(screen.queryByText('Loading interactive slide deck...')).not.toBeInTheDocument();
  });

  it('toggles speaker guide drawer open and closed', () => {
    render(<PresentationView />);

    const guideBtn = screen.getByLabelText('Toggle Speaker Notes');
    expect(screen.queryByRole('complementary', { name: 'Speaker Guide' })).not.toBeInTheDocument();

    fireEvent.click(guideBtn);
    expect(screen.getByRole('complementary', { name: 'Speaker Guide' })).toBeInTheDocument();
    expect(screen.getByText('🎙️ Presentation Key Topics & Structure')).toBeInTheDocument();
    expect(screen.getByText(/10 Thematic Modules/)).toBeInTheDocument();
    expect(screen.getByText(/Presentation Keyboard Shortcuts/)).toBeInTheDocument();

    const closeBtn = screen.getByLabelText('Close Guide');
    fireEvent.click(closeBtn);
    expect(screen.queryByRole('complementary', { name: 'Speaker Guide' })).not.toBeInTheDocument();

    // Toggle again via guide button
    fireEvent.click(guideBtn);
    expect(screen.getByRole('complementary', { name: 'Speaker Guide' })).toBeInTheDocument();
    fireEvent.click(guideBtn);
    expect(screen.queryByRole('complementary', { name: 'Speaker Guide' })).not.toBeInTheDocument();
  });

  it('handles entering and exiting fullscreen mode', async () => {
    const requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
    const exitFullscreenMock = vi.fn().mockResolvedValue(undefined);

    HTMLElement.prototype.requestFullscreen = requestFullscreenMock;
    document.exitFullscreen = exitFullscreenMock;

    render(<PresentationView />);

    const fullscreenBtn = screen.getByLabelText('Toggle Fullscreen');
    expect(fullscreenBtn).toHaveTextContent('⛶ Fullscreen');

    // Click to enter fullscreen
    await act(async () => {
      fireEvent.click(fullscreenBtn);
    });
    expect(requestFullscreenMock).toHaveBeenCalled();

    // Simulate browser fullscreenchange event
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        writable: true,
        configurable: true,
        value: document.createElement('div'),
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(fullscreenBtn).toHaveTextContent('⏹️ Exit Fullscreen');

    // Click to exit fullscreen
    await act(async () => {
      fireEvent.click(fullscreenBtn);
    });
    expect(exitFullscreenMock).toHaveBeenCalled();

    // Simulate browser exiting fullscreen
    act(() => {
      Object.defineProperty(document, 'fullscreenElement', {
        writable: true,
        configurable: true,
        value: null,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });

    expect(fullscreenBtn).toHaveTextContent('⛶ Fullscreen');
  });

  it('catches and handles fullscreen rejection without throwing', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    HTMLElement.prototype.requestFullscreen = vi.fn().mockRejectedValue(new Error('Fullscreen denied'));

    render(<PresentationView />);

    const fullscreenBtn = screen.getByLabelText('Toggle Fullscreen');
    await act(async () => {
      fireEvent.click(fullscreenBtn);
    });

    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[PresentationView] Fullscreen toggle error:'),
      expect.any(Error)
    );
    consoleWarnSpy.mockRestore();
  });
});
