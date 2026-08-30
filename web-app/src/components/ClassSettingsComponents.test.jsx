import React from 'react';
import { describe, it, expect, vi } from 'vitest';
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

vi.mock('firebase/auth', () => ({
  updatePassword: vi.fn().mockResolvedValue({}),
  EmailAuthProvider: {
    credential: vi.fn(),
  },
  reauthenticateWithCredential: vi.fn().mockResolvedValue({}),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    data: () => ({ 'exam.timeLimit': '60' }),
  }),
  collection: vi.fn(),
  onSnapshot: vi.fn((q, callback) => {
    callback({ docs: [] });
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
  serverTimestamp: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
}));

vi.mock('react-csv', () => ({
  CSVLink: ({ children }) => <button data-testid="csv-link">{children}</button>,
}));

describe('Class Settings & Management Components', () => {
  describe('ChangePasswordModal', () => {
    it('renders modal with form fields and updates password', async () => {
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

    it('returns null when show is false', () => {
      const { container } = render(<ChangePasswordModal show={false} onClose={vi.fn()} />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('ScheduleManager', () => {
    it('renders timezone selector, day checkboxes, and schedule list', () => {
      const setTimeZone = vi.fn();
      const setClassSchedules = vi.fn();

      render(
        <ScheduleManager
          scheduleStartDate="2026-09-01"
          setScheduleStartDate={vi.fn()}
          scheduleEndDate="2026-12-31"
          setScheduleEndDate={vi.fn()}
          timeZone="UTC"
          setTimeZone={setTimeZone}
          classSchedules={[{ startTime: '09:00', endTime: '10:00', days: ['Mon', 'Wed'] }]}
          setClassSchedules={setClassSchedules}
        />
      );

      expect(screen.getByText('Class Time Slots')).toBeInTheDocument();
      expect(screen.getByText('Mon, Wed: 9:00 AM - 10:00 AM')).toBeInTheDocument();

      const removeBtn = screen.getByRole('button', { name: 'Remove' });
      fireEvent.click(removeBtn);
      expect(setClassSchedules).toHaveBeenCalledWith([]);
    });
  });

  describe('CustomPropertiesManager', () => {
    it('renders class properties and allows adding property rows', async () => {
      render(
        <CustomPropertiesManager
          selectedClass="CLASS-101"
          studentEmails={['student1@school.edu']}
        />
      );

      await waitFor(() => {
        expect(screen.getByText(/Class-wide Custom Properties/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Add Property Field/i })).toBeInTheDocument();
      });

      const addBtn = screen.getByRole('button', { name: /Add Property Field/i });
      fireEvent.click(addBtn);

      expect(screen.getByRole('button', { name: /Save Class-wide Properties/i })).toBeInTheDocument();
    });
  });

  describe('ClassManagement', () => {
    it('renders class settings and saves updated configurations', async () => {
      render(<ClassManagement user={{ uid: 't1' }} embeddedClassId="CLASS-101" />);

      await waitFor(() => {
        expect(screen.getByText(/Class Settings/i)).toBeInTheDocument();
      });

      // Verify presence of audio monitoring controls and settings
      expect(screen.getByText(/Audio & Microphone Monitoring/i)).toBeInTheDocument();
      expect(screen.getByText(/Automation & AI Prompts/i)).toBeInTheDocument();

      const saveBtn = screen.getByRole('button', { name: /Save Class Settings/i });
      fireEvent.click(saveBtn);
    });
  });
});
