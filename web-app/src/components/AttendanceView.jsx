import { useState, useEffect, useRef, useMemo } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirestore, doc, getDoc } from 'firebase/firestore';
import { CSVLink } from 'react-csv';
import Modal from './Modal.jsx';

const AttendanceView = ({ classId, selectedLesson, startTime, endTime }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [lessonData, setLessonData] = useState(null);
  const [loadingLessonData, setLoadingLessonData] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [csvData, setCsvData] = useState(null);
  const csvLink = useRef(null);

  const lessonDurationInMinutes = useMemo(() => {
    if (!startTime || !endTime) return 0;
    const duration = Math.round((new Date(endTime) - new Date(startTime)) / 60000);
    return duration > 0 ? duration : 0;
  }, [startTime, endTime]);

  const combinedData = useMemo(() => {
    const lessonStudents = lessonData?.students || [];
    
    if (attendanceData.length === 0 && lessonStudents.length === 0) {
        return [];
    }

    const allStudentEmails = new Set([
        ...attendanceData.map(s => s.email),
        ...lessonStudents.map(s => s.email)
    ]);

    const mergedData = Array.from(allStudentEmails).map(email => {
        const attStudent = attendanceData.find(s => s.email === email);
        const lessonStudent = lessonStudents.find(s => s.email === email);

        return {
            email: email,
            uid: lessonStudent?.uid || null,
            totalMinutes: attStudent?.totalMinutes,
            percentage: attStudent?.percentage,
            attendance: attStudent?.attendance || Array(lessonDurationInMinutes).fill(0),
            workingMinutes: lessonStudent?.workingMinutes,
            summary: lessonStudent?.summary,
            feedback: lessonStudent?.feedback,
        };
    });

    return mergedData;
  }, [attendanceData, lessonData, lessonDurationInMinutes]);

  const formatFilenameDate = (date) => {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const hours = `${d.getHours()}`.padStart(2, '0');
    const minutes = `${d.getMinutes()}`.padStart(2, '0');
    return `${year}-${month}-${day}_${hours}-${minutes}`;
  };

  const filename = `attendance-${classId}-${formatFilenameDate(startTime)}-${formatFilenameDate(endTime)}.csv`;

  const getLessonId = async (start, end) => {
    const message = `${new Date(start).toISOString()}-${new Date(end).toISOString()}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleFetchAttendance = async () => {
    if (!selectedLesson || !classId || !startTime || !endTime) return;

    setLoadingAttendance(true);
    const functions = getFunctions();
    const getAttendanceData = httpsCallable(functions, 'getAttendanceData');
    try {
      const result = await getAttendanceData({ classId, startTime, endTime });
      setAttendanceData(result.data.attendanceData);
    } catch (error) {
      console.error("Error fetching attendance data: ", error);
      setAttendanceData([]);
    }
    setLoadingAttendance(false);
  };

  useEffect(() => {
    const fetchLessonData = async () => {
      if (!classId || !startTime || !endTime) return;
      setLoadingLessonData(true);
      setAttendanceData([]); // Clear previous data
      try {
        const lessonId = await getLessonId(startTime, endTime);
        const db = getFirestore();
        const lessonRef = doc(db, 'classes', classId, 'lessons', lessonId);
        const lessonSnap = await getDoc(lessonRef);

        if (lessonSnap.exists()) {
          const classRef = doc(db, 'classes', classId);
          const classSnap = await getDoc(classRef);
          if (classSnap.exists()) {
            const classData = classSnap.data();
            const studentsMap = classData.students || {};
            const lessonDocData = lessonSnap.data();
            const studentsWithDetails = Object.entries(lessonDocData.students || {}).map(([uid, data]) => ({
              uid,
              email: studentsMap[uid] || 'Unknown',
              ...data,
            }));
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
            setAttendanceData(initialAttendance);

          } else {
            setLessonData(lessonSnap.data());
          }
        } else {
          setLessonData(null);
        }
      } catch (error) {
        console.error("Error fetching lesson data:", error);
        setLessonData(null);
      }
      setLoadingLessonData(false);
    };

    fetchLessonData();
  }, [selectedLesson, classId, startTime, endTime, lessonDurationInMinutes]);

  const handleExportToCSV = () => {
    if (combinedData.length === 0) return;

    const headers = [
      { label: "Student Email", key: "email" },
      { label: "Screen Share Minutes", key: "totalMinutes" },
      { label: "Screen Share Percentage", key: "percentage" },
      { label: "AI Estimated Working Minutes", key: "workingMinutes" },
      { label: "AI Estimated Percentage", key: "aiPercentage" },
      { label: "General Summary", key: "generalSummary" },
      { label: "Student-Specific Summary", key: "studentSummary" },
      { label: "General Feedback", key: "generalFeedback" },
      { label: "Student-Specific Feedback", key: "studentFeedback" },
      ...Array.from({ length: lessonDurationInMinutes }, (_, i) => ({ label: `Min ${i + 1}`, key: `min${i + 1}` }))
    ];

    const data = combinedData.map(studentData => {
      const sanitize = (str) => str ? str.replace(/,/g, ' ').replace(/\n/g, ' ') : '';
      const row = {
        email: studentData.email,
        totalMinutes: studentData.totalMinutes ?? 'N/A',
        percentage: studentData.percentage ?? 'N/A',
        workingMinutes: studentData.workingMinutes ?? 'N/A',
        aiPercentage: studentData.workingMinutes && lessonDurationInMinutes > 0 ? ((studentData.workingMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%' : 'N/A',
        generalSummary: sanitize(lessonData?.generalSummary),
        studentSummary: sanitize(studentData.summary),
        generalFeedback: (lessonData?.generalFeedback || []).map(sanitize).join(' | '),
        studentFeedback: (studentData.feedback || []).map(sanitize).join(' | '),
      };
      const attendanceRecord = studentData.attendance || Array(lessonDurationInMinutes).fill(0);
      attendanceRecord.forEach((present, i) => {
        row[`min${i + 1}`] = present;
      });
      return row;
    });

    setCsvData({ headers, data });
  };

  useEffect(() => {
    if (csvData && csvLink.current) {
      csvLink.current.link.click();
      const timer = setTimeout(() => {
        setCsvData(null);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [csvData]);

  const minuteKeys = lessonDurationInMinutes > 0 ? Array.from({ length: lessonDurationInMinutes }, (_, i) => i + 1) : [];

  return (
    <div style={{ height: 'calc(100vh - 200px)', width: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0 }}>
        <h2>
          Attendance & AI Analysis
          <button onClick={handleFetchAttendance} style={{ marginLeft: '20px' }} disabled={loadingAttendance}>
            {loadingAttendance ? 'Calculating...' : 'Calculate Live Attendance'}
          </button>
          <button onClick={handleExportToCSV} style={{ marginLeft: '10px' }} disabled={combinedData.length === 0}>Export to CSV</button>
        </h2>
        {csvData && (
          <CSVLink
            headers={csvData.headers}
            data={csvData.data}
            filename={filename}
            style={{ display: "none" }}
            ref={csvLink}
            target="_blank"
          />
        )}
      </div>
      <div style={{ flexGrow: 1, overflowY: 'auto' }}>
        {(loadingAttendance || loadingLessonData) && <p>Loading data...</p>}
        {combinedData.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
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
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.email}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.totalMinutes ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.percentage ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.workingMinutes ?? 'N/A'}</td>
                    <td style={{ border: '1px solid #ddd', padding: '8px' }}>
                      {student.workingMinutes && lessonDurationInMinutes > 0 ? `${((student.workingMinutes / lessonDurationInMinutes) * 100).toFixed(2)}%` : 'N/A'}
                    </td>
                    {student.attendance.map((present, index) => (
                      <td
                        key={index}
                        title={`Min ${index + 1}: ${present ? 'Present' : 'Absent'}`}
                        style={{
                          border: '1px solid #ddd',
                          backgroundColor: present ? '#2ECC71' : '#FADBD8',
                          width: '25px',
                          height: '25px',
                        }}
                      ></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !(loadingAttendance || loadingLessonData) && <p>Click the button to calculate live attendance. No data available.</p>}
      </div>

      <Modal show={!!selectedStudent} onClose={() => setSelectedStudent(null)} title={`AI Analysis for ${selectedStudent?.email}`}>
        {selectedStudent && (
          <div>
            <h4>General Summary</h4>
            <p>{lessonData?.generalSummary || 'Not available.'}</p>
            <h4>Student-Specific Summary</h4>
            <p>{selectedStudent.summary || 'Not available.'}</p>
            <hr />
            <h4>General Feedback</h4>
            <div>
              {(lessonData?.generalFeedback || []).length > 0 ? (
                lessonData.generalFeedback.map((fb, index) => <p key={index}>{fb}</p>)
              ) : (
                <p>Not available.</p>
              )}
            </div>
            <h4>Student-Specific Feedback</h4>
            <div>
              {(selectedStudent.feedback || []).length > 0 ? (
                selectedStudent.feedback.map((fb, index) => <p key={index}>{fb}</p>)
              ) : (
                <p>Not available.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default AttendanceView;