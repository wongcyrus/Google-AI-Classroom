import React from 'react';
import './StudentScreen.css';

const StudentScreen = ({ student, isSharing, screenshotData, screenshotUrl, selectedChannel = 'both', onClick }) => {
  const screenUrl = screenshotData?.screen?.url || (selectedChannel !== 'webcam' ? screenshotUrl : null);
  const webcamUrl = screenshotData?.webcam?.url || (selectedChannel === 'webcam' ? screenshotUrl : null);

  const showScreen = (selectedChannel === 'both' || selectedChannel === 'screen') && screenUrl;
  const showWebcam = (selectedChannel === 'both' || selectedChannel === 'webcam') && webcamUrl;
  const isDual = selectedChannel === 'both' && showScreen && showWebcam;

  return (
    <div 
      className={`student-screen ${isSharing ? 'sharing' : 'not-sharing'}`} 
      onClick={onClick}
      title={`Click to inspect ${student.name || student.email} in detail modal`}
    >
      <div className="student-header">
        <h2>{student.name || student.email}</h2>
        <div className="header-status-group">
          {screenshotData?.screen?.url && <span className="stream-pill" title="Screen Feed Active">🖥️</span>}
          {screenshotData?.webcam?.url && <span className="stream-pill" title="Webcam Feed Active">📷</span>}
          <span className={`status-indicator ${isSharing ? 'on' : 'off'}`}></span>
        </div>
      </div>

      <div className={`student-screen-body ${isDual ? 'split-dual' : ''}`}>
        {selectedChannel === 'both' ? (
          <>
            {showScreen && (
              <div className="feed-viewport">
                <span className="feed-tag">🖥️ Screen</span>
                <img src={screenUrl} alt={`Screen from ${student.email}`} />
              </div>
            )}
            {showWebcam && (
              <div className="feed-viewport">
                <span className="feed-tag">📷 Webcam</span>
                <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
              </div>
            )}
            {!showScreen && !showWebcam && (
              <div className="no-screenshot-placeholder">
                {isSharing ? 'Connecting...' : 'Not Sharing'}
              </div>
            )}
          </>
        ) : selectedChannel === 'screen' ? (
          showScreen ? (
            <div className="feed-viewport single">
              <span className="feed-tag">🖥️ Screen</span>
              <img src={screenUrl} alt={`Screen from ${student.email}`} />
            </div>
          ) : (
            <div className="no-screenshot-placeholder">
              {isSharing ? 'No Screen Stream' : 'Not Sharing'}
            </div>
          )
        ) : (
          showWebcam ? (
            <div className="feed-viewport single">
              <span className="feed-tag">📷 Webcam</span>
              <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
            </div>
          ) : (
            <div className="no-screenshot-placeholder">
              {isSharing ? 'No Webcam Stream' : 'Not Sharing'}
            </div>
          )
        )}
      </div>
    </div>
  );
};

export default StudentScreen;
