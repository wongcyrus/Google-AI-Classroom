import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import BasePromptSelector from './BasePromptSelector';

describe('BasePromptSelector Component', () => {
  const mockUser = { uid: 'user_123', email: 'teacher@test.com' };
  const mockPrompts = [
    { id: 'p1', name: 'Public Prompt', accessLevel: 'public', promptText: 'Public prompt content {{variable}}' },
    { id: 'p2', name: 'Private Prompt', accessLevel: 'private', owner: 'user_123', promptText: 'My private prompt content' },
    { id: 'p3', name: 'Other Private Prompt', accessLevel: 'private', owner: 'other_user', promptText: 'Someone else private prompt' },
    { id: 'p4', name: 'Shared Prompt', accessLevel: 'shared', promptText: 'Shared institutional prompt' },
  ];

  it('filters prompts correctly according to accessLevel tabs', () => {
    render(
      <BasePromptSelector
        prompts={mockPrompts}
        category="images"
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
      />
    );

    const select = screen.getByRole('combobox');
    // Initially 'all': should have default option + 4 prompts
    expect(select.children.length).toBe(5);

    // Switch to 'public'
    const publicRadio = screen.getByLabelText(/Public/i);
    fireEvent.click(publicRadio);
    expect(select.children.length).toBe(2);

    // Switch to 'private' (only matching user.uid)
    const privateRadio = screen.getByLabelText(/Private/i);
    fireEvent.click(privateRadio);
    expect(select.children.length).toBe(2);

    // Switch to 'shared'
    const sharedRadio = screen.getByLabelText(/Shared/i);
    fireEvent.click(sharedRadio);
    expect(select.children.length).toBe(2);
  });

  it('handles selecting a prompt and triggers onSelectPrompt and onTextChange', () => {
    const handleSelect = vi.fn();
    const handleTextChange = vi.fn();

    render(
      <BasePromptSelector
        prompts={mockPrompts}
        category="videos"
        user={mockUser}
        selectedPrompt={null}
        onSelectPrompt={handleSelect}
        onTextChange={handleTextChange}
      />
    );

    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'p1' } });

    expect(handleSelect).toHaveBeenCalledWith(mockPrompts[0]);
    expect(handleTextChange).toHaveBeenCalledWith('Public prompt content {{variable}}');
  });

  it('detects and highlights template placeholders', () => {
    render(
      <BasePromptSelector
        prompts={mockPrompts}
        category="audios"
        user={mockUser}
        selectedPrompt={mockPrompts[0]}
        promptText="Public prompt content {{variable}}"
      />
    );

    expect(screen.getByText('Variables:')).toBeInTheDocument();
    expect(screen.getByText('{{variable}}')).toBeInTheDocument();
  });

  it('renders editable toolbar notice when readOnly is false and triggers text edit', () => {
    const handleTextChange = vi.fn();

    render(
      <BasePromptSelector
        prompts={mockPrompts}
        category="videos"
        user={mockUser}
        selectedPrompt={mockPrompts[0]}
        promptText="Editable content"
        readOnly={false}
        onTextChange={handleTextChange}
      />
    );

    expect(screen.getByText(/You can customize the prompt instructions below for this specific video analysis job/i)).toBeInTheDocument();
    const textarea = screen.getByRole('textbox');
    expect(textarea).not.toHaveAttribute('readonly');

    fireEvent.change(textarea, { target: { value: 'New customized text' } });
    expect(handleTextChange).toHaveBeenCalledWith('New customized text');
  });

  it('supports full review modal inspection', () => {
    render(
      <BasePromptSelector
        prompts={mockPrompts}
        category="images"
        user={mockUser}
        selectedPrompt={mockPrompts[0]}
        promptText="Public prompt content {{variable}}"
      />
    );

    const fullReviewBtn = screen.getByRole('button', { name: /Expand \/ Full Review/i });
    fireEvent.click(fullReviewBtn);

    expect(screen.getByText(/🔍 Prompt Review: Public Prompt/i)).toBeInTheDocument();
    const closeBtn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/🔍 Prompt Review: Public Prompt/i)).not.toBeInTheDocument();
  });
});
