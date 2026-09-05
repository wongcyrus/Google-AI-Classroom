import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import VideoPromptSelector from './VideoPromptSelector';

const mockPrompts = [
  { id: 'p1', name: 'Public Video Prompt', category: 'videos', accessLevel: 'public', promptText: 'Text 1', owner: 'other' },
  { id: 'p2', name: 'Private Video Prompt', category: 'videos', accessLevel: 'private', promptText: 'Text 2', owner: 'user_1' },
  { id: 'p3', name: 'Shared Video Prompt', category: 'videos', accessLevel: 'shared', promptText: 'Text 3', owner: 'other', sharedWith: ['user_1'] },
];

vi.mock('../hooks/useVideoPrompts', () => ({
  useVideoPrompts: vi.fn(() => mockPrompts),
}));

describe('VideoPromptSelector Component', () => {
  it('renders filter radio buttons and prompt options', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <VideoPromptSelector
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
    expect(screen.getByText('Public Video Prompt')).toBeInTheDocument();
    expect(screen.getByText('Private Video Prompt')).toBeInTheDocument();
    expect(screen.getByText('Shared Video Prompt')).toBeInTheDocument();
  });

  it('filters prompts by access level when radio button changes', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <VideoPromptSelector
        user={{ uid: 'user_1' }}
        selectedPrompt={null}
        onSelectPrompt={handleSelect}
        promptText=""
        onTextChange={handleTextChange}
      />
    );

    fireEvent.click(screen.getByLabelText(/Private/i));
    expect(screen.getByText('Private Video Prompt')).toBeInTheDocument();
    expect(screen.queryByText('Public Video Prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Public/i));
    expect(screen.getByText('Public Video Prompt')).toBeInTheDocument();
    expect(screen.queryByText('Private Video Prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Shared/i));
    expect(screen.getByText('Shared Video Prompt')).toBeInTheDocument();
    expect(screen.queryByText('Private Video Prompt')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/All/i));
    expect(screen.getByText('Public Video Prompt')).toBeInTheDocument();
  });

  it('handles null user gracefully', () => {
    render(
      <VideoPromptSelector
        user={null}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
        promptText=""
        onTextChange={vi.fn()}
      />
    );
    expect(screen.getByText('-- Select a prompt --')).toBeInTheDocument();
  });

  it('triggers onSelectPrompt when a prompt is picked and updates textarea', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <VideoPromptSelector
        user={{ uid: 'user_1' }}
        selectedPrompt={{ id: 'p1', name: 'Public Video Prompt' }}
        onSelectPrompt={handleSelect}
        promptText="Current prompt text"
        onTextChange={handleTextChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'p2' } });
    expect(handleSelect).toHaveBeenCalledWith(mockPrompts[1]);

    const textarea = screen.getByPlaceholderText(/Select a prompt or enter text here.../i);
    fireEvent.change(textarea, { target: { value: 'New text' } });
    expect(handleTextChange).toHaveBeenCalledWith('New text');
  });
});
