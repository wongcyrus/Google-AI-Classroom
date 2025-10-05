import React, { useState } from 'react';
import './IndividualStudentView.css';
import { db } from '../firebase-config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const IndividualStudentView = ({ student, screenshotUrl, onClose }) => {
  const [message, setMessage] = useState('');

  if (!student) {
    return null;
  }

  const handleSendMessage = async () => {
    if (!message.trim()) return;

    try {
      const studentMessagesRef = collection(db, 'students', student.id, 'messages');
      await addDoc(studentMessagesRef, {
        message,
        timestamp: serverTimestamp(),
      });
      setMessage('');
    } catch (error) {
      console.error('Error sending message: ', error);
    }
  };

  const handleShare = async () => {
    if (navigator.share && screenshotUrl) {
      try {
        const response = await fetch(screenshotUrl);
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
      if (screenshotUrl) {
        navigator.clipboard.writeText(screenshotUrl);
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
          <h2>{student.email}</h2>
          <div className="message-sender">
            <input 
              type="text" 
              value={message} 
              onChange={(e) => setMessage(e.target.value)} 
              placeholder="Type a message..." 
            />
            <button onClick={handleSendMessage}>Send</button>
          </div>
          <button onClick={handleShare}>Share</button>
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