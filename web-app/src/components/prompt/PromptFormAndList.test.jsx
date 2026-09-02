import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptList from './PromptList';
import PromptForm from './PromptForm';

vi.mock('../../firebase-config', () => ({
  auth: {
    currentUser: { uid: 'teacher_1' },
  },
}));

vi.mock('@uiw/react-md-editor', () => ({
  default: ({ value, onChange }) => (
    <textarea data-testid="md-editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('PromptList Component', () => {
  const mockPrompts = [
    { id: '1', name: 'Audio Live Proctor', category: 'audios', accessLevel: 'public' },
    { id: '2', name: 'Video Summary', category: 'videos', accessLevel: 'shared' },
    { id: '3', name: 'Private Audio Whispering', category: 'audios', accessLevel: 'private', owner: 'teacher_1' },
  ];

  it('renders categories tabs and filters by audio active tab', () => {
    const setActiveTab = vi.fn();
    const setSearchTerm = vi.fn();
    const onSelect = vi.fn();
    const onClear = vi.fn();

    render(
      <PromptList
        prompts={mockPrompts}
        activeTab="audios"
        setActiveTab={setActiveTab}
        searchTerm=""
        setSearchTerm={setSearchTerm}
        selectedPrompt={null}
        onSelectPrompt={onSelect}
        onClearForm={onClear}
      />
    );

    expect(screen.getByText('Voice / Audio Prompts')).toHaveClass('active');
    expect(screen.getByText('Audio Live Proctor')).toBeInTheDocument();
    expect(screen.getByText('Private Audio Whispering')).toBeInTheDocument();
    expect(screen.queryByText('Video Summary')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Video Prompts'));
    expect(setActiveTab).toHaveBeenCalledWith('videos');

    fireEvent.click(screen.getByText('Audio Live Proctor'));
    expect(onSelect).toHaveBeenCalledWith(mockPrompts[0]);
  });
});

describe('PromptForm Component', () => {
  it('renders audio applyTo checkboxes when activeTab is audios', () => {
    const handleApplyToChange = vi.fn();
    const setName = vi.fn();
    const setPromptText = vi.fn();
    const handleSave = vi.fn();

    render(
      <PromptForm
        selectedPrompt={null}
        name="New Audio Prompt"
        setName={setName}
        promptText="Analyze voice transcript"
        setPromptText={setPromptText}
        applyTo={['Live Audio Invigilation']}
        handleApplyToChange={handleApplyToChange}
        accessLevel="private"
        setAccessLevel={vi.fn()}
        sharedWithUsers={[]}
        emailInput=""
        setEmailInput={vi.fn()}
        handleAddEmail={vi.fn()}
        handleRemoveUser={vi.fn()}
        handleSave={handleSave}
        handleDuplicate={vi.fn()}
        handleDelete={vi.fn()}
        activeTab="audios"
        handleOptimize={vi.fn()}
        handleUndo={vi.fn()}
        isOptimizing={false}
        originalPromptText=""
      />
    );

    expect(screen.getByLabelText(/Live Audio Invigilation/i)).toBeChecked();
    expect(screen.getByLabelText(/Session Audio Summary/i)).not.toBeChecked();
    expect(screen.getByLabelText(/On-Device Gemma Voice Intent/i)).not.toBeChecked();

    fireEvent.click(screen.getByLabelText(/Session Audio Summary/i));
    expect(handleApplyToChange).toHaveBeenCalled();
  });
});
