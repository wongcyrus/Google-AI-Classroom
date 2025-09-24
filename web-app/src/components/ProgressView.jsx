import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase-config';
import './SharedViews.css';
import DateRangeFilter from './DateRangeFilter';

const ProgressView = () => {
  const { classId } = useParams();
  const [allProgress, setAllProgress] = useState([]);
  const [latestProgress, setLatestProgress] = useState({});
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(d.getHours() - 2);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  });
  const [selectedStudentEmail, setSelectedStudentEmail] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!classId) return;
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
    const latest = {};
    const filteredProgress = allProgress.filter(p => p.timestamp.toDate() <= new Date(endTime));
    filteredProgress.forEach(p => {
      if (!latest[p.email] || p.timestamp.toMillis() > latest[p.email].timestamp.toMillis()) {
        latest[p.email] = p;
      }
    });
    setLatestProgress(latest);
  }, [allProgress, endTime]);

  const renderDetailView = () => {
    const studentProgress = allProgress
      .filter(p => p.email === selectedStudentEmail)
      .filter(p => p.timestamp.toDate() <= new Date(endTime));

    return (
      <div className="view-container">
        <div className="view-header">
            <button onClick={() => setSelectedStudentEmail(null)}>Back to Summary</button>
            <h3>Progress for {selectedStudentEmail}</h3>
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
        <DateRangeFilter 
          startTime={startTime}
          endTime={endTime}
          onStartTimeChange={setStartTime}
          onEndTimeChange={setEndTime}
          loading={loading}
        />
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
                  <tr key={p.id} className="clickable" onClick={() => setSelectedStudentEmail(p.email)}>
                    <td>{p.email}</td>
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
      {selectedStudentEmail ? renderDetailView() : renderSummaryView()}
    </div>
  );
};

export default ProgressView;