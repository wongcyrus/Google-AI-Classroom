import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase-config';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { formatAiCost } from '../utils/formatters';
import { aggregateAiCost } from '../utils/aiCostAggregator';
import { generateAiCostCsv, downloadCsvFile } from '../utils/aiCostCsvExporter';
import './AiCostReportView.css';

const JOB_TYPE_LABELS = {
  analyzeImage: '🖼️ Single Screenshot Analysis',
  analyzeAllImages: '🪟 Multi-Student Grid Analysis',
  analyzeSingleVideo: '🎥 Screencast Video Inspection',
  cloudFallbackFaceAnalysis: '👁️ Cloud Gaze Fallback',
  analyzeAudio: '🎙️ Audio STT & Diarization',
  other: '⚙️ General AI Processing',
};

const MODEL_COLORS = {
  'gemini-3.5-flash-lite': '#0ea5e9',
  'gemini-3.7-flash': '#6366f1',
  'gemini-3.8-flash': '#a855f7',
  'gemini-3.7-pro': '#8b5cf6',
  'gemini-3.5-transcribe': '#10b981',
  'gemini-3.5-transcribe-live': '#f59e0b',
};

const AiCostReportView = ({
  classId = 'N/A',
  className = 'All Classes',
  classQuota = 10,
  aiJobs: propAiJobs,
  students = [],
  onClose,
}) => {
  const [fetchedJobs, setFetchedJobs] = useState([]);
  const [loading, setLoading] = useState(!propAiJobs);
  const [selectedStudent, setSelectedStudent] = useState('all');
  const [selectedJobType, setSelectedJobType] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Firestore listener if propAiJobs is not supplied
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

  const activeJobs = propAiJobs !== undefined ? propAiJobs : fetchedJobs;

  // Compute aggregated summary using pure utility
  const summary = useMemo(() => {
    return aggregateAiCost(activeJobs, {
      studentUid: selectedStudent,
      jobType: selectedJobType,
      model: selectedModel,
      startDate: startDate ? `${startDate}T00:00:00.000Z` : undefined,
      endDate: endDate ? `${endDate}T23:59:59.999Z` : undefined,
      classQuota,
    });
  }, [activeJobs, selectedStudent, selectedJobType, selectedModel, startDate, endDate, classQuota]);

  const handleExportCsv = () => {
    const csvContent = generateAiCostCsv(summary, {
      className,
      classId,
      generatedAt: new Date().toISOString(),
    });
    const filename = `ai_cost_report_${classId}_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCsvFile(csvContent, filename);
  };

  const resetFilters = () => {
    setSelectedStudent('all');
    setSelectedJobType('all');
    setSelectedModel('all');
    setStartDate('');
    setEndDate('');
  };

  return (
    <div className="ai-cost-report-view">
      {/* Header */}
      <div className="ai-cost-header">
        <div className="ai-cost-header-title">
          <h2>📊 AI Cost Breakdown & Audit</h2>
          <p>Real-time token accounting and expenditure analytics for <strong>{className}</strong></p>
        </div>
        <div className="ai-cost-actions">
          <button
            className="btn-export-csv"
            onClick={handleExportCsv}
            disabled={summary.totalJobs === 0}
          >
            📥 Export CSV Report
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                background: '#f1f5f9',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                padding: '0.5rem 0.85rem',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ✕ Close
            </button>
          )}
        </div>
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
            <option value="all">All Job Types</option>
            <option value="analyzeImage">Single Screenshot Analysis</option>
            <option value="analyzeAllImages">Multi-Student Grid Analysis</option>
            <option value="analyzeSingleVideo">Video Screencast Inspection</option>
            <option value="cloudFallbackFaceAnalysis">Cloud Gaze Fallback</option>
            <option value="analyzeAudio">Audio STT & Diarization</option>
          </select>
        </div>

        <div className="filter-group">
          <label htmlFor="ai-model-filter">Model</label>
          <select
            id="ai-model-filter"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            <option value="all">All Models</option>
            <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite</option>
            <option value="gemini-3.7-flash">gemini-3.7-flash</option>
            <option value="gemini-3.8-flash">gemini-3.8-flash</option>
            <option value="gemini-3.7-pro">gemini-3.7-pro</option>
            <option value="gemini-3.5-transcribe">gemini-3.5-transcribe</option>
            <option value="gemini-3.5-transcribe-live">gemini-3.5-transcribe-live</option>
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

        {(selectedStudent !== 'all' || selectedJobType !== 'all' || selectedModel !== 'all' || startDate || endDate) && (
          <button
            onClick={resetFilters}
            style={{
              alignSelf: 'flex-end',
              background: 'none',
              border: 'none',
              color: '#0284c7',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '0.85rem',
              padding: '0.5rem',
            }}
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
            {`Input: ${summary.totalInputTokens.toLocaleString()} | Output: ${summary.totalOutputTokens.toLocaleString()}`}
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

      {/* Breakdowns Grid */}
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
                      backgroundColor: MODEL_COLORS[item.model] || '#6366f1',
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
                  <span>{JOB_TYPE_LABELS[item.jobType] || item.jobType}</span>
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

      {/* Student Usage Table */}
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
    </div>
  );
};

export default AiCostReportView;
