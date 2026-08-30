import { formatAiCost } from './formatters';

/**
 * Converts aggregated AI cost summary and raw filtered jobs into an RFC 4180 compliant CSV string.
 * 
 * @param {object} summary - Aggregated AI Cost summary object from aggregateAiCost.
 * @param {object} metadata - Class and report metadata.
 * @returns {string} CSV content string.
 */
export function generateAiCostCsv(summary, metadata = {}) {
  const { className = 'N/A', classId = 'N/A', generatedAt = new Date().toISOString() } = metadata;

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const lines = [];

  // Report Header & Meta
  lines.push(`"=== AI COST BREAKDOWN & AUDIT REPORT ==="`);
  lines.push(`"Class Name",${escapeCsv(className)},"Class ID",${escapeCsv(classId)}`);
  lines.push(`"Generated At",${escapeCsv(generatedAt)},"Total Jobs Analyzed",${summary.totalJobs || 0}`);
  lines.push(`"Total AI Spend",${escapeCsv(formatAiCost(summary.totalCost))},"Class Quota",${escapeCsv('$' + (summary.classQuota || 10).toFixed(2))},"Quota Utilized",${escapeCsv((summary.quotaPercentage || 0) + '%')}`);
  lines.push(`"Total Tokens",${summary.totalTokens || 0},"Input Tokens",${summary.totalInputTokens || 0},"Output Tokens",${summary.totalOutputTokens || 0}`);
  lines.push(`"Job Reliability",${escapeCsv((summary.successRate || 100).toFixed(1) + '% Success')},"Completed",${summary.completedJobs || 0},"Failed",${summary.failedJobs || 0},"Blocked",${summary.blockedJobs || 0}`);
  lines.push('');

  // Section 1: Breakdown by AI Model
  lines.push(`"--- COST BREAKDOWN BY MODEL ---"`);
  lines.push(`"Model","Job Count","Input Tokens","Output Tokens","Total Tokens","Total Cost (USD)","Share of Total"`);
  (summary.byModel || []).forEach(m => {
    lines.push([
      escapeCsv(m.model),
      m.count,
      m.inputTokens,
      m.outputTokens,
      m.inputTokens + m.outputTokens,
      escapeCsv(formatAiCost(m.cost)),
      escapeCsv((m.percentage || 0).toFixed(1) + '%')
    ].join(','));
  });
  lines.push('');

  // Section 2: Breakdown by Job Type
  lines.push(`"--- COST BREAKDOWN BY JOB TYPE ---"`);
  lines.push(`"Job Type / Category","Job Count","Input Tokens","Output Tokens","Total Tokens","Total Cost (USD)","Share of Total"`);
  (summary.byJobType || []).forEach(j => {
    lines.push([
      escapeCsv(j.jobType),
      j.count,
      j.inputTokens,
      j.outputTokens,
      j.inputTokens + j.outputTokens,
      escapeCsv(formatAiCost(j.cost)),
      escapeCsv((j.percentage || 0).toFixed(1) + '%')
    ].join(','));
  });
  lines.push('');

  // Section 3: Breakdown by Student
  lines.push(`"--- STUDENT USAGE BREAKDOWN ---"`);
  lines.push(`"Student UID","Student Email","Job Count","Input Tokens","Output Tokens","Total Tokens","Total Cost (USD)","Share of Class Spend"`);
  (summary.byStudent || []).forEach(s => {
    lines.push([
      escapeCsv(s.studentUid),
      escapeCsv(s.studentEmail),
      s.jobCount,
      s.inputTokens,
      s.outputTokens,
      s.totalTokens,
      escapeCsv(formatAiCost(s.cost)),
      escapeCsv((s.percentageOfClass || 0).toFixed(1) + '%')
    ].join(','));
  });
  lines.push('');

  // Section 4: Itemized Audit Trail (Filtered Jobs)
  lines.push(`"--- ITEMIZED AI JOBS AUDIT LOG ---"`);
  lines.push(`"Timestamp","Job ID","Student Email","Job Type","Model Used","Status","Input Tokens","Output Tokens","Cost (USD)"`);
  (summary.filteredJobs || []).forEach(job => {
    const jobTime = job.timestamp?.toDate
      ? job.timestamp.toDate().toISOString()
      : (job.timestamp ? new Date(job.timestamp).toISOString() : 'N/A');

    const usage = job.usage || {};
    const inputTokens = usage.inputTokens ?? usage.promptTokenCount ?? 0;
    const outputTokens = usage.outputTokens ?? usage.candidatesTokenCount ?? 0;

    lines.push([
      escapeCsv(jobTime),
      escapeCsv(job.id || 'N/A'),
      escapeCsv(job.studentEmail || 'N/A'),
      escapeCsv(job.jobType || 'N/A'),
      escapeCsv(job.modelUsed || 'gemini-3.5-flash-lite'),
      escapeCsv(job.status || 'unknown'),
      inputTokens,
      outputTokens,
      escapeCsv(formatAiCost(job.cost))
    ].join(','));
  });

  return lines.join('\r\n');
}

/**
 * Triggers a browser download of the generated CSV file.
 * 
 * @param {string} csvContent - CSV string data.
 * @param {string} filename - Download file name.
 */
export function downloadCsvFile(csvContent, filename = 'ai_cost_report.csv') {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
