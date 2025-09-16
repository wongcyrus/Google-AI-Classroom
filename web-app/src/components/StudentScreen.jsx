
import React from 'react';

const StudentScreen = ({ student, isSharing, screenshotUrl }) => {
  return (
    <div className={`student-screen ${isSharing ? 'sharing' : 'not-sharing'}`}>
      <div className="student-header">
        <h2>{student.email}</h2>
        <span className={`status-indicator ${isSharing ? 'on' : 'off'}`}>
          {isSharing ? 'Sharing' : 'Not Sharing'}
        </span>
      </div>
      {screenshotUrl ? (
        <img src={screenshotUrl} alt={`Screenshot from ${student.email}`} />
      ) : (
        <div className="no-screenshot">
          <p>{isSharing ? "Waiting for first capture..." : "Student has not started screen sharing."}</p>
        </div>
      )}
    </div>
  );
};

export default StudentScreen;
