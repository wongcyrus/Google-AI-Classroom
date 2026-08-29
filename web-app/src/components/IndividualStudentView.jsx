import React, { useState } from 'react';
import './IndividualStudentView.css';
import { db } from '../firebase-config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const IndividualStudentView = ({ student, screenshotData, screenshotUrl, onClose }) => {
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('dual'); // 'dual' | 'screen' | 'webcam'

  if (!student) {
    return null;
  }

  const screenUrl = screenshotData?.screen?.url || (screenshotUrl && activeTab !== 'webcam' ? screenshotUrl : null);
  const webcamUrl = screenshotData?.webcam?.url;

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    try {
      const studentMessagesRef = collection(db, 'students', student.id, 'messages');
      await addDoc(studentMessagesRef, {
        message,
        timestamp: serverTimestamp(),
      });
      setMessage('');
      alert(`Message sent to ${student.email}`);
    } catch (error) {
      console.error('Error sending message: ', error);
    }
  };

  const handleShare = async (urlToShare) => {
    const targetUrl = urlToShare || screenUrl || webcamUrl;
    if (navigator.share && targetUrl) {
      try {
        const response = await fetch(targetUrl);
        const blob = await response.blob();
        const file = new File([blob], `${student.email}-screenshot.png`, { type: blob.type });

        await navigator.share({
          files: [file],
          title: `Screenshot of ${student.email}`,
          text: `Here is a screenshot of ${student.email}.`,
        });
      } catch (error) {
        console.error('Error sharing:', error);
      }
    } else {
      if (targetUrl) {
        navigator.clipboard.writeText(targetUrl);
        alert('Screenshot URL copied to clipboard!');
      } else {
        alert('No screenshot to share.');
      }
    }
  };

  return (
    <div className="individual-student-view-overlay" onClick={onClose}>
      <div className="individual-student-view-content" onClick={(e) => e.stopPropagation()}>
        <div className="individual-student-view-header">
          <div>
            <h2>{student.name || student.email}</h2>
            <p className="student-subemail">{student.email}</p>
          </div>

          <div className="channel-tab-group">
            <button 
              className={`channel-tab-btn ${activeTab === 'dual' ? 'active' : ''}`}
              onClick={() => setActiveTab('dual')}
            >
              Dual View
            </button>
            <button 
              className={`channel-tab-btn ${activeTab === 'screen' ? 'active' : ''}`}
              onClick={() => setActiveTab('screen')}
              disabled={!screenUrl}
            >
              🖥️ Screen
            </button>
            <button 
              className={`channel-tab-btn ${activeTab === 'webcam' ? 'active' : ''}`}
              onClick={() => setActiveTab('webcam')}
              disabled={!webcamUrl}
            >
              📷 Webcam
            </button>
          </div>

          <div className="message-sender">
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)} 
              placeholder="Send direct message to student..." 
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
            />
            <button onClick={handleSendMessage} className="btn-send">Send</button>
          </div>

          <div className="header-actions">
            <button onClick={() => handleShare()} className="btn-secondary">Share</button>
            <button onClick={onClose} className="btn-close">✕</button>
          </div>
        </div>

        <div className="individual-student-view-body">
          {activeTab === 'dual' ? (
            <div className="individual-dual-container">
              <div className="individual-feed-card">
                <div className="feed-card-header">
                  <span>🖥️ Screen Stream</span>
                  {screenUrl && <button onClick={() => handleShare(screenUrl)} className="btn-mini">Share Screen</button>}
                </div>
                {screenUrl ? (
                  <img src={screenUrl} alt={`Screen from ${student.email}`} />
                ) : (
                  <div className="feed-card-empty">No Screen Stream Available</div>
                )}
              </div>

              <div className="individual-feed-card">
                <div className="feed-card-header">
                  <span>📷 Webcam Stream</span>
                  {webcamUrl && <button onClick={() => handleShare(webcamUrl)} className="btn-mini">Share Webcam</button>}
                </div>
                {webcamUrl ? (
                  <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
                ) : (
                  <div className="feed-card-empty">No Webcam Stream Available</div>
                )}
              </div>
            </div>
          ) : activeTab === 'screen' ? (
            <div className="individual-single-feed">
              {screenUrl ? (
                <img src={screenUrl} alt={`Screen from ${student.email}`} />
              ) : (
                <p className="no-feed-text">No Screen Stream Available</p>
              )}
            </div>
          ) : (
            <div className="individual-single-feed">
              {webcamUrl ? (
                <img src={webcamUrl} alt={`Webcam from ${student.email}`} />
              ) : (
                <p className="no-feed-text">No Webcam Stream Available</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default IndividualStudentView;