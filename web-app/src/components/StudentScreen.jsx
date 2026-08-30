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
          {student?.isAudioSharing && (
            <span 
              className={`stream-pill ${student?.audioStatus === 'speaking' ? 'speaking-active' : ''} ${student?.isMultiSpeaker || (student?.speakerCount > 1) ? 'multi-voice-warn' : ''}`} 
              title={`Audio Active (Level: ${student?.audioLevel || 0}%)${student?.isMultiSpeaker ? ' - ⚠️ Multiple Speakers Detected' : ''}`}
            >
              {student?.isMultiSpeaker || (student?.speakerCount > 1) ? '👥⚠️' : student?.audioStatus === 'speaking' ? '🔊' : '🎙️'}
            </span>
          )}
          {student?.faceStatus === 'normal' && <span className="ai-status-badge normal" title="Face Centered & Active">🟢</span>}
          {student?.faceStatus === 'looking_away' && <span className="ai-status-badge warn" title={`Looking Away (${student.yawAngle > 0 ? '+' : ''}${student.yawAngle || ''}°)`}>🟡</span>}
          {student?.faceStatus === 'no_face' && <span className="ai-status-badge danger" title="No Face in Frame">🔴</span>}
          {student?.faceStatus === 'multiple_faces' && <span className="ai-status-badge danger" title="Multiple People Detected">👥</span>}
          {student?.clientAiStatus === 'cloud_fallback' && <span className="ai-status-badge fallback" title="Cloud AI Fallback Active">☁️</span>}
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
        {student?.faceStatus && student.faceStatus !== 'normal' && isSharing && (
          <div className={`screen-ai-alert ${student.faceStatus}`}>
            {student.faceStatus === 'looking_away' && `👀 Looking Away (${student.yawAngle > 0 ? '+' : ''}${student.yawAngle || 0}°)`}
            {student.faceStatus === 'no_face' && '⚠️ No Face'}
            {student.faceStatus === 'multiple_faces' && '⚠️ Multiple People'}
            {student.faceStatus === 'cloud_fallback' && '☁️ Cloud Fallback'}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentScreen;
