import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AudioPromptSelector from './AudioPromptSelector';

const mockPrompts = [
  { id: 'p1', name: 'Public Audio Prompt', category: 'audios', accessLevel: 'public', promptText: 'Text 1', owner: 'other' },
  { id: 'p2', name: 'Private Audio Prompt', category: 'audios', accessLevel: 'private', promptText: 'Text 2', owner: 'user_1' },
  { id: 'p3', name: 'Shared Audio Prompt', category: 'audios', accessLevel: 'shared', promptText: 'Text 3', owner: 'other', sharedWith: ['user_1'] },
];

vi.mock('../hooks/useAudioPrompts', () => ({
  useAudioPrompts: vi.fn(() => mockPrompts),
}));

describe('AudioPromptSelector Component', () => {
  it('renders filter radio buttons and prompt options', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <AudioPromptSelector
        user={{ uid: 'user_1' }}
        selectedPrompt={null}
        onSelectPrompt={handleSelect}
        promptText=""
        onTextChange={handleTextChange}
      />
    );

    expect(screen.getByLabelText(/All/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Public/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Private/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Shared/i)).toBeInTheDocument();

    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Public Audio Prompt')).toBeInTheDocument();
    expect(screen.getByText('Private Audio Prompt')).toBeInTheDocument();
    expect(screen.getByText('Shared Audio Prompt')).toBeInTheDocument();
  });

  it('filters prompts by access level when radio button changes', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <AudioPromptSelector
        user={{ uid: 'user_1' }}
        selectedPrompt={null}
        onSelectPrompt={handleSelect}
        promptText=""
        onTextChange={handleTextChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/Private/i));
    expect(screen.getByText('Private Audio Prompt')).toBeInTheDocument();
    expect(screen.queryByText('Public Audio Prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Shared/i));
    expect(screen.getByText('Shared Audio Prompt')).toBeInTheDocument();
    expect(screen.queryByText('Private Audio Prompt')).not.toBeInTheDocument();
  });

  it('triggers onSelectPrompt when a prompt is picked', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <AudioPromptSelector
        user={{ uid: 'user_1' }}
        selectedPrompt={mockPrompts[0]}
        onSelectPrompt={handleSelect}
        promptText="Custom prompt"
        onTextChange={handleTextChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(handleSelect).toHaveBeenCalledWith(mockPrompts[1]);

    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'Updated prompt instructions' } });
    expect(handleTextChange).toHaveBeenCalledWith('Updated prompt instructions');
  });
});
