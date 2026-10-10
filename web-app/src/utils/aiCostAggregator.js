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
    classQuota = 10,
    storageData = null,
    storageQuotaBytes = 5 * 1024 * 1024 * 1024,
    storageRatePerGibMonth = 0.023,
    storageRegion = 'asia-east2',
    storageDescription = 'Standard Storage Hong Kong',
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
    let inputTokens = Math.max(
      0,
      Number(
        usage.inputTokens ??
        usage.promptTokenCount ??
        usage.promptTokens ??
        usage.inputTokenCount ??
        0
      )
    );
    let outputTokens = Math.max(
      0,
      Number(
        usage.outputTokens ??
        usage.candidatesTokenCount ??
        usage.completionTokens ??
        usage.outputTokenCount ??
        0
      )
    );

    // If historical/legacy job has recorded cost but omitted token usage in Firestore
    if (cost > 0 && inputTokens === 0 && outputTokens === 0) {
      let modelPricing = { input: 0.30, output: 2.50 };
      if (job.modelUsed?.includes('3.8-flash') || job.modelUsed?.includes('3.7-flash')) {
        modelPricing = { input: 0.75, output: 3.75 };
      } else if (job.modelUsed?.includes('3.7-pro')) {
        modelPricing = { input: 3.00, output: 15.00 };
      } else if (job.modelUsed?.includes('transcribe-live') || job.modelUsed?.includes('live')) {
        modelPricing = { input: 0.60, output: 2.50 };
      } else if (job.modelUsed?.includes('transcribe')) {
        modelPricing = { input: 0.50, output: 2.50 };
      }
      // Typical STT & translation distribution is ~75% input, ~25% output spend
      const estInputSpend = cost * 0.75;
      const estOutputSpend = cost * 0.25;
      inputTokens = Math.round((estInputSpend / modelPricing.input) * 1000000);
      outputTokens = Math.round((estOutputSpend / modelPricing.output) * 1000000);
    }

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
    const isInstructorTask = job.studentUid === 'instructor' || job.studentUid === 'teacher' || job.jobType === 'processLectureSubtitles';
    const sUid = isInstructorTask ? 'instructor' : (job.studentUid || job.uid || job.userId || 'class_wide');
    const sEmail = job.studentEmail || job.email || job.userEmail || job.studentMail || (isInstructorTask ? 'Instructor (Lecture Subtitles & CC)' : (sUid === 'class_wide' ? 'Class-Wide Task' : (sUid.includes('@') ? sUid : 'Unknown Student')));
    const sName = isInstructorTask ? '👨‍🏫 Instructor / Lecture' : (job.displayName || job.studentName || job.name || (sEmail !== 'Unknown Student' ? sEmail : 'Unknown Student'));
    const sClass = job.studentClass || job.cohort || job.class || job.className || '';
    const sProg = job.programme || job.program || '';
    if (!byStudentMap[sUid]) {
      byStudentMap[sUid] = {
        studentUid: sUid,
        studentEmail: sEmail,
        studentName: sName,
        studentClass: sClass,
        programme: sProg,
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

  // Compute Storage Summary if storageData is available
  let storageSummary = null;
  if (storageData && typeof storageData === 'object') {
    const usageShots = Math.max(0, Number(storageData.storageUsageScreenShots) || 0);
    const usageAudio = Math.max(0, Number(storageData.storageUsageAudio) || 0);
    const usageVideos = Math.max(0, Number(storageData.storageUsageVideos) || 0);
    const usageRecordings = Math.max(0, Number(storageData.storageUsageRecordings) || 0);
    const usageZips = Math.max(0, Number(storageData.storageUsageZips) || 0);
    const usageIrregularities = Math.max(0, Number(storageData.storageUsageIrregularities) || 0);
    const usageTasks = Math.max(0, Number(storageData.storageUsageTasks) || 0);
    const usageReports = Math.max(0, Number(storageData.storageUsageReports) || 0);

    const categorySum = usageShots + usageAudio + usageVideos + usageRecordings + usageZips + usageIrregularities + usageTasks + usageReports;
    const totalStorageBytes = Math.max(0, Number(storageData.storageUsage) || 0, categorySum);

    const gibBytes = 1024 * 1024 * 1024;
    const totalStorageCostMonthly = Number(((totalStorageBytes / gibBytes) * storageRatePerGibMonth).toFixed(6));
    const storageQuotaCostMonthly = Number(((storageQuotaBytes / gibBytes) * storageRatePerGibMonth).toFixed(6));
    const storageQuotaPercentage = storageQuotaBytes > 0
      ? Number(Math.min(100, Math.max(0, (totalStorageBytes / storageQuotaBytes) * 100)).toFixed(1))
      : 0;

    const categories = [
      { key: 'screenshots', label: '📸 Routine Screenshots', bytes: usageShots },
      { key: 'audio', label: '🎙️ Classroom Audio Clips', bytes: usageAudio },
      { key: 'videos', label: '🎥 Student Screencast Videos', bytes: usageVideos },
      { key: 'recordings', label: '🎬 Lecture Recordings & Subtitles', bytes: usageRecordings },
      { key: 'zips', label: '📦 Export Archives (ZIP)', bytes: usageZips },
      { key: 'irregularities', label: '⚠️ Invigilation Flagged Clips', bytes: usageIrregularities },
      { key: 'tasks', label: '📝 Lab Tasks & Submissions', bytes: usageTasks },
      { key: 'reports', label: '📑 Incident Dossier Reports', bytes: usageReports },
    ];

    const byStorageCategory = categories.map(cat => {
      const costMonthly = Number(((cat.bytes / gibBytes) * storageRatePerGibMonth).toFixed(6));
      const percentage = totalStorageBytes > 0 ? (cat.bytes / totalStorageBytes) * 100 : 0;
      return {
        ...cat,
        costMonthly,
        percentage: Number(percentage.toFixed(1)),
      };
    }).sort((a, b) => b.bytes - a.bytes);

    storageSummary = {
      totalStorageBytes,
      totalStorageCostMonthly,
      storageQuotaBytes,
      storageQuotaCostMonthly,
      storageQuotaPercentage,
      storageRatePerGibMonth,
      storageRegion,
      storageDescription,
      byStorageCategory,
    };
  }

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
    storageSummary,
    combinedTotalMonthlyCost: storageSummary ? Number((totalCost + storageSummary.totalStorageCostMonthly).toFixed(6)) : totalCost,
  };
}
