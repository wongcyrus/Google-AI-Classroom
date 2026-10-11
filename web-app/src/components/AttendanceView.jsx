import { useState, useEffect, useMemo } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, getDoc, collection, getDocs } from 'firebase/firestore';
import { db, functions } from '../firebase-config';
import { exportToExcel } from '../utils/exportUtils';
import Modal from './Modal.jsx';
import StudentBadge from './common/StudentBadge';
import { getStudentDisplayName, getStudentProfile } from '../utils/studentDisplayUtils';
import {
  formatFilenameDate,
  computeLessonDuration,
  getLessonId,
  mergeAttendanceData,
} from '../utils/attendanceUtils';
import './AttendanceView.css';

const AttendanceView = ({ classId, selectedLesson, startTime, endTime, lessons, timezone }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [lessonData, setLessonData] = useState(null);
  const [loadingLessonData, setLoadingLessonData] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentProfiles, setStudentProfiles] = useState({});

  const matchedLesson = useMemo(() => {
    if (selectedLesson && lessons?.length) {
      return lessons.find((l) => l.start && l.start.toISOString() === selectedLesson);
    }
    return null;
  }, [selectedLesson, lessons]);

  const effectiveStart = matchedLesson ? matchedLesson.start.toISOString() : startTime;
  const effectiveEnd = matchedLesson ? matchedLesson.end.toISOString() : endTime;

  const lessonDurationInMinutes = useMemo(() => {
    return computeLessonDuration(effectiveStart, effectiveEnd, timezone);
  }, [effectiveStart, effectiveEnd, timezone]);

  const combinedData = useMemo(() => {
    const lessonStudents = lessonData?.students || [];
    return mergeAttendanceData(attendanceData, lessonStudents, lessonDurationInMinutes);
  }, [attendanceData, lessonData, lessonDurationInMinutes]);

  // Client-side search, filtering, and sorting state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'present' | 'absent' | 'deducted'
  const [sortBy, setSortBy] = useState('name'); // 'name' | 'email' | 'screenMinutes' | 'screenPercentage' | 'workingMinutes' | 'workingPercentage'
  const [sortDirection, setSortDirection] = useState('asc'); // 'asc' | 'desc'

  const statusCounts = useMemo(() => {
    let presentCount = 0;
    let absentCount = 0;
    let deductedCount = 0;
    for (const s of combinedData) {
      if ((s.totalMinutes ?? 0) > 0) presentCount++;
      else absentCount++;
      if (Array.isArray(s.attendance) && s.attendance.includes(2)) deductedCount++;
    }
    return {
      all: combinedData.length,
      present: presentCount,
      absent: absentCount,
      deducted: deductedCount,
    };
  }, [combinedData]);

  const filteredAndSortedData = useMemo(() => {
    let list = [...combinedData];

    // 1. Text Search Filter (Display Name, Email, Student Class, Programme)
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((s) => {
        const prof = getStudentProfile(s.email, studentProfiles);
        const displayName = getStudentDisplayName(s.email, studentProfiles);
        return (
          (displayName && displayName.toLowerCase().includes(q)) ||
          (s.email && s.email.toLowerCase().includes(q)) ||
          (prof?.studentClass && prof.studentClass.toLowerCase().includes(q)) ||
          (prof?.programme && prof.programme.toLowerCase().includes(q))
        );
      });
    }

    // 2. Attendance Status Filter
    if (statusFilter === 'present') {
      list = list.filter((s) => (s.totalMinutes ?? 0) > 0);
    } else if (statusFilter === 'absent') {
      list = list.filter((s) => (s.totalMinutes ?? 0) === 0);
    } else if (statusFilter === 'deducted') {
      list = list.filter((s) => Array.isArray(s.attendance) && s.attendance.includes(2));
    }

    // 3. Sorting
    list.sort((a, b) => {
      if (sortBy === 'name') {
        const nameA = (getStudentDisplayName(a.email, studentProfiles) || a.email || '').toLowerCase();
        const nameB = (getStudentDisplayName(b.email, studentProfiles) || b.email || '').toLowerCase();
        const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      if (sortBy === 'email') {
        const emailA = (a.email || '').toLowerCase();
        const emailB = (b.email || '').toLowerCase();
        const cmp = emailA.localeCompare(emailB, undefined, { numeric: true, sensitivity: 'base' });
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      let diff = 0;
      if (sortBy === 'screenMinutes') {
        const minA = a.totalMinutes ?? -1;
        const minB = b.totalMinutes ?? -1;
        diff = minA - minB;
      } else if (sortBy === 'screenPercentage') {
        const pctA = parseFloat(a.percentage) || 0;
        const pctB = parseFloat(b.percentage) || 0;
        diff = pctA - pctB;
      } else if (sortBy === 'workingMinutes') {
        const workA = a.workingMinutes ?? -1;
        const workB = b.workingMinutes ?? -1;
        diff = workA - workB;
      } else if (sortBy === 'workingPercentage') {
        const workPctA = a.workingMinutes != null && lessonDurationInMinutes > 0 ? (a.workingMinutes / lessonDurationInMinutes) : -1;
        const workPctB = b.workingMinutes != null && lessonDurationInMinutes > 0 ? (b.workingMinutes / lessonDurationInMinutes) : -1;
        diff = workPctA - workPctB;
      }

      return sortDirection === 'asc' ? diff : -diff;
    });

    return list;
  }, [combinedData, searchQuery, statusFilter, sortBy, sortDirection, studentProfiles, lessonDurationInMinutes]);

  const handleSortClick = (columnKey) => {
    if (sortBy === columnKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(columnKey);
      setSortDirection(columnKey === 'name' || columnKey === 'email' ? 'asc' : 'desc');
    }
  };

  const renderSortIndicator = (columnKey) => {
    if (sortBy !== columnKey) {
      return <span className="sort-indicator-inactive" aria-hidden="true">⇅</span>;
    }
    return <span className="sort-indicator-active" aria-hidden="true">{sortDirection === 'asc' ? '▲' : '▼'}</span>;
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setSortBy('name');
    setSortDirection('asc');
  };

  const filename = `attendance-${classId}-${formatFilenameDate(effectiveStart)}-${formatFilenameDate(effectiveEnd)}.xlsx`;

  const handleFetchAttendance = async () => {
    if (!classId || !effectiveStart || !effectiveEnd) return;

    setLoadingAttendance(true);
    const getAttendanceData = httpsCallable(functions, 'getAttendanceData');
    try {
      const result = await getAttendanceData({ classId, startTime: effectiveStart, endTime: effectiveEnd });
      if (result?.data?.attendanceData) {
        setAttendanceData(result.data.attendanceData);
      }
    } catch (error) {
      console.error("Error fetching attendance data: ", error);
      setAttendanceData([]);
    } finally {
      setLoadingAttendance(false);
    }
  };

  useEffect(() => {
    const fetchLessonData = async () => {
      if (!classId || !effectiveStart || !effectiveEnd) return;
      setLoadingLessonData(true);
      setAttendanceData([]); // Clear previous data
      try {
        const lessonId = await getLessonId(effectiveStart, effectiveEnd, timezone);
        const lessonRef = doc(db, 'classes', classId, 'lessons', lessonId);
        const lessonSnap = await getDoc(lessonRef);

        let hasCalculatedAttendance = false;

        if (lessonSnap.exists()) {
          const classRef = doc(db, 'classes', classId);
          const classSnap = await getDoc(classRef);
          if (classSnap.exists()) {
            const classData = classSnap.data();
            const studentsMap = classData.students || {};
            const profilesMap = classData.studentProfiles || {};
            setStudentProfiles(profilesMap);
            const lessonDocData = lessonSnap.data();
            const studentsWithDetails = Object.entries(lessonDocData.students || {}).map(([uid, data]) => {
              const email = studentsMap[uid] || 'Unknown';
              const prof = getStudentProfile(email, profilesMap);
              return {
                uid,
                email,
                displayName: getStudentDisplayName(email, profilesMap),
                studentClass: prof.studentClass,
                programme: prof.programme,
                ...data,
              };
            });
            setLessonData({ ...lessonDocData, students: studentsWithDetails });

            const initialAttendance = studentsWithDetails.map(student => {
              const totalMinutes = student.sharedScreenMinutes ?? student.workingMinutes;
              if (totalMinutes === undefined) return null;
              return {
                email: student.email,
                totalMinutes: totalMinutes,
                percentage: lessonDurationInMinutes > 0 ? ((totalMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : '0.00%',
                attendance: student.attendance || (totalMinutes > 0
                  ? Array(lessonDurationInMinutes).fill(0).map((_, idx) => (idx < totalMinutes ? 1 : 0))
                  : Array(lessonDurationInMinutes).fill(0)),
              };
            }).filter(Boolean);

            if (initialAttendance.length > 0) {
              setAttendanceData(initialAttendance);
              hasCalculatedAttendance = true;
            }
          } else {
            setLessonData(lessonSnap.data());
          }
        } else {
          setLessonData(null);
        }

        // Auto-fetch attendance calculation if not yet recorded in the lesson doc
        if (!hasCalculatedAttendance && lessonDurationInMinutes > 0) {
          const getAttendance = httpsCallable(functions, 'getAttendanceData');
          const result = await getAttendance({ classId, startTime: effectiveStart, endTime: effectiveEnd });
          if (result?.data?.attendanceData) {
            setAttendanceData(result.data.attendanceData);
          }
        }
      } catch (error) {
        console.error("Error fetching lesson data:", error);
        setLessonData(null);
      } finally {
        setLoadingLessonData(false);
      }
    };

    fetchLessonData();
  }, [selectedLesson, classId, effectiveStart, effectiveEnd, lessonDurationInMinutes, timezone]);

  const handleExportToExcel = async () => {
    const targetData = filteredAndSortedData.length > 0 ? filteredAndSortedData : combinedData;
    if (targetData.length === 0) return;

    const headers = [
      "Student Display Name",
      "Student Email",
      "Class / Cohort",
      "Programme",
      "Screen Share Minutes",
      "Screen Share Percentage",
      "AI Estimated Working Minutes",
      "AI Estimated Percentage",
      "General Summary",
      "Student-Specific Summary",
      "General Feedback",
      "Student-Specific Feedback",
      ...Array.from({ length: lessonDurationInMinutes }, (_, i) => `Min ${i + 1}`)
    ];

    const rows = targetData.map(studentData => {
      const prof = getStudentProfile(studentData.email, studentProfiles);
      const displayName = getStudentDisplayName(studentData.email, studentProfiles);
      const row = [
        displayName,
        studentData.email,
        prof.studentClass || '',
        prof.programme || '',
        studentData.totalMinutes ?? 'N/A',
        studentData.percentage ?? 'N/A',
        studentData.workingMinutes ?? 'N/A',
        studentData.workingMinutes && lessonDurationInMinutes > 0 ? ((studentData.workingMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : 'N/A',
        lessonData?.generalSummary || '',
        studentData?.summary || '',
        (Array.isArray(lessonData?.generalFeedback) ? lessonData.generalFeedback : (lessonData?.generalFeedback ? [lessonData.generalFeedback] : [])).join(' | '),
        (Array.isArray(studentData?.feedback) ? studentData.feedback : (studentData?.feedback ? [studentData.feedback] : [])).join(' | '),
      ];
      const attendanceRecord = studentData.attendance || Array(lessonDurationInMinutes).fill(0);
      attendanceRecord.forEach((present) => {
        row.push(present);
      });
      return row;
    });

    await exportToExcel(headers, rows, filename);
  };

  const minuteKeys = lessonDurationInMinutes > 0 ? Array.from({ length: lessonDurationInMinutes }, (_, i) => i + 1) : [];

  return (
    <div className="attendance-view-container">
      <div className="attendance-header-card">
        <h2 className="attendance-title">
          <span>📅</span> Attendance & AI Analysis
        </h2>
        <div className="attendance-actions">
          <button
            type="button"
            className="attendance-btn attendance-btn-primary"
            onClick={handleFetchAttendance}
            disabled={loadingAttendance}
          >
            {loadingAttendance ? 'Calculating...' : 'Calculate Live Attendance'}
          </button>
          <button
            type="button"
            className="attendance-btn attendance-btn-secondary"
            onClick={handleExportToExcel}
            disabled={combinedData.length === 0}
          >
            Export to Excel
          </button>
        </div>
      </div>

      <div className="attendance-content-card">
        {(loadingAttendance || loadingLessonData) && <p className="attendance-loading-notice">Loading data...</p>}
        {combinedData.length > 0 ? (
          <>
            <div className="attendance-toolbar">
              <div className="attendance-filter-row">
                <div className="attendance-search-wrapper">
                  <span className="attendance-search-icon">🔍</span>
                  <input
                    type="text"
                    className="attendance-search-input"
                    placeholder="Search student name, email, class..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="attendance-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="attendance-status-pills">
                  <button
                    type="button"
                    className={`attendance-filter-pill ${statusFilter === 'all' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('all')}
                  >
                    All ({statusCounts.all})
                  </button>
                  <button
                    type="button"
                    className={`attendance-filter-pill ${statusFilter === 'present' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('present')}
                  >
                    <span className="attendance-legend-color" style={{ background: '#2ECC71' }}></span>
                    Present ({statusCounts.present})
                  </button>
                  <button
                    type="button"
                    className={`attendance-filter-pill ${statusFilter === 'absent' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('absent')}
                  >
                    <span className="attendance-legend-color" style={{ background: '#FADBD8' }}></span>
                    Absent ({statusCounts.absent})
                  </button>
                  <button
                    type="button"
                    className={`attendance-filter-pill ${statusFilter === 'deducted' ? 'active' : ''}`}
                    onClick={() => setStatusFilter('deducted')}
                  >
                    <span className="attendance-legend-color" style={{ background: '#f97316' }}></span>
                    Deducted ({statusCounts.deducted})
                  </button>
                </div>
              </div>

              <div className="attendance-sort-row">
                <div className="attendance-sort-controls">
                  <label htmlFor="attendance-sort-select" className="attendance-sort-label">Sort by:</label>
                  <select
                    id="attendance-sort-select"
                    className="attendance-sort-select"
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                  >
                    <option value="name">Student Name</option>
                    <option value="email">Email</option>
                    <option value="screenMinutes">Screen Share Minutes</option>
                    <option value="screenPercentage">Screen Share %</option>
                    <option value="workingMinutes">AI Working Minutes</option>
                    <option value="workingPercentage">AI Working %</option>
                  </select>
                  <button
                    type="button"
                    className="attendance-direction-btn"
                    onClick={() => setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')}
                    title={`Current: ${sortDirection === 'asc' ? 'Ascending (A-Z or Low-High)' : 'Descending (Z-A or High-Low)'}. Click to toggle.`}
                  >
                    {sortDirection === 'asc' ? '↑ Asc' : '↓ Desc'}
                  </button>
                </div>

                <div className="attendance-count-badge">
                  <span>Showing <strong>{filteredAndSortedData.length}</strong> of <strong>{combinedData.length}</strong> students</span>
                  {(searchQuery || statusFilter !== 'all' || sortBy !== 'name' || sortDirection !== 'asc') && (
                    <button type="button" className="attendance-reset-link" onClick={handleResetFilters}>
                      Reset
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="attendance-table-container">
              <div className="attendance-legend-bar">
                <span style={{ fontWeight: 600 }}>Legend:</span>
                <span className="attendance-legend-item">
                  <span className="attendance-legend-color" style={{ background: '#2ECC71' }}></span>
                  Present (Verified)
                </span>
                <span className="attendance-legend-item">
                  <span className="attendance-legend-color" style={{ background: '#f97316' }}></span>
                  Deducted (Failed Bingo Checks)
                </span>
                <span className="attendance-legend-item">
                  <span className="attendance-legend-color" style={{ background: '#FADBD8' }}></span>
                  Absent (No Screen Share)
                </span>
                <a
                  href={`/class/${classId}?tab=analytics&sub=bingo`}
                  className="attendance-bingo-link"
                  title="Review questions, student choices, and answer latency"
                >
                  <span>🎲</span> View Bingo Presence Report &rarr;
                </a>
              </div>

              {filteredAndSortedData.length > 0 ? (
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th
                        className={`sortable-header col-student ${sortBy === 'name' ? 'is-sorted' : ''}`}
                        onClick={() => handleSortClick('name')}
                        title="Click to sort by student name"
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSortClick('name'); }}
                      >
                        Student {renderSortIndicator('name')}
                      </th>
                      <th
                        className={`sortable-header col-stat ${sortBy === 'screenMinutes' ? 'is-sorted' : ''}`}
                        onClick={() => handleSortClick('screenMinutes')}
                        title="Click to sort by screen share minutes"
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSortClick('screenMinutes'); }}
                      >
                        <span className="th-compact-title">Share</span>
                        <span className="th-compact-unit">(min) {renderSortIndicator('screenMinutes')}</span>
                      </th>
                      <th
                        className={`sortable-header col-stat ${sortBy === 'screenPercentage' ? 'is-sorted' : ''}`}
                        onClick={() => handleSortClick('screenPercentage')}
                        title="Click to sort by screen share percentage"
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSortClick('screenPercentage'); }}
                      >
                        <span className="th-compact-title">Share</span>
                        <span className="th-compact-unit">% {renderSortIndicator('screenPercentage')}</span>
                      </th>
                      <th
                        className={`sortable-header col-stat ${sortBy === 'workingMinutes' ? 'is-sorted' : ''}`}
                        onClick={() => handleSortClick('workingMinutes')}
                        title="Click to sort by AI estimated working minutes"
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSortClick('workingMinutes'); }}
                      >
                        <span className="th-compact-title">AI Work</span>
                        <span className="th-compact-unit">(min) {renderSortIndicator('workingMinutes')}</span>
                      </th>
                      <th
                        className={`sortable-header col-stat ${sortBy === 'workingPercentage' ? 'is-sorted' : ''}`}
                        onClick={() => handleSortClick('workingPercentage')}
                        title="Click to sort by AI estimated percentage"
                        tabIndex={0}
                        role="button"
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSortClick('workingPercentage'); }}
                      >
                        <span className="th-compact-title">AI Work</span>
                        <span className="th-compact-unit">% {renderSortIndicator('workingPercentage')}</span>
                      </th>
                      {minuteKeys.map(minute => (
                        <th key={minute} style={{ minWidth: '25px', textAlign: 'center' }}>{minute}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAndSortedData.map(student => (
                      <tr key={student.email} onClick={() => setSelectedStudent(student)}>
                        <td className="col-student">
                          <StudentBadge
                            student={{
                              email: student.email,
                              ...(studentProfiles[student.email?.toLowerCase()] || {})
                            }}
                            showEmail={true}
                            size="sm"
                          />
                        </td>
                        <td className="cell-stat">{student.totalMinutes ?? 'N/A'}</td>
                        <td className="cell-stat">{student.percentage ?? 'N/A'}</td>
                        <td className="cell-stat">{student.workingMinutes ?? 'N/A'}</td>
                        <td className="cell-stat">
                          {student.workingMinutes && lessonDurationInMinutes > 0 ? `${((student.workingMinutes / lessonDurationInMinutes) * 100).toFixed(2)}%` : 'N/A'}
                        </td>
                        {student.attendance.map((present, index) => {
                          const isPresent = present === 1;
                          const isVoided = present === 2;
                          const bg = isPresent ? '#2ECC71' : isVoided ? '#f97316' : '#FADBD8';
                          const titleText = isPresent
                            ? `Min ${index + 1}: Present (Verified)`
                            : isVoided
                            ? `Min ${index + 1}: Deducted (Failed consecutive Bingo checks)`
                            : `Min ${index + 1}: Absent (No screen share)`;

                          return (
                            <td
                              key={index}
                              title={titleText}
                              style={{
                                backgroundColor: bg,
                                backgroundImage: isVoided ? 'repeating-linear-gradient(45deg, #f97316, #f97316 4px, #ea580c 4px, #ea580c 8px)' : undefined,
                                width: '25px',
                                height: '25px',
                                minWidth: '25px',
                                padding: 0,
                              }}
                            ></td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="attendance-empty-notice">
                  <p>No students match your filter or search criteria.</p>
                  <button type="button" className="attendance-btn attendance-btn-secondary" onClick={handleResetFilters} style={{ marginTop: '0.5rem' }}>
                    Reset Filters
                  </button>
                </div>
              )}
            </div>
          </>
        ) : !(loadingAttendance || loadingLessonData) && <p className="attendance-empty-notice">Click the button to calculate live attendance. No data available.</p>}
      </div>

      <Modal show={!!selectedStudent} onClose={() => setSelectedStudent(null)} title={`AI Analysis for ${getStudentDisplayName(selectedStudent?.email, studentProfiles)}`}>
        {selectedStudent && (
          <div>
            <h4>General Summary</h4>
            <p>{lessonData?.generalSummary || 'Not available.'}</p>
            <h4>Student-Specific Summary</h4>
            <p>{selectedStudent.summary || 'Not available.'}</p>
            <hr />
            <h4>General Feedback</h4>
            <div>
              {Array.isArray(lessonData?.generalFeedback)
                ? (lessonData.generalFeedback.length > 0 ? lessonData.generalFeedback.map((fb, index) => <p key={index}>{fb}</p>) : <p>Not available.</p>)
                : (lessonData?.generalFeedback ? <p>{lessonData.generalFeedback}</p> : <p>Not available.</p>)}
            </div>
            <h4>Student-Specific Feedback</h4>
            <div>
              {Array.isArray(selectedStudent.feedback)
                ? (selectedStudent.feedback.length > 0 ? selectedStudent.feedback.map((fb, index) => <p key={index}>{fb}</p>) : <p>Not available.</p>)
                : (selectedStudent.feedback ? <p>{selectedStudent.feedback}</p> : <p>Not available.</p>)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AttendanceView;