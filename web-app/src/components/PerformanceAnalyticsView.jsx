import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase-config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from 'recharts';
import { exportToCsv } from '../utils/exportUtils';
import './PerformanceAnalyticsView.css';

/**
 * Normalizes slightly varying AI-generated task labels into clean canonical milestones.
 */
export const normalizeMilestoneName = (rawName) => {
  if (!rawName || typeof rawName !== 'string') return 'General Task';
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();

  const taskNumMatch = trimmed.match(/^task\s*([0-9]+)[:.-]?\s*(.*)$/i);

  if (lower.includes('mfa') || lower.includes('account setup') || lower.includes('subscription activation') || (taskNumMatch && taskNumMatch[1] === '1')) {
    return 'Task 1: Account Setup & MFA';
  }
  if (lower.includes('cloudshell') || lower.includes('aws academy') || lower.includes('lab 2.1') || (taskNumMatch && taskNumMatch[1] === '2')) {
    return 'Task 2: AWS CloudShell & IDE';
  }
  if (lower.includes('devops') || lower.includes('assignment 2') || (taskNumMatch && taskNumMatch[1] === '3')) {
    return 'Task 3: DevOps Assignment 2';
  }
  if (lower.includes('isekai') || lower.includes('gamified portal') || (taskNumMatch && taskNumMatch[1] === '4')) {
    return 'Task 4: Azure Isekai Portal';
  }

  if (taskNumMatch) {
    const num = taskNumMatch[1];
    const rest = taskNumMatch[2].replace(/\(.*\)/, '').trim();
    return `Task ${num}: ${rest || 'Milestone ' + num}`;
  }

  return trimmed.replace(/\s+/g, ' ');
};

