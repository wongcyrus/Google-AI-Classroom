import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import ClassManagement from './ClassManagement';
import { exportStudentRosterExcel } from '../utils/studentDisplayUtils';

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

const mockResetStudentPasskey = vi.fn().mockResolvedValue({ data: { success: true } });
const mockApproveTeacherPasskeyBypass = vi.fn().mockResolvedValue({ data: { success: true } });
const mockToggleStudentExemption = vi.fn().mockResolvedValue({ data: { success: true } });

vi.mock('firebase/functions', () => ({
  httpsCallable: vi.fn((_functions, name) => {
    if (name === 'resetStudentPasskey') return mockResetStudentPasskey;
    if (name === 'approveTeacherPasskeyBypass') return mockApproveTeacherPasskeyBypass;
    if (name === 'toggleStudentExemption') return mockToggleStudentExemption;
    return mockGetAllSystemStudentEmails;
  }),
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
          tags: ['CS101', 'CloudArchitecture'],
          studentProfiles: {
            'alice@school.edu': {
              studentName: 'Alice Alison',
              nickname: 'Ali',
              programme: 'BEng Computer Science',
              studentClass: 'Year 2',
            },
          },
        }),
      });
    },
    docs: [
      {
        id: 'doc1',
        data: () => ({
          studentEmails: ['fallback.student@school.edu'],
          tags: ['CS101', 'CloudArchitecture'],
          studentProfiles: {
            'alice@school.edu': {
              studentName: 'Alice Alison',
              nickname: 'Ali',
              programme: 'BEng Computer Science',
              studentClass: 'Year 2',
            },
          },
        }),
      },
    ],
  })
);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id) => ({ path: `${col}/${id}`, id })),
  collection: vi.fn((db, ...pathSegments) => ({
    path: pathSegments.join('/'),
    id: pathSegments[pathSegments.length - 1],
  })),
  onSnapshot: vi.fn((refOrQuery, callback) => {
    if (refOrQuery?.path?.includes('studentPasskeys')) {
      callback({
        forEach: (cb) => {
          cb({
            id: 'passkey_alice',
            data: () => ({
              studentEmail: 'alice@school.edu',
              studentUid: 'alice_uid',
              registeredAt: '2026-09-20T00:00:00Z',
            }),
          });
        },
        docs: [
          {
            id: 'passkey_alice',
            data: () => ({
              studentEmail: 'alice@school.edu',
              studentUid: 'alice_uid',
              registeredAt: '2026-09-20T00:00:00Z',
            }),
          },
        ],
      });
      return () => {};
    }
    if (refOrQuery?.path?.includes('prompts')) {
      callback({
        docs: [
          {
            id: 'sample_video_prompt',
            data: () => ({
              name: 'Focus Audit Standard',
              promptText: 'Analyze attention and eye gaze carefully',
              accessLevel: 'public',
              category: 'videos',
            }),
          },
          {
            id: 'sample_audio_prompt',
            data: () => ({
              name: 'Invigilation Audio Standard',
              promptText: 'Detect abnormal speech or communication',
              accessLevel: 'public',
              category: 'audios',
            }),
          },
          {
            id: 'sample_translation_prompt',
            data: () => ({
              name: 'Subtitle Prompt Standard',
              promptText: 'Translate verbatim into Cantonese',
              accessLevel: 'public',
              category: 'translations',
            }),
          },
          {
            id: 'sample_image_prompt',
            data: () => ({
              name: 'Presence Check Standard',
              promptText: 'Verify student face is in frame',
              accessLevel: 'public',
              category: 'images',
            }),
          },
        ],
      });
      return () => {};
    }
    callback({
      exists: () => true,
      data: () => ({
        classes: ['CLASS_101', 'CLASS_202'],
      }),
      docs: [],
    });
    return () => {};
  }),
  query: vi.fn((colRef) => colRef || { path: 'query' }),
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

  it('handles exporting teacher and student emails to Excel', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /Export (Excel|CSV)/i }).length).toBeGreaterThan(0);
    });

    const exportBtns = screen.getAllByRole('button', { name: /Export (Excel|CSV)/i });
    await act(async () => {
      fireEvent.click(exportBtns[0]);
    });

    await waitFor(() => {
      expect(URL.createObjectURL).toHaveBeenCalled();
    });
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

  it('configures and saves lecture subtitles enabled toggle, prompt, and target languages', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Automated AI Transcription & Multilingual Subtitles \(CC\)/i)).toBeInTheDocument();
    });

    // Check subtitle toggle is present and defaults to checked
    const subtitleCheckbox = screen.getByRole('checkbox', { name: /Automated AI Transcription & Multilingual Subtitles/i });
    expect(subtitleCheckbox).toBeInTheDocument();
    expect(subtitleCheckbox).toBeChecked();

    // Toggle off
    fireEvent.click(subtitleCheckbox);
    expect(subtitleCheckbox).not.toBeChecked();

    // Verify duplicate block from Section 5 is removed
    expect(screen.queryByText(/configured in Section 5 below/i)).not.toBeInTheDocument();

    // Verify default prompts active badges in Section 9
    expect(screen.getByText(/Default STT Active/i)).toBeInTheDocument();
    expect(screen.getByText(/Default Translation Active/i)).toBeInTheDocument();

    // Check STT prompt selector button
    const promptBtn = screen.getByRole('button', { name: /Lecture Audio Speech-to-Text/i });
    expect(promptBtn).toBeInTheDocument();
    fireEvent.click(promptBtn);

    // Audio prompt modal should open with Lecture STT title
    expect(screen.getByText(/Select Lecture Audio Speech-to-Text & Chapters Prompt/i)).toBeInTheDocument();

    const savePromptBtn = screen.getByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(savePromptBtn);

    // Check Translation prompt selector button
    const transPromptBtn = screen.getByRole('button', { name: /Lecture Subtitle & Terminology Translator/i });
    expect(transPromptBtn).toBeInTheDocument();
    fireEvent.click(transPromptBtn);

    // Translation prompt modal should open
    expect(screen.getByText(/Select Lecture Subtitle Translation Prompt/i)).toBeInTheDocument();

    const saveTransPromptBtn = screen.getAllByRole('button', { name: /Save Prompt Selection/i })[0];
    fireEvent.click(saveTransPromptBtn);

    // Save class settings
    const saveClassBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveClassBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          isLectureSubtitlesEnabled: false,
          lectureTargetLanguages: expect.arrayContaining(['en']),
        })
      );
    });
  });

  it('handles importing student emails from uploaded text/excel file', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Student Email Addresses/i)).toBeInTheDocument();
    });

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);

    const blob = await exportStudentRosterExcel(['student1@test.com', 'student2@test.com'], {}, 'CLASS_101');
    const file = new File([blob], 'students.xlsx', { type: blob.type });
    
    // Trigger file change
    await act(async () => {
      fireEvent.change(fileInputs[0], { target: { files: [file] } });
    });

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

    const exportCsvBtns = screen.getAllByRole('button', { name: /📤 Export (Excel|CSV)/i });
    expect(exportCsvBtns.length).toBeGreaterThanOrEqual(2);

    // Export students CSV
    await act(async () => {
      fireEvent.click(exportCsvBtns[0]);
    });
    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    // Export teachers CSV
    await act(async () => {
      fireEvent.click(exportCsvBtns[1]);
    });
    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalledTimes(2);
    });

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

  it('configures, toggles, and saves consolidateLessonVideo policy in class settings', async () => {
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        ...mockClassData,
        consolidateLessonVideo: true,
      }),
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Lesson Video Consolidation/i)).toBeInTheDocument();
    });

    const consolidateRadio = screen.getByRole('radio', { name: /1 Video per Lesson Slot/i });
    const separateRadio = screen.getByRole('radio', { name: /Separate Videos per Broadcast/i });

    expect(consolidateRadio).toBeChecked();
    expect(separateRadio).not.toBeChecked();

    // Toggle to separate
    fireEvent.click(separateRadio);
    expect(separateRadio).toBeChecked();
    expect(consolidateRadio).not.toBeChecked();

    // Save settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          consolidateLessonVideo: false,
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

  it('handles downloading student roster template via Download Template button', async () => {
    const originalCreateObjectURL = window.URL.createObjectURL;
    const originalRevokeObjectURL = window.URL.revokeObjectURL;
    let downloadedBlob = null;

    window.URL.createObjectURL = vi.fn((blob) => {
      downloadedBlob = blob;
      return 'blob:mock-template-url';
    });
    window.URL.revokeObjectURL = vi.fn();

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /📄 Download (Excel )?Template/i })).toBeInTheDocument();
    });

    const downloadBtn = screen.getByRole('button', { name: /📄 Download (Excel )?Template/i });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    await waitFor(() => {
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-template-url');
      expect(downloadedBlob).toBeDefined();
    });

    window.URL.createObjectURL = originalCreateObjectURL;
    window.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it('supports importing structured roster Excel with Chinese nicknames and preserving them', async () => {
    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Student Email Addresses/i)).toBeInTheDocument();
    });

    const fileInputs = document.querySelectorAll('input[type="file"]');
    expect(fileInputs.length).toBeGreaterThan(0);

    const emails = ['230123456@stu.vtc.edu.hk'];
    const profiles = {
      '230123456@stu.vtc.edu.hk': {
        studentName: 'Chan Tai Man',
        nickname: '大文',
        programme: 'Software Engineering',
        studentClass: 'IT114115/1A'
      }
    };
    const blob = await exportStudentRosterExcel(emails, profiles, 'CLASS_101');
    const file = new File([blob], 'roster.xlsx', { type: blob.type });

    await act(async () => {
      fireEvent.change(fileInputs[0], { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('names/nicknames'));
      expect(screen.getByDisplayValue(/230123456@stu\.vtc\.edu\.hk/i)).toBeInTheDocument();
      expect(screen.getByText(/大文/i)).toBeInTheDocument();
    });
  });

  it('renders and configures Bingo speed and ranking scoring rules', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementationOnce((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    mockGetDoc.mockImplementation(() => Promise.resolve({
      exists: () => true,
      data: () => ({
        ...mockClassData,
        bingoScoringRule: {
          enabled: true,
          baseCorrectPoints: 120,
          speedBonusMaxPoints: 60,
          rankBonus: { 1: 80, 2: 40, 3: 20 },
        },
      }),
    }));

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_SCORE" />);

    await waitFor(() => {
      expect(screen.getByTestId('bingo-scoring-rules-panel')).toBeInTheDocument();
      expect(screen.getByLabelText(/Base Correct Pts/i)).toHaveValue(120);
    });

    expect(screen.getByLabelText(/Max Speed Bonus/i)).toHaveValue(60);
    expect(screen.getByLabelText(/1st Place Bonus/i)).toHaveValue(80);
    expect(screen.getByLabelText(/2nd Place Bonus/i)).toHaveValue(40);
    expect(screen.getByLabelText(/3rd Place Bonus/i)).toHaveValue(20);

    const basePtsInput = screen.getByLabelText(/Base Correct Pts/i);
    fireEvent.change(basePtsInput, { target: { value: '150' } });
    expect(basePtsInput).toHaveValue(150);

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.bingoScoringRule).toMatchObject({
      enabled: true,
      baseCorrectPoints: 150,
      speedBonusMaxPoints: 60,
      rankBonus: { 1: 80, 2: 40, 3: 20 },
    });
  });

  it('opens schedule safeguard modal when schedule changes with completed lessons and archives history on confirm', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          schedule: {
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            timeZone: 'Asia/Hong_Kong',
            timeSlots: [{ startTime: '09:00', endTime: '11:00', days: ['Mon'] }],
          },
          scheduleHistory: [],
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_SCHED" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-09-01')).toBeInTheDocument();
    });

    // Modify schedule end date
    const endDateInput = screen.getByDisplayValue('2026-12-31');
    fireEvent.change(endDateInput, { target: { value: '2027-01-31' } });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // Safeguard modal should appear
    await waitFor(() => {
      expect(screen.getByText(/Class Timetable Change Safeguard/i)).toBeInTheDocument();
    });

    // Click confirm "Apply & Preserve History"
    const applyBtn = screen.getByRole('button', { name: /Apply & Preserve History/i });
    await act(async () => {
      fireEvent.click(applyBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.scheduleHistory).toHaveLength(1);
    expect(capturedUpdateData.scheduleHistory[0].startDate).toBe('2026-09-01');
    expect(capturedUpdateData.schedule.endDate).toBe('2027-01-31');
  });

  it('allows overwrite option in schedule safeguard modal', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          schedule: {
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            timeZone: 'Asia/Hong_Kong',
            timeSlots: [{ startTime: '09:00', endTime: '11:00', days: ['Mon'] }],
          },
          scheduleHistory: [],
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_OVERWRITE" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-09-01')).toBeInTheDocument();
    });

    const endDateInput = screen.getByDisplayValue('2026-12-31');
    fireEvent.change(endDateInput, { target: { value: '2027-02-15' } });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Class Timetable Change Safeguard/i)).toBeInTheDocument();
    });

    // Select overwrite radio
    const overwriteRadio = screen.getByRole('radio', { name: /Overwrite/i });
    fireEvent.click(overwriteRadio);

    const overwriteBtn = screen.getByRole('button', { name: /Overwrite Entire Schedule/i });
    await act(async () => {
      fireEvent.click(overwriteBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.scheduleHistory).toEqual([]);
    expect(capturedUpdateData.schedule.endDate).toBe('2027-02-15');
  });

  it('renders Phone Passkey column and resets passkey when teacher clicks Reset button', async () => {
    const mockResetCallable = vi.fn().mockResolvedValue({ data: { success: true } });
    const { httpsCallable } = await import('firebase/functions');
    vi.mocked(httpsCallable).mockReturnValue(mockResetCallable);

    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getAllByText('alice@school.edu').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('Phone Passkey')).toBeInTheDocument();

    const resetBtn = screen.getByTestId('btn-roster-reset-passkey-alice_school_edu');
    expect(resetBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(resetBtn);
    });

    expect(mockResetCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        studentEmail: 'alice@school.edu',
        classId: 'CLASS_101',
      })
    );
    expect(await screen.findByText(/has been reset successfully/i)).toBeInTheDocument();
  });

  it('renders Temp Bypass button and grants emergency passkey bypass when clicked', async () => {
    const mockApproveCallable = vi.fn().mockResolvedValue({ data: { success: true } });
    const { httpsCallable } = await import('firebase/functions');
    vi.mocked(httpsCallable).mockReturnValue(mockApproveCallable);

    vi.spyOn(window, 'prompt').mockReturnValue('120');

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getAllByText('alice@school.edu').length).toBeGreaterThanOrEqual(1);
    });

    const bypassBtn = screen.getByTestId('btn-roster-bypass-alice_school_edu');
    expect(bypassBtn).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(bypassBtn);
    });

    expect(mockApproveCallable).toHaveBeenCalledWith(
      expect.objectContaining({
        studentEmail: 'alice@school.edu',
        classId: 'CLASS_101',
        bypassDurationMinutes: 120,
        approved: true,
      })
    );
    expect(await screen.findByText(/Emergency bypass granted for/i)).toBeInTheDocument();
  });

  it('renders Permanent Passkey Exemption button and requires double-confirmation alert before granting exemption', async () => {
    const mockToggleExemption = vi.fn().mockResolvedValue({ data: { success: true } });
    const { httpsCallable } = await import('firebase/functions');
    vi.mocked(httpsCallable).mockReturnValue(mockToggleExemption);

    const confirmSpy = vi.spyOn(window, 'confirm');

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getAllByText('alice@school.edu').length).toBeGreaterThanOrEqual(1);
    });

    const exemptBtn = screen.getByTestId('btn-roster-exempt-alice_school_edu');
    expect(exemptBtn).toBeInTheDocument();
    expect(exemptBtn).toHaveTextContent('🛡️ Exempt');

    // 1. Cancel on double confirmation alert
    confirmSpy.mockReturnValueOnce(false);
    await act(async () => {
      fireEvent.click(exemptBtn);
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('⚠️ UNCOMMON CASE CONFIRMATION ⚠️')
    );
    expect(mockToggleExemption).not.toHaveBeenCalled();

    // 2. Confirm the uncommon case alert
    confirmSpy.mockReturnValueOnce(true);
    await act(async () => {
      fireEvent.click(exemptBtn);
    });

    expect(mockToggleExemption).toHaveBeenCalledWith(
      expect.objectContaining({
        studentEmail: 'alice@school.edu',
        classId: 'CLASS_101',
        exempt: true,
      })
    );
    expect(await screen.findByText(/Permanent passkey exemption granted for/i)).toBeInTheDocument();
  });

  it('configures and saves classroom IP restrictions', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementationOnce((ref, data) => {
      capturedUpdateData = data;
      return Promise.resolve();
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/🔒 (?:9|10)\. Security & IP Restrictions/i)).toBeInTheDocument();
    });

    const ipTextarea = screen.getByPlaceholderText(/e\.g\. 202\.125\.10\.0\/24/i);
    fireEvent.change(ipTextarea, {
      target: { value: '202.125.10.0/24\n192.168.1.0/24' },
    });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.ipRestrictions).toEqual(['202.125.10.0/24', '192.168.1.0/24']);
  });

  it('handles class deletion from Danger Zone with user confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('CLASS_101'));
    expect(mockDeleteDoc).toHaveBeenCalledWith(expect.objectContaining({ id: 'CLASS_101' }));
    expect(alertSpy).toHaveBeenCalledWith('Class deleted successfully.');

    confirmSpy.mockRestore();
    alertSpy.mockRestore();
  });

  it('aborts class deletion if user cancels confirmation dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockDeleteDoc).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('handles closing the schedule change safeguard modal without applying changes', async () => {
    mockGetDoc.mockImplementation(() =>
      Promise.resolve({
        exists: () => true,
        data: () => ({
          ...mockClassData,
          schedule: {
            startDate: '2026-09-01',
            endDate: '2026-12-31',
            timeZone: 'Asia/Hong_Kong',
            timeSlots: [{ startTime: '09:00', endTime: '11:00', days: ['Mon'] }],
          },
          scheduleHistory: [],
        }),
      })
    );

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_CANCEL_SAFEGUARD" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('2026-09-01')).toBeInTheDocument();
    });

    // Change schedule date to trigger safeguard modal
    const endDateInput = screen.getByDisplayValue('2026-12-31');
    fireEvent.change(endDateInput, { target: { value: '2027-02-15' } });

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    // Safeguard modal should appear
    await waitFor(() => {
      expect(screen.getByText(/Class Timetable Change Safeguard/i)).toBeInTheDocument();
    });

    // Click Cancel button in ScheduleChangeModal
    const cancelSafeguardBtn = screen.getByRole('button', { name: /^Cancel$/i });
    await act(async () => {
      fireEvent.click(cancelSafeguardBtn);
    });

    // Modal should close without updating Firestore
    await waitFor(() => {
      expect(screen.queryByText(/Class Timetable Change Safeguard/i)).not.toBeInTheDocument();
    });
  });

  it('supports adding and saving class tags', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation(async (ref, data) => {
      capturedUpdateData = data;
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type tag \(e\.g\. HD-IT/i)).toBeInTheDocument();
    });

    const tagInput = screen.getByPlaceholderText(/Type tag \(e\.g\. HD-IT/i);
    const addTagBtn = screen.getByRole('button', { name: /\+ Add Tag/i });

    // Type a new tag 'Lab 302' and click Add Tag
    fireEvent.change(tagInput, { target: { value: 'Lab 302' } });
    fireEvent.click(addTagBtn);

    // Tag chip should appear
    expect(await screen.findByText('#Lab 302')).toBeInTheDocument();

    // Type another tag 'Year 1' with Enter key
    fireEvent.change(tagInput, { target: { value: 'Year 1' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });

    expect(await screen.findByText('#Year 1')).toBeInTheDocument();

    // Save class settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.tags).toEqual(['Lab 302', 'Year 1']);
  });

  it('configures, toggles, and saves teacherRecordingsPolicy across all 3 modes (private, selective, always_shared)', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation(async (ref, data) => {
      capturedUpdateData = data;
    });

    render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);

    await waitFor(() => {
      expect(screen.getByText(/Private to Instructor \(Default Deny - Recommended\)/i)).toBeInTheDocument();
    });

    // Check default deny (private) radio option is selected
    const defaultDenyRadio = screen.getByRole('radio', { name: /Private to Instructor \(Default Deny - Recommended\)/i });
    expect(defaultDenyRadio).toBeChecked();

    const allowSelectiveRadio = screen.getByRole('radio', { name: /Allow Selective Sharing/i });
    expect(allowSelectiveRadio).not.toBeChecked();

    const alwaysShareRadio = screen.getByRole('radio', { name: /Always Share with Class/i });
    expect(alwaysShareRadio).not.toBeChecked();

    // Toggle to allow selective sharing
    fireEvent.click(allowSelectiveRadio);
    expect(allowSelectiveRadio).toBeChecked();
    expect(defaultDenyRadio).not.toBeChecked();

    // Save class settings
    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.teacherRecordingsPolicy).toBe('selective');
    expect(capturedUpdateData.allowShareTeacherRecordings).toBe(true);

    // Now switch to always_shared mode
    fireEvent.click(alwaysShareRadio);
    expect(alwaysShareRadio).toBeChecked();
    expect(allowSelectiveRadio).not.toBeChecked();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(capturedUpdateData.teacherRecordingsPolicy).toBe('always_shared');
    expect(capturedUpdateData.allowShareTeacherRecordings).toBe(true);

    // Switch back to private mode
    fireEvent.click(defaultDenyRadio);
    expect(defaultDenyRadio).toBeChecked();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(capturedUpdateData.teacherRecordingsPolicy).toBe('private');
    expect(capturedUpdateData.allowShareTeacherRecordings).toBe(false);
  });

  it('configures, toggles, and saves purgeScreenshotsAfterVideoCombine in class settings', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation(async (ref, data) => {
      capturedUpdateData = data;
      return {};
    });

    await act(async () => {
      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Auto-Delete Raw Screenshots Once Combined into Video/i)).toBeInTheDocument();
    });

    const purgeCheckbox = screen.getByLabelText(/Auto-Delete Raw Screenshots Once Combined into Video/i);
    expect(purgeCheckbox).not.toBeChecked();

    // Toggle on
    fireEvent.click(purgeCheckbox);
    expect(purgeCheckbox).toBeChecked();

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.purgeScreenshotsAfterVideoCombine).toBe(true);
  });

  it('configures, selects, and saves lectureAiModel in class settings', async () => {
    let capturedUpdateData = null;
    mockUpdateDoc.mockImplementation(async (ref, data) => {
      capturedUpdateData = data;
      return {};
    });

    await act(async () => {
      render(<ClassManagement embeddedClassId="class-1" onBack={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Lecture Transcription & Subtitle AI Model/i)).toBeInTheDocument();
    });

    const gemini38Radio = screen.getByRole('radio', { name: /Gemini 3.8 Flash \(Recommended\)/i });
    const gemini35Radio = screen.getByRole('radio', { name: /Gemini 3.5 Flash-Lite \(Economical\)/i });

    // Defaults to gemini-3.8-flash
    expect(gemini38Radio).toBeChecked();
    expect(gemini35Radio).not.toBeChecked();

    // Select Gemini 3.5 Flash-Lite
    fireEvent.click(gemini35Radio);
    expect(gemini35Radio).toBeChecked();
    expect(gemini38Radio).not.toBeChecked();

    const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockUpdateDoc).toHaveBeenCalled();
    });

    expect(capturedUpdateData.lectureAiModel).toBe('gemini-3.5-flash-lite');

    // Switch back to Gemini 3.8 Flash
    fireEvent.click(gemini38Radio);
    expect(gemini38Radio).toBeChecked();

    await act(async () => {
      fireEvent.click(saveBtn);
    });

    expect(capturedUpdateData.lectureAiModel).toBe('gemini-3.8-flash');
  });

  it('handles prompt modals: opening, saving, and clearing audio, image, video and subtitle prompts', async () => {
    await act(async () => {
      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="class-1" onBack={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Basic Information & Storage Quota/i)).toBeInTheDocument();
    });

    // 1. Video prompt modal (initial name is Focus Audit from mockClassData)
    const selectVideoBtn = screen.getByRole('button', { name: /Focus Audit/i });
    fireEvent.click(selectVideoBtn);
    expect(screen.getByText('Select After-Class Video Prompt')).toBeInTheDocument();

    const saveBtns = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveBtns[0]);
    await waitFor(() => {
      expect(screen.queryByText('Select After-Class Video Prompt')).not.toBeInTheDocument();
    });

    // Reopen and clear
    fireEvent.click(screen.getByRole('button', { name: /Focus Audit/i }));
    const clearBtns = screen.getAllByRole('button', { name: /Clear Prompt/i });
    fireEvent.click(clearBtns[0]);

    // 2. Gemma intent prompt modal
    const selectGemmaBtn = screen.getByRole('button', { name: /Select Gemma Intent Prompt/i });
    fireEvent.click(selectGemmaBtn);
    expect(screen.getByText('Select On-Device Gemma Voice Intent Prompt')).toBeInTheDocument();
    const saveGemma = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveGemma[saveGemma.length - 1]);

    // Reopen and clear
    fireEvent.click(selectGemmaBtn);
    const clearGemma = screen.getAllByRole('button', { name: /Clear Prompt/i });
    fireEvent.click(clearGemma[clearGemma.length - 1]);

    // 3. Live Image prompt modal
    const selectImageBtn = screen.getByRole('button', { name: /Select Image Invigilation Prompt/i });
    fireEvent.click(selectImageBtn);
    expect(screen.getByText('Select Live Image & Screen Invigilation Prompt')).toBeInTheDocument();
    const saveImage = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveImage[saveImage.length - 1]);

    // Reopen and clear
    fireEvent.click(selectImageBtn);
    const clearImage = screen.getAllByRole('button', { name: /Clear Prompt/i });
    fireEvent.click(clearImage[clearImage.length - 1]);

    // 4. Bingo prompt modal (requires enabling auto bingo)
    const autoBingoCheckbox = screen.getByLabelText(/Enable Automated Periodic Bingo Verification/i);
    fireEvent.click(autoBingoCheckbox);

    const selectBingoBtn = screen.getByRole('button', { name: /Select Bingo Question Prompt/i });
    fireEvent.click(selectBingoBtn);
    expect(screen.getByText('Select Bingo Active Presence AI Prompt')).toBeInTheDocument();
    const saveBingo = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveBingo[saveBingo.length - 1]);

    // Reopen and clear
    fireEvent.click(selectBingoBtn);
    const clearBingo = screen.getAllByRole('button', { name: /Clear Prompt/i });
    fireEvent.click(clearBingo[clearBingo.length - 1]);

    // 5. Live Audio Invigilation prompt modal
    const liveAudioCheckbox = screen.getByLabelText(/Enable Moving Window Real-Time Transcription/i);
    fireEvent.click(liveAudioCheckbox);

    const selectLiveAudioBtn = screen.getByRole('button', { name: /Select Live Invigilation Prompt/i });
    fireEvent.click(selectLiveAudioBtn);
    expect(screen.getByText('Select Live Audio Invigilation Prompt')).toBeInTheDocument();
    const saveLiveAudio = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveLiveAudio[saveLiveAudio.length - 1]);

    // Reopen and clear
    fireEvent.click(selectLiveAudioBtn);
    const clearLiveAudio = screen.getAllByRole('button', { name: /Clear Prompt/i });
    fireEvent.click(clearLiveAudio[clearLiveAudio.length - 1]);

    // 6. Discussion Audio prompt modal
    const sessionAudioCheckbox = screen.getByLabelText(/Enable Session & Discussion Audio Analysis & Diarization/i);
    fireEvent.click(sessionAudioCheckbox);

    const selectSessionAudioBtn = screen.getByRole('button', { name: /Select Discussion \/ Session AI Prompt/i });
    fireEvent.click(selectSessionAudioBtn);
    expect(screen.getByText('Select Discussion / Session Audio Summary Prompt')).toBeInTheDocument();
    const saveSessionAudio = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveSessionAudio[saveSessionAudio.length - 1]);

    // 7. Subtitle prompt modal
    const selectSubtitleBtn = screen.getByRole('button', { name: /Select Subtitle Translation Prompt/i });
    fireEvent.click(selectSubtitleBtn);
    expect(screen.getByText('Select Live Subtitles & Translation Prompt')).toBeInTheDocument();
    const saveSubtitle = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveSubtitle[saveSubtitle.length - 1]);

    // 8. Lecture STT prompt modal
    const selectSttBtn = screen.getByRole('button', { name: /Lecture Audio Speech-to-Text/i });
    fireEvent.click(selectSttBtn);
    expect(screen.getByText('Select Lecture Audio Speech-to-Text & Chapters Prompt')).toBeInTheDocument();
    const saveStt = screen.getAllByRole('button', { name: /Save Prompt Selection/i });
    fireEvent.click(saveStt[saveStt.length - 1]);
  }, 15000);

  it('handles delete class action confirmation and execution', async () => {
    window.confirm = vi.fn().mockReturnValue(false);
    await act(async () => {
      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="class-1" onBack={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
    });

    const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
    // Cancelled confirmation
    fireEvent.click(deleteBtn);
    expect(mockDeleteDoc).not.toHaveBeenCalled();

    // Confirmed deletion
    window.confirm = vi.fn().mockReturnValue(true);
    await act(async () => {
      fireEvent.click(deleteBtn);
    });
    expect(mockDeleteDoc).toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Class deleted successfully.');
  });

  describe('Class Concept Templates (Lecture, Lab, Lecture in Lab)', () => {
    it('renders the concept template selector hero cards with all 3 templates', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      expect(screen.getByText(/Select Class Concept Template/i)).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 4, name: 'Lecture' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 4, name: 'Lab' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 4, name: 'Lecture in Lab' })).toBeInTheDocument();

      expect(screen.getByText(/Auditorium \/ Classroom Lecture/i)).toBeInTheDocument();
      expect(screen.getByText(/Hands-on Computer Lab/i)).toBeInTheDocument();
      expect(screen.getByText(/Anti-Distraction Focus Mode/i)).toBeInTheDocument();
    });

    it('applies Lecture presets: disables capture & proctoring, enables lecture studio', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      const lectureCard = screen.getByRole('heading', { level: 4, name: 'Lecture' }).closest('.template-card');
      expect(lectureCard).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(lectureCard);
      });

      const captureCheckbox = screen.getByLabelText(/Automatic Live Capture/i);
      const fullScreenCheckbox = screen.getByLabelText(/Require Entire Screen/i);
      const autoBingoCheckbox = screen.getByLabelText(/Enable Automated Periodic Bingo/i);

      expect(captureCheckbox).not.toBeChecked();
      expect(fullScreenCheckbox).not.toBeChecked();
      expect(autoBingoCheckbox).not.toBeChecked();
    });

    it('applies Lecture in Lab presets: enforces anti-distraction fullscreen lock & 5-min bingo', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      // First click Lecture to alter state
      const lectureCard = screen.getByRole('heading', { level: 4, name: 'Lecture' }).closest('.template-card');
      await act(async () => {
        fireEvent.click(lectureCard);
      });

      // Now click Lecture in Lab
      const lectureInLabCard = screen.getByRole('heading', { level: 4, name: 'Lecture in Lab' }).closest('.template-card');
      await act(async () => {
        fireEvent.click(lectureInLabCard);
      });

      const captureCheckbox = screen.getByLabelText(/Automatic Live Capture/i);
      const fullScreenCheckbox = screen.getByLabelText(/Require Entire Screen/i);
      const autoBingoCheckbox = screen.getByLabelText(/Enable Automated Periodic Bingo/i);

      expect(captureCheckbox).toBeChecked();
      expect(fullScreenCheckbox).toBeChecked();
      expect(autoBingoCheckbox).toBeChecked();
    });

    it('applies Lab presets: enables dual-screen capture and relaxes fullscreen lock', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      const labCard = screen.getByRole('heading', { level: 4, name: 'Lab' }).closest('.template-card');
      await act(async () => {
        fireEvent.click(labCard);
      });

      const captureCheckbox = screen.getByLabelText(/Automatic Live Capture/i);
      const fullScreenCheckbox = screen.getByLabelText(/Require Entire Screen/i);

      expect(captureCheckbox).toBeChecked();
      expect(fullScreenCheckbox).not.toBeChecked(); // relaxed for multi-window coding
    });

    it('toggles the advanced configuration accordion', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      const accordionBtn = screen.getByRole('button', { name: /Advanced Configuration & Parameter Overrides/i });
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');

      await act(async () => {
        fireEvent.click(accordionBtn);
      });
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'true');

      await act(async () => {
        fireEvent.click(accordionBtn);
      });
      expect(accordionBtn).toHaveAttribute('aria-expanded', 'false');
    });

    it('saves selected template classType in Firestore when creating a class', async () => {
      mockGetDoc.mockImplementation(() =>
        Promise.resolve({
          exists: () => false,
        })
      );

      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);

      // Select Lecture template
      const lectureCard = screen.getByRole('heading', { level: 4, name: 'Lecture' }).closest('.template-card');
      fireEvent.click(lectureCard);

      const classIdInput = screen.getByPlaceholderText(/e\.g\. it114115-2026-s1/i);
      fireEvent.change(classIdInput, { target: { value: 'lecture_cs101' } });

      const classNameInput = screen.getByPlaceholderText(/e\.g\. Cloud Architecture Lab/i);
      fireEvent.change(classNameInput, { target: { value: 'CS101 Lecture' } });

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

      const createBtn = screen.getByRole('button', { name: /Create Class/i });
      await act(async () => {
        fireEvent.click(createBtn);
      });

      await waitFor(() => {
        expect(mockSetDoc).toHaveBeenCalledWith(
          expect.anything(),
          expect.objectContaining({
            classType: 'lecture',
            automaticCapture: false,
            tags: expect.arrayContaining(['Lecture']),
          })
        );
      });
    });

    it('auto-synchronizes template tag and supports quick template filter tag pills', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      // 1. Initial template tag should be Lecture in Lab when selecting template
      const labCard = screen.getByRole('heading', { level: 4, name: 'Lab' }).closest('.template-card');
      await act(async () => {
        fireEvent.click(labCard);
      });

      // Verify #Lab chip is displayed in chips list
      const getChipsList = () => document.querySelector('.class-tags-chips-list');
      expect(getChipsList()).toHaveTextContent('#Lab');

      // 2. Add custom tag 'Cohort-A'
      const tagInput = screen.getByPlaceholderText(/Type tag/i);
      fireEvent.change(tagInput, { target: { value: 'Cohort-A' } });
      fireEvent.keyDown(tagInput, { key: 'Enter', code: 'Enter' });
      expect(getChipsList()).toHaveTextContent('#Cohort-A');

      // 3. Switch to Lecture template -> #Lab should be replaced by #Lecture, but #Cohort-A remains
      const lectureCard = screen.getByRole('heading', { level: 4, name: 'Lecture' }).closest('.template-card');
      await act(async () => {
        fireEvent.click(lectureCard);
      });

      expect(getChipsList()).toHaveTextContent('#Lecture');
      expect(getChipsList()).toHaveTextContent('#Cohort-A');
      expect(getChipsList()).not.toHaveTextContent('#Lab');

      // 4. Quick template tag pill toggle
      const quickLabBtn = screen.getByRole('button', { name: /\+ #Lab/i });
      await act(async () => {
        fireEvent.click(quickLabBtn);
      });

      expect(getChipsList()).toHaveTextContent('#Lab');
      expect(getChipsList()).not.toHaveTextContent('#Lecture');
      expect(getChipsList()).toHaveTextContent('#Cohort-A');
    });

    it('does not render template selector cards when editing an existing class via embeddedClassId', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS_101" />);
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/e\.g\. Cloud Architecture Lab/i)).toHaveValue('Distributed Systems');
      });

      // Template selector hero cards must NOT be displayed when editing
      expect(screen.queryByText(/Select Class Concept Template/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 4, name: 'Lecture' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 4, name: 'Lab' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 4, name: 'Lecture in Lab' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Re-apply Presets/i })).not.toBeInTheDocument();

      // Quick filter tag pills in Section 1 should still exist for classification without settings overwrite
      expect(screen.getByText(/Template Filter Tag:/i)).toBeInTheDocument();
      const presetRow = document.querySelector('.template-tags-presets-row');
      expect(presetRow).toBeInTheDocument();
      expect(within(presetRow).getByRole('button', { name: /^\+ #Lecture$/i })).toBeInTheDocument();
    });

    it('does not render template selector cards when editing an existing class via selectedClass dropdown', async () => {
      await act(async () => {
        render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} />);
      });

      // Initially in creation mode, template selector is visible
      expect(screen.getByText(/Select Class Concept Template/i)).toBeInTheDocument();

      // Select an existing class from dropdown
      const selectClassDropdown = screen.getByLabelText(/Select a Class to Edit or Configure/i);
      await act(async () => {
        fireEvent.change(selectClassDropdown, { target: { value: 'CLASS_101' } });
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText(/e\.g\. Cloud Architecture Lab/i)).toHaveValue('Distributed Systems');
      });

      // Template selector hero cards must now be hidden in edit mode
      expect(screen.queryByText(/Select Class Concept Template/i)).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 4, name: 'Lecture' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Re-apply Presets/i })).not.toBeInTheDocument();
    });
  });
});



