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

  it('calls onSubmit with selected option index and displays confirmation', async () => {
    const mockSubmit = vi.fn().mockResolvedValue({ result: 'passed', isCorrect: true });
    render(<BingoModal activeBingo={mockBingo} onSubmit={mockSubmit} onClose={vi.fn()} />);

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

    expect(screen.getByTestId('bingo-feedback')).toHaveTextContent(/Verified!/);
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
});
