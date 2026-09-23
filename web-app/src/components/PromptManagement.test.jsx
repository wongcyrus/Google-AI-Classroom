import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import PromptManagement from './PromptManagement';
import { auth, db } from '../firebase-config';
import { onSnapshot, addDoc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { getAI, getGenerativeModel } from 'firebase/ai';

vi.mock('../firebase-config', () => ({
  auth: { currentUser: { uid: 'teacher_1', email: 'teacher@school.edu' } },
  db: {},
  app: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  doc: vi.fn((db, col, id) => ({ id })),
  onSnapshot: vi.fn(),
  addDoc: vi.fn(() => Promise.resolve({ id: 'new-id' })),
  updateDoc: vi.fn(() => Promise.resolve()),
  deleteDoc: vi.fn(() => Promise.resolve()),
  serverTimestamp: vi.fn(() => 'TIMESTAMP'),
  query: vi.fn(),
  where: vi.fn(),
  getDocs: vi.fn(),
  documentId: vi.fn(),
  limit: vi.fn(),
}));

vi.mock('firebase/ai', () => ({
  getAI: vi.fn(),
  getGenerativeModel: vi.fn(),
  AgentPlatformBackend: vi.fn(),
  VertexAIBackend: vi.fn(),
}));

describe('PromptManagement Component', () => {
  let mockPublicCb, mockPrivateCb, mockSharedCb;

  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn(() => true);

    let callCount = 0;
    onSnapshot.mockImplementation((q, cb) => {
      callCount++;
      if (callCount === 1) mockPublicCb = cb;
      else if (callCount === 2) mockPrivateCb = cb;
      else mockSharedCb = cb;
      return vi.fn();
    });
  });

  it('renders prompt list and form, and switches between image, video, and audio tabs', () => {
    render(<PromptManagement />);

    expect(screen.getByText('Manage Prompts')).toBeInTheDocument();
    expect(screen.getByText('Image Prompts')).toBeInTheDocument();
    expect(screen.getByText('Video Prompts')).toBeInTheDocument();
    expect(screen.getByText('Voice / Audio Prompts')).toBeInTheDocument();
    expect(screen.getByText('Translation Prompts')).toBeInTheDocument();

    // Click Video Prompts tab
    fireEvent.click(screen.getByText('Video Prompts'));
    expect(screen.getByText('Video Prompts')).toHaveClass('active');

    // Click Voice / Audio Prompts tab
    fireEvent.click(screen.getByText('Voice / Audio Prompts'));
    expect(screen.getByText('Voice / Audio Prompts')).toHaveClass('active');

    // Click Translation Prompts tab
    fireEvent.click(screen.getByText('Translation Prompts'));
    expect(screen.getByText('Translation Prompts')).toHaveClass('active');
  });

  it('handles creating and saving a translation prompt', async () => {
    render(<PromptManagement />);

    // Switch to Translation Prompts
    fireEvent.click(screen.getByText('Translation Prompts'));
    expect(screen.getByText('Translation Prompts')).toHaveClass('active');

    // Fill in name and prompt text
    fireEvent.change(screen.getByPlaceholderText('Prompt Name'), { target: { value: 'Bilingual CS Translation' } });
    const textarea = document.querySelector('.w-md-editor-text-input');
    fireEvent.change(textarea, { target: { value: 'Translate computer science lecture preserving variable names.' } });

    const saveBtn = screen.getByRole('button', { name: /Save Prompt/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(addDoc).toHaveBeenCalledWith(
        undefined,
        expect.objectContaining({
          name: 'Bilingual CS Translation',
          category: 'translations',
          applyTo: expect.arrayContaining(['Live Subtitles & Translation']),
          owner: 'teacher_1'
        })
      );
    });
    expect(window.alert).toHaveBeenCalledWith('Prompt saved successfully!');
  });

  it('handles creating a new prompt with validation for missing fields', async () => {
    render(<PromptManagement />);

    const saveBtn = screen.getByRole('button', { name: /Save Prompt/i });
    fireEvent.click(saveBtn);
    expect(window.alert).toHaveBeenCalledWith('Please fill in all fields and select at least one application type.');

    // Fill in name and prompt text
    fireEvent.change(screen.getByPlaceholderText('Prompt Name'), { target: { value: 'Code Inspection' } });
    const textarea = document.querySelector('.w-md-editor-text-input');
    fireEvent.change(textarea, { target: { value: 'Inspect code for plagiarism' } });

    // Check an applyTo checkbox
    const perImageCheck = screen.getByLabelText(/Per Image/i);
    fireEvent.click(perImageCheck);

    // Save
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(addDoc).toHaveBeenCalled();
    });
    expect(window.alert).toHaveBeenCalledWith('Prompt saved successfully!');
  });

  it('handles selecting, updating, duplicating, and deleting a prompt', async () => {
    const existingPrompt = {
      id: 'prompt-123',
      name: 'Existing AI Check',
      promptText: 'Analyze student screen for tab switches',
      applyTo: ['Per Image'],
      category: 'images',
      accessLevel: 'private',
      owner: 'teacher_1',
      sharedWith: ['user-2'],
    };

    getDocs.mockResolvedValue({
      docs: [{ id: 'user-2', data: () => ({ email: 'colleague@school.edu' }) }],
    });

    render(<PromptManagement />);

    // Simulate onSnapshot returning existing prompt
    mockPrivateCb({
      docs: [{ id: 'prompt-123', data: () => existingPrompt }],
    });

    // Select the prompt from the list
    const promptItem = await screen.findByText('Existing AI Check');
    fireEvent.click(promptItem);

    // Verify fields populated
    expect(screen.getByPlaceholderText('Prompt Name')).toHaveValue('Existing AI Check');

    // Update prompt
    const updateBtn = screen.getByRole('button', { name: /Save Changes/i });
    fireEvent.click(updateBtn);
    await waitFor(() => {
      expect(updateDoc).toHaveBeenCalled();
    });
    expect(window.alert).toHaveBeenCalledWith('Prompt updated successfully!');

    // Reselect and duplicate prompt
    fireEvent.click(screen.getByText("Existing AI Check"));
    const dupBtn = screen.getByRole('button', { name: /Duplicate/i });
    fireEvent.click(dupBtn);
    expect(screen.getByPlaceholderText('Prompt Name')).toHaveValue('Existing AI Check - Copy');

    // Reselect prompt and delete it
    fireEvent.click(screen.getByText('Existing AI Check'));
    const deleteBtn = await screen.findByRole('button', { name: /Delete/i });
    fireEvent.click(deleteBtn);
    await waitFor(() => {
      expect(deleteDoc).toHaveBeenCalled();
    });
  });

  it('handles sharing with user email and removing shared user', async () => {
    getDocs.mockResolvedValue({
      empty: false,
      docs: [{ id: 'user-colleague', data: () => ({ email: 'ta@school.edu' }) }],
    });

    render(<PromptManagement />);

    // Select Shared radio button
    const sharedRadio = screen.getByDisplayValue('shared');
    fireEvent.click(sharedRadio);

    // Enter email to add
    const emailInput = await screen.findByPlaceholderText('teacher@example.com');
    fireEvent.change(emailInput, { target: { value: 'ta@school.edu' } });

    const addEmailBtn = screen.getByRole('button', { name: 'Add' });
    fireEvent.click(addEmailBtn);

    expect(await screen.findByText('ta@school.edu')).toBeInTheDocument();

    // Remove user
    const removeBtn = screen.getByRole('button', { name: 'Remove' });
    fireEvent.click(removeBtn);
    expect(screen.queryByText('ta@school.edu')).not.toBeInTheDocument();
  });

  it('optimizes prompt using Vertex AI Gemini model and allows undo', async () => {
    const mockGenerateContent = vi.fn().mockResolvedValueOnce({
      response: {
        text: () => '```markdown\n## Guidelines\nOptimized prompt with persona and rules.\n```',
      },
    });
    getGenerativeModel.mockReturnValue({
      generateContent: mockGenerateContent,
    });

    render(<PromptManagement />);

    const textarea = document.querySelector('.w-md-editor-text-input');
    fireEvent.change(textarea, {
      target: { value: 'check cheating' },
    });

    const optimizeBtn = screen.getByRole('button', { name: 'Optimize' });
    fireEvent.click(optimizeBtn);

    await waitFor(() => {
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    // Test Undo button
    const undoBtn = screen.getByRole('button', { name: 'Undo' });
    expect(undoBtn).not.toBeDisabled();
    fireEvent.click(undoBtn);
    expect(textarea).toHaveValue('check cheating');
  });

  it('toggles collapsible sidebar to maximize editor screen', () => {
    render(<PromptManagement />);

    const sidebarToggle = screen.getByRole('button', { name: /Hide List/i });
    expect(sidebarToggle).toBeInTheDocument();

    // Collapse sidebar
    fireEvent.click(sidebarToggle);
    expect(screen.getByRole('button', { name: /Show List/i })).toBeInTheDocument();
    expect(document.querySelector('.prompt-list-column')).toHaveClass('collapsed');

    // Uncollapse sidebar via header button
    fireEvent.click(screen.getByRole('button', { name: /Show List/i }));
    expect(document.querySelector('.prompt-list-column')).not.toHaveClass('collapsed');
  });

  it('toggles distraction-free Zen fullscreen mode', () => {
    render(<PromptManagement />);

    const zenToggle = screen.getByRole('button', { name: /Zen Mode/i });
    expect(zenToggle).toBeInTheDocument();

    // Enable Zen mode
    fireEvent.click(zenToggle);
    expect(screen.getByRole('button', { name: /Exit Zen/i })).toBeInTheDocument();
    expect(document.querySelector('.prompt-studio-view')).toHaveClass('zen-mode-active');
    expect(document.querySelector('.prompt-form-column')).toHaveClass('zen-active');

    // Exit Zen mode
    fireEvent.click(screen.getByRole('button', { name: /Exit Zen/i }));
    expect(document.querySelector('.prompt-studio-view')).not.toHaveClass('zen-mode-active');
    expect(document.querySelector('.prompt-form-column')).not.toHaveClass('zen-active');
  });

  it('toggles scope and permissions accordion drawer', () => {
    render(<PromptManagement />);

    const accordionBtn = screen.getByRole('button', { name: /Scope & Permissions/i });
    expect(accordionBtn).toBeInTheDocument();

    // By default expanded
    expect(document.querySelector('.scope-settings-panel')).toHaveClass('expanded');

    // Collapse
    fireEvent.click(accordionBtn);
    expect(document.querySelector('.scope-settings-panel')).toHaveClass('collapsed');

    // Expand
    fireEvent.click(accordionBtn);
    expect(document.querySelector('.scope-settings-panel')).toHaveClass('expanded');
  });

  it('protects public pre-seeded prompts from direct edits and supports Make a Copy to Personalize', async () => {
    const publicPrompt = {
      id: 'pub-prompt-1',
      name: 'System Default Evaluation',
      promptText: 'Analyze classroom video for teacher actions.',
      applyTo: ['Per Video'],
      category: 'videos',
      accessLevel: 'public',
    };

    render(<PromptManagement />);

    // Feed public prompt
    mockPublicCb({
      docs: [{ id: 'pub-prompt-1', data: () => publicPrompt }],
    });

    // Switch to Video Prompts tab
    fireEvent.click(screen.getByRole('button', { name: 'Video Prompts' }));

    // Select the public prompt
    const promptItem = await screen.findByText('System Default Evaluation');
    fireEvent.click(promptItem);

    // Verify public banner & disabled name input
    expect(screen.getByText(/This is a public prompt and cannot be edited/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Prompt Name')).toBeDisabled();

    // Verify Save Changes is NOT present
    expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();

    // Verify "Make a Copy to Personalize" button is present
    const copyBtn = screen.getByRole('button', { name: /Make a Copy to Personalize/i });
    expect(copyBtn).toBeInTheDocument();

    // Click "Make a Copy to Personalize"
    fireEvent.click(copyBtn);

    // Verify switched to editable copy
    expect(screen.getByPlaceholderText('Prompt Name')).not.toBeDisabled();
    expect(screen.getByPlaceholderText('Prompt Name')).toHaveValue('System Default Evaluation - Copy');
    expect(screen.getByRole('button', { name: /Save Prompt/i })).toBeInTheDocument();
  });

  it('allows instructors to edit their own public prompts while protecting other instructors public prompts', async () => {
    render(<PromptManagement />);

    // Feed a public prompt owned by current teacher, and one owned by another teacher
    mockPublicCb({
      docs: [
        {
          id: 'pub-my',
          data: () => ({
            name: 'My Shared Rubric',
            category: 'images',
            promptText: 'Rubric text authored by me',
            applyTo: ['Per Image'],
            accessLevel: 'public',
            owner: 'teacher_1',
            ownerEmail: 'teacher@school.edu',
            isSystem: false,
          }),
        },
        {
          id: 'pub-other',
          data: () => ({
            name: 'Colleague Shared Rubric',
            category: 'images',
            promptText: 'Rubric text authored by colleague',
            applyTo: ['Per Image'],
            accessLevel: 'public',
            owner: 'other_teacher_456',
            ownerEmail: 'colleague@school.edu',
            isSystem: false,
          }),
        },
      ],
    });

    // 1. Select my own public prompt: should be editable!
    const myItem = await screen.findByText('My Shared Rubric');
    fireEvent.click(myItem);
    expect(screen.getByPlaceholderText('Prompt Name')).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
    expect(screen.getByText(/Public Prompt \(Owned by you/i)).toBeInTheDocument();

    // 2. Select colleague's public prompt: should be read-only!
    const otherItem = await screen.findByText('Colleague Shared Rubric');
    fireEvent.click(otherItem);
    expect(screen.getByPlaceholderText('Prompt Name')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Save Changes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Community Prompt by colleague@school.edu/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Make a Copy to Personalize/i })).toBeInTheDocument();
  });
});


