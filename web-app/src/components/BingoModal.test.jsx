import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import BingoModal, { playBingoChime } from './BingoModal';

describe('BingoModal Component', () => {
  const mockBingo = {
    bingoId: 'bingo_abc123',
    question: 'What command starts a Docker container?',
    options: ['docker start', 'docker run', 'docker build', 'docker stop'],
    timeLimitSeconds: 45,
    issuedAtMillis: Date.now(),
    expiresAtMillis: Date.now() + 45000,
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders modal with question, options, and countdown timer', () => {
    render(<BingoModal activeBingo={mockBingo} onSubmit={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('🎯 Class Bingo Check')).toBeInTheDocument();
    expect(screen.getByText('What command starts a Docker container?')).toBeInTheDocument();
    expect(screen.getByText('docker start')).toBeInTheDocument();
    expect(screen.getByText('docker run')).toBeInTheDocument();
    expect(screen.getByText('docker build')).toBeInTheDocument();
    expect(screen.getByText('docker stop')).toBeInTheDocument();
    expect(screen.getByText(/45s/)).toBeInTheDocument();
  });

  it('calls onSubmit with selected option index and closes immediately', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ result: 'passed', isCorrect: true });
    const mockClose = vi.fn();
    render(<BingoModal activeBingo={mockBingo} onSubmit={mockSubmit} onClose={mockClose} />);

    const optionBtn = screen.getByTestId('bingo-option-1'); // 'docker run'
    await act(async () => {
      fireEvent.click(optionBtn);
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        bingoId: 'bingo_abc123',
        selectedIndex: 1,
        responseTimeSec: expect.any(Number),
      })
    );

    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('bingo-modal-overlay')).not.toBeInTheDocument();
  });

  it('auto-submits with selectedIndex null on timeout', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ result: 'missed_timeout' });
    const shortBingo = {
      ...mockBingo,
      timeLimitSeconds: 2,
      expiresAtMillis: Date.now() + 2000,
    };

    render(<BingoModal activeBingo={shortBingo} onSubmit={mockSubmit} onClose={vi.fn()} />);

    // Fast-forward past timeout
    await act(async () => {
      vi.advanceTimersByTime(2500);
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        bingoId: 'bingo_abc123',
        selectedIndex: null,
      })
    );
    expect(screen.getByTestId('bingo-feedback')).toHaveTextContent(/Time Expired/);
  });

  it('does not render or popup when challenge is already expired before mount', () => {
    const expiredBingo = {
      ...mockBingo,
      expiresAtMillis: Date.now() - 5000,
    };
    const mockClose = vi.fn();
    const mockSubmit = vi.fn();
    const { container } = render(<BingoModal activeBingo={expiredBingo} onSubmit={mockSubmit} onClose={mockClose} />);
    expect(container.firstChild).toBeNull();
    expect(mockClose).toHaveBeenCalled();
    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        bingoId: 'bingo_abc123',
        selectedIndex: null,
      })
    );
  });

  it('executes playBingoChime without throwing even if Web Audio is unsupported or restricted', () => {
    expect(() => playBingoChime()).not.toThrow();
  });

  it('allows answering a second challenge when activeBingo prop changes with a new bingoId', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ result: 'passed', isCorrect: true });
    const { rerender } = render(<BingoModal activeBingo={mockBingo} onSubmit={mockSubmit} onClose={vi.fn()} />);

    // 1. Submit first bingo
    const optionBtn1 = screen.getByTestId('bingo-option-1');
    await act(async () => {
      fireEvent.click(optionBtn1);
    });
    expect(mockSubmit).toHaveBeenCalledTimes(1);

    // 2. Receive a new second bingo challenge
    const secondBingo = {
      bingoId: 'bingo_xyz789',
      question: 'Which tool provisions cloud infrastructure as code?',
      options: ['Kubernetes', 'Terraform', 'Prometheus', 'Grafana'],
      timeLimitSeconds: 45,
      issuedAtMillis: Date.now(),
      expiresAtMillis: Date.now() + 45000,
    };

    rerender(<BingoModal activeBingo={secondBingo} onSubmit={mockSubmit} onClose={vi.fn()} />);

    // Check new question is displayed and feedback is reset
    expect(screen.getByText('Which tool provisions cloud infrastructure as code?')).toBeInTheDocument();
    expect(screen.queryByTestId('bingo-feedback')).not.toBeInTheDocument();

    // 3. User can click and submit the second challenge!
    const optionBtn2 = screen.getByTestId('bingo-option-1'); // 'Terraform'
    await act(async () => {
      fireEvent.click(optionBtn2);
    });

    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        bingoId: 'bingo_xyz789',
        selectedIndex: 1,
      })
    );
  });

  it('renders class pill with issuing class name and applies high-contrast styling', () => {
    const multiClassBingo = {
      ...mockBingo,
      classId: 'class_devops_202',
      className: 'DevOps Engineering',
    };

    render(<BingoModal activeBingo={multiClassBingo} onSubmit={vi.fn()} onClose={vi.fn()} />);

    const pill = screen.getByTestId('bingo-class-pill');
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent('DevOps Engineering');

    const questionText = screen.getByText('What command starts a Docker container?');
    expect(questionText).toHaveStyle({ color: '#0f172a' });

    const optionLabel = screen.getByText('docker run');
    expect(optionLabel).toHaveStyle({ color: '#0f172a' });
  });

  it('renders as compact centered mobile modal when isMobile is true', () => {
    const { container } = render(
      <BingoModal activeBingo={mockBingo} isMobile={true} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    // 1. Overlay and container have .is-mobile class
    const overlay = screen.getByTestId('bingo-modal-overlay');
    expect(overlay).toHaveClass('is-mobile');

    const modalContainer = container.querySelector('.bingo-modal-container');
    expect(modalContainer).toHaveClass('is-mobile');

    // 2. Question box has compact mobile font and high contrast
    const questionText = screen.getByText('What command starts a Docker container?');
    expect(questionText.getAttribute('style')).toContain('font-size: 0.95rem');
    expect(questionText).toHaveStyle({ color: '#0f172a' });

    // 3. Centered modal dialog: No drag handle
    expect(screen.queryByTestId('bingo-drag-handle')).not.toBeInTheDocument();
  });

  it('dynamically adapts to mobile viewport on window resize', () => {
    // Initial desktop width
    window.innerWidth = 1024;
    render(
      <BingoModal activeBingo={mockBingo} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    expect(screen.getByTestId('bingo-modal-overlay')).not.toHaveClass('is-mobile');

    // Resize to mobile screen width (e.g. iPhone 390px)
    act(() => {
      window.innerWidth = 390;
      window.dispatchEvent(new Event('resize'));
    });

    expect(screen.getByTestId('bingo-modal-overlay')).toHaveClass('is-mobile');
  });

  it('dynamically adapts to landscape phone viewport on rotation', () => {
    // Desktop width and height
    window.innerWidth = 1200;
    window.innerHeight = 800;
    render(
      <BingoModal activeBingo={mockBingo} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    expect(screen.getByTestId('bingo-modal-overlay')).not.toHaveClass('is-mobile');

    // Rotate to landscape phone (e.g. iPhone 844x390px - width > 768px, but height <= 550px)
    act(() => {
      window.innerWidth = 844;
      window.innerHeight = 390;
      window.dispatchEvent(new Event('orientationchange'));
    });

    expect(screen.getByTestId('bingo-modal-overlay')).toHaveClass('is-mobile');
    expect(screen.getByTestId('bingo-modal-overlay')).toHaveClass('is-landscape');
    const containerEl = document.querySelector('.bingo-modal-container');
    expect(containerEl).toHaveClass('is-landscape');
    const bodyEl = document.querySelector('.bingo-modal-body');
    expect(bodyEl).toBeInTheDocument();
  });

  it('renders side-by-side readable body layout and full question in landscape mode', () => {
    window.innerWidth = 844;
    window.innerHeight = 390;

    render(
      <BingoModal activeBingo={mockBingo} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    const overlay = screen.getByTestId('bingo-modal-overlay');
    expect(overlay).toHaveClass('is-landscape');

    const questionText = screen.getByText('What command starts a Docker container?');
    expect(questionText).toBeInTheDocument();
    expect(questionText).toHaveStyle({ color: '#0f172a' });

    // Options grid is rendered inside modal body
    const bodyEl = document.querySelector('.bingo-modal-body');
    expect(bodyEl).toBeInTheDocument();
    expect(screen.getByTestId('bingo-option-0')).toBeInTheDocument();
    expect(screen.getByTestId('bingo-option-1')).toBeInTheDocument();
    expect(screen.getByTestId('bingo-option-2')).toBeInTheDocument();
    expect(screen.getByTestId('bingo-option-3')).toBeInTheDocument();
  });

  it('honors class-level custom timeLimitSeconds (e.g. 60s or 30s)', () => {
    const customTimeBingo = {
      ...mockBingo,
      timeLimitSeconds: 60,
      expiresAtMillis: Date.now() + 60000,
    };

    render(
      <BingoModal activeBingo={customTimeBingo} onSubmit={vi.fn()} onClose={vi.fn()} />
    );

    expect(screen.getByText(/60s/)).toBeInTheDocument();
  });

  it('proactively calls document.exitFullscreen on mount when native fullscreen is active', () => {
    const mockExit = vi.fn().mockResolvedValue();
    const originalExit = document.exitFullscreen;
    const originalFsElement = document.fullscreenElement;

    const fakeFsElement = document.createElement('div');
    document.body.appendChild(fakeFsElement);
    Object.defineProperty(document, 'fullscreenElement', {
      value: fakeFsElement,
      configurable: true,
      writable: true,
    });
    document.exitFullscreen = mockExit;

    try {
      render(
        <BingoModal activeBingo={mockBingo} onSubmit={vi.fn()} onClose={vi.fn()} />
      );

      expect(mockExit).toHaveBeenCalled();
      // Ensure modal is portaled into the fullscreen element so it is not hidden under it
      expect(fakeFsElement.querySelector('[data-testid="bingo-modal-overlay"]')).toBeInTheDocument();
    } finally {
      document.exitFullscreen = originalExit;
      Object.defineProperty(document, 'fullscreenElement', {
        value: originalFsElement,
        configurable: true,
        writable: true,
      });
      fakeFsElement.remove();
    }
  });
});


