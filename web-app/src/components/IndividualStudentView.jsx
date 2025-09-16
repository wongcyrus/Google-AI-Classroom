import React from 'react';
import './IndividualStudentView.css';

const IndividualStudentView = ({ student, screenshotUrl, onClose }) => {
  if (!student) {
    return null;
  }

  return (
    <div className="individual-student-view-overlay" onClick={onClose}>
      <div className="individual-student-view-content" onClick={(e) => e.stopPropagation()}>
        <div className="individual-student-view-header">
          <h2>{student.email}</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <div className="individual-student-view-body">
          {screenshotUrl ? (
            <img src={screenshotUrl} alt={`Screenshot of ${student.email}`} />
          ) : (
            <p>No screenshot available.</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default IndividualStudentView;
