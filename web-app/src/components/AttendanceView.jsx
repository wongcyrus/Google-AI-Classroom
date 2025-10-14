import { useState, useEffect, useRef } from 'react';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config';
import { ResponsiveHeatMap } from '@nivo/heatmap';
import { CSVLink } from 'react-csv';

const AttendanceView = ({ classId, selectedLesson, startTime, endTime }) => {
  const [students, setStudents] = useState([]);
  const [heatmapData, setHeatmapData] = useState([]);
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
    if (!classId) return;

    const classRef = doc(db, 'classes', classId);
    const unsubscribe = onSnapshot(classRef, (classSnap) => {
      if (classSnap.exists()) {
        const classData = classSnap.data();
        const studentsMap = classData.students || {};
        const studentList = Object.entries(studentsMap).map(([uid, email]) => ({
          uid: uid,
          email: email.replace(/\s/g, ''),
        }));
        studentList.sort((a, b) => a.email.localeCompare(b.email));
        setStudents(studentList);
      } else {
        setStudents([]);
      }
    });

    return () => unsubscribe();
  }, [classId]);

  useEffect(() => {
    if (!selectedLesson || students.length === 0) return;

    const fetchAttendanceData = async () => {
      setLoading(true);
      const lessonStartTime = new Date(startTime);
      const lessonEndTime = new Date(endTime);
      const lessonDurationInMinutes = Math.round((lessonEndTime - lessonStartTime) / 60000);

      if (lessonDurationInMinutes <= 0) {
        setHeatmapData([]);
        setLoading(false);
        return;
      }

      const studentEmails = students.map(s => s.email);
      const heatmapData = studentEmails.map(email => ({
        id: email,
        data: Array.from({ length: lessonDurationInMinutes }, (_, i) => ({ x: `${i}`, y: 0 }))
      }));

      const screenshotsRef = collection(db, 'screenshots');
      const q = query(
        screenshotsRef,
        where('classId', '==', classId),
        where('timestamp', '>=', lessonStartTime),
        where('timestamp', '<=', lessonEndTime)
      );
      const querySnapshot = await getDocs(q);

      querySnapshot.forEach(doc => {
        const screenshot = doc.data();
        const studentEmail = screenshot.email.replace(/\s/g, '');
        const studentIndex = studentEmails.indexOf(studentEmail);

        if (studentIndex !== -1) {
          const screenshotTime = screenshot.timestamp.toDate();
          const minuteIndex = Math.floor((screenshotTime - lessonStartTime) / 60000);
          if (minuteIndex >= 0 && minuteIndex < lessonDurationInMinutes) {
            if (heatmapData[studentIndex] && heatmapData[studentIndex].data[minuteIndex]) {
              heatmapData[studentIndex].data[minuteIndex].y = 1;
            }
          }
        }
      });

      setHeatmapData(heatmapData);
      setLoading(false);
    };

    fetchAttendanceData();
  }, [selectedLesson, students, classId, startTime, endTime]);

  const handleExportToCSV = () => {
    if (heatmapData.length === 0) return;

    const lessonDurationInMinutes = heatmapData[0].data.length;
    const headers = [
      { label: "Student Email", key: "email" },
      { label: "Total Minutes", key: "total" },
      { label: "Percentage", key: "percentage" },
      ...Array.from({ length: lessonDurationInMinutes }, (_, i) => ({ label: `Min ${i}`, key: `min${i}` }))
    ];

    const data = heatmapData.map(studentData => {
      const totalMinutes = studentData.data.reduce((sum, d) => sum + d.y, 0);
      const percentage = ((totalMinutes / lessonDurationInMinutes) * 100).toFixed(2) + '%';
      const row = {
        email: studentData.id,
        total: totalMinutes,
        percentage: percentage,
      };
      studentData.data.forEach((d, i) => {
        row[`min${i}`] = d.y;
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

  const minuteKeys = Array.from({ length: Math.round((new Date(endTime) - new Date(startTime)) / 60000) }, (_, i) => `${i}`);

  return (
    <div style={{ height: '600px', width: '100%' }}>
      <h2>
        Attendance Heatmap
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
      {heatmapData.length > 0 && (
        <ResponsiveHeatMap
          data={heatmapData}
          keys={minuteKeys}
          indexBy="id"
          margin={{ top: 100, right: 60, bottom: 60, left: 150 }}
          minValue={0}
          maxValue={1}
          axisTop={{
            orient: 'top',
            tickSize: 5,
            tickPadding: 5,
            tickRotation: -90,
            legend: 'Time (minutes)',
            legendOffset: -50,
          }}
          axisRight={null}
          axisBottom={null}
          axisLeft={{
            orient: 'left',
            tickSize: 5,
            tickPadding: 5,
            tickRotation: 0,
            legend: 'Student',
            legendPosition: 'middle',
            legendOffset: -140,
          }}
          colors={{ type: 'sequential', scheme: 'greens' }}
          cellOpacity={1}
          cellBorderColor={{ from: 'color', modifiers: [['darker', 0.4]] }}
          labelTextColor={{ from: 'color', modifiers: [['darker', 1.8]] }}
          defs={[
            {
              id: 'lines',
              type: 'patternLines',
              background: 'inherit',
              color: 'rgba(0, 0, 0, 0.1)',
              rotation: -45,
              lineWidth: 4,
              spacing: 7,
            },
          ]}
          fill={[{ id: 'lines' }]}
          animate={true}
          motionStiffness={80}
          motionDamping={9}
          hoverTarget="cell"
          cellHoverOthersOpacity={0.25}
        />
      )}
    </div>
  );
};

export default AttendanceView;