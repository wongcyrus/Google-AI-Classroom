import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IrregularitiesView from './IrregularitiesView';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../firebase-config', () => ({
  storage: {},
  db: {},
  auth: { currentUser: { uid: 'teacher_1', email: 'teacher@example.com' } },
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(),
  getDownloadURL: vi.fn().mockResolvedValue('https://mockstorage.local/media.jpg'),
}));

const mockIrregularitiesData = [
  {
    id: 'irreg_1',
    title: 'Multiple Voices Detected',
    message: 'Secondary person speaking during test',
    studentEmail: 'student@example.com',
    type: 'audio',
    riskLevel: 'high',
    transcriptSnippet: 'Hey what did you get for question 2?',
    audioUrl: 'https://mockstorage.local/audio.webm',
    screenUrl: 'https://mockstorage.local/screen.jpg',
    webcamUrl: 'https://mockstorage.local/webcam.jpg',
    timestamp: { toDate: () => new Date('2026-08-29T10:30:00Z') },
  },
];

vi.mock('../hooks/useCollectionQuery', () => ({
  default: vi.fn(() => ({
    data: mockIrregularitiesData,
    loading: false,
    page: 1,
    isLastPage: true,
    fetchNextPage: vi.fn(),
    fetchPrevPage: vi.fn(),
    refetch: vi.fn(),
  })),
}));

describe('IrregularitiesView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders irregularities table and audio/evidence tags', async () => {
    render(
      <MemoryRouter initialEntries={['/classes/TEST-101/irregularities']}>
        <Routes>
          <Route path="/classes/:classId/irregularities" element={<IrregularitiesView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText('Multiple Voices Detected')).toBeInTheDocument();
    expect(screen.getByText(/student@example.com/i)).toBeInTheDocument();
    expect(screen.getByText(/Secondary person speaking during test/i)).toBeInTheDocument();
  });

  it('opens dual media player modal when clicking media thumbnail and closes on close button', async () => {
    render(
      <MemoryRouter initialEntries={['/classes/TEST-101/irregularities']}>
        <Routes>
          <Route path="/classes/:classId/irregularities" element={<IrregularitiesView />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      const mediaThumbs = screen.getAllByRole('img');
      expect(mediaThumbs.length).toBeGreaterThan(0);
      fireEvent.click(mediaThumbs[0]);
    });

    expect(screen.getByText(/🚨 Irregularity Evidence: Multiple Voices Detected/i)).toBeInTheDocument();
    expect(screen.getByText(/Hey what did you get for question 2\?/i)).toBeInTheDocument();

    const closeBtn = screen.getByText('×');
    fireEvent.click(closeBtn);
    expect(screen.queryByText(/🚨 Irregularity Evidence:/i)).toBeNull();
  });

  it('renders period filter bar and switches period presets', async () => {
    render(
      <MemoryRouter initialEntries={['/classes/TEST-101/irregularities']}>
        <Routes>
          <Route path="/classes/:classId/irregularities" element={<IrregularitiesView />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByText(/⏱️ Scope \/ Period:/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All Sessions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Past 24h' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Past 7 Days' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom Range...' })).toBeInTheDocument();

    // Click Custom Range preset
    const customBtn = screen.getByRole('button', { name: 'Custom Range...' });
    fireEvent.click(customBtn);

    expect(screen.getByText('From:')).toBeInTheDocument();
    expect(screen.getByText('To:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Filter' })).toBeInTheDocument();
  });
});
