import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImagePromptSelector from './ImagePromptSelector';

vi.mock('../hooks/usePrompts', () => ({
  usePrompts: () => ({
    prompts: [
      { id: 'img-1', name: 'Cloud Fallback Face & Gaze Invigilator', promptText: 'Check face presence and gaze', accessLevel: 'public', category: 'images' },
      { id: 'img-2', name: 'Bingo Question Bank Generator', promptText: 'Generate 4 options MCQ', accessLevel: 'public', category: 'images' },
      { id: 'img-3', name: 'Private Image Proctor', promptText: 'My private proctor', accessLevel: 'private', owner: 'user-1', category: 'images' },
    ],
  }),
}));

describe('ImagePromptSelector Component', () => {
  const mockUser = { uid: 'user-1' };

  it('renders image prompt selector options and text area', () => {
    const onSelectPrompt = vi.fn();
    const onTextChange = vi.fn();

    render(
      <ImagePromptSelector
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={onSelectPrompt}
        promptText=""
        onTextChange={onTextChange}
      />
    );

    expect(screen.getByText(/-- Select an image invigilation AI prompt --/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud Fallback Face & Gaze Invigilator/i)).toBeInTheDocument();
    expect(screen.getByText(/Bingo Question Bank Generator/i)).toBeInTheDocument();

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'img-1' } });
    expect(onSelectPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'img-1', name: 'Cloud Fallback Face & Gaze Invigilator' })
    );

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'New customized prompt text' } });
    expect(onTextChange).toHaveBeenCalledWith('New customized prompt text');
  });

  it('filters prompts by accessLevel (public, private, all)', () => {
    render(
      <ImagePromptSelector
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
        promptText=""
        onTextChange={vi.fn()}
      />
    );

    const privateRadio = screen.getByLabelText(/^Private$/i);
    fireEvent.click(privateRadio);

    expect(screen.getByText(/Private Image Proctor/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cloud Fallback Face & Gaze Invigilator/i)).not.toBeInTheDocument();
  });

  it('falls back to originalId or name when id is stale/not found in prompts', () => {
    render(
      <ImagePromptSelector
        user={mockUser}
        selectedPrompt={{ id: 'stale-img-id', originalId: 'img-2', name: 'Bingo Question Bank Generator' }}
        onSelectPrompt={vi.fn()}
        promptText="Text 2"
        onTextChange={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox');
    expect(select.value).toBe('img-2');

    const { unmount } = render(
      <ImagePromptSelector
        user={mockUser}
        selectedPrompt={{ id: 'stale-1', originalId: 'stale-2', name: 'Cloud Fallback Face & Gaze Invigilator' }}
        onSelectPrompt={vi.fn()}
        promptText="Text 1"
        onTextChange={vi.fn()}
      />
    );

    const selects = screen.getAllByRole('combobox');
    expect(selects[selects.length - 1].value).toBe('img-1');
    unmount();
  });
});
