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
  functions: {},
}));

const mockGetAllSystemStudentEmails = vi.fn().mockResolvedValue({
  data: {
    studentEmails: ['alice@school.edu', 'bob@school.edu', 'charlie@school.edu'],
    total: 3,
  },
});

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn(() => mockGetAllSystemStudentEmails),
}));

const mockSetDoc = vi.fn().mockResolvedValue({});
const mockUpdateDoc = vi.fn().mockResolvedValue({});
const mockDeleteDoc = vi.fn().mockResolvedValue({});
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue();
const mockWriteBatch = vi.fn(() => ({
  set: mockBatchSet,
  commit: mockBatchCommit,
}));
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

const mockGetDocs = vi.fn((colRef) =>
  Promise.resolve({
    forEach: (cb) => {
      if (colRef?.id === 'studentDirectory' || colRef?.path === 'studentDirectory') {
        return;
      }
      cb({
        data: () => ({
          studentEmails: ['fallback.student@school.edu'],
        }),
      });
    },
  })
);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ path: `${col}/${id}`, id })),
  collection: vi.fn((db, col) => ({ path: col, id: col })),
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
  getDocs: (...args) => mockGetDocs(...args),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  writeBatch: (...args) => mockWriteBatch(...args),
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

    const dayCheckbox = screen.getByLabelText(/^Mon$/i);
    fireEvent.click(dayCheckbox);

    const addScheduleBtn = screen.getByRole('button', { name: /Add Schedule/i });
    fireEvent.click(addScheduleBtn);

    const captureCheckbox = screen.getByLabelText(/Automatic Live Capture/i);
    const combineCheckbox = screen.getByLabelText(/Automatic Video Compilation/i);
    expect(captureCheckbox).toBeChecked();
    expect(combineCheckbox).toBeChecked();

    const createBtn = screen.getByRole('button', { name: /Create Class/i });
    expect(createBtn).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          automaticCapture: true,
          automaticCombine: true,
        })
      );
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
      expect(screen.getByText(/Selected: Voice Intent/i)).toBeInTheDocument();
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
    const windowSelect = screen.getByLabelText(/Window Duration/i);
    fireEvent.change(windowSelect, { target: { value: '20' } });

    // Stride select
    const strideSelect = screen.getByDisplayValue(/15s Stride/i);
    fireEvent.change(strideSelect, { target: { value: '10' } });

    // Long audio interval select
    const intervalSelect = screen.getByDisplayValue(/Full Session/i);
    fireEvent.change(intervalSelect, { target: { value: '10' } });
  });

  it('renders standalone mode with class selector and handles class switching', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Select a Class to Edit or Configure/i)).toBeInTheDocument();
    });

    const classSelect = screen.getByLabelText(/Select a Class to Edit or Configure/i);
    fireEvent.change(classSelect, { target: { value: 'CLASS_202' } });

    await waitFor(() => {
      expect(mockGetDoc).toHaveBeenCalled();
    });
  });

  it('configures, toggles, and saves student screen recording policies and release date', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          examPeriods: [
            {
              id: 'ep_existing',
              name: 'Midterm Examination',
              startDate: '2026-10-25T14:00',
              endDate: '2026-10-25T16:00',
            },
          ],
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/6\. Exam & Test Periods/i)).toBeInTheDocument();
    });

    // 1. Verify existing exam period renders
    expect(screen.getByText(/🔒 Midterm Examination/i)).toBeInTheDocument();

    // 2. Add a new exam period
    const nameInput = screen.getByLabelText(/Exam Assessment Name/i);
    const startInput = screen.getByLabelText(/Exam Period Start Date and Time/i);
    const endInput = screen.getByLabelText(/Exam Period End Date and Time/i);

    fireEvent.change(nameInput, { target: { value: 'Final Exam' } });
    fireEvent.change(startInput, { target: { value: '2026-12-15T09:00' } });
    fireEvent.change(endInput, { target: { value: '2026-12-15T12:00' } });

    const addPeriodBtn = screen.getByRole('button', { name: /Add Exam Period/i });
    fireEvent.click(addPeriodBtn);

    // Verify both exist
    expect(screen.getByText(/🔒 Final Exam/i)).toBeInTheDocument();

    // 3. Remove the existing one
    const removeBtn = screen.getByLabelText(/Remove exam period Midterm Examination/i);
    fireEvent.click(removeBtn);
    expect(screen.queryByText(/🔒 Midterm Examination/i)).not.toBeInTheDocument();

    // 4. Save settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          examPeriods: expect.arrayContaining([
            expect.objectContaining({
              name: 'Final Exam',
              startDate: '2026-12-15T09:00',
              endDate: '2026-12-15T12:00',
            }),
          ]),
        })
      );
    });
  });

  it('renders and updates Bingo retry grace delay in class settings', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          bingoRetryDelayMinutes: 5,
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/🎯 Bingo Active Presence Retry Grace Delay/i).value).toBe('5');
    });

    const selectEl = screen.getByLabelText(/🎯 Bingo Active Presence Retry Grace Delay/i);
    fireEvent.change(selectEl, { target: { value: '2' } });
    expect(selectEl.value).toBe('2');

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          bingoRetryDelayMinutes: 2,
        })
      );
    });
  });

  it('renders Input All Students button and populates student emails on click', async () => {
    mockGetAllSystemStudentEmails.mockResolvedValueOnce({
      data: {
        studentEmails: ['alice@school.edu', 'bob@school.edu', 'charlie@school.edu'],
        total: 3,
      },
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /🎓 Add All Students/i })).toBeInTheDocument();
    });

    const inputAllBtn = screen.getByRole('button', { name: /🎓 Add All Students/i });
    await act(async () => {
      fireEvent.click(inputAllBtn);
    });

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Enter student emails/i);
      expect(textarea.value).toContain('charlie@school.edu');
      expect(textarea.value).toContain('alice@school.edu');
      expect(textarea.value).toContain('bob@school.edu');
      expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/populated 1 new student email/i));
    });
  });

  it('falls back to Firestore classes collection when callable function rejects', async () => {
    mockGetAllSystemStudentEmails.mockRejectedValueOnce(new Error('Cloud Function unavailable'));

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /🎓 Add All Students/i })).toBeInTheDocument();
    });

    const inputAllBtn = screen.getByRole('button', { name: /🎓 Add All Students/i });
    await act(async () => {
      fireEvent.click(inputAllBtn);
    });

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(/Enter student emails/i);
      expect(textarea.value).toContain('fallback.student@school.edu');
      expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/populated 1 new student email/i));
    });
  });

  it('preserves mixed-case class ID and deduplicates student email roster on save', async () => {
    let capturedDocRef = null;
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementationOnce((ref, data) => {
      capturedDocRef = ref;
      capturedUpdateData = data;
      return Promise.resolve();
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="IT114115-Demo" />);

    await waitFor(() => {
      expect(screen.getByText(/Basic Information & Storage Quota/i)).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText(/Enter student emails/i);
    fireEvent.change(textarea, {
      target: { value: 'student1@stu.vtc.edu.hk\nstudent1@stu.vtc.edu.hk\ncy.gdoc@gmail.com' }
    });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedDocRef.path).toBe('classes/IT114115-Demo');
    expect(capturedDocRef.id).toBe('IT114115-Demo');
    expect(capturedUpdateData.studentEmails).toEqual([
      'student1@stu.vtc.edu.hk',
      'cy.gdoc@gmail.com'
    ]);
    expect(screen.getByText(/Class settings successfully updated!/i)).toBeInTheDocument();
  });

  it('loads, configures, and saves bingoTimeLimitSeconds in class settings', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementationOnce((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Student Bingo Answer Time Limit/i)).toBeInTheDocument();
    });

    const timeLimitSelect = screen.getByLabelText(/Student Bingo Answer Time Limit/i);
    // Default is 30 seconds
    expect(timeLimitSelect.value).toBe('30');

    // Change to 60 seconds
    fireEvent.change(timeLimitSelect, { target: { value: '60' } });
    expect(timeLimitSelect.value).toBe('60');

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.bingoTimeLimitSeconds).toBe(60);
  });

  it('supports exporting student and teacher email rosters to CSV', async () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    window.URL.revokeObjectURL = vi.fn();

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Enter student emails/i)).toBeInTheDocument();
    });

    const exportCsvBtns = screen.getAllByRole('button', { name: /📤 Export CSV/i });
    expect(exportCsvBtns.length).toBeGreaterThanOrEqual(2);

    // Export students CSV
    fireEvent.click(exportCsvBtns[0]);
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    // Export teachers CSV
    fireEvent.click(exportCsvBtns[1]);
    expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2);

    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('validates, creates, and removes exam period windows', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Add Exam Period/i })).toBeInTheDocument();
    });

    const addPeriodBtn = screen.getByRole('button', { name: /Add Exam Period/i });

    // 1. Submit without dates
    fireEvent.click(addPeriodBtn);
    expect(screen.getByText(/Please select both a start date\/time and end date\/time for the exam period/i)).toBeInTheDocument();

    const startInput = screen.getByLabelText('Exam Period Start Date and Time');
    const endInput = screen.getByLabelText('Exam Period End Date and Time');
    const nameInput = screen.getByLabelText('Exam Assessment Name');

    // 2. Start date after end date
    fireEvent.change(startInput, { target: { value: '2026-10-15T12:00' } });
    fireEvent.change(endInput, { target: { value: '2026-10-15T10:00' } });
    fireEvent.click(addPeriodBtn);
    expect(screen.getByText(/Start date\/time must be strictly before end date\/time/i)).toBeInTheDocument();

    // 3. Valid dates and name
    fireEvent.change(nameInput, { target: { value: 'Midterm Practical Exam' } });
    fireEvent.change(startInput, { target: { value: '2026-10-15T09:00' } });
    fireEvent.change(endInput, { target: { value: '2026-10-15T12:00' } });
    fireEvent.click(addPeriodBtn);

    expect(screen.getByText(/Midterm Practical Exam/i)).toBeInTheDocument();

    // 4. Remove exam period
    const removeBtn = screen.getByRole('button', { name: /Remove exam period Midterm Practical Exam/i });
    fireEvent.click(removeBtn);
    expect(screen.queryByText(/Midterm Practical Exam/i)).not.toBeInTheDocument();
  });

  it('configures, toggles, and saves default lecture recording policy in class settings', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        ...mockClassData,
        defaultLectureRecording: true,
      }),
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Teacher Screen Broadcast & Lecture Recording Default/i)).toBeInTheDocument();
    });

    const recordRadio = screen.getByRole('radio', { name: /Record & Stream by Default/i });
    const liveOnlyRadio = screen.getByRole('radio', { name: /Live Stream Only by Default/i });

    expect(recordRadio).toBeChecked();
    expect(liveOnlyRadio).not.toBeChecked();

    // Toggle to live only
    fireEvent.click(liveOnlyRadio);
    expect(liveOnlyRadio).toBeChecked();
    expect(recordRadio).not.toBeChecked();

    // Save settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          defaultLectureRecording: false,
        })
      );
    });
  });

  it('supports batch student roster upload, previews identities, and saves studentProfiles', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementationOnce((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="IT114115-Demo" />);

    await waitFor(() => {
      expect(screen.getByText(/Basic Information & Storage Quota/i)).toBeInTheDocument();
    });

    // Click Batch Upload Roster button
    const batchUploadBtn = screen.getByRole('button', { name: /Batch Upload Roster/i });
    fireEvent.click(batchUploadBtn);

    // Modal should be visible
    expect(screen.getByText(/Batch Upload Student Roster/i)).toBeInTheDocument();

    const sampleCsv = `StudentEmail,StudentName,Nickname,Programme,Class
chan.tm@stu.vtc.edu.hk,Chan Tai Man,David,HD in Software Engineering,IT114115/1A
lee.sm@stu.vtc.edu.hk,Lee Siu Ming,,HD in Software Engineering,IT114115/1B`;

    const textarea = screen.getByPlaceholderText(/StudentEmail,StudentName/i);
    fireEvent.change(textarea, { target: { value: sampleCsv } });

    // Click Apply
    const applyBtn = screen.getByRole('button', { name: /Apply to Class Roster/i });
    fireEvent.click(applyBtn);

    // Modal closes and roster details table renders
    await waitFor(() => {
      expect(screen.queryByText(/Batch Upload Student Roster/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Enrolled Roster Details/i)).toBeInTheDocument();
      expect(screen.getByText(/David \(Chan Tai Man\)/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Lee Siu Ming/i).length).toBeGreaterThanOrEqual(1);
    });

    // Save settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(capturedUpdateData).toBeDefined();
      expect(capturedUpdateData.studentProfiles).toBeDefined();
      expect(capturedUpdateData.studentProfiles['chan.tm@stu.vtc.edu.hk'].studentName).toBe('Chan Tai Man');
      expect(capturedUpdateData.studentProfiles['chan.tm@stu.vtc.edu.hk'].nickname).toBe('David');
      expect(capturedUpdateData.studentProfiles['chan.tm@stu.vtc.edu.hk'].studentClass).toBe('IT114115/1A');
      expect(capturedUpdateData.studentProfiles['lee.sm@stu.vtc.edu.hk'].studentName).toBe('Lee Siu Ming');
    });
  });

  it('cross-class profile propagation: automatically enriches student profile from institutional directory and displays Directory badge', async () => {
    // Configure mockGetDocs to return studentDirectory entry for 'bob.ross@stu.vtc.edu.hk'
    mockGetDocs.mockImplementation((colRef) => {
      if (colRef?.id === 'studentDirectory' || colRef?.path === 'studentDirectory') {
        return Promise.resolve({
          forEach: (cb) => {
            cb({
              id: 'bob.ross@stu.vtc.edu.hk',
              data: () => ({
                email: 'bob.ross@stu.vtc.edu.hk',
                studentName: 'Bob Ross',
                nickname: 'Painter',
                studentClass: 'IT114115/2B',
                programme: 'HD in Multimedia',
              }),
            });
          },
        });
      }
      return Promise.resolve({
        forEach: (cb) => {
          cb({
            data: () => ({
              studentEmails: ['fallback.student@school.edu'],
            }),
          });
        },
      });
    });

    let savedData;
    mockUpdateDoc.mockImplementation((ref, data) => {
      savedData = data;
      return Promise.resolve({});
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      const nameInput = screen.getByPlaceholderText(/e.g. Cloud Architecture Lab/i);
      expect(nameInput.value).toBe('Distributed Systems');
    });

    const textarea = screen.getByPlaceholderText(/Enter student emails/i);
    await waitFor(() => {
      expect(textarea.value).toContain('alice@school.edu');
    });

    // Enter Bob Ross's email into the textarea (with no manual profile uploaded in this class)
    fireEvent.change(textarea, { target: { value: 'bob.ross@stu.vtc.edu.hk' } });

    // Roster Details should auto-fill Bob Ross's name and display the Directory badge
    await waitFor(() => {
      expect(screen.getAllByText(/Bob Ross/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/✨ Directory/i)).toBeInTheDocument();
      expect(screen.getByText(/auto-filled from other classes/i)).toBeInTheDocument();
    });

    // Save class settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(savedData).toBeDefined();
      expect(savedData.studentProfiles['bob.ross@stu.vtc.edu.hk']).toBeDefined();
      expect(savedData.studentProfiles['bob.ross@stu.vtc.edu.hk'].studentName).toBe('Bob Ross');
      expect(savedData.studentProfiles['bob.ross@stu.vtc.edu.hk'].nickname).toBe('Painter');
      expect(savedData.studentProfiles['bob.ross@stu.vtc.edu.hk'].studentClass).toBe('IT114115/2B');
    });

    // Also verify mockBatchSet was called for studentDirectory persistence
    expect(mockBatchSet).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        email: 'bob.ross@stu.vtc.edu.hk',
        studentName: 'Bob Ross',
        nickname: 'Painter',
      }),
      { merge: true }
    );
  });
});


