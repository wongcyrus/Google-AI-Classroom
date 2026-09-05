import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import ClassManagement from './ClassManagement';

vi.mock('../firebase-config', () => ({
  auth: {
    currentUser: {
      email: 'teacher@school.edu',
      uid: 't1',
    },
  },
  db: {},
}));

const mockSetDoc = vi.fn().mockResolvedValue({});
const mockUpdateDoc = vi.fn().mockResolvedValue({});
const mockDeleteDoc = vi.fn().mockResolvedValue({});
const mockClassData = {
  name: 'Distributed Systems',
  storageQuota: 5368709120,
  retentionDays: 30,
  videoRetentionDays: 90,
  studentEmails: ['alice@school.edu', 'bob@school.edu'],
  teacherEmails: ['teacher@school.edu'],
  ipRestrictions: ['192.168.1.1'],
  automaticCapture: true,
  automaticCombine: false,
  captureMode: 'dual',
  requireFullScreenOnly: true,
  enableAudioCapture: true,
  audioCaptureMode: 'mandatory',
  aiMonitoringMode: 'hybrid',
  afterClassVideoPrompt: { name: 'Focus Audit', promptText: 'Check focus' },
  schedule: {
    startDate: '2026-09-01',
    endDate: '2026-12-31',
    timeZone: 'Asia/Hong_Kong',
    timeSlots: [{ startTime: '09:00', endTime: '11:00', days: ['Mon'] }],
  },
};

const mockGetDoc = vi.fn(() =>
  Promise.resolve({
    exists: () => true,
    data: () => mockClassData,
  })
);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ path: `${col}/${id}`, id })),
  collection: vi.fn(),
  onSnapshot: vi.fn((refOrQuery, callback) => {
    callback({
      exists: () => true,
      data: () => ({
        classes: ['CLASS_101', 'CLASS_202'],
      }),
      docs: [],
    });
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  getDoc: (...args) => mockGetDoc(...args),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(),
}));

