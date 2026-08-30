import { describe, it, expect } from 'vitest';
import { aggregateAiCost } from './aiCostAggregator';

describe('aiCostAggregator Utility', () => {
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
      studentUid: 'student_1',
      studentEmail: 'student1@school.edu',
      jobType: 'analyzeAudio',
      modelUsed: 'gemini-3.5-transcribe',
      status: 'completed',
      cost: 0.002500,
      usage: { inputTokens: 2000, outputTokens: 200 },
      timestamp: new Date('2026-08-30T10:15:00Z'),
    },
    {
      id: 'job_3',
      studentUid: 'student_2',
      studentEmail: 'student2@school.edu',
      jobType: 'cloudFallbackFaceAnalysis',
      modelUsed: 'gemini-3.5-flash-lite',
      status: 'completed',
      cost: 0.000300,
      usage: { inputTokens: 1000, outputTokens: 50 },
      timestamp: new Date('2026-08-30T10:30:00Z'),
    },
    {
      id: 'job_4',
      studentUid: 'student_2',
      studentEmail: 'student2@school.edu',
      jobType: 'analyzeSingleVideo',
      modelUsed: 'gemini-3.7-flash',
      status: 'failed',
      cost: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: new Date('2026-08-30T11:00:00Z'),
    },
    {
      id: 'job_5',
      studentUid: 'student_3',
      studentEmail: 'student3@school.edu',
      jobType: 'analyzeImage',
      modelUsed: 'gemini-3.7-flash',
      status: 'blocked-by-quota',
      cost: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
      timestamp: new Date('2026-08-29T09:00:00Z'),
    }
  ];

  it('aggregates all jobs correctly without filters', () => {
    const summary = aggregateAiCost(mockJobs, { classQuota: 10 });
    
    expect(summary.totalJobs).toBe(5);
    expect(summary.completedJobs).toBe(3);
    expect(summary.failedJobs).toBe(1);
    expect(summary.blockedJobs).toBe(1);
    expect(summary.totalCost).toBeCloseTo(0.007800, 5);
    expect(summary.totalInputTokens).toBe(7000);
    expect(summary.totalOutputTokens).toBe(750);
    expect(summary.totalTokens).toBe(7750);
    expect(summary.successRate).toBe(60);
    expect(summary.avgCostPerJob).toBeCloseTo(0.007800 / 5, 5);
    expect(summary.quotaPercentage).toBeCloseTo((0.007800 / 10) * 100, 2);
  });

  it('correctly categorizes costs by jobType', () => {
    const summary = aggregateAiCost(mockJobs);
    
    const imageCategory = summary.byJobType.find(j => j.jobType === 'analyzeImage');
    expect(imageCategory).toBeDefined();
    expect(imageCategory.count).toBe(2);
    expect(imageCategory.cost).toBeCloseTo(0.005000, 5);

    const audioCategory = summary.byJobType.find(j => j.jobType === 'analyzeAudio');
    expect(audioCategory).toBeDefined();
    expect(audioCategory.count).toBe(1);
    expect(audioCategory.cost).toBeCloseTo(0.002500, 5);
  });

  it('correctly categorizes costs by model', () => {
    const summary = aggregateAiCost(mockJobs);
    
    const flashModel = summary.byModel.find(m => m.model === 'gemini-3.7-flash');
    expect(flashModel).toBeDefined();
    expect(flashModel.count).toBe(3);
    expect(flashModel.cost).toBeCloseTo(0.005000, 5);

    const transcribeModel = summary.byModel.find(m => m.model === 'gemini-3.5-transcribe');
    expect(transcribeModel).toBeDefined();
    expect(transcribeModel.cost).toBeCloseTo(0.002500, 5);
  });

  it('correctly aggregates per-student consumption', () => {
    const summary = aggregateAiCost(mockJobs);
    
    const student1 = summary.byStudent.find(s => s.studentUid === 'student_1');
    expect(student1).toBeDefined();
    expect(student1.jobCount).toBe(2);
    expect(student1.cost).toBeCloseTo(0.007500, 5);
    expect(student1.totalTokens).toBe(6700);
  });

  it('filters accurately by studentUid', () => {
    const summary = aggregateAiCost(mockJobs, { studentUid: 'student_1' });
    expect(summary.totalJobs).toBe(2);
    expect(summary.totalCost).toBeCloseTo(0.007500, 5);
  });

  it('filters accurately by jobType', () => {
    const summary = aggregateAiCost(mockJobs, { jobType: 'analyzeAudio' });
    expect(summary.totalJobs).toBe(1);
    expect(summary.totalCost).toBeCloseTo(0.002500, 5);
  });

  it('filters accurately by model', () => {
    const summary = aggregateAiCost(mockJobs, { model: 'gemini-3.5-flash-lite' });
    expect(summary.totalJobs).toBe(1);
    expect(summary.totalCost).toBeCloseTo(0.000300, 5);
  });

  it('filters accurately by date range', () => {
    const summary = aggregateAiCost(mockJobs, {
      startDate: '2026-08-30T00:00:00Z',
      endDate: '2026-08-30T23:59:59Z'
    });
    expect(summary.totalJobs).toBe(4);
    expect(summary.totalCost).toBeCloseTo(0.007800, 5);
  });

  it('handles empty job lists gracefully', () => {
    const summary = aggregateAiCost([]);
    expect(summary.totalJobs).toBe(0);
    expect(summary.totalCost).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.avgCostPerJob).toBe(0);
    expect(summary.byJobType).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.byStudent).toEqual([]);
    expect(summary.timeline).toEqual([]);
  });
});
