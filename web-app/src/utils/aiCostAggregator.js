/**
 * Aggregates raw AI job documents into structured multi-dimensional cost summaries.
 * 
 * @param {Array<object>} jobs - Array of Firestore aiJob documents.
 * @param {object} [options] - Optional filter and configuration parameters.
 * @param {string} [options.studentUid] - Filter by student UID.
 * @param {string} [options.jobType] - Filter by job type.
 * @param {string} [options.model] - Filter by model used.
 * @param {Date|string} [options.startDate] - Filter by start date.
 * @param {Date|string} [options.endDate] - Filter by end date.
 * @param {number} [options.classQuota] - Class AI budget limit.
 * @returns {object} Aggregated cost breakdown report data.
 */
export function aggregateAiCost(jobs = [], options = {}) {
  const {
    studentUid,
    jobType,
    model,
    startDate,
    endDate,
    classQuota = 10
  } = options;

  const startTimestamp = startDate ? new Date(startDate).getTime() : 0;
  const endTimestamp = endDate ? new Date(endDate).getTime() : Infinity;

  const filteredJobs = jobs.filter(job => {
    if (!job) return false;

    // Student filter
    if (studentUid && studentUid !== 'all' && job.studentUid !== studentUid) {
      return false;
    }

    // Job Type filter
    if (jobType && jobType !== 'all' && job.jobType !== jobType) {
      return false;
    }

    // Model filter
    if (model && model !== 'all' && (job.modelUsed || 'gemini-3.5-flash-lite') !== model) {
      return false;
    }

    // Date range filter
    if (job.timestamp) {
      const jobTime = job.timestamp.toDate
        ? job.timestamp.toDate().getTime()
        : new Date(job.timestamp).getTime();

      if (!isNaN(jobTime)) {
        if (jobTime < startTimestamp || jobTime > endTimestamp) {
          return false;
        }
      }
    }

    return true;
  });

  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let blockedJobs = 0;

  const byJobTypeMap = {};
  const byModelMap = {};
  const byStudentMap = {};
  const timelineMap = {};

  for (const job of filteredJobs) {
    const cost = Math.max(0, Number(job.cost) || 0);
    const usage = job.usage || {};
    const inputTokens = Math.max(
      0,
      Number(
        usage.inputTokens ??
        usage.promptTokenCount ??
        usage.promptTokens ??
        usage.inputTokenCount ??
        0
      )
    );
    const outputTokens = Math.max(
      0,
      Number(
        usage.outputTokens ??
        usage.candidatesTokenCount ??
        usage.completionTokens ??
        usage.outputTokenCount ??
        0
      )
    );

    totalCost += cost;
    totalInputTokens += inputTokens;
    totalOutputTokens += outputTokens;

    if (job.status === 'completed') {
      completedJobs++;
    } else if (job.status === 'blocked-by-quota') {
      blockedJobs++;
    } else {
      failedJobs++;
    }

    // By Job Type
    const typeKey = job.jobType || 'other';
    if (!byJobTypeMap[typeKey]) {
      byJobTypeMap[typeKey] = { count: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
    }
    byJobTypeMap[typeKey].count++;
    byJobTypeMap[typeKey].cost += cost;
    byJobTypeMap[typeKey].inputTokens += inputTokens;
    byJobTypeMap[typeKey].outputTokens += outputTokens;

    // By Model
    const modelKey = job.modelUsed || 'gemini-3.5-flash-lite';
    if (!byModelMap[modelKey]) {
      byModelMap[modelKey] = { count: 0, cost: 0, inputTokens: 0, outputTokens: 0 };
    }
    byModelMap[modelKey].count++;
    byModelMap[modelKey].cost += cost;
    byModelMap[modelKey].inputTokens += inputTokens;
    byModelMap[modelKey].outputTokens += outputTokens;

    // By Student
    const sUid = job.studentUid || 'class_wide';
    const sEmail = job.studentEmail || (sUid === 'class_wide' ? 'Class-Wide Task' : 'Unknown Student');
    if (!byStudentMap[sUid]) {
      byStudentMap[sUid] = {
        studentUid: sUid,
        studentEmail: sEmail,
        jobCount: 0,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
    byStudentMap[sUid].jobCount++;
    byStudentMap[sUid].cost += cost;
    byStudentMap[sUid].inputTokens += inputTokens;
    byStudentMap[sUid].outputTokens += outputTokens;

    // Timeline (by Day: YYYY-MM-DD)
    if (job.timestamp) {
      const jobDate = job.timestamp.toDate
        ? job.timestamp.toDate()
        : new Date(job.timestamp);
      if (!isNaN(jobDate.getTime())) {
        const dateKey = jobDate.toISOString().split('T')[0];
        if (!timelineMap[dateKey]) {
          timelineMap[dateKey] = { date: dateKey, cost: 0, count: 0, tokens: 0 };
        }
        timelineMap[dateKey].cost += cost;
        timelineMap[dateKey].count++;
        timelineMap[dateKey].tokens += (inputTokens + outputTokens);
      }
    }
  }

  const totalTokens = totalInputTokens + totalOutputTokens;
  const totalJobs = filteredJobs.length;
  const avgCostPerJob = totalJobs > 0 ? totalCost / totalJobs : 0;
  const quotaPercentage = classQuota > 0 ? Math.min((totalCost / classQuota) * 100, 100) : 0;

  // Enhance maps with percentages
  const byJobType = Object.entries(byJobTypeMap).map(([type, data]) => ({
    jobType: type,
    ...data,
    costFormatted: Number(data.cost.toFixed(6)),
    percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
  })).sort((a, b) => b.cost - a.cost);

  const byModel = Object.entries(byModelMap).map(([mName, data]) => ({
    model: mName,
    ...data,
    costFormatted: Number(data.cost.toFixed(6)),
    percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
  })).sort((a, b) => b.cost - a.cost);

  const byStudent = Object.values(byStudentMap).map(data => ({
    ...data,
    totalTokens: data.inputTokens + data.outputTokens,
    costFormatted: Number(data.cost.toFixed(6)),
    percentageOfClass: totalCost > 0 ? (data.cost / totalCost) * 100 : 0,
  })).sort((a, b) => b.cost - a.cost);

  const timeline = Object.values(timelineMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalCost: Number(totalCost.toFixed(6)),
    totalTokens,
    totalInputTokens,
    totalOutputTokens,
    totalJobs,
    completedJobs,
    failedJobs,
    blockedJobs,
    successRate: totalJobs > 0 ? ((completedJobs / totalJobs) * 100) : 100,
    avgCostPerJob: Number(avgCostPerJob.toFixed(6)),
    classQuota,
    quotaPercentage: Number(quotaPercentage.toFixed(3)),
    byJobType,
    byModel,
    byStudent,
    timeline,
    filteredJobs,
  };
}
