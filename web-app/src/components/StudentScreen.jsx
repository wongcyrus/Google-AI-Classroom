import React from 'react';
import './StudentScreen.css'; // Import styles from StudentScreen.css

const StudentScreen = ({ student, isSharing, screenshotUrl, onClick }) => {
  return (
    <div className={`student-screen ${isSharing ? 'sharing' : 'not-sharing'}`} onClick={onClick}>
      <div className="student-header">
        <h2>{student.email}</h2>
        <span className={`status-indicator ${isSharing ? 'on' : 'off'}`}></span>
      </div>
      {screenshotUrl ? (
        <img src={screenshotUrl} alt={`Screenshot from ${student.email}`} />
      ) : (
        <div className="no-screenshot-placeholder">
          {isSharing ? 'Connecting...' : 'Not Sharing'}
        </div>
      )}
    </div>
  );
};

export default StudentScreen;
