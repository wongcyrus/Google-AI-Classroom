import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import TranslationPromptSelector from './TranslationPromptSelector';

const mockUseTranslationPrompts = vi.fn();
vi.mock('../hooks/useTranslationPrompts', () => ({
  useTranslationPrompts: (...args) => mockUseTranslationPrompts(...args),
}));

describe('TranslationPromptSelector Component', () => {
  const mockUser = { uid: 'teacher123' };
  const mockPrompts = [
    {
      id: 'p1',
      name: 'Lecture Subtitle & Terminology Translator',
      promptText: 'Translate lecture into target language verbatim.',
      accessLevel: 'public',
      owner: 'system',
    },
    {
      id: 'p2',
      name: 'My Private Japanese Translator',
      promptText: 'Custom Japanese translation instructions.',
      accessLevel: 'private',
      owner: 'teacher123',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTranslationPrompts.mockReturnValue(mockPrompts);
  });

  it('renders dropdown and filters properly', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <TranslationPromptSelector
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={handleSelect}
        promptText=""
        onTextChange={handleTextChange}
      />
    );

    expect(screen.getByText('-- Select a subtitle translation prompt --')).toBeInTheDocument();
    expect(screen.getByText('Lecture Subtitle & Terminology Translator')).toBeInTheDocument();
    expect(screen.getByText('My Private Japanese Translator')).toBeInTheDocument();

    // Select a prompt from dropdown
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'p1' } });
    expect(handleSelect).toHaveBeenCalledWith(mockPrompts[0]);
  });

  it('updates text when textarea changes', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <TranslationPromptSelector
        user={mockUser}
        selectedPrompt={mockPrompts[0]}
        onSelectPrompt={handleSelect}
        promptText="Translate lecture into target language verbatim."
        onTextChange={handleTextChange}
      />
    );

    const textarea = screen.getByPlaceholderText(/Select a lecture translation prompt/i);
    fireEvent.change(textarea, { target: { value: 'New translation rules' } });
    expect(handleTextChange).toHaveBeenCalledWith('New translation rules');
  });

  it('filters prompts by access level radio buttons', () => {
    render(
      <TranslationPromptSelector
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
        promptText=""
        onTextChange={vi.fn()}
      />
    );

    const privateRadio = screen.getByRole('radio', { name: /Private/i });
    fireEvent.click(privateRadio);

    expect(screen.queryByText('Lecture Subtitle & Terminology Translator')).not.toBeInTheDocument();
    expect(screen.getByText('My Private Japanese Translator')).toBeInTheDocument();
  });
});
