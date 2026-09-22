import { describe, it, expect, vi } from 'vitest';
import { generateAiCostCsv, downloadCsvFile } from './aiCostCsvExporter';

describe('aiCostCsvExporter utility', () => {
  it('generates compliant CSV with all report sections and escapes quotes', () => {
    const mockSummary = {
      totalJobs: 2,
      totalCost: 0.0075,
      classQuota: 15,
      quotaPercentage: 0.05,
      totalTokens: 5000,
      totalInputTokens: 4500,
      totalOutputTokens: 500,
      successRate: 100,
      completedJobs: 2,
      failedJobs: 0,
      blockedJobs: 0,
      byModel: [
        {
          model: 'gemini-3.7-flash',
          count: 2,
          inputTokens: 4500,
          outputTokens: 500,
          cost: 0.0075,
          percentage: 100,
        },
      ],
      byJobType: [
        {
          jobType: 'generateBingoQuestion',
          count: 1,
          inputTokens: 2000,
          outputTokens: 250,
          cost: 0.0035,
          percentage: 46.7,
        },
        {
          jobType: 'analyzeImage',
          count: 1,
          inputTokens: 2500,
          outputTokens: 250,
          cost: 0.0040,
          percentage: 53.3,
        },
      ],
      byStudent: [
        {
          studentUid: 'stu_1',
          studentEmail: 'student"one"@vtc.edu.hk', // includes quote for RFC 4180 escaping test
          jobCount: 2,
          inputTokens: 4500,
          outputTokens: 500,
          totalTokens: 5000,
          cost: 0.0075,
          percentageOfClass: 100,
        },
      ],
      filteredJobs: [
        {
          id: 'job_1',
          timestamp: new Date('2026-09-10T09:00:00Z'),
          studentEmail: 'student"one"@vtc.edu.hk',
          jobType: 'generateBingoQuestion',
          modelUsed: 'gemini-3.7-flash',
          status: 'completed',
          usage: { inputTokens: 2000, outputTokens: 250 },
          cost: 0.0035,
        },
        {
          id: 'job_2',
          timestamp: { toDate: () => new Date('2026-09-10T10:00:00Z') },
          studentEmail: 'student"one"@vtc.edu.hk',
          jobType: 'analyzeImage',
          modelUsed: 'gemini-3.7-flash',
          status: 'completed',
          usage: { promptTokenCount: 2500, candidatesTokenCount: 250 },
          cost: 0.0040,
        },
      ],
    };

    const metadata = {
      className: 'Cloud Computing "Lab A"',
      classId: 'CLASS_TEST_101',
      generatedAt: '2026-09-10T12:00:00Z',
    };

    const csv = generateAiCostCsv(mockSummary, metadata);

    expect(csv).toContain('"=== AI COST BREAKDOWN & AUDIT REPORT ==="');
    // Class name quotes escaped
    expect(csv).toContain('"Class Name","Cloud Computing ""Lab A"""');
    expect(csv).toContain('"Class ID","CLASS_TEST_101"');
    expect(csv).toContain('--- COST BREAKDOWN BY MODEL ---');
    expect(csv).toContain('"gemini-3.7-flash",2,4500,500,5000');
    expect(csv).toContain('--- COST BREAKDOWN BY JOB TYPE ---');
    expect(csv).toContain('"generateBingoQuestion",1,2000,250,2250');
    expect(csv).toContain('--- STUDENT USAGE BREAKDOWN ---');
    expect(csv).toContain('"student""one""@vtc.edu.hk"');
    expect(csv).toContain('--- ITEMIZED AI JOBS AUDIT LOG ---');
    expect(csv).toContain('"job_1"');
    expect(csv).toContain('"job_2"');
  });

  it('handles empty or missing summary and metadata safely', () => {
    const csv = generateAiCostCsv({}, {});
    expect(csv).toContain('"Class Name","N/A"');
    expect(csv).toContain('"Total Jobs Analyzed",0');
    expect(csv).toContain('--- COST BREAKDOWN BY MODEL ---');
    expect(csv).toContain('--- ITEMIZED AI JOBS AUDIT LOG ---');
  });

  it('triggers browser file download with correct blob and link element', () => {
    const mockClick = vi.fn();
    const mockSetAttribute = vi.fn();
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'a') {
        return {
          setAttribute: mockSetAttribute,
          click: mockClick,
          style: {},
        };
      }
      return originalCreateElement(tagName);
    });

    vi.spyOn(document.body, 'appendChild').mockImplementation(mockAppendChild);
    vi.spyOn(document.body, 'removeChild').mockImplementation(mockRemoveChild);
    window.URL.createObjectURL = vi.fn(() => 'blob:http://localhost/mock-uuid');
    window.URL.revokeObjectURL = vi.fn();

    downloadCsvFile('header1,header2\nval1,val2', 'test_audit.csv');

    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(mockSetAttribute).toHaveBeenCalledWith('href', 'blob:http://localhost/mock-uuid');
    expect(mockSetAttribute).toHaveBeenCalledWith('download', 'test_audit.csv');
    expect(mockAppendChild).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    expect(mockRemoveChild).toHaveBeenCalled();
    expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/mock-uuid');
  });
});
