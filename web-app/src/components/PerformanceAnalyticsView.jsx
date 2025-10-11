import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase-config';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const PerformanceAnalyticsView = () => {
  const { classId } = useParams();
  const [performanceData, setPerformanceData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPerformanceData = async () => {
      if (!classId) return;
      setLoading(true);
      try {
        const q = query(
          collection(db, 'performanceMetrics'),
          where('classId', '==', classId),
          where('status', '==', 'completed')
        );
        const querySnapshot = await getDocs(q);
        const data = querySnapshot.docs.map(doc => doc.data());

        // Aggregate data by taskName
        const aggregatedData = data.reduce((acc, curr) => {
          const task = acc.find(item => item.taskName === curr.taskName);
          if (task) {
            task.duration += curr.duration;
          } else {
            acc.push({ taskName: curr.taskName, duration: curr.duration });
          }
          return acc;
        }, []);

        setPerformanceData(aggregatedData);
      } catch (error) {
        console.error("Error fetching performance data: ", error);
      }
      setLoading(false);
    };

    fetchPerformanceData();
  }, [classId]);

  if (loading) {
    return <div>Loading...</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>Performance Analytics</h2>
      <p style={{ marginBottom: '20px', maxWidth: '800px' }}>
        This chart displays the total time students have spent on different tasks, as identified by the AI from their screen recordings. 
        Use this view to understand where your students are focusing their efforts and to identify tasks that may be taking longer than expected.
      </p>
      {performanceData.length > 0 ? (
        <ResponsiveContainer width="100%" height={400}>
          <BarChart
            data={performanceData}
            margin={{
              top: 5,
              right: 30,
              left: 20,
              bottom: 5,
            }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="taskName" />
            <YAxis label={{ value: 'Duration (seconds)', angle: -90, position: 'insideLeft' }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="duration" fill="#8884d8" />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p>No performance data has been collected yet. Data will appear here as the AI analyzes student activity.</p>
      )}
    </div>
  );
};

export default PerformanceAnalyticsView;
