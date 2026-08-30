import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChangePasswordModal from './ChangePasswordModal';
import ScheduleManager from './ScheduleManager';
import CustomPropertiesManager from './CustomPropertiesManager';
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

const mockUpdatePassword = vi.fn().mockResolvedValue({});
const mockReauthenticateWithCredential = vi.fn().mockResolvedValue({});

vi.mock('firebase/auth', () => ({
  updatePassword: (...args) => mockUpdatePassword(...args),
  EmailAuthProvider: {
    credential: vi.fn(),
  },
  reauthenticateWithCredential: (...args) => mockReauthenticateWithCredential(...args),
}));

const mockSetDoc = vi.fn().mockResolvedValue({});
const mockUpdateDoc = vi.fn().mockResolvedValue({});
const mockDeleteDoc = vi.fn().mockResolvedValue({});

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((db, col, id, ...rest) => ({ path: `${col}/${id}${rest.length ? '/' + rest.join('/') : ''}` })),
  getDoc: vi.fn().mockImplementation((ref) => {
    return Promise.resolve({
      exists: () => true,
      data: () => ({
        name: 'Comp Sci 101',
        students: { s1: 'student1@school.edu' },
        teachers: ['teacher@school.edu'],
        storageLimit: '10',
        retentionDays: '14',
        videoRetentionDays: '60',
        captureMode: 'dual',
        enableAudioCapture: true,
        enableClientAi: true,
        aiMonitoringMode: 'hybrid',
        customProperties: { Department: 'CS' },
        schedule: {
          startDate: '2026-09-01',
          endDate: '2026-12-31',
          timeZone: 'Asia/Hong_Kong',
          timeSlots: [{ startTime: '09:00', endTime: '10:00', days: ['Mon'] }],
        },
      }),
    });
  }),
  collection: vi.fn(() => ({ path: 'mockCollection' })),
  onSnapshot: vi.fn((q, callback) => {
    callback({
      docs: [
        {
          id: 'CLASS-101',
          data: () => ({ name: 'Comp Sci 101', teachers: ['teacher@school.edu'] }),
        },
        {
          id: 'CLASS-202',
          data: () => ({ name: 'Advanced Algorithms', teachers: ['teacher@school.edu'] }),
        },
      ],
    });
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    commit: vi.fn().mockResolvedValue({}),
  })),
  addDoc: vi.fn().mockResolvedValue({ id: 'job_1' }),
  setDoc: (...args) => mockSetDoc(...args),
  updateDoc: (...args) => mockUpdateDoc(...args),
  deleteDoc: (...args) => mockDeleteDoc(...args),
  serverTimestamp: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({
    docs: [
      { id: 's1', data: () => ({ Seat: 'A1', ExamGroup: 'G1' }) },
    ],
    forEach: vi.fn((fn) => {
      fn({ id: 's1', data: () => ({ Seat: 'A1', ExamGroup: 'G1' }) });
    }),
  }),
}));

vi.mock('react-csv', () => ({
  CSVLink: ({ children, data, headers }) => (
    <button data-testid="csv-link" data-rows={JSON.stringify(data)} data-headers={JSON.stringify(headers)}>
      {children}
    </button>
  ),
}));

