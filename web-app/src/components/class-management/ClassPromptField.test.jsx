import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ClassPromptField from './ClassPromptField';

describe('ClassPromptField Component', () => {
  it('renders unselected standard mode properly', () => {
    const handleOpenModal = vi.fn();
    render(
      <ClassPromptField
        label="Test Prompt Label"
        hint="Helpful guidance hint"
        onOpenModal={handleOpenModal}
        selectButtonText="Choose Custom Prompt"
      />
    );

    expect(screen.getByText('Test Prompt Label')).toBeInTheDocument();
    expect(screen.getByText('Helpful guidance hint')).toBeInTheDocument();
    const btn = screen.getByRole('button', { name: 'Choose Custom Prompt' });
    expect(btn).toBeInTheDocument();

    fireEvent.click(btn);
    expect(handleOpenModal).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /Reset to Default/i })).not.toBeInTheDocument();
  });

  it('renders selected standard mode with reset button and preview', () => {
    const handleReset = vi.fn();
    const prompt = {
      id: 'p1',
      name: 'Custom Detection Rule',
      promptText: 'Analyze student video feed and flag absent faces promptly.',
    };

    render(
      <ClassPromptField
        label="Visual Rule"
        prompt={prompt}
        onOpenModal={vi.fn()}
        onReset={handleReset}
      />
    );

    expect(screen.getByRole('button', { name: 'Selected: Custom Detection Rule' })).toBeInTheDocument();
    const resetBtn = screen.getByRole('button', { name: 'Reset to Default' });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(handleReset).toHaveBeenCalledTimes(1);

    expect(screen.getByText(/Analyze student video feed/i)).toBeInTheDocument();
  });

  it('renders cardStyle mode with custom badges and custom buttons', () => {
    const handleReset = vi.fn();
    const prompt = {
      id: 'stt-1',
      name: 'Bilingual Cantonese English STT',
      promptText: 'Transcribe audio verbatim preserving technical terms and timestamps.',
    };

    render(
      <ClassPromptField
        cardStyle
        label="🎙️ Stage 1: STT"
        labelColor="#1e40af"
        prompt={prompt}
        badgeText="Customized STT Active"
        badgeBg="#dbeafe"
        badgeColor="#1e40af"
        hint="Instruct Gemini on speech recognition"
        onOpenModal={vi.fn()}
        onReset={handleReset}
        selectButtonText="Select STT Prompt"
        resetButtonText="Reset to Default System Prompt"
        previewLength={50}
      />
    );

    expect(screen.getByText('🎙️ Stage 1: STT')).toBeInTheDocument();
    expect(screen.getByText('Customized STT Active')).toBeInTheDocument();
    expect(screen.getByText('Instruct Gemini on speech recognition')).toBeInTheDocument();
    expect(screen.getByText('📄 Bilingual Cantonese English STT')).toBeInTheDocument();
    expect(screen.getByText(/Transcribe audio verbatim preserving/i)).toBeInTheDocument();

    const resetBtn = screen.getByRole('button', { name: 'Reset to Default System Prompt' });
    expect(resetBtn).toBeInTheDocument();
    fireEvent.click(resetBtn);
    expect(handleReset).toHaveBeenCalledTimes(1);
  });
});
