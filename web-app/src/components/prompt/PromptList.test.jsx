import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PromptList from './PromptList';

vi.mock('../../firebase-config', () => ({
  auth: {
    currentUser: { uid: 'user_123', email: 'teacher@school.edu' },
  },
}));

describe('PromptList Component Suite', () => {
  const mockPrompts = [
    { id: '1', name: 'Docker Vision', category: 'images', accessLevel: 'public', owner: 'other_user' },
    { id: '2', name: 'Video Segmentation', category: 'videos', accessLevel: 'shared', owner: 'other_user' },
    { id: '3', name: 'Whisper Cheating Detect', category: 'audios', accessLevel: 'private', owner: 'user_123' },
    { id: '4', name: 'Cantonese Live Subtitle', category: 'translations', accessLevel: 'public', owner: 'user_123' },
    { id: '5', name: 'Terminology Guard', category: 'other', applyTo: ['Live Subtitles & Translation'], accessLevel: 'shared', owner: 'user_123' },
  ];

  it('renders all tabs and switches between them', () => {
    const setActiveTab = vi.fn();
    const setSearchTerm = vi.fn();
    const onSelectPrompt = vi.fn();
    const onClearForm = vi.fn();

    render(
      <PromptList
        prompts={mockPrompts}
        activeTab="images"
        setActiveTab={setActiveTab}
        searchTerm=""
        setSearchTerm={setSearchTerm}
        selectedPrompt={null}
        onSelectPrompt={onSelectPrompt}
        onClearForm={onClearForm}
      />
    );

    expect(screen.getByText('Docker Vision')).toBeInTheDocument();
    expect(screen.getByText('Public')).toBeInTheDocument();

    // Click Video tab
    fireEvent.click(screen.getByRole('button', { name: 'Video Prompts' }));
    expect(setActiveTab).toHaveBeenCalledWith('videos');

    // Click Voice / Audio tab
    fireEvent.click(screen.getByRole('button', { name: 'Voice / Audio Prompts' }));
    expect(setActiveTab).toHaveBeenCalledWith('audios');

    // Click Translation tab
    fireEvent.click(screen.getByRole('button', { name: 'Translation Prompts' }));
    expect(setActiveTab).toHaveBeenCalledWith('translations');

    // Click New Prompt
    fireEvent.click(screen.getByRole('button', { name: '+ New Prompt' }));
    expect(onClearForm).toHaveBeenCalled();
  });

  it('filters by search term and selects prompt when clicked', () => {
    const setSearchTerm = vi.fn();
    const onSelectPrompt = vi.fn();

    render(
      <PromptList
        prompts={mockPrompts}
        activeTab="images"
        setActiveTab={vi.fn()}
        searchTerm=""
        setSearchTerm={setSearchTerm}
        selectedPrompt={mockPrompts[0]}
        onSelectPrompt={onSelectPrompt}
        onClearForm={vi.fn()}
      />
    );

    // Search input
    const searchInput = screen.getByPlaceholderText('Search prompts...');
    fireEvent.change(searchInput, { target: { value: 'Docker' } });
    expect(setSearchTerm).toHaveBeenCalledWith('Docker');

    // Select prompt
    const promptItem = screen.getByText('Docker Vision');
    fireEvent.click(promptItem);
    expect(onSelectPrompt).toHaveBeenCalledWith(mockPrompts[0]);
  });

  it('displays translation category prompts including applyTo fallback and badges', () => {
    render(
      <PromptList
        prompts={mockPrompts}
        activeTab="translations"
        setActiveTab={vi.fn()}
        searchTerm=""
        setSearchTerm={vi.fn()}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
        onClearForm={vi.fn()}
      />
    );

    expect(screen.getByText('Cantonese Live Subtitle')).toBeInTheDocument();
    expect(screen.getByText('Terminology Guard')).toBeInTheDocument();
  });

  it('renders private badge when user is the owner', () => {
    render(
      <PromptList
        prompts={mockPrompts}
        activeTab="audios"
        setActiveTab={vi.fn()}
        searchTerm=""
        setSearchTerm={vi.fn()}
        selectedPrompt={null}
        onSelectPrompt={vi.fn()}
        onClearForm={vi.fn()}
      />
    );

    expect(screen.getByText('Whisper Cheating Detect')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
  });
});
