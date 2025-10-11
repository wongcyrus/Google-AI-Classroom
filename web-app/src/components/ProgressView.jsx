import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';
import { useClassSchedule } from '../hooks/useClassSchedule';

const ProgressView = ({ classId, startTime, endTime, lessons, selectedLesson, handleLessonChange }) => {
  const [allProgress, setAllProgress] = useState([]);
  const [latestProgress, setLatestProgress] = useState({});
  const [selectedStudentUid, setSelectedStudentUid] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!classId || !startTime) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);

    const progressRef = collection(db, "progress");
    const q = query(
      progressRef,
      where("classId", "==", classId),
      where("timestamp", ">=", new Date(startTime)),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const progressData = [];
      querySnapshot.forEach((doc) => {
        progressData.push({ id: doc.id, ...doc.data() });
      });
      setAllProgress(progressData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching progress: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [classId, startTime]);

  useEffect(() => {
    if (!endTime) {
      setLatestProgress({});
      return;
    }
    const latest = {};
    const filteredProgress = allProgress.filter(p => p.timestamp.toDate() <= new Date(endTime));
    filteredProgress.forEach(p => {
      if (!latest[p.studentUid] || p.timestamp.toMillis() > latest[p.studentUid].timestamp.toMillis()) {
        latest[p.studentUid] = p;
      }
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLatestProgress(latest);
  }, [allProgress, endTime]);

  const renderDetailView = () => {
    const studentProgress = allProgress
      .filter(p => p.studentUid === selectedStudentUid)
      .filter(p => !endTime || p.timestamp.toDate() <= new Date(endTime));

    const studentEmail = studentProgress.length > 0 ? studentProgress[0].studentEmail : selectedStudentUid;

    return (
      <div className="view-container">
        <div className="view-header">
            <button onClick={() => setSelectedStudentUid(null)}>Back to Summary</button>
            <h3>Progress for {studentEmail}</h3>
        </div>
        <ul className="progress-list">
          {studentProgress.map((p) => (
            <li key={p.id} className="progress-item">
              <p><strong>Progress:</strong> {p.progress}</p>
              <p><strong>Timestamp:</strong> {new Date(p.timestamp?.toDate()).toLocaleString()}</p>
            </li>
          ))}
        </ul>
      </div>
    );
  };

  const renderSummaryView = () => {
    const latestProgressArray = Object.values(latestProgress);
    return (
      <div className="view-container">
        <div className="view-header">
          <h2>Student Progress Summary</h2>
        </div>

        {loading ? (
          <p>Loading progress...</p>
        ) : latestProgressArray.length === 0 ? (
          <p>No progress recorded for this class in the selected time range.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Latest Progress</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {latestProgressArray.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => setSelectedStudentUid(p.studentUid)}>
                    <td>{p.studentEmail}</td>
                    <td>{p.progress}</td>
                    <td>{new Date(p.timestamp?.toDate()).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="progress-view">
      {selectedStudentUid ? renderDetailView() : renderSummaryView()}
    </div>
  );
};

export default ProgressView;