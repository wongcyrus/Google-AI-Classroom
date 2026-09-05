import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import IrregularitiesView from './IrregularitiesView';

vi.mock('../firebase-config', () => ({
  storage: {},
  auth: { currentUser: { email: 'teacher@school.edu' } },
}));

const mockGetDownloadURL = vi.fn().mockImplementation((ref) => Promise.resolve(`https://storage.local/${ref.path || 'image.jpg'}`));
vi.mock('firebase/storage', () => ({
  ref: vi.fn((storage, path) => ({ path })),
  getDownloadURL: (...args) => mockGetDownloadURL(...args),
}));

const mockIrregularities = [
  {
    id: 'irreg_1',
    studentEmail: 'student1@school.edu',
    type: 'looking_away',
    title: 'Gaze Deviation',
    message: 'Looking away for 12 seconds',
    screenUrl: 'https://storage.local/screenshots/irreg1_screen.jpg',
    webcamUrl: 'https://storage.local/webcams/irreg1_cam.jpg',
    audioPath: 'https://storage.local/audios/irreg1_audio.wav',
    transcriptSnippet: 'Hey what is the answer to question 3',
    timestamp: { toDate: () => new Date('2026-08-30T10:15:00Z') },
  },
  {
    id: 'irreg_2',
    studentEmail: 'student2@school.edu',
    type: 'no_face',
    title: 'No Face Detected',
    message: 'Face out of camera view',
    imageUrl: 'https://storage.local/screenshots/irreg2.jpg',
    status: 'active',
    timestamp: { toDate: () => new Date('2026-08-30T10:20:00Z') },
  },
];

vi.mock('../hooks/useCollectionQuery', () => ({
  default: () => ({
    data: mockIrregularities,
    loading: false,
    page: 1,
    isLastPage: true,
    fetchNextPage: vi.fn(),
    fetchPrevPage: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('./IncidentDossierExportModal', () => ({
  default: ({ isOpen, onClose }) => (isOpen ? <div data-testid="dossier-modal"><button onClick={onClose}>Close Dossier</button></div> : null),
}));

vi.mock('./AudioTranscriptModal', () => ({
  default: ({ isOpen, onClose }) => (isOpen ? <div data-testid="audio-modal"><button onClick={onClose}>Close Audio</button></div> : null),
}));

describe('IrregularitiesView Full Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-csv');
    URL.revokeObjectURL = vi.fn();
  });

  const renderComponent = (props = {}) => {
    return render(
      <MemoryRouter initialEntries={['/classes/CLASS_101/irregularities']}>
        <Routes>
          <Route path="/classes/:classId/irregularities" element={<IrregularitiesView {...props} />} />
        </Routes>
      </MemoryRouter>
    );
  };

  it('renders irregularities list with filter pills and student records', async () => {
    renderComponent();

    expect(screen.getByText(/Irregularities for Class: CLASS_101/i)).toBeInTheDocument();
    expect(screen.getByText('student1@school.edu')).toBeInTheDocument();
    expect(screen.getByText('Gaze Deviation')).toBeInTheDocument();
    expect(screen.getByText('student2@school.edu')).toBeInTheDocument();
    expect(screen.getByText('No Face Detected')).toBeInTheDocument();
  });

  it('allows switching period presets and applying custom range', () => {
    renderComponent();

    const todayBtn = screen.getByRole('button', { name: /Today/i });
    fireEvent.click(todayBtn);

    const customBtn = screen.getByRole('button', { name: /Custom Range.../i });
    fireEvent.click(customBtn);

    expect(screen.getByText(/From:/i)).toBeInTheDocument();
    expect(screen.getByText(/To:/i)).toBeInTheDocument();

    const applyBtn = screen.getByRole('button', { name: /Apply Filter/i });
    fireEvent.click(applyBtn);
  });

  it('opens dossier export modal and quick CSV export', () => {
    renderComponent();

    const dossierBtn = screen.getByRole('button', { name: /Export Formal Dossier/i });
    fireEvent.click(dossierBtn);

    expect(screen.getByTestId('dossier-modal')).toBeInTheDocument();

    const closeBtn = screen.getByRole('button', { name: /Close Dossier/i });
    fireEvent.click(closeBtn);
    expect(screen.queryByTestId('dossier-modal')).not.toBeInTheDocument();

    const csvBtn = screen.getByRole('button', { name: /Quick CSV Page/i });
    fireEvent.click(csvBtn);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('opens dual media evidence viewer modal when thumbnail is clicked and interacts with audio modal', async () => {
    renderComponent();

    await waitFor(() => {
      const dualContainers = document.querySelectorAll('.dual-thumbnail-container');
      expect(dualContainers.length).toBeGreaterThan(0);
      fireEvent.click(dualContainers[0]);
    });

    await waitFor(() => {
      expect(screen.getByText(/Irregularity Evidence:/i)).toBeInTheDocument();
      expect(screen.getByAltText('Screen Evidence')).toBeInTheDocument();
      expect(screen.getByAltText('Webcam Evidence')).toBeInTheDocument();
    });

    const openAudioBtn = screen.getByRole('button', { name: /Diarization Timeline & Seek/i });
    fireEvent.click(openAudioBtn);

    expect(screen.getByTestId('audio-modal')).toBeInTheDocument();
    const closeAudioBtn = screen.getByRole('button', { name: /Close Audio/i });
    fireEvent.click(closeAudioBtn);
    expect(screen.queryByTestId('audio-modal')).not.toBeInTheDocument();

    const closeSpan = document.querySelector('.media-player-modal .close');
    fireEvent.click(closeSpan);
    expect(screen.queryByText(/Irregularity Evidence:/i)).not.toBeInTheDocument();
  });
});
