import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase-config';
import { exportToCsv } from '../utils/exportUtils';
import './BingoResultsView.css';

/**
 * Normalizes Firestore timestamps into milliseconds.
 */
function getTimestampMillis(record) {
  if (record.issuedAtMillis) return Number(record.issuedAtMillis);
  if (record.issuedAt?.toMillis) return record.issuedAt.toMillis();
  if (record.issuedAt?.seconds) return record.issuedAt.seconds * 1000;
  if (record.issuedAt instanceof Date) return record.issuedAt.getTime();
  if (typeof record.issuedAt === 'string') return new Date(record.issuedAt).getTime();
  return 0;
}

/**
 * Formats a timestamp into a human-readable string.
 */
function formatTime(millis, timezone) {
  if (!millis) return '—';
  try {
    const d = new Date(millis);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: timezone || undefined });
  } catch (e) {
    return new Date(millis).toLocaleTimeString();
  }
}

function formatDate(millis, timezone) {
  if (!millis) return '—';
  try {
    const d = new Date(millis);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: timezone || undefined });
  } catch (e) {
    return new Date(millis).toLocaleDateString();
  }
}

const OPTION_LABELS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function BingoResultsView({
  classId,
  className,
  startTime,
  endTime,
  lessons = [],
  selectedLesson = '',
  timezone,
  handleLessonChange,
  isModal = false,
  onClose,
}) {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [selectedRoundId, setSelectedRoundId] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'passed' | 'failed_incorrect' | 'missed_timeout' | 'pending'
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxImg, setLightboxImg] = useState(null);

  // Derive matched lesson and effective start/end timestamps from classroom schedule
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

  // Real-time Firestore subscription to classes/{classId}/bingoRecords
  useEffect(() => {
    if (!classId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const recordsRef = collection(db, 'classes', classId, 'bingoRecords');
    const unsubscribe = onSnapshot(
      recordsRef,
      (snapshot) => {
        const items = [];
        if (snapshot && typeof snapshot.forEach === 'function') {
          snapshot.forEach((docSnap) => {
            items.push({ id: docSnap.id, ...docSnap.data() });
          });
        }

        // Sort descending by timestamp (newest challenges first)
        items.sort((a, b) => getTimestampMillis(b) - getTimestampMillis(a));

        setRecords(items);
        setLoading(false);
      },
      (err) => {
        console.error('[BingoResultsView] Error subscribing to bingoRecords:', err);
        setError(`Failed to load Bingo records: ${err.message}`);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [classId]);

  // Filter raw records by the active lesson time window (with 15 min grace padding for early/late checks)
  const lessonFilteredRecords = useMemo(() => {
    if (!records.length) return [];
    if (!effectiveStart || !effectiveEnd) {
      return records;
    }

    const padStart = effectiveStart.getTime() - (15 * 60 * 1000);
    const padEnd = effectiveEnd.getTime() + (15 * 60 * 1000);

    return records.filter((r) => {
      const t = getTimestampMillis(r);
      return t >= padStart && t <= padEnd;
    });
  }, [records, effectiveStart, effectiveEnd]);

  // Group lesson-filtered records into distinct "Rounds" (dispatches to class or individuals)
  const rounds = useMemo(() => {
    if (!lessonFilteredRecords.length) return [];

    const map = new Map();
    lessonFilteredRecords.forEach((r) => {
      const millis = getTimestampMillis(r);
      // Group by question and 3-minute time window
      const bucket = Math.floor(millis / 180000);
      const roundKey = `${r.question || 'prompt'}_${bucket}`;

      if (!map.has(roundKey)) {
        map.set(roundKey, {
          id: roundKey,
          question: r.question || 'Quick Attendance Check',
          options: Array.isArray(r.options) ? r.options : [],
          correctIndex: r.correctIndex !== undefined ? r.correctIndex : null,
          questionSource: r.questionSource || 'question_bank',
          screenshotUrl: r.screenshotUrl || null,
          observedEvidence: r.observedEvidence || '',
          triggerType: r.triggerType || 'manual',
          timeLimitSeconds: r.timeLimitSeconds || 45,
          earliestMillis: millis,
          latestMillis: millis,
          records: [],
        });
      }

      const round = map.get(roundKey);
      round.records.push(r);
      if (millis < round.earliestMillis) round.earliestMillis = millis;
      if (millis > round.latestMillis) round.latestMillis = millis;
    });

    const roundList = Array.from(map.values());
    roundList.sort((a, b) => b.latestMillis - a.latestMillis);
    return roundList;
  }, [lessonFilteredRecords]);

  // Find active round object for display
  const activeRound = useMemo(() => {
    if (selectedRoundId !== 'all') {
      const found = rounds.find((rd) => rd.id === selectedRoundId);
      if (found) return found;
    }
    return rounds.length > 0 ? rounds[0] : null;
  }, [selectedRoundId, rounds]);

  // Filter records by selected round
  const recordsInScope = useMemo(() => {
    if (selectedRoundId === 'all') return lessonFilteredRecords;
    const targetRound = rounds.find((rd) => rd.id === selectedRoundId);
    return targetRound ? targetRound.records : lessonFilteredRecords;
  }, [selectedRoundId, rounds, lessonFilteredRecords]);

  // KPI Calculations across records in scope
  const kpiStats = useMemo(() => {
    const total = recordsInScope.length;
    let passed = 0;
    let failedIncorrect = 0;
    let missedTimeout = 0;
    let pending = 0;
    let totalLatency = 0;
    let latencyCount = 0;
    let focusedCount = 0;
    let focusableCount = 0;

    recordsInScope.forEach((r) => {
      if (r.result === 'passed') passed += 1;
      else if (r.result === 'failed_incorrect') failedIncorrect += 1;
      else if (r.result === 'missed_timeout') missedTimeout += 1;
      else pending += 1;

      if (r.responseTimeSec !== null && r.responseTimeSec !== undefined) {
        totalLatency += Number(r.responseTimeSec);
        latencyCount += 1;
      }

      if (r.windowFocused !== undefined && r.windowFocused !== null) {
        focusableCount += 1;
        if (r.windowFocused) focusedCount += 1;
      }
    });

    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    const timeoutRate = total > 0 ? Math.round((missedTimeout / total) * 100) : 0;
    const avgLatency = latencyCount > 0 ? (totalLatency / latencyCount).toFixed(1) : '—';
    const focusRate = focusableCount > 0 ? Math.round((focusedCount / focusableCount) * 100) : null;

    return {
      total,
      passed,
      failedIncorrect,
      missedTimeout,
      pending,
      passRate,
      timeoutRate,
      avgLatency,
      focusRate,
    };
  }, [recordsInScope]);

  // Apply search and status tab filters to student rows
  const filteredRecords = useMemo(() => {
    return recordsInScope.filter((r) => {
      if (statusFilter !== 'all' && r.result !== statusFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const email = (r.studentEmail || '').toLowerCase();
        const uid = (r.studentUid || '').toLowerCase();
        if (!email.includes(query) && !uid.includes(query)) {
          return false;
        }
      }
      return true;
    });
  }, [recordsInScope, statusFilter, searchQuery]);

  // CSV Export Handler
  const handleExportCsv = () => {
    if (!filteredRecords.length) return;

    const headers = [
      'Challenge ID',
      'Date',
      'Time',
      'Lesson Period',
      'Student Email',
      'Student UID',
      'Question',
      'Question Source',
      'Correct Answer',
      'Student Selected Option',
      'Result Status',
      'Response Time (s)',
      'Window Focused',
      'Strike Number',
      'Trigger Type',
    ];

    const lessonLabel = matchedLesson
      ? `${matchedLesson.start.toLocaleDateString()} (${matchedLesson.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${matchedLesson.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`
      : 'All Lessons';

    const rows = filteredRecords.map((r) => {
      const millis = getTimestampMillis(r);
      const dateStr = formatDate(millis, timezone);
      const timeStr = formatTime(millis, timezone);

      const options = Array.isArray(r.options) ? r.options : [];
      const correctText = r.correctIndex !== null && r.correctIndex !== undefined && options[r.correctIndex]
        ? `${OPTION_LABELS[r.correctIndex] || r.correctIndex}: ${options[r.correctIndex]}`
        : 'N/A';

      const studentText = r.selectedIndex !== null && r.selectedIndex !== undefined && options[r.selectedIndex]
        ? `${OPTION_LABELS[r.selectedIndex] || r.selectedIndex}: ${options[r.selectedIndex]}`
        : (r.selectedOptionText || (r.result === 'missed_timeout' ? 'Timed Out' : 'Pending'));

      return [
        r.id || '',
        dateStr,
        timeStr,
        lessonLabel,
        r.studentEmail || '',
        r.studentUid || '',
        r.question || '',
        r.questionSource || '',
        correctText,
        studentText,
        r.result || 'pending',
        r.responseTimeSec !== null && r.responseTimeSec !== undefined ? r.responseTimeSec : '',
        r.windowFocused ? 'Yes' : 'No',
        r.strikeNumber || 1,
        r.triggerType || '',
      ];
    });

    const dateSuffix = effectiveStart ? formatDate(effectiveStart.getTime(), timezone).replace(/[^a-zA-Z0-9]/g, '_') : 'all';
    const filename = `bingo-report-${classId}-${dateSuffix}.csv`;
    exportToCsv(headers, rows, filename);
  };

  return (
    <div className={`bingo-results-container ${isModal ? 'is-modal-view' : ''}`} data-testid="bingo-results-view">
      {/* Header */}
      <div className="bingo-results-header">
        <div className="bingo-results-titles">
          <h2>
            <span>🎲</span> Classroom Bingo Presence Report
            <span className="bingo-live-indicator">
              <span className="bingo-live-dot"></span>
              LIVE SYNC
            </span>
          </h2>
          <p>
            {className || classId} • Review dispatched presence checks, compare answers against students' choices, and track attendance strikes.
          </p>
        </div>

        <div className="bingo-results-actions">
          <button
            type="button"
            className="bingo-btn-export"
            onClick={handleExportCsv}
            disabled={!filteredRecords.length}
            title="Download Excel spreadsheet of current Bingo results"
          >
            <span>⬇️</span> Export Excel
          </button>
          {isModal && onClose && (
            <button
              type="button"
              className="bingo-btn-export"
              onClick={onClose}
              style={{ background: '#f1f5f9' }}
            >
              ✕ Close
            </button>
          )}
        </div>
      </div>

      {/* Lesson & Schedule Scope Banner */}
      <div className="bingo-lesson-banner" data-testid="bingo-lesson-banner">
        <div className="bingo-lesson-info">
          <span className="bingo-lesson-icon">📅</span>
          <div>
            <div className="bingo-lesson-title">
              <strong>Lesson Period: </strong>
              {matchedLesson ? (
                <span className="bingo-lesson-active-tag">
                  {matchedLesson.start.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} ({matchedLesson.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - {matchedLesson.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})
                </span>
              ) : effectiveStart && effectiveEnd ? (
                <span className="bingo-lesson-active-tag">
                  {formatDate(effectiveStart.getTime(), timezone)} ({formatTime(effectiveStart.getTime(), timezone)} - {formatTime(effectiveEnd.getTime(), timezone)})
                </span>
              ) : (
                <span className="bingo-lesson-all-tag">All Recorded Sessions (Cumulative)</span>
              )}
            </div>
            <div className="bingo-lesson-meta">
              {lessonFilteredRecords.length} student {lessonFilteredRecords.length === 1 ? 'response' : 'responses'} across {rounds.length} {rounds.length === 1 ? 'challenge' : 'challenges'}
              {records.length > lessonFilteredRecords.length && (
                <span className="bingo-lesson-total-note"> ({records.length} total recorded across all dates)</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{ padding: '12px 16px', background: '#fee2e2', color: '#991b1b', borderRadius: '8px', fontSize: '0.86rem' }}>
          ⚠️ {error}
        </div>
      )}

      {/* Loading State */}
      {loading && !records.length && (
        <div className="bingo-empty-state">
          <div className="bingo-empty-icon">⏳</div>
          <h3 className="bingo-empty-title">Loading Bingo Challenges...</h3>
          <p className="bingo-empty-desc">Connecting to real-time verification feed for {classId}.</p>
        </div>
      )}

      {/* Empty State - No records at all in the database */}
      {!loading && !records.length && (
        <div className="bingo-empty-state">
          <div className="bingo-empty-icon">🎯</div>
          <h3 className="bingo-empty-title">No Bingo Challenges Recorded Yet</h3>
          <p className="bingo-empty-desc">
            No presence challenges have been dispatched for this class. Trigger an attention check from the <strong>Live Monitor</strong> or enable <strong>Auto-Dispatch Bingo</strong>.
          </p>
        </div>
      )}

      {/* Empty State - Records exist, but none in selected lesson */}
      {!loading && records.length > 0 && lessonFilteredRecords.length === 0 && (
        <div className="bingo-empty-card" data-testid="bingo-lesson-empty">
          <div className="bingo-empty-icon">📅</div>
          <h3 className="bingo-empty-title">No Bingo Checks Recorded in this Lesson</h3>
          <p className="bingo-empty-desc">
            No presence challenges were dispatched during the selected lesson window
            {matchedLesson ? ` (${matchedLesson.start.toLocaleDateString()} ${matchedLesson.start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} - ${matchedLesson.end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})` : ''}.
          </p>
          <p style={{ marginTop: '0.5rem', color: '#64748b', fontSize: '0.85rem' }}>
            There are {records.length} total verification records available in other class sessions.
          </p>
          {handleLessonChange && selectedLesson && (
            <button
              type="button"
              className="bingo-btn-reset-lesson"
              onClick={() => handleLessonChange({ target: { value: '' } })}
            >
              🌐 View All Lessons (All History)
            </button>
          )}
        </div>
      )}

      {/* Main Content Area */}
      {lessonFilteredRecords.length > 0 && (
        <>
          {/* KPI Summary Grid */}
          <div className="bingo-kpi-grid">
            <div className="bingo-kpi-card kpi-total">
              <span className="bingo-kpi-label">📋 Total Challenged</span>
              <span className="bingo-kpi-value">{kpiStats.total}</span>
              <span className="bingo-kpi-sub">
                Across <strong>{rounds.length}</strong> round{rounds.length !== 1 ? 's' : ''}
              </span>
            </div>

            <div className="bingo-kpi-card kpi-passed">
              <span className="bingo-kpi-label">✅ Verified Present</span>
              <span className="bingo-kpi-value">{kpiStats.passed}</span>
              <span className="bingo-kpi-sub">
                <strong>{kpiStats.passRate}%</strong> correct answers
              </span>
            </div>

            <div className="bingo-kpi-card kpi-incorrect">
              <span className="bingo-kpi-label">❌ Incorrect Choice</span>
              <span className="bingo-kpi-value">{kpiStats.failedIncorrect}</span>
              <span className="bingo-kpi-sub">
                Physically present • <strong>No deduction</strong>
              </span>
            </div>

            <div className="bingo-kpi-card kpi-timeout">
              <span className="bingo-kpi-label">⚠️ Timed Out / AFK</span>
              <span className="bingo-kpi-value">{kpiStats.missedTimeout}</span>
              <span className="bingo-kpi-sub">
                <strong>{kpiStats.timeoutRate}%</strong> strike rate
              </span>
            </div>

            <div className="bingo-kpi-card kpi-latency">
              <span className="bingo-kpi-label">⚡ Avg Latency</span>
              <span className="bingo-kpi-value">{kpiStats.avgLatency}{kpiStats.avgLatency !== '—' ? 's' : ''}</span>
              <span className="bingo-kpi-sub">Response speed</span>
            </div>

            {kpiStats.focusRate !== null && (
              <div className="bingo-kpi-card kpi-focus">
                <span className="bingo-kpi-label">🖥️ OS Window Focus</span>
                <span className="bingo-kpi-value">{kpiStats.focusRate}%</span>
                <span className="bingo-kpi-sub">Browser active</span>
              </div>
            )}
          </div>

          {/* Question & Answer Showcase Card */}
          {activeRound && (
            <div className="bingo-qa-card">
              <div className="bingo-qa-header">
                <div className="bingo-qa-title-row">
                  <span className={`bingo-qa-badge source-${activeRound.questionSource}`}>
                    {activeRound.questionSource === 'teacher_screen' ? '🖥️ Teacher Screen Vision' :
                     activeRound.questionSource === 'student_screen' ? '💻 Student Screen Vision' :
                     '📚 Question Bank'}
                  </span>
                  <span className="bingo-qa-timestamp">
                    Issued: {formatDate(activeRound.latestMillis, timezone)} at {formatTime(activeRound.latestMillis, timezone)} ({activeRound.timeLimitSeconds}s timer)
                  </span>
                </div>
              </div>

              <div className="bingo-qa-question-box">
                <p className="bingo-qa-question-text">{activeRound.question}</p>
              </div>

              {/* Options Grid */}
              <div className="bingo-qa-options-grid">
                {activeRound.options.map((opt, idx) => {
                  const isCorrect = idx === activeRound.correctIndex;
                  return (
                    <div
                      key={idx}
                      className={`bingo-qa-option-card ${isCorrect ? 'is-correct' : ''}`}
                    >
                      <span className="bingo-qa-option-tag">{OPTION_LABELS[idx] || (idx + 1)}</span>
                      <span className="bingo-qa-option-text">{opt}</span>
                      {isCorrect && (
                        <span className="bingo-qa-correct-pill">
                          ✓ Correct Answer
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* AI Vision Evidence & Lightbox Preview */}
              {(activeRound.screenshotUrl || activeRound.observedEvidence) && (
                <div className="bingo-qa-evidence-box">
                  {activeRound.screenshotUrl && (
                    <img
                      src={activeRound.screenshotUrl}
                      alt="Captured Vision Reference"
                      className="bingo-qa-evidence-img"
                      title="Click to view full screenshot"
                      onClick={() => setLightboxImg(activeRound.screenshotUrl)}
                    />
                  )}
                  <div>
                    <strong>AI Observed Evidence:</strong> {activeRound.observedEvidence || 'Generated from active presentation visual context.'}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Filtering Toolbar */}
          <div className="bingo-toolbar">
            <div className="bingo-toolbar-left">
              {/* Round Selector */}
              <div className="bingo-round-select-wrapper">
                <label htmlFor="bingo-round-select" className="bingo-round-select-label">
                  Filter Round:
                </label>
                <select
                  id="bingo-round-select"
                  className="bingo-round-select"
                  value={selectedRoundId}
                  onChange={(e) => setSelectedRoundId(e.target.value)}
                >
                  <option value="all">🌐 All Challenges ({lessonFilteredRecords.length} records)</option>
                  {rounds.map((rd, i) => (
                    <option key={rd.id} value={rd.id}>
                      #{rounds.length - i}: {rd.question.slice(0, 32)}... ({rd.records.length} students, {formatTime(rd.latestMillis, timezone)})
                    </option>
                  ))}
                </select>
              </div>

              {/* Student Search */}
              <input
                type="text"
                placeholder="🔍 Search student email or UID..."
                className="bingo-search-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter Tabs */}
            <div className="bingo-status-tabs">
              <button
                type="button"
                className={`bingo-tab-btn ${statusFilter === 'all' ? 'active' : ''}`}
                onClick={() => setStatusFilter('all')}
              >
                All ({recordsInScope.length})
              </button>
              <button
                type="button"
                className={`bingo-tab-btn ${statusFilter === 'passed' ? 'active' : ''}`}
                onClick={() => setStatusFilter('passed')}
              >
                Passed ({kpiStats.passed})
              </button>
              <button
                type="button"
                className={`bingo-tab-btn ${statusFilter === 'failed_incorrect' ? 'active' : ''}`}
                onClick={() => setStatusFilter('failed_incorrect')}
              >
                Incorrect ({kpiStats.failedIncorrect})
              </button>
              <button
                type="button"
                className={`bingo-tab-btn ${statusFilter === 'missed_timeout' ? 'active' : ''}`}
                onClick={() => setStatusFilter('missed_timeout')}
              >
                Timed Out ({kpiStats.missedTimeout})
              </button>
              {kpiStats.pending > 0 && (
                <button
                  type="button"
                  className={`bingo-tab-btn ${statusFilter === 'pending' ? 'active' : ''}`}
                  onClick={() => setStatusFilter('pending')}
                >
                  Pending ({kpiStats.pending})
                </button>
              )}
            </div>
          </div>

          {/* Student Response Table */}
          <div className="bingo-table-wrapper">
            <table className="bingo-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Chosen Answer</th>
                  <th>Result</th>
                  <th>Latency</th>
                  <th>Window Focus</th>
                  <th>Strike</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan="7" style={{ textAlign: 'center', padding: '24px', color: '#64748b' }}>
                      No student records match the active filters.
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((r) => {
                    const millis = getTimestampMillis(r);
                    const options = Array.isArray(r.options) ? r.options : [];
                    const isSelected = r.selectedIndex !== null && r.selectedIndex !== undefined;
                    const optTag = isSelected ? OPTION_LABELS[r.selectedIndex] || r.selectedIndex : null;
                    const optText = isSelected ? options[r.selectedIndex] : r.selectedOptionText;

                    return (
                      <tr key={r.id}>
                        {/* Student */}
                        <td>
                          <div className="bingo-student-cell">
                            <span className="bingo-student-email">{r.studentEmail || 'Unknown Student'}</span>
                            <span className="bingo-student-uid">{r.studentUid}</span>
                          </div>
                        </td>

                        {/* Chosen Answer */}
                        <td>
                          {isSelected ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span style={{
                                width: '20px',
                                height: '20px',
                                borderRadius: '50%',
                                background: r.result === 'passed' ? '#dcfce7' : '#fee2e2',
                                color: r.result === 'passed' ? '#15803d' : '#b91c1c',
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}>
                                {optTag}
                              </span>
                              <span style={{ fontSize: '0.84rem', color: '#0f172a' }}>
                                {optText}
                              </span>
                            </div>
                          ) : r.result === 'missed_timeout' ? (
                            <span style={{ color: '#b91c1c', fontStyle: 'italic', fontSize: '0.82rem' }}>
                              ⏱️ No answer (Countdown expired)
                            </span>
                          ) : (
                            <span style={{ color: '#64748b', fontStyle: 'italic', fontSize: '0.82rem' }}>
                              ⏳ Pending response...
                            </span>
                          )}
                        </td>

                        {/* Result Badge */}
                        <td>
                          <span className={`bingo-badge badge-${r.result}`}>
                            {r.result === 'passed' && '✅ Verified Present'}
                            {r.result === 'failed_incorrect' && '❌ Incorrect Choice'}
                            {r.result === 'missed_timeout' && '⚠️ Timed Out'}
                            {r.result === 'pending' && '⏳ In Progress'}
                          </span>
                        </td>

                        {/* Latency */}
                        <td>
                          {r.responseTimeSec !== null && r.responseTimeSec !== undefined ? (
                            <span style={{ fontWeight: 600, color: r.responseTimeSec > 35 ? '#ea580c' : '#0f172a' }}>
                              {Number(r.responseTimeSec).toFixed(1)}s
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* Window Focus */}
                        <td>
                          {r.windowFocused !== undefined && r.windowFocused !== null ? (
                            <span className={`bingo-focus-indicator ${r.windowFocused ? 'focused' : 'unfocused'}`}>
                              {r.windowFocused ? '🖥️ Focused' : '❌ Unfocused'}
                            </span>
                          ) : (
                            <span style={{ color: '#94a3b8' }}>—</span>
                          )}
                        </td>

                        {/* Strike */}
                        <td>
                          <span className={`bingo-strike-pill strike-${r.strikeNumber || 1}`}>
                            {r.strikeNumber === 2 ? '🚨 Strike 2 (Deduction)' : 'Strike 1'}
                          </span>
                        </td>

                        {/* Time */}
                        <td style={{ whiteSpace: 'nowrap', color: '#64748b', fontSize: '0.8rem' }}>
                          {formatDate(millis, timezone)} {formatTime(millis, timezone)}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Lightbox Modal for AI Vision Screenshots */}
      {lightboxImg && (
        <div className="bingo-lightbox-overlay" onClick={() => setLightboxImg(null)}>
          <div className="bingo-lightbox-box" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="bingo-lightbox-close"
              onClick={() => setLightboxImg(null)}
            >
              ✕ Close
            </button>
            <img src={lightboxImg} alt="Enlarged Vision Screenshot" />
          </div>
        </div>
      )}
    </div>
  );
}
