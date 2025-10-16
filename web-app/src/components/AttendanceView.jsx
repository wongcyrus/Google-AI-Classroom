import { useState, useEffect, useRef } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { CSVLink } from 'react-csv';

const AttendanceView = ({ classId, selectedLesson, startTime, endTime }) => {
  const [attendanceData, setAttendanceData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [csvData, setCsvData] = useState(null);
  const csvLink = useRef(null);

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

  useEffect(() => {
    if (!selectedLesson || !classId || !startTime || !endTime) return;

    let active = true;
    const fetchAttendanceData = async () => {
      setLoading(true);
      const functions = getFunctions();
      const getAttendanceData = httpsCallable(functions, 'getAttendanceData');
      try {
        const result = await getAttendanceData({ classId, startTime, endTime });
        if (active) {
          setAttendanceData(result.data.attendanceData);
        }
      } catch (error) {
        console.error("Error fetching attendance data: ", error);
        if (active) {
          setAttendanceData([]);
        }
      }
      if (active) {
        setLoading(false);
      }
    };

    fetchAttendanceData();

    return () => {
      active = false;
    };
  }, [selectedLesson, classId, startTime, endTime]);

  const handleExportToCSV = () => {
    if (attendanceData.length === 0) return;

    const lessonDurationInMinutes = attendanceData[0].attendance.length;
    const headers = [
      { label: "Student Email", key: "email" },
      { label: "Total Minutes", key: "totalMinutes" },
      { label: "Percentage", key: "percentage" },
      ...Array.from({ length: lessonDurationInMinutes }, (_, i) => ({ label: `Min ${i + 1}`, key: `min${i + 1}` }))
    ];

    const data = attendanceData.map(studentData => {
      const row = {
        email: studentData.email,
        totalMinutes: studentData.totalMinutes,
        percentage: studentData.percentage,
      };
      studentData.attendance.forEach((present, i) => {
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

  const minuteKeys = attendanceData.length > 0 ? Array.from({ length: attendanceData[0].attendance.length }, (_, i) => i + 1) : [];

  return (
    <div style={{ height: '600px', width: '100%' }}>
      <h2>
        Attendance
        <button onClick={handleExportToCSV} style={{ marginLeft: '20px' }}>Export to CSV</button>
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
      {loading && <p>Loading attendance data...</p>}
      {attendanceData.length > 0 && (
        <div style={{ overflow: 'auto', height: '100%' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Student</th>
                <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Total Minutes</th>
                <th style={{ border: '1px solid #ddd', padding: '8px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>Percentage</th>
                {minuteKeys.map(minute => (
                  <th key={minute} style={{ border: '1px solid #ddd', padding: '8px', minWidth: '25px', position: 'sticky', top: 0, background: 'white', zIndex: 1 }}>{minute}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attendanceData.map(student => (
                <tr key={student.email}>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.email}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.totalMinutes}</td>
                  <td style={{ border: '1px solid #ddd', padding: '8px' }}>{student.percentage}</td>
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
      )}
    </div>
  );
};

export default AttendanceView;