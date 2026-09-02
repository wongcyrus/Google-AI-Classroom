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

  it('renders images tab applyTo checkboxes and handles change', () => {
    const handleApplyToChange = vi.fn();
    const setName = vi.fn();
    const setPromptText = vi.fn();

    render(
      <PromptForm
        selectedPrompt={null}
        name="Image Prompt"
        setName={setName}
        promptText="Analyze screenshot"
        setPromptText={setPromptText}
        applyTo={['Per Image']}
        handleApplyToChange={handleApplyToChange}
        accessLevel="private"
        setAccessLevel={vi.fn()}
        sharedWithUsers={[]}
        emailInput=""
        setEmailInput={vi.fn()}
        handleAddEmail={vi.fn()}
        handleRemoveUser={vi.fn()}
        handleSave={vi.fn()}
        handleDuplicate={vi.fn()}
        handleDelete={vi.fn()}
        activeTab="images"
        handleOptimize={vi.fn()}
        handleUndo={vi.fn()}
        isOptimizing={false}
        originalPromptText=""
      />
    );

    expect(screen.getByLabelText(/Per Image/i)).toBeChecked();
    expect(screen.getByLabelText(/All Images/i)).not.toBeChecked();

    fireEvent.change(screen.getByPlaceholderText('Prompt Name'), { target: { value: 'Updated Prompt' } });
    expect(setName).toHaveBeenCalledWith('Updated Prompt');

    fireEvent.change(screen.getByTestId('md-editor'), { target: { value: 'Updated body' } });
    expect(setPromptText).toHaveBeenCalledWith('Updated body');
  });

  it('renders videos tab label', () => {
    render(
      <PromptForm
        selectedPrompt={null}
        name="Video Prompt"
        setName={vi.fn()}
        promptText="Analyze video"
        setPromptText={vi.fn()}
        applyTo={['Per Video']}
        handleApplyToChange={vi.fn()}
        accessLevel="private"
        setAccessLevel={vi.fn()}
        sharedWithUsers={[]}
        emailInput=""
        setEmailInput={vi.fn()}
        handleAddEmail={vi.fn()}
        handleRemoveUser={vi.fn()}
        handleSave={vi.fn()}
        handleDuplicate={vi.fn()}
        handleDelete={vi.fn()}
        activeTab="videos"
        handleOptimize={vi.fn()}
        handleUndo={vi.fn()}
        isOptimizing={false}
        originalPromptText=""
      />
    );

    expect(screen.getByText('Per Video')).toBeInTheDocument();
  });

  it('handles shared access level, adding and removing shared users', () => {
    const setAccessLevel = vi.fn();
    const setEmailInput = vi.fn();
    const handleAddEmail = vi.fn();
    const handleRemoveUser = vi.fn();

    render(
      <PromptForm
        selectedPrompt={null}
        name="Shared Prompt"
        setName={vi.fn()}
        promptText="Shared prompt text"
        setPromptText={vi.fn()}
        applyTo={['Per Image']}
        handleApplyToChange={vi.fn()}
        accessLevel="shared"
        setAccessLevel={setAccessLevel}
        sharedWithUsers={[{ uid: 'u1', email: 'colleague@vtc.edu.hk' }]}
        emailInput="newuser@vtc.edu.hk"
        setEmailInput={setEmailInput}
        handleAddEmail={handleAddEmail}
        handleRemoveUser={handleRemoveUser}
        handleSave={vi.fn()}
        handleDuplicate={vi.fn()}
        handleDelete={vi.fn()}
        activeTab="images"
        handleOptimize={vi.fn()}
        handleUndo={vi.fn()}
        isOptimizing={false}
        originalPromptText=""
      />
    );

    expect(screen.getByLabelText('Shared')).toBeChecked();
    expect(screen.getByText('colleague@vtc.edu.hk')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Private'));
    expect(setAccessLevel).toHaveBeenCalledWith('private');

    fireEvent.change(screen.getByPlaceholderText('teacher@example.com'), { target: { value: 'another@vtc.edu.hk' } });
    expect(setEmailInput).toHaveBeenCalledWith('another@vtc.edu.hk');

    fireEvent.click(screen.getByText('Add'));
    expect(handleAddEmail).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Remove'));
    expect(handleRemoveUser).toHaveBeenCalledWith('u1');
  });

  it('renders action buttons and handles duplicate, delete, save, optimize, and undo', () => {
    const handleSave = vi.fn();
    const handleDuplicate = vi.fn();
    const handleDelete = vi.fn();
    const handleOptimize = vi.fn();
    const handleUndo = vi.fn();

    const selectedPrompt = { id: 'p1', name: 'Custom Prompt', accessLevel: 'private' };

    const { rerender } = render(
      <PromptForm
        selectedPrompt={selectedPrompt}
        name="Custom Prompt"
        setName={vi.fn()}
        promptText="Some custom prompt instructions"
        setPromptText={vi.fn()}
        applyTo={['Per Image']}
        handleApplyToChange={vi.fn()}
        accessLevel="private"
        setAccessLevel={vi.fn()}
        sharedWithUsers={[]}
        emailInput=""
        setEmailInput={vi.fn()}
        handleAddEmail={vi.fn()}
        handleRemoveUser={vi.fn()}
        handleSave={handleSave}
        handleDuplicate={handleDuplicate}
        handleDelete={handleDelete}
        activeTab="images"
        handleOptimize={handleOptimize}
        handleUndo={handleUndo}
        isOptimizing={false}
        originalPromptText="Old prompt text before optimization"
      />
    );

    expect(screen.getByText('Edit Prompt')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save Changes'));
    expect(handleSave).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Duplicate'));
    expect(handleDuplicate).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Delete'));
    expect(handleDelete).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Optimize'));
    expect(handleOptimize).toHaveBeenCalled();

    fireEvent.click(screen.getByText('Undo'));
    expect(handleUndo).toHaveBeenCalled();

    // Test public prompt behavior (disabled inputs & notice)
    rerender(
      <PromptForm
        selectedPrompt={{ id: 'p_pub', name: 'Public Prompt', accessLevel: 'public' }}
        name="Public Prompt"
        setName={vi.fn()}
        promptText="Public content"
        setPromptText={vi.fn()}
        applyTo={['Per Image']}
        handleApplyToChange={vi.fn()}
        accessLevel="public"
        setAccessLevel={vi.fn()}
        sharedWithUsers={[]}
        emailInput=""
        setEmailInput={vi.fn()}
        handleAddEmail={vi.fn()}
        handleRemoveUser={vi.fn()}
        handleSave={handleSave}
        handleDuplicate={handleDuplicate}
        handleDelete={handleDelete}
        activeTab="images"
        handleOptimize={handleOptimize}
        handleUndo={handleUndo}
        isOptimizing={true}
        originalPromptText=""
      />
    );

    expect(screen.getByText(/This is a public prompt and cannot be edited/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Prompt Name')).toBeDisabled();
    expect(screen.getByText('Optimizing...')).toBeDisabled();
  });
});
