import { useState, useEffect, useRef } from 'react';
import { db } from '../firebase-config';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { ResponsiveHeatMap } from '@nivo/heatmap';
import { CSVLink } from 'react-csv';

const AttendanceView = ({ classId, selectedLesson, startTime, endTime }) => {

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
    if (!selectedLesson || !classId || !startTime || !endTime) return;

    const fetchAttendanceData = async () => {
      setLoading(true);
      const functions = getFunctions();
      const getAttendanceData = httpsCallable(functions, 'getAttendanceData');
      try {
        const result = await getAttendanceData({ classId, startTime, endTime });
        setHeatmapData(result.data.heatmapData);
      } catch (error) {
        console.error("Error fetching attendance data: ", error);
        setHeatmapData([]);
      }
      setLoading(false);
    };

    fetchAttendanceData();
  }, [selectedLesson, classId, startTime, endTime]);

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