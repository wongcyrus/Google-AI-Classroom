import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { formatAiCost, formatBytes, formatStorageCost } from '../utils/formatters';
import { aggregateAiCost } from '../utils/aiCostAggregator';
import { generateAiCostCsv, downloadCsvFile, exportAiCostToExcel } from '../utils/aiCostCsvExporter';
import useCloudPricing from '../hooks/useCloudPricing';
import './AiCostReportView.css';

export const JOB_TYPE_LABELS = {
  analyzeImage: '🖼️ Single Screenshot Analysis',
  analyzeAllImages: '🪟 Multi-Student Grid Analysis',
  analyzeSingleVideo: '🎥 Screencast Video Inspection',
  cloudFallbackFaceAnalysis: '👁️ Cloud Gaze Fallback',
  analyzeAudio: '🎙️ Audio STT & Diarization',
  liveSubtitleStream: '🌐 Gemini Live Subtitle Stream',
  generateBingoQuestion: '🎯 Live Dynamic Bingo Question',
  generateBingoQuestionBank: '📚 Bingo Question Bank Generation',
  generateLabTaskPrompt: '📝 AI Lab Task Prompt Generation',
  processLectureSubtitles: '🎬 Full Lecture Subtitles & Chapters',
  translateTeacherSpeech: '🗣️ Live Teacher Speech Translation',
  evaluateTaskSubmission: '📋 Lab Task Automated Evaluation',
  extractTaskDemoSteps: '🎬 Task Demo Video Step Extraction',
  batchVideoAnalysis: '🎞️ Batch Video Analysis Job',
  other: '⚙️ General AI Processing',
};

export const getJobTypeLabel = (jobType) => {
  if (!jobType) return '⚙️ General AI Processing';
  if (JOB_TYPE_LABELS[jobType]) return JOB_TYPE_LABELS[jobType];
  const readable = jobType
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, str => str.toUpperCase())
    .trim();
  return `⚙️ ${readable}`;
};

export const MODEL_COLORS = {
  'gemini-3.5-flash-lite': '#0ea5e9',
  'gemini-3.8-flash': '#a855f7',
  'gemini-3.7-flash': '#8b5cf6',
  'gemini-3.7-pro': '#ec4899',
  'gemini-3.5-transcribe': '#10b981',
  'gemini-3.5-transcribe-preview': '#059669',
  'gemini-3.5-transcribe-live': '#f59e0b',
  'gemini-3.5-transcribe-live-preview': '#d97706',
  'gemini-3.1-flash-live-preview': '#ef4444',
  'gemini-2.5-flash': '#3b82f6',
  'gemini-2.0-flash': '#06b6d4',
  'gemini-1.5-flash': '#64748b',
};

export const getModelColor = (modelName) => {
  if (!modelName) return '#0ea5e9';
  if (MODEL_COLORS[modelName]) return MODEL_COLORS[modelName];
  if (modelName.includes('+')) return '#6366f1';
  return '#64748b';
};