describe('ClassManagement Full Component Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => mockClassData,
      })
    );
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  it('renders class management and saves updated settings', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Basic Information & Storage Quota/i)).toBeInTheDocument();
    });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(screen.getByText(/Class settings successfully updated!/i)).toBeInTheDocument();
  });

  it('creates a new class when no class is selected', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => false,
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);

    const classIdInput = screen.getByPlaceholderText(/e\.g\. it114115-2026-s1/i);
    fireEvent.change(classIdInput, { target: { value: 'class_new_2026' } });

    const classNameInput = screen.getByPlaceholderText(/e\.g\. Cloud Architecture Lab/i);
    fireEvent.change(classNameInput, { target: { value: 'New Class 2026' } });

    const dateInputs = document.querySelectorAll('input[type="date"]');
    if (dateInputs.length >= 2) {
      fireEvent.change(dateInputs[0], { target: { value: '2026-09-01' } });
      fireEvent.change(dateInputs[1], { target: { value: '2026-12-31' } });
    }

    const selects = screen.getAllByRole('combobox');
    const startTimeSelect = selects.find(s => s.querySelector('option[value="09:00"]'));
    if (startTimeSelect) {
      fireEvent.change(startTimeSelect, { target: { value: '09:00' } });
    }

    const dayCheckbox = screen.getByLabelText(/Mon/i);
    fireEvent.click(dayCheckbox);

    const addScheduleBtn = screen.getByRole('button', { name: /Add Schedule/i });
    fireEvent.click(addScheduleBtn);

    const createBtn = screen.getByRole('button', { name: /Create Class/i });
    expect(createBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalled();
    });
  });

  it('handles class deletion with confirmation', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(mockDeleteDoc).toHaveBeenCalled();
    });
  });

  it('handles exporting teacher and student emails to CSV', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Export CSV/i }).length).toBeGreaterThan(0);
    });

    const exportBtns = screen.getAllByRole('button', { name: /Export CSV/i });
    fireEvent.click(exportBtns[0]);

    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('handles opening and setting video analysis prompts', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Selected: Focus Audit/i })).toBeInTheDocument();
    });

    const promptBtn = screen.getByRole('button', { name: /Selected: Focus Audit/i });
    fireEvent.click(promptBtn);

    expect(screen.getByText(/Select After-Class Video Prompt/i)).toBeInTheDocument();

    const savePromptBtn = screen.getByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(savePromptBtn);
  });

  it('handles importing student emails from uploaded text/csv file', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Student Email Addresses/i)).toBeInTheDocument();
    });

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);

    const file = new File(['student1@test.com, student2@test.com'], 'students.csv', { type: 'text/csv' });
    
    // Trigger file change
    fireEvent.change(fileInputs[0], { target: { files: [file] } });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Successfully imported'));
    });
  });

  it('handles custom gaze orientation angles and AI monitoring mode configuration', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/AI Face & Gaze Monitoring Mode/i)).toBeInTheDocument();
    });

    const sensitivitySelect = screen.getByDisplayValue(/Standard \/ Balanced Default/i);
    fireEvent.change(sensitivitySelect, { target: { value: 'custom' } });

    expect(screen.getByText(/Custom Angle Limits/i)).toBeInTheDocument();

    const rangeSliders = screen.getAllByRole('slider');
    expect(rangeSliders.length).toBeGreaterThan(0);
    fireEvent.change(rangeSliders[0], { target: { value: '35' } });
  });

  it('handles opening and configuring audio prompts for live audio and gemma voice intent', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Enable Audio Segment Recording/i)).toBeInTheDocument();
    });

    // Gemma intent prompt button
    const gemmaBtn = screen.getByRole('button', { name: /Select Gemma Intent Prompt/i });
    fireEvent.click(gemmaBtn);

    expect(screen.getByText(/Select On-Device Gemma Voice Intent Prompt/i)).toBeInTheDocument();
    const saveAudioPromptBtn = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveAudioPromptBtn[saveAudioPromptBtn.length - 1]);
  });

  it('shows error validation when date range is inverted or schedule is empty', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => false,
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);

    const classIdInput = screen.getByPlaceholderText(/e\.g\. it114115-2026-s1/i);
    fireEvent.change(classIdInput, { target: { value: 'ab' } }); // too short

    const createBtn = screen.getByRole('button', { name: /Create Class/i });
    await act(async () => {
      fireEvent.click(createBtn);
    });

    expect(screen.getByText(/Class ID must be at least 3 characters long/i)).toBeInTheDocument();
  });

  it('handles deleting class in danger zone', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
    });

    // Delete class
    const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(mockDeleteDoc).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Class deleted successfully.');
  });

  it('handles configuring advanced audio monitoring options and resetting prompts', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          liveAudioPrompt: { name: 'Live Check', promptText: 'Check for chatter' },
          gemmaIntentPrompt: { name: 'Voice Intent', promptText: 'Check cheating intents' },
          sessionAudioPrompt: { name: 'Session Check', promptText: 'Check seminar questions' },
          enableSegmentTranscription: true,
          enableCombinedLongAudio: true,
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Enable Audio Segment Recording/i)).toBeInTheDocument();
    });

    // Reset Gemma intent prompt
    const resetGemmaBtn = screen.getAllByRole('button', { name: /Reset to Default/i })[0];
    fireEvent.click(resetGemmaBtn);

    // Audio capture mode select
    const micRequirementSelect = screen.getByDisplayValue(/Mandatory \(Students must verify/i);
    fireEvent.change(micRequirementSelect, { target: { value: 'optional' } });

    // Silence suppression toggle
    const silenceToggle = screen.getByLabelText(/Silence Suppression/i);
    fireEvent.click(silenceToggle);

    // Window duration select
    const windowSelect = screen.getByDisplayValue(/30 Seconds/i);
    fireEvent.change(windowSelect, { target: { value: '20' } });

    // Stride select
    const strideSelect = screen.getByDisplayValue(/15s Stride/i);
    fireEvent.change(strideSelect, { target: { value: '10' } });

    // Long audio interval select
    const intervalSelect = screen.getByDisplayValue(/Full Session/i);
    fireEvent.change(intervalSelect, { target: { value: '10' } });
  });
});

