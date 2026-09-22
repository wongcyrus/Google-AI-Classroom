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
              const totalMinutes = student.sharedScreenMinutes;
              if (totalMinutes === undefined) return null;
              return {
                email: student.email,
                totalMinutes: totalMinutes,
                percentage: lessonDurationInMinutes > 0 ? ((totalMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : '0.00%',
                attendance: student.attendance || Array(lessonDurationInMinutes).fill(0),
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
    if (combinedData.length === 0) return;

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

    const rows = combinedData.map(studentData => {
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
    <div style={{ height: 'calc(100vh - 200px)', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>
        <h2>
          Attendance & AI Analysis
          <button onClick={handleFetchAttendance} style={{ marginLeft: '20px' }} disabled={loadingAttendance}>
            {loadingAttendance ? 'Calculating...' : 'Calculate Live Attendance'}
          </button>
          <button onClick={handleExportToExcel} style={{ marginLeft: '10px' }} disabled={combinedData.length === 0}>Export to Excel</button>
        </h2>
      </div>
      <div style={{ flexGrow: 1, overflowY: 'auto' }}>
        {(loadingAttendance || loadingLessonData) && <p>Loading data...</p>}
        {combinedData.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600 }}>Legend:</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', background: '#2ECC71', borderRadius: '2px' }}></span>
                Present (Verified)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', background: '#f97316', borderRadius: '2px' }}></span>
                Deducted (Failed Bingo Checks)
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <span style={{ display: 'inline-block', width: '14px', height: '14px', background: '#FADBD8', borderRadius: '2px' }}></span>
                Absent (No Screen Share)
              </span>
              <a
                href={`/class/${classId}?tab=analytics&sub=bingo`}
                style={{
                  marginLeft: 'auto',
                  fontSize: '0.82rem',
                  color: '#2563eb',
                  textDecoration: 'none',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                }}
                title="Review questions, student choices, and answer latency"
              >
                <span>🎲</span> View Bingo Presence Report &rarr;
              </a>
            </div>
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Student</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Screen Share Minutes</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Screen Share Percentage</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>AI Estimated Working Minutes</th>
                  <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>AI Estimated Percentage</th>
                  {minuteKeys.map(minute => (
                    <th key={minute} style={{ border: '1px solid #ddd', padding: '8px', minWidth: '25px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>{minute}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {combinedData.map(student => (
                  <tr key={student.email} onClick={() => setSelectedStudent(student)} style={{ cursor: 'pointer' }}>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      <StudentBadge
                        student={{
                          email: student.email,
                          ...(studentProfiles[student.email?.toLowerCase()] || {})
                        }}
                        showEmail={true}
                        size="sm"
                      />
                    </td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.totalMinutes ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.percentage ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.workingMinutes ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
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
                            border: '1px solid #ddd',
                            backgroundColor: bg,
                            backgroundImage: isVoided ? 'repeating-linear-gradient(45deg, #f97316, #f97316 4px, #ea580c 4px, #ea580c 8px)' : undefined,
                            width: '25px',
                            height: '25px',
                          }}
                        ></td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !(loadingAttendance || loadingLessonData) && <p>Click the button to calculate live attendance. No data available.</p>}
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