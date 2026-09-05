import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import TeacherView from './TeacherView';

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  onSnapshot: vi.fn((ref, callback) => {
    callback({
      exists: () => true,
      data: () => ({ classes: ['IT114115-Demo'] }),
    });
    return vi.fn(); // Unsubscribe
  }),
  getDoc: vi.fn(async (ref) => {
    const isNewClass = ref?.path?.includes('cs102-new');
    return {
      id: 'IT114115-Demo',
      exists: () => !isNewClass,
      data: () => ({
        name: 'IT114115 Demo Class',
        storageQuota: 1073741824,
        aiQuota: 50,
        captureMode: 'dual',
      }),
    };
  }),
  doc: vi.fn((db, ...args) => ({ path: args.join('/') })),
  setDoc: vi.fn(async () => {}),
  getFirestore: vi.fn(),
}));

vi.mock('../firebase-config', () => ({
  db: {},
}));

describe('TeacherView Component', () => {
  const mockUser = {
    uid: 'teacher-123',
    email: 'cywong@vtc.edu.hk',
    getIdTokenResult: vi.fn(async () => ({ claims: { role: 'teacher' } })),
  };

  it('renders teacher dashboard and class cards correctly', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/Teacher Command Center/i)).toBeInTheDocument();
      expect(screen.getByText(/IT114115 Demo Class/i)).toBeInTheDocument();
      expect(screen.getByText(/IT114115-Demo/i)).toBeInTheDocument();
    });
  });

  it('filters classes by search term', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Search classes by name or code/i)).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/Search classes by name or code/i);
    fireEvent.change(searchInput, { target: { value: 'Nonexistent' } });

    await waitFor(() => {
      expect(screen.queryByText(/IT114115 Demo Class/i)).not.toBeInTheDocument();
    });
  });

  it('opens and closes the create class modal', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(screen.getByText(/\+ Create New Class/i)).toBeInTheDocument();
    });

    const createBtn = screen.getByText(/\+ Create New Class/i);
    fireEvent.click(createBtn);

    expect(screen.getByPlaceholderText(/e.g. it114115/i)).toBeInTheDocument();

    const cancelBtn = screen.getByText(/Cancel/i);
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/e.g. it114115/i)).not.toBeInTheDocument();
    });
  });

  it('validates class ID format and prevents creating invalid classes', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    const createBtn = await screen.findByText(/\+ Create New Class/i);
    fireEvent.click(createBtn);

    const idInput = screen.getByPlaceholderText(/e.g. it114115/i);
    const submitBtn = screen.getByText(/Create & Configure/i);

    // Too short ID
    fireEvent.change(idInput, { target: { value: 'ab' } });
    fireEvent.click(submitBtn);
    expect(await screen.findByText(/Class ID must be at least 3 characters/i)).toBeInTheDocument();

    // Slashes in ID
    fireEvent.change(idInput, { target: { value: 'class/invalid' } });
    fireEvent.click(submitBtn);
    expect(await screen.findByText(/Class ID cannot contain slashes/i)).toBeInTheDocument();
  });

  it('handles successful class creation and navigates', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    const createBtn = await screen.findByText(/\+ Create New Class/i);
    fireEvent.click(createBtn);

    const idInput = screen.getByPlaceholderText(/e.g. it114115/i);
    const nameInput = screen.getByPlaceholderText(/e.g. Cloud Architecture Practical Lab/i);
    const submitBtn = screen.getByText(/Create & Configure/i);

    fireEvent.change(idInput, { target: { value: 'cs102-new' } });
    fireEvent.change(nameInput, { target: { value: 'Advanced Algorithms' } });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/e.g. it114115/i)).not.toBeInTheDocument();
    });
  });

  it('allows clearing search when no classes match', async () => {
    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    const searchInput = await screen.findByPlaceholderText(/Search classes by name or code/i);
    fireEvent.change(searchInput, { target: { value: 'NonexistentClass' } });

    const clearBtn = await screen.findByRole('button', { name: /Clear Search/i });
    fireEvent.click(clearBtn);

    expect(await screen.findByText(/IT114115 Demo Class/i)).toBeInTheDocument();
  });

  it('shows empty state and triggers create first class modal', async () => {
    const { onSnapshot } = await import('firebase/firestore');
    onSnapshot.mockImplementationOnce((ref, cb) => {
      cb({ exists: () => true, data: () => ({ classes: [] }) });
      return vi.fn();
    });

    render(
      <BrowserRouter>
        <TeacherView user={mockUser} />
      </BrowserRouter>
    );

    const createFirstBtn = await screen.findByRole('button', { name: /\+ Create Your First Class/i });
    fireEvent.click(createFirstBtn);
    expect(screen.getAllByText(/Create New Class/i).length).toBeGreaterThan(0);
  });
});