const AiCostReportView = ({
  classId = 'N/A',
  className = 'All Classes',
  classQuota = 10,
  storageQuotaBytes: propStorageQuotaBytes,
  storageData: propStorageData,
  aiJobs: propAiJobs,
  students = [],
  onClose,
}) => {
  const [fetchedJobs, setFetchedJobs] = useState([]);
  const [fetchedClassData, setFetchedClassData] = useState(null);
  const [loading, setLoading] = useState(!propAiJobs);
  const [selectedStudent, setSelectedStudent] = useState('all');
  const [selectedJobType, setSelectedJobType] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'ai' | 'storage'

  // Live Cloud Billing pricing hook
  const {
    storageRatePerGibMonth,
    storageRegion,
    storageDescription,
    lastSyncedAt,
  } = useCloudPricing();

  // Firestore listener for aiJobs if propAiJobs is not supplied
  useEffect(() => {
    if (propAiJobs !== undefined) {
      setFetchedJobs(propAiJobs);
      setLoading(false);
      return;
    }

    if (!classId || classId === 'N/A') {
      setFetchedJobs([]);
      setLoading(false);
      return;
    }

    const aiJobsRef = collection(db, 'aiJobs');
    const q = query(aiJobsRef, where('classId', '==', classId));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const jobs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFetchedJobs(jobs);
      setLoading(false);
    }, (err) => {
      console.warn('Error fetching aiJobs for class:', err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [classId, propAiJobs]);

  // Firestore listener for class storage metadata if propStorageData is not supplied
  useEffect(() => {
    if (propStorageData !== undefined || !classId || classId === 'N/A') {
      return;
    }

    const classRef = doc(db, 'classes', classId);
    const unsubscribe = onSnapshot(classRef, (snap) => {
      if (snap.exists && snap.exists()) {
        setFetchedClassData(snap.data());
      }
    }, (err) => {
      console.warn('Error fetching class storage metadata:', err);
    });

    return () => unsubscribe();
  }, [classId, propStorageData]);

  const activeJobs = propAiJobs !== undefined ? propAiJobs : fetchedJobs;
  const activeStorageData = propStorageData !== undefined ? propStorageData : fetchedClassData;
  const effectiveStorageQuotaBytes = propStorageQuotaBytes || Number(activeStorageData?.storageQuota) || (5 * 1024 * 1024 * 1024);

  // Compute dynamic models present in active jobs + common supported models
  const availableModels = useMemo(() => {
    const modelSet = new Set([
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.7-pro',
      'gemini-3.5-transcribe',
      'gemini-3.5-transcribe-preview',
      'gemini-3.5-transcribe-live',
      'gemini-3.1-flash-live-preview',
    ]);
    activeJobs.forEach((j) => {
      if (j?.modelUsed) modelSet.add(j.modelUsed);
    });
    return Array.from(modelSet).sort();
  }, [activeJobs]);

  // Compute dynamic job types present in active jobs + standard registry
  const availableJobTypes = useMemo(() => {
    const typeSet = new Set(Object.keys(JOB_TYPE_LABELS));
    activeJobs.forEach((j) => {
      if (j?.jobType) typeSet.add(j.jobType);
    });
    return Array.from(typeSet);
  }, [activeJobs]);

  // Compute aggregated summary using pure utility
  const summary = useMemo(() => {
    return aggregateAiCost(activeJobs, {
      studentUid: selectedStudent,
      jobType: selectedJobType,
      model: selectedModel,
      startDate: startDate ? `${startDate}T00:00:00.000Z` : undefined,
      endDate: endDate ? `${endDate}T23:59:59.999Z` : undefined,
      classQuota,
      storageData: activeStorageData,
      storageQuotaBytes: effectiveStorageQuotaBytes,
      storageRatePerGibMonth,
      storageRegion,
      storageDescription,
    });
  }, [
    activeJobs,
    selectedStudent,
    selectedJobType,
    selectedModel,
    startDate,
    endDate,
    classQuota,
    activeStorageData,
    effectiveStorageQuotaBytes,
    storageRatePerGibMonth,
    storageRegion,
    storageDescription
  ]);

  const handleExportExcel = () => {
    exportAiCostToExcel(summary, {
      className,
      classId,
      generatedAt: new Date().toISOString(),
    });
  };

  const handleExportCsv = () => {
    const csvContent = generateAiCostCsv(summary, {
      className,
      classId,
      generatedAt: new Date().toISOString(),
    });
    downloadCsvFile(csvContent, `cost_report_${classId}_${new Date().toISOString().split('T')[0]}.csv`);
  };

  const resetFilters = () => {
    setSelectedStudent('all');
    setSelectedJobType('all');
    setSelectedModel('all');
    setStartDate('');
    setEndDate('');
  };

  const hasActiveFilters = selectedStudent !== 'all' || selectedJobType !== 'all' || selectedModel !== 'all' || startDate || endDate;

  return (
    <div className="ai-cost-report-view">
      {/* Header */}
      <div className="ai-cost-header">
        <div className="ai-cost-header-title">
          <h2>📊 AI Cost Breakdown & Audit</h2>
          <p>
            Real-time token accounting, Gemini models, and Cloud Storage run-rate for <strong>{className}</strong>
          </p>
          <div className="pricing-badge-row">
            <span
              className="pricing-badge"
              title={`Live storage rate from Cloud Billing Catalog API (${storageDescription || 'Standard Storage'})`}
            >
              🏷️ Storage: ${storageRatePerGibMonth}/GiB-mo ({storageRegion})
            </span>
            {lastSyncedAt && (
              <span className="pricing-badge-sync">
                Synced: {new Date(lastSyncedAt).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>

        <div className="ai-cost-actions">
          <button
            className="btn-export-csv"
            onClick={handleExportExcel}
            disabled={summary.totalJobs === 0 && !summary.storageSummary}
            title="Download full audit report as Microsoft Excel workbook"
          >
            📥 Export Excel Report
          </button>
          <button
            className="btn-export-secondary"
            onClick={handleExportCsv}
            disabled={summary.totalJobs === 0 && !summary.storageSummary}
            title="Download RFC 4180 CSV export"
          >
            📄 Export CSV
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="btn-close-report"
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="cost-report-tabs">
        <button
          className={`cost-tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          🌐 Cloud Overview
        </button>
        <button
          className={`cost-tab ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          🤖 AI Model & Token Audit ({summary.totalJobs})
        </button>
        <button
          className={`cost-tab ${activeTab === 'storage' ? 'active' : ''}`}
          onClick={() => setActiveTab('storage')}
        >
          💾 Cloud Storage Breakdown ({formatBytes(summary.storageSummary?.totalStorageBytes || 0)})
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="ai-cost-filters">
        <div className="filter-group">
          <label htmlFor="ai-student-filter">Student</label>
          <select
            id="ai-student-filter"
            value={selectedStudent}
            onChange={(e) => setSelectedStudent(e.target.value)}
          >
            <option value="all">All Students</option>
            {students.map((s) => (
              <option key={s.uid || s.id} value={s.uid || s.id}>
                {s.email || s.name || s.uid}
              </option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="ai-jobtype-filter">Job Type</label>
          <select
            id="ai-jobtype-filter"
            value={selectedJobType}
            onChange={(e) => setSelectedJobType(e.target.value)}
          >
            <option value="all">All Job Types ({availableJobTypes.length})</option>
            {availableJobTypes.map((key) => (
              <option key={key} value={key}>{getJobTypeLabel(key)}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="ai-model-filter">Model</label>
          <select
            id="ai-model-filter"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            <option value="all">All Models ({availableModels.length})</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="ai-start-date">From Date</label>
          <input
            id="ai-start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>

        <div className="filter-group">
          <label htmlFor="ai-end-date">To Date</label>
          <input
            id="ai-end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>

        {hasActiveFilters && (
          <button
            onClick={resetFilters}
            className="btn-reset-filters"
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="ai-cost-kpis">
        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Total AI Spend</span>
            <span>💳</span>
          </div>
          <div className="kpi-value">{formatAiCost(summary.totalCost)}</div>
          <div className="kpi-subtext">
            {`${summary.quotaPercentage}% of $${classQuota.toFixed(2)} budget limit`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Est. Monthly Storage</span>
            <span>💾</span>
          </div>
          <div className="kpi-value">
            {formatStorageCost(summary.storageSummary?.totalStorageBytes || 0, storageRatePerGibMonth)}/mo
          </div>
          <div className="kpi-subtext">
            {formatBytes(summary.storageSummary?.totalStorageBytes || 0)} used ({summary.storageSummary?.storageQuotaPercentage || 0}% of {formatBytes(effectiveStorageQuotaBytes)})
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Combined Cloud Run-Rate</span>
            <span>🌐</span>
          </div>
          <div className="kpi-value">
            {formatAiCost(summary.combinedTotalMonthlyCost)}
          </div>
          <div className="kpi-subtext">
            AI Budget Spend + Monthly GCS Run-Rate
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Token Consumption</span>
            <span>🔢</span>
          </div>
          <div className="kpi-value">
            {summary.totalTokens >= 1000000
              ? `${(summary.totalTokens / 1000000).toFixed(2)}M`
              : summary.totalTokens >= 1000
              ? `${(summary.totalTokens / 1000).toFixed(1)}k`
              : summary.totalTokens}
          </div>
          <div className="kpi-subtext">
            {`In: ${summary.totalInputTokens.toLocaleString()} | Out: ${summary.totalOutputTokens.toLocaleString()}`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Job Volume</span>
            <span>⚡</span>
          </div>
          <div className="kpi-value">{summary.totalJobs}</div>
          <div className="kpi-subtext">
            {`${summary.completedJobs} completed (${summary.successRate.toFixed(1)}% success)`}
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-card-header">
            <span>Unit Economics</span>
            <span>🏷️</span>
          </div>
          <div className="kpi-value">{formatAiCost(summary.avgCostPerJob)}</div>
          <div className="kpi-subtext">Average cost per analyzed job</div>
        </div>
      </div>

      {/* Tab Content: Overview or AI */}
      {(activeTab === 'overview' || activeTab === 'ai') && (
        <div className="ai-cost-breakdowns">
          {/* Model Breakdown */}
          <div className="breakdown-section">
            <h3>🤖 Spend by Gemini Model</h3>
            {summary.byModel.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No AI jobs executed for this filter.</p>
            ) : (
              summary.byModel.map((item) => (
                <div key={item.model} className="breakdown-item">
                  <div className="breakdown-item-header">
                    <span>{item.model}</span>
                    <span>{formatAiCost(item.cost)} ({item.percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="breakdown-progress-track">
                    <div
                      className="breakdown-progress-fill"
                      style={{
                        width: `${Math.max(item.percentage, 2)}%`,
                        backgroundColor: getModelColor(item.model),
                      }}
                    />
                  </div>
                  <div className="breakdown-item-sub">
                    <span>{item.count} jobs</span>
                    <span>{(item.inputTokens + item.outputTokens).toLocaleString()} tokens</span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Job Type Breakdown */}
          <div className="breakdown-section">
            <h3>📋 Spend by Job Category</h3>
            {summary.byJobType.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No AI jobs executed for this filter.</p>
            ) : (
              summary.byJobType.map((item) => (
                <div key={item.jobType} className="breakdown-item">
                  <div className="breakdown-item-header">
                    <span>{getJobTypeLabel(item.jobType)}</span>
                    <span>{formatAiCost(item.cost)} ({item.percentage.toFixed(1)}%)</span>
                  </div>
                  <div className="breakdown-progress-track">
                    <div
                      className="breakdown-progress-fill"
                      style={{
                        width: `${Math.max(item.percentage, 2)}%`,
                        backgroundColor: '#3b82f6',
                      }}
                    />
                  </div>
                  <div className="breakdown-item-sub">
                    <span>{item.count} jobs</span>
                    <span>{(item.inputTokens + item.outputTokens).toLocaleString()} tokens</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Tab Content: Overview or Storage */}
      {(activeTab === 'overview' || activeTab === 'storage') && summary.storageSummary && (
        <div className="storage-cost-section">
          <div className="breakdown-section">
            <h3>💾 Cloud Storage Expenditure by Asset Category</h3>
            <div className="storage-summary-meta">
              <span><strong>Total Allocated:</strong> {formatBytes(summary.storageSummary.totalStorageBytes)} / {formatBytes(summary.storageSummary.storageQuotaBytes)} ({summary.storageSummary.storageQuotaPercentage}%)</span>
              <span><strong>Est. Monthly Run-Rate:</strong> ~{formatStorageCost(summary.storageSummary.totalStorageBytes, storageRatePerGibMonth)}/mo</span>
            </div>

            <div className="storage-category-grid">
              {(summary.storageSummary.byStorageCategory || []).map((cat) => (
                <div key={cat.key} className="breakdown-item">
                  <div className="breakdown-item-header">
                    <span>{cat.label}</span>
                    <span>{formatBytes(cat.bytes)} (~{formatStorageCost(cat.bytes, storageRatePerGibMonth)}/mo)</span>
                  </div>
                  <div className="breakdown-progress-track">
                    <div
                      className="breakdown-progress-fill"
                      style={{
                        width: `${Math.max(cat.percentage, 1)}%`,
                        backgroundColor: cat.key === 'screenshots' ? '#3b82f6' :
                          cat.key === 'audio' ? '#10b981' :
                          cat.key === 'videos' ? '#8b5cf6' :
                          cat.key === 'recordings' ? '#f59e0b' :
                          cat.key === 'zips' ? '#06b6d4' :
                          cat.key === 'irregularities' ? '#ef4444' :
                          cat.key === 'tasks' ? '#6366f1' : '#ec4899',
                      }}
                    />
                  </div>
                  <div className="breakdown-item-sub">
                    <span>{cat.percentage}% of storage</span>
                    <span>Rate: ${storageRatePerGibMonth}/GiB-mo</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Student Usage Table */}
      {(activeTab === 'overview' || activeTab === 'ai') && (
        <div className="ai-cost-table-section">
          <h3>🎓 Student AI Consumption Matrix</h3>
          {summary.byStudent.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>No student jobs recorded.</p>
          ) : (
            <div className="ai-cost-table-container">
              <table className="ai-cost-table">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Jobs</th>
                    <th>Input Tokens</th>
                    <th>Output Tokens</th>
                    <th>Total Tokens</th>
                    <th>Total Cost</th>
                    <th>% of Class Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.byStudent.map((st) => (
                    <tr key={st.studentUid}>
                      <td><strong>{st.studentEmail}</strong></td>
                      <td>{st.jobCount}</td>
                      <td>{st.inputTokens.toLocaleString()}</td>
                      <td>{st.outputTokens.toLocaleString()}</td>
                      <td>{st.totalTokens.toLocaleString()}</td>
                      <td><span style={{ fontWeight: 600, color: '#0f172a' }}>{formatAiCost(st.cost)}</span></td>
                      <td>{st.percentageOfClass.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AiCostReportView;
