import { describe, it, expect, vi } from 'vitest';
import { generateAiCostCsv, downloadCsvFile } from './aiCostCsvExporter';
import { aggregateAiCost } from './aiCostAggregator';

describe('aiCostCsvExporter Utility', () => {
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

  it('generates a well-formed CSV report string', () => {
    const summary = aggregateAiCost(mockJobs, { classQuota: 10 });
    const csv = generateAiCostCsv(summary, {
      className: 'IT114115-Demo',
      classId: 'CLASS_1',
      generatedAt: '2026-08-30T12:00:00Z',
    });

    expect(csv).toContain('"=== AI COST BREAKDOWN & AUDIT REPORT ==="');
    expect(csv).toContain('"Class Name","IT114115-Demo"');
    expect(csv).toContain('"Total Jobs Analyzed",2');
    expect(csv).toContain('"--- COST BREAKDOWN BY MODEL ---"');
    expect(csv).toContain('"gemini-3.7-flash"');
    expect(csv).toContain('"gemini-3.5-transcribe"');
    expect(csv).toContain('"--- STUDENT USAGE BREAKDOWN ---"');
    expect(csv).toContain('"student1@school.edu"');
    expect(csv).toContain('"student2@school.edu"');
    expect(csv).toContain('"--- ITEMIZED AI JOBS AUDIT LOG ---"');
    expect(csv).toContain('"job_1"');
    expect(csv).toContain('"job_2"');
  });

  it('triggers browser download with blob and anchor element', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    
    // Mock URL.createObjectURL and revokeObjectURL
    window.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-uuid');
    window.URL.revokeObjectURL = vi.fn();

    downloadCsvFile('mock,csv,data', 'test_report.csv');

    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(appendSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-uuid');
  });
});