const PerformanceAnalyticsView = ({
  classId: propClassId,
  startTime,
  endTime,
  lessons,
  selectedLesson,
  timezone,
  handleLessonChange,
}) => {
  let routeParams = {};
  try {
    routeParams = useParams() || {};
  } catch (e) {
    routeParams = {};
  }
  const classId = propClassId || routeParams.classId;

  const [loading, setLoading] = useState(true);
  const [allMetrics, setAllMetrics] = useState([]);
  const [classInfo, setClassInfo] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'email', direction: 'asc' });

  // Derive matched lesson and effective time window from shared top filter
  const matchedLesson = useMemo(() => {
    if (selectedLesson && lessons?.length) {
      return lessons.find((l) => l.start && l.start.toISOString() === selectedLesson);
    }
    return null;
  }, [selectedLesson, lessons]);

  const effectiveStart = useMemo(() => {
    if (matchedLesson?.start) return matchedLesson.start;
    if (startTime) {
      const d = new Date(startTime);
      return !isNaN(d.getTime()) ? d : null;
    }
    return null;
  }, [matchedLesson, startTime]);

  const effectiveEnd = useMemo(() => {
    if (matchedLesson?.end) return matchedLesson.end;
    if (endTime) {
      const d = new Date(endTime);
      return !isNaN(d.getTime()) ? d : null;
    }
    return null;
  }, [matchedLesson, endTime]);

  // Fetch Class Roster and Performance Metrics for class
  const fetchData = async () => {
    if (!classId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      // 1. Fetch Class Info for student roster
      try {
        const classRef = doc(db, 'classes', classId);
        const classSnap = await getDoc(classRef);
        if (classSnap.exists && classSnap.exists()) {
          setClassInfo(classSnap.data());
        }
      } catch (err) {
        console.warn('Could not load class info:', err);
      }

      // 2. Fetch Performance Metrics
      const q = query(
        collection(db, 'performanceMetrics'),
        where('classId', '==', classId),
        where('status', '==', 'completed')
      );

      const querySnapshot = await getDocs(q);
      const data = querySnapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllMetrics(data);
    } catch (error) {
      console.error('Error fetching performance data: ', error);
      setAllMetrics([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [classId]);

  // Filter metrics dynamically based on active lesson / date range
  const metrics = useMemo(() => {
    if (!allMetrics || allMetrics.length === 0) return [];
    if (!effectiveStart || !effectiveEnd) {
      // No lesson or custom date range selected -> Show all recorded class data
      return allMetrics;
    }

    // 15-minute grace padding before and after lesson boundary
    const padStart = new Date(effectiveStart.getTime() - 15 * 60 * 1000);
    const padEnd = new Date(effectiveEnd.getTime() + 15 * 60 * 1000);

    return allMetrics.filter(m => {
      const metricDate = m.startTime?.toDate ? m.startTime.toDate()
        : m.startTime ? new Date(m.startTime)
        : m.timestamp?.toDate ? m.timestamp.toDate()
        : m.timestamp ? new Date(m.timestamp)
        : null;

      if (!metricDate) return true;
      return metricDate >= padStart && metricDate <= padEnd;
    });
  }, [allMetrics, effectiveStart, effectiveEnd]);

  // Student Mapping & Aggregations
  const {
    activeMilestones,
    studentRoster,
    milestoneStats,
    kpis,
  } = useMemo(() => {
    const studentMap = classInfo?.students || {};
    const studentUidsSet = new Set(Object.keys(studentMap));

    // Register any student UIDs appearing in metrics
    metrics.forEach(m => {
      if (m.studentUid) studentUidsSet.add(m.studentUid);
    });

    // Detect unique normalized milestones
    const milestoneSet = new Set();
    metrics.forEach(m => {
      const normalized = normalizeMilestoneName(m.taskName);
      milestoneSet.add(normalized);
    });

    const activeMilestones = Array.from(milestoneSet).sort((a, b) => {
      const matchA = a.match(/Task\s*(\d+)/i);
      const matchB = b.match(/Task\s*(\d+)/i);
      if (matchA && matchB) return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
      return a.localeCompare(b);
    });

    // Per-student task mapping
    const studentDataMap = {};
    studentUidsSet.forEach(uid => {
      studentDataMap[uid] = {
        studentUid: uid,
        email: studentMap[uid] || uid,
        tasks: {},
        totalMinutes: 0,
        completedCount: 0,
        needsAttention: false,
      };
    });

    metrics.forEach(m => {
      const uid = m.studentUid;
      if (!uid) return;
      if (!studentDataMap[uid]) {
        studentDataMap[uid] = {
          studentUid: uid,
          email: studentMap[uid] || uid,
          tasks: {},
          totalMinutes: 0,
          completedCount: 0,
          needsAttention: false,
        };
      }
      const normalizedTask = normalizeMilestoneName(m.taskName);
      const durationMins = Math.max(1, Math.round((m.duration || 0) / 60));
      // Accumulate or assign max
      studentDataMap[uid].tasks[normalizedTask] = (studentDataMap[uid].tasks[normalizedTask] || 0) + durationMins;
    });

    // Calculate milestone averages
    const milestoneStats = activeMilestones.map(milestone => {
      let totalMins = 0;
      let count = 0;
      let minMins = Infinity;
      let maxMins = 0;

      Object.values(studentDataMap).forEach(s => {
        if (s.tasks[milestone]) {
          const mins = s.tasks[milestone];
          totalMins += mins;
          count += 1;
          if (mins < minMins) minMins = mins;
          if (mins > maxMins) maxMins = mins;
        }
      });

      const avgMinutes = count > 0 ? Math.round(totalMins / count) : 0;
      const totalStudents = studentUidsSet.size || 1;
      const completionPct = Math.round((count / totalStudents) * 100);

      return {
        taskName: milestone,
        displayName: milestone.length > 25 ? milestone.substring(0, 22) + '...' : milestone,
        avgMinutes,
        studentCount: count,
        minMinutes: minMins === Infinity ? 0 : minMins,
        maxMinutes: maxMins,
        completionPct,
      };
    });

    // Update each student's totalMinutes, completedCount, and needsAttention
    let totalAllMinutes = 0;
    let completedAllCount = 0;
    let studentsWithMetricsCount = 0;

    Object.values(studentDataMap).forEach(s => {
      const studentTasks = Object.keys(s.tasks);
      s.completedCount = studentTasks.length;
      s.totalMinutes = Object.values(s.tasks).reduce((acc, curr) => acc + curr, 0);

      if (s.completedCount > 0) {
        studentsWithMetricsCount += 1;
        totalAllMinutes += s.totalMinutes;
      }

      if (activeMilestones.length > 0 && s.completedCount >= activeMilestones.length) {
        completedAllCount += 1;
      }

      // Check if student took > 1.5x average on any task
      activeMilestones.forEach(m => {
        const stat = milestoneStats.find(item => item.taskName === m);
        if (stat && stat.avgMinutes > 0 && s.tasks[m]) {
          if (s.tasks[m] >= stat.avgMinutes * 1.5) {
            s.needsAttention = true;
          }
        }
      });
    });

    const studentRoster = Object.values(studentDataMap).sort((a, b) => b.totalMinutes - a.totalMinutes);

    // Class KPIs
    const avgTotalMinutes = studentsWithMetricsCount > 0
      ? Math.round(totalAllMinutes / studentsWithMetricsCount)
      : 0;

    const totalStudentsCount = studentUidsSet.size || 1;
    const completionRate = Math.round((completedAllCount / totalStudentsCount) * 100);

    let primaryBottleneck = 'None';
    let maxAvg = 0;
    milestoneStats.forEach(m => {
      if (m.avgMinutes > maxAvg) {
        maxAvg = m.avgMinutes;
        primaryBottleneck = `${m.taskName} (${m.avgMinutes}m)`;
      }
    });

    const studentsNeedingHelpCount = studentRoster.filter(s => s.needsAttention).length;

    return {
      activeMilestones,
      studentRoster,
      milestoneStats,
      kpis: {
        avgTotalMinutes,
        completionRate,
        completedAllCount,
        totalStudentsCount,
        primaryBottleneck,
        studentsNeedingHelpCount,
      },
    };
  }, [metrics, classInfo]);

  // Filtered Roster for Table
  const filteredStudents = useMemo(() => {
    return studentRoster.filter(s => {
      const matchesSearch = s.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
                            s.studentUid.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (statusFilter === 'completed') {
        return activeMilestones.length > 0 && s.completedCount >= activeMilestones.length;
      }
      if (statusFilter === 'inprogress') {
        return s.completedCount > 0 && s.completedCount < activeMilestones.length;
      }
      if (statusFilter === 'attention') {
        return s.needsAttention;
      }
      return true;
    });
  }, [studentRoster, searchQuery, statusFilter, activeMilestones]);

  // Sort handler
  const handleSort = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  // Sorted and Filtered Students for Table and CSV Export
  const sortedStudents = useMemo(() => {
    const list = [...filteredStudents];
    list.sort((a, b) => {
      let aVal, bVal;
      if (sortConfig.key === 'email') {
        aVal = (a.email || '').toLowerCase();
        bVal = (b.email || '').toLowerCase();
        return sortConfig.direction === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      } else if (sortConfig.key === 'totalMinutes') {
        aVal = a.totalMinutes || 0;
        bVal = b.totalMinutes || 0;
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      } else if (sortConfig.key === 'status') {
        aVal = a.completedCount || 0;
        bVal = b.completedCount || 0;
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      } else {
        // Sort by milestone duration
        const taskKey = sortConfig.key;
        aVal = a.tasks[taskKey];
        bVal = b.tasks[taskKey];
        if (aVal === undefined && bVal === undefined) return 0;
        if (aVal === undefined) return 1;
        if (bVal === undefined) return -1;
        return sortConfig.direction === 'asc' ? aVal - bVal : bVal - aVal;
      }
    });
    return list;
  }, [filteredStudents, sortConfig]);

  // Export CSV
  const handleExportCsv = (customList = null) => {
    const listToExport = customList || studentRoster;
    if (listToExport.length === 0) {
      alert('No student data to export.');
      return;
    }

    const headers = ['Student Email', 'Student UID', ...activeMilestones, 'Total Minutes', 'Completed Milestones', 'Status'];
    const rows = listToExport.map(s => {
      const taskValues = activeMilestones.map(m => s.tasks[m] ? `${s.tasks[m]} min` : 'N/A');
      const isComplete = activeMilestones.length > 0 && s.completedCount >= activeMilestones.length;
      const statusText = isComplete ? 'Complete' : s.needsAttention ? 'Needs Attention' : s.completedCount > 0 ? 'In Progress' : 'Not Started';

      return [
        s.email,
        s.studentUid,
        ...taskValues,
        s.totalMinutes,
        `${s.completedCount}/${activeMilestones.length}`,
        statusText,
      ];
    });

    const dateSuffix = matchedLesson
      ? matchedLesson.start.toISOString().split('T')[0]
      : effectiveStart
      ? effectiveStart.toISOString().split('T')[0]
      : 'All';
    const isFiltered = listToExport.length !== studentRoster.length;
    const filename = isFiltered
      ? `Class_${classId}_Milestone_Matrix_Filtered_${dateSuffix}.csv`
      : `Class_${classId}_Milestone_Matrix_${dateSuffix}.csv`;
    exportToCsv(headers, rows, filename);
  };

  if (loading) {
    return <div className="perf-analytics-container"><p>Loading performance analytics...</p></div>;
  }

  return (
    <div className="perf-analytics-container">
      {/* Header & Controls */}
      <div className="perf-header">
        <div className="perf-header-titles">
          <h2>🎯 Lab Performance & Mastery Analytics</h2>
          <p>
            Real-time student pacing, milestone duration analysis, and bottleneck detection synthesized from AI screen video inspections.
          </p>
        </div>
        <div className="perf-header-actions">
          {matchedLesson ? (
            <div className="perf-filter-indicator">
              <span>📅 Filtered by Lesson:</span>
              <strong>
                {matchedLesson.start.toLocaleDateString()} ({matchedLesson.start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {matchedLesson.end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})})
              </strong>
            </div>
          ) : effectiveStart && effectiveEnd ? (
            <div className="perf-filter-indicator">
              <span>📅 Date Range:</span>
              <strong>
                {effectiveStart.toLocaleDateString()} - {effectiveEnd.toLocaleDateString()}
              </strong>
            </div>
          ) : (
            <div className="perf-filter-indicator">
              <span>🌐 Scope:</span>
              <strong>All Recorded Sessions</strong>
            </div>
          )}
          <button className="perf-action-btn" onClick={() => handleExportCsv()} style={{ background: '#ffffff', color: '#0f172a', fontWeight: 600 }}>
            📥 Export CSV
          </button>
          <button className="perf-action-btn" onClick={fetchData} style={{ background: '#ffffff', color: '#0f172a', fontWeight: 600 }}>
            🔄 Refresh
          </button>
        </div>
      </div>

      {metrics.length === 0 ? (
        <div className="perf-empty-state">
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>📊</div>
          <h3>No Performance Data Found</h3>
          <p>
            {matchedLesson || (effectiveStart && effectiveEnd)
              ? 'No performance metrics recorded for the selected lesson window.'
              : 'No performance data has been collected yet. Data will appear here as the AI analyzes student activity.'}
          </p>
          {(matchedLesson || (effectiveStart && effectiveEnd)) && handleLessonChange && (
            <button
              className="perf-action-btn"
              style={{ background: '#2563eb', color: '#fff', border: 'none', marginTop: '10px' }}
              onClick={() => handleLessonChange({ target: { value: '' } })}
            >
              🌐 View All Recorded Class Data
            </button>
          )}
        </div>
      ) : (
        <>
          {/* KPI Summary Cards */}
          <div className="perf-kpi-grid">
            <div className="perf-kpi-card blue">
              <div className="perf-kpi-label">Avg Total Duration</div>
              <div className="perf-kpi-value">{kpis.avgTotalMinutes}m</div>
              <div className="perf-kpi-subtext">Across all completed lab milestones</div>
            </div>

            <div className="perf-kpi-card green">
              <div className="perf-kpi-label">Lab Completion Rate</div>
              <div className="perf-kpi-value">{kpis.completionRate}%</div>
              <div className="perf-kpi-subtext">
                {kpis.completedAllCount} of {kpis.totalStudentsCount} students completed all tasks
              </div>
            </div>

            <div className="perf-kpi-card amber">
              <div className="perf-kpi-label">Primary Bottleneck</div>
              <div className="perf-kpi-value" style={{ fontSize: '1.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {kpis.primaryBottleneck}
              </div>
              <div className="perf-kpi-subtext">Highest average task time</div>
            </div>

            <div className="perf-kpi-card purple">
              <div className="perf-kpi-label">Needs Attention</div>
              <div className="perf-kpi-value">{kpis.studentsNeedingHelpCount}</div>
              <div className="perf-kpi-subtext">Students exceeding 1.5x class average</div>
            </div>
          </div>

          {/* Charts Section */}
          <div className="perf-charts-grid">
            {/* Chart 1: Average Duration per Milestone */}
            <div className="perf-chart-card">
              <h3>Average Time per Milestone</h3>
              <p>Mean duration spent by students on each discrete lab task (in minutes).</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={milestoneStats} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="displayName" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis label={{ value: 'Minutes', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, name, item) => [
                      `${value} mins (by ${item.payload.studentCount} students)`,
                      'Average Time',
                    ]}
                  />
                  <Bar dataKey="avgMinutes" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Chart 2: Milestone Completion Funnel */}
            <div className="perf-chart-card">
              <h3>Milestone Completion Progress</h3>
              <p>Percentage of enrolled students who successfully finished each task.</p>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={milestoneStats} margin={{ top: 10, right: 20, left: 0, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="displayName" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={45} />
                  <YAxis domain={[0, 100]} label={{ value: '% Students', angle: -90, position: 'insideLeft', fontSize: 12 }} />
                  <Tooltip formatter={(value) => [`${value}%`, 'Completion Rate']} />
                  <Bar dataKey="completionPct" radius={[4, 4, 0, 0]}>
                    {milestoneStats.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={entry.completionPct >= 80 ? '#10b981' : entry.completionPct >= 50 ? '#3b82f6' : '#f59e0b'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Student Milestone Matrix Table */}
          <div className="perf-matrix-card">
            <div className="perf-matrix-header">
              <div>
                <h3>Student Milestone Matrix</h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.82rem', color: '#64748b' }}>
                  Individual student durations and pacing breakdown across all detected coursework milestones.
                </p>
              </div>
              <div className="perf-matrix-controls">
                <input
                  type="text"
                  placeholder="Search by student email..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="perf-search-input"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="perf-filter-select"
                >
                  <option value="all">All Statuses ({studentRoster.length})</option>
                  <option value="completed">Completed All Tasks ({kpis.completedAllCount})</option>
                  <option value="inprogress">In Progress</option>
                  <option value="attention">Needs Attention ({kpis.studentsNeedingHelpCount})</option>
                </select>
                <button
                  className="perf-action-btn"
                  style={{
                    padding: '6px 14px',
                    whiteSpace: 'nowrap',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontWeight: 600,
                    background: '#ffffff',
                    color: '#0f172a'
                  }}
                  onClick={() => handleExportCsv(sortedStudents)}
                  disabled={sortedStudents.length === 0}
                  title="Export the Student Milestone Matrix table as CSV"
                >
                  📥 Export Matrix CSV ({sortedStudents.length})
                </button>
              </div>
            </div>

            <div className="perf-table-wrapper">
              <table className="perf-table">
                <thead>
                  <tr>
                    <th
                      onClick={() => handleSort('email')}
                      style={{ cursor: 'pointer', userSelect: 'none', minWidth: '180px' }}
                      title="Click to sort by Student Email"
                    >
                      Student {sortConfig.key === 'email' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </th>
                    {activeMilestones.map(m => (
                      <th
                        key={m}
                        onClick={() => handleSort(m)}
                        style={{ maxWidth: '160px', cursor: 'pointer', userSelect: 'none' }}
                        title={`Click to sort by ${m} duration`}
                      >
                        {m} {sortConfig.key === m ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                      </th>
                    ))}
                    <th
                      onClick={() => handleSort('totalMinutes')}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title="Click to sort by Total Lab Time"
                    >
                      Total Lab Time {sortConfig.key === 'totalMinutes' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </th>
                    <th
                      onClick={() => handleSort('status')}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                      title="Click to sort by Status"
                    >
                      Status {sortConfig.key === 'status' ? (sortConfig.direction === 'asc' ? '▲' : '▼') : '↕'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedStudents.length === 0 ? (
                    <tr>
                      <td colSpan={activeMilestones.length + 3} style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                        No students matching the current filter.
                      </td>
                    </tr>
                  ) : (
                    sortedStudents.map(student => {
                      const isComplete = activeMilestones.length > 0 && student.completedCount >= activeMilestones.length;
                      return (
                        <tr key={student.studentUid}>
                          <td>
                            <div style={{ fontWeight: 600, color: '#0f172a' }}>{student.email}</div>
                            <div style={{ fontSize: '0.74rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                              {student.studentUid}
                            </div>
                          </td>
                          {activeMilestones.map(m => {
                            const duration = student.tasks[m];
                            const stat = milestoneStats.find(item => item.taskName === m);
                            const isOutlier = stat && stat.avgMinutes > 0 && duration >= stat.avgMinutes * 1.5;

                            if (!duration) {
                              return (
                                <td key={m} style={{ color: '#94a3b8', background: '#f8fafc', textAlign: 'center' }}>
                                  —
                                </td>
                              );
                            }

                            // Heatmap styling based on duration and outlier status
                            let cellBg = '#ecfdf5'; // on-track green (< 20m)
                            let cellColor = '#065f46';
                            let cellBorder = '1px solid #a7f3d0';
                            if (isOutlier || duration > 40) {
                              cellBg = '#fef2f2'; // bottleneck / slow (> 40m or >1.5x avg)
                              cellColor = '#991b1b';
                              cellBorder = '1px solid #fecaca';
                            } else if (duration >= 20) {
                              cellBg = '#fffbeb'; // moderate (20-40m)
                              cellColor = '#92400e';
                              cellBorder = '1px solid #fde68a';
                            }

                            return (
                              <td key={m} style={{ background: cellBg, border: cellBorder, borderRadius: '4px', textAlign: 'center', padding: '6px 8px' }}>
                                <span style={{
                                  fontWeight: 600,
                                  color: cellColor
                                }}>
                                  {duration}m
                                </span>
                                {isOutlier ? (
                                  <span title="Took >1.5x class average" style={{ marginLeft: '4px' }}>⚠️</span>
                                ) : (
                                  <span style={{ color: '#16a34a', marginLeft: '4px' }}>✓</span>
                                )}
                              </td>
                            );
                          })}
                          <td style={{ fontWeight: 700, color: '#1e293b' }}>
                            {student.totalMinutes > 0 ? `${student.totalMinutes}m` : '—'}
                          </td>
                          <td>
                            {isComplete ? (
                              <span className="perf-status-badge completed">✓ Complete</span>
                            ) : student.needsAttention ? (
                              <span className="perf-status-badge attention">⚠️ Bottleneck</span>
                            ) : student.completedCount > 0 ? (
                              <span className="perf-status-badge inprogress">⏳ In Progress ({student.completedCount}/{activeMilestones.length})</span>
                            ) : (
                              <span className="perf-status-badge notstarted">Not Started</span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default PerformanceAnalyticsView;
