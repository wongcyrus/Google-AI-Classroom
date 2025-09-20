import { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase-config';
import './ProgressView.css';

const ProgressView = ({ classId, setTitle }) => {
  const [allProgress, setAllProgress] = useState([]);
  const [latestProgress, setLatestProgress] = useState({});
  const [startTime, setStartTime] = useState(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [selectedStudentEmail, setSelectedStudentEmail] = useState(null);

  useEffect(() => {
    if (setTitle) {
      setTitle('Student Progress');
    }
  }, [setTitle]);

  useEffect(() => {
    if (!classId) return;

    const progressRef = collection(db, "progress");
    const q = query(
      progressRef,
      where("classId", "==", classId),
      where("timestamp", ">=", startTime),
      orderBy("timestamp", "desc")
    );

    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const progressData = [];
      querySnapshot.forEach((doc) => {
        progressData.push({ id: doc.id, ...doc.data() });
      });
      setAllProgress(progressData);
    });

    return () => unsubscribe();
  }, [classId, startTime]);

  useEffect(() => {
    const latest = {};
    allProgress.forEach(p => {
      if (!latest[p.email] || p.timestamp.toMillis() > latest[p.email].timestamp.toMillis()) {
        latest[p.email] = p;
      }
    });
    setLatestProgress(latest);
  }, [allProgress]);

  const handleStartTimeChange = (e) => {
    setStartTime(new Date(e.target.value));
  };

  const renderDetailView = () => {
    const studentProgress = allProgress.filter(p => p.email === selectedStudentEmail);
    return (
      <div>
        <button onClick={() => setSelectedStudentEmail(null)}>Back to Summary</button>
        <h3>Progress for {selectedStudentEmail}</h3>
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
      <div>
        <div className="filters">
          <label htmlFor="start-time">Show progress since: </label>
          <input
            type="datetime-local"
            id="start-time"
            value={startTime.toISOString().substring(0, 16)}
            onChange={handleStartTimeChange}
          />
        </div>
        {latestProgressArray.length === 0 ? (
          <p>No progress recorded for this class in the selected time range.</p>
        ) : (
          <ul className="progress-list">
            {latestProgressArray.map((p) => (
              <li key={p.id} className="progress-item clickable" onClick={() => setSelectedStudentEmail(p.email)}>
                <p><strong>Student:</strong> {p.email}</p>
                <p><strong>Latest Progress:</strong> {p.progress}</p>
                <p><strong>Timestamp:</strong> {new Date(p.timestamp?.toDate()).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <div className="progress-view">
      <h2>Student Progress for Class: {classId}</h2>
      {selectedStudentEmail ? renderDetailView() : renderSummaryView()}
    </div>
  );
};

export default ProgressView;
