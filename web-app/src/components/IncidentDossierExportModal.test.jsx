import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IncidentDossierExportModal from './IncidentDossierExportModal';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockAddDoc = vi.fn().mockResolvedValue({ id: 'job_123' });
let mockSnapshotCallback = null;

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  addDoc: (...args) => mockAddDoc(...args),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  onSnapshot: vi.fn((docRef, cb) => {
    mockSnapshotCallback = cb;
    return vi.fn();
  }),
}));

describe('IncidentDossierExportModal Component', () => {
  const mockStudents = [
    { id: 's1', email: 'alice@example.com', name: 'Alice' },
    { id: 's2', email: 'bob@example.com', name: 'Bob' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockSnapshotCallback = null;
  });

  it('renders form with time filters, formats, evidence checkboxes and email options', () => {
    render(
      <IncidentDossierExportModal
        isOpen={true}
        onClose={vi.fn()}
        classId="CLASS_1"
        user={{ uid: 'teacher_1', email: 'teacher@example.com' }}
        students={mockStudents}
      />
    );

    expect(screen.getByText(/Export Formal Exam Incident Dossier/i)).toBeInTheDocument();
    expect(screen.getByText(/Current Session/i)).toBeInTheDocument();
    expect(screen.getByText(/Both \(\.docx \+ \.csv\)/i)).toBeInTheDocument();

    // Toggle format to docx only
    const docxRadio = screen.getByLabelText(/MS Word \(\.docx only\)/i);
    fireEvent.click(docxRadio);
    expect(docxRadio).toBeChecked();

    // Toggle format to csv only
    const csvRadio = screen.getByLabelText(/CSV Log \(\.csv only\)/i);
    fireEvent.click(csvRadio);
    expect(csvRadio).toBeChecked();

    // Toggle evidence checkboxes
    const screenCheck = screen.getByLabelText(/Screenshot Evidence/i);
    fireEvent.click(screenCheck);
    expect(screenCheck).not.toBeChecked();

    const audioCheck = screen.getByLabelText(/Audio Transcripts/i);
    fireEvent.click(audioCheck);
    expect(audioCheck).not.toBeChecked();

    const gazeCheck = screen.getByLabelText(/Gaze & Head Pose/i);
    fireEvent.click(gazeCheck);
    expect(gazeCheck).not.toBeChecked();
  });

  it('allows switching presets, custom dates, and specific student selections', () => {
    render(
      <IncidentDossierExportModal
        isOpen={true}
        onClose={vi.fn()}
        classId="CLASS_1"
        user={{ uid: 'teacher_1', email: 'teacher@example.com' }}
        students={mockStudents}
      />
    );

    // Switch to 1h preset
    const oneHourBtn = screen.getByText('Past 1 Hour');
    fireEvent.click(oneHourBtn);

    // Switch to 3h preset
    const threeHourBtn = screen.getByText('Past 3 Hours');
    fireEvent.click(threeHourBtn);

    // Switch to Custom Range
    const customBtn = screen.getByText('Custom Range');
    fireEvent.click(customBtn);
    expect(screen.getByText('Start Time')).toBeInTheDocument();

    // Select specific students
    const specificRadio = screen.getByLabelText(/Select Specific Students/i);
    fireEvent.click(specificRadio);

    const studentCheckbox = screen.getByLabelText(/Alice/i);
    fireEvent.click(studentCheckbox);
    expect(studentCheckbox).toBeChecked();

    // Uncheck student
    fireEvent.click(studentCheckbox);
    expect(studentCheckbox).not.toBeChecked();

    // Email notification input change
    const emailInput = screen.getByPlaceholderText('instructor@example.com');
    fireEvent.change(emailInput, { target: { value: 'custom@school.edu' } });
    expect(emailInput.value).toBe('custom@school.edu');
  });

  it('submits job and transitions to active tracking state and completed state', async () => {
    const onClose = vi.fn();
    render(
      <IncidentDossierExportModal
        isOpen={true}
        onClose={onClose}
        classId="CLASS_1"
        user={{ uid: 'teacher_1', email: 'teacher@example.com' }}
        students={mockStudents}
      />
    );

    const submitBtn = screen.getByText(/Generate Official Dossier/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAddDoc).toHaveBeenCalled();
      expect(mockSnapshotCallback).toBeTruthy();
    });

    expect(screen.getByText(/Generating Incident Dossier in Background/i)).toBeInTheDocument();

    // Simulate snapshot update to 'completed'
    mockSnapshotCallback({
      exists: () => true,
      data: () => ({
        status: 'completed',
        docxUrl: 'https://storage.local/dossier.docx',
        csvUrl: 'https://storage.local/dossier.csv',
        summary: { totalStudents: 2, totalIrregularities: 5 },
      }),
    });

    await waitFor(() => {
      expect(screen.getByText(/Incident Dossier Generated Successfully!/i)).toBeInTheDocument();
      expect(screen.getByText(/Download Word Dossier \(\.docx\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Download Incident Log \(\.csv\)/i)).toBeInTheDocument();
    });

    const doneBtn = screen.getByText('Done');
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('handles job failure state with retry option', async () => {
    render(
      <IncidentDossierExportModal
        isOpen={true}
        onClose={vi.fn()}
        classId="CLASS_1"
        user={{ uid: 'teacher_1', email: 'teacher@example.com' }}
        students={mockStudents}
      />
    );

    const submitBtn = screen.getByText(/Generate Official Dossier/i);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockAddDoc).toHaveBeenCalled();
      expect(mockSnapshotCallback).toBeTruthy();
    });

    // Simulate snapshot update to 'failed'
    mockSnapshotCallback({
      exists: () => true,
      data: () => ({
        status: 'failed',
        error: 'Storage quota exceeded',
      }),
    });

    await waitFor(() => {
      expect(screen.getByText(/Report Generation Failed/i)).toBeInTheDocument();
      expect(screen.getByText(/Storage quota exceeded/i)).toBeInTheDocument();
    });

    const retryBtn = screen.getByText('Try Again');
    fireEvent.click(retryBtn);

    expect(screen.getByText(/Generate Official Dossier/i)).toBeInTheDocument();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <IncidentDossierExportModal
        isOpen={false}
        onClose={vi.fn()}
        classId="CLASS_1"
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
