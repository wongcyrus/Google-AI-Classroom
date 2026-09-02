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
          {student?.clientAiStatus === 'initializing' && (
            <span className="ai-status-badge initializing" title={`AI Model Loading (${student?.loadingProgress || 0}%)`}>
              ⏳ {student?.loadingProgress || 0}%
            </span>
          )}
          {student?.clientAiStatus === 'ready' && student?.faceStatus === 'normal' && (
            <span className="ai-status-badge normal" title={`On-Device AI Ready (${student?.delegateUsed || 'GPU'})`}>🟢</span>
          )}
          {student?.faceStatus === 'looking_away' && <span className="ai-status-badge warn" title={`Looking Away (${student.yawAngle > 0 ? '+' : ''}${student.yawAngle || ''}°)`}>🟡</span>}
          {student?.faceStatus === 'no_face' && <span className="ai-status-badge danger" title="No Face in Frame">🔴</span>}
          {student?.faceStatus === 'multiple_faces' && <span className="ai-status-badge danger" title="Multiple People Detected">👥</span>}
          {student?.clientAiStatus === 'cloud_fallback' && <span className="ai-status-badge fallback" title={`Cloud AI Fallback Active ${student?.fallbackReason ? `(${student.fallbackReason})` : ''}`}>☁️</span>}
          {student?.gemmaModelStatus === 'ready' && (
            <span className="ai-status-badge normal" title="Gemma 4 E2B is loaded on this student device">🤖</span>
          )}
          {student?.gemmaModelStatus === 'loading' && (
            <span className="ai-status-badge initializing" title={`Student is loading Gemma 4 E2B (${student?.gemmaLoadingProgress || 0}%)`}>
              🤖 {student?.gemmaLoadingProgress || 0}%
            </span>
          )}
          {student?.gemmaModelStatus === 'unavailable' && (
            <span className="ai-status-badge danger" title={`Gemma unavailable: ${student?.gemmaUnavailableReason || 'Unknown reason'}`}>⛔🤖</span>
          )}
          {student?.gemmaModelStatus === 'not_loaded' && (
            <span className="ai-status-badge fallback" title="Student has not chosen to load Gemma 4 E2B">○🤖</span>
          )}
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
        {student?.clientAiStatus === 'initializing' && isSharing && (
          <div className="screen-ai-alert initializing">
            ⏳ AI Loading ({student?.loadingProgress || 0}%)
          </div>
        )}
        {student?.faceStatus && student.faceStatus !== 'normal' && isSharing && student?.clientAiStatus !== 'initializing' && (
          <div className={`screen-ai-alert ${student.faceStatus}`}>
            {student.faceStatus === 'looking_away' && `👀 Looking Away (${student.yawAngle > 0 ? '+' : ''}${student.yawAngle || 0}°)`}
            {student.faceStatus === 'eyes_closed' && '😴 Eyes Closed / Sleeping'}
            {student.faceStatus === 'talking' && '🗣️ Talking / Whispering'}
            {student.faceStatus === 'no_face' && '⚠️ No Face'}
            {student.faceStatus === 'multiple_faces' && '⚠️ Multiple People'}
            {student.faceStatus === 'cloud_fallback' && '☁️ Cloud Fallback'}
          </div>
        )}
        {student?.liveTranscript && isSharing && (
          <div className="screen-speech-bubble" title={`Live Speech (Whisper): ${student.liveTranscript}`}>
            <span className="speech-lang-tag">
              {student.speechLanguage === 'cantonese' ? '💬 粵' : student.speechLanguage === 'mandarin' ? '💬 普' : student.speechLanguage === 'mixed' ? '💬 粵/普/EN' : '💬 EN'}
            </span>
            <span className="speech-text">"{student.liveTranscript}"</span>
          </div>
        )}
        {student?.gemmaAlert && isSharing && (
          <div
            className={`screen-gemma-alert ${student.gemmaSeverity || 'medium'}`}
            title={`LiteRT Gemma Speech Violation: ${student.gemmaAlert} (${Math.round((student.gemmaConfidence || 0.9) * 100)}% confidence)`}
          >
            {student.gemmaAlert === 'COLLUSION_EXAM' && '🚨 Collusion (Gemma)'}
            {student.gemmaAlert === 'EXTERNAL_AI_ASSIST' && '⚠️ Dictation/AI (Gemma)'}
            {student.gemmaAlert === 'UNAUTHORIZED_TALK' && '🗣️ Side Talk (Gemma)'}
            {student.gemmaAlert !== 'COLLUSION_EXAM' && student.gemmaAlert !== 'EXTERNAL_AI_ASSIST' && student.gemmaAlert !== 'UNAUTHORIZED_TALK' && `🚨 ${student.gemmaAlert}`}
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentScreen;