describe('Class Settings & Management Full Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.alert = vi.fn();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  describe('ChangePasswordModal', () => {
    it('renders modal and updates password on valid submission', async () => {
      const onClose = vi.fn();
      render(<ChangePasswordModal show={true} onClose={onClose} />);

      expect(screen.getByText('Change Password')).toBeInTheDocument();

      const currentPass = screen.getByLabelText(/Current Password/i);
      const newPass = screen.getByLabelText(/^New Password/i);
      const confirmPass = screen.getByLabelText(/Confirm New Password/i);

      fireEvent.change(currentPass, { target: { value: 'oldpass123' } });
      fireEvent.change(newPass, { target: { value: 'newsecret999' } });
      fireEvent.change(confirmPass, { target: { value: 'newsecret999' } });

      const submitBtn = screen.getByRole('button', { name: /Update Password/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(screen.getByText(/Password updated successfully!/i)).toBeInTheDocument();
      });
    });

    it('shows error if new passwords do not match', async () => {
      render(<ChangePasswordModal show={true} onClose={vi.fn()} />);

      fireEvent.change(screen.getByLabelText(/Current Password/i), { target: { value: 'oldpass123' } });
      fireEvent.change(screen.getByLabelText(/^New Password/i), { target: { value: 'passwordA' } });
      fireEvent.change(screen.getByLabelText(/Confirm New Password/i), { target: { value: 'passwordB' } });

      fireEvent.click(screen.getByRole('button', { name: /Update Password/i }));

      await waitFor(() => {
        expect(screen.getByText(/New passwords do not match/i)).toBeInTheDocument();
      });
    });

    it('returns null when show is false', () => {
      const { container } = render(<ChangePasswordModal show={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('ScheduleManager', () => {
    it('renders schedule slots and handles adding new time slot', () => {
      const setClassSchedules = vi.fn();

      render(
        <ScheduleManager
          scheduleStartDate="2026-09-01"
          setScheduleStartDate={vi.fn()}
          scheduleEndDate="2026-12-31"
          setScheduleEndDate={vi.fn()}
          timeZone="UTC"
          setTimeZone={vi.fn()}
          classSchedules={[{ startTime: '09:00', endTime: '10:00', days: ['Mon', 'Wed'] }]}
          setClassSchedules={setClassSchedules}
        />
      );

      expect(screen.getByText('Class Time Slots')).toBeInTheDocument();
      expect(screen.getByText('Mon, Wed: 9:00 AM - 10:00 AM')).toBeInTheDocument();

      // Select start time
      const selects = screen.getAllByRole('combobox');
      // selects[0] is timeZone, selects[1] is start time, selects[2] is end time
      if (selects.length >= 3) {
        fireEvent.change(selects[1], { target: { value: '14:00' } });
      }

      // Check day checkboxes and add slot
      const friCheckbox = screen.getByLabelText(/Fri/i);
      fireEvent.click(friCheckbox);

      const addSlotBtn = screen.getByRole('button', { name: /Add Schedule/i });
      fireEvent.click(addSlotBtn);

      expect(setClassSchedules).toHaveBeenCalled();
    });
  });

  describe('CustomPropertiesManager', () => {
    it('renders custom property keys and allows row updates and template download', async () => {
      render(
        <CustomPropertiesManager
          selectedClass="CLASS-101"
          studentEmails={['student1@school.edu']}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Class-wide Custom Properties/i)).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /Add Property Field/i });
      fireEvent.click(addBtn);

      const inputs = screen.getAllByPlaceholderText(/Property Key/i);
      if (inputs.length > 0) {
        fireEvent.change(inputs[inputs.length - 1], { target: { value: 'LabStation' } });
      }

      const saveBtn = screen.getByRole('button', { name: /Save Class-wide Properties/i });
      expect(saveBtn).toBeInTheDocument();
      fireEvent.click(saveBtn);

      // Export CSV download button
      const downloadBtn = screen.getByRole('button', { name: /Export \/ Download Existing CSV/i });
      fireEvent.click(downloadBtn);
    });

    it('handles student properties CSV upload', async () => {
      render(
        <CustomPropertiesManager
          selectedClass="CLASS-101"
          studentEmails="student1@school.edu, student2@school.edu"
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Class-wide Custom Properties/i)).toBeInTheDocument();
      });

      const fileInput = document.querySelector('input[type="file"]');
      if (fileInput) {
        const file = new File(['StudentEmail,Seat\ns1@school.edu,A1'], 'students.csv', { type: 'text/csv' });
        fireEvent.change(fileInput, { target: { files: [file] } });
      }
    });
  });

  describe('ClassManagement Component', () => {
    it('renders class settings and allows modifying audio, retention, and storage options', async () => {
      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS-101" />);

      await waitFor(() => {
        expect(screen.getByText(/Basic Information & Storage Quota/i)).toBeInTheDocument();
      });

      // Find selects
      const selects = screen.getAllByRole('combobox');
      if (selects.length > 0) {
        fireEvent.change(selects[0], { target: { value: '20' } });
      }

      const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(mockUpdateDoc).toHaveBeenCalled();
      });
    });

    it('handles class deletion with confirmation', async () => {
      render(<ClassManagement user={{ uid: 't1', email: 'teacher@school.edu' }} embeddedClassId="CLASS-101" />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Delete This Class/i })).toBeInTheDocument();
      });

      const deleteBtn = screen.getByRole('button', { name: /Delete This Class/i });
      fireEvent.click(deleteBtn);

      await waitFor(() => {
        expect(mockDeleteDoc).toHaveBeenCalled();
      });
    });
  });
});
