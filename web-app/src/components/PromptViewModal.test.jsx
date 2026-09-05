import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import PromptViewModal from './PromptViewModal';

describe('PromptViewModal Component', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const mockJob = {
    id: 'job_prompt_123',
    modelUsed: 'gemini-3.7-flash',
    prompt: 'Evaluate student hand gestures and off-screen glances.',
    createdAt: { toDate: () => new Date('2026-08-30T10:00:00Z') },
  };

  it('renders job metadata and prompt content properly', () => {
    const onClose = vi.fn();
    render(<PromptViewModal show={true} onClose={onClose} job={mockJob} />);

    expect(screen.getByText('job_prompt_123')).toBeInTheDocument();
    expect(screen.getByText('gemini-3.7-flash')).toBeInTheDocument();
    expect(screen.getByText(/Evaluate student hand gestures/i)).toBeInTheDocument();

    const closeBtns = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeBtns[0]);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles copy to clipboard and error fallback', async () => {
    render(<PromptViewModal show={true} onClose={vi.fn()} job={mockJob} />);

    const copyBtn = screen.getByRole('button', { name: /Copy Prompt/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockJob.prompt);
    expect(screen.getByText(/Copied!/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2100);
    });

    // Test clipboard rejection
    navigator.clipboard.writeText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to copy'), expect.any(Error));
  });

  it('renders fallback when prompt is missing and returns null when job is null', () => {
    const { rerender } = render(
      <PromptViewModal
        show={true}
        onClose={vi.fn()}
        job={{ id: 'job_empty', model: 'gemini-3.5-flash-lite' }}
      />
    );

    expect(screen.getByText('No prompt specified.')).toBeInTheDocument();

    rerender(<PromptViewModal show={true} onClose={vi.fn()} job={null} />);
    expect(screen.queryByText('No prompt specified.')).not.toBeInTheDocument();
  });
});
