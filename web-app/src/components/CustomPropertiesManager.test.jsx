import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CustomPropertiesManager from './CustomPropertiesManager';

const mockGetDoc = vi.fn();
const mockGetDocs = vi.fn();
const mockSetDoc = vi.fn().mockResolvedValue();
const mockAddDoc = vi.fn().mockResolvedValue({ id: 'job_1' });
const mockCommit = vi.fn().mockResolvedValue();
const mockBatchUpdate = vi.fn();

vi.mock('../firebase-config', () => ({
  db: {},
  auth: { currentUser: { uid: 'teacher_1' } },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ id: 'mock-doc' })),
  getDoc: (...args) => mockGetDoc(...args),
  getDocs: (...args) => mockGetDocs(...args),
  collection: vi.fn(() => ({ id: 'mock-coll' })),
  onSnapshot: vi.fn((q, cb) => {
    cb({ docs: [{ id: 'job_1', data: () => ({ status: 'completed', createdAt: { toDate: () => new Date() } }) }] });
    return () => {};
  }),
  query: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  writeBatch: () => ({
    set: vi.fn(),
    update: mockBatchUpdate,
    commit: mockCommit,
  }),
  addDoc: (...args) => mockAddDoc(...args),
  serverTimestamp: vi.fn(),
  deleteField: vi.fn(() => '__DELETE_FIELD__'),
}));

vi.mock('../utils/exportUtils', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    exportToExcel: vi.fn().mockResolvedValue(),
    readExcelFile: vi.fn().mockResolvedValue([
      ['StudentEmail', 'ExtraTime'],
      ['alice@school.edu', '15m'],
    ]),
  };
});

describe('CustomPropertiesManager Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders class properties, adds a row, edits values, and saves properties', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        CourseCode: 'IT114115',
      }),
    });

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="student1@school.edu, student2@school.edu"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('CourseCode')).toBeInTheDocument();
      expect(screen.getByDisplayValue('IT114115')).toBeInTheDocument();
    });

    // Add new property row
    const addBtn = screen.getByRole('button', { name: /Add Property Field/i });
    fireEvent.click(addBtn);

    const inputs = screen.getAllByPlaceholderText(/Property Key/i);
    expect(inputs.length).toBe(2);

    fireEvent.change(inputs[1], { target: { value: 'Semester' } });
    const valInputs = screen.getAllByPlaceholderText(/Value/i);
    fireEvent.change(valInputs[1], { target: { value: 'Fall 2026' } });

    // Save
    const saveBtn = screen.getByRole('button', { name: /Save Class-wide Properties/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(mockCommit).toHaveBeenCalled();
    });
  });

  it('handles downloading template and student-specific properties CSV', async () => {
    // 1st getDoc for initial load
    mockGetDoc.mockResolvedValueOnce({ exists: () => false });
    // 2nd getDoc for class doc in handleDownloadStudentTemplate
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        students: {
          s1: 'alice@school.edu',
        },
      }),
    });

    mockGetDocs.mockResolvedValueOnce([
      {
        id: 's1',
        data: () => ({ ExtraTime: '15m' }),
      },
    ]);

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="alice@school.edu"
      />
    );

    const downloadBtn = screen.getByRole('button', { name: /Export \/ Download Existing (Excel|CSV)/i });
    await act(async () => {
      fireEvent.click(downloadBtn);
    });

    await waitFor(() => {
      expect(mockGetDocs).toHaveBeenCalled();
    });
  });

  it('handles uploading an Excel file and creates a property upload job', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="alice@school.edu"
      />
    );

    const file = new File(['dummy'], 'props.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const fileInput = document.querySelector('input[type="file"]');
    
    await act(async () => {
      fireEvent.change(fileInput, { target: { files: [file] } });
    });

    await waitFor(() => {
      expect(mockAddDoc).toHaveBeenCalled();
    });
  });

  it('handles removing a property row and error states', async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ Prop1: 'Val1', Prop2: 'Val2' }),
    });

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="alice@school.edu"
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Prop1')).toBeInTheDocument();
    });

    // Remove first property row
    const removeBtns = screen.getAllByTitle(/Remove Property/i);
    fireEvent.click(removeBtns[0]);
    expect(screen.queryByDisplayValue('Prop1')).not.toBeInTheDocument();

    // Save failure
    mockCommit.mockRejectedValueOnce(new Error('Write permission denied'));
    const saveBtn = screen.getByRole('button', { name: /Save Class-wide Properties/i });
    await act(async () => {
      fireEvent.click(saveBtn);
    });

    await waitFor(() => {
      expect(screen.getByText(/Failed to save properties/i)).toBeInTheDocument();
    });
  });

  it('handles deleting an individual student property key across all students', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockGetDocs.mockResolvedValue([
      { id: 's1', data: () => ({ ExtraTime: '15m' }) },
      { id: 's2', data: () => ({ ExtraTime: '30m' }) },
    ]);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="alice@school.edu, bob@school.edu"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('ExtraTime')).toBeInTheDocument();
      expect(screen.getByText('(2 students)')).toBeInTheDocument();
    });

    const deleteBtn = screen.getByTitle(/Delete property "ExtraTime" from all students/i);
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
      expect(mockCommit).toHaveBeenCalled();
      expect(screen.getByText(/Successfully deleted custom property "ExtraTime"/i)).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it('handles clearing all student-specific custom properties', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false });
    mockGetDocs.mockResolvedValue([
      { id: 's1', data: () => ({ Key: 'key_1', CheckMark: 'check_1', examReadiness: { isReady: true } }) },
    ]);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <CustomPropertiesManager
        selectedClass="CLASS_101"
        studentEmails="alice@school.edu"
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Key')).toBeInTheDocument();
      expect(screen.getByText('CheckMark')).toBeInTheDocument();
      // Internal examReadiness must NOT be displayed
      expect(screen.queryByText('examReadiness')).not.toBeInTheDocument();
    });

    const clearAllBtn = screen.getByRole('button', { name: /Clear All Student Properties/i });
    await act(async () => {
      fireEvent.click(clearAllBtn);
    });

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(mockBatchUpdate).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          Key: '__DELETE_FIELD__',
          CheckMark: '__DELETE_FIELD__',
        })
      );
      // examReadiness should NEVER be in the delete payload
      const calls = mockBatchUpdate.mock.calls;
      const lastPayload = calls[calls.length - 1][1];
      expect(lastPayload.examReadiness).toBeUndefined();
      expect(mockCommit).toHaveBeenCalled();
      expect(screen.getByText(/Successfully cleared all custom properties/i)).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });
});
