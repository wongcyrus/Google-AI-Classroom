import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AiCostReportView from './AiCostReportView';
import * as csvExporter from '../utils/aiCostCsvExporter';

vi.mock('../firebase-config', () => ({
  db: {},
}));

const mockOnSnapshot = vi.fn((q, onNext, onError) => {
  onNext({
    docs: [
      {
        id: 'job_snap_1',
        data: () => ({
          studentUid: 'student_1',
          studentEmail: 'student1@school.edu',
          jobType: 'analyzeImage',
          modelUsed: 'gemini-3.7-flash',
          status: 'completed',
          cost: 0.003,
          timestamp: new Date('2026-08-30T10:00:00Z'),
        }),
      },
    ],
  });
  return () => {};
});

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  where: vi.fn(),
  onSnapshot: (...args) => mockOnSnapshot(...args),
}));

describe('AiCostReportView Component', () => {
  const mockJobs = [
    {
      id: 'job_1',
      studentUid: 'student_1',
      studentEmail: 'student1@school.edu',
      jobType: 'analyzeImage',
      modelUsed: 'gemini-3.7-flash',
      status: 'completed',
      cost: 0.005000,
      usage: { inputTokens: 4000, outputTokens: 500 },
      timestamp: new Date('2026-08-30T10:00:00Z'),
    },
    {
      id: 'job_2',
      studentUid: 'student_2',
      studentEmail: 'student2@school.edu',
      jobType: 'analyzeAudio',
      modelUsed: 'gemini-3.5-transcribe',
      status: 'completed',
      cost: 0.002500,
      usage: { inputTokens: 2000, outputTokens: 200 },
      timestamp: new Date('2026-08-30T10:15:00Z'),
    }
  ];

  const mockStudents = [
    { uid: 'student_1', email: 'student1@school.edu' },
    { uid: 'student_2', email: 'student2@school.edu' }
  ];

  it('renders correctly with KPI cards and breakdown sections', () => {
    render(
      <AiCostReportView
        classId="CLASS_TEST_1"
        className="Computer Science 101"
        classQuota={10}
        aiJobs={mockJobs}
        students={mockStudents}
      />
    );

    expect(screen.getByText(/AI Cost Breakdown & Audit/i)).toBeInTheDocument();
    expect(screen.getByText(/Computer Science 101/i)).toBeInTheDocument();
    expect(screen.getByText(/Total AI Spend/i)).toBeInTheDocument();
    expect(screen.getByText(/Token Consumption/i)).toBeInTheDocument();
    expect(screen.getByText(/Job Volume/i)).toBeInTheDocument();

    // Check student table rows
    const table = screen.getByRole('table');
    expect(within(table).getByText('student1@school.edu')).toBeInTheDocument();
    expect(within(table).getByText('student2@school.edu')).toBeInTheDocument();
  });

  it('allows filtering by student, model, jobType, and dates and updates statistics', () => {
    render(
      <AiCostReportView
        classId="CLASS_TEST_1"
        className="Computer Science 101"
        classQuota={10}
        aiJobs={mockJobs}
        students={mockStudents}
      />
    );

    // Filter by student
    const studentSelect = screen.getByLabelText(/Student/i);
    fireEvent.change(studentSelect, { target: { value: 'student_1' } });

    let table = screen.getByRole('table');
    expect(within(table).queryByText('student2@school.edu')).not.toBeInTheDocument();
    expect(within(table).getByText('student1@school.edu')).toBeInTheDocument();

    // Filter by model
    const modelSelect = screen.getByLabelText(/Model/i);
    fireEvent.change(modelSelect, { target: { value: 'gemini-3.7-flash' } });
    expect(within(screen.getByRole('table')).getByText('student1@school.edu')).toBeInTheDocument();

    // Filter by job type
    const jobTypeSelect = screen.getByLabelText(/Job Type/i);
    fireEvent.change(jobTypeSelect, { target: { value: 'analyzeImage' } });
    expect(within(screen.getByRole('table')).getByText('student1@school.edu')).toBeInTheDocument();

    // Filter by date
    const fromInput = screen.getByLabelText(/From Date/i);
    fireEvent.change(fromInput, { target: { value: '2026-08-01' } });
    const toInput = screen.getByLabelText(/To Date/i);
    fireEvent.change(toInput, { target: { value: '2026-08-31' } });

    // Reset button should appear and work
    const resetBtn = screen.getByText(/Reset Filters/i);
    fireEvent.click(resetBtn);
    expect(within(screen.getByRole('table')).getByText('student2@school.edu')).toBeInTheDocument();
  });

  it('triggers CSV download on button click', () => {
    const downloadSpy = vi.spyOn(csvExporter, 'downloadCsvFile').mockImplementation(() => {});

    render(
      <AiCostReportView
        classId="CLASS_TEST_1"
        className="Computer Science 101"
        classQuota={10}
        aiJobs={mockJobs}
        students={mockStudents}
      />
    );

    const exportBtn = screen.getByText(/Export CSV Report/i);
    fireEvent.click(exportBtn);

    expect(downloadSpy).toHaveBeenCalled();
  });

  it('subscribes to firestore when propAiJobs is not provided', () => {
    render(
      <AiCostReportView
        classId="CLASS_TEST_2"
        className="Cloud Computing"
        students={mockStudents}
      />
    );

    expect(mockOnSnapshot).toHaveBeenCalled();
    expect(screen.getByText(/Cloud Computing/i)).toBeInTheDocument();
  });

  it('handles N/A classId gracefully without querying firestore', () => {
    mockOnSnapshot.mockClear();
    render(
      <AiCostReportView
        classId="N/A"
        className="Unassigned Class"
        students={mockStudents}
      />
    );

    expect(mockOnSnapshot).not.toHaveBeenCalled();
  });

  it('handles error in firestore subscription gracefully', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockOnSnapshot.mockImplementationOnce((q, onNext, onError) => {
      onError(new Error('Permission denied'));
      return () => {};
    });

    render(
      <AiCostReportView
        classId="CLASS_ERR"
        className="Error Class"
        students={mockStudents}
      />
    );

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Error fetching aiJobs'), expect.any(Error));
  });
});
