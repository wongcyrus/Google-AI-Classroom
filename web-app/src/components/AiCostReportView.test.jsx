import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AiCostReportView from './AiCostReportView';
import * as csvExporter from '../utils/aiCostCsvExporter';

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

  it('allows filtering by student and updates statistics', () => {
    render(
      <AiCostReportView
        classId="CLASS_TEST_1"
        className="Computer Science 101"
        classQuota={10}
        aiJobs={mockJobs}
        students={mockStudents}
      />
    );

    const studentSelect = screen.getByLabelText(/Student/i);
    fireEvent.change(studentSelect, { target: { value: 'student_1' } });

    const table = screen.getByRole('table');
    // student_2 should not be in the filtered table
    expect(within(table).queryByText('student2@school.edu')).not.toBeInTheDocument();
    expect(within(table).getByText('student1@school.edu')).toBeInTheDocument();

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
});
