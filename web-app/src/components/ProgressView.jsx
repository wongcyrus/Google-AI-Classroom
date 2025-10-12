import { useState, useMemo } from 'react';
import './SharedViews.css';
import usePaginatedQuery from '../hooks/useCollectionQuery';

const ProgressView = ({ classId, startTime, endTime }) => {
  const [selectedStudentUid, setSelectedStudentUid] = useState(null);

  // Fetch all progress data within the date range. 
  // Note: This view summarizes latest progress, so we fetch all items in the range rather than paginating.
  const { data: allProgress, loading } = usePaginatedQuery('progress', { 
    classId, 
    startTime, 
    endTime, 
    pageSize: 9999 // Fetch all documents in range
  });

  // This effect calculates the latest progress report for each student from the fetched data.
  const latestProgress = useMemo(() => {
    const latest = {};
    allProgress.forEach(p => {
      if (!latest[p.studentUid] || p.timestamp.toMillis() > latest[p.studentUid].timestamp.toMillis()) {
        latest[p.studentUid] = p;
      }
    });
    return latest;
  }, [allProgress]);

  const renderDetailView = () => {
    const studentProgress = allProgress
      .filter(p => p.studentUid === selectedStudentUid)
      .sort((a, b) => b.timestamp.toMillis() - a.timestamp.toMillis());

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