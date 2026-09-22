import { describe, it, expect } from 'vitest';
import { aggregateAiCost } from './aiCostAggregator';

describe('aiCostAggregator utility', () => {
  it('returns default zeroed summary for empty jobs array or missing arguments', () => {
    const summary = aggregateAiCost();
    expect(summary.totalCost).toBe(0);
    expect(summary.totalTokens).toBe(0);
    expect(summary.totalJobs).toBe(0);
    expect(summary.completedJobs).toBe(0);
    expect(summary.failedJobs).toBe(0);
    expect(summary.blockedJobs).toBe(0);
    expect(summary.successRate).toBe(100);
    expect(summary.avgCostPerJob).toBe(0);
    expect(summary.classQuota).toBe(10);
    expect(summary.quotaPercentage).toBe(0);
    expect(summary.byJobType).toEqual([]);
    expect(summary.byModel).toEqual([]);
    expect(summary.byStudent).toEqual([]);
    expect(summary.timeline).toEqual([]);
    expect(summary.filteredJobs).toEqual([]);
  });

  it('aggregates multiple jobs with different job types, models, and students', () => {
    const mockJobs = [
      {
        id: 'job_1',
        studentUid: 'student_1',
        studentEmail: 's1@school.edu',
        jobType: 'analyzeImage',
        modelUsed: 'gemini-3.7-flash',
        status: 'completed',
        cost: 0.005,
        usage: { inputTokens: 4000, outputTokens: 500 },
        timestamp: new Date('2026-08-30T10:00:00Z'),
      },
      {
        id: 'job_2',
        studentUid: 'student_2',
        studentEmail: 's2@school.edu',
        jobType: 'analyzeAudio',
        modelUsed: 'gemini-3.5-transcribe',
        status: 'completed',
        cost: 0.002,
        usage: { promptTokenCount: 2000, candidatesTokenCount: 300 },
        timestamp: { toDate: () => new Date('2026-08-30T11:00:00Z') },
      },
      {
        id: 'job_3',
        studentUid: 'student_1',
        studentEmail: 's1@school.edu',
        jobType: 'generateBingoQuestion',
        modelUsed: 'gemini-3.7-flash',
        status: 'completed',
        cost: 0.001,
        usage: { promptTokens: 1000, completionTokens: 200 },
        timestamp: '2026-08-31T09:00:00Z',
      },
      {
        id: 'job_4',
        studentUid: 'student_3',
        jobType: 'analyzeSingleVideo',
        modelUsed: 'gemini-3.5-flash-lite',
        status: 'failed',
        cost: 0,
        timestamp: new Date('2026-08-31T10:00:00Z'),
      },
      {
        id: 'job_5',
        // Class wide job without studentUid
        jobType: 'generateBingoQuestionBank',
        status: 'blocked-by-quota',
        cost: 0,
      },
      null, // handles null entry gracefully
    ];

    const summary = aggregateAiCost(mockJobs, { classQuota: 20 });

    expect(summary.totalJobs).toBe(5);
    expect(summary.completedJobs).toBe(3);
    expect(summary.failedJobs).toBe(1);
    expect(summary.blockedJobs).toBe(1);
    expect(summary.successRate).toBe((3 / 5) * 100);
    expect(summary.totalCost).toBe(0.008);
    expect(summary.totalInputTokens).toBe(7000);
    expect(summary.totalOutputTokens).toBe(1000);
    expect(summary.totalTokens).toBe(8000);
    expect(summary.avgCostPerJob).toBeCloseTo(0.008 / 5);
    expect(summary.quotaPercentage).toBeCloseTo((0.008 / 20) * 100);

    // Verify breakdown by model
    expect(summary.byModel).toHaveLength(3);
    expect(summary.byModel[0].model).toBe('gemini-3.7-flash');
    expect(summary.byModel[0].count).toBe(2);
    expect(summary.byModel[0].cost).toBe(0.006);

    // Verify breakdown by job type
    expect(summary.byJobType.some(j => j.jobType === 'generateBingoQuestion')).toBe(true);
    expect(summary.byJobType.some(j => j.jobType === 'generateBingoQuestionBank')).toBe(true);

    // Verify breakdown by student (including class_wide)
    const classWideStudent = summary.byStudent.find(s => s.studentUid === 'class_wide');
    expect(classWideStudent).toBeDefined();
    expect(classWideStudent.studentEmail).toBe('Class-Wide Task');

    const unknownStudent = summary.byStudent.find(s => s.studentUid === 'student_3');
    expect(unknownStudent.studentEmail).toBe('Unknown Student');

    // Verify timeline
    expect(summary.timeline).toHaveLength(2);
    expect(summary.timeline[0].date).toBe('2026-08-30');
    expect(summary.timeline[1].date).toBe('2026-08-31');
  });

  it('filters by studentUid, jobType, model, and date range', () => {
    const mockJobs = [
      {
        id: 'job_1',
        studentUid: 'student_1',
        jobType: 'analyzeImage',
        modelUsed: 'gemini-3.7-flash',
        status: 'completed',
        cost: 0.01,
        timestamp: '2026-09-01T12:00:00Z',
      },
      {
        id: 'job_2',
        studentUid: 'student_2',
        jobType: 'analyzeImage',
        modelUsed: 'gemini-3.7-flash',
        status: 'completed',
        cost: 0.02,
        timestamp: '2026-09-02T12:00:00Z',
      },
      {
        id: 'job_3',
        studentUid: 'student_1',
        jobType: 'analyzeAudio',
        modelUsed: 'gemini-3.5-transcribe',
        status: 'completed',
        cost: 0.03,
        timestamp: '2026-09-03T12:00:00Z',
      },
      {
        id: 'job_4',
        studentUid: 'student_1',
        jobType: 'analyzeImage',
        modelUsed: 'gemini-3.8-flash',
        status: 'completed',
        cost: 0.04,
        timestamp: '2026-09-04T12:00:00Z',
      },
    ];

    // Filter by student
    const studentFilter = aggregateAiCost(mockJobs, { studentUid: 'student_2' });
    expect(studentFilter.totalJobs).toBe(1);
    expect(studentFilter.totalCost).toBe(0.02);

    // Filter by jobType
    const typeFilter = aggregateAiCost(mockJobs, { jobType: 'analyzeAudio' });
    expect(typeFilter.totalJobs).toBe(1);
    expect(typeFilter.totalCost).toBe(0.03);

    // Filter by model
    const modelFilter = aggregateAiCost(mockJobs, { model: 'gemini-3.8-flash' });
    expect(modelFilter.totalJobs).toBe(1);
    expect(modelFilter.totalCost).toBe(0.04);

    // Filter by date range
    const dateFilter = aggregateAiCost(mockJobs, {
      startDate: '2026-09-02T00:00:00Z',
      endDate: '2026-09-03T23:59:59Z',
    });
    expect(dateFilter.totalJobs).toBe(2);
    expect(dateFilter.filteredJobs.map(j => j.id)).toEqual(['job_2', 'job_3']);

    // Pass 'all' filters
    const allFilter = aggregateAiCost(mockJobs, {
      studentUid: 'all',
      jobType: 'all',
      model: 'all',
    });
    expect(allFilter.totalJobs).toBe(4);
  });

  it('handles negative or unusual token and cost attributes safely', () => {
    const unusualJobs = [
      {
        id: 'job_unusual',
        cost: -5,
        usage: {
          inputTokenCount: -100,
          outputTokenCount: -50,
        },
        timestamp: 'invalid-date-string',
      },
    ];

    const summary = aggregateAiCost(unusualJobs, { classQuota: 0 });
    expect(summary.totalCost).toBe(0);
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.quotaPercentage).toBe(0);
    expect(summary.timeline).toEqual([]);
  });
});
