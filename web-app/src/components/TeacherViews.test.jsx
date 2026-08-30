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
  getDoc: vi.fn(async (ref) => ({
    id: 'IT114115-Demo',
    exists: () => true,
    data: () => ({
      name: 'IT114115 Demo Class',
      storageQuota: 1073741824,
      aiQuota: 50,
      captureMode: 'dual',
    }),
  })),
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

    expect(screen.getByPlaceholderText(/e.g. IT114115/i)).toBeInTheDocument();

    const cancelBtn = screen.getByText(/Cancel/i);
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/e.g. IT114115/i)).not.toBeInTheDocument();
    });
  });
});
