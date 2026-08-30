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
});
